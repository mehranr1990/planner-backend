import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  MessageEntry,
  ConversationMember,
  MessageAttachment,
  StoredFile,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import {
  SharedFiles,
  type SharedFileScope,
} from '../../../platform/storage/public/index.js';
import { MessagingAuthority, SharedKernel } from '../../spaces/public/index.js';
import {
  MessagingService,
  type MessageOperation as Op,
} from './messaging.service.js';
import { AdvancedMessagingService } from './advanced-messaging.service.js';
import { authorWindowOpen } from '../domain/messaging-policy.js';
export const messageFingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function messageKey(key: string | undefined) {
  if (!key || !/^[\x21-\x7e]{1,128}$/.test(key))
    throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  return messageFingerprint(key);
}
export function messageVersion(expected: number | undefined, actual: number) {
  if (expected === undefined)
    throw new BadRequestException({ code: 'IF_MATCH_REQUIRED' });
  if (expected !== actual)
    throw new ConflictException({ code: 'REVISION_CONFLICT' });
}
type Page = z.infer<typeof c.ConversationPageQuerySchema>;
@Injectable()
export class MessageMediaService {
  async conversations(actor: RequestActor, q: Page) {
    const page = await this.base.list(actor, q, (id) =>
      this.advanced.run(actor, id, 'messaging.summary.read', async (s, m) => {
        const progress = await s.tx.messageProgress.findUnique({
          where: {
            memberId_generation: { memberId: m.id, generation: m.generation },
          },
        });
        const preference = await s.tx.messageNoticePreference.findUnique({
          where: {
            memberId_generation: { memberId: m.id, generation: m.generation },
          },
        });
        const readThrough =
          progress && progress.readThrough > m.historyAfter
            ? progress.readThrough
            : m.historyAfter;
        let lastMessage: z.infer<
          typeof c.ConversationSummarySchema
        >['lastMessage'] = null;
        let unreadCount = 0,
          before = s.conv.lastSequence + 1n;
        for (;;) {
          const rows = await s.tx.messageEntry.findMany({
            where: {
              conversationId: id,
              sequence: { gt: m.historyAfter, lt: before },
            },
            orderBy: { sequence: 'desc' },
            take: 100,
          });
          for (const row of rows) {
            if (lastMessage && row.sequence <= readThrough) break;
            const value = await this.view(s, m, row);
            if (value.state !== 'VISIBLE') continue;
            lastMessage ??= {
              id: value.id,
              memberId: value.memberId,
              kind: value.kind,
              text: value.text,
              createdAt: value.createdAt,
            };
            if (row.sequence > readThrough && row.memberId !== m.id)
              unreadCount++;
          }
          if (
            rows.length < 100 ||
            (lastMessage && rows.at(-1)!.sequence <= readThrough)
          )
            break;
          before = rows.at(-1)!.sequence;
        }
        const lastActivityAt =
          lastMessage?.createdAt ?? s.conv.createdAt.toISOString();
        return c.ConversationSummarySchema.parse({
          ...(await this.base.view(s)),
          lastMessage,
          unreadCount,
          muted: preference?.mode === 'MUTED',
          lastActivityAt,
          updatedAt: lastActivityAt,
        });
      }),
    );
    return c.ConversationSummaryPageSchema.parse(page);
  }
  private readonly fileProofs = new WeakMap<Op, string>();
  async fileRead(s: Op) {
    if (!s.proof) throw new NotFoundException();
    if (!['DM', 'PRIVATE_GROUP'].includes(s.conv.kind)) {
      const p = await this.authority.proof(
        s.tx,
        s.actor,
        s.conv.scopeId,
        s.actor.userId,
        s.locked,
        'file.read',
      );
      if (
        p.actorId !== s.proof.actorId ||
        p.accessId !== s.proof.accessId ||
        p.generation !== s.proof.generation
      )
        throw new NotFoundException();
    }
    this.fileProofs.set(s, s.proof.actorId);
  }

  constructor(
    @Inject(MessagingService) readonly base: MessagingService,
    @Inject(AdvancedMessagingService)
    readonly advanced: AdvancedMessagingService,
    @Inject(SharedFiles) readonly files: SharedFiles,
    @Inject(MessagingAuthority) private readonly authority: MessagingAuthority,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  scope(s: Op): SharedFileScope {
    return {
      spaceId: s.conv.spaceId,
      scopeId: s.conv.scopeId,
      actorId: s.proof!.actorId,
      verify: (tx) => {
        if (
          tx !== s.tx ||
          s.open === false ||
          !s.proof ||
          this.fileProofs.get(s) !== s.proof.actorId
        )
          throw new NotFoundException();
      },
    };
  }
  private attachmentView(row: MessageAttachment, file: StoredFile) {
    return c.MessageAttachmentSchema.parse({
      id: row.id,
      conversationId: row.conversationId,
      messageId: row.messageId,
      kind: row.kind,
      filename: file.filename,
      mimeType: file.mimeType,
      status: file.status,
      expectedSize: file.expectedSize,
      actualSize: file.actualSize,
      sha256: file.sha256,
      durationMs: row.durationMs,
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
      uploadExpiresAt: file.uploadExpiresAt.toISOString(),
    });
  }
  private async uploadRow(
    s: Op,
    m: ConversationMember,
    id: string,
    pendingOnly = false,
  ) {
    const row = await s.tx.messageAttachment.findFirst({
      where: { id, conversationId: s.conv.id },
    });
    if (!row) throw new NotFoundException();
    if (!row.messageId) {
      if (row.memberId !== m.id || row.generation !== m.generation)
        throw new NotFoundException();
    } else {
      if (pendingOnly)
        throw new ConflictException({ code: 'ATTACHMENT_ALREADY_LINKED' });
      const e = await this.advanced.entry(s, m, row.messageId);
      if ((await this.view(s, m, e)).state !== 'VISIBLE')
        throw new NotFoundException();
    }
    await this.fileRead(s);
    return { row, file: await this.files.row(s.tx, this.scope(s), row.fileId) };
  }
  async initiate(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.MessageAttachmentUploadSchema>,
    key: string | undefined,
  ) {
    const body = c.MessageAttachmentUploadSchema.parse(input),
      keyHash = messageKey(key),
      fingerprint = messageFingerprint(body);
    return this.base.operation(
      actor,
      id,
      'messaging.attachment.initiate',
      async (s) => {
        const m = await this.base.currentMember(s);
        await this.advanced.writer(s);
        const old = await s.tx.messageAttachment.findUnique({
          where: {
            conversationId_memberId_generation_keyHash: {
              conversationId: id,
              memberId: m.id,
              generation: m.generation,
              keyHash,
            },
          },
        });
        if (old) {
          if (old.fingerprint !== fingerprint)
            throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
          const item = await this.uploadRow(s, m, old.id);
          return this.attachmentView(item.row, item.file);
        }
        if (await s.tx.messageAttachment.findUnique({ where: { id: body.id } }))
          throw new ConflictException();
        await this.fileRead(s);
        const file = await this.files.initiate(
          s.tx,
          this.scope(s),
          body.id,
          body,
          s.now,
        );
        const row = await s.tx.messageAttachment.create({
          data: {
            id: body.id,
            fileId: file.id,
            spaceId: s.conv.spaceId,
            scopeId: s.conv.scopeId,
            conversationId: id,
            memberId: m.id,
            generation: m.generation,
            kind: body.kind,
            keyHash,
            fingerprint,
          },
        });
        await this.base.effect(
          s,
          'messaging.attachment.initiate',
          row.id,
          'file.shared',
        );
        return this.attachmentView(row, file);
      },
    );
  }
  status(actor: RequestActor, id: string, attachmentId: string) {
    return this.base.operation(
      actor,
      id,
      'messaging.attachment.read',
      async (s) => {
        const m = await this.base.currentMember(s),
          item = await this.uploadRow(s, m, attachmentId);
        return this.attachmentView(item.row, item.file);
      },
    );
  }
  async complete(
    actor: RequestActor,
    id: string,
    attachmentId: string,
    source: Readable,
    length?: string,
  ) {
    const claim = await this.base.operation(
      actor,
      id,
      'messaging.attachment.claim',
      async (s) => {
        const m = await this.base.currentMember(s);
        await this.advanced.writer(s);
        const item = await this.uploadRow(s, m, attachmentId, true);
        const ticket = await this.files.claim(
          s.tx,
          this.scope(s),
          attachmentId,
          s.now,
        );
        await this.base.effect(s, 'messaging.attachment.claim', attachmentId);
        return { ticket, voice: item.row.kind === 'VOICE' };
      },
    );
    const abort = new AbortController(),
      timer = setTimeout(
        () => abort.abort(),
        this.config.FILE_UPLOAD_TIMEOUT_MS,
      );
    timer.unref();
    const disconnected = () => abort.abort();
    source.once('aborted', disconnected);
    try {
      const evidence = await this.files.write(
        claim.ticket,
        source,
        length,
        abort.signal,
        claim.voice
          ? { maxDurationMs: 120000, maxBytes: 10000000, communication: true }
          : { communication: true },
      );
      return await this.base.operation(
        actor,
        id,
        'messaging.attachment.ready',
        async (s) => {
          const m = await this.base.currentMember(s);
          await this.advanced.writer(s);
          const item = await this.uploadRow(s, m, attachmentId, true);
          const file = await this.files.ready(
            s.tx,
            this.scope(s),
            claim.ticket,
            evidence,
            s.now,
          );
          const row = await s.tx.messageAttachment.update({
            where: { id: attachmentId },
            data: {
              durationMs: evidence.durationMs ?? null,
              revision: { increment: 1 },
            },
          });
          if (
            item.row.kind === 'VOICE' &&
            (evidence.durationMs === undefined ||
              evidence.durationMs > 120000 ||
              evidence.size > 10000000)
          )
            throw new BadRequestException();
          await this.base.effect(s, 'messaging.attachment.ready', attachmentId);
          return this.attachmentView(row, file);
        },
      );
    } catch (error) {
      const rejected = await this.base
        .operation(actor, id, 'messaging.attachment.reject', async (s) => {
          const m = await this.base.currentMember(s);
          await this.uploadRow(s, m, attachmentId, true);
          const row = await this.files.reject(
            s.tx,
            this.scope(s),
            attachmentId,
            claim.ticket.attempt,
          );
          if (row)
            await this.base.effect(
              s,
              'messaging.attachment.reject',
              attachmentId,
            );
          return row;
        })
        .catch(() => null);
      if (rejected)
        try {
          await this.files.remove(rejected);
          await this.base.operation(
            actor,
            id,
            'messaging.attachment.cleanup',
            async (s) => {
              const m = await this.base.currentMember(s);
              await this.uploadRow(s, m, attachmentId, true);
              await this.files.cleanupFinished(
                s.tx,
                this.scope(s),
                attachmentId,
                claim.ticket.attempt,
              );
              await s.tx.messageAttachment.update({
                where: { id: attachmentId },
                data: { retiredAt: s.now },
              });
              await this.base.effect(
                s,
                'messaging.attachment.cleanup',
                attachmentId,
              );
            },
          );
        } catch {
          /* Reconciliation retains the private durable marker. */
        }
      throw error;
    } finally {
      clearTimeout(timer);
      source.removeListener('aborted', disconnected);
    }
  }
  async cancel(
    actor: RequestActor,
    id: string,
    attachmentId: string,
    expected: number | undefined,
  ) {
    const file = await this.base.operation(
      actor,
      id,
      'messaging.attachment.cancel',
      async (s) => {
        const m = await this.base.currentMember(s),
          item = await this.uploadRow(s, m, attachmentId, true);
        messageVersion(expected, item.row.revision);
        const deleted = await this.files.deleted(
          s.tx,
          this.scope(s),
          attachmentId,
          item.file.revision,
          s.now,
        );
        await s.tx.messageAttachment.update({
          where: { id: attachmentId },
          data: { revision: { increment: 1 } },
        });
        await this.base.effect(s, 'messaging.attachment.cancel', attachmentId);
        return deleted;
      },
    );
    // Concurrent stream publication remains INITIATED/DELETED with its attempt marker;
    // maintenance removes it after the established upload deadline if still live.
    if (!file.uploadAttemptId) {
      await this.files.remove(file);
      await this.base.operation(
        actor,
        id,
        'messaging.attachment.cleanup',
        async (s) => {
          const m = await this.base.currentMember(s);
          await this.uploadRow(s, m, attachmentId, true);
          await this.files.cleanupFinished(
            s.tx,
            this.scope(s),
            attachmentId,
            null,
          );
          await s.tx.messageAttachment.update({
            where: { id: attachmentId },
            data: { retiredAt: s.now },
          });
          await this.base.effect(
            s,
            'messaging.attachment.cleanup',
            attachmentId,
          );
        },
      );
    }
    return this.status(actor, id, attachmentId);
  }
  async mentions(s: Op, ids: string[], sequence: bigint, messageId: string) {
    for (const memberId of new Set(ids)) {
      const target = await s.tx.conversationMember.findFirst({
        where: { id: memberId, conversationId: s.conv.id, state: 'ACTIVE' },
      });
      if (!target) throw new NotFoundException();
      const user = await this.authority.user(
          s.tx,
          s.conv.spaceId,
          target.actorId,
        ),
        member = await this.base.currentMember(
          s,
          await this.base.proof(s, user),
        );
      if (sequence <= member.historyAfter) throw new NotFoundException();
      if (
        user !== s.actor.userId &&
        !(await this.base.contacts.allowed(
          s.tx,
          s.actor.userId,
          user,
          s.locked,
        ))
      )
        continue;
      await s.tx.messageMention.create({
        data: {
          conversationId: s.conv.id,
          messageId,
          memberId,
          generation: member.generation,
        },
      });
    }
  }
  async view(s: Op, m: ConversationMember, e: MessageEntry) {
    const safety = await this.advanced.safety(s, m, e);
    let leaf = await this.advanced.leaf(s, m, e);
    if (leaf?.e.kind === 'MEDIA')
      leaf = await this.advanced.leaf(s, m, e, 0, (op) => this.fileRead(op));
    let text: string | null = null,
      attachments: z.infer<typeof c.MessageAttachmentSchema>[] = [],
      available = !!leaf;
    if (leaf) {
      if (leaf.e.kind === 'TEXT')
        text = (
          await s.tx.conversationMessage.findUniqueOrThrow({
            where: { id: leaf.e.id },
          })
        ).text;
      else {
        const media = await s.tx.messageMedia.findUnique({
            where: { messageId: leaf.e.id },
          }),
          rows = await s.tx.messageAttachment.findMany({
            where: { conversationId: leaf.s.conv.id, messageId: leaf.e.id },
            orderBy: { id: 'asc' },
            take: 6,
          });
        if (!media || !rows.length || rows.length > 5) available = false;
        else
          for (const row of rows) {
            const file = await this.files.row(
              s.tx,
              this.scope(leaf.s),
              row.fileId,
            );
            if (file.status !== 'READY') {
              available = false;
              break;
            }
            attachments.push(this.attachmentView(row, file));
          }
        text = media?.caption ?? null;
      }
    }
    if (!available) {
      text = null;
      attachments = [];
    }
    const parent = e.replyToId
      ? await s.tx.messageEntry.findFirst({
          where: {
            id: e.replyToId,
            conversationId: s.conv.id,
            sequence: { gt: m.historyAfter },
          },
        })
      : null;
    const root = e.threadId
      ? await s.tx.messageEntry.findFirst({
          where: {
            id: e.threadId,
            conversationId: s.conv.id,
            sequence: { gt: m.historyAfter },
          },
        })
      : null;
    return c.RichMessageSchema.parse({
      ...(await this.advanced.decorations(s, m, e, available)),
      id: e.id,
      conversationId: e.conversationId,
      sequence: String(e.sequence),
      kind: e.kind,
      state: safety === 'VISIBLE' && !available ? 'UNAVAILABLE' : safety,
      revision: e.revision,
      memberId: e.memberId,
      createdAt: e.createdAt.toISOString(),
      text,
      attachments,
      replyToId: available ? (parent?.id ?? null) : null,
      threadId: available ? (root?.id ?? null) : null,
      sourceId: available && e.kind === 'FORWARD' ? e.sourceId : null,
      sourceConversationId:
        available && e.kind === 'FORWARD' ? e.sourceConversationId : null,
    });
  }
  async create(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.MediaMessageCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.MediaMessageCreateSchema.parse(input),
      keyHash = messageKey(key),
      fingerprint = messageFingerprint(body);
    return this.advanced.run(
      actor,
      id,
      'messaging.media.send',
      async (s, m) => {
        await this.advanced.writer(s);
        const identity = {
          conversationId: id,
          memberId: m.id,
          generation: m.generation,
          keyHash,
        };
        const old = await s.tx.messageMutation.findUnique({
          where: { conversationId_memberId_generation_keyHash: identity },
        });
        if (old) {
          if (old.fingerprint !== fingerprint)
            throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
          return this.view(
            s,
            m,
            await this.advanced.entry(s, m, old.resourceId),
          );
        }
        if (await s.tx.messageEntry.findUnique({ where: { id: body.id } }))
          throw new ConflictException();
        const uploads = [];
        for (const attachmentId of body.attachments) {
          const item = await this.uploadRow(s, m, attachmentId, true);
          if (item.file.status !== 'READY')
            throw new ConflictException({ code: 'ATTACHMENT_NOT_READY' });
          uploads.push(item.row);
        }
        if (uploads.some((v) => v.kind === 'VOICE') && uploads.length !== 1)
          throw new BadRequestException({
            code: 'VOICE_MESSAGE_SINGLE_ATTACHMENT',
          });
        let parent: MessageEntry | null = null;
        if (body.replyToId) {
          parent = await this.advanced.entry(s, m, body.replyToId);
          if ((await this.view(s, m, parent)).state !== 'VISIBLE')
            throw new NotFoundException();
        }
        const conv = await s.tx.conversation.update({
          where: { id },
          data: { lastSequence: { increment: 1 } },
        });
        const entry = await s.tx.messageEntry.create({
          data: {
            id: body.id,
            conversationId: id,
            sequence: conv.lastSequence,
            memberId: m.id,
            memberGeneration: m.generation,
            kind: 'MEDIA',
            replyToId: parent?.id ?? null,
            threadId: parent ? (parent.threadId ?? parent.id) : null,
          },
        });
        await s.tx.messageMedia.create({
          data: { messageId: entry.id, caption: body.caption },
        });
        for (const upload of uploads)
          await s.tx.messageAttachment.update({
            where: { id: upload.id },
            data: { messageId: entry.id, revision: { increment: 1 } },
          });
        await this.mentions(s, body.mentions, entry.sequence, entry.id);
        await this.advanced.change(s, entry, 'CREATE');
        await s.tx.messageMutation.create({
          data: {
            ...identity,
            fingerprint,
            resourceId: entry.id,
            action: 'media',
          },
        });
        await this.base.effect(
          s,
          'messaging.media.send',
          entry.id,
          'messaging.message',
        );
        return this.view(s, m, entry);
      },
    );
  }
  async forward(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.MediaForwardSchema>,
    key: string | undefined,
  ) {
    const body = c.MediaForwardSchema.parse(input),
      keyHash = messageKey(key),
      fingerprint = messageFingerprint(body);
    return this.advanced.run(
      actor,
      id,
      'messaging.media.forward',
      async (s, m) => {
        await this.advanced.writer(s);
        const conv = await s.tx.conversation.findUnique({
          where: { id: body.sourceConversationId },
        });
        if (!conv) throw new NotFoundException();
        const op: Op = { ...s, conv, proof: null };
        op.proof = await this.base.proof(op);
        const sm = await this.base.currentMember(op),
          source = await this.advanced.entry(op, sm, body.sourceId);
        if ((await this.view(op, sm, source)).state !== 'VISIBLE')
          throw new NotFoundException();
        let tail = source,
          depth = 1;
        while (tail.kind === 'FORWARD') {
          if (++depth > 8)
            throw new BadRequestException({ code: 'FORWARD_DEPTH_LIMIT' });
          tail = await s.tx.messageEntry.findUniqueOrThrow({
            where: { id: tail.sourceId! },
          });
        }
        const identity = {
            conversationId: id,
            memberId: m.id,
            generation: m.generation,
            keyHash,
          },
          old = await s.tx.messageMutation.findUnique({
            where: { conversationId_memberId_generation_keyHash: identity },
          });
        if (old) {
          if (old.fingerprint !== fingerprint) throw new ConflictException();
          return this.view(
            s,
            m,
            await this.advanced.entry(s, m, old.resourceId),
          );
        }
        if (await s.tx.messageEntry.findUnique({ where: { id: body.id } }))
          throw new ConflictException();
        const target = await s.tx.conversation.update({
          where: { id },
          data: { lastSequence: { increment: 1 } },
        });
        const entry = await s.tx.messageEntry.create({
          data: {
            id: body.id,
            conversationId: id,
            sequence: target.lastSequence,
            memberId: m.id,
            memberGeneration: m.generation,
            kind: 'FORWARD',
            sourceId: source.id,
            sourceConversationId: conv.id,
          },
        });
        await this.advanced.change(s, entry, 'CREATE');
        await s.tx.messageMutation.create({
          data: {
            ...identity,
            fingerprint,
            resourceId: entry.id,
            action: 'media.forward',
          },
        });
        await this.base.effect(
          s,
          'messaging.media.forward',
          entry.id,
          'messaging.message',
        );
        return this.view(s, m, entry);
      },
      [body.sourceConversationId],
    );
  }
  async edit(
    actor: RequestActor,
    id: string,
    messageId: string,
    caption: string | null,
    key: string | undefined,
    expected: number | undefined,
  ) {
    const body = c.MediaMessageEditSchema.parse({ caption }),
      keyHash = messageKey(key),
      fingerprint = messageFingerprint({ messageId, ...body });
    return this.advanced.run(
      actor,
      id,
      'messaging.media.edit',
      async (s, m) => {
        await this.advanced.writer(s);
        const e = await this.advanced.entry(s, m, messageId);
        if (
          e.kind !== 'MEDIA' ||
          e.memberId !== m.id ||
          e.memberGeneration !== m.generation
        )
          throw new ForbiddenException();
        if ((await this.view(s, m, e)).state !== 'VISIBLE')
          throw new NotFoundException();
        const identity = {
            conversationId: id,
            memberId: m.id,
            generation: m.generation,
            keyHash,
          },
          old = await s.tx.messageMutation.findUnique({
            where: { conversationId_memberId_generation_keyHash: identity },
          });
        if (old) {
          if (old.fingerprint !== fingerprint) throw new ConflictException();
          return this.view(s, m, e);
        }
        messageVersion(expected, e.revision);
        if (!authorWindowOpen(e.createdAt, s.now))
          throw new ForbiddenException({ code: 'AUTHOR_WINDOW_CLOSED' });
        const media = await s.tx.messageMedia.findUniqueOrThrow({
          where: { messageId },
        });
        await s.tx.messageMediaRevision.create({
          data: {
            messageId,
            revision: e.revision,
            caption: media.caption,
            editedAt: s.now,
          },
        });
        await s.tx.messageMedia.update({
          where: { messageId },
          data: { caption: body.caption },
        });
        const next = await this.advanced.bump(s, e);
        await this.advanced.change(s, next, 'EDIT');
        await s.tx.messageMutation.create({
          data: {
            ...identity,
            fingerprint,
            resourceId: messageId,
            action: 'media.edit',
          },
        });
        await this.base.effect(s, 'messaging.media.edit', messageId);
        return this.view(s, m, next);
      },
    );
  }
  detail(actor: RequestActor, id: string, messageId: string) {
    return this.advanced.run(actor, id, 'messaging.media.read', async (s, m) =>
      this.view(s, m, await this.advanced.entry(s, m, messageId)),
    );
  }
  private position(
    actor: RequestActor,
    context: string,
    stamp: string,
    q: Page,
    floor: bigint,
    max: bigint,
  ) {
    const p = this.kernel.opaquePosition(
      context,
      stamp,
      actor.userId,
      q.cursor,
    );
    if (p !== undefined && !/^(0|[1-9][0-9]{0,18})$/.test(p))
      throw new BadRequestException();
    const after = p === undefined ? floor : BigInt(p);
    if (after < floor || after > max) throw new BadRequestException();
    return after;
  }
  timeline(
    actor: RequestActor,
    id: string,
    q: Page,
    filter: { search?: string; thread?: string } = {},
  ) {
    return this.advanced.run(
      actor,
      id,
      'messaging.media.timeline',
      async (s, m, stamp) => {
        const anchor = filter.thread
            ? await this.advanced.entry(s, m, filter.thread)
            : null,
          root = anchor ? (anchor.threadId ?? anchor.id) : undefined,
          context = 'rich-history:' + id + ':' + messageFingerprint(filter),
          after = this.position(
            actor,
            context,
            stamp,
            q,
            m.historyAfter,
            s.conv.lastSequence,
          );
        const rows = await s.tx.messageEntry.findMany({
            where: {
              conversationId: id,
              sequence: { gt: after },
              ...(root ? { OR: [{ id: root }, { threadId: root }] } : {}),
            },
            orderBy: { sequence: 'asc' },
            take: q.limit + 1,
          }),
          selected = rows.slice(0, q.limit),
          items = [];
        for (const e of selected) {
          const value = await this.view(s, m, e);
          if (value.state === 'HIDDEN') continue;
          if (
            filter.search &&
            ![
              value.text ?? '',
              ...value.attachments.map((v) => v.filename),
            ].some((v) =>
              v
                .toLocaleLowerCase('und')
                .includes(filter.search!.toLocaleLowerCase('und')),
            )
          )
            continue;
          items.push(value);
        }
        return c.RichMessagePageSchema.parse({
          items,
          nextCursor: this.kernel.opaqueCursor(
            context,
            stamp,
            actor.userId,
            String(selected.at(-1)?.sequence ?? after),
          ),
          hasMore: rows.length > q.limit,
          changeCursor: this.kernel.opaqueCursor(
            'rich-changes:' + id,
            stamp,
            actor.userId,
            String(s.conv.lastChangeSequence),
          ),
        });
      },
    );
  }
  /** Finite current-authority bootstrap. Preserve the first mutation position
   * across every snapshot page so concurrent edits cannot fall between feeds. */
  recovery(actor: RequestActor, id: string, q: Page) {
    return this.advanced.run(
      actor,
      id,
      'messaging.recovery',
      async (s, m, stamp) => {
        const context = 'rich-recovery:' + id,
          p = this.kernel.opaquePosition(
            context,
            stamp,
            actor.userId,
            q.cursor,
          );
        let after = m.historyAfter,
          through = s.conv.lastSequence,
          change = s.conv.lastChangeSequence;
        if (p !== undefined) {
          if (
            !/^(0|[1-9][0-9]{0,18}):(0|[1-9][0-9]{0,18}):(0|[1-9][0-9]{0,18})$/.test(
              p,
            )
          )
            throw new BadRequestException();
          [after, through, change] = p.split(':').map(BigInt) as [
            bigint,
            bigint,
            bigint,
          ];
        }
        if (
          after < m.historyAfter ||
          after > through ||
          through > s.conv.lastSequence ||
          change > s.conv.lastChangeSequence
        )
          throw new BadRequestException();
        const rows = await s.tx.messageEntry.findMany({
            where: {
              conversationId: id,
              sequence: { gt: after, lte: through },
            },
            orderBy: { sequence: 'asc' },
            take: q.limit + 1,
          }),
          selected = rows.slice(0, q.limit),
          items = [];
        for (const row of selected) {
          const message = await this.view(s, m, row);
          if (message.state !== 'HIDDEN') items.push(message);
        }
        const hasMore = rows.length > q.limit;
        return c.MessageRecoveryPageSchema.parse({
          items,
          hasMore,
          throughSequence: String(through),
          nextCursor: hasMore
            ? this.kernel.opaqueCursor(
                context,
                stamp,
                actor.userId,
                [selected.at(-1)!.sequence, through, change].join(':'),
              )
            : null,
          changeCursor: this.kernel.opaqueCursor(
            'rich-changes:' + id,
            stamp,
            actor.userId,
            String(change),
          ),
        });
      },
    );
  }
  changes(actor: RequestActor, id: string, q: Page) {
    return this.advanced.run(
      actor,
      id,
      'messaging.media.changes',
      async (s, m, stamp) => {
        const context = 'rich-changes:' + id,
          after = this.position(
            actor,
            context,
            stamp,
            q,
            0n,
            s.conv.lastChangeSequence,
          ),
          rows = await s.tx.messageChange.findMany({
            where: {
              conversationId: id,
              sequence: { gt: after },
              OR: [{ audienceId: null }, { audienceId: m.id }],
              message: { sequence: { gt: m.historyAfter } },
            },
            include: { message: true },
            orderBy: { sequence: 'asc' },
            take: q.limit + 1,
          }),
          selected = rows.slice(0, q.limit);
        return c.RichMessageChangesSchema.parse({
          items: await Promise.all(
            selected.map(async (v) => ({
              sequence: String(v.sequence),
              kind: v.kind,
              message: await this.view(s, m, v.message),
            })),
          ),
          nextCursor: this.kernel.opaqueCursor(
            context,
            stamp,
            actor.userId,
            String(selected.at(-1)?.sequence ?? s.conv.lastChangeSequence),
          ),
          hasMore: rows.length > q.limit,
        });
      },
    );
  }
  async download(
    actor: RequestActor,
    id: string,
    messageId: string,
    attachmentId: string,
  ) {
    const locate = () =>
      this.advanced.run(
        actor,
        id,
        'messaging.attachment.download',
        async (s, m) => {
          const e = await this.advanced.entry(s, m, messageId),
            leaf = await this.advanced.leaf(s, m, e, 0, (op) =>
              this.fileRead(op),
            );
          if (!leaf) throw new NotFoundException();
          const attachment = await s.tx.messageAttachment.findFirst({
            where: {
              id: attachmentId,
              conversationId: leaf.s.conv.id,
              messageId: leaf.e.id,
            },
          });
          if (!attachment) throw new NotFoundException();
          const file = await this.files.row(
            s.tx,
            this.scope(leaf.s),
            attachment.fileId,
          );
          if (file.status !== 'READY') throw new NotFoundException();
          return { file, attachment };
        },
      );
    const before = await locate(),
      stream = await this.files.open(before.file, true);
    try {
      const after = await locate();
      if (
        after.file.revision !== before.file.revision ||
        after.attachment.revision !== before.attachment.revision
      )
        throw new NotFoundException();
      return {
        stream,
        file: this.attachmentView(after.attachment, after.file),
      };
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }
  revisions(actor: RequestActor, id: string, messageId: string, q: Page) {
    return this.advanced.run(
      actor,
      id,
      'messaging.media.revisions',
      async (s, m, stamp) => {
        const e = await this.advanced.entry(s, m, messageId);
        if (
          e.kind !== 'MEDIA' ||
          e.memberId !== m.id ||
          e.memberGeneration !== m.generation
        )
          throw new ForbiddenException();
        if ((await this.view(s, m, e)).state !== 'VISIBLE')
          throw new NotFoundException();
        const context = 'media-revisions:' + messageId,
          after = this.position(
            actor,
            context,
            stamp,
            q,
            0n,
            BigInt(e.revision),
          ),
          rows = await s.tx.messageMediaRevision.findMany({
            where: { messageId, revision: { gt: Number(after) } },
            orderBy: { revision: 'asc' },
            take: q.limit + 1,
          });
        return c.MessageMediaRevisionPageSchema.parse({
          items: rows.slice(0, q.limit).map((v) => ({
            revision: v.revision,
            caption: v.caption,
            editedAt: v.editedAt.toISOString(),
          })),
          nextCursor:
            rows.length > q.limit
              ? this.kernel.opaqueCursor(
                  context,
                  stamp,
                  actor.userId,
                  String(rows[q.limit - 1]!.revision),
                )
              : null,
          hasMore: rows.length > q.limit,
        });
      },
    );
  }
}
