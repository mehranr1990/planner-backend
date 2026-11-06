import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { Prisma, Goal } from '../../../generated/prisma/client.js';
import { SharedAuthority } from '../../spaces/public/index.js';
import { SharedGoals } from '../public/shared-goals.js';
import { calculate } from '../domain/progress.js';
const view = (row: Goal) =>
  c.SharedGoalSchema.strip().parse({
    ...row,
    manualProgress: row.manualProgress.toString(),
  });
@Injectable()
export class SharedGoalsRepository extends SharedGoals {
  async scopeCount(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
  ) {
    a.require(tx, spaceId, 'task.read');
    return tx.goal.count({ where: { spaceId, scopeId: spaceId } });
  }
  async project(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    sources: { spaceId: string; id: string }[],
    q: {
      after?: string;
      limit: number;
      status?: z.infer<typeof c.SharedGoalSchema>['status'];
    },
  ) {
    for (const s of sources)
      a.require(tx, s.spaceId, 'task.read', { kind: 'GOAL', id: s.id });
    if (!sources.length) return [];
    return (
      await tx.goal.findMany({
        where: {
          OR: sources.map((s) => ({
            id: s.id,
            spaceId: s.spaceId,
            scopeId: s.spaceId,
          })),
          ...(q.after ? { id: { gt: q.after } } : {}),
          ...(q.status ? { status: q.status } : {}),
        },
        orderBy: { id: 'asc' },
        take: q.limit,
      })
    ).map(view);
  }
  async read(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    id: string,
  ) {
    a.require(tx, space, 'task.read', { kind: 'GOAL', id });
    const row = await tx.goal.findFirst({
      where: { id, spaceId: space, scopeId: space },
    });
    if (!row) throw new NotFoundException();
    return view(row);
  }
  async list(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    q: z.infer<typeof c.ProjectPageQuerySchema>,
  ) {
    a.require(tx, space, 'task.read');
    const rows = await tx.goal.findMany({
      where: {
        spaceId: space,
        scopeId: space,
        ...(q.after ? { id: { gt: q.after } } : {}),
      },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
    });
    return {
      items: rows.slice(0, q.limit).map(view),
      nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
    };
  }
  async create(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    input: z.infer<typeof c.ProjectGoalCreateSchema>,
  ) {
    const access = a.require(tx, space, 'goal.manage');
    return view(
      await tx.goal.create({
        data: {
          id: input.id,
          spaceId: space,
          scopeId: space,
          createdByUserId: null,
          createdByActorId: access.actorId,
          title: input.title,
          description: input.description ?? null,
          horizon: input.horizon,
          timezone: input.timezone,
          progressMode: 'MANUAL',
        },
      }),
    );
  }
  async update(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    id: string,
    revision: number,
    input: z.infer<typeof c.ProjectGoalPatchSchema>,
  ) {
    a.require(tx, space, 'goal.manage', { kind: 'GOAL', id });
    const before = await tx.goal.findFirst({
      where: { id, spaceId: space, scopeId: space },
    });
    if (!before) throw new NotFoundException();
    if (before.revision !== revision) throw new ConflictException();
    return view(
      await tx.goal.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.horizon !== undefined ? { horizon: input.horizon } : {}),
          ...(input.manualProgress !== undefined
            ? {
                manualProgress: calculate('MANUAL', input.manualProgress, [])
                  .percentage,
              }
            : {}),
          revision: { increment: 1 },
        },
      }),
    );
  }
  async linkTask(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    goalId: string,
    taskId: string,
    revision: number,
    sourceRevision: number,
  ) {
    a.require(tx, space, 'goal.manage');
    a.require(tx, space, 'task.read', { kind: 'TASK', id: taskId });
    const goal = await tx.goal.findFirst({
      where: { id: goalId, spaceId: space, scopeId: space },
    });
    if (!goal) throw new NotFoundException();
    if (goal.revision !== revision) throw new ConflictException();
    await tx.goalTaskLink.upsert({
      where: { goalId_taskId: { goalId, taskId } },
      create: {
        spaceId: space,
        goalId,
        taskId,
        selectedSourceRevision: sourceRevision,
      },
      update: {},
    });
    await tx.goal.update({
      where: { id: goalId },
      data: { revision: { increment: 1 } },
    });
  }
}
