import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { MessageNotices } from './message-notices.service.js';
import { MessageMediaService } from './message-media.service.js';
const inactive = (error: unknown) =>
  error instanceof NotFoundException || error instanceof ForbiddenException;
@Injectable()
export class MessageNoticeWorker {
  private afterAttachment: string | undefined;
  constructor(
    @Inject(MessageNotices) readonly notices: MessageNotices,
    @Inject(MessageMediaService) private readonly media: MessageMediaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  async consume() {
    if (await this.delivery()) return true;
    if (await this.notices.prepare()) return true;
    if (await this.notices.fanout()) return true;
    return this.cleanup();
  }
  async delivery() {
    const db = this.notices.db.client,
      now = (
        await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
      )[0]!.now;
    const hint = await db.messageNoticeAttempt.findFirst({
      where: {
        OR: [
          { state: { in: ['PENDING', 'RETRY'] }, notBefore: { lte: now } },
          { state: { in: ['PROCESSING', 'NETWORK'] }, leaseUntil: { lt: now } },
        ],
      },
      include: { notice: { include: { activity: true } } },
      orderBy: [{ notBefore: 'asc' }, { id: 'asc' }],
    });
    if (!hint) return false;
    if (hint.state === 'NETWORK') {
      await db.messageNoticeAttempt.updateMany({
        where: {
          id: hint.id,
          state: 'NETWORK',
          token: hint.token,
          leaseUntil: { lt: now },
        },
        data: {
          state: 'AMBIGUOUS',
          leaseUntil: null,
          code: 'PUSH_ACCEPTANCE_UNKNOWN',
        },
      });
      return true;
    }
    const userId = (
      await this.notices.authority.hints([hint.notice.actorId])
    )[0];
    if (!userId) {
      await this.notices.cancel(hint.noticeId);
      return true;
    }
    const token = randomUUID();
    try {
      const claimed = await this.notices.operation(
        hint.notice.activity,
        userId,
        async (s) => {
          const row = await s.tx.messageNoticeAttempt.findUniqueOrThrow({
            where: { id: hint.id },
          });
          if (
            !['PENDING', 'RETRY', 'PROCESSING'].includes(row.state) ||
            row.notBefore > s.now ||
            (row.state === 'PROCESSING' &&
              row.leaseUntil &&
              row.leaseUntil > s.now)
          )
            return false;
          await s.tx.messageNoticeAttempt.update({
            where: { id: row.id },
            data: {
              state: 'PROCESSING',
              token,
              leaseUntil: new Date(s.now.getTime() + 30000),
            },
          });
          return true;
        },
      );
      if (!claimed) return true;
      // Distinct final gate permits tests and other processes to win revocation
      // between claiming work and starting an external send. No network under locks.
      const ticket = await this.notices.operation(
        hint.notice.activity,
        userId,
        async (s) => {
          const row = await s.tx.messageNoticeAttempt.findUniqueOrThrow({
              where: { id: hint.id },
            }),
            notice = await s.tx.messageNotice.findUniqueOrThrow({
              where: { id: hint.noticeId },
            });
          if (
            row.state !== 'PROCESSING' ||
            row.token !== token ||
            !row.leaseUntil ||
            row.leaseUntil <= s.now
          )
            return null;
          const stop = async (
            state: 'CANCELED' | 'EXPIRED' | 'FAILED',
            code: string,
          ) => {
            await s.tx.messageNoticeAttempt.update({
              where: { id: row.id },
              data: {
                state,
                code,
                canceledAt: state === 'CANCELED' ? s.now : row.canceledAt,
                token: null,
                leaseUntil: null,
              },
            });
            return null;
          };
          if (
            hint.notice.activity.createdAt.getTime() + 7 * 86400000 <
            s.now.getTime()
          )
            return stop('EXPIRED', 'MISSED');
          const context = await this.notices.context(
            s,
            hint.notice.activity,
            notice.actorId,
            notice.memberId,
            notice.generation,
          );
          if (
            !context ||
            !context.pushAllowed ||
            notice.state !== 'PUBLISHED' ||
            notice.read ||
            row.canceledAt ||
            !row.subscriptionId
          )
            return stop('CANCELED', 'NO_LONGER_ELIGIBLE');
          if (row.attempts >= 5) return stop('FAILED', 'RETRY_EXHAUSTED');
          if (context.notBefore > s.now) {
            await s.tx.messageNoticeAttempt.update({
              where: { id: row.id },
              data: {
                state: 'RETRY',
                notBefore: context.notBefore,
                token: null,
                leaseUntil: null,
                code: 'QUIET_HOURS',
              },
            });
            return null;
          }
          let subscription;
          try {
            subscription = await this.notices.push.ticket(
              s.tx,
              context.owner,
              row.subscriptionId,
              row.subscriptionRevision,
            );
          } catch (error) {
            if (!inactive(error)) throw error;
            return stop('CANCELED', 'SUBSCRIPTION_REVOKED');
          }
          await s.tx.messageNoticeAttempt.update({
            where: { id: row.id },
            data: {
              state: 'NETWORK',
              networkAt: s.now,
              attempts: { increment: 1 },
              leaseUntil: new Date(s.now.getTime() + 30000),
            },
          });
          return subscription;
        },
      );
      if (!ticket) return true;
      let result: Awaited<ReturnType<typeof this.notices.push.send>>;
      try {
        result = await this.notices.push.send(
          hint.id,
          hint.noticeId,
          ticket.subscription,
        );
      } catch {
        result = { outcome: 'AMBIGUOUS', code: 'PUSH_ACCEPTANCE_UNKNOWN' };
      }
      if (result.outcome === 'GONE') await this.notices.push.gone(ticket);
      await db.$transaction(async (tx) => {
        const row = await tx.messageNoticeAttempt.findUniqueOrThrow({
          where: { id: hint.id },
        });
        if (
          row.token !== token ||
          !['NETWORK', 'AMBIGUOUS'].includes(row.state)
        )
          return;
        if (row.state === 'AMBIGUOUS' && result.outcome !== 'ACCEPTED') return;
        const clock = (
            await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
          )[0]!.now,
          next = this.notices.push.retry(clock, row.attempts);
        const state =
          result.outcome === 'ACCEPTED'
            ? 'DELIVERED'
            : row.canceledAt
              ? 'CANCELED'
              : result.outcome === 'RETRY' && next
                ? 'RETRY'
                : result.outcome === 'AMBIGUOUS'
                  ? 'AMBIGUOUS'
                  : 'FAILED';
        await tx.messageNoticeAttempt.update({
          where: { id: row.id },
          data: {
            state,
            code:
              result.outcome === 'RETRY' && !next
                ? 'RETRY_EXHAUSTED'
                : result.code,
            notBefore: state === 'RETRY' ? next! : row.notBefore,
            leaseUntil: null,
            ...(state === 'RETRY' ? { token: null } : {}),
          },
        });
      });
      return true;
    } catch (error) {
      if (!inactive(error)) throw error;
      await this.notices.cancel(hint.noticeId);
      return true;
    }
  }
  async cleanup() {
    const db = this.notices.db.client,
      now = new Date(),
      cutoff = new Date(
        now.getTime() -
          this.config.FILE_UPLOAD_TTL_SECONDS * 1000 -
          this.config.FILE_UPLOAD_TIMEOUT_MS -
          30000,
      );
    const rows = await db.messageAttachment.findMany({
      where: {
        messageId: null,
        retiredAt: null,
        createdAt: { lt: cutoff },
        ...(this.afterAttachment ? { id: { gt: this.afterAttachment } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 25,
    });
    if (!rows.length) {
      this.afterAttachment = undefined;
      return false;
    }
    this.afterAttachment = rows.at(-1)!.id;
    for (const attachment of rows) {
      const conv = await db.conversation.findUnique({
          where: { id: attachment.conversationId },
        }),
        operator = conv
          ? await this.notices.authority.operator(conv.scopeId)
          : null;
      if (!operator) continue;
      try {
        const file = await this.notices.base.operation(
          {
            userId: operator,
            requestId: randomUUID(),
            correlationId: randomUUID(),
          },
          attachment.conversationId,
          'messaging.attachment.reconcile',
          async (s) => {
            // Closed/frozen sources retain their markers until their lifecycle permits cleanup.
            s.proof = await this.notices.base.proof(s);
            await this.media.fileRead(s);
            const current = await s.tx.messageAttachment.findUniqueOrThrow({
              where: { id: attachment.id },
            });
            if (current.messageId || current.retiredAt) return null;
            const scope = this.media.scope(s),
              file = await this.media.files.row(s.tx, scope, attachment.fileId);
            if (
              file.status === 'READY' &&
              file.uploadExpiresAt.getTime() <
                s.now.getTime() - this.config.FILE_UPLOAD_TIMEOUT_MS - 30000
            )
              await this.media.files.deleted(
                s.tx,
                scope,
                file.id,
                file.revision,
                s.now,
              );
            const candidates = await this.media.files.reconcile(
              s.tx,
              scope,
              s.now,
              true,
              [attachment.fileId],
            );
            if (candidates[0])
              await writeAudit(s.tx, {
                action: 'FILE_CLEANUP',
                outcome: 'SUCCEEDED',
                actorUserId: null,
                requestId: s.actor.requestId,
                correlationId: s.actor.correlationId,
                resourceId: attachment.id,
              });
            return candidates[0] ?? null;
          },
          [operator],
          true,
          [],
          true,
        );
        if (!file) continue;
        await this.media.files.remove(file);
        await this.notices.base.operation(
          {
            userId: operator,
            requestId: randomUUID(),
            correlationId: randomUUID(),
          },
          attachment.conversationId,
          'messaging.attachment.reconciled',
          async (s) => {
            s.proof = await this.notices.base.proof(s);
            await this.media.fileRead(s);
            const current = await s.tx.messageAttachment.findUniqueOrThrow({
              where: { id: attachment.id },
            });
            if (current.messageId)
              throw new Error('ATTACHMENT_RECONCILIATION_CONFLICT');
            await this.media.files.cleanupFinished(
              s.tx,
              this.media.scope(s),
              file.id,
              file.uploadAttemptId,
            );
            await s.tx.messageAttachment.update({
              where: { id: attachment.id },
              data: { retiredAt: s.now },
            });
          },
          [operator],
          true,
          [],
          true,
        );
        return true;
      } catch (error) {
        if (!inactive(error)) throw error;
      }
    }
    return rows.length === 25;
  }
}
