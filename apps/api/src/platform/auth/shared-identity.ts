import { Injectable, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestActor } from './request-actor.js';
import { effectiveSuspension } from '../admin/management-policy.js';

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
  async verifiedByEmail(tx: Prisma.TransactionClient, email: string) {
    const user = await this.byEmail(tx, email);
    return user?.emailVerified ? user : null;
  }
  directory(tx: Prisma.TransactionClient, userId: string) {
    return tx.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, emailVerified: true },
    });
  }
  /** Context-authorized callers receive a name only, never account/contact fields. */
  display(tx: Prisma.TransactionClient, userId: string) {
    return tx.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
  }
  async require(tx: Prisma.TransactionClient, actor: RequestActor) {
    const state = await tx.userSettings.findUnique({
      where: { userId: actor.userId },
      select: { suspendedAt: true, suspensionExpiresAt: true },
    });
    if (state && effectiveSuspension(state)) throw new ForbiddenException();
    if (!actor.sessionId) throw new ForbiddenException();
    const sessions = await tx.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM "AuthSession" s JOIN "User" u ON u.id=s."userId"
      WHERE s.id=${actor.sessionId}::uuid AND s."userId"=${actor.userId}::uuid
      AND s."expiresAt">clock_timestamp() AND u."emailVerified"=true FOR UPDATE OF s`;
    if (sessions.length !== 1) throw new ForbiddenException();
  }
}
