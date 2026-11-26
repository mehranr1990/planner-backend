import { reportedContextAvailable } from '../../spaces/public/reported-context.js';
import type { SharedKernel } from '../../spaces/public/index.js';
import { engagementContext } from '../../spaces/public/engagement-context.js';
import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { ReportedContentAccess } from '../../../platform/admin/reported-content.js';
export async function reportableTask(
  tx: Prisma.TransactionClient,
  actor: RequestActor,
  id: string,
) {
  const row = await tx.task.findUnique({
    where: { id },
    select: {
      id: true,
      spaceId: true,
      scopeId: true,
      deletedAt: true,
      createdByUserId: true,
    },
  });
  if (!row || row.deletedAt) throw new NotFoundException();
  if (row.scopeId) return row;
  await engagementContext(tx, actor, row.spaceId);
  return row;
}
export async function reportedTask(
  tx: Prisma.TransactionClient,
  proof: ReportedContentAccess,
  id: string,
  kernel: SharedKernel,
) {
  proof.require(tx, 'TASK', id);
  const r = await tx.task.findUnique({
    where: { id },
    select: {
      id: true,
      spaceId: true,
      scopeId: true,
      title: true,
      descriptionContent: true,
      status: true,
      deletedAt: true,
      createdByUserId: true,
    },
  });
  if (!r || r.deletedAt) throw new NotFoundException();
  await reportedContextAvailable(tx, r.spaceId, r.scopeId, kernel);
  return r;
}
