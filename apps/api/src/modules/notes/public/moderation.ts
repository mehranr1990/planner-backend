import { reportedContextAvailable } from '../../spaces/public/reported-context.js';
import type { SharedKernel } from '../../spaces/public/index.js';
import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { ReportedContentAccess } from '../../../platform/admin/reported-content.js';
export async function reportableNote(
  tx: Prisma.TransactionClient,
  actor: RequestActor,
  id: string,
) {
  const r = await tx.note.findFirst({
    where: {
      id,
      createdByUserId: actor.userId,
      current: true,
      state: { not: 'DELETED' },
    },
    select: { id: true, spaceId: true, createdByUserId: true },
  });
  if (!r) throw new NotFoundException();
  return r;
}
export async function reportedNote(
  tx: Prisma.TransactionClient,
  proof: ReportedContentAccess,
  id: string,
  kernel: SharedKernel,
) {
  proof.require(tx, 'NOTE', id);
  const r = await tx.note.findFirst({
    where: { id, state: { not: 'DELETED' } },
    select: {
      id: true,
      spaceId: true,
      title: true,
      content: true,
      contentFormat: true,
      revision: true,
    },
  });
  if (!r) throw new NotFoundException();
  await reportedContextAvailable(tx, r.spaceId, null, kernel);
  return r;
}
