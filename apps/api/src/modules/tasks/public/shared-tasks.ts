import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
export abstract class SharedTasks {
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
}
