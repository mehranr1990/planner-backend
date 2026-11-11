import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedControl } from '../../../platform/storage/shared-control.js';
import type { SharedControlRecord } from '../../../platform/storage/shared-control.js';
import {
  SharedKernel,
  MessagingAuthority,
  SharedFeaturePolicy,
} from '../../spaces/public/index.js';
import type { SharedFeatureKey } from '../../spaces/public/index.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
export type Tx = Prisma.TransactionClient;
export const socialHash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function socialKey(key: string | undefined) {
  if (!key || !/^[!-~]{1,128}$/.test(key))
    throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  return socialHash(key);
}
export function socialRevision(expected: number | undefined, actual: number) {
  if (expected === undefined) throw new BadRequestException();
  if (expected !== actual)
    throw new ConflictException({ code: 'REVISION_CONFLICT' });
}
// A distinct signed control namespace avoids conflating Social and existing DM versions.
export function socialNamespace(spaceId: string) {
  const h = socialHash(['social-private-v1', spaceId]);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
@Injectable()
export class SocialContext {
  private readonly checked = new WeakMap<object, Set<string>>();
  constructor(
    @Inject(SharedKernel) readonly kernel: SharedKernel,
    @Inject(MessagingAuthority) readonly authority: MessagingAuthority,
    @Inject(SharedControl) readonly control: SharedControl,
    @Inject(SharedFeaturePolicy) private readonly features: SharedFeaturePolicy,
  ) {}
  async owner(tx: Tx, userId: string, current = true) {
    const owner = await this.authority.personal(tx, userId),
      state = await tx.socialPrivacy.findUnique({
        where: { spaceId: owner.spaceId },
      });
    if (current && !this.checked.get(tx)?.has(userId)) {
      await this.control.assertCurrent(
        socialNamespace(owner.spaceId),
        state?.version ?? 0n,
      );
      const set = this.checked.get(tx) ?? new Set<string>();
      set.add(userId);
      this.checked.set(tx, set);
    }
    return { ...owner, state };
  }
  read<T>(
    actor: RequestActor,
    users: string[],
    work: (tx: Tx, now: Date, locked: string[]) => Promise<T>,
  ) {
    return this.kernel.contactOperation(
      actor,
      users,
      async (tx, now, locked) => {
        await this.owner(tx, actor.userId);
        return work(tx, now, locked);
      },
    );
  }
  async growth(
    tx: Tx,
    userId: string,
    feature: SharedFeatureKey,
    currentUsage: number,
  ) {
    if (
      !(
        await this.features.decide(
          {
            feature,
            usageOwner: { kind: 'PERSONAL_ACCOUNT', userId },
            currentUsage,
            growth: 1,
          },
          tx,
        )
      ).allowed
    )
      throw new ForbiddenException({ code: 'SOCIAL_FEATURE_UNAVAILABLE' });
  }
  async groupGrowth(
    tx: Tx,
    spaceId: string,
    feature: SharedFeatureKey,
    currentUsage: number,
  ) {
    if (
      !(
        await this.features.decide(
          {
            feature,
            usageOwner: { kind: 'SHARED_CUSTODY', spaceId },
            currentUsage,
            growth: 1,
          },
          tx,
        )
      ).allowed
    )
      throw new ForbiddenException({ code: 'SOCIAL_FEATURE_UNAVAILABLE' });
  }
  async write<T>(
    actor: RequestActor,
    users: string[],
    operation: string,
    key: string | undefined,
    body: unknown,
    resourceId: string,
    work: (tx: Tx, now: Date, locked: string[]) => Promise<T>,
    validate?: (tx: Tx, locked: string[]) => Promise<void>,
  ) {
    const keyHash = socialKey(key),
      fingerprint = socialHash(body);
    let intent: SharedControlRecord | undefined;
    const abort = async () => {
      if (intent) {
        await this.control.append({ ...intent, outcome: 'ABORTED' });
        intent = undefined;
      }
    };
    let committed = false;
    try {
      const result = await this.kernel.contactOperation(
        actor,
        users,
        async (tx, now, locked) => {
          const owner = await this.owner(tx, actor.userId);
          await validate?.(tx, locked);
          const prior = await tx.idempotencyRecord.findUnique({
            where: {
              actorUserId_spaceId_operation_keyHash: {
                actorUserId: actor.userId,
                spaceId: owner.spaceId,
                operation,
                keyHash,
              },
            },
          });
          if (prior) {
            if (prior.fingerprint !== fingerprint)
              throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
            return prior.result as T;
          }
          const version = (owner.state?.version ?? 0n) + 1n;
          intent = {
            id: randomUUID(),
            spaceId: socialNamespace(owner.spaceId),
            version: String(version),
            action: operation,
            resourceId,
            outcome: 'INTENT',
            at: now.toISOString(),
          };
          await this.control.append(intent);
          const value = await work(tx, now, locked);
          await tx.socialPrivacy.upsert({
            where: { spaceId: owner.spaceId },
            create: {
              spaceId: owner.spaceId,
              ownerUserId: actor.userId,
              version,
            },
            update: { version },
          });
          await tx.idempotencyRecord.create({
            data: {
              id: intent.id,
              actorUserId: actor.userId,
              spaceId: owner.spaceId,
              operation,
              keyHash,
              fingerprint,
              resultId: resourceId,
              statusCode: 200,
              result: JSON.parse(
                JSON.stringify(value),
              ) as Prisma.InputJsonValue,
              expiresAt: new Date(now.getTime() + 86400000),
            },
          });
          await writeAudit(tx, {
            action: 'ACCOUNT_SETTINGS_UPDATE',
            outcome: 'SUCCEEDED',
            actorUserId: actor.userId,
            requestId: actor.requestId,
            correlationId: actor.correlationId,
            resourceId,
          });
          await tx.outboxEvent.create({
            data: {
              id: randomUUID(),
              type: operation,
              version: 1,
              aggregateId: resourceId,
              spaceId: owner.spaceId,
              payload: {},
              correlationId: actor.correlationId,
            },
          });
          return value;
        },
        abort,
      );
      committed = true;
      if (intent)
        await this.control.append({ ...intent, outcome: 'COMMITTED' });
      return result;
    } catch (error) {
      if (
        !committed &&
        error instanceof HttpException &&
        error.getStatus() < 500
      )
        await abort();
      throw error;
    }
  }
  page<T extends { id: string }>(
    actor: RequestActor,
    context: string,
    stamp: string,
    q: { limit: number; after?: string | undefined },
    rows: T[],
  ) {
    const after = this.kernel.cursorPosition(
        context,
        stamp,
        actor.userId,
        q.after,
      ),
      selected = rows
        .filter((r) => !after || r.id > after)
        .slice(0, q.limit + 1),
      items = selected.slice(0, q.limit);
    return this.kernel.cursorPage(context, stamp, actor.userId, {
      items,
      nextCursor: selected.length > q.limit ? items.at(-1)!.id : null,
    });
  }
}
