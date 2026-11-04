import { Injectable, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestActor } from './request-actor.js';

/** Identity owner: shared commands revalidate the exact provider session inside the fence. */
@Injectable()
export class SharedIdentity {
  async lock(tx: Prisma.TransactionClient, userIds: string[]) {
    for (const id of [...new Set(userIds)].sort())
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id}::uuid FOR UPDATE`;
    for (const id of [...new Set(userIds)].sort())
      await tx.$queryRaw`SELECT id FROM "AuthAccount" WHERE "userId"=${id}::uuid ORDER BY id FOR UPDATE`;
  }
  canonicalEmail(email: string) {
    return email.toLowerCase();
  }
  current(tx: Prisma.TransactionClient, userId: string) {
    return tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, emailVerified: true },
    });
  }
  byEmail(tx: Prisma.TransactionClient, email: string) {
    return tx.user.findUnique({
      where: { email: this.canonicalEmail(email) },
      select: { id: true, email: true, emailVerified: true },
    });
  }
  async require(tx: Prisma.TransactionClient, actor: RequestActor) {
    if (!actor.sessionId) throw new ForbiddenException();
    const sessions = await tx.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM "AuthSession" s JOIN "User" u ON u.id=s."userId"
      WHERE s.id=${actor.sessionId}::uuid AND s."userId"=${actor.userId}::uuid
      AND s."expiresAt">clock_timestamp() AND u."emailVerified"=true FOR UPDATE OF s`;
    if (sessions.length !== 1) throw new ForbiddenException();
  }
}
