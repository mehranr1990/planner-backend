import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  PayloadTooLargeException,
  ForbiddenException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { SharedIdentity } from '../../../platform/auth/shared-identity.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { DmContacts } from '../../messaging/public/index.js';
import {
  SocialContext,
  socialRevision,
  socialHash,
  socialNamespace,
} from './social-context.js';
import type { Tx } from './social-context.js';
type Page = z.infer<typeof c.SocialPageQuerySchema>;
@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SocialContext) readonly context: SocialContext,
    @Inject(SharedIdentity) private readonly identity: SharedIdentity,
    @Inject(DmContacts) readonly contacts: DmContacts,
  ) {}
  private view(row: unknown) {
    return c.SocialConnectionSchema.strip().parse(row);
  }
  private connectionView(row: { createdAt: Date; updatedAt: Date }) {
    return this.view({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  async privacy(actor: RequestActor) {
    return this.context.read(actor, [], async (tx) => {
      const { state } = await this.context.owner(tx, actor.userId);
      return c.SocialPrivacySchema.parse({
        discoverable: state?.discoverable ?? false,
        allowFriendRequests: state?.allowFriendRequests ?? true,
        revision: state?.revision ?? 1,
      });
    });
  }
  async patchPrivacy(
    actor: RequestActor,
    body: z.infer<typeof c.SocialPrivacyPatchSchema>,
    key: string | undefined,
    revision: number | undefined,
  ) {
    return this.context.write(
      actor,
      [],
      'social.privacy',
      key,
      { body, revision },
      actor.userId,
      async (tx) => {
        const n = await this.context.owner(tx, actor.userId);
        socialRevision(revision, n.state?.revision ?? 1);
        const r = await tx.socialPrivacy.upsert({
          where: { spaceId: n.spaceId },
          create: {
            spaceId: n.spaceId,
            ownerUserId: actor.userId,
            ...(body.discoverable !== undefined
              ? { discoverable: body.discoverable }
              : {}),
            ...(body.allowFriendRequests !== undefined
              ? { allowFriendRequests: body.allowFriendRequests }
              : {}),
            revision: 2,
          },
          update: {
            ...(body.discoverable !== undefined
              ? { discoverable: body.discoverable }
              : {}),
            ...(body.allowFriendRequests !== undefined
              ? { allowFriendRequests: body.allowFriendRequests }
              : {}),
            revision: { increment: 1 },
          },
        });
        return c.SocialPrivacySchema.strip().parse(r);
      },
    );
  }
  private async eligible(
    tx: Tx,
    caller: string,
    target: string,
    locked: string[],
    requests = false,
  ) {
    if (caller === target || !locked.includes(target))
      throw new NotFoundException();
    const n = await this.context.owner(tx, target);
    if (
      !n.state?.discoverable ||
      (requests && !n.state.allowFriendRequests) ||
      !(await this.contacts.allowed(tx, caller, target, locked))
    )
      throw new NotFoundException();
    return n;
  }
  async discover(actor: RequestActor, email: string) {
    const normalized = this.identity.canonicalEmail(email),
      hint = await this.identity.byEmail(this.db.client, normalized);
    return this.context.read(
      actor,
      hint ? [hint.id] : [],
      async (tx, _now, locked) => {
        const current = await this.identity.byEmail(tx, normalized);
        if (!current || current.id !== hint?.id || !current.emailVerified)
          return { items: [] };
        try {
          await this.eligible(tx, actor.userId, current.id, locked);
          const row = await this.identity.directory(tx, current.id);
          return {
            items: [
              c.SocialPersonSchema.parse({
                id: current.id,
                name: row?.name.slice(0, 200) ?? '',
              }),
            ],
          };
        } catch (e) {
          if (e instanceof NotFoundException || e instanceof ForbiddenException)
            return { items: [] };
          throw e;
        }
      },
    );
  }
  async request(
    actor: RequestActor,
    body: z.infer<typeof c.SocialConnectionCreateSchema>,
    key: string | undefined,
  ) {
    return this.context.write(
      actor,
      [body.recipientUserId],
      'social.connection.request',
      key,
      body,
      body.id,
      async (tx) => {
        const existing = await tx.socialConnection.findUnique({
          where: { id: body.id },
        });
        if (existing) {
          if (
            existing.requesterUserId !== actor.userId ||
            existing.recipientUserId !== body.recipientUserId
          )
            throw new ConflictException();
          return this.connectionView(existing);
        }
        const pair = await tx.socialConnection.findFirst({
          where: {
            state: { in: ['PENDING', 'ACCEPTED'] },
            OR: [
              {
                requesterUserId: actor.userId,
                recipientUserId: body.recipientUserId,
              },
              {
                requesterUserId: body.recipientUserId,
                recipientUserId: actor.userId,
              },
            ],
          },
        });
        if (pair) throw new ConflictException({ code: 'CONNECTION_EXISTS' });
        const count = await tx.socialConnection.count({
          where: {
            OR: [
              { requesterUserId: actor.userId },
              { recipientUserId: actor.userId },
            ],
            state: { in: ['PENDING', 'ACCEPTED'] },
          },
        });
        const recipientCount = await tx.socialConnection.count({
          where: {
            OR: [
              { requesterUserId: body.recipientUserId },
              { recipientUserId: body.recipientUserId },
            ],
            state: { in: ['PENDING', 'ACCEPTED'] },
          },
        });
        if (count >= 1000 || recipientCount >= 1000)
          throw new PayloadTooLargeException();
        await this.context.growth(tx, actor.userId, 'social.connection', count);
        return this.connectionView(
          await tx.socialConnection.create({
            data: { ...body, requesterUserId: actor.userId },
          }),
        );
      },
      async (tx, locked) => {
        await this.eligible(
          tx,
          actor.userId,
          body.recipientUserId,
          locked,
          true,
        );
      },
    );
  }
  private async hint(actor: RequestActor, id: string) {
    const row = await this.db.client.socialConnection.findUnique({
      where: { id },
    });
    if (
      !row ||
      ![row.requesterUserId, row.recipientUserId].includes(actor.userId)
    )
      throw new NotFoundException();
    return row;
  }
  async decide(
    actor: RequestActor,
    id: string,
    action: 'accept' | 'decline' | 'cancel' | 'remove',
    key: string | undefined,
    revision: number | undefined,
  ) {
    const hint = await this.hint(actor, id),
      target =
        hint.requesterUserId === actor.userId
          ? hint.recipientUserId
          : hint.requesterUserId;
    return this.context.write(
      actor,
      [target],
      'social.connection.' + action,
      key,
      { id, action, revision },
      id,
      async (tx) => {
        const r = await tx.socialConnection.findUniqueOrThrow({
          where: { id },
        });
        socialRevision(revision, r.revision);
        if (action === 'remove') {
          if (r.state !== 'ACCEPTED') throw new ConflictException();
        } else if (
          r.state !== 'PENDING' ||
          (action === 'cancel'
            ? r.requesterUserId !== actor.userId
            : r.recipientUserId !== actor.userId)
        )
          throw new ConflictException();
        const state =
          action === 'accept'
            ? 'ACCEPTED'
            : action === 'decline'
              ? 'DECLINED'
              : action === 'cancel'
                ? 'CANCELED'
                : 'REMOVED';
        return this.connectionView(
          await tx.socialConnection.update({
            where: { id },
            data: { state, revision: { increment: 1 } },
          }),
        );
      },
      async (tx, locked) => {
        const r = await tx.socialConnection.findUnique({ where: { id } });
        if (
          !r ||
          ![r.requesterUserId, r.recipientUserId].includes(actor.userId)
        )
          throw new NotFoundException();
        if (action === 'accept') {
          const n = await this.context.owner(tx, actor.userId);
          if (n.state?.allowFriendRequests === false)
            throw new NotFoundException();
          await this.context.owner(tx, target);
          await this.contacts.require(tx, actor.userId, target, locked);
          if (r.state !== 'PENDING' && r.state !== 'ACCEPTED')
            throw new ConflictException();
        }
      },
    );
  }
  async list(actor: RequestActor, q: Page) {
    const hints = await this.db.client.socialConnection.findMany({
      where: {
        OR: [
          { requesterUserId: actor.userId },
          { recipientUserId: actor.userId },
        ],
      },
      orderBy: { id: 'asc' },
      take: 2001,
    });
    if (hints.length > 2000) throw new PayloadTooLargeException();
    return this.context.read(
      actor,
      hints.flatMap((r) => [r.requesterUserId, r.recipientUserId]),
      async (tx, _now, locked) => {
        const rows = await tx.socialConnection.findMany({
          where: {
            OR: [
              { requesterUserId: actor.userId },
              { recipientUserId: actor.userId },
            ],
          },
          orderBy: { id: 'asc' },
          take: 2001,
        });
        if (rows.length > 2000) throw new PayloadTooLargeException();
        const visible = [];
        for (const row of rows) {
          const target =
            row.requesterUserId === actor.userId
              ? row.recipientUserId
              : row.requesterUserId;
          if (!locked.includes(target))
            throw new ConflictException({ code: 'CONTACT_FENCE_CHANGED' });
          if (['PENDING', 'ACCEPTED'].includes(row.state)) {
            try {
              await this.context.owner(tx, target);
              if (
                !(await this.contacts.allowed(tx, actor.userId, target, locked))
              )
                continue;
            } catch (error) {
              if (error instanceof NotFoundException) continue;
              throw error;
            }
          }
          visible.push(this.connectionView(row));
        }
        return this.context.page(
          actor,
          'social.connections',
          socialHash(rows),
          q,
          visible,
        );
      },
    );
  }
  async block(
    actor: RequestActor,
    target: string,
    key: string | undefined,
    revision: number | undefined,
  ) {
    return this.contacts.set(actor, target, true, key, revision, false, {
      target,
      validate: async (tx, locked) => {
        if (target === actor.userId) throw new NotFoundException();
        await this.context.owner(tx, actor.userId);
        await this.context.owner(tx, target);
        const known = await tx.socialConnection.findFirst({
            where: {
              OR: [
                { requesterUserId: actor.userId, recipientUserId: target },
                { requesterUserId: target, recipientUserId: actor.userId },
              ],
            },
          }),
          prior = await tx.dmContactBlock.findFirst({
            where: { ownerUserId: actor.userId, targetUserId: target },
          });
        if (!known && !prior)
          await this.eligible(tx, actor.userId, target, locked);
      },
    });
  }
  async replay(actor: RequestActor) {
    const hints = await this.db.client.socialConnection.findMany({
      where: {
        OR: [
          { requesterUserId: actor.userId },
          { recipientUserId: actor.userId },
        ],
      },
      select: { requesterUserId: true, recipientUserId: true },
      take: 2001,
    });
    if (hints.length > 2000) throw new PayloadTooLargeException();
    return this.context.kernel.contactOperation(
      actor,
      hints.flatMap((r) => [r.requesterUserId, r.recipientUserId]),
      async (tx, _now) => {
        const owner = await this.context.owner(tx, actor.userId, false),
          namespace = socialNamespace(owner.spaceId),
          records = (await this.context.control.records()).filter(
            (r) => r.spaceId === namespace,
          ),
          terminal = new Map(
            records.filter((r) => r.outcome !== 'INTENT').map((r) => [r.id, r]),
          );
        for (const r of records.filter(
          (r) => r.outcome === 'INTENT' && !terminal.has(r.id),
        )) {
          const receipt = await tx.idempotencyRecord.findUnique({
            where: { id: r.id },
          });
          const outcome =
            receipt ||
            [
              'social.privacy',
              'social.connection.remove',
              'social.connection.cancel',
              'social.connection.decline',
              'social.circle.delete',
              'social.circle.unlabel',
            ].includes(r.action)
              ? 'COMMITTED'
              : 'ABORTED';
          const done = { ...r, outcome } as typeof r;
          await this.context.control.append(done);
          terminal.set(r.id, done);
        }
        let version = owner.state?.version ?? 0n,
          applied = 0;
        for (const r of [...terminal.values()]
          .filter(
            (r) => r.outcome === 'COMMITTED' && BigInt(r.version) > version,
          )
          .sort((a, b) => (BigInt(a.version) < BigInt(b.version) ? -1 : 1))
          .slice(0, 100)) {
          if (r.action === 'social.privacy')
            await tx.socialPrivacy.upsert({
              where: { spaceId: owner.spaceId },
              create: {
                spaceId: owner.spaceId,
                ownerUserId: actor.userId,
                discoverable: false,
                allowFriendRequests: false,
              },
              update: {
                discoverable: false,
                allowFriendRequests: false,
                revision: { increment: 1 },
              },
            });
          if (
            r.resourceId &&
            r.action.startsWith('social.connection.') &&
            ['remove', 'cancel', 'decline'].some((s) =>
              r.action.endsWith('.' + s),
            )
          ) {
            await tx.socialConnection.updateMany({
              where: {
                id: r.resourceId,
                state: 'PENDING',
                OR: [
                  { requesterUserId: actor.userId },
                  { recipientUserId: actor.userId },
                ],
              },
              data: { state: 'CANCELED', revision: { increment: 1 } },
            });
            await tx.socialConnection.updateMany({
              where: {
                id: r.resourceId,
                state: 'ACCEPTED',
                OR: [
                  { requesterUserId: actor.userId },
                  { recipientUserId: actor.userId },
                ],
              },
              data: { state: 'REMOVED', revision: { increment: 1 } },
            });
          }
          if (r.resourceId && r.action === 'social.circle.delete')
            await tx.socialCircle.deleteMany({
              where: { id: r.resourceId, ownerUserId: actor.userId },
            });
          if (r.resourceId && r.action === 'social.circle.unlabel')
            await tx.socialCircleMember.deleteMany({
              where: {
                connectionId: r.resourceId,
                circle: { ownerUserId: actor.userId },
              },
            });
          version = BigInt(r.version);
          applied++;
        }
        await tx.socialPrivacy.upsert({
          where: { spaceId: owner.spaceId },
          create: {
            spaceId: owner.spaceId,
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
      },
    );
  }
  async circle(actor: RequestActor, id: string) {
    return this.context.read(actor, [], async (tx) =>
      c.SocialCircleSchema.strip().parse(await this.circleRow(tx, actor, id)),
    );
  }
  private async circleRow(tx: Tx, actor: RequestActor, id: string) {
    const r = await tx.socialCircle.findFirst({
      where: { id, ownerUserId: actor.userId },
    });
    if (!r) throw new NotFoundException();
    return r;
  }
  async circles(actor: RequestActor, q: Page) {
    return this.context.read(actor, [], async (tx) => {
      const rows = await tx.socialCircle.findMany({
        where: { ownerUserId: actor.userId },
        orderBy: { id: 'asc' },
        take: 101,
      });
      return this.context.page(
        actor,
        'social.circles',
        socialHash(rows),
        q,
        rows.map((r) => c.SocialCircleSchema.strip().parse(r)),
      );
    });
  }
  async createCircle(
    actor: RequestActor,
    body: z.infer<typeof c.SocialCircleCreateSchema>,
    key: string | undefined,
  ) {
    return this.context.write(
      actor,
      [],
      'social.circle.create',
      key,
      body,
      body.id,
      async (tx) => {
        const n = await this.context.owner(tx, actor.userId),
          count = await tx.socialCircle.count({
            where: { spaceId: n.spaceId },
          });
        if (count >= 100) throw new PayloadTooLargeException();
        await this.context.growth(tx, actor.userId, 'social.circle', count);
        if (
          await tx.socialCircle.findFirst({
            where: {
              spaceId: n.spaceId,
              name: { equals: body.name, mode: 'insensitive' },
              id: { not: body.id },
            },
          })
        )
          throw new ConflictException({ code: 'CIRCLE_NAME_EXISTS' });
        const prior = await tx.socialCircle.findUnique({
          where: { id: body.id },
        });
        if (prior) {
          if (prior.ownerUserId !== actor.userId || prior.name !== body.name)
            throw new ConflictException();
          return c.SocialCircleSchema.strip().parse(prior);
        }
        return c.SocialCircleSchema.strip().parse(
          await tx.socialCircle.create({
            data: { ...body, spaceId: n.spaceId, ownerUserId: actor.userId },
          }),
        );
      },
    );
  }
  async editCircle(
    actor: RequestActor,
    id: string,
    body: { name: string } | null,
    key: string | undefined,
    revision: number | undefined,
  ) {
    return this.context.write(
      actor,
      [],
      body ? 'social.circle.update' : 'social.circle.delete',
      key,
      { id, body, revision },
      id,
      async (tx) => {
        const r = await this.circleRow(tx, actor, id);
        socialRevision(revision, r.revision);
        if (!body) {
          await tx.socialCircle.delete({ where: { id } });
          return { id: r.id, name: r.name, revision: r.revision + 1 };
        }
        return c.SocialCircleSchema.strip().parse(
          await tx.socialCircle.update({
            where: { id },
            data: { ...body, revision: { increment: 1 } },
          }),
        );
      },
      async (tx) => {
        await this.circleRow(tx, actor, id);
      },
    );
  }
  async labels(actor: RequestActor, id: string, q: Page) {
    const hints = await this.db.client.socialCircleMember.findMany({
      where: { circleId: id, circle: { ownerUserId: actor.userId } },
      include: {
        connection: {
          select: { requesterUserId: true, recipientUserId: true },
        },
      },
      take: 1001,
    });
    if (hints.length > 1000) throw new PayloadTooLargeException();
    return this.context.read(
      actor,
      hints.flatMap((r) => [
        r.connection.requesterUserId,
        r.connection.recipientUserId,
      ]),
      async (tx, _now, locked) => {
        await this.circleRow(tx, actor, id);
        const rows = await tx.socialCircleMember.findMany({
          where: { circleId: id },
          include: {
            connection: {
              select: {
                requesterUserId: true,
                recipientUserId: true,
                state: true,
              },
            },
          },
          orderBy: { connectionId: 'asc' },
          take: 1001,
        });
        const visible = [];
        for (const row of rows) {
          const target =
            row.connection.requesterUserId === actor.userId
              ? row.connection.recipientUserId
              : row.connection.requesterUserId;
          if (!locked.includes(target))
            throw new ConflictException({ code: 'CONTACT_FENCE_CHANGED' });
          await this.context.owner(tx, target);
          if (
            row.connection.state === 'ACCEPTED' &&
            (await this.contacts.allowed(tx, actor.userId, target, locked))
          )
            visible.push(row);
        }
        const page = this.context.page(
          actor,
          'social.circle.members:' + id,
          socialHash(rows),
          q,
          visible.map((r) => ({ ...r, id: r.connectionId })),
        );
        return {
          ...page,
          items: page.items.map((r) =>
            c.SocialCircleMemberSchema.strip().parse(r),
          ),
        };
      },
    );
  }
  async label(
    actor: RequestActor,
    circleId: string,
    connectionId: string,
    active: boolean,
    key: string | undefined,
    revision: number | undefined,
  ) {
    const hint = await this.hint(actor, connectionId),
      target =
        hint.requesterUserId === actor.userId
          ? hint.recipientUserId
          : hint.requesterUserId;
    return this.context.write(
      actor,
      [target],
      active ? 'social.circle.label' : 'social.circle.unlabel',
      key,
      { circleId, connectionId, active, revision },
      connectionId,
      async (tx, _now, locked) => {
        const circle = await this.circleRow(tx, actor, circleId);
        socialRevision(revision, circle.revision);
        const friendship = await tx.socialConnection.findUniqueOrThrow({
          where: { id: connectionId },
        });
        if (active) {
          if (friendship.state !== 'ACCEPTED') throw new ConflictException();
          await this.contacts.require(tx, actor.userId, target, locked);
          const count = await tx.socialCircleMember.count({
            where: { circleId },
          });
          if (count >= 1000) throw new PayloadTooLargeException();
          await this.context.growth(
            tx,
            actor.userId,
            'social.circle-member',
            count,
          );
          await tx.socialCircleMember.upsert({
            where: { circleId_connectionId: { circleId, connectionId } },
            create: { circleId, connectionId, spaceId: circle.spaceId },
            update: {},
          });
        } else
          await tx.socialCircleMember.deleteMany({
            where: { circleId, connectionId },
          });
        await tx.socialCircle.update({
          where: { id: circleId },
          data: { revision: { increment: 1 } },
        });
        return { circleId, connectionId };
      },
      async (tx) => {
        await this.circleRow(tx, actor, circleId);
        if (active) await this.context.owner(tx, target);
      },
    );
  }
}
