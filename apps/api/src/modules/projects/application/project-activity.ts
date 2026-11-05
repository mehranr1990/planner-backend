import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
type Target = { kind: 'PROJECT' | 'TASK' | 'GOAL' | 'DOCUMENT'; id: string };
/** Metadata only; callers hold current source authority and the custody fence. */
export function appendProjectActivity(
  tx: Prisma.TransactionClient,
  pid: string,
  actorId: string,
  action: string,
  resourceId: string,
  target: Target = { kind: 'PROJECT', id: pid },
) {
  return tx.projectActivity.create({
    data: {
      id: randomUUID(),
      spaceId: pid,
      scopeId: pid,
      projectId: pid,
      actorId,
      action,
      resourceId,
      taskId: target.kind === 'TASK' ? target.id : null,
      goalId: target.kind === 'GOAL' ? target.id : null,
      documentId: target.kind === 'DOCUMENT' ? target.id : null,
    },
  });
}
