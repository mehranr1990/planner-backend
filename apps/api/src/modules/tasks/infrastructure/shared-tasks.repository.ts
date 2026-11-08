import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { Prisma, Task } from '../../../generated/prisma/client.js';
import { SharedAuthority } from '../../spaces/public/index.js';
import { SharedTasks } from '../public/shared-tasks.js';
import { normalizeTitle, transition, history } from '../domain/tasks.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import {
  legacyWorkflowGuard,
  dependencyScheduleGuard,
} from './task-tool-guards.js';
const view = (row: Task) =>
  c.SharedTaskSchema.strip().parse({
    ...row,
    description: row.descriptionContent,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  });
const scheduleView = (r: Task) =>
  c.SharedTaskScheduleSchema.parse({
    id: r.id,
    revision: r.revision,
    plannedStartAt: r.plannedStartAt?.toISOString() ?? null,
    dueAt: r.dueAt?.toISOString() ?? null,
    scheduledDate: r.scheduledDate?.toISOString().slice(0, 10) ?? null,
  });
@Injectable()
export class SharedTasksRepository extends SharedTasks {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {
    super();
  }
  hint(id: string, spaceId: string) {
    return this.location(this.db.client, id, spaceId);
  }
  async location(tx: Prisma.TransactionClient, id: string, spaceId: string) {
    const row = await tx.task.findFirst({
      where: { id, spaceId, deletedAt: null, scopeId: { not: null } },
      select: { spaceId: true, scopeId: true },
    });
    if (!row?.scopeId) throw new NotFoundException();
    return { spaceId: row.spaceId, scopeId: row.scopeId };
  }
  async schedule(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    id: string,
    input?: {
      revision: number;
      value: z.infer<typeof c.SharedTaskScheduleInputSchema>;
    },
  ) {
    const access = a.require(tx, space, input ? 'task.update' : 'task.read', {
      kind: 'TASK',
      id,
    });
    a.require(tx, space, 'task.read', { kind: 'TASK', id });
    const before = await tx.task.findFirst({
      where: {
        id,
        spaceId: a.space(tx, space),
        scopeId: a.scope(tx, space),
        deletedAt: null,
      },
    });
    if (!before) throw new NotFoundException();
    if (!input) return scheduleView(before);
    if (before.revision !== input.revision) throw new ConflictException();
    await dependencyScheduleGuard(tx, before, {
      plannedStartAt: input.value.plannedStartAt
        ? new Date(input.value.plannedStartAt)
        : null,
      dueAt: input.value.dueAt ? new Date(input.value.dueAt) : null,
      scheduledDate: input.value.scheduledDate,
    });
    const row = await tx.task.update({
      where: { id },
      data: {
        plannedStartAt: input.value.plannedStartAt
          ? new Date(input.value.plannedStartAt)
          : null,
        dueAt: input.value.dueAt ? new Date(input.value.dueAt) : null,
        scheduledDate: input.value.scheduledDate
          ? new Date(input.value.scheduledDate + 'T00:00:00Z')
          : null,
        revision: { increment: 1 },
      },
    });
    await tx.taskChange.create({
      data: {
        spaceId: a.space(tx, space),
        scopeId: a.scope(tx, space),
        actorId: access.actorId,
        actorUserId: null,
        ...history(before, row, 'UPDATED', [
          'plannedStartAt',
          'dueAt',
          'scheduledDate',
        ]),
      },
    });
    return scheduleView(row);
  }
  async project(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    sources: { spaceId: string; scopeId?: string; id: string }[],
    q: {
      after?: string;
      limit: number;
      status?: z.infer<typeof c.SharedTaskSchema>['status'];
      range?: { from: string; to: string; timezone: string };
    },
  ) {
    for (const s of sources)
      a.require(
        tx,
        s.spaceId,
        'task.read',
        { kind: 'TASK', id: s.id },
        s.scopeId ?? s.spaceId,
      );
    if (!sources.length) return [];
    const output: Task[] = [];
    let after = q.after;
    const format = q.range
      ? new Intl.DateTimeFormat('en-CA', {
          timeZone: q.range.timezone,
          calendar: 'iso8601',
          numberingSystem: 'latn',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
      : null;
    const bounds = q.range
      ? {
          gte: new Date(Date.parse(q.range.from) - 2 * 86400000),
          lt: new Date(Date.parse(q.range.to) + 2 * 86400000),
        }
      : null;
    while (output.length < q.limit) {
      const rows = await tx.task.findMany({
        where: {
          OR: sources.map((s) => ({
            id: s.id,
            spaceId: s.spaceId,
            scopeId: s.scopeId ?? s.spaceId,
          })),
          deletedAt: null,
          ...(after ? { id: { gt: after } } : {}),
          ...(q.status ? { status: q.status } : {}),
          ...(bounds
            ? {
                AND: [
                  {
                    OR: [
                      { plannedStartAt: bounds },
                      { plannedStartAt: null, dueAt: bounds },
                      {
                        plannedStartAt: null,
                        dueAt: null,
                        scheduledDate: {
                          gte: new Date(q.range!.from),
                          lt: new Date(q.range!.to),
                        },
                      },
                    ],
                  },
                ],
              }
            : {}),
        },
        orderBy: { id: 'asc' },
        take: q.limit,
      });
      for (const row of rows) {
        if (format) {
          const instant = row.plannedStartAt ?? row.dueAt;
          const parts = instant
            ? Object.fromEntries(
                format.formatToParts(instant).map((p) => [p.type, p.value]),
              )
            : null;
          const date = parts
            ? `${parts.year}-${parts.month}-${parts.day}`
            : row.scheduledDate?.toISOString().slice(0, 10);
          if (!date || date < q.range!.from || date >= q.range!.to) continue;
        }
        output.push(row);
        if (output.length === q.limit) break;
      }
      if (rows.length < q.limit) break;
      after = rows.at(-1)!.id;
    }
    return output.map((r) => ({ task: view(r), schedule: scheduleView(r) }));
  }
  async read(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    id: string,
  ) {
    a.require(tx, space, 'task.read', { kind: 'TASK', id });
    const row = await tx.task.findFirst({
      where: {
        id,
        spaceId: a.space(tx, space),
        scopeId: a.scope(tx, space),
        deletedAt: null,
      },
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
        spaceId: a.space(tx, space),
        scopeId: a.scope(tx, space),
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
        spaceId: a.space(tx, space),
        scopeId: a.scope(tx, space),
        createdByUserId: null,
        createdByActorId: access.actorId,
        title: normalizeTitle(input.title),
        descriptionContent: input.description ?? null,
        priority: input.priority,
      },
    });
    await tx.taskChange.create({
      data: {
        spaceId: a.space(tx, space),
        scopeId: a.scope(tx, space),
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
      where: {
        id,
        spaceId: a.space(tx, space),
        scopeId: a.scope(tx, space),
        deletedAt: null,
      },
    });
    if (!before) throw new NotFoundException();
    if (before.revision !== revision) throw new ConflictException();
    if (input.status) await legacyWorkflowGuard(tx, a, before, input.status);
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
        spaceId: a.space(tx, space),
        scopeId: a.scope(tx, space),
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
