import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
import type { TaskToolContext } from './project-tools.js';
export abstract class SharedTaskWork {
  abstract scopeMetrics(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
  ): Promise<z.infer<typeof c.ProjectTaskMetricSchema>[]>;
  abstract estimate(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    id: string,
    input?: { revision: number; estimatedMinutes: number | null },
  ): Promise<z.infer<typeof c.SharedEstimateSchema>>;
  abstract metrics(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
    ids: string[],
  ): Promise<z.infer<typeof c.ProjectTaskMetricSchema>[]>;
  abstract validate(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    operations: z.infer<typeof c.ProjectChangeOperationSchema>[],
  ): Promise<void>;
  abstract logs(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    after: string | undefined,
    limit: number,
  ): Promise<z.infer<typeof c.SharedWorkLogSchema>[]>;
  abstract record(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    sourceRevision: number,
    input: z.infer<typeof c.SharedWorkLogCreateSchema>,
    key: string,
    fingerprint: string,
  ): Promise<z.infer<typeof c.SharedWorkLogSchema>>;
  abstract void(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    id: string,
    revision: number,
    now: Date,
  ): Promise<z.infer<typeof c.SharedWorkLogSchema>>;
  abstract effort(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
    ids: string[],
    from: Date,
    to: Date,
  ): Promise<{ startedAt: Date; endedAt: Date; voidedAt: Date | null }[]>;
  /** Non-voided work logs with their Task and member admission (actual observations only). */
  abstract taskEffort(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
    ids: string[],
    from: Date,
    to: Date,
  ): Promise<
    {
      taskId: string;
      accessId: string;
      generation: number;
      startedAt: Date;
      endedAt: Date;
    }[]
  >;
  /** Earliest recorded change into IN_PROGRESS per Task (absent when never recorded). */
  abstract firstStarted(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
    ids: string[],
  ): Promise<Map<string, Date>>;
  /** Tasks with at least one active predecessor that is neither DONE nor CANCELED. */
  abstract blocked(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
    ids: string[],
  ): Promise<Set<string>>;
  /** Checklist items of a shared Task (same engine as Personal checklists). */
  abstract checklist(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
    taskId: string,
  ): Promise<
    { id: string; title: string; completed: boolean; position: number }[]
  >;
  /** One checklist change under the Task revision; advances the Task revision. */
  abstract changeChecklist(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    ctx: TaskToolContext,
    taskId: string,
    revision: number,
    change:
      | { kind: 'ADD'; id: string; title: string }
      | {
          kind: 'UPDATE';
          id: string;
          title?: string | undefined;
          completed?: boolean | undefined;
        }
      | { kind: 'DELETE'; id: string }
      | { kind: 'REORDER'; ids: string[] },
  ): Promise<number>;
  /** B4: the caller's own non-voided shared work logs; actorIds must be the caller's actors. */
  abstract actorEffort(
    tx: Prisma.TransactionClient,
    actorIds: string[],
    from: Date,
    to: Date,
  ): Promise<{ scopeId: string; startedAt: Date; endedAt: Date }[]>;
}
