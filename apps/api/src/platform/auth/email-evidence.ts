import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '../../generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';

export type EmailSource =
  | 'DIRECT'
  | 'CONTEXT_INVITATION'
  | 'CONVERSATION_INVITATION'
  | 'MEETING_INVITATION'
  | 'ADMIN_DELIVERY'
  | 'SECURITY_ALERT'
  | 'OPERATIONAL_ALERT'
  | 'COMMUNICATION'
  | 'NOTICE'
  | 'NOTIFICATION';
export type EmailCategory =
  | 'REGISTRATION_VERIFICATION'
  | 'PASSWORD_RECOVERY'
  | 'EMAIL_CHANGE_VERIFICATION'
  | 'PROJECT_INVITATION'
  | 'TEAM_INVITATION'
  | 'COMPANY_INVITATION'
  | 'CONVERSATION_INVITATION'
  | 'MEETING_INVITATION'
  | 'SOCIAL_GROUP_INVITATION'
  | 'SUPPORT'
  | 'SECURITY_NOTICE'
  | 'COMMUNICATIONS'
  | 'SYSTEM_NOTICE'
  | 'REMINDER';
export type EmailMetadata = {
  sourceKind?: EmailSource;
  sourceId?: string;
  category: EmailCategory;
  userId?: string;
  adminUserId?: string;
};
export type EmailReceipt = {
  state: 'SMTP_ACCEPTED' | 'SINK_ACCEPTED' | 'FAILED' | 'UNKNOWN';
  code:
    | 'SMTP_ACCEPTED'
    | 'SINK_ACCEPTED'
    | 'SMTP_REJECTED'
    | 'SMTP_TEMPORARY'
    | 'SMTP_ACCEPTANCE_UNKNOWN'
    | 'MAIL_TRANSPORT_FAILED';
  providerReference?: string | undefined;
};
export function safeProviderReference(value: unknown) {
  return typeof value === 'string' &&
    /^(?:<[A-Za-z0-9@._+=-]{1,252}>|[A-Za-z0-9@._+=-]{1,254})$/.test(value)
    ? value
    : undefined;
}
export function emailFailure(error: unknown): EmailReceipt {
  const n =
    typeof error === 'object' && error !== null && 'responseCode' in error
      ? Number(error.responseCode)
      : 0;
  return n >= 500
    ? { state: 'FAILED', code: 'SMTP_REJECTED' }
    : n >= 400
      ? { state: 'FAILED', code: 'SMTP_TEMPORARY' }
      : { state: 'UNKNOWN', code: 'SMTP_ACCEPTANCE_UNKNOWN' };
}
export function smtpReceipt(info: unknown, recipient: string): EmailReceipt {
  if (!info || typeof info !== 'object')
    return { state: 'UNKNOWN', code: 'SMTP_ACCEPTANCE_UNKNOWN' };
  const data = info as {
    accepted?: unknown;
    rejected?: unknown;
    messageId?: unknown;
  };
  const includes = (values: unknown) =>
    Array.isArray(values) &&
    values.some(
      (v: unknown) =>
        typeof v === 'string' && v.toLowerCase() === recipient.toLowerCase(),
    );
  if (includes(data.rejected))
    return { state: 'FAILED', code: 'SMTP_REJECTED' };
  if (!includes(data.accepted))
    return { state: 'UNKNOWN', code: 'SMTP_ACCEPTANCE_UNKNOWN' };
  return {
    state: 'SMTP_ACCEPTED',
    code: 'SMTP_ACCEPTED',
    providerReference: safeProviderReference(data.messageId),
  };
}
/** Evidence only. Existing queues remain the sole scheduling/delivery authority. */
@Injectable()
export class SystemEmailEvidence {
  private readonly transaction =
    new AsyncLocalStorage<Prisma.TransactionClient>();
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  inTransaction<T>(tx: Prisma.TransactionClient, work: () => Promise<T>) {
    return this.transaction.run(tx, work);
  }
  async observe(
    recipient: string,
    metadata: EmailMetadata,
    send: () => Promise<EmailReceipt>,
    transaction?: Prisma.TransactionClient,
  ) {
    const tx = transaction ?? this.transaction.getStore() ?? this.db.client;
    const email = recipient.toLowerCase();
    // Signup callbacks may run before the provider commits its new User.
    // Attach only an already visible FK; the auth boundary associates registration after commit.
    const userId = metadata.adminUserId
      ? undefined
      : (
          await tx.user.findUnique({
            where: metadata.userId ? { id: metadata.userId } : { email },
            select: { id: true },
          })
        )?.id;
    const id = randomUUID();
    await tx.systemEmailObservation.create({
      data: {
        id,
        sourceKind: metadata.sourceKind ?? 'DIRECT',
        sourceId: metadata.sourceId ?? id,
        category: metadata.category,
        recipient: email,
        userId: userId ?? null,
        subjectUserId: metadata.userId ?? userId ?? null,
        adminUserId: metadata.adminUserId ?? null,
        state: 'PROCESSING',
      },
    });
    try {
      const receipt = await send();
      await tx.systemEmailObservation.updateMany({
        where: { id },
        data: {
          state: receipt.state,
          code: receipt.code,
          providerReference:
            safeProviderReference(receipt.providerReference) ?? null,
          completedAt: new Date(),
        },
      });
      return receipt;
    } catch (error) {
      const receipt = emailFailure(error);
      await tx.systemEmailObservation.updateMany({
        where: { id },
        data: {
          state: receipt.state,
          code: receipt.code,
          completedAt: new Date(),
        },
      });
      throw new Error('System email transport failed');
    }
  }
  async retentionImpact(tx: Prisma.TransactionClient, days: number) {
    return tx.systemEmailObservation.count({
      where: {
        createdAt: {
          lt: new Date(Date.now() - days * 86400000),
        },
      },
    });
  }
  async sweep(days: number) {
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      throw new Error('Invalid mail retention');
    await this.db.client.systemEmailObservation.updateMany({
      where: {
        state: 'PROCESSING',
        createdAt: { lt: new Date(Date.now() - 120000) },
      },
      data: {
        state: 'UNKNOWN',
        code: 'WORKER_ACCEPTANCE_UNKNOWN',
        completedAt: new Date(),
      },
    });
    const rows = await this.db.client.systemEmailObservation.findMany({
      where: { createdAt: { lt: new Date(Date.now() - days * 86400000) } },
      select: { id: true },
      take: 500,
      orderBy: { createdAt: 'asc' },
    });
    await this.db.client.systemEmailObservation.deleteMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
  }
}
