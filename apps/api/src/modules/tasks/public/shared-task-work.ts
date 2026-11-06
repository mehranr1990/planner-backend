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
}
