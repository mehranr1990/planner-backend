import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  MessageEntry,
  ConversationMember,
} from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { SharedKernel, MessagingAuthority } from '../../spaces/public/index.js';
import {
  MessagingService,
  type MessageOperation as Op,
} from './messaging.service.js';
import {
  managesChannel,
  authorWindowOpen,
} from '../domain/messaging-policy.js';
type Action = z.infer<typeof c.AdvancedMessageActionSchema>;
type Page = z.infer<typeof c.ConversationPageQuerySchema>;
const digest = (v: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(v, (_k, x: unknown) =>
        typeof x === 'bigint' ? String(x) : x,
      ),
    )
    .digest('hex');
const hidden = (e: unknown) =>
  e instanceof NotFoundException || e instanceof ForbiddenException;
const requireVersion = (expected: number | undefined, actual: number) => {
  if (expected === undefined)
    throw new BadRequestException({ code: 'IF_MATCH_REQUIRED' });
  if (expected !== actual)
    throw new ConflictException({ code: 'REVISION_CONFLICT' });
};
@Injectable()
export class AdvancedMessagingService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(MessagingService) private readonly base: MessagingService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(MessagingAuthority) private readonly authority: MessagingAuthority,
  ) {}

  /** Predeclare every source root before entering any account/custody fence. */
  private async run<T>(
    actor: RequestActor,
    id: string,
    action: string,
    work: (s: Op, m: ConversationMember, stamp: string) => Promise<T>,
    extra: string[] = [],
  ) {
    // Locator bounds must not disclose an unauthorized conversation's existence.
    // This preliminary check grants nothing to the later transaction; it rechecks
    // every authority after globally ordered locks have been acquired.
    for (const locator of new Set([id, ...extra]))
      await this.base.operation(
        actor,
        locator,
        'messaging.advanced.locate',
        async (s) => {
          await this.base.currentMember(s);
        },
      );
    const graph = new Set([id, ...extra]);
    const visited = new Set<string>();
    while ([...graph].some((v) => !visited.has(v))) {
      const batch = [...graph].filter((v) => !visited.has(v));
      batch.forEach((v) => visited.add(v));
      const dependencies = await this.db.client.messageEntry.findMany({
        where: { conversationId: { in: batch }, kind: 'FORWARD' },
        distinct: ['sourceConversationId'],
        select: { sourceConversationId: true },
        take: 34,
      });
      for (const row of dependencies)
        if (row.sourceConversationId) graph.add(row.sourceConversationId);
      if (graph.size > 33)
        throw new PayloadTooLargeException({ code: 'FORWARD_SOURCE_LIMIT' });
    }
    const sources = [...graph].filter((v) => v !== id).sort();
    if (sources.length > 32)
      throw new PayloadTooLargeException({ code: 'FORWARD_SOURCE_LIMIT' });
    return this.base.operation(
      actor,
      id,
      action,
      async (s) => {
        const m = await this.base.currentMember(s);
        const actual = await s.tx.messageEntry.findMany({
          where: { conversationId: { in: [id, ...sources] }, kind: 'FORWARD' },
          distinct: ['sourceConversationId'],
          select: { sourceConversationId: true },
          take: 34,
        });
        if (
          actual.some(
            (v) =>
              v.sourceConversationId !== id &&
              !sources.includes(v.sourceConversationId!),
          )
        )
          throw new ConflictException({ code: 'SOURCE_SET_CHANGED_RETRY' });
        const frames = [];
        for (const source of sources) {
          const conv = await s.tx.conversation.findUnique({
            where: { id: source },
          });
          frames.push(
            conv
              ? {
                  id: source,
                  change: conv.lastChangeSequence,
                  frame: await this.authority.frame(
                    s.tx,
                    conv.scopeId,
                    actor.userId,
                  ),
                  member: await s.tx.conversationMember.findMany({
                    where: { conversationId: source },
                    orderBy: { id: 'asc' },
                    select: {
                      id: true,
                      actorId: true,
                      state: true,
                      generation: true,
                      sourceAccessId: true,
                      sourceGeneration: true,
                      restoreGeneration: true,
                      historyAfter: true,
                    },
                  }),
                }
              : { id: source, missing: true },
          );
        }
        return work(
          s,
          m,
          digest({
            m,
            restore: s.proof!.restoreGeneration,
            policy: s.proof!.policyVersion,
            role: s.proof!.role,
            frames,
          }),
        );
      },
      [],
      false,
      sources,
    );
  }
  private async entry(s: Op, m: ConversationMember, id: string) {
    const e = await s.tx.messageEntry.findFirst({
      where: {
        id,
        conversationId: s.conv.id,
        sequence: { gt: m.historyAfter },
      },
    });
    if (!e) throw new NotFoundException();
    return e;
  }
  private async safety(s: Op, m: ConversationMember, e: MessageEntry) {
    if (e.deletedAt) return 'DELETED' as const;
    if (
      await s.tx.messageHidden.findUnique({
        where: { messageId_memberId: { messageId: e.id, memberId: m.id } },
      })
    )
      return 'HIDDEN' as const;
    return 'VISIBLE' as const;
  }
  private async content(
    s: Op,
    m: ConversationMember,
    e: MessageEntry,
    depth = 0,
  ): Promise<{
    text: string;
    sourceId: string | null;
    sourceConversationId: string | null;
    sourceMemberId: string | null;
  } | null> {
    if (depth > 8) return null;
    if ((await this.safety(s, m, e)) !== 'VISIBLE') return null;
    if (e.kind === 'TEXT') {
      const text = await s.tx.conversationMessage.findUniqueOrThrow({
        where: { id: e.id },
      });
      return {
        text: text.text,
        sourceId: null,
        sourceConversationId: null,
        sourceMemberId: null,
      };
    }
    try {
      const conv = await s.tx.conversation.findUnique({
        where: { id: e.sourceConversationId! },
      });
      if (!conv) return null;
      const source: Op = { ...s, conv, proof: null };
      source.proof = await this.base.proof(source);
      const member = await this.base.currentMember(source);
      const original = await this.entry(source, member, e.sourceId!);
      const content = await this.content(source, member, original, depth + 1);
      return content
        ? {
            text: content.text,
            sourceId: original.id,
            sourceConversationId: conv.id,
            sourceMemberId: original.memberId,
          }
        : null;
    } catch (error) {
      if (hidden(error)) return null;
      throw error;
    }
  }
  private async projection(s: Op, m: ConversationMember, e: MessageEntry) {
    const safety = await this.safety(s, m, e),
      content = await this.content(s, m, e);
    const state = safety === 'VISIBLE' && !content ? 'UNAVAILABLE' : safety;
    const reactions = content
      ? await s.tx.messageReaction.findMany({
          where: { messageId: e.id, active: true },
          orderBy: [{ emoji: 'asc' }, { memberId: 'asc' }],
          take: 20001,
        })
      : [];
    if (reactions.length > 20000) throw new PayloadTooLargeException();
    const grouped = new Map<
      string,
      { emoji: string; count: number; mine: boolean }
    >();
    for (const row of reactions) {
      const value = grouped.get(row.emoji) ?? {
        emoji: row.emoji,
        count: 0,
        mine: false,
      };
      value.count++;
      value.mine ||= row.memberId === m.id;
      grouped.set(row.emoji, value);
    }
    const mentions = content
      ? await s.tx.messageMention.findMany({
          where: { messageId: e.id },
          orderBy: { memberId: 'asc' },
          take: 50,
        })
      : [];
    const parent =
      content && e.replyToId
        ? await s.tx.messageEntry.findFirst({
            where: {
              id: e.replyToId,
              conversationId: s.conv.id,
              sequence: { gt: m.historyAfter },
            },
          })
        : null;
    const root =
      content && e.threadId
        ? await s.tx.messageEntry.findFirst({
            where: {
              id: e.threadId,
              conversationId: s.conv.id,
              sequence: { gt: m.historyAfter },
            },
          })
        : null;
    return c.AdvancedMessageSchema.parse({
      id: e.id,
      conversationId: e.conversationId,
      sequence: String(e.sequence),
      kind: e.kind,
      state,
      revision: e.revision,
      memberId: e.memberId,
      createdAt: e.createdAt.toISOString(),
      replyToId: parent?.id ?? null,
      threadId: root?.id ?? null,
      content,
      reactions: [...grouped.values()],
      mentions: mentions.map((v) => v.memberId),
      pinned:
        !!content &&
        !!(await s.tx.messagePin.findFirst({
          where: { messageId: e.id, active: true },
        })),
    });
  }
  private async requireVisible(s: Op, m: ConversationMember, e: MessageEntry) {
    if (!(await this.content(s, m, e))) throw new NotFoundException();
  }
  private async writer(s: Op) {
    if (!(await this.base.writable(s)))
      throw new ForbiddenException({ code: 'CONVERSATION_READ_ONLY' });
  }
  private async moderator(s: Op, m: ConversationMember, dm = false) {
    if (s.proof?.role === 'VIEWER') throw new ForbiddenException();
    if (s.conv.kind === 'DM') {
      if (!dm) throw new ForbiddenException();
      await this.writer(s);
      return;
    }
    if (
      s.conv.kind === 'PRIVATE_GROUP'
        ? m.role !== 'ADMIN'
        : !managesChannel(s.conv.kind, s.proof!.role)
    )
      throw new ForbiddenException();
  }
  private async change(
    s: Op,
    e: MessageEntry,
    kind:
      'EDIT' | 'DELETE' | 'HIDE' | 'REACTION' | 'PIN' | 'MENTION' | 'CREATE',
    audienceId: string | null = null,
  ) {
    const conv = await s.tx.conversation.update({
      where: { id: s.conv.id },
      data: { lastChangeSequence: { increment: 1 } },
    });
    await s.tx.messageChange.create({
      data: {
        conversationId: conv.id,
        sequence: conv.lastChangeSequence,
        messageId: e.id,
        kind,
        audienceId,
      },
    });
  }
  private async bump(s: Op, e: MessageEntry) {
    return s.tx.messageEntry.update({
      where: { id: e.id },
      data: { revision: { increment: 1 } },
    });
  }
  private within(s: Op, e: MessageEntry) {
    if (!authorWindowOpen(e.createdAt, s.now))
      throw new ForbiddenException({ code: 'AUTHOR_WINDOW_CLOSED' });
  }

  async act(
    actor: RequestActor,
    id: string,
    input: Action,
    key: string | undefined,
    expected?: number,
  ) {
    const a = c.AdvancedMessageActionSchema.parse(input);
    if (!key || !/^[\x21-\x7e]{1,128}$/.test(key))
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    const keyHash = digest(key),
      fingerprint = digest(a);
    return this.run(
      actor,
      id,
      'messaging.' + a.action.replaceAll('-', '.'),
      async (s, m) => {
        if (
          !['hide', 'report', 'resolve-report', 'moderate', 'policy'].includes(
            a.action,
          )
        )
          await this.writer(s);
        if (a.action === 'pin') await this.moderator(s, m, true);
        if (['moderate', 'resolve-report', 'policy'].includes(a.action))
          await this.moderator(s, m);
        if (
          a.action === 'policy' &&
          ['DM', 'PRIVATE_GROUP'].includes(s.conv.kind)
        )
          throw new ForbiddenException();
        let source: MessageEntry | undefined;
        if (a.action === 'forward') {
          const conv = await s.tx.conversation.findUnique({
            where: { id: a.sourceConversationId },
          });
          if (!conv) throw new NotFoundException();
          const op: Op = { ...s, conv, proof: null };
          op.proof = await this.base.proof(op);
          const sm = await this.base.currentMember(op);
          source = await this.entry(op, sm, a.sourceId);
          await this.requireVisible(op, sm, source);
          let tail = source,
            depth = 1;
          while (tail.kind === 'FORWARD') {
            if (++depth > 8)
              throw new PayloadTooLargeException({
                code: 'FORWARD_DEPTH_LIMIT',
              });
            tail = await s.tx.messageEntry.findUniqueOrThrow({
              where: { id: tail.sourceId! },
            });
          }
        }
        const receiptWhere = {
          conversationId: id,
          memberId: m.id,
          generation: m.generation,
          keyHash,
        };
        const old = await s.tx.messageMutation.findUnique({
          where: { conversationId_memberId_generation_keyHash: receiptWhere },
        });
        if (old) {
          if (old.fingerprint !== fingerprint)
            throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
          return c.AdvancedMessageResultSchema.parse({
            resourceId: old.resourceId,
            revision: null,
          });
        }
        let resourceId = id,
          revision: number | null = null;
        if (a.action === 'compose' || a.action === 'forward') {
          if (await s.tx.messageEntry.findUnique({ where: { id: a.id } }))
            throw new ConflictException({ code: 'MESSAGE_ID_CONFLICT' });
          const conv = await s.tx.conversation.update({
            where: { id },
            data: { lastSequence: { increment: 1 } },
          });
          if (a.action === 'compose') {
            let reply: MessageEntry | null = null;
            if (a.replyToId) {
              reply = await this.entry(s, m, a.replyToId);
              await this.requireVisible(s, m, reply);
            }
            const mentionIds = [...new Set(a.mentions)];
            for (const memberId of mentionIds) {
              const target = await s.tx.conversationMember.findFirst({
                where: { id: memberId, conversationId: id, state: 'ACTIVE' },
              });
              if (!target) throw new NotFoundException();
              const user = await this.authority.user(
                s.tx,
                s.conv.spaceId,
                target.actorId,
              );
              const valid = await this.base.currentMember(
                s,
                await this.base.proof(s, user),
              );
              if (conv.lastSequence <= valid.historyAfter)
                throw new NotFoundException();
            }
            await s.tx.conversationMessage.create({
              data: {
                id: a.id,
                spaceId: conv.spaceId,
                scopeId: conv.scopeId,
                conversationId: id,
                sequence: conv.lastSequence,
                memberId: m.id,
                memberGeneration: m.generation,
                text: a.text,
                keyHash,
                fingerprint,
              },
            });
            if (reply)
              await s.tx.messageEntry.update({
                where: { id: a.id },
                data: {
                  replyToId: reply.id,
                  threadId: reply.threadId ?? reply.id,
                },
              });
            for (const memberId of mentionIds) {
              const target = await s.tx.conversationMember.findUniqueOrThrow({
                where: { id: memberId },
              });
              await s.tx.messageMention.create({
                data: {
                  conversationId: id,
                  messageId: a.id,
                  memberId,
                  generation: target.generation,
                },
              });
            }
          } else {
            const entry = await s.tx.messageEntry.create({
              data: {
                id: a.id,
                conversationId: id,
                sequence: conv.lastSequence,
                memberId: m.id,
                memberGeneration: m.generation,
                kind: 'FORWARD',
                sourceId: source!.id,
                sourceConversationId: source!.conversationId,
              },
            });
            await this.change(s, entry, 'CREATE');
          }
          resourceId = a.id;
          revision = 1;
        } else if (a.action === 'policy') {
          requireVersion(expected, s.conv.messagePolicyRevision);
          revision = s.conv.messagePolicyRevision + 1;
          await s.tx.messagePolicy.create({
            data: {
              conversationId: id,
              revision,
              memberId: m.id,
              authorDelete: a.authorDelete,
              reason: a.reason,
            },
          });
          await s.tx.conversation.update({
            where: { id },
            data: { messagePolicyRevision: revision },
          });
        } else if (a.action === 'resolve-report') {
          const report = await s.tx.messageReport.findFirst({
            where: { id: a.reportId, conversationId: id },
          });
          if (!report) throw new NotFoundException();
          await this.entry(s, m, report.messageId);
          requireVersion(expected, report.revision);
          if (report.state !== 'OPEN') throw new ConflictException();
          const updated = await s.tx.messageReport.update({
            where: { id: report.id },
            data: {
              state: 'RESOLVED',
              resolution: a.reason,
              reviewerId: m.id,
              resolvedAt: s.now,
              revision: { increment: 1 },
            },
          });
          resourceId = report.id;
          revision = updated.revision;
        } else {
          const e = await this.entry(s, m, a.messageId);
          resourceId = e.id;
          if (a.action !== 'hide') await this.requireVisible(s, m, e);
          if (a.action === 'edit' || a.action === 'delete') {
            if (e.memberId !== m.id || e.memberGeneration !== m.generation)
              throw new ForbiddenException();
            this.within(s, e);
            requireVersion(expected, e.revision);
            if (a.action === 'edit' && e.kind !== 'TEXT')
              throw new ForbiddenException();
            if (
              a.action === 'delete' &&
              !['DM', 'PRIVATE_GROUP'].includes(s.conv.kind)
            ) {
              const policy = await s.tx.messagePolicy.findUnique({
                where: {
                  conversationId_revision: {
                    conversationId: id,
                    revision: s.conv.messagePolicyRevision,
                  },
                },
              });
              if (!policy?.authorDelete)
                throw new ForbiddenException({
                  code: 'AUTHOR_DELETE_DISABLED',
                });
            }
            if (a.action === 'edit') {
              const text = await s.tx.conversationMessage.findUniqueOrThrow({
                where: { id: e.id },
              });
              await s.tx.messageRevision.create({
                data: {
                  messageId: e.id,
                  revision: e.revision,
                  text: text.text,
                  editedAt: s.now,
                },
              });
              await s.tx.conversationMessage.update({
                where: { id: e.id },
                data: { text: a.text },
              });
            } else
              await s.tx.messageEntry.update({
                where: { id: e.id },
                data: { deletedAt: s.now, removalKind: 'AUTHOR' },
              });
            revision = (await this.bump(s, e)).revision;
            await this.change(s, e, a.action === 'edit' ? 'EDIT' : 'DELETE');
          } else if (a.action === 'moderate') {
            requireVersion(expected, e.revision);
            await s.tx.messageEntry.update({
              where: { id: e.id },
              data: { deletedAt: s.now, removalKind: 'MODERATOR' },
            });
            await s.tx.messageModeration.create({
              data: {
                id: randomUUID(),
                conversationId: id,
                messageId: e.id,
                memberId: m.id,
                reason: a.reason,
              },
            });
            revision = (await this.bump(s, e)).revision;
            await this.change(s, e, 'DELETE');
          } else if (a.action === 'hide') {
            await s.tx.messageHidden.upsert({
              where: {
                messageId_memberId: { messageId: e.id, memberId: m.id },
              },
              create: { conversationId: id, messageId: e.id, memberId: m.id },
              update: {},
            });
            await this.change(s, e, 'HIDE', m.id);
          } else if (a.action === 'reaction') {
            const emojiCount = await s.tx.messageReaction.findMany({
              where: { messageId: e.id },
              distinct: ['emoji'],
              select: { emoji: true },
              take: 101,
            });
            if (
              !emojiCount.some((v) => v.emoji === a.emoji) &&
              emojiCount.length >= 100
            )
              throw new PayloadTooLargeException();
            await s.tx.messageReaction.upsert({
              where: {
                messageId_memberId_emoji: {
                  messageId: e.id,
                  memberId: m.id,
                  emoji: a.emoji,
                },
              },
              create: {
                conversationId: id,
                messageId: e.id,
                memberId: m.id,
                emoji: a.emoji,
                active: a.active,
                updatedAt: s.now,
              },
              update: { active: a.active, updatedAt: s.now },
            });
            revision = (await this.bump(s, e)).revision;
            await this.change(s, e, 'REACTION');
          } else if (a.action === 'pin') {
            requireVersion(expected, e.revision);
            await s.tx.messagePin.upsert({
              where: { messageId: e.id },
              create: {
                conversationId: id,
                messageId: e.id,
                memberId: m.id,
                active: a.active,
                updatedAt: s.now,
              },
              update: { memberId: m.id, active: a.active, updatedAt: s.now },
            });
            revision = (await this.bump(s, e)).revision;
            await this.change(s, e, 'PIN');
          } else if (a.action === 'report') {
            if (await s.tx.messageReport.findUnique({ where: { id: a.id } }))
              throw new ConflictException();
            await s.tx.messageReport.create({
              data: {
                id: a.id,
                conversationId: id,
                messageId: e.id,
                memberId: m.id,
                generation: m.generation,
                reason: a.reason,
              },
            });
            resourceId = a.id;
            revision = 1;
          }
        }
        await s.tx.messageMutation.create({
          data: { ...receiptWhere, fingerprint, resourceId, action: a.action },
        });
        // Reasons are authorized report/moderation input, never automatic message-body snapshots.
        await this.base.effect(
          s,
          'messaging.' + a.action.replaceAll('-', '.'),
          resourceId,
          a.action === 'compose' || a.action === 'forward'
            ? 'messaging.message'
            : undefined,
        );
        return c.AdvancedMessageResultSchema.parse({ resourceId, revision });
      },
      a.action === 'forward' ? [a.sourceConversationId] : [],
    );
  }

  detail(actor: RequestActor, id: string, messageId: string) {
    return this.run(actor, id, 'messaging.detail.read', async (s, m) =>
      this.projection(s, m, await this.entry(s, m, messageId)),
    );
  }
  private position(
    context: string,
    stamp: string,
    actor: RequestActor,
    cursor: string | undefined,
    fallback: bigint,
    max: bigint,
  ) {
    const value = this.kernel.opaquePosition(
      context,
      stamp,
      actor.userId,
      cursor,
    );
    if (value !== undefined && !/^(0|[1-9][0-9]{0,18})$/.test(value))
      throw new BadRequestException();
    const after = value === undefined ? fallback : BigInt(value);
    if (after < fallback || after > max)
      throw new BadRequestException({ code: 'INVALID_CURSOR' });
    return after;
  }
  timeline(
    actor: RequestActor,
    id: string,
    q: Page,
    filter: {
      thread?: string;
      search?: string;
      pins?: boolean;
      mentions?: boolean;
    } = {},
  ) {
    return this.run(
      actor,
      id,
      'messaging.timeline.read',
      async (s, m, stamp) => {
        const anchor = filter.thread
          ? await this.entry(s, m, filter.thread)
          : null;
        const threadRoot = anchor ? (anchor.threadId ?? anchor.id) : undefined;
        const context = 'advanced-timeline:' + id + ':' + digest(filter);
        const after = this.position(
          context,
          stamp,
          actor,
          q.cursor,
          m.historyAfter,
          s.conv.lastSequence,
        );
        const rows = await s.tx.messageEntry.findMany({
          where: {
            conversationId: id,
            sequence: { gt: after },
            ...(threadRoot
              ? { OR: [{ id: threadRoot }, { threadId: threadRoot }] }
              : {}),
            ...(filter.pins
              ? { MessagePin_message: { some: { active: true } } }
              : {}),
            ...(filter.mentions
              ? {
                  MessageMention_message: {
                    some: { memberId: m.id, generation: m.generation },
                  },
                }
              : {}),
          },
          orderBy: { sequence: 'asc' },
          take: q.limit + 1,
        });
        const items = [];
        for (const e of rows.slice(0, q.limit)) {
          const view = await this.projection(s, m, e);
          if (view.state === 'HIDDEN') continue;
          if (
            filter.search &&
            !view.content?.text
              .toLocaleLowerCase('und')
              .includes(filter.search.toLocaleLowerCase('und'))
          )
            continue;
          items.push(view);
        }
        return c.AdvancedMessagePageSchema.parse({
          items,
          nextCursor: this.kernel.opaqueCursor(
            context,
            stamp,
            actor.userId,
            String(rows.slice(0, q.limit).at(-1)?.sequence ?? after),
          ),
          hasMore: rows.length > q.limit,
          changeCursor: this.kernel.opaqueCursor(
            'advanced-changes:' + id,
            stamp,
            actor.userId,
            String(s.conv.lastChangeSequence),
          ),
        });
      },
    );
  }
  changes(actor: RequestActor, id: string, q: Page) {
    return this.run(
      actor,
      id,
      'messaging.changes.read',
      async (s, m, stamp) => {
        const context = 'advanced-changes:' + id;
        const after = this.position(
          context,
          stamp,
          actor,
          q.cursor,
          0n,
          s.conv.lastChangeSequence,
        );
        const rows = await s.tx.messageChange.findMany({
          where: {
            conversationId: id,
            sequence: { gt: after },
            OR: [{ audienceId: null }, { audienceId: m.id }],
            message: { sequence: { gt: m.historyAfter } },
          },
          include: { message: true },
          orderBy: { sequence: 'asc' },
          take: q.limit + 1,
        });
        const selected = rows.slice(0, q.limit);
        return c.MessageChangesSchema.parse({
          items: await Promise.all(
            selected.map(async (row) => ({
              sequence: String(row.sequence),
              kind: row.kind,
              message: await this.projection(s, m, row.message),
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
  policy(actor: RequestActor, id: string) {
    return this.run(actor, id, 'messaging.policy.read', async (s) => {
      const p = await s.tx.messagePolicy.findUnique({
        where: {
          conversationId_revision: {
            conversationId: id,
            revision: s.conv.messagePolicyRevision,
          },
        },
      });
      return c.MessagePolicySchema.parse({
        revision: s.conv.messagePolicyRevision,
        authorDelete: p?.authorDelete ?? false,
      });
    });
  }
  reports(actor: RequestActor, id: string, q: Page) {
    return this.run(
      actor,
      id,
      'messaging.reports.read',
      async (s, m, stamp) => {
        let moderator = false;
        try {
          await this.moderator(s, m);
          moderator = true;
        } catch (error) {
          if (!hidden(error)) throw error;
        }
        const context = 'message-reports:' + id;
        const after = this.kernel.opaquePosition(
          context,
          stamp,
          actor.userId,
          q.cursor,
        );
        if (
          after !== undefined &&
          !c.AdvancedMessageResultSchema.shape.resourceId.safeParse(after)
            .success
        )
          throw new BadRequestException();
        const rows = await s.tx.messageReport.findMany({
          where: {
            conversationId: id,
            ...(moderator ? {} : { memberId: m.id, generation: m.generation }),
            message: { sequence: { gt: m.historyAfter } },
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: q.limit + 1,
        });
        return c.MessageReportPageSchema.parse({
          items: rows.slice(0, q.limit).map((v) => ({
            id: v.id,
            conversationId: id,
            messageId: v.messageId,
            memberId: v.memberId,
            reason: v.reason,
            state: v.state,
            resolution: v.resolution,
            revision: v.revision,
            createdAt: v.createdAt.toISOString(),
          })),
          nextCursor:
            rows.length > q.limit
              ? this.kernel.opaqueCursor(
                  context,
                  stamp,
                  actor.userId,
                  rows[q.limit - 1]!.id,
                )
              : null,
          hasMore: rows.length > q.limit,
        });
      },
    );
  }
  revisions(actor: RequestActor, id: string, messageId: string, q: Page) {
    return this.run(
      actor,
      id,
      'messaging.revisions.read',
      async (s, m, stamp) => {
        const e = await this.entry(s, m, messageId);
        await this.requireVisible(s, m, e);
        if (
          e.memberId !== m.id ||
          e.memberGeneration !== m.generation ||
          e.kind !== 'TEXT'
        )
          throw new ForbiddenException();
        const context = 'message-revisions:' + messageId;
        const after = this.position(
          context,
          stamp,
          actor,
          q.cursor,
          0n,
          BigInt(e.revision),
        );
        const rows = await s.tx.messageRevision.findMany({
          where: { messageId, revision: { gt: Number(after) } },
          orderBy: { revision: 'asc' },
          take: q.limit + 1,
        });
        return c.MessageRevisionPageSchema.parse({
          items: rows.slice(0, q.limit).map((v) => ({
            revision: v.revision,
            text: v.text,
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
