import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
export abstract class SharedGoals {
  abstract project(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    sources: { spaceId: string; id: string }[],
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
}
