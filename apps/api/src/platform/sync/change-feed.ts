import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';
export type SyncEntity =
  | 'TASK'
  | 'CHECKLIST'
  | 'LABEL'
  | 'DAILY_PLAN'
  | 'HABIT_ENTRY'
  | 'NOTE'
  | 'CAPTURE';
export type FeedChange = {
  entity: SyncEntity;
  resourceId: string;
  parentId?: string | null;
  revision: number;
  deleted?: boolean;
};
/** Technical metadata log, like outbox: source owners validate identities in their TX. */
export async function appendSyncChanges(
  tx: Prisma.TransactionClient,
  scope: AuthorizedSpace,
  changes: FeedChange[],
) {
  if (!changes.length) return;
  const start = await scope.reserveSync(tx, changes.length);
  await tx.syncChange.createMany({
    data: changes.map((c, i) => ({
      ...c,
      spaceId: scope.spaceId,
      sequence: start + BigInt(i),
    })),
  });
}
