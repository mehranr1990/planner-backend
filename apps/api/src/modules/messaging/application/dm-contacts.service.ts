import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import {
  SharedControl,
  type SharedControlRecord,
} from '../../../platform/storage/shared-control.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { MessagingAuthority, SharedKernel } from '../../spaces/public/index.js';
import { messageKey, messageVersion } from './contact-command.js';
type Tx = Prisma.TransactionClient;
const hash = (s: unknown) =>
  createHash('sha256').update(JSON.stringify(s)).digest('hex');
@Injectable()
export class DmContacts {
  private readonly views = new WeakMap<
    object,
    Promise<SharedControlRecord[]>
  >();
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(MessagingAuthority) private readonly authority: MessagingAuthority,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(SharedControl) private readonly control: SharedControl,
  ) {}
  private records(tx: Tx) {
    let r = this.views.get(tx);
    if (!r) {
      r = this.control.records();
      this.views.set(tx, r);
    }
    return r;
  }
  private async namespace(tx: Tx, userId: string) {
    const owner = await this.authority.personal(tx, userId);
    const state = await tx.dmContactState.findUnique({
      where: { spaceId: owner.spaceId },
    });
    return { owner, state };
  }
  private async current(tx: Tx, userId: string) {
    const n = await this.namespace(tx, userId);
    await this.control.assertCurrent(
      n.owner.spaceId,
      n.state?.version ?? 0n,
      await this.records(tx),
    );
    return n;
  }
  async pair(tx: Tx, a: string, b: string, locked: string[]) {
    if (!locked.includes(a) || !locked.includes(b))
      throw new ConflictException({ code: 'CONTACT_FENCE_CHANGED' });
    await this.current(tx, a);
    await this.current(tx, b);
    const rows = await tx.dmContactBlock.findMany({
      where: {
        OR: [
          { ownerUserId: a, targetUserId: b },
          { ownerUserId: b, targetUserId: a },
        ],
      },
      take: 2,
    });
    return {
      blocked: rows.some((r) => r.active),
      cutoff: rows.reduce<Date | null>(
        (at, r) =>
          r.restrictedAt && (!at || r.restrictedAt > at) ? r.restrictedAt : at,
        null,
      ),
    };
  }
  async allowed(tx: Tx, a: string, b: string, locked: string[], at?: Date) {
    const p = await this.pair(tx, a, b, locked);
    return !p.blocked && (!at || !p.cutoff || at > p.cutoff);
  }
  async require(tx: Tx, a: string, b: string, locked: string[], at?: Date) {
    if (!(await this.allowed(tx, a, b, locked, at)))
      throw new ForbiddenException({ code: 'CONTACT_UNAVAILABLE' });
  }
  private async known(
    tx: Tx,
    actor: RequestActor,
    id: string,
    byBlock = false,
  ) {
    if (byBlock) {
      const block = await tx.dmContactBlock.findFirst({
        where: { id, ownerUserId: actor.userId },
      });
      if (!block) throw new NotFoundException();
      return {
        conversationId: block.sourceConversationId,
        target: block.targetUserId,
      };
    }
    const conv = await tx.conversation.findUnique({ where: { id } });
    const invitation = conv
      ? await tx.conversationInvitation.findFirst({
          where: { conversationId: id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      : null;
    if (!conv || conv.kind !== 'DM' || !invitation)
      throw new NotFoundException();
    const users = await Promise.all(
      [conv.createdByActorId, invitation.recipientActorId].map((a) =>
        this.authority.user(tx, conv.spaceId, a),
      ),
    );
    if (!users.includes(actor.userId)) throw new NotFoundException();
    return {
      conversationId: conv.id,
      target: users.find((u) => u !== actor.userId)!,
    };
  }
  private view(row: Awaited<ReturnType<Tx['dmContactBlock']['findFirst']>>) {
    return {
      id: row?.id ?? null,
      conversationId: row?.sourceConversationId ?? null,
      active: row?.active ?? false,
      revision: row?.revision ?? 1,
    };
  }
  private async hints(actor: RequestActor, id: string, byBlock = false) {
    if (byBlock) {
      const block = await this.db.client.dmContactBlock.findFirst({
        where: { id, ownerUserId: actor.userId },
      });
      if (!block) throw new NotFoundException();
      return [actor.userId, block.targetUserId];
    }
    const conv = await this.db.client.conversation.findUnique({
      where: { id },
    });
    if (!conv || conv.kind !== 'DM') throw new NotFoundException();
    const invitation = await this.db.client.conversationInvitation.findFirst({
      where: { conversationId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!invitation) throw new NotFoundException();
    const users = await this.authority.hints([
      conv.createdByActorId,
      invitation.recipientActorId,
    ]);
    if (!users.includes(actor.userId)) throw new NotFoundException();
    return users;
  }
  async get(actor: RequestActor, id: string) {
    return this.kernel.contactOperation(
      actor,
      await this.hints(actor, id),
      async (tx) => {
        const { target } = await this.known(tx, actor, id);
        await this.current(tx, actor.userId);
        return this.view(
          await tx.dmContactBlock.findFirst({
            where: { ownerUserId: actor.userId, targetUserId: target },
          }),
        );
      },
    );
  }
  async list(
    actor: RequestActor,
    q: { limit: number; cursor?: string | undefined },
  ) {
    return this.kernel.contactOperation(actor, [], async (tx) => {
      const n = await this.current(tx, actor.userId),
        stamp = hash(String(n.state?.version ?? 0n)),
        context = 'private-dm-blocks';
      const after = this.kernel.cursorPosition(
        context,
        stamp,
        actor.userId,
        q.cursor,
      );
      const rows = await tx.dmContactBlock.findMany({
        where: {
          ownerUserId: actor.userId,
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: 'asc' },
        take: q.limit + 1,
      });
      const more = rows.length > q.limit;
      const items = rows.slice(0, q.limit);
      return {
        ...this.kernel.cursorPage(context, stamp, actor.userId, {
          items: items.map((r) => this.view(r)),
          nextCursor: more ? items.at(-1)!.id : null,
        }),
        hasMore: more,
      };
    });
  }
  async set(
    actor: RequestActor,
    id: string,
    active: boolean,
    key: string | undefined,
    expected: number | undefined,
    byBlock = false,
    contact?: {
      target: string;
      validate: (tx: Tx, locked: string[]) => Promise<void>;
    },
  ) {
    if (byBlock && active) throw new NotFoundException();
    const keyHash = messageKey(key),
      fingerprint = hash({
        id,
        active,
        byBlock,
        ...(contact ? { target: contact.target } : {}),
      });
    let intent: SharedControlRecord | undefined;
    const abort = async () => {
      if (intent) {
        await this.control.append({ ...intent, outcome: 'ABORTED' });
        intent = undefined;
      }
    };
    try {
      const result = await this.kernel.contactOperation(
        actor,
        contact
          ? [actor.userId, contact.target]
          : await this.hints(actor, id, byBlock),
        async (tx, now, locked) => {
          if (contact) await contact.validate(tx, locked);
          const { target, conversationId } = contact
              ? { target: contact.target, conversationId: null }
              : await this.known(tx, actor, id, byBlock),
            n = await this.current(tx, actor.userId);
          const old = await tx.dmContactBlock.findFirst({
              where: { ownerUserId: actor.userId, targetUserId: target },
            }),
            receipt = await tx.dmContactMutation.findUnique({
              where: { spaceId_keyHash: { spaceId: n.owner.spaceId, keyHash } },
            });
          if (receipt) {
            if (receipt.fingerprint !== fingerprint)
              throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
            return this.view(old);
          }
          messageVersion(expected, old?.revision ?? 1);
          if (
            !old &&
            (await tx.dmContactBlock.count({
              where: { ownerUserId: actor.userId },
            })) >= 1000
          )
            throw new PayloadTooLargeException();
          const version = (n.state?.version ?? 0n) + 1n;
          intent = {
            id: randomUUID(),
            spaceId: n.owner.spaceId,
            version: String(version),
            action: active ? 'dm.block' : 'dm.unblock',
            resourceId: target,
            outcome: 'INTENT',
            at: now.toISOString(),
          };
          await this.control.append(intent);
          await tx.dmContactState.upsert({
            where: { spaceId: n.owner.spaceId },
            create: {
              spaceId: n.owner.spaceId,
              ownerUserId: actor.userId,
              version,
            },
            update: { version },
          });
          const restrictedAt =
            active || old?.active ? now : (old?.restrictedAt ?? null);
          const row = await tx.dmContactBlock.upsert({
            where: {
              spaceId_targetUserId: {
                spaceId: n.owner.spaceId,
                targetUserId: target,
              },
            },
            create: {
              id: randomUUID(),
              spaceId: n.owner.spaceId,
              ownerUserId: actor.userId,
              targetUserId: target,
              sourceConversationId: conversationId,
              active,
              restrictedAt,
              revision: 2,
            },
            update: {
              active,
              restrictedAt,
              sourceConversationId: conversationId,
              revision: { increment: 1 },
            },
          });
          await tx.dmContactMutation.create({
            data: {
              id: intent.id,
              spaceId: n.owner.spaceId,
              ownerUserId: actor.userId,
              blockId: row.id,
              keyHash,
              fingerprint,
            },
          });
          await writeAudit(tx, {
            action: 'NOTIFICATION_CHANGE',
            outcome: 'SUCCEEDED',
            actorUserId: actor.userId,
            requestId: actor.requestId,
            correlationId: actor.correlationId,
            resourceId: row.id,
          });
          return this.view(row);
        },
        abort,
      );
      if (intent)
        await this.control.append({ ...intent, outcome: 'COMMITTED' });
      return result;
    } catch (error) {
      // Do not label an unknown DB commit outcome aborted. Reconciliation uses
      // the durable command receipt under the same account fence.
      throw error;
    }
  }
  replay(actor: RequestActor) {
    return this.kernel.contactOperation(actor, [], async (tx, now) => {
      const n = await this.namespace(tx, actor.userId),
        records = (await this.records(tx)).filter(
          (r) => r.spaceId === n.owner.spaceId && r.action.startsWith('dm.'),
        );
      const ids = [...new Set(records.map((r) => r.id))];
      let version = n.state?.version ?? 0n,
        applied = 0;
      const terminal = new Map(
        records.filter((r) => r.outcome !== 'INTENT').map((r) => [r.id, r]),
      );
      for (const id of ids) {
        if (terminal.has(id)) continue;
        const r = records.find((r) => r.id === id)!;
        const receipt = await tx.dmContactMutation.findUnique({
          where: { id },
        });
        const outcome =
          receipt || r.action === 'dm.block' ? 'COMMITTED' : 'ABORTED';
        // Unknown block intents are restrictive evidence, even if the old DB has
        // no receipt. Apply their denial before settling the incomplete command.
        if (
          !receipt &&
          r.action === 'dm.block' &&
          r.resourceId &&
          (await this.authority.identityPresent(tx, r.resourceId))
        ) {
          await tx.dmContactState.upsert({
            where: { spaceId: n.owner.spaceId },
            create: {
              spaceId: n.owner.spaceId,
              ownerUserId: actor.userId,
              version,
            },
            update: {},
          });
          await tx.dmContactBlock.upsert({
            where: {
              spaceId_targetUserId: {
                spaceId: n.owner.spaceId,
                targetUserId: r.resourceId,
              },
            },
            create: {
              id: randomUUID(),
              spaceId: n.owner.spaceId,
              ownerUserId: actor.userId,
              targetUserId: r.resourceId,
              active: true,
              restrictedAt: now,
            },
            update: {
              active: true,
              restrictedAt: now,
              revision: { increment: 1 },
            },
          });
        }
        const done = { ...r, outcome } as SharedControlRecord;
        await this.control.append(done);
        terminal.set(id, done);
      }
      for (const r of [...terminal.values()]
        .filter((r) => r.outcome === 'COMMITTED' && BigInt(r.version) > version)
        .sort((a, b) => (BigInt(a.version) < BigInt(b.version) ? -1 : 1))
        .slice(0, 100)) {
        if (r.action === 'dm.erase')
          throw new ForbiddenException({
            code: 'PERSONAL_ERASURE_REPLAY_REQUIRED',
          });
        if (
          r.resourceId &&
          (await this.authority.identityPresent(tx, r.resourceId))
        ) {
          await tx.dmContactState.upsert({
            where: { spaceId: n.owner.spaceId },
            create: {
              spaceId: n.owner.spaceId,
              ownerUserId: actor.userId,
              version,
            },
            update: {},
          });
          const active = r.action === 'dm.block';
          await tx.dmContactBlock.upsert({
            where: {
              spaceId_targetUserId: {
                spaceId: n.owner.spaceId,
                targetUserId: r.resourceId,
              },
            },
            create: {
              id: randomUUID(),
              spaceId: n.owner.spaceId,
              ownerUserId: actor.userId,
              targetUserId: r.resourceId,
              active,
              restrictedAt: new Date(r.at),
            },
            update: {
              active,
              restrictedAt: new Date(r.at),
              revision: { increment: 1 },
            },
          });
        }
        version = BigInt(r.version);
        applied++;
      }
      await tx.dmContactState.upsert({
        where: { spaceId: n.owner.spaceId },
        create: {
          spaceId: n.owner.spaceId,
          ownerUserId: actor.userId,
          version,
        },
        update: { version },
      });
      return {
        applied,
        hasMore: [...terminal.values()].some(
          (r) => r.outcome === 'COMMITTED' && BigInt(r.version) > version,
        ),
      };
    });
  }
}
