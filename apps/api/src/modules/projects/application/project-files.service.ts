import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { StoredFile } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import { SharedFiles } from '../../../platform/storage/public/index.js';
import type { SharedFileScope } from '../../../platform/storage/public/index.js';
import {
  ProjectContentService,
  contentColumns,
  contentTarget,
  contentRequest,
  contentProof,
} from './project-content.service.js';
import type { ContentTarget } from './project-content.service.js';
import {
  projectWhere,
  executionKey,
  executionHash,
} from './project-execution-context.js';
import type { ExecutionContext } from './project-execution-context.js';
const writeCap = (t: ContentTarget) =>
  t.kind === 'TASK'
    ? 'task.update'
    : t.kind === 'GOAL'
      ? 'goal.manage'
      : 'work.manage';
@Injectable()
export class ProjectFilesService {
  private readonly active = new Map<
    string,
    { abort: AbortController; finished: Promise<void> }
  >();
  constructor(
    @Inject(ProjectContentService)
    private readonly content: ProjectContentService,
    @Inject(SharedFiles) private readonly files: SharedFiles,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  private scope(s: ExecutionContext, t: ContentTarget): SharedFileScope {
    const target = contentProof(s.pid, t),
      actorId = s.a.require(s.tx, s.pid, 'file.read', target).actorId;
    return {
      spaceId: s.pid,
      scopeId: s.pid,
      actorId,
      verify: (tx, write) => {
        s.a.require(tx, s.pid, 'task.read', target);
        s.a.require(tx, s.pid, 'file.read', target);
        if (write) s.a.require(tx, s.pid, writeCap(t), target);
      },
    };
  }
  private async row(s: ExecutionContext, id: string, t: ContentTarget) {
    await this.content.authorize(s, t);
    const row = await s.tx.projectFile.findFirst({
      where: { ...projectWhere(s), ...contentColumns(t), fileId: id },
    });
    if (!row) throw new NotFoundException();
    return this.files.row(s.tx, this.scope(s, t), id);
  }
  private view(pid: string, t: ContentTarget, r: StoredFile) {
    return c.ProjectFileSchema.parse({
      id: r.id,
      projectId: pid,
      target: t,
      filename: r.filename,
      mimeType: r.mimeType,
      expectedSize: r.expectedSize,
      actualSize: r.actualSize,
      sha256: r.sha256,
      status: r.status,
      revision: r.revision,
      createdAt: r.createdAt.toISOString(),
      uploadExpiresAt: r.uploadExpiresAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    });
  }
  list(
    actor: RequestActor,
    pid: string,
    q: z.infer<typeof c.ProjectContentQuerySchema>,
  ) {
    const t: ContentTarget = { kind: q.targetKind, id: q.targetId };
    return this.content.op.read(
      actor,
      pid,
      ['file.read'],
      contentRequest(t),
      async (s) => {
        await this.content.authorize(s, t);
        return this.content.op.page(
          s,
          'files:' + executionHash(t),
          q,
          async (after) => {
            const visible: StoredFile[] = [];
            let position = after;
            while (visible.length < q.limit + 1) {
              const links = await s.tx.projectFile.findMany({
                where: {
                  ...projectWhere(s),
                  ...contentColumns(t),
                  ...(position ? { fileId: { gt: position } } : {}),
                },
                orderBy: { fileId: 'asc' },
                take: 100,
              });
              if (!links.length) break;
              visible.push(
                ...(await this.files.describeMany(
                  s.tx,
                  this.scope(s, t),
                  links.map((r) => r.fileId),
                )),
              );
              if (links.length < 100) break;
              position = links.at(-1)!.fileId;
            }
            return visible.map((r) => this.view(pid, t, r));
          },
          contentRequest(t),
        );
      },
    );
  }
  async exportMetadata(
    s: ExecutionContext,
    visible: { tasks: string[]; goals: string[]; documents: string[] },
    accept: (row: z.infer<typeof c.ProjectFileSchema>) => void,
  ) {
    s.a.require(s.tx, s.pid, 'export.visible');
    const out: z.infer<typeof c.ProjectFileSchema>[] = [];
    let after: string | undefined;
    for (;;) {
      const links = await s.tx.projectFile.findMany({
        where: {
          ...projectWhere(s),
          ...(after ? { fileId: { gt: after } } : {}),
          OR: [
            { taskId: null, goalId: null, documentId: null },
            { taskId: { in: visible.tasks } },
            { goalId: { in: visible.goals } },
            { documentId: { in: visible.documents } },
          ],
        },
        orderBy: { fileId: 'asc' },
        take: 100,
      });
      const rows = await this.files.describeMany(
        s.tx,
        this.scope(s, { kind: 'PROJECT', id: s.pid }),
        links.map((r) => r.fileId),
      );
      for (const row of rows) {
        const value = this.view(
          s.pid,
          contentTarget(links.find((l) => l.fileId === row.id)!),
          row,
        );
        accept(value);
        out.push(value);
      }
      if (links.length < 100) return out;
      after = links.at(-1)!.fileId;
    }
  }
  get(actor: RequestActor, pid: string, id: string, t: ContentTarget) {
    return this.content.op.read(
      actor,
      pid,
      ['file.read'],
      contentRequest(t),
      async (s) => {
        const row = await this.row(s, id, t);
        if (row.status === 'DELETED') throw new NotFoundException();
        return this.view(pid, t, row);
      },
    );
  }
  async reconcile(actor: RequestActor, pid: string) {
    const t: ContentTarget = { kind: 'PROJECT', id: pid },
      op = this.content.op,
      rows = await op.write(
        actor,
        pid,
        ['file.read', 'work.manage'],
        undefined,
        'file.reconcile',
        pid,
        [],
        async (s) => {
          if (
            !(await this.files.reconcile(s.tx, this.scope(s, t), s.now, false))
              .length
          )
            return [];
          await s.begin();
          return this.files.reconcile(s.tx, this.scope(s, t), s.now, true);
        },
      );
    let cleaned = 0;
    for (const row of rows) {
      const active = this.active.get(row.id);
      if (active) {
        active.abort.abort();
        await active.finished;
      }
      await this.files.remove(row);
      await op.write(
        actor,
        pid,
        ['file.read', 'work.manage'],
        undefined,
        'file.cleanup',
        row.id,
        [],
        async (s) => {
          await s.begin();
          await this.files.cleanupFinished(
            s.tx,
            this.scope(s, t),
            row.id,
            row.uploadAttemptId,
          );
        },
      );
      cleaned++;
    }
    return { cleaned };
  }
  initiate(
    actor: RequestActor,
    pid: string,
    input: z.infer<typeof c.ProjectFileCreateSchema>,
    raw?: string,
  ) {
    const t = input.target,
      key = executionKey(raw),
      fingerprint = executionHash(input);
    return this.content.op.write(
      actor,
      pid,
      ['file.read', writeCap(t)],
      contentRequest(t),
      'file.initiate',
      input.id,
      [],
      async (s) => {
        await this.content.authorize(s, t);
        const previous = await s.tx.projectFile.findFirst({
          where: { ...projectWhere(s), creationKey: key },
        });
        if (previous) {
          if (
            previous.fileId !== input.id ||
            previous.fingerprint !== fingerprint ||
            executionHash(contentTarget(previous)) !== executionHash(t)
          )
            throw new ConflictException();
          return this.view(
            pid,
            t,
            await this.files.row(s.tx, this.scope(s, t), previous.fileId),
          );
        }
        await s.grow('file.shared');
        await s.begin();
        const file = await this.files.initiate(
          s.tx,
          this.scope(s, t),
          input.id,
          input,
          s.now,
        );
        await s.tx.projectFile.create({
          data: {
            ...projectWhere(s),
            ...contentColumns(t),
            fileId: file.id,
            creationKey: key,
            fingerprint,
          },
        });
        await this.content.activity(s, t, 'file.initiate', file.id);
        return this.view(pid, t, file);
      },
    );
  }
  async complete(
    actor: RequestActor,
    pid: string,
    id: string,
    t: ContentTarget,
    source: Readable,
    length?: string,
  ) {
    const op = this.content.op,
      ticket = await op.write(
        actor,
        pid,
        ['file.read', writeCap(t)],
        contentRequest(t),
        'file.claim',
        id,
        [],
        async (s) => {
          await this.row(s, id, t);
          await s.begin();
          return this.files.claim(s.tx, this.scope(s, t), id, s.now);
        },
      );
    const abort = new AbortController(),
      timer = setTimeout(
        () => abort.abort(),
        this.config.FILE_UPLOAD_TIMEOUT_MS,
      );
    timer.unref();
    let done!: () => void;
    const active = {
      abort,
      finished: new Promise<void>((resolve) => {
        done = resolve;
      }),
    };
    this.active.set(id, active);
    try {
      const evidence = await this.files.write(
        ticket,
        source,
        length,
        abort.signal,
      );
      return await op.write(
        actor,
        pid,
        ['file.read', writeCap(t)],
        contentRequest(t),
        'file.finalize',
        id,
        [],
        async (s) => {
          await this.row(s, id, t);
          await s.begin();
          const file = await this.files.ready(
            s.tx,
            this.scope(s, t),
            ticket,
            evidence,
            s.now,
          );
          await this.content.activity(s, t, 'file.ready', id);
          return this.view(pid, t, file);
        },
      );
    } catch (error) {
      // Reauthorize rejection. Ambiguous DB outcomes or revoked access retain private bytes/markers for maintenance.
      const rejected = await op
        .write(
          actor,
          pid,
          ['file.read', writeCap(t)],
          contentRequest(t),
          'file.reject',
          id,
          [],
          async (s) => {
            await this.row(s, id, t);
            await s.begin();
            return this.files.reject(
              s.tx,
              this.scope(s, t),
              id,
              ticket.attempt,
            );
          },
        )
        .catch(() => null);
      if (rejected) {
        try {
          await this.files.remove(rejected);
          await op.write(
            actor,
            pid,
            ['file.read', writeCap(t)],
            contentRequest(t),
            'file.cleanup',
            id,
            [],
            async (s) => {
              await this.row(s, id, t);
              await s.begin();
              await this.files.cleanupFinished(
                s.tx,
                this.scope(s, t),
                id,
                ticket.attempt,
              );
            },
          );
        } catch {
          /* Durable marker remains authoritative. */
        }
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (this.active.get(id) === active) this.active.delete(id);
      done();
    }
  }
  async download(
    actor: RequestActor,
    pid: string,
    id: string,
    t: ContentTarget,
  ) {
    const file = await this.content.op.read(
        actor,
        pid,
        ['file.read'],
        contentRequest(t),
        (s) => this.row(s, id, t),
      ),
      stream = await this.files.open(file);
    try {
      const current = await this.content.op.read(
        actor,
        pid,
        ['file.read'],
        contentRequest(t),
        async (s) => {
          const row = await this.row(s, id, t);
          if (row.status !== 'READY' || row.revision !== file.revision)
            throw new NotFoundException();
          await this.content.op.kernel.auditFileRead(
            s.tx,
            s.a,
            actor,
            pid,
            contentProof(pid, t),
            id,
          );
          return row;
        },
      );
      return { file: this.view(pid, t, current), stream };
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }
  retryComplete(
    actor: RequestActor,
    pid: string,
    id: string,
    t: ContentTarget,
  ) {
    return this.content.op.read(
      actor,
      pid,
      ['file.read', writeCap(t)],
      contentRequest(t),
      async (s) => {
        const row = await this.row(s, id, t);
        if (
          row.status !== 'READY' ||
          row.createdByActorId !== this.scope(s, t).actorId
        )
          throw new ConflictException();
        return this.view(pid, t, row);
      },
    );
  }
  async delete(
    actor: RequestActor,
    pid: string,
    id: string,
    t: ContentTarget,
    revision: number,
  ) {
    const op = this.content.op,
      row = await op.write(
        actor,
        pid,
        ['file.read', writeCap(t)],
        contentRequest(t),
        'file.delete',
        id,
        [],
        async (s) => {
          await this.row(s, id, t);
          await s.begin();
          const row = await this.files.deleted(
            s.tx,
            this.scope(s, t),
            id,
            revision,
            s.now,
          );
          await this.content.activity(s, t, 'file.delete', id);
          return row;
        },
      );
    const active = this.active.get(id);
    if (active) {
      active.abort.abort();
      await active.finished;
    }
    await this.files.remove(row);
    // A different process may still publish its claimed attempt. Keep its marker until stale reconciliation.
    if (!row.uploadAttemptId)
      await op.write(
        actor,
        pid,
        ['file.read', writeCap(t)],
        contentRequest(t),
        'file.cleanup',
        id,
        [],
        async (s) => {
          await this.row(s, id, t);
          await s.begin();
          await this.files.cleanupFinished(s.tx, this.scope(s, t), id, null);
        },
      );
    return this.view(pid, t, row);
  }
}
