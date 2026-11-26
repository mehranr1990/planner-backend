import { reportedContextAvailable } from '../../spaces/public/reported-context.js';
import type { SharedKernel } from '../../spaces/public/index.js';
import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { ReportedContentAccess } from '../../../platform/admin/reported-content.js';
export async function messageReportHint(
  tx: Prisma.TransactionClient,
  id: string,
) {
  const row = await tx.conversationMessage.findUnique({
    where: { id },
    select: { id: true, conversationId: true, sequence: true, memberId: true },
  });
  if (!row) throw new NotFoundException();
  return row;
}
export async function reportedMessage(
  tx: Prisma.TransactionClient,
  proof: ReportedContentAccess,
  id: string,
  kernel: SharedKernel,
) {
  proof.require(tx, 'MESSAGE', id);
  const row = await tx.conversationMessage.findUnique({
    where: { id },
    select: {
      id: true,
      Conversation: { select: { spaceId: true, scopeId: true, state: true } },
      text: true,
      MessageEntry_text: {
        select: {
          deletedAt: true,
          MessageRevision_message: {
            orderBy: { revision: 'desc' },
            take: 1,
            select: { text: true },
          },
        },
      },
    },
  });
  if (!row || row.MessageEntry_text.some((e) => e.deletedAt))
    throw new NotFoundException();
  if (!['ACTIVE', 'ARCHIVED'].includes(row.Conversation.state))
    throw new NotFoundException();
  await reportedContextAvailable(
    tx,
    row.Conversation.spaceId,
    row.Conversation.scopeId,
    kernel,
  );
  return {
    id: row.id,
    text:
      row.MessageEntry_text[0]?.MessageRevision_message[0]?.text ?? row.text,
  };
}
