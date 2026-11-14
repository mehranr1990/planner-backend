import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedIdentity } from '../../../platform/auth/shared-identity.js';
import {
  SharedKernel,
  CollaborationService,
} from '../../spaces/public/index.js';
import type { SharedRequest } from '../../spaces/public/index.js';
import { DmContacts } from '../../messaging/public/index.js';
import {
  SocialContext,
  socialHash,
  socialKey,
  socialRevision,
} from './social-context.js';
import type { Tx } from './social-context.js';
type Page = z.infer<typeof c.SocialPageQuerySchema>;
@Injectable()
export class SocialGroupsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(CollaborationService) readonly collaboration: CollaborationService,
    @Inject(DmContacts) private readonly contacts: DmContacts,
    @Inject(SocialContext) private readonly context: SocialContext,
    @Inject(SharedIdentity) private readonly identity: SharedIdentity,
  ) {}
  async hint(id: string) {
    this.kernel.assertEnabled();
    const r = await this.db.client.socialGroup.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    return r;
  }
  private request(
    id: string,
    capability: SharedRequest['capability'] = 'task.read',
  ): SharedRequest {
    return { spaceId: id, scopeId: id, capability };
  }
  private async discoverable(row: { id: string; discoverable: boolean }) {
    if (!row.discoverable) return false;
    const records = (await this.context.control.records()).filter(
        (r) =>
          r.spaceId === row.id &&
          ['social.group.private', 'social.group.public'].includes(r.action),
      ),
      terminal = new Map(
        records.filter((r) => r.outcome !== 'INTENT').map((r) => [r.id, r]),
      );
    const latest = [...terminal.values()]
      .filter((r) => r.outcome === 'COMMITTED')
      .sort((a, b) => (BigInt(a.version) > BigInt(b.version) ? -1 : 1))[0];
    return latest?.action !== 'social.group.private';
  }
  private async view(
    tx: Tx,
    row: NonNullable<Awaited<ReturnType<typeof this.hint>>>,
    ownWrite = false,
  ) {
    const custody = await tx.sharedCustody.findUniqueOrThrow({
      where: { spaceId: row.spaceId },
    });
    return c.SocialGroupSchema.strip().parse({
      ...row,
      discoverable: ownWrite ? row.discoverable : await this.discoverable(row),
      state: custody.state,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  async create(
    actor: RequestActor,
    body: z.infer<typeof c.SocialGroupCreateSchema>,
    key: string | undefined,
  ) {
    const creationKey = socialKey(key),
      creationFingerprint = socialHash(body);
    try {
      await this.kernel.provision(
        actor,
        body.id,
        body.retentionPolicyVersion,
        async (tx, b) => {
          await tx.socialGroup.create({
            data: {
              id: body.id,
              spaceId: b.spaceId,
              scopeId: b.scopeId,
              createdByActorId: b.actorId,
              name: body.name,
              description: body.description ?? null,
              publicSummary: body.publicSummary,
              discoverable: body.discoverable,
              creationKey,
              creationFingerprint,
            },
          });
          await this.kernel.offerEffect(
            tx,
            actor,
            b.spaceId,
            b.actorId,
            'social.group.create',
            body.id,
            randomUUID(),
            { actorId: b.actorId, feature: 'social.group', delta: 1 },
          );
        },
        'SOCIAL_GROUP',
      );
    } catch (e) {
      if (!(e instanceof ConflictException)) throw e;
    }
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [body.id] },
      [this.request(body.id)],
      async (tx) => {
        const row = await tx.socialGroup.findUnique({ where: { id: body.id } });
        if (
          !row ||
          row.creationKey !== creationKey ||
          row.creationFingerprint !== creationFingerprint ||
          !(await this.kernel.creatorIs(tx, row.createdByActorId, actor.userId))
        )
          throw new ConflictException();
        return this.view(tx, row);
      },
    );
  }
  async read(actor: RequestActor, id: string) {
    await this.hint(id);
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id] },
      [this.request(id)],
      async (tx) =>
        this.view(
          tx,
          await tx.socialGroup.findUniqueOrThrow({ where: { id } }),
        ),
    );
  }
  async patch(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialGroupPatchSchema>,
    revision: number | undefined,
  ) {
    await this.hint(id);
    const action =
      body.discoverable === false
        ? 'social.group.private'
        : body.discoverable === true
          ? 'social.group.public'
          : 'social.group.update';
    return this.collaboration.signed(
      actor,
      id,
      [],
      action,
      id,
      async (tx, _now, locked, begin) => {
        const authority = await this.kernel.participantAuthority(
          tx,
          actor,
          actor.userId,
          this.request(id, 'settings.manage'),
          locked,
        );
        const row = await tx.socialGroup.findUniqueOrThrow({ where: { id } });
        socialRevision(revision, row.revision);
        const audit = await begin();
        const result = await tx.socialGroup.update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined
              ? { description: body.description }
              : {}),
            ...(body.publicSummary !== undefined
              ? { publicSummary: body.publicSummary }
              : {}),
            ...(body.discoverable !== undefined
              ? { discoverable: body.discoverable }
              : {}),
            revision: { increment: 1 },
          },
        });
        await this.kernel.offerEffect(
          tx,
          actor,
          id,
          authority.actorId,
          action,
          id,
          audit,
        );
        return this.view(tx, result, true);
      },
    );
  }
  async list(actor: RequestActor, q: Page) {
    const hints = await this.kernel.readableContextHints(actor, 'SOCIAL_GROUP');
    if (!hints.ids.length)
      return this.context.page(actor, 'social.groups', hints.stamp, q, []);
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: hints.ids },
      hints.ids.map((id) => this.request(id)),
      async (tx) => {
        const rows = await tx.socialGroup.findMany({
          where: { id: { in: hints.ids } },
          orderBy: { id: 'asc' },
        });
        return this.context.page(
          actor,
          'social.groups',
          hints.stamp,
          q,
          await Promise.all(rows.map((r) => this.view(tx, r))),
        );
      },
    );
  }
  async discover(actor: RequestActor, q: Page) {
    const candidates = await this.db.client.socialGroup.findMany({
      where: { discoverable: true },
      orderBy: { id: 'asc' },
      take: 1001,
    });
    if (candidates.length > 1000) throw new PayloadTooLargeException();
    const rows = [];
    for (const hint of candidates) {
      try {
        const row = await this.kernel.participate(
          actor,
          hint.id,
          [],
          async (tx) => {
            const r = await tx.socialGroup.findUnique({
              where: { id: hint.id },
            });
            if (!r || !(await this.discoverable(r)))
              throw new NotFoundException();
            return c.SocialGroupPreviewSchema.strip().parse(r);
          },
        );
        rows.push(row);
      } catch (e) {
        if (!(e instanceof NotFoundException)) throw e;
      }
    }
    return this.context.page(
      actor,
      'social.groups.discover',
      socialHash(rows),
      q,
      rows,
    );
  }
  async members(actor: RequestActor, id: string, q: Page) {
    await this.hint(id);
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id] },
      [this.request(id)],
      async (tx, a) => {
        const rows = await this.kernel.currentMemberships(tx, a, id),
          mapped = await Promise.all(
            rows.map(async (r) => ({
              ...(await this.collaboration.memberView(tx, r)),
              displayName: await this.collaboration.displayName(
                tx,
                r.spaceId,
                r.actorId,
              ),
            })),
          );
        return this.context.page(
          actor,
          'social.group.members:' + id,
          socialHash([
            String(a.require(tx, id, 'task.read').authorizationVersion),
            mapped,
          ]),
          q,
          mapped.map((r) => c.SocialMembershipSchema.parse(r)),
        );
      },
    );
  }
  async accessMe(actor: RequestActor, id: string) {
    await this.hint(id);
    const catalog =
      c.SocialGroupAccessMeSchema.shape.capabilities.element.options;
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id] },
      [this.request(id)],
      async (tx, a) => {
        const access = a.require(tx, id, 'task.read');
        const membership = await tx.contextAccess.findUniqueOrThrow({
          where: { id: access.accessId },
        });
        const custody = await tx.sharedCustody.findUniqueOrThrow({
          where: { spaceId: access.spaceId },
        });
        return c.SocialGroupAccessMeSchema.parse({
          accessId: access.accessId,
          actorId: access.actorId,
          role: access.role,
          state: membership.state,
          generation: access.generation,
          revision: membership.revision,
          groupState: custody.state,
          capabilities: catalog.filter((capability) =>
            a.has(tx, id, capability),
          ),
        });
      },
      undefined,
      catalog.map((capability) => this.request(id, capability)),
      true,
    );
  }
  async history(actor: RequestActor, id: string, q: Page) {
    await this.hint(id);
    return this.kernel.run(
      actor,
      { userIds: [], spaceIds: [id] },
      [this.request(id)],
      async (tx, a) => {
        const access = a.require(tx, id, 'task.read');
        const context = 'social.group.history:' + id;
        const stamp = socialHash([
          String(access.authorizationVersion),
          access.accessId,
          access.generation,
        ]);
        const after = this.kernel.cursorPosition(
          context,
          stamp,
          actor.userId,
          q.after,
        );
        const rows = await this.collaboration.socialGroupHistory(
          tx,
          a,
          id,
          after,
          q.limit,
        );
        return this.kernel.cursorPage(context, stamp, actor.userId, {
          items: rows.slice(0, q.limit),
          nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
        });
      },
    );
  }
  async join(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialJoinCreateSchema>,
    key: string | undefined,
  ) {
    await this.hint(id);
    const keyHash = socialKey(key),
      fingerprint = socialHash({ groupId: id, id: body.id });
    return this.collaboration.signed(
      actor,
      id,
      [],
      'social.join.request',
      body.id,
      async (tx, now, locked, begin) => {
        const group = await tx.socialGroup.findUniqueOrThrow({ where: { id } });
        if (!(await this.discoverable(group))) throw new NotFoundException();
        const personal = await this.context.owner(tx, actor.userId),
          operation = 'social.group.join';
        const receipt = await tx.idempotencyRecord.findUnique({
          where: {
            actorUserId_spaceId_operation_keyHash: {
              actorUserId: actor.userId,
              spaceId: personal.spaceId,
              operation,
              keyHash,
            },
          },
        });
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
          const existing = await tx.socialJoinRequest.findFirst({
            where: {
              id: receipt.resultId,
              requesterUserId: actor.userId,
              groupId: id,
            },
          });
          if (!existing) throw new NotFoundException();
          return c.SocialJoinRequestSchema.strip().parse(existing);
        }
        const prior = await tx.socialJoinRequest.findUnique({
          where: { id: body.id },
        });
        if (prior) {
          if (prior.groupId !== id || prior.requesterUserId !== actor.userId)
            throw new ConflictException();
          return c.SocialJoinRequestSchema.strip().parse(prior);
        }
        const local = await this.kernel.socialApplicant(
            tx,
            id,
            actor.userId,
            locked,
          ),
          seat = await tx.contextAccess.findUnique({
            where: {
              spaceId_scopeId_actorId: {
                spaceId: id,
                scopeId: id,
                actorId: local.id,
              },
            },
          });
        if (seat && !['LEFT', 'REVOKED'].includes(seat.state))
          throw new ConflictException({ code: 'ADMISSION_UNAVAILABLE' });
        if (
          await tx.socialJoinRequest.findFirst({
            where: {
              groupId: id,
              requesterUserId: actor.userId,
              state: 'PENDING',
            },
          })
        )
          throw new ConflictException();
        const count = await tx.socialJoinRequest.count({
          where: { groupId: id, state: 'PENDING' },
        });
        if (count >= 1000) throw new PayloadTooLargeException();
        await this.context.groupGrowth(tx, id, 'social.join-request', count);
        const audit = await begin();
        const row = await tx.socialJoinRequest.create({
          data: {
            id: body.id,
            groupId: id,
            requesterUserId: actor.userId,
            baseGeneration: seat?.generation ?? null,
            baseRevision: seat?.revision ?? null,
          },
        });
        await this.kernel.offerEffect(
          tx,
          actor,
          id,
          local.id,
          'social.join.request',
          body.id,
          audit,
          { actorId: local.id, feature: 'social.join-request', delta: 1 },
        );
        await tx.idempotencyRecord.create({
          data: {
            id: randomUUID(),
            actorUserId: actor.userId,
            spaceId: personal.spaceId,
            operation,
            keyHash,
            fingerprint,
            resultId: body.id,
            statusCode: 201,
            expiresAt: new Date(now.getTime() + 86400000),
          },
        });
        return c.SocialJoinRequestSchema.strip().parse(row);
      },
    );
  }
  async requests(actor: RequestActor, id: string, q: Page) {
    await this.hint(id);
    const hints = await this.db.client.socialJoinRequest.findMany({
      where: { groupId: id },
      select: { requesterUserId: true },
      take: 1001,
    });
    return this.kernel.participate(
      actor,
      id,
      hints.map((r) => r.requesterUserId),
      async (tx, _now, locked) => {
        let admin = false;
        try {
          await this.kernel.participantAuthority(
            tx,
            actor,
            actor.userId,
            this.request(id, 'membership.member'),
            locked,
          );
          admin = true;
        } catch (e) {
          if (
            !(e instanceof NotFoundException) &&
            !(e instanceof Error && 'status' in e && e.status === 403)
          )
            throw e;
        }
        const rows = await tx.socialJoinRequest.findMany({
          where: {
            groupId: id,
            ...(admin ? {} : { requesterUserId: actor.userId }),
          },
          orderBy: { id: 'asc' },
          take: 1001,
        });
        if (rows.length > 1000) throw new PayloadTooLargeException();
        return this.context.page(
          actor,
          'social.group.requests:' + id,
          socialHash(rows),
          q,
          await Promise.all(
            rows.map(async (r) => {
              if (!locked.includes(r.requesterUserId))
                throw new ConflictException({
                  code: 'APPLICANT_FENCE_CHANGED',
                });
              let displayName: string | null = null;
              if (r.state !== 'PENDING')
                return c.SocialJoinRequestSchema.strip().parse({
                  ...r,
                  requesterDisplayName: null,
                });
              try {
                await this.context.owner(tx, r.requesterUserId);
                displayName =
                  (await this.identity.display(tx, r.requesterUserId))?.name ??
                  null;
              } catch (error) {
                if (
                  !(error instanceof NotFoundException) &&
                  !(error instanceof ForbiddenException)
                )
                  throw error;
              }
              return c.SocialJoinRequestSchema.strip().parse({
                ...r,
                requesterDisplayName: displayName,
              });
            }),
          ),
        );
      },
    );
  }
  async decideJoin(
    actor: RequestActor,
    id: string,
    requestId: string,
    action: 'approve' | 'reject' | 'cancel',
    revision: number | undefined,
  ) {
    await this.hint(id);
    const hint = await this.db.client.socialJoinRequest.findFirst({
      where: { id: requestId, groupId: id },
    });
    if (!hint) throw new NotFoundException();
    return this.collaboration.signed(
      actor,
      id,
      [hint.requesterUserId],
      'social.join.' + action,
      requestId,
      async (tx, now, locked, begin) => {
        const row = await tx.socialJoinRequest.findFirst({
          where: { id: requestId, groupId: id },
        });
        if (!row) throw new NotFoundException();
        let effectActor: string;
        if (action === 'cancel') {
          if (row.requesterUserId !== actor.userId)
            throw new NotFoundException();
          effectActor = (
            await this.kernel.socialApplicant(tx, id, actor.userId, locked)
          ).id;
        } else
          effectActor = (
            await this.kernel.participantAuthority(
              tx,
              actor,
              actor.userId,
              this.request(id, 'membership.member'),
              locked,
            )
          ).actorId;
        socialRevision(revision, row.revision);
        if (row.state !== 'PENDING') throw new ConflictException();
        let audit: string;
        let admissionId = requestId;
        if (action === 'approve') {
          const seat = await this.kernel.admitSocialMember(
            tx,
            id,
            row.requesterUserId,
            now,
            locked,
            row,
          );
          admissionId = seat.id;
          audit = await begin(seat.id);
          await this.kernel.offerEffect(
            tx,
            actor,
            id,
            seat.actorId,
            'membership.admit',
            seat.id,
            audit,
            { actorId: seat.actorId, feature: 'shared.membership', delta: 1 },
          );
        } else audit = await begin();
        const result = await tx.socialJoinRequest.update({
          where: { id: requestId },
          data: {
            state:
              action === 'approve'
                ? 'APPROVED'
                : action === 'reject'
                  ? 'REJECTED'
                  : 'CANCELED',
            revision: { increment: 1 },
          },
        });
        if (action !== 'approve')
          await this.kernel.offerEffect(
            tx,
            actor,
            id,
            effectActor,
            'social.join.' + action,
            admissionId,
            audit,
          );
        return c.SocialJoinRequestSchema.strip().parse(result);
      },
    );
  }
  async invite(
    actor: RequestActor,
    id: string,
    body: z.infer<typeof c.SocialGroupInvitationCreateSchema>,
    key: string | undefined,
  ) {
    await this.hint(id);
    return this.collaboration.createInvitation(
      actor,
      id,
      body,
      key,
      (tx, target, locked) =>
        this.contacts.require(tx, actor.userId, target, locked),
    );
  }
  async decideInvitation(
    actor: RequestActor,
    id: string,
    proof: string | undefined,
    revision: number,
    accept: boolean,
  ) {
    return this.collaboration.decideInvitation(
      actor,
      id,
      proof,
      revision,
      accept,
      'SOCIAL_GROUP',
      (tx, issuer, locked, at) =>
        this.contacts.require(tx, actor.userId, issuer, locked, at),
    );
  }
}
