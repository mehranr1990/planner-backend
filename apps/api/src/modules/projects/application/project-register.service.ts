import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import { Prisma as P } from '../../../generated/prisma/client.js';
import type {
  Prisma,
  ProjectRiskIssue,
  ProjectRegisterDetail,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  ProjectExecutionContext,
  projectWhere,
  executionKey,
  executionHash,
  matchRevision,
} from './project-execution-context.js';
import type { ExecutionContext } from './project-execution-context.js';
import { SharedTasks } from '../../tasks/public/index.js';
const view = (
  r: ProjectRiskIssue & { detail?: ProjectRegisterDetail | null },
) =>
  c.ProjectRegisterSchema.parse({
    id: r.id,
    projectId: r.projectId,
    kind: r.kind,
    title: r.title,
    description: r.description,
    severity: r.severity,
    probability: r.probability,
    owner: r.ownerAccessId
      ? { accessId: r.ownerAccessId, generation: r.ownerGeneration }
      : null,
    mitigation: r.mitigation,
    status: r.status,
    revision: r.revision,
    createdByActorId: r.createdByActorId,
    createdAt: r.createdAt.toISOString(),
    retiredAt: r.retiredAt?.toISOString() ?? null,
    code: r.detail?.code ?? null,
    checklist: r.detail?.checklist ?? [],
    ...(r.detail?.closeReason ? { closeReason: r.detail.closeReason } : {}),
    closeNote: r.detail?.closeNote ?? null,
    closedAt: r.detail?.closedAt?.toISOString() ?? null,
    closedByActorId: r.detail?.closedByActorId ?? null,
    convertedIssueId: r.detail?.convertedIssueId ?? null,
    convertedTaskId: r.detail?.convertedTaskId ?? null,
  });
@Injectable()
export class ProjectRegisterService {
  constructor(
    @Inject(ProjectExecutionContext)
    private readonly op: ProjectExecutionContext,
    @Inject(SharedTasks) private readonly tasks: SharedTasks,
  ) {}
  private async detail(
    s: ExecutionContext,
    row: ProjectRiskIssue,
    closeReason?: string,
    closeNote?: string | null,
  ) {
    const max = await s.tx.projectRegisterDetail.aggregate({
        where: { ...projectWhere(s), kind: row.kind },
        _max: { ordinal: true },
      }),
      ordinal = (max._max.ordinal ?? 0) + 1;
    return s.tx.projectRegisterDetail.create({
      data: {
        ...projectWhere(s),
        itemId: row.id,
        kind: row.kind,
        ordinal,
        code: (row.kind === 'RISK' ? 'R-' : 'I-') + ordinal,
        ...(closeReason
          ? {
              closeReason,
              closeNote: closeNote ?? null,
              closedAt: s.now,
              closedByActorId: s.a.require(s.tx, s.pid, 'work.manage').actorId,
            }
          : {}),
      },
    });
  }
  changeChecklist(
    actor: RequestActor,
    pid: string,
    id: string,
    revision: number,
    input: z.infer<typeof c.ProjectChecklistChangeSchema>,
    raw: string | undefined,
  ) {
    const key = executionKey(raw),
      change = c.ProjectChecklistChangeSchema.parse(input);
    return this.op.write(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'register.checklist',
      id,
      [],
      async (s) => {
        await this.op.kernel.receipt(
          s.tx,
          s.a,
          { spaceId: s.spaceId, scopeId: s.scopeId, capability: 'work.manage' },
          {
            operation: 'project.risk.checklist',
            key,
            fingerprint: executionHash({ id, revision, change }),
          },
          async () => {
            const old = await this.row(s, id);
            matchRevision(old.revision, revision);
            if (old.retiredAt) throw new ConflictException();
            let items = c.ProjectRegisterSchema.shape.checklist
              .unwrap()
              .parse(old.detail?.checklist ?? []);
            if (change.kind === 'ADD') {
              if (items.length >= 100 || items.some((i) => i.id === change.id))
                throw new ConflictException();
              items.push({
                id: change.id,
                title: change.title,
                completed: false,
                position: items.length,
              });
            } else if (change.kind === 'REORDER') {
              if (
                change.ids.length !== items.length ||
                new Set(change.ids).size !== items.length ||
                items.some((i) => !change.ids.includes(i.id))
              )
                throw new ConflictException();
              items = change.ids.map((id, position) => ({
                ...items.find((i) => i.id === id)!,
                position,
              }));
            } else {
              const item = items.find((i) => i.id === change.id);
              if (!item) throw new NotFoundException();
              if (change.kind === 'DELETE')
                items = items.filter((i) => i.id !== change.id);
              else {
                if (change.title !== undefined) item.title = change.title;
                if (change.completed !== undefined)
                  item.completed = change.completed;
              }
            }
            await s.begin();
            await s.tx.projectRegisterDetail.update({
              where: { itemId: id },
              data: { checklist: items },
            });
            const updated = await s.tx.projectRiskIssue.update({
              where: { id },
              data: { revision: { increment: 1 } },
            });
            await this.history(s, updated, view(old));
            return { id, statusCode: 200 };
          },
        );
        return view(await this.row(s, id));
      },
    );
  }
  close(
    actor: RequestActor,
    pid: string,
    id: string,
    revision: number,
    input: z.infer<typeof c.ProjectRiskCloseSchema>,
  ) {
    return this.op.write(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'register.close',
      id,
      [],
      async (s) => {
        const old = await this.row(s, id);
        matchRevision(old.revision, revision);
        if (old.retiredAt || ['RESOLVED', 'CLOSED'].includes(old.status))
          throw new ConflictException();
        await s.begin();
        await s.tx.projectRegisterDetail.update({
          where: { itemId: id },
          data: {
            closeReason: input.reason,
            closeNote: input.note ?? null,
            closedAt: s.now,
            closedByActorId: s.a.require(s.tx, pid, 'work.manage').actorId,
          },
        });
        const row = await s.tx.projectRiskIssue.update({
          where: { id },
          data: { status: 'CLOSED', revision: { increment: 1 } },
        });
        await this.history(s, row, view(old));
        return view(await this.row(s, id));
      },
    );
  }
  convert(
    actor: RequestActor,
    pid: string,
    id: string,
    revision: number,
    input: z.infer<typeof c.ProjectRiskConvertSchema>,
    raw: string | undefined,
  ) {
    const key = executionKey(raw);
    return this.op.write(
      actor,
      pid,
      input.targetKind === 'TASK'
        ? ['work.manage', 'task.create']
        : ['work.manage'],
      undefined,
      'register.convert',
      id,
      [],
      async (s) => {
        await this.op.kernel.receipt(
          s.tx,
          s.a,
          { spaceId: s.spaceId, scopeId: s.scopeId, capability: 'work.manage' },
          {
            operation: 'project.risk.convert',
            key,
            fingerprint: executionHash({ id, revision, input }),
          },
          async () => {
            const old = await this.row(s, id);
            matchRevision(old.revision, revision);
            if (
              old.kind !== 'RISK' ||
              old.retiredAt ||
              old.detail?.convertedIssueId ||
              old.detail?.convertedTaskId
            )
              throw new ConflictException({
                code: 'RISK_ALREADY_CONVERTED_OR_UNAVAILABLE',
              });
            await s.begin();
            if (input.targetKind === 'TASK') {
              await s.grow('task.shared');
              await this.tasks.create(s.tx, s.a, pid, {
                id: input.id,
                title: old.title,
                description: old.description,
                priority: 'NONE',
              });
              await s.tx.projectTask.create({
                data: { ...projectWhere(s), taskId: input.id },
              });
            } else {
              await s.grow('project.risk-issue');
              const target = await s.tx.projectRiskIssue.create({
                data: {
                  ...projectWhere(s),
                  id: input.id,
                  kind: 'ISSUE',
                  title: old.title,
                  description: old.description,
                  severity: old.severity,
                  probability: null,
                  ownerAccessId: null,
                  ownerGeneration: null,
                  mitigation: old.mitigation,
                  status: 'OPEN',
                  createdByActorId: s.a.require(s.tx, pid, 'work.manage')
                    .actorId,
                  creationKey: executionHash({ key, target: input.id }),
                  fingerprint: executionHash({ id, input }),
                },
              });
              await this.detail(s, target);
              await this.history(s, target, null);
            }
            await s.tx.projectRegisterDetail.update({
              where: { itemId: id },
              data:
                input.targetKind === 'TASK'
                  ? { convertedTaskId: input.id }
                  : { convertedIssueId: input.id },
            });
            const updated = await s.tx.projectRiskIssue.update({
              where: { id },
              data: { revision: { increment: 1 } },
            });
            await this.history(s, updated, view(old));
            return { id, statusCode: 200 };
          },
        );
        return view(await this.row(s, id));
      },
    );
  }
  private async row(s: ExecutionContext, id: string) {
    const row = await s.tx.projectRiskIssue.findFirst({
      where: { ...projectWhere(s), id },
      include: { detail: true },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async history(
    s: ExecutionContext,
    row: ProjectRiskIssue,
    before: unknown,
  ) {
    await s.tx.projectRiskIssueEvent.create({
      data: {
        id: randomUUID(),
        ...projectWhere(s),
        itemId: row.id,
        actorId: s.a.require(s.tx, s.pid, 'work.manage').actorId,
        revision: row.revision,
        before: before === null ? P.DbNull : (before as Prisma.InputJsonValue),
        after: view(await this.row(s, row.id)),
      },
    });
  }
  list(
    actor: RequestActor,
    pid: string,
    q: z.infer<typeof c.ProjectRegisterQuerySchema>,
  ) {
    const { after: _after, ...filter } = q;
    return this.op.read(actor, pid, [], undefined, (s) =>
      this.op.page(
        s,
        'register:' + executionHash(filter).slice(0, 24),
        q,
        async (after) =>
          (
            await s.tx.projectRiskIssue.findMany({
              where: {
                ...projectWhere(s),
                retiredAt: null,
                ...(q.kind ? { kind: q.kind } : {}),
                ...(q.status ? { status: q.status } : {}),
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: 'asc' },
              take: q.limit + 1,
              include: { detail: true },
            })
          ).map(view),
      ),
    );
  }
  get(actor: RequestActor, pid: string, id: string) {
    return this.op.read(actor, pid, [], undefined, async (s) =>
      view(await this.row(s, id)),
    );
  }
  create(
    actor: RequestActor,
    pid: string,
    input: z.infer<typeof c.ProjectRegisterCreateSchema>,
    raw: string | undefined,
  ) {
    const creationKey = executionKey(raw),
      fingerprint = executionHash(input);
    return this.op.write(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'register.create',
      input.id,
      input.owner ? [input.owner.accessId] : [],
      async (s) => {
        const previous = await s.tx.projectRiskIssue.findFirst({
          where: { ...projectWhere(s), creationKey },
        });
        if (previous) {
          if (previous.id !== input.id || previous.fingerprint !== fingerprint)
            throw new ConflictException();
          return view(await this.row(s, previous.id));
        }
        if (input.owner)
          await s.member(input.owner.accessId, input.owner.generation);
        await s.grow('project.risk-issue');
        await s.begin();
        const { owner, closeReason, closeNote, ...data } = input;
        if (['CLOSED', 'RESOLVED'].includes(data.status) && !closeReason)
          throw new ConflictException({ code: 'RISK_CLOSE_REASON_REQUIRED' });
        const row = await s.tx.projectRiskIssue.create({
          data: {
            ...projectWhere(s),
            ...data,
            ownerAccessId: owner?.accessId ?? null,
            ownerGeneration: owner?.generation ?? null,
            createdByActorId: s.a.require(s.tx, pid, 'work.manage').actorId,
            creationKey,
            fingerprint,
          },
        });
        await this.detail(s, row, closeReason, closeNote);
        await this.history(s, row, null);
        return view(await this.row(s, row.id));
      },
    );
  }
  update(
    actor: RequestActor,
    pid: string,
    id: string,
    revision: number,
    input: z.infer<typeof c.ProjectRegisterInputSchema>,
  ) {
    return this.op.write(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'register.update',
      id,
      input.owner ? [input.owner.accessId] : [],
      async (s) => {
        const old = await this.row(s, id);
        if (old.retiredAt || old.kind !== input.kind)
          throw new ConflictException();
        matchRevision(old.revision, revision);
        if (input.owner)
          await s.member(input.owner.accessId, input.owner.generation);
        await s.begin();
        const { owner, closeReason, closeNote, ...data } = input;
        const closing = ['CLOSED', 'RESOLVED'].includes(input.status),
          wasClosed = ['CLOSED', 'RESOLVED'].includes(old.status);
        if (closing && !wasClosed && !closeReason)
          throw new ConflictException({ code: 'RISK_CLOSE_REASON_REQUIRED' });
        const row = await s.tx.projectRiskIssue.update({
          where: { id },
          data: {
            ...data,
            ownerAccessId: owner?.accessId ?? null,
            ownerGeneration: owner?.generation ?? null,
            revision: { increment: 1 },
          },
        });
        await s.tx.projectRegisterDetail.update({
          where: { itemId: id },
          data: closing
            ? {
                ...(closeReason ? { closeReason } : {}),
                ...(closeNote !== undefined ? { closeNote } : {}),
                ...(!wasClosed
                  ? {
                      closedAt: s.now,
                      closedByActorId: s.a.require(s.tx, pid, 'work.manage')
                        .actorId,
                    }
                  : {}),
              }
            : {
                closeReason: null,
                closeNote: null,
                closedAt: null,
                closedByActorId: null,
              },
        });
        await this.history(s, row, view(old));
        return view(await this.row(s, id));
      },
    );
  }
  retire(actor: RequestActor, pid: string, id: string, revision: number) {
    return this.op.write(
      actor,
      pid,
      ['work.manage'],
      undefined,
      'register.retire',
      id,
      [],
      async (s) => {
        const old = await this.row(s, id);
        if (old.retiredAt) return view(old);
        matchRevision(old.revision, revision);
        await s.begin();
        const row = await s.tx.projectRiskIssue.update({
          where: { id },
          data: { retiredAt: s.now, revision: { increment: 1 } },
        });
        await this.history(s, row, view(old));
        return view(await this.row(s, id));
      },
    );
  }
  events(
    actor: RequestActor,
    pid: string,
    id: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    return this.op.read(actor, pid, [], undefined, async (s) => {
      await this.row(s, id);
      return this.op.page(s, 'register-history:' + id, q, async (after) =>
        (
          await s.tx.projectRiskIssueEvent.findMany({
            where: {
              ...projectWhere(s),
              itemId: id,
              ...(after ? { id: { gt: after } } : {}),
            },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          })
        ).map((r) =>
          c.ProjectRegisterEventSchema.strip().parse({
            ...r,
            createdAt: r.createdAt.toISOString(),
          }),
        ),
      );
    });
  }
}
