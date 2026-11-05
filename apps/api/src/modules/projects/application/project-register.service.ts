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
const view = (r: ProjectRiskIssue) =>
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
  });
@Injectable()
export class ProjectRegisterService {
  constructor(
    @Inject(ProjectExecutionContext)
    private readonly op: ProjectExecutionContext,
  ) {}
  private async row(s: ExecutionContext, id: string) {
    const row = await s.tx.projectRiskIssue.findFirst({
      where: { ...projectWhere(s), id },
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
        after: view(row),
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
          return view(previous);
        }
        if (input.owner)
          await s.member(input.owner.accessId, input.owner.generation);
        await s.grow('project.risk-issue');
        await s.begin();
        const { owner, ...data } = input,
          row = await s.tx.projectRiskIssue.create({
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
        await this.history(s, row, null);
        return view(row);
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
        const { owner, ...data } = input,
          row = await s.tx.projectRiskIssue.update({
            where: { id },
            data: {
              ...data,
              ownerAccessId: owner?.accessId ?? null,
              ownerGeneration: owner?.generation ?? null,
              revision: { increment: 1 },
            },
          });
        await this.history(s, row, view(old));
        return view(row);
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
        return view(row);
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
