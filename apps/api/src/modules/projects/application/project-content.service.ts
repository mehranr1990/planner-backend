import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  ProjectDocument,
  ProjectComment,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedTasks } from '../../tasks/public/index.js';
import { SharedGoals } from '../../goals/public/index.js';
import {
  ProjectExecutionContext,
  projectWhere,
  executionKey,
  executionHash,
  matchRevision,
} from './project-execution-context.js';
import type {
  ExecutionContext,
  ExecutionTarget,
} from './project-execution-context.js';
export type ContentTarget = z.infer<typeof c.ProjectContentTargetSchema>;
export const contentColumns = (t: ContentTarget) => ({
  taskId: t.kind === 'TASK' ? t.id : null,
  goalId: t.kind === 'GOAL' ? t.id : null,
  documentId: t.kind === 'DOCUMENT' ? t.id : null,
});
export const contentTarget = (r: {
  projectId: string;
  taskId: string | null;
  goalId: string | null;
  documentId: string | null;
}): ContentTarget =>
  r.taskId
    ? { kind: 'TASK', id: r.taskId }
    : r.goalId
      ? { kind: 'GOAL', id: r.goalId }
      : r.documentId
        ? { kind: 'DOCUMENT', id: r.documentId }
        : { kind: 'PROJECT', id: r.projectId };
export const contentRequest = (
  t: ContentTarget,
): ExecutionTarget | undefined =>
  t.kind === 'TASK'
    ? t.id
    : t.kind === 'GOAL' || t.kind === 'PROJECT'
      ? { kind: t.kind, id: t.id }
      : undefined;
export const contentProof = (pid: string, t: ContentTarget) => ({
  kind: t.kind === 'DOCUMENT' ? ('PROJECT' as const) : t.kind,
  id: t.kind === 'DOCUMENT' ? pid : t.id,
});
const comment = (r: ProjectComment) =>
  c.ProjectCommentSchema.parse({
    id: r.id,
    projectId: r.projectId,
    target: contentTarget(r),
    body: r.deletedAt ? '' : r.body,
    revision: r.revision,
    createdByActorId: r.createdByActorId,
    createdAt: r.createdAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
  });
@Injectable()
export class ProjectContentService {
  constructor(
    @Inject(ProjectExecutionContext) readonly op: ProjectExecutionContext,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
    @Inject(SharedGoals) private readonly goals: SharedGoals,
  ) {}
  async authorize(s: ExecutionContext, t: ContentTarget, allowRetired = false) {
    if (t.kind === 'TASK') {
      await this.op.linked(s, t.id);
      await this.tasks.read(s.tx, s.a, s.pid, t.id);
    } else if (t.kind === 'GOAL') {
      await this.op.linked(s, { kind: t.kind, id: t.id });
      await this.goals.read(s.tx, s.a, s.pid, t.id);
    } else {
      s.a.require(s.tx, s.pid, 'task.read', { kind: 'PROJECT', id: s.pid });
      if (t.kind === 'PROJECT') {
        if (t.id !== s.pid) throw new NotFoundException();
      } else if (
        !(await s.tx.projectDocument.findFirst({
          where: {
            ...projectWhere(s),
            id: t.id,
            ...(!allowRetired ? { retiredAt: null } : {}),
          },
        }))
      )
        throw new NotFoundException();
    }
  }
  async activity(
    s: ExecutionContext,
    t: ContentTarget,
    action: string,
    resourceId: string,
  ) {
    const proof = s.a.require(s.tx, s.pid, 'task.read', contentProof(s.pid, t));
    await s.tx.projectActivity.create({
      data: {
        id: randomUUID(),
        ...projectWhere(s),
        ...contentColumns(t),
        actorId: proof.actorId,
        action,
        resourceId,
      },
    });
  }
  async exportDocuments(
    s: ExecutionContext,
    accept: (row: z.infer<typeof c.ProjectDocumentSchema>) => void,
  ) {
    s.a.require(s.tx, s.pid, 'export.visible');
    const output: z.infer<typeof c.ProjectDocumentSchema>[] = [];
    let after: string | undefined;
    for (;;) {
      const rows = await s.tx.projectDocument.findMany({
        where: {
          ...projectWhere(s),
          retiredAt: null,
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 100,
      });
      for (const row of rows) {
        const value = await this.documentView(s, row);
        accept(value);
        output.push(value);
      }
      if (rows.length < 100) return output;
      after = rows.at(-1)!.id;
    }
  }
  async exportComments(
    s: ExecutionContext,
    visible: { tasks: string[]; goals: string[]; documents: string[] },
    accept: (row: z.infer<typeof c.ProjectCommentSchema>) => void,
  ) {
    s.a.require(s.tx, s.pid, 'export.visible');
    const output: z.infer<typeof c.ProjectCommentSchema>[] = [];
    let after: string | undefined;
    for (;;) {
      const rows = await s.tx.projectComment.findMany({
        where: {
          ...projectWhere(s),
          deletedAt: null,
          ...(after ? { id: { gt: after } } : {}),
          OR: [
            { taskId: null, goalId: null, documentId: null },
            { taskId: { in: visible.tasks } },
            { goalId: { in: visible.goals } },
            { documentId: { in: visible.documents } },
          ],
        },
        orderBy: { id: 'asc' },
        take: 100,
      });
      for (const row of rows) {
        const value = comment(row);
        accept(value);
        output.push(value);
      }
      if (rows.length < 100) return output;
      after = rows.at(-1)!.id;
    }
  }
  private async document(s: ExecutionContext, id: string, retired = false) {
    const row = await s.tx.projectDocument.findFirst({
      where: {
        ...projectWhere(s),
        id,
        ...(!retired ? { retiredAt: null } : {}),
      },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async documentView(s: ExecutionContext, r: ProjectDocument) {
    const v = await s.tx.projectDocumentVersion.findUniqueOrThrow({
      where: { documentId_version: { documentId: r.id, version: r.revision } },
    });
    return c.ProjectDocumentSchema.parse({
      id: r.id,
      projectId: r.projectId,
      title: r.title,
      body: v.body,
      revision: r.revision,
      createdByActorId: r.createdByActorId,
      createdAt: r.createdAt.toISOString(),
      retiredAt: r.retiredAt?.toISOString() ?? null,
    });
  }
  documents(
    actor: RequestActor,
    pid: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.op.read(actor, pid, [], undefined, (s) =>
      this.op.page(s, 'documents', q, async (after) =>
        Promise.all(
          (
            await s.tx.projectDocument.findMany({
              where: {
                ...projectWhere(s),
                retiredAt: null,
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: 'asc' },
              take: q.limit + 1,
            })
          ).map((r) => this.documentView(s, r)),
        ),
      ),
    );
  }
  getDocument(actor: RequestActor, pid: string, id: string) {
    return this.op.read(actor, pid, [], undefined, async (s) =>
      this.documentView(s, await this.document(s, id)),
    );
  }
  publishDocument(
    actor: RequestActor,
    pid: string,
    id: string,
    expected: number,
    input: z.infer<typeof c.ProjectDocumentInputSchema>,
    raw?: string,
  ) {
    const key = expected === 0 ? executionKey(raw) : undefined,
      fingerprint = executionHash(input);
    return this.op.write(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'document.publish',
      id,
      [],
      async (s) => {
        if (key) {
          const old = await s.tx.projectDocument.findFirst({
            where: { ...projectWhere(s), creationKey: key },
          });
          if (old) {
            if (old.id !== id || old.fingerprint !== fingerprint)
              throw new ConflictException();
            return this.documentView(s, old);
          }
        }
        const before = expected ? await this.document(s, id) : null;
        if (before) matchRevision(before.revision, expected);
        await s.grow('project.document-version');
        await s.begin();
        const row = before
          ? await s.tx.projectDocument.update({
              where: { id },
              data: { title: input.title, revision: { increment: 1 } },
            })
          : await s.tx.projectDocument.create({
              data: {
                id,
                ...projectWhere(s),
                title: input.title,
                createdByActorId: s.a.require(s.tx, pid, 'work.manage').actorId,
                creationKey: key!,
                fingerprint,
              },
            });
        await s.tx.projectDocumentVersion.create({
          data: {
            ...projectWhere(s),
            documentId: id,
            version: row.revision,
            title: input.title,
            body: input.body,
            actorId: s.a.require(s.tx, pid, 'work.manage').actorId,
          },
        });
        await this.activity(
          s,
          { kind: 'DOCUMENT', id },
          'document.publish',
          id,
        );
        return this.documentView(s, row);
      },
    );
  }
  retireDocument(
    actor: RequestActor,
    pid: string,
    id: string,
    expected: number,
  ) {
    return this.op.write(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'document.retire',
      id,
      [],
      async (s) => {
        const before = await this.document(s, id);
        matchRevision(before.revision, expected);
        await s.grow('project.document-version');
        await s.begin();
        // Retirement is a versioned publication too, preserving the current body.
        const v = await this.documentView(s, before),
          row = await s.tx.projectDocument.update({
            where: { id },
            data: { retiredAt: s.now, revision: { increment: 1 } },
          });
        await s.tx.projectDocumentVersion.create({
          data: {
            ...projectWhere(s),
            documentId: id,
            version: row.revision,
            title: v.title,
            body: v.body,
            actorId: s.a.require(s.tx, pid, 'work.manage').actorId,
          },
        });
        await this.activity(s, { kind: 'DOCUMENT', id }, 'document.retire', id);
        return this.documentView(s, row);
      },
    );
  }
  documentVersions(
    actor: RequestActor,
    pid: string,
    id: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.op.read(actor, pid, [], undefined, async (s) => {
      await this.document(s, id);
      const values = await this.op.page(
        s,
        'document.versions:' + id,
        q,
        async (after) =>
          (
            await s.tx.projectDocumentVersion.findMany({
              where: {
                ...projectWhere(s),
                documentId: id,
                ...(after ? { version: { gt: Number(after) } } : {}),
              },
              orderBy: { version: 'asc' },
              take: q.limit + 1,
            })
          ).map((r) => ({
            id: String(r.version),
            ...c.ProjectDocumentVersionSchema.strip().parse({
              ...r,
              createdAt: r.createdAt.toISOString(),
            }),
          })),
      );
      return { ...values, items: values.items.map(({ id: _id, ...r }) => r) };
    });
  }
  comments(
    actor: RequestActor,
    pid: string,
    q: z.infer<typeof c.ProjectContentQuerySchema>,
  ) {
    const t: ContentTarget = { kind: q.targetKind, id: q.targetId };
    return this.op.read(actor, pid, [], contentRequest(t), async (s) => {
      await this.authorize(s, t);
      return this.op.page(
        s,
        'comments:' + executionHash(t),
        q,
        async (after) =>
          (
            await s.tx.projectComment.findMany({
              where: {
                ...projectWhere(s),
                ...contentColumns(t),
                deletedAt: null,
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: 'asc' },
              take: q.limit + 1,
            })
          ).map(comment),
        contentRequest(t),
      );
    });
  }
  createComment(
    actor: RequestActor,
    pid: string,
    input: z.infer<typeof c.ProjectCommentCreateSchema>,
    raw?: string,
  ) {
    const key = executionKey(raw),
      fingerprint = executionHash(input),
      t = input.target;
    return this.op.write(
      actor,
      pid,
      ['comment.create'],
      contentRequest(t),
      'comment.create',
      input.id,
      [],
      async (s) => {
        await this.authorize(s, t);
        const old = await s.tx.projectComment.findFirst({
          where: { ...projectWhere(s), creationKey: key },
        });
        if (old) {
          if (old.id !== input.id || old.fingerprint !== fingerprint)
            throw new ConflictException();
          return comment(old);
        }
        await s.grow('project.comment-version');
        await s.begin();
        const actorId = s.a.require(
          s.tx,
          pid,
          'comment.create',
          contentProof(pid, t),
        ).actorId;
        const row = await s.tx.projectComment.create({
          data: {
            ...projectWhere(s),
            ...contentColumns(t),
            id: input.id,
            body: input.body,
            creationKey: key,
            fingerprint,
            createdByActorId: actorId,
          },
        });
        await s.tx.projectCommentVersion.create({
          data: {
            ...projectWhere(s),
            commentId: row.id,
            revision: 1,
            body: row.body,
            actorId,
          },
        });
        await this.activity(s, t, 'comment.create', row.id);
        return comment(row);
      },
    );
  }
  updateComment(
    actor: RequestActor,
    pid: string,
    id: string,
    t: ContentTarget,
    expected: number,
    input: z.infer<typeof c.ProjectCommentInputSchema> | null,
  ) {
    return this.op.write(
      actor,
      pid,
      ['comment.create'],
      contentRequest(t),
      input ? 'comment.edit' : 'comment.delete',
      id,
      [],
      async (s) => {
        await this.authorize(s, t);
        const row = await s.tx.projectComment.findFirst({
          where: {
            ...projectWhere(s),
            ...contentColumns(t),
            id,
            deletedAt: null,
          },
        });
        if (!row) throw new NotFoundException();
        const actorId = s.a.require(
          s.tx,
          pid,
          'comment.create',
          contentProof(pid, t),
        ).actorId;
        if (row.createdByActorId !== actorId) throw new ForbiddenException();
        matchRevision(row.revision, expected);
        await s.grow('project.comment-version');
        await s.begin();
        const after = await s.tx.projectComment.update({
          where: { id },
          data: {
            body: input?.body ?? row.body,
            deletedAt: input ? null : s.now,
            revision: { increment: 1 },
          },
        });
        await s.tx.projectCommentVersion.create({
          data: {
            ...projectWhere(s),
            commentId: id,
            revision: after.revision,
            body: input?.body ?? null,
            actorId,
          },
        });
        await this.activity(
          s,
          t,
          input ? 'comment.edit' : 'comment.delete',
          id,
        );
        return comment(after);
      },
    );
  }
  activityList(
    actor: RequestActor,
    pid: string,
    q: z.infer<typeof c.ProjectContentQuerySchema>,
  ) {
    const t: ContentTarget = { kind: q.targetKind, id: q.targetId };
    return this.op.read(
      actor,
      pid,
      [],
      contentRequest(t),
      async (s) => {
        await this.authorize(s, t);
        const proof = s.a.require(s.tx, pid, 'task.read', contentProof(pid, t)),
          all = t.kind === 'PROJECT' && !proof.resource,
          files = s.a.has(s.tx, pid, 'file.read', contentProof(pid, t));
        const visible = new Map<string, boolean>();
        return this.op.page(
          s,
          'activity:' + executionHash(t),
          q,
          async (after) => {
            const out: z.infer<typeof c.ProjectActivitySchema>[] = [];
            let position = after;
            while (out.length < q.limit + 1) {
              const rows = await s.tx.projectActivity.findMany({
                where: {
                  ...projectWhere(s),
                  ...(!all ? contentColumns(t) : {}),
                  ...(position ? { id: { gt: position } } : {}),
                  AND: [
                    ...(!files
                      ? [{ NOT: { action: { startsWith: 'file.' } } }]
                      : []),
                    ...(t.kind === 'PROJECT' && proof.resource
                      ? [
                          {
                            OR: [
                              { resourceId: pid },
                              { action: { startsWith: 'comment.' } },
                              { action: { startsWith: 'file.' } },
                            ],
                          },
                        ]
                      : []),
                  ],
                },
                orderBy: { id: 'asc' },
                take: 100,
              });
              for (const row of rows) {
                const parent = contentTarget(row),
                  key = parent.kind + parent.id;
                let allowed = visible.get(key);
                if (allowed === undefined) {
                  try {
                    await this.authorize(s, parent);
                    allowed = true;
                  } catch (error) {
                    if (!(error instanceof NotFoundException)) throw error;
                    allowed = false;
                  }
                  visible.set(key, allowed);
                }
                if (allowed)
                  out.push(
                    c.ProjectActivitySchema.strip().parse({
                      ...row,
                      target: parent,
                      createdAt: row.createdAt.toISOString(),
                    }),
                  );
              }
              if (rows.length < 100) break;
              position = rows.at(-1)!.id;
            }
            return out;
          },
          contentRequest(t),
        );
      },
      ['file.read'],
    );
  }
  commentVersions(
    actor: RequestActor,
    pid: string,
    id: string,
    t: ContentTarget,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.op.read(actor, pid, [], contentRequest(t), async (s) => {
      await this.authorize(s, t);
      const row = await s.tx.projectComment.findFirst({
        where: { ...projectWhere(s), ...contentColumns(t), id },
      });
      if (!row) throw new NotFoundException();
      if (
        row.createdByActorId !==
        s.a.require(s.tx, pid, 'task.read', contentProof(pid, t)).actorId
      )
        throw new ForbiddenException();
      const result = await this.op.page(
        s,
        'comment.versions:' + id,
        q,
        async (after) =>
          (
            await s.tx.projectCommentVersion.findMany({
              where: {
                ...projectWhere(s),
                commentId: id,
                ...(after ? { revision: { gt: Number(after) } } : {}),
              },
              orderBy: { revision: 'asc' },
              take: q.limit + 1,
            })
          ).map((r) => ({
            id: String(r.revision),
            ...c.ProjectCommentVersionSchema.strip().parse({
              ...r,
              createdAt: r.createdAt.toISOString(),
            }),
          })),
        contentRequest(t),
      );
      return { ...result, items: result.items.map(({ id: _id, ...v }) => v) };
    });
  }
}
