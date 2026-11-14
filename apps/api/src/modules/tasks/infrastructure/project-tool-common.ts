import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { Prisma, Task } from '../../../generated/prisma/client.js';
import { Prisma as P } from '../../../generated/prisma/client.js';
import type {
  SharedAuthority,
  SharedKernel,
  SharedRequest,
} from '../../spaces/public/index.js';
import type { TaskToolContext } from '../public/project-tools.js';
import { DependencyRuleError } from '../domain/dependencies.js';
export const scope = (ctx: TaskToolContext) => ({
  spaceId: ctx.spaceId,
  scopeId: ctx.scopeId,
});
export const taskView = (r: Task) =>
  c.SharedTaskSchema.strip().parse({
    ...r,
    description: r.descriptionContent,
    deletedAt: r.deletedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
  });
export function rule<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (
      e instanceof DependencyRuleError &&
      ['DEPENDENCY_CYCLE', 'DEPENDENCY_DUPLICATE'].includes(e.code)
    )
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        details: [{ path: 'dependencies', code: e.code }],
      });
    throw new BadRequestException({
      code: e instanceof Error ? e.message : 'INVALID_TOOL_INPUT',
    });
  }
}
export function revision(actual: number, expected: number) {
  if (actual !== expected)
    throw new ConflictException({ code: 'STALE_REVISION' });
}
export async function source(
  tx: Prisma.TransactionClient,
  a: SharedAuthority,
  ctx: TaskToolContext,
  id: string,
  cap: SharedRequest['capability'] = 'task.read',
) {
  a.require(tx, ctx.spaceId, cap, { kind: 'TASK', id });
  a.require(tx, ctx.spaceId, 'task.read', { kind: 'TASK', id });
  const row = await tx.task.findFirst({
    where: { ...scope(ctx), id, deletedAt: null },
  });
  if (!row) throw new NotFoundException();
  return row;
}
export async function event(
  tx: Prisma.TransactionClient,
  a: SharedAuthority,
  ctx: TaskToolContext,
  task: Task,
  action: string,
  before: unknown,
  after: unknown,
) {
  await tx.taskMetadataEvent.create({
    data: {
      id: randomUUID(),
      ...scope(ctx),
      taskId: task.id,
      actorId: a.require(tx, ctx.spaceId, 'task.read', {
        kind: 'TASK',
        id: task.id,
      }).actorId,
      action,
      sourceRevision: task.revision,
      beforeValue:
        before === null ? P.DbNull : (before as Prisma.InputJsonValue),
      afterValue: after === null ? P.DbNull : (after as Prisma.InputJsonValue),
    },
  });
}
export async function participant(
  kernel: SharedKernel,
  tx: Prisma.TransactionClient,
  ctx: TaskToolContext,
  id: string,
  generation: number,
  caps: SharedRequest['capability'][],
) {
  const user = await kernel.memberUserInTransaction(tx, ctx.spaceId, id);
  if (!user || !ctx.lockedUsers.includes(user)) throw new NotFoundException();
  return kernel.toolParticipant(tx, ctx.spaceId, id, generation, user, caps);
}
