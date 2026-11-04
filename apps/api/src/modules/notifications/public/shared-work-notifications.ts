import type { Prisma } from '../../../generated/prisma/client.js';
import type { SharedAuthority } from '../../spaces/public/index.js';
import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
export abstract class SharedWorkNotifications {
  abstract append(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    input: {
      spaceId: string;
      assignmentId: string;
      recipientActorId: string;
      assignmentRevision: number;
      kind: z.infer<typeof c.SharedAssignmentNotificationSchema>['kind'];
    },
  ): Promise<void>;
  abstract list(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaces: string[],
    assignments: string[],
    after: string | undefined,
    limit: number,
  ): Promise<z.infer<typeof c.SharedAssignmentNotificationSchema>[]>;
  abstract read(
    tx: Prisma.TransactionClient,
    a: SharedAuthority,
    spaceId: string,
    id: string,
    revision: number,
  ): Promise<z.infer<typeof c.SharedAssignmentNotificationSchema>>;
}
