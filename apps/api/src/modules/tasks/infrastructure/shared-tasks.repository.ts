import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { Prisma, Task } from '../../../generated/prisma/client.js';
import { SharedAuthority } from '../../spaces/public/index.js';
import { SharedTasks } from '../public/shared-tasks.js';
import { normalizeTitle, transition, history } from '../domain/tasks.js';
const view = (row: Task) =>
  c.SharedTaskSchema.strip().parse({
    ...row,
    description: row.descriptionContent,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  });
@Injectable()
export class SharedTasksRepository extends SharedTasks {
  async read(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    id: string,
  ) {
    a.require(tx, space, 'task.read', { kind: 'TASK', id });
    const row = await tx.task.findFirst({
      where: { id, spaceId: space, scopeId: space, deletedAt: null },
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
    const rows = await tx.task.findMany({
      where: {
        spaceId: space,
        scopeId: space,
        deletedAt: null,
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
    input: z.infer<typeof c.ProjectTaskCreateSchema>,
  ) {
    const access = a.require(tx, space, 'task.create');
    const row = await tx.task.create({
      data: {
        id: input.id,
        spaceId: space,
        scopeId: space,
        createdByUserId: null,
        createdByActorId: access.actorId,
        title: normalizeTitle(input.title),
        descriptionContent: input.description ?? null,
        priority: input.priority,
      },
    });
    await tx.taskChange.create({
      data: {
        spaceId: space,
        scopeId: space,
        actorId: access.actorId,
        actorUserId: null,
        ...history(null, row, 'CREATED', ['title']),
      },
    });
    return view(row);
  }
  async update(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    id: string,
    revision: number,
    input: z.infer<typeof c.ProjectTaskPatchSchema>,
  ) {
    const action =
      input.status === 'DONE' || input.status === 'OPEN'
        ? 'task.complete'
        : 'task.update';
    const access = a.require(tx, space, action, { kind: 'TASK', id });
    if (
      input.title !== undefined ||
      input.description !== undefined ||
      input.priority !== undefined
    )
      a.require(tx, space, 'task.update', { kind: 'TASK', id });
    const before = await tx.task.findFirst({
      where: { id, spaceId: space, scopeId: space, deletedAt: null },
    });
    if (!before) throw new NotFoundException();
    if (before.revision !== revision) throw new ConflictException();
    const now = (
      await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
    )[0]!.now;
    const state =
      input.status === 'DONE'
        ? transition(before, 'complete', now)
        : input.status === 'OPEN'
          ? transition(before, 'reopen', now)
          : input.status
            ? { status: input.status, completedAt: null }
            : {};
    const row = await tx.task.update({
      where: { id },
      data: {
        ...(input.title !== undefined
          ? { title: normalizeTitle(input.title) }
          : {}),
        ...(input.description !== undefined
          ? { descriptionContent: input.description }
          : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...state,
        revision: { increment: 1 },
      },
    });
    await tx.taskChange.create({
      data: {
        spaceId: space,
        scopeId: space,
        actorId: access.actorId,
        actorUserId: null,
        ...history(
          before,
          row,
          input.status === 'DONE'
            ? 'COMPLETED'
            : input.status === 'OPEN'
              ? 'REOPENED'
              : 'UPDATED',
          Object.keys(input) as Array<'title' | 'status' | 'priority'>,
        ),
      },
    });
    return view(row);
  }
}
