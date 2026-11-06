import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  Prisma,
  ContextInvitation,
  OwnerHandover,
  ContextAccess,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { SharedIdentity } from '../../../platform/auth/shared-identity.js';
import { AuthService } from '../../../platform/auth/auth.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedControl } from '../../../platform/storage/shared-control.js';
import type { SharedControlRecord } from '../../../platform/storage/shared-control.js';
import { SharedKernel } from './shared-kernel.service.js';
import { CollaborationLimit } from './collaboration-limit.js';
import {
  roleAdministration,
  roleInContext,
  permits,
  validateRoleDefaults,
} from '../domain/shared-policy.js';
import type { MemberRole } from '../domain/shared-policy.js';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const week = 7 * 86400000;
function keyHash(key: string | undefined) {
  if (!key || !/^[\x21-\x7e]{1,128}$/.test(key))
    throw new BadRequestException();
  return hash(key);
}
function proofHash(proof: string | undefined) {
  if (
    !proof ||
    !/^[A-Za-z0-9_-]{43}$/.test(proof) ||
    Buffer.from(proof, 'base64url').toString('base64url') !== proof
  )
    throw new NotFoundException();
  return hash(proof);
}
const invitationView = (r: ContextInvitation) =>
  c.ContextInvitationSchema.parse({
    id: r.id,
    spaceId: r.spaceId,
    scopeId: r.scopeId,
    kind: 'MEMBERSHIP',
    memberRole: r.memberRole,
    state: r.state,
    revision: r.revision,
    expiresAt: r.expiresAt.toISOString(),
    acceptedAccessId: r.acceptedAccessId,
  });
const handoverView = (r: OwnerHandover) =>
  c.OwnerHandoverSchema.parse({
    id: r.id,
    spaceId: r.spaceId,
    scopeId: r.scopeId,
    fromAccessId: r.fromAccessId,
    toAccessId: r.toAccessId,
    state: r.state,
    revision: r.revision,
    expiresAt: r.expiresAt.toISOString(),
    expectedCustodyRevision: r.expectedCustodyRevision,
    acceptedAt: r.state === 'ACCEPTED' ? r.endedAt!.toISOString() : null,
  });

@Injectable()
export class CollaborationService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(SharedIdentity) private readonly identity: SharedIdentity,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SharedControl) private readonly control: SharedControl,
    @Inject(CollaborationLimit) private readonly limit: CollaborationLimit,
  ) {}
  async request(ip: string, actor?: RequestActor, preview = false) {
    this.kernel.assertEnabled();
    await this.limit.request(ip, actor?.userId, preview);
    await this.control.records();
  }
  async requireContextKind(spaceId: string, kind: 'PROJECT' | 'TEAM') {
    const row = await this.db.client.sharedCustody.findUnique({
      where: { spaceId },
    });
    if (!row || row.kind !== kind) throw new NotFoundException();
  }
  async signed<T>(
    actor: RequestActor | null,
    spaceId: string,
    users: string[],
    action: string,
    target: string,
    work: (
      tx: Prisma.TransactionClient,
      now: Date,
      locked: string[],
      begin: () => Promise<string>,
    ) => Promise<T>,
    lifecycle = false,
    lifecycleKind: 'PROJECT' | 'TEAM' = 'PROJECT',
  ) {
    if (lifecycle && !action.startsWith('lifecycle.'))
      throw new BadRequestException();
    const intents: SharedControlRecord[] = [];
    let committed = false;
    const abort = async () => {
      for (const r of intents)
        await this.control.append({
          ...r,
          outcome: 'ABORTED',
          at: new Date().toISOString(),
        });
      intents.length = 0;
    };
    const body = async (
      tx: Prisma.TransactionClient,
      now: Date,
      locked: string[],
    ) =>
      work(tx, now, locked, async () => {
        if (intents[0]) return intents[0].id;
        const custody = await tx.sharedCustody.findUniqueOrThrow({
          where: { spaceId },
        });
        const record: SharedControlRecord = {
          id: randomUUID(),
          spaceId,
          version: String(custody.authorizationVersion + 1n),
          action,
          resourceId: target,
          outcome: 'INTENT',
          at: new Date().toISOString(),
        };
        await this.control.append(record);
        intents.push(record);
        return record.id;
      });
    try {
      const result = actor
        ? lifecycle
          ? await this.kernel.lifecycleParticipant(
              actor,
              spaceId,
              users,
              body,
              abort,
              lifecycleKind,
            )
          : await this.kernel.participate(actor, spaceId, users, body, abort)
        : await this.kernel.offerMaintenance(
            spaceId,
            users,
            (tx, now) => body(tx, now, [...new Set(users)].sort()),
            abort,
          );
      committed = true;
      for (const r of intents)
        await this.control.append({
          ...r,
          outcome: 'COMMITTED',
          at: new Date().toISOString(),
        });
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
  private async userForAccess(tx: Prisma.TransactionClient, id: string) {
    const access = await tx.contextAccess.findUnique({ where: { id } });
    const actor =
      access &&
      (await tx.sharedActor.findUnique({ where: { id: access.actorId } }));
    return actor?.userId ?? null;
  }
  private async actor(
    tx: Prisma.TransactionClient,
    spaceId: string,
    userId: string,
  ) {
    const existing = await tx.sharedActor.findFirst({
      where: { spaceId, userId, state: 'ACTIVE' },
    });
    return (
      existing ??
      tx.sharedActor.create({
        data: { id: randomUUID(), spaceId, userId, state: 'ACTIVE' },
      })
    );
  }
  private async receipt(
    tx: Prisma.TransactionClient,
    now: Date,
    spaceId: string,
    actorId: string,
    operation: string,
    key: string,
    fingerprint: string,
    resultId: string,
  ) {
    await tx.sharedMutationReceipt.create({
      data: {
        id: randomUUID(),
        spaceId,
        scopeId: spaceId,
        actorId,
        operation,
        keyHash: key,
        fingerprint,
        resultId,
        statusCode: 201,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 86400000),
      },
    });
  }
  async memberView(tx: Prisma.TransactionClient, access: ContextAccess) {
    const custody = await tx.sharedCustody.findUniqueOrThrow({
      where: { spaceId: access.spaceId },
    });
    return c.ContextMembershipSchema.parse({
      id: access.id,
      spaceId: access.spaceId,
      scopeId: access.scopeId,
      actorId: access.actorId,
      memberRole: access.memberRole,
      state: access.state,
      generation: access.generation,
      revision: access.revision,
      role:
        access.id === custody.primaryOwnerAccessId
          ? 'OWNER'
          : access.memberRole,
    });
  }
  async createInvitation(
    actor: RequestActor,
    spaceId: string,
    input: z.infer<typeof c.ContextInvitationCreateSchema>,
    key: string | undefined,
  ) {
    const keyValue = keyHash(key),
      body = c.ContextInvitationCreateSchema.parse(input);
    const email =
      'email' in body.recipient
        ? this.identity.canonicalEmail(body.recipient.email)
        : null;
    const hinted = email
      ? await this.identity.byEmail(this.db.client, email)
      : await this.identity.current(
          this.db.client,
          'userId' in body.recipient ? body.recipient.userId : '',
        );
    const users = hinted ? [hinted.id] : [];
    const fingerprint = hash(
        JSON.stringify({
          kind: 'MEMBERSHIP',
          memberRole: body.memberRole,
          recipient: email ? { email } : body.recipient,
        }),
      ),
      id = randomUUID();
    return this.signed(
      actor,
      spaceId,
      users,
      'invitation.create',
      id,
      async (tx, now, locked, begin) => {
        const custodyKind = (
          await tx.sharedCustody.findUniqueOrThrow({ where: { spaceId } })
        ).kind;
        if (!roleInContext(body.memberRole, custodyKind))
          throw new BadRequestException();
        const authority = await this.kernel.participantAuthority(
          tx,
          actor,
          actor.userId,
          {
            spaceId,
            scopeId: spaceId,
            capability: roleAdministration(body.memberRole),
          },
          locked,
        );
        const prior = await tx.contextInvitation.findFirst({
          where: {
            spaceId,
            inviterAccessId: authority.accessId,
            inviterGeneration: authority.generation,
            keyHash: keyValue,
          },
        });
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new ConflictException();
          return c.ContextInvitationDeliverySchema.parse({
            invitation: invitationView(prior),
            proof: null,
          });
        }
        const recipient = email
          ? await this.identity.byEmail(tx, email)
          : await this.identity.current(
              tx,
              'userId' in body.recipient ? body.recipient.userId : '',
            );
        if (
          (recipient &&
            (!locked.includes(recipient.id) || recipient.id !== hinted?.id)) ||
          (!recipient && hinted)
        )
          throw new ConflictException({ code: 'IDENTITY_CHANGED_RESTART' });
        if (!email && !recipient) throw new NotFoundException();
        const targetActor =
          recipient &&
          (await tx.sharedActor.findFirst({
            where: { spaceId, userId: recipient.id },
          }));
        const target =
          targetActor &&
          (await tx.contextAccess.findUnique({
            where: {
              spaceId_scopeId_actorId: {
                spaceId,
                scopeId: spaceId,
                actorId: targetActor.id,
              },
            },
          }));
        if (target?.id === authority.accessId)
          throw new ConflictException({
            code: 'SELF_INVITATION_NOT_PERMITTED',
          });
        if (target?.memberRole)
          await this.kernel.participantAuthority(
            tx,
            actor,
            actor.userId,
            {
              spaceId,
              scopeId: spaceId,
              capability: roleAdministration(target.memberRole as MemberRole),
            },
            locked,
          );
        await this.limit.take('invitation.context:' + spaceId, 20, tx);
        const proof = randomBytes(32).toString('base64url'),
          auditId = await begin();
        const result = await tx.contextInvitation.create({
          data: {
            id,
            spaceId,
            scopeId: spaceId,
            inviterAccessId: authority.accessId,
            inviterGeneration: authority.generation,
            recipientUserId: recipient?.id ?? null,
            recipientEmail: recipient ? null : email,
            recipientAccessId: target?.id ?? null,
            recipientGeneration: target?.generation ?? null,
            recipientRevision: target?.revision ?? null,
            memberRole: body.memberRole,
            proofHash: hash(proof),
            keyHash: keyValue,
            fingerprint,
            createdAt: now,
            expiresAt: new Date(now.getTime() + week),
          },
        });
        await this.kernel.offerEffect(
          tx,
          actor,
          spaceId,
          authority.actorId,
          'invitation.create',
          id,
          auditId,
        );
        await this.receipt(
          tx,
          now,
          spaceId,
          authority.actorId,
          'invitation.create',
          hash('generation:' + authority.generation + ':' + keyValue),
          fingerprint,
          id,
        );
        return c.ContextInvitationDeliverySchema.parse({
          invitation: invitationView(result),
          proof,
        });
      },
    );
  }
  async invitation(actor: RequestActor, spaceId: string, id: string) {
    return this.kernel.participate(
      actor,
      spaceId,
      [],
      async (tx, _now, locked) => {
        const row = await tx.contextInvitation.findFirst({
          where: { id, spaceId },
        });
        if (!row) throw new NotFoundException();
        await this.kernel.participantAuthority(
          tx,
          actor,
          actor.userId,
          {
            spaceId,
            scopeId: spaceId,
            capability: roleAdministration(row.memberRole as MemberRole),
          },
          locked,
        );
        return invitationView(row);
      },
    );
  }
  async preview(
    proof: string | undefined,
    kind: 'PROJECT' | 'TEAM' = 'PROJECT',
  ) {
    this.kernel.assertEnabled();
    const hint = await this.db.client.contextInvitation.findUnique({
      where: { proofHash: proofHash(proof) },
    });
    if (!hint) throw new NotFoundException();
    return this.kernel.offerMaintenance(hint.spaceId, [], async (tx, now) => {
      const row = await tx.contextInvitation.findUnique({
          where: { id: hint.id },
        }),
        custody = await tx.sharedCustody.findUniqueOrThrow({
          where: { spaceId: hint.spaceId },
        });
      if (
        !row ||
        row.state !== 'PENDING' ||
        row.expiresAt <= now ||
        custody.state !== 'ACTIVE' ||
        custody.kind !== kind
      )
        throw new NotFoundException();
      const issuer = await tx.contextAccess.findUnique({
        where: { id: row.inviterAccessId },
      });
      const issuerActor =
        issuer &&
        (await tx.sharedActor.findUnique({ where: { id: issuer.actorId } }));
      const account =
        issuerActor?.userId &&
        (await tx.space.findFirst({
          where: { kind: 'PERSONAL', ownerUserId: issuerActor.userId },
          select: { accessClosedAt: true },
        }));
      const scope = await tx.accessScope.findUniqueOrThrow({
          where: { id: row.scopeId },
        }),
        policy = await tx.contextCapabilityPolicy.findUniqueOrThrow({
          where: {
            spaceId_scopeId_version: {
              spaceId: row.spaceId,
              scopeId: row.scopeId,
              version: scope.currentPolicyVersion,
            },
          },
        });
      const primary = custody.primaryOwnerAccessId
        ? await tx.contextAccess.findUnique({
            where: { id: custody.primaryOwnerAccessId },
          })
        : null;
      const primaryActor = primary
        ? await tx.sharedActor.findUnique({ where: { id: primary.actorId } })
        : null;
      const primaryAccount = primaryActor?.userId
        ? await tx.space.findFirst({
            where: { kind: 'PERSONAL', ownerUserId: primaryActor.userId },
            select: { accessClosedAt: true },
          })
        : null;
      if (
        scope.state !== 'ACTIVE' ||
        !primaryAccount ||
        primaryAccount.accessClosedAt ||
        !issuer ||
        issuer.state !== 'ACTIVE' ||
        issuer.generation !== row.inviterGeneration ||
        !issuer.memberRole ||
        !account ||
        account.accessClosedAt ||
        !validateRoleDefaults(policy.roleDefaults) ||
        !permits(
          issuer.id === custody.primaryOwnerAccessId
            ? 'OWNER'
            : (issuer.memberRole as MemberRole),
          roleAdministration(row.memberRole as MemberRole),
          policy.roleDefaults,
        )
      )
        throw new NotFoundException();
      return (
        kind === 'TEAM'
          ? c.TeamInvitationPreviewSchema
          : c.InvitationPreviewSchema
      ).parse({
        contextLabel: kind === 'TEAM' ? 'Team' : 'Project',
        offerCategory: 'MEMBERSHIP',
        expiresAt: row.expiresAt.toISOString(),
      });
    });
  }
  private async invitationHint(id: string, proof: string | undefined) {
    const row = await this.db.client.contextInvitation.findFirst({
      where: { id, proofHash: proofHash(proof) },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async decideInvitation(
    actor: RequestActor,
    id: string,
    proof: string | undefined,
    revision: number,
    accept: boolean,
    kind: 'PROJECT' | 'TEAM' = 'PROJECT',
  ) {
    const hint = await this.invitationHint(id, proof),
      issuerUser = await this.userForAccess(
        this.db.client,
        hint.inviterAccessId,
      );
    return this.signed(
      actor,
      hint.spaceId,
      issuerUser ? [issuerUser] : [],
      accept ? 'invitation.accept' : 'invitation.decline',
      id,
      async (tx, now, locked, begin) => {
        const row = await tx.contextInvitation.findUniqueOrThrow({
          where: { id },
        });
        if (
          (
            await tx.sharedCustody.findUniqueOrThrow({
              where: { spaceId: row.spaceId },
            })
          ).kind !== kind
        )
          throw new NotFoundException();
        if (row.proofHash !== proofHash(proof)) throw new NotFoundException();
        if (row.state === 'ACCEPTED' && accept) {
          const access = await tx.contextAccess.findUnique({
              where: { id: row.acceptedAccessId! },
            }),
            local =
              access &&
              (await tx.sharedActor.findUnique({
                where: { id: access.actorId },
              }));
          if (
            !access ||
            local?.userId !== actor.userId ||
            access.generation !== row.acceptedGeneration
          )
            throw new NotFoundException();
          await this.kernel.participantAuthority(
            tx,
            actor,
            actor.userId,
            {
              spaceId: row.spaceId,
              scopeId: row.scopeId,
              capability: 'custody.accept',
              generation: row.acceptedGeneration!,
            },
            locked,
          );
          return c.ContextInvitationAcceptanceSchema.parse({
            invitation: invitationView(row),
            membership: await this.memberView(tx, access),
          });
        }
        if (row.state !== 'PENDING' || row.expiresAt <= now)
          throw new NotFoundException();
        const identity = await this.identity.current(tx, actor.userId);
        if (
          !identity?.emailVerified ||
          (row.recipientUserId && row.recipientUserId !== actor.userId) ||
          (row.recipientEmail &&
            row.recipientEmail !== this.identity.canonicalEmail(identity.email))
        )
          throw new NotFoundException();
        if (row.revision !== revision) throw new ConflictException();
        const currentIssuer = await this.userForAccess(tx, row.inviterAccessId);
        if (!currentIssuer || currentIssuer !== issuerUser)
          throw new NotFoundException();
        await this.kernel.participantAuthority(
          tx,
          actor,
          currentIssuer,
          {
            spaceId: row.spaceId,
            scopeId: row.scopeId,
            capability: roleAdministration(row.memberRole as MemberRole),
            generation: row.inviterGeneration,
          },
          locked,
        );
        const local = await this.actor(tx, row.spaceId, actor.userId);
        let access = await tx.contextAccess.findUnique({
          where: {
            spaceId_scopeId_actorId: {
              spaceId: row.spaceId,
              scopeId: row.scopeId,
              actorId: local.id,
            },
          },
        });
        if (access?.state === 'SUSPENDED' || access?.state === 'ERASED')
          throw new NotFoundException();
        if (
          (accept && (access?.id ?? null) !== row.recipientAccessId) ||
          (accept &&
            access &&
            (access.generation !== row.recipientGeneration ||
              access.revision !== row.recipientRevision))
        )
          throw new ConflictException({ code: 'ADMISSION_CHANGED' });
        if (accept && access?.memberRole)
          await this.kernel.participantAuthority(
            tx,
            actor,
            currentIssuer,
            {
              spaceId: row.spaceId,
              scopeId: row.scopeId,
              capability: roleAdministration(access.memberRole as MemberRole),
            },
            locked,
          );
        const auditId = await begin(),
          addsMember =
            accept &&
            (!access?.memberRole ||
              !['ACTIVE', 'SUSPENDED'].includes(access.state));
        if (accept) {
          if (!access) {
            access = await tx.contextAccess.create({
              data: {
                id: randomUUID(),
                spaceId: row.spaceId,
                scopeId: row.scopeId,
                actorId: local.id,
                state: 'ACTIVE',
                memberRole: row.memberRole,
                joinedAt: now,
              },
            });
            await tx.contextAccessInterval.create({
              data: { accessId: access.id, generation: 1, joinedAt: now },
            });
          } else if (['LEFT', 'REVOKED'].includes(access.state)) {
            access = await tx.contextAccess.update({
              where: { id: access.id },
              data: {
                state: 'ACTIVE',
                memberRole: row.memberRole,
                generation: { increment: 1 },
                revision: { increment: 1 },
                joinedAt: now,
                endedAt: null,
              },
            });
            await tx.contextAccessInterval.create({
              data: {
                accessId: access.id,
                generation: access.generation,
                joinedAt: now,
              },
            });
          } else if (access.memberRole !== row.memberRole)
            access = await tx.contextAccess.update({
              where: { id: access.id },
              data: { memberRole: row.memberRole, revision: { increment: 1 } },
            });
        }
        const result = await tx.contextInvitation.update({
          where: { id },
          data: {
            state: accept ? 'ACCEPTED' : 'DECLINED',
            endedAt: now,
            recipientUserId: null,
            recipientEmail: null,
            proofHash: accept ? row.proofHash : null,
            revision: { increment: 1 },
            ...(accept
              ? {
                  acceptedActorId: local.id,
                  acceptedAccessId: access!.id,
                  acceptedGeneration: access!.generation,
                }
              : {}),
          },
        });
        await this.kernel.offerEffect(
          tx,
          actor,
          row.spaceId,
          local.id,
          accept ? 'invitation.accept' : 'invitation.decline',
          id,
          auditId,
          addsMember
            ? { actorId: local.id, feature: 'shared.membership', delta: 1 }
            : undefined,
        );
        await this.receipt(
          tx,
          now,
          row.spaceId,
          local.id,
          accept ? 'invitation.accept' : 'invitation.decline',
          hash(id),
          hash(JSON.stringify({ id, accept, actorId: local.id })),
          id,
        );
        if (!accept) return invitationView(result);
        return c.ContextInvitationAcceptanceSchema.parse({
          invitation: invitationView(result),
          membership: await this.memberView(tx, access!),
        });
      },
    );
  }
  async revokeInvitation(
    actor: RequestActor,
    spaceId: string,
    id: string,
    revision: number,
  ) {
    return this.signed(
      actor,
      spaceId,
      [],
      'invitation.revoke',
      id,
      async (tx, now, locked, begin) => {
        const row = await tx.contextInvitation.findFirst({
          where: { id, spaceId },
        });
        if (!row) throw new NotFoundException();
        const authority = await this.kernel.participantAuthority(
          tx,
          actor,
          actor.userId,
          {
            spaceId,
            scopeId: spaceId,
            capability: roleAdministration(row.memberRole as MemberRole),
          },
          locked,
        );
        if (row.state !== 'PENDING' || row.revision !== revision)
          throw new ConflictException();
        const auditId = await begin(),
          result = await tx.contextInvitation.update({
            where: { id },
            data: {
              state: row.expiresAt <= now ? 'EXPIRED' : 'REVOKED',
              endedAt: now,
              recipientUserId: null,
              recipientEmail: null,
              proofHash: null,
              revision: { increment: 1 },
            },
          });
        await this.kernel.offerEffect(
          tx,
          actor,
          spaceId,
          authority.actorId,
          'invitation.revoke',
          id,
          auditId,
        );
        return invitationView(result);
      },
    );
  }
  async changeMembership(
    actor: RequestActor,
    spaceId: string,
    accessId: string,
    revision: number,
    input:
      | z.infer<typeof c.MembershipChangeSchema>
      | z.infer<typeof c.TeamMembershipChangeSchema>,
  ) {
    return this.kernel.changeAccess(
      actor,
      { spaceId, scopeId: spaceId, accessId, revision, ...input },
      (tx, access) => this.memberView(tx, access),
    );
  }
  leave(actor: RequestActor, spaceId: string, revision: number) {
    return this.kernel.depart(actor, { spaceId, scopeId: spaceId, revision });
  }
  async createHandover(
    actor: RequestActor,
    spaceId: string,
    input: z.infer<typeof c.HandoverCreateSchema>,
    key: string | undefined,
  ) {
    const keyValue = keyHash(key),
      fingerprint = hash(JSON.stringify(input)),
      id = randomUUID(),
      successorUser = await this.userForAccess(
        this.db.client,
        input.successorAccessId,
      );
    const expired = (
      await this.db.client.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "OwnerHandover" WHERE "spaceId"=${spaceId}::uuid AND state='PENDING' AND "expiresAt"<=clock_timestamp() LIMIT 1`
    )[0];
    if (expired) await this.expire('handover', expired.id);
    return this.signed(
      actor,
      spaceId,
      successorUser ? [successorUser] : [],
      'handover.propose',
      id,
      async (tx, now, locked, begin) => {
        const authority = await this.kernel.participantAuthority(
          tx,
          actor,
          actor.userId,
          { spaceId, scopeId: spaceId, capability: 'custody.handover' },
          locked,
        );
        const prior = await tx.ownerHandover.findFirst({
          where: {
            spaceId,
            fromAccessId: authority.accessId,
            fromGeneration: authority.generation,
            keyHash: keyValue,
          },
        });
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new ConflictException();
          return handoverView(prior);
        }
        const target = await tx.contextAccess.findFirst({
          where: { id: input.successorAccessId, spaceId, scopeId: spaceId },
        });
        const currentUser = target && (await this.userForAccess(tx, target.id));
        if (
          !target ||
          !currentUser ||
          target.id === authority.accessId ||
          currentUser !== successorUser
        )
          throw new NotFoundException();
        await this.kernel.participantAuthority(
          tx,
          actor,
          currentUser,
          {
            spaceId,
            scopeId: spaceId,
            capability: 'custody.accept',
            generation: target.generation,
          },
          locked,
        );
        if (
          await tx.ownerHandover.findFirst({
            where: { spaceId, state: 'PENDING' },
          })
        )
          throw new ConflictException({ code: 'HANDOVER_ALREADY_PENDING' });
        await this.limit.take('handover.context:' + spaceId, 5, tx);
        const custody = await tx.sharedCustody.findUniqueOrThrow({
            where: { spaceId },
          }),
          auditId = await begin();
        const result = await tx.ownerHandover.create({
          data: {
            id,
            spaceId,
            scopeId: spaceId,
            fromAccessId: authority.accessId,
            fromGeneration: authority.generation,
            toAccessId: target.id,
            toGeneration: target.generation,
            expectedCustodyRevision: custody.revision + 1,
            keyHash: keyValue,
            fingerprint,
            createdAt: now,
            expiresAt: new Date(now.getTime() + week),
          },
        });
        await this.kernel.offerEffect(
          tx,
          actor,
          spaceId,
          authority.actorId,
          'handover.propose',
          id,
          auditId,
        );
        await this.receipt(
          tx,
          now,
          spaceId,
          authority.actorId,
          'handover.propose',
          hash('generation:' + authority.generation + ':' + keyValue),
          fingerprint,
          id,
        );
        return handoverView(result);
      },
    );
  }
  async handover(actor: RequestActor, spaceId: string, id: string) {
    return this.kernel.participate(
      actor,
      spaceId,
      [],
      async (tx, _now, locked) => {
        const row = await tx.ownerHandover.findFirst({
          where: { id, spaceId },
        });
        if (!row) throw new NotFoundException();
        const authority = await this.kernel.participantAuthority(
          tx,
          actor,
          actor.userId,
          { spaceId, scopeId: spaceId, capability: 'custody.accept' },
          locked,
        );
        if (
          authority.role !== 'OWNER' &&
          authority.accessId !== row.toAccessId &&
          authority.accessId !== row.fromAccessId
        )
          throw new NotFoundException();
        return handoverView(row);
      },
    );
  }
  async decideHandover(
    actor: RequestActor,
    spaceId: string,
    id: string,
    revision: number,
    decision: 'accept' | 'decline' | 'revoke',
    password?: string,
  ) {
    const hint = await this.db.client.ownerHandover.findFirst({
      where: { id, spaceId },
    });
    if (!hint) throw new NotFoundException();
    const users = (
      await Promise.all([
        this.userForAccess(this.db.client, hint.fromAccessId),
        this.userForAccess(this.db.client, hint.toAccessId),
      ])
    ).filter((u): u is string => !!u);
    return this.signed(
      actor,
      spaceId,
      users,
      'handover.' + decision,
      id,
      async (tx, now, locked, begin) => {
        const row = await tx.ownerHandover.findUniqueOrThrow({ where: { id } });
        const authority = await this.kernel.participantAuthority(
          tx,
          actor,
          actor.userId,
          {
            spaceId,
            scopeId: spaceId,
            capability:
              decision === 'revoke' ? 'custody.handover' : 'custody.accept',
          },
          locked,
        );
        if (
          decision === 'revoke'
            ? authority.accessId !== row.fromAccessId
            : authority.accessId !== row.toAccessId
        )
          throw new NotFoundException();
        if (
          row.state === 'ACCEPTED' &&
          decision === 'accept' &&
          row.toGeneration === authority.generation
        )
          return handoverView(row);
        if (
          row.state !== 'PENDING' ||
          row.expiresAt <= now ||
          row.revision !== revision
        )
          throw new ConflictException();
        const fromUser = await this.userForAccess(tx, row.fromAccessId);
        if (!fromUser) throw new NotFoundException();
        const initiating = await this.kernel.participantAuthority(
          tx,
          actor,
          fromUser,
          {
            spaceId,
            scopeId: spaceId,
            capability: 'custody.handover',
            generation: row.fromGeneration,
          },
          locked,
        );
        if (initiating.accessId !== row.fromAccessId)
          throw new ConflictException();
        const custody = await tx.sharedCustody.findUniqueOrThrow({
          where: { spaceId },
        });
        if (decision === 'accept') {
          if (
            authority.generation !== row.toGeneration ||
            custody.revision !== row.expectedCustodyRevision ||
            custody.primaryOwnerAccessId !== row.fromAccessId
          )
            throw new ConflictException({ code: 'CUSTODY_CHANGED' });
          if (!password) throw new BadRequestException();
          await this.auth.verifyPasswordInside(tx, actor.userId, password);
        }
        const acceptedAt = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
        )[0]!.now;
        if (row.expiresAt <= acceptedAt) throw new ConflictException();
        const auditId = await begin();
        if (decision === 'accept')
          await tx.sharedCustody.update({
            where: { spaceId },
            data: { primaryOwnerAccessId: authority.accessId },
          });
        const result = await tx.ownerHandover.update({
          where: { id },
          data: {
            state:
              decision === 'accept'
                ? 'ACCEPTED'
                : decision === 'decline'
                  ? 'DECLINED'
                  : 'REVOKED',
            endedAt: acceptedAt,
            revision: { increment: 1 },
            ...(decision === 'accept'
              ? {
                  acceptedByActorId: authority.actorId,
                  reauthenticatedAt: acceptedAt,
                }
              : {}),
          },
        });
        const updated = await this.kernel.offerEffect(
          tx,
          actor,
          spaceId,
          authority.actorId,
          'handover.' + decision,
          id,
          auditId,
          decision === 'accept'
            ? {
                actorId: initiating.actorId,
                feature: 'shared.custody',
                delta: -1,
              }
            : undefined,
        );
        if (decision === 'accept') {
          const acquired = randomUUID();
          await tx.sharedAuditEvent.create({
            data: {
              id: acquired,
              spaceId,
              actorId: authority.actorId,
              action: 'custody.acquire',
              resourceId: id,
              requestId: actor.requestId,
            },
          });
          await tx.sharedOutboxEvent.create({
            data: {
              id: randomUUID(),
              spaceId,
              actorId: authority.actorId,
              auditId: acquired,
              action: 'custody.acquire',
              authorizationVersion: updated.authorizationVersion,
            },
          });
          await tx.sharedUsageEntry.create({
            data: {
              id: randomUUID(),
              spaceId,
              subjectActorId: authority.actorId,
              auditId: acquired,
              feature: 'shared.custody',
              delta: 1,
            },
          });
        }
        await this.receipt(
          tx,
          acceptedAt,
          spaceId,
          authority.actorId,
          'handover.' + decision,
          hash(id),
          hash(JSON.stringify({ id, decision, actorId: authority.actorId })),
          id,
        );
        return handoverView(result);
      },
    );
  }
  async expire(kind: 'invitation' | 'handover', id: string) {
    const hint =
      kind === 'invitation'
        ? await this.db.client.contextInvitation.findUnique({ where: { id } })
        : await this.db.client.ownerHandover.findUnique({ where: { id } });
    if (!hint) return false;
    return this.signed(
      null,
      hint.spaceId,
      [],
      kind + '.expire',
      id,
      async (tx, now, _locked, begin) => {
        const row =
          kind === 'invitation'
            ? await tx.contextInvitation.findUniqueOrThrow({ where: { id } })
            : await tx.ownerHandover.findUniqueOrThrow({ where: { id } });
        if (row.state !== 'PENDING' || row.expiresAt > now) return false;
        const accessId =
            'inviterAccessId' in row ? row.inviterAccessId : row.fromAccessId,
          access = await tx.contextAccess.findUniqueOrThrow({
            where: { id: accessId },
          }),
          auditId = await begin();
        if (kind === 'invitation')
          await tx.contextInvitation.update({
            where: { id },
            data: {
              state: 'EXPIRED',
              endedAt: now,
              recipientUserId: null,
              recipientEmail: null,
              proofHash: null,
              revision: { increment: 1 },
            },
          });
        else
          await tx.ownerHandover.update({
            where: { id },
            data: {
              state: 'EXPIRED',
              endedAt: now,
              revision: { increment: 1 },
            },
          });
        await this.kernel.offerEffect(
          tx,
          { userId: '', requestId: id, correlationId: id },
          row.spaceId,
          access.actorId,
          kind + '.expire',
          id,
          auditId,
        );
        return true;
      },
    );
  }
  async maintain() {
    const invitations = await this.db.client.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "ContextInvitation" WHERE state='PENDING' AND "expiresAt"<=clock_timestamp() ORDER BY "expiresAt",id LIMIT 25`;
    const handovers = await this.db.client.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "OwnerHandover" WHERE state='PENDING' AND "expiresAt"<=clock_timestamp() ORDER BY "expiresAt",id LIMIT 25`;
    for (const r of invitations) await this.expire('invitation', r.id);
    for (const r of handovers) await this.expire('handover', r.id);
    const removed = await this.limit.maintain();
    return invitations.length > 0 || handovers.length > 0 || removed > 0;
  }
}
