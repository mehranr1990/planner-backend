import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AdminCommand } from './admin-command.js';
const issued = new WeakMap<
  ReportedContentAccess,
  { tx: Prisma.TransactionClient; kind: string; id: string }
>();
export class ReportedContentAccess {
  require(tx: Prisma.TransactionClient, kind: string, id: string) {
    const proof = issued.get(this);
    if (!proof || proof.tx !== tx || proof.kind !== kind || proof.id !== id)
      throw new ForbiddenException();
  }
}
/** Only the case owner calls this after locking and authorizing the exact case. */
export async function authorizeReportedContent(
  tx: Prisma.TransactionClient,
  command: AdminCommand,
  kind: string,
  id: string,
) {
  command.require('admin.moderation.content.read');
  await command.verify(tx);
  const proof = new ReportedContentAccess();
  issued.set(proof, { tx, kind, id });
  return proof;
}
