import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
export abstract class SharedGoals {
  /** Internal locator hints expose no body and never confer resource authority. */
  abstract hint(
    id: string,
    spaceId: string,
  ): Promise<{ spaceId: string; scopeId: string }>;
  abstract location(
    tx: Prisma.TransactionClient,
    id: string,
    spaceId: string,
  ): Promise<{ spaceId: string; scopeId: string }>;
  abstract scopeCount(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
  ): Promise<number>;
  abstract project(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    sources: { spaceId: string; scopeId?: string; id: string }[],
    q: {
      after?: string;
      limit: number;
      status?: z.infer<typeof c.SharedGoalSchema>['status'];
    },
  ): Promise<z.infer<typeof c.SharedGoalSchema>[]>;
  abstract read(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    id: string,
  ): Promise<z.infer<typeof c.SharedGoalSchema>>;
  abstract list(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    query: z.infer<typeof c.ProjectPageQuerySchema>,
  ): Promise<z.infer<typeof c.SharedGoalPageSchema>>;
  abstract create(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    input: z.infer<typeof c.ProjectGoalCreateSchema>,
  ): Promise<z.infer<typeof c.SharedGoalSchema>>;
  abstract update(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    id: string,
    revision: number,
    input: z.infer<typeof c.ProjectGoalPatchSchema>,
  ): Promise<z.infer<typeof c.SharedGoalSchema>>;
  abstract linkTask(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    goalId: string,
    taskId: string,
    revision: number,
    sourceRevision: number,
  ): Promise<void>;
  /** Explicit Goal period (inclusive dates) used by reproducible pace formulas. */
  abstract period(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    id: string,
  ): Promise<{
    startDate: string | null;
    targetDate: string | null;
    timezone: string;
    revision: number;
  }>;
  abstract setPeriod(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    id: string,
    revision: number,
    period: { startDate: string; targetDate: string },
  ): Promise<z.infer<typeof c.SharedGoalSchema>>;
  /** Shared Task IDs linked to the Goal in the same scope. */
  abstract linkedTaskIds(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    id: string,
  ): Promise<string[]>;
}
