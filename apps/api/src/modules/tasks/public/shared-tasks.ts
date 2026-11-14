import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
export abstract class SharedTasks {
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
  abstract schedule(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    id: string,
    input?: {
      revision: number;
      value: z.infer<typeof c.SharedTaskScheduleInputSchema>;
    },
  ): Promise<z.infer<typeof c.SharedTaskScheduleSchema>>;
  abstract project(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    sources: { spaceId: string; scopeId?: string; id: string }[],
    q: {
      after?: string;
      limit: number;
      status?: z.infer<typeof c.SharedTaskSchema>['status'];
      range?: { from: string; to: string; timezone: string };
    },
  ): Promise<
    {
      task: z.infer<typeof c.SharedTaskSchema>;
      schedule: z.infer<typeof c.SharedTaskScheduleSchema>;
    }[]
  >;
  abstract read(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    id: string,
  ): Promise<z.infer<typeof c.SharedTaskSchema>>;
  abstract list(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    query: z.infer<typeof c.ProjectPageQuerySchema>,
  ): Promise<z.infer<typeof c.SharedTaskPageSchema>>;
  abstract create(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    input: z.infer<typeof c.ProjectTaskCreateSchema>,
  ): Promise<z.infer<typeof c.SharedTaskSchema>>;
  abstract update(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    id: string,
    revision: number,
    input: z.infer<typeof c.ProjectTaskPatchSchema>,
  ): Promise<z.infer<typeof c.SharedTaskSchema>>;
  /** Newest shared Task changes in one authorized scope (non-deleted Tasks only). */
  abstract changes(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    space: string,
    limit: number,
  ): Promise<
    {
      id: string;
      taskId: string;
      title: string;
      kind: string;
      beforeStatus: z.infer<typeof c.SharedTaskSchema>['status'] | null;
      afterStatus: z.infer<typeof c.SharedTaskSchema>['status'];
      actorId: string | null;
      createdAt: Date;
    }[]
  >;
}
