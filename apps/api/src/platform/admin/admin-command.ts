import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { permits } from './admin-policy.js';
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
/** Server-created administrative identity. Never a Planner session or membership. */
export class AdminCommand {
  static async acceptedHandover(
    tx: Prisma.TransactionClient,
    input: {
      initiatorAdminId: string;
      acceptedByUserId: string;
      previousOwnerUserId: string;
      spaceId: string;
      handoverId: string;
      requestId: string;
    },
  ) {
    const event = await tx.adminAuditEvent.create({
      data: {
        action: 'ADMIN_HANDOVER_ACCEPTED',
        outcome: 'SUCCEEDED',
        actorAdminId: null,
        targetUserId: input.acceptedByUserId,
        targetSpaceId: input.spaceId,
        requestId: input.requestId,
        permission: 'admin.workspaces.transfer_owner',
        metadata: {
          initiatedByAdminId: input.initiatorAdminId,
          acceptedByUserId: input.acceptedByUserId,
          handoverId: input.handoverId,
        },
      },
    });
    for (const userId of new Set([
      input.previousOwnerUserId,
      input.acceptedByUserId,
    ]))
      await tx.adminDelivery.create({
        data: {
          auditId: event.id,
          targetUserId: userId,
          kind: 'OWNERSHIP_CHANGED',
          payload: { workspaceId: input.spaceId, handoverId: input.handoverId },
        },
      });
  }
  static async requireInitiator(
    tx: Prisma.TransactionClient,
    adminId: string,
    permission: string,
  ) {
    const [user] = await tx.$queryRaw<
      { role: string }[]
    >`SELECT role FROM "AdminUser" WHERE id=${adminId}::uuid
      AND active AND "twoFactorEnabled" AND ("signInBlockedUntil" IS NULL OR "signInBlockedUntil"<=clock_timestamp()) FOR SHARE`;
    if (!user || !permits(user.role, permission))
      throw new ForbiddenException();
  }
  require(permission: string) {
    if (this.permission !== permission) throw new ForbiddenException();
  }
  async queueNotice(
    tx: Prisma.TransactionClient,
    userId: string,
    kind: 'ACCOUNT_CHANGED' | 'WORKSPACE_CHANGED',
    payload: { reason: string; workspaceId?: string },
  ) {
    await this.verify(tx);
    await tx.adminDelivery.create({
      data: { auditId: this.auditId, targetUserId: userId, kind, payload },
    });
  }
  async recordChange(
    tx: Prisma.TransactionClient,
    before: Prisma.InputJsonValue | null,
    after: Prisma.InputJsonValue,
  ) {
    await tx.adminAuditEvent.update({
      where: { id: this.auditId },
      data: { metadata: { before, after } },
    });
  }
  constructor(
    readonly adminId: string,
    readonly sessionId: string,
    readonly permission: string,
    readonly requestId: string,
    readonly auditId: string,
    readonly key: string,
    readonly input: Prisma.InputJsonValue,
  ) {
    if (!/^[!-~]{1,128}$/.test(key))
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  }
  async verify(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<
      { role: string }[]
    >`SELECT u.role FROM "AdminUser" u JOIN "AdminSession" s ON s."userId"=u.id WHERE u.id=${this.adminId}::uuid AND s.id=${this.sessionId}::uuid AND u.active AND (u."signInBlockedUntil" IS NULL OR u."signInBlockedUntil"<=clock_timestamp()) AND u."twoFactorEnabled" AND s."expiresAt">clock_timestamp() AND s."mfaVerifiedAt">u."mfaEnrolledAt" AND s."createdAt">u."mfaEnrolledAt" AND s."mfaVerifiedAt">clock_timestamp()-interval '5 minutes' AND s."mfaVerifiedAt"<=clock_timestamp() FOR SHARE OF u,s`;
    if (!rows[0] || !permits(rows[0].role, this.permission))
      throw new ForbiddenException();
  }
  async execute<T extends Prisma.InputJsonValue>(
    tx: Prisma.TransactionClient,
    work: () => Promise<T>,
    auditProjection?: (result: T) => Prisma.InputJsonValue,
  ): Promise<T> {
    await this.verify(tx);
    const keyHash = digest(this.key),
      fingerprint = digest(JSON.stringify(this.input));
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${this.adminId + ':' + this.permission + ':' + keyHash},0))::text`;
    const prior = await tx.adminMutationReceipt.findUnique({
      where: {
        actorAdminId_operation_keyHash: {
          actorAdminId: this.adminId,
          operation: this.permission,
          keyHash,
        },
      },
    });
    if (prior && prior.fingerprint !== fingerprint)
      throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
    const result = prior ? (prior.result as T) : await work();
    if (!prior)
      await tx.adminMutationReceipt.create({
        data: {
          actorAdminId: this.adminId,
          operation: this.permission,
          keyHash,
          fingerprint,
          result,
        },
      });
    const evidence = await tx.adminAuditEvent.findUniqueOrThrow({
      where: { id: this.auditId },
      select: { metadata: true },
    });
    const metadata =
      evidence.metadata &&
      typeof evidence.metadata === 'object' &&
      !Array.isArray(evidence.metadata)
        ? evidence.metadata
        : {};
    await tx.adminAuditEvent.update({
      where: { id: this.auditId },
      data: {
        actorAdminId: this.adminId,
        outcome: 'SUCCEEDED',
        metadata: {
          ...metadata,
          result: auditProjection ? auditProjection(result) : result,
          replayed: Boolean(prior),
        },
      },
    });
    return result;
  }
}
