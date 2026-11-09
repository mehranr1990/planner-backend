import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { ConversationMember } from '../../../generated/prisma/client.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { MessagingAuthority } from '../../spaces/public/index.js';
import {
  MessagingService,
  type MessageOperation as Op,
} from './messaging.service.js';
import { AdvancedMessagingService } from './advanced-messaging.service.js';
import {
  MessageMediaService,
  messageKey,
  messageFingerprint,
  messageVersion,
} from './message-media.service.js';
@Injectable()
export class MessageProgressService {
  constructor(
    @Inject(MessagingService) private readonly base: MessagingService,
    @Inject(AdvancedMessagingService)
    private readonly advanced: AdvancedMessagingService,
    @Inject(MessageMediaService) private readonly media: MessageMediaService,
    @Inject(MessagingAuthority) private readonly authority: MessagingAuthority,
  ) {}
  private async current(s: Op, m: ConversationMember) {
    return (
      (await s.tx.messageProgress.findUnique({
        where: {
          memberId_generation: { memberId: m.id, generation: m.generation },
        },
      })) ?? {
        conversationId: s.conv.id,
        memberId: m.id,
        generation: m.generation,
        deliveredThrough: m.historyAfter,
        readThrough: m.historyAfter,
        shareReceipts: false,
        receiptConsentAt: null,
        revision: 1,
      }
    );
  }
  private view(p: Awaited<ReturnType<MessageProgressService['current']>>) {
    return c.MessageProgressSchema.parse({
      deliveredThrough: String(p.deliveredThrough),
      readThrough: String(p.readThrough),
      shareReceipts: p.shareReceipts,
      revision: p.revision,
    });
  }
  async mutate(
    s: Op,
    m: ConversationMember,
    key: string | undefined,
    body: unknown,
    work: () => Promise<void>,
  ) {
    const identity = {
        memberId: m.id,
        generation: m.generation,
        keyHash: messageKey(key),
      },
      fingerprint = messageFingerprint(body),
      old = await s.tx.messagePersonalMutation.findUnique({
        where: { memberId_generation_keyHash: identity },
      });
    if (old) {
      if (old.fingerprint !== fingerprint)
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
      return;
    }
    await work();
    await s.tx.messagePersonalMutation.create({
      data: { ...identity, conversationId: s.conv.id, fingerprint },
    });
    await writeAudit(s.tx, {
      action: 'NOTIFICATION_CHANGE',
      outcome: 'SUCCEEDED',
      actorUserId: s.actor.userId,
      requestId: s.actor.requestId,
      correlationId: s.actor.correlationId,
      resourceId: m.id,
    });
  }
  get(actor: RequestActor, id: string) {
    return this.base.operation(
      actor,
      id,
      'messaging.progress.read',
      async (s) =>
        this.view(await this.current(s, await this.base.currentMember(s))),
    );
  }
  acknowledge(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.MessageAcknowledgeSchema>,
    key: string | undefined,
  ) {
    const body = c.MessageAcknowledgeSchema.parse(input);
    return this.advanced.run(
      actor,
      id,
      'messaging.progress.update',
      async (s, m) => {
        const e = await this.advanced.entry(s, m, body.messageId);
        if ((await this.media.view(s, m, e)).state !== 'VISIBLE')
          throw new NotFoundException();
        await this.mutate(s, m, key, { action: 'ack', ...body }, async () => {
          const p = await this.current(s, m),
            deliveredThrough =
              e.sequence > p.deliveredThrough ? e.sequence : p.deliveredThrough,
            readThrough =
              body.state === 'READ' && e.sequence > p.readThrough
                ? e.sequence
                : p.readThrough;
          await s.tx.messageProgress.upsert({
            where: {
              memberId_generation: { memberId: m.id, generation: m.generation },
            },
            create: {
              ...p,
              deliveredThrough,
              readThrough,
              revision: p.revision + 1,
            },
            update: {
              deliveredThrough,
              readThrough,
              revision: { increment: 1 },
            },
          });
        });
        return this.view(await this.current(s, m));
      },
    );
  }
  sharing(
    actor: RequestActor,
    id: string,
    shareReceipts: boolean,
    key: string | undefined,
    expected: number | undefined,
  ) {
    return this.base.operation(
      actor,
      id,
      'messaging.progress.sharing',
      async (s) => {
        const m = await this.base.currentMember(s);
        await this.mutate(
          s,
          m,
          key,
          { action: 'sharing', shareReceipts },
          async () => {
            const p = await this.current(s, m);
            if (shareReceipts && !(await this.base.dmContact(s)))
              throw new ForbiddenException({ code: 'CONTACT_UNAVAILABLE' });
            messageVersion(expected, p.revision);
            await s.tx.messageProgress.upsert({
              where: {
                memberId_generation: {
                  memberId: m.id,
                  generation: m.generation,
                },
              },
              create: {
                ...p,
                shareReceipts,
                receiptConsentAt: shareReceipts ? s.now : null,
                revision: p.revision + 1,
              },
              update: {
                shareReceipts,
                receiptConsentAt: shareReceipts ? s.now : null,
                revision: { increment: 1 },
              },
            });
          },
        );
        return this.view(await this.current(s, m));
      },
    );
  }
  summary(actor: RequestActor, id: string, messageId: string) {
    return this.advanced.run(
      actor,
      id,
      'messaging.receipt.summary',
      async (s, m) => {
        const e = await this.advanced.entry(s, m, messageId);
        if (e.memberId !== m.id || e.memberGeneration !== m.generation)
          throw new ForbiddenException();
        if ((await this.media.view(s, m, e)).state !== 'VISIBLE')
          throw new NotFoundException();
        const mine = await this.current(s, m);
        if (!mine.shareReceipts)
          return c.MessageReceiptSummarySchema.parse({
            messageId,
            sharing: false,
            deliveredCount: null,
            readCount: null,
          });
        let deliveredCount = 0,
          readCount = 0;
        const members = await s.tx.conversationMember.findMany({
          where: {
            conversationId: id,
            state: 'ACTIVE',
            id: { not: m.id },
            historyAfter: { lt: e.sequence },
          },
          orderBy: { id: 'asc' },
          take: 200,
        });
        for (const row of members) {
          try {
            const userId = await this.authority.user(
                s.tx,
                s.conv.spaceId,
                row.actorId,
              ),
              proof = await this.base.proof(s, userId),
              recipient = await this.base.currentMember(s, proof),
              p = await this.current(s, recipient);
            if (!p.shareReceipts) continue;
            const pair = await this.base.contacts.pair(
              s.tx,
              s.actor.userId,
              userId,
              s.locked,
            );
            if (
              pair.blocked ||
              (pair.cutoff &&
                (!mine.receiptConsentAt ||
                  mine.receiptConsentAt <= pair.cutoff ||
                  !p.receiptConsentAt ||
                  p.receiptConsentAt <= pair.cutoff))
            )
              continue;
            const recipientOp: Op = {
              ...s,
              actor: { ...s.actor, userId },
              proof,
            };
            if (
              (await this.media.view(recipientOp, recipient, e)).state !==
              'VISIBLE'
            )
              continue;
            if (p.deliveredThrough >= e.sequence) deliveredCount++;
            if (p.readThrough >= e.sequence) readCount++;
          } catch (error) {
            if (!(
              error instanceof NotFoundException ||
              error instanceof ForbiddenException
            ))
              throw error;
          }
        }
        return c.MessageReceiptSummarySchema.parse({
          messageId,
          sharing: true,
          deliveredCount,
          readCount,
        });
      },
    );
  }
  private async settings(s: Op, m: ConversationMember) {
    return (
      (await s.tx.messageNoticePreference.findUnique({
        where: {
          memberId_generation: { memberId: m.id, generation: m.generation },
        },
      })) ?? {
        conversationId: s.conv.id,
        memberId: m.id,
        generation: m.generation,
        mode: 'ALL',
        quietStart: null,
        quietEnd: null,
        mentionQuiet: false,
        effectiveAt: m.joinedAt,
        revision: 1,
      }
    );
  }
  private settingView(
    p: Awaited<ReturnType<MessageProgressService['settings']>>,
  ) {
    return c.MessageNoticeSettingsSchema.parse({
      mode: p.mode,
      quietStart: p.quietStart,
      quietEnd: p.quietEnd,
      mentionQuiet: p.mentionQuiet,
      revision: p.revision,
    });
  }
  noticeSettings(actor: RequestActor, id: string) {
    return this.base.operation(
      actor,
      id,
      'messaging.notice.settings.read',
      async (s) =>
        this.settingView(
          await this.settings(s, await this.base.currentMember(s)),
        ),
    );
  }
  setNoticeSettings(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.MessageNoticeSettingsInputSchema>,
    key: string | undefined,
    expected: number | undefined,
  ) {
    const body = c.MessageNoticeSettingsInputSchema.parse(input);
    return this.base.operation(
      actor,
      id,
      'messaging.notice.settings.update',
      async (s) => {
        const m = await this.base.currentMember(s);
        await this.mutate(
          s,
          m,
          key,
          { action: 'notice.settings', ...body },
          async () => {
            const p = await this.settings(s, m);
            messageVersion(expected, p.revision);
            const effectiveAt =
              (p.mode === 'MUTED' && body.mode !== 'MUTED') ||
              (p.mode === 'MENTIONS_ONLY' && body.mode === 'ALL')
                ? new Date(s.now.getTime() + 1)
                : p.effectiveAt;
            await s.tx.messageNoticePreference.upsert({
              where: {
                memberId_generation: {
                  memberId: m.id,
                  generation: m.generation,
                },
              },
              create: { ...p, ...body, effectiveAt, revision: p.revision + 1 },
              update: { ...body, effectiveAt, revision: { increment: 1 } },
            });
          },
        );
        return this.settingView(await this.settings(s, m));
      },
    );
  }
}
