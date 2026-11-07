import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  Prisma,
  ContextAccess,
  ContextInvitation,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { SharedIdentity } from '../../../platform/auth/shared-identity.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedKernel } from './shared-kernel.service.js';
import { CollaborationService } from './collaboration.service.js';
import { CollaborationLimit } from './collaboration-limit.js';
import { SharedAuthority } from '../public/shared-authority.js';
import type { SharedAccess } from '../public/shared-authority.js';
import { companyDefaultPolicy } from '../domain/shared-policy.js';
type Tx = Prisma.TransactionClient;
type Role = z.infer<typeof c.CompanyMemberRoleSchema>;
type Page = z.infer<typeof c.CompanyPageQuerySchema>;
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
function key(v: string | undefined) {
  if (!v || !/^[!-~]{1,128}$/.test(v)) throw new BadRequestException();
  return v;
}
function proofHash(v: string | undefined) {
  if (
    !v ||
    !/^[A-Za-z0-9_-]{43}$/.test(v) ||
    Buffer.from(v, 'base64url').toString('base64url') !== v
  )
    throw new NotFoundException();
  return digest(v);
}
export type CompanyTransaction = {
  tx: Tx;
  now: Date;
  locked: string[];
  root: SharedAccess;
  actor: RequestActor;
  spaceId: string;
  begin: () => Promise<string>;
};
@Injectable()
export class CompanyAccess {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) readonly kernel: SharedKernel,
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
    @Inject(SharedIdentity) private readonly identity: SharedIdentity,
    @Inject(CollaborationLimit) private readonly limit: CollaborationLimit,
  ) {}
  private async context(
    tx: Tx,
    actor: RequestActor,
    spaceId: string,
    now: Date,
    locked: string[],
    begin: () => Promise<string>,
  ): Promise<CompanyTransaction> {
    if (
      (await tx.sharedCustody.findUniqueOrThrow({ where: { spaceId } }))
        .kind !== 'COMPANY'
    )
      throw new NotFoundException();
    const root = await this.kernel.participantAuthority(
      tx,
      actor,
      actor.userId,
      { spaceId, scopeId: spaceId, capability: 'task.read' },
      locked,
    );
    return { tx, actor, spaceId, now, locked, root, begin };
  }
  read<T>(
    actor: RequestActor,
    spaceId: string,
    work: (ctx: CompanyTransaction) => Promise<T>,
    users: string[] = [],
  ) {
    return this.kernel.participate(
      actor,
      spaceId,
      users,
      async (tx, now, locked) =>
        work(
          await this.context(tx, actor, spaceId, now, locked, async () => {
            throw new Error('Read cannot publish effects');
          }),
        ),
    );
  }
  write<T>(
    actor: RequestActor,
    spaceId: string,
    action: string,
    target: string,
    work: (ctx: CompanyTransaction) => Promise<T>,
    users: string[] = [],
  ) {
    return this.collaboration.signed(
      actor,
      spaceId,
      users,
      action,
      target,
      async (tx, now, locked, begin) =>
        work(await this.context(tx, actor, spaceId, now, locked, begin)),
    );
  }
  async writeAcross<T>(
    actor: RequestActor,
    spaceId: string,
    projectSpaceId: string,
    action: string,
    target: string,
    work: (ctx: CompanyTransaction, authority: SharedAuthority) => Promise<T>,
  ) {
    const users = await this.staffHints(spaceId);
    let authority: SharedAuthority;
    return this.collaboration.signed(
      actor,
      spaceId,
      users,
      action,
      target,
      async (tx, now, locked, begin) =>
        work(
          await this.context(tx, actor, spaceId, now, locked, begin),
          authority,
        ),
      false,
      'PROJECT',
      (body, abort) =>
        this.kernel.run(
          actor,
          { userIds: users, spaceIds: [spaceId, projectSpaceId] },
          [
            { spaceId, scopeId: spaceId, capability: 'task.read' },
            {
              spaceId: projectSpaceId,
              scopeId: projectSpaceId,
              capability: 'settings.manage',
            },
          ],
          async (tx, a) => {
            authority = a;
            const now = (
              await tx.$queryRaw<
                { now: Date }[]
              >`SELECT clock_timestamp() AS now`
            )[0]!.now;
            return body(tx, now, [...new Set([...users, actor.userId])]);
          },
          abort,
        ),
    );
  }
  async seat(
    ctx: CompanyTransaction,
    scopeId: string,
    userId = ctx.actor.userId,
  ) {
    return this.kernel.participantAuthority(
      ctx.tx,
      ctx.actor,
      userId,
      { spaceId: ctx.spaceId, scopeId, capability: 'task.read' },
      ctx.locked,
    );
  }
  isAdmin(ctx: CompanyTransaction) {
    return ['OWNER', 'ORG_ADMIN'].includes(ctx.root.role ?? '');
  }
  async administer(
    ctx: CompanyTransaction,
    scopeId: string,
    roles: Role[] = [],
  ) {
    if (roles.includes('ORG_ADMIN')) {
      if (ctx.root.role !== 'OWNER') throw new ForbiddenException();
      return ctx.root;
    }
    if (this.isAdmin(ctx)) return ctx.root;
    if (
      scopeId === ctx.spaceId ||
      roles.some((r) => !['MEMBER', 'VIEWER'].includes(r))
    )
      throw new ForbiddenException();
    const seat = await this.seat(ctx, scopeId);
    if (seat.role !== 'DEPT_MANAGER') throw new ForbiddenException();
    return seat;
  }
  async seedScope(
    ctx: CompanyTransaction,
    scopeId: string,
    kind: 'DEPARTMENT' | 'UNIT',
  ) {
    await ctx.tx.accessScope.create({
      data: { id: scopeId, spaceId: ctx.spaceId, kind },
    });
    await ctx.tx.contextCapabilityPolicy.create({
      data: {
        spaceId: ctx.spaceId,
        scopeId,
        version: 1,
        roleDefaults: companyDefaultPolicy,
        exportMaxRecords: 10000,
        exportMaxBytes: 10485760,
        publishedByActorId: ctx.root.actorId,
        auditId: randomUUID(),
      },
    });
  }
  async once(
    ctx: CompanyTransaction,
    scopeId: string,
    operation: string,
    requestKey: string | undefined,
    input: unknown,
    work: () => Promise<{ id: string }>,
  ) {
    const authority = new SharedAuthority(ctx.tx, [ctx.root]);
    try {
      return await this.kernel.receipt(
        ctx.tx,
        authority,
        { spaceId: ctx.spaceId, scopeId: ctx.spaceId, capability: 'task.read' },
        {
          operation,
          key: ctx.root.generation + ':' + scopeId + ':' + key(requestKey),
          fingerprint: digest(JSON.stringify(input)),
        },
        async () => ({ ...(await work()), statusCode: 201 }),
      );
    } finally {
      authority.close();
    }
  }
  async effect(
    ctx: CompanyTransaction,
    action: string,
    id: string,
    auditId: string,
    feature?:
      | 'company.expense'
      | 'company.budget'
      | 'company.commitment'
      | 'company.finance-category'
      | 'company.finance-reference'
      | 'company.expense-version'
      | 'file.shared'
      | 'company.department'
      | 'company.unit'
      | 'company.policy-version'
      | 'company.context-membership'
      | 'company.staff-profile'
      | 'company.availability-day'
      | 'company.resource'
      | 'company.allocation'
      | 'company.employee-case'
      | 'company.case-entry'
      | 'shared.membership',
    delta = 1,
    subject = ctx.root.actorId,
  ) {
    await this.kernel.offerEffect(
      ctx.tx,
      ctx.actor,
      ctx.spaceId,
      ctx.root.actorId,
      action,
      id,
      auditId,
      feature ? { actorId: subject, feature, delta } : undefined,
    );
  }
  async staffHints(spaceId: string) {
    this.kernel.assertEnabled();
    const actors = await this.db.client.sharedActor.findMany({
      where: {
        spaceId,
        state: 'ACTIVE',
        userId: { not: null },
        ContextAccess: {
          some: {
            spaceId,
            scopeId: spaceId,
            state: 'ACTIVE',
            memberRole: { not: null },
          },
        },
      },
      select: { userId: true },
      take: 1001,
    });
    if (actors.length > 1000) throw new PayloadTooLargeException();
    return actors.flatMap((a) => (a.userId ? [a.userId] : []));
  }
  async staffMembers(ctx: CompanyTransaction, scopeId: string) {
    const rows = await ctx.tx.$queryRaw<
      {
        accessId: string;
        generation: number;
        actorId: string;
        userId: string;
      }[]
    >`
      SELECT a.id "accessId",a.generation,a."actorId",u.id "userId"
      FROM "ContextAccess" a JOIN "SharedActor" actor ON actor.id=a."actorId" AND actor.state='ACTIVE'
      JOIN "User" u ON u.id=actor."userId" AND u."emailVerified"=true
      JOIN "Space" p ON p."ownerUserId"=u.id AND p.kind='PERSONAL' AND p."accessClosedAt" IS NULL
      JOIN "ContextAccess" root ON root."spaceId"=a."spaceId" AND root."scopeId"=a."spaceId" AND root."actorId"=a."actorId" AND root.state='ACTIVE' AND root."memberRole" IS NOT NULL
      WHERE a."spaceId"=${ctx.spaceId}::uuid AND a."scopeId"=${scopeId}::uuid AND a.state='ACTIVE' AND a."memberRole" IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM "SharedExitWork" e WHERE e."userId"=u.id AND e."closedAt">=root."joinedAt")
      AND (a."scopeId"=a."spaceId" OR EXISTS(SELECT 1 FROM "CompanyContextAdmission" b WHERE b."accessId"=a.id AND b.generation=a.generation AND b."rootAccessId"=root.id AND b."rootGeneration"=root.generation))
      ORDER BY a.id LIMIT 1001`;
    if (rows.length > 1000) throw new PayloadTooLargeException();
    if (rows.some((r) => !ctx.locked.includes(r.userId)))
      throw new ConflictException({ code: 'COMPANY_MEMBER_HINTS_CHANGED' });
    return rows;
  }
  async staffMember(
    ctx: CompanyTransaction,
    scopeId: string,
    member: { accessId: string; generation: number },
  ) {
    const current = (await this.staffMembers(ctx, scopeId)).find(
      (r) =>
        r.accessId === member.accessId && r.generation === member.generation,
    );
    if (!current) throw new NotFoundException();
    const seat = await this.seat(ctx, scopeId, current.userId);
    return { ...current, role: seat.role };
  }
  async staffEmail(ctx: CompanyTransaction, userId: string) {
    if (!ctx.locked.includes(userId)) throw new ConflictException();
    const identity = await this.identity.current(ctx.tx, userId);
    return identity?.emailVerified ? identity.email : null;
  }
  async staffReviewer(ctx: CompanyTransaction, member: { userId: string }) {
    const seat = await this.seat(ctx, ctx.spaceId, member.userId);
    return ['OWNER', 'ORG_ADMIN'].includes(seat.role ?? '');
  }
  async staffErasureAllowed(tx: Tx, spaceId: string) {
    const custody = await tx.sharedCustody.findUniqueOrThrow({
      where: { spaceId },
    });
    const row = await tx.sharedRetentionPolicy.findUniqueOrThrow({
      where: { version: custody.retentionPolicyVersion },
    });
    const policy = row.configuration as {
      holds?: { state: string }[];
      obligations?: { state: string }[];
    };
    if (
      policy.holds?.some((h) => h.state === 'ACTIVE') ||
      policy.obligations?.some((o) => o.state === 'OUTSTANDING')
    )
      throw new ConflictException({
        code: 'SENSITIVE_ERASURE_DISPOSITION_REQUIRED',
      });
  }
  async staffActorAdmissions(tx: Tx, spaceId: string, actorId: string) {
    return tx.contextAccess.findMany({
      where: { spaceId, actorId },
      select: { id: true },
    });
  }
  async membership(tx: Tx, row: ContextAccess) {
    const custody = await tx.sharedCustody.findUniqueOrThrow({
      where: { spaceId: row.spaceId },
    });
    return c.CompanyMembershipSchema.strip().parse({
      ...row,
      role: row.id === custody.primaryOwnerAccessId ? 'OWNER' : row.memberRole,
    });
  }
  private async rootSeat(tx: Tx, spaceId: string, userId: string) {
    return tx.contextAccess.findFirst({
      where: {
        spaceId,
        scopeId: spaceId,
        SharedActor: { userId, state: 'ACTIVE' },
      },
    });
  }
  private async issuerUser(row: ContextInvitation) {
    return (
      (
        await this.db.client.contextAccess.findUnique({
          where: { id: row.companyIssuerAccessId ?? row.inviterAccessId },
          include: { SharedActor: true },
        })
      )?.SharedActor.userId ?? null
    );
  }
  private invitation(row: ContextInvitation) {
    return c.CompanyInvitationSchema.strip().parse({
      ...row,
      scopeId: row.companyScopeId,
      expiresAt: row.expiresAt.toISOString(),
    });
  }
  async members(ctx: CompanyTransaction, scopeId: string, q: Page) {
    const stamp = digest(
        JSON.stringify([
          ctx.root.generation,
          String(
            (
              await ctx.tx.sharedCustody.findUniqueOrThrow({
                where: { spaceId: ctx.spaceId },
              })
            ).authorizationVersion,
          ),
        ]),
      ),
      context = 'company-members:' + ctx.spaceId + ':' + scopeId;
    const after = this.kernel.cursorPosition(
      context,
      stamp,
      ctx.actor.userId,
      q.after,
    );
    const rows = await ctx.tx.$queryRaw<
      ContextAccess[]
    >`SELECT a.* FROM "ContextAccess" a JOIN "SharedActor" u ON u.id=a."actorId" JOIN "User" i ON i.id=u."userId" AND i."emailVerified"=true JOIN "Space" p ON p."ownerUserId"=i.id AND p.kind='PERSONAL' JOIN "ContextAccess" root ON root."spaceId"=a."spaceId" AND root."scopeId"=a."spaceId" AND root."actorId"=a."actorId" WHERE a."spaceId"=${ctx.spaceId}::uuid AND a."scopeId"=${scopeId}::uuid AND a."memberRole" IS NOT NULL AND a.state IN ('ACTIVE','SUSPENDED') AND u.state='ACTIVE' AND p."accessClosedAt" IS NULL AND root.state='ACTIVE' AND NOT EXISTS(SELECT 1 FROM "SharedExitWork" e WHERE e."userId"=i.id AND e."closedAt">=root."joinedAt") AND (a."scopeId"=a."spaceId" OR EXISTS(SELECT 1 FROM "CompanyContextAdmission" b WHERE b."accessId"=a.id AND b.generation=a.generation AND b."rootAccessId"=root.id AND b."rootGeneration"=root.generation)) AND (${after ?? null}::uuid IS NULL OR a.id>${after ?? null}::uuid) ORDER BY a.id LIMIT ${q.limit + 1}`;
    const items = await Promise.all(
      rows.slice(0, q.limit).map((r) => this.membership(ctx.tx, r)),
    );
    return this.kernel.cursorPage(context, stamp, ctx.actor.userId, {
      items,
      nextCursor: rows.length > q.limit ? items.at(-1)!.id : null,
    });
  }
  async change(
    ctx: CompanyTransaction,
    scopeId: string,
    id: string,
    revision: number,
    input: z.infer<typeof c.CompanyMembershipChangeSchema>,
  ) {
    const row = await ctx.tx.contextAccess.findFirst({
      where: { id, spaceId: ctx.spaceId, scopeId },
    });
    if (!row) throw new NotFoundException();
    await this.administer(ctx, scopeId, [
      c.CompanyMemberRoleSchema.parse(row.memberRole),
      input.memberRole,
    ]);
    if (
      row.actorId === ctx.root.actorId ||
      row.id ===
        (
          await ctx.tx.sharedCustody.findUniqueOrThrow({
            where: { spaceId: ctx.spaceId },
          })
        ).primaryOwnerAccessId
    )
      throw new ConflictException({ code: 'CUSTODIAN_OR_SELF_CHANGE_DENIED' });
    if (
      row.revision !== revision ||
      !['ACTIVE', 'SUSPENDED'].includes(row.state)
    )
      throw new ConflictException();
    if (scopeId !== ctx.spaceId) {
      const root = await ctx.tx.contextAccess.findFirst({
          where: {
            spaceId: ctx.spaceId,
            scopeId: ctx.spaceId,
            actorId: row.actorId,
            state: 'ACTIVE',
          },
        }),
        binding = await ctx.tx.companyContextAdmission.findUnique({
          where: {
            accessId_generation: {
              accessId: row.id,
              generation: row.generation,
            },
          },
        });
      if (!root || binding?.rootGeneration !== root.generation)
        throw new NotFoundException();
    }
    const audit = await ctx.begin(),
      ending = input.state === 'REVOKED';
    const changed = await ctx.tx.contextAccess.update({
      where: { id },
      data: {
        memberRole: input.memberRole,
        state: input.state,
        revision: { increment: 1 },
        endedAt: ending ? ctx.now : null,
      },
    });
    if (ending)
      await ctx.tx.contextAccessInterval.update({
        where: {
          accessId_generation: { accessId: id, generation: row.generation },
        },
        data: { endedAt: ctx.now },
      });
    await this.effect(
      ctx,
      'company.membership.change',
      id,
      audit,
      ending
        ? scopeId === ctx.spaceId
          ? 'shared.membership'
          : 'company.context-membership'
        : undefined,
      -1,
      row.actorId,
    );
    return this.membership(ctx.tx, changed);
  }
  async leave(
    actor: RequestActor,
    spaceId: string,
    scopeId: string,
    revision: number,
  ) {
    if (scopeId === spaceId)
      return this.kernel.depart(actor, { spaceId, scopeId, revision });
    return this.write(
      actor,
      spaceId,
      'company.context.leave',
      scopeId,
      async (ctx) => {
        const a = await this.kernel.participantAuthority(
            ctx.tx,
            actor,
            actor.userId,
            { spaceId, scopeId, capability: 'membership.leave' },
            ctx.locked,
          ),
          row = await ctx.tx.contextAccess.findUniqueOrThrow({
            where: { id: a.accessId },
          });
        if (row.revision !== revision) throw new ConflictException();
        const audit = await ctx.begin();
        await ctx.tx.contextAccess.update({
          where: { id: row.id },
          data: { state: 'LEFT', endedAt: ctx.now, revision: { increment: 1 } },
        });
        await ctx.tx.contextAccessInterval.update({
          where: {
            accessId_generation: {
              accessId: row.id,
              generation: row.generation,
            },
          },
          data: { endedAt: ctx.now },
        });
        await this.effect(
          ctx,
          'company.context.leave',
          row.id,
          audit,
          'company.context-membership',
          -1,
          row.actorId,
        );
        return { id: row.id, revision: row.revision + 1 };
      },
    );
  }
  async invite(
    actor: RequestActor,
    spaceId: string,
    scopeId: string,
    input: z.infer<typeof c.CompanyInvitationCreateSchema>,
    requestKey: string | undefined,
    check: (ctx: CompanyTransaction) => Promise<void>,
  ) {
    const body = c.CompanyInvitationCreateSchema.parse(input),
      k = key(requestKey),
      email =
        'email' in body.recipient
          ? this.identity.canonicalEmail(body.recipient.email)
          : null;
    const hinted = email
      ? await this.identity.byEmail(this.db.client, email)
      : await this.identity.current(
          this.db.client,
          'userId' in body.recipient ? body.recipient.userId : '',
        );
    return this.write(
      actor,
      spaceId,
      'company.invitation.create',
      scopeId,
      async (ctx) => {
        await check(ctx);
        const issuer = await this.administer(ctx, scopeId, [body.memberRole]);
        const target = email
          ? await this.identity.byEmail(ctx.tx, email)
          : await this.identity.current(
              ctx.tx,
              'userId' in body.recipient ? body.recipient.userId : '',
            );
        if (
          target?.id !== hinted?.id ||
          (target && !ctx.locked.includes(target.id))
        )
          throw new ConflictException({ code: 'IDENTITY_CHANGED_RESTART' });
        if (!email && !target) throw new NotFoundException();
        if (target?.id === actor.userId) throw new ConflictException();
        const root = target
          ? await this.rootSeat(ctx.tx, spaceId, target.id)
          : null;
        if (
          scopeId !== spaceId &&
          (!root || root.state !== 'ACTIVE' || !root.memberRole)
        )
          throw new NotFoundException();
        const targetSeat = target
          ? await ctx.tx.contextAccess.findFirst({
              where: {
                spaceId,
                scopeId,
                SharedActor: { userId: target.id, state: 'ACTIVE' },
              },
            })
          : null;
        const keyHash = digest(ctx.root.generation + ':' + scopeId + ':' + k),
          fingerprint = digest(JSON.stringify(body));
        const prior = await ctx.tx.contextInvitation.findUnique({
          where: {
            spaceId_inviterAccessId_inviterGeneration_keyHash: {
              spaceId,
              inviterAccessId: ctx.root.accessId,
              inviterGeneration: ctx.root.generation,
              keyHash,
            },
          },
        });
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new ConflictException();
          return { invitation: this.invitation(prior), proof: null };
        }
        await this.limit.take('invitation.context:' + spaceId, 20, ctx.tx);
        const proof = randomBytes(32).toString('base64url'),
          id = randomUUID(),
          audit = await ctx.begin();
        const row = await ctx.tx.contextInvitation.create({
          data: {
            id,
            spaceId,
            scopeId: spaceId,
            inviterAccessId: ctx.root.accessId,
            inviterGeneration: ctx.root.generation,
            memberRole: body.memberRole,
            recipientUserId: email ? null : target!.id,
            recipientEmail: email,
            keyHash,
            fingerprint,
            proofHash: digest(proof),
            createdAt: ctx.now,
            expiresAt: new Date(ctx.now.getTime() + 604800000),
            companyScopeId: scopeId,
            companyAdmissionVersion: 1,
            companyTargetAccessId: targetSeat?.id ?? null,
            companyTargetGeneration: targetSeat?.generation ?? null,
            companyTargetRevision: targetSeat?.revision ?? null,
            companyIssuerAccessId: issuer.accessId,
            companyIssuerGeneration: issuer.generation,
            companyRecipientRootAccessId: scopeId !== spaceId ? root!.id : null,
            companyRecipientRootGeneration:
              scopeId !== spaceId ? root!.generation : null,
            companyRestoreGeneration: (
              await ctx.tx.accessScope.findUniqueOrThrow({
                where: { id: spaceId },
              })
            ).restoreGeneration,
          },
        });
        await this.effect(ctx, 'company.invitation.create', id, audit);
        return { invitation: this.invitation(row), proof };
      },
      hinted ? [hinted.id] : [],
    );
  }
  private async issuer(ctx: CompanyTransaction, row: ContextInvitation) {
    const root = await ctx.tx.contextAccess.findUnique({
      where: { id: row.inviterAccessId },
      include: { SharedActor: true },
    });
    if (
      !root?.SharedActor.userId ||
      root.state !== 'ACTIVE' ||
      root.generation !== row.inviterGeneration
    )
      throw new NotFoundException();
    const userId = root.SharedActor.userId,
      rootProof = await this.seat(ctx, ctx.spaceId, userId);
    const issuerCtx = {
      ...ctx,
      actor: { ...ctx.actor, userId },
      root: rootProof,
    };
    const issuer = await this.administer(issuerCtx, row.companyScopeId!, [
      c.CompanyMemberRoleSchema.parse(row.memberRole),
    ]);
    if (
      issuer.accessId !== row.companyIssuerAccessId ||
      issuer.generation !== row.companyIssuerGeneration
    )
      throw new NotFoundException();
  }
  async offer(
    ctx: CompanyTransaction,
    scopeId: string,
    id: string,
    revoke = false,
    revision?: number,
  ) {
    const row = await ctx.tx.contextInvitation.findFirst({
      where: { id, spaceId: ctx.spaceId, companyScopeId: scopeId },
    });
    if (!row) throw new NotFoundException();
    await this.administer(ctx, scopeId, [
      c.CompanyMemberRoleSchema.parse(row.memberRole),
    ]);
    if (!revoke) return this.invitation(row);
    if (row.revision !== revision || row.state !== 'PENDING')
      throw new ConflictException();
    const audit = await ctx.begin(),
      changed = await ctx.tx.contextInvitation.update({
        where: { id },
        data: {
          state: 'REVOKED',
          endedAt: ctx.now,
          recipientUserId: null,
          recipientEmail: null,
          proofHash: null,
          revision: { increment: 1 },
        },
      });
    await this.effect(ctx, 'company.invitation.revoke', id, audit);
    return this.invitation(changed);
  }
  private async admit(
    tx: Tx,
    spaceId: string,
    scopeId: string,
    userId: string,
    role: Role,
    now: Date,
  ) {
    let actor = await tx.sharedActor.findFirst({
      where: { spaceId, userId, state: 'ACTIVE' },
    });
    if (!actor)
      actor = await tx.sharedActor.create({
        data: { id: randomUUID(), spaceId, userId, state: 'ACTIVE' },
      });
    const old = await tx.contextAccess.findUnique({
      where: {
        spaceId_scopeId_actorId: { spaceId, scopeId, actorId: actor.id },
      },
    });
    let root =
      scopeId !== spaceId ? await this.rootSeat(tx, spaceId, userId) : null;
    if (
      scopeId !== spaceId &&
      (!root || root.state !== 'ACTIVE' || !root.memberRole)
    )
      throw new NotFoundException();
    if (old && ['ACTIVE', 'SUSPENDED'].includes(old.state)) {
      const binding =
        scopeId !== spaceId
          ? await tx.companyContextAdmission.findUnique({
              where: {
                accessId_generation: {
                  accessId: old.id,
                  generation: old.generation,
                },
              },
            })
          : null;
      if (scopeId === spaceId || binding?.rootGeneration === root!.generation)
        throw new ConflictException({
          code: 'EXPLICIT_MEMBERSHIP_CHANGE_REQUIRED',
        });
      await tx.contextAccess.update({
        where: { id: old.id },
        data: { state: 'LEFT', endedAt: now, revision: { increment: 1 } },
      });
      await tx.contextAccessInterval.update({
        where: {
          accessId_generation: { accessId: old.id, generation: old.generation },
        },
        data: { endedAt: now },
      });
    }
    const row = old
      ? await tx.contextAccess.update({
          where: { id: old.id },
          data: {
            state: 'ACTIVE',
            memberRole: role,
            generation: { increment: 1 },
            revision: { increment: 1 },
            joinedAt: now,
            endedAt: null,
          },
        })
      : await tx.contextAccess.create({
          data: {
            id: randomUUID(),
            spaceId,
            scopeId,
            actorId: actor.id,
            state: 'ACTIVE',
            memberRole: role,
            joinedAt: now,
          },
        });
    await tx.contextAccessInterval.create({
      data: { accessId: row.id, generation: row.generation, joinedAt: now },
    });
    if (root)
      await tx.companyContextAdmission.create({
        data: {
          spaceId,
          scopeId,
          accessId: row.id,
          generation: row.generation,
          actorId: actor.id,
          rootScopeId: spaceId,
          rootAccessId: root.id,
          rootGeneration: root.generation,
        },
      });
    else root = row;
    return { row, root };
  }
  async decide(
    actor: RequestActor,
    id: string,
    proof: string | undefined,
    revision: number,
    accept: boolean,
  ) {
    const hash = proofHash(proof),
      hint = await this.db.client.contextInvitation.findUnique({
        where: { id },
      });
    if (!hint?.companyScopeId || hint.proofHash !== hash)
      throw new NotFoundException();
    const issuer = await this.issuerUser(hint);
    return this.collaboration.signed(
      actor,
      hint.spaceId,
      issuer ? [issuer] : [],
      'company.invitation.decide',
      id,
      async (tx, now, locked, begin) => {
        const row = await tx.contextInvitation.findUniqueOrThrow({
            where: { id },
          }),
          identity = await this.identity.current(tx, actor.userId),
          custody = await tx.sharedCustody.findUniqueOrThrow({
            where: { spaceId: row.spaceId },
          });
        if (
          custody.kind !== 'COMPANY' ||
          row.proofHash !== hash ||
          !identity?.emailVerified
        )
          throw new NotFoundException();
        const root = await this.rootSeat(tx, row.spaceId, actor.userId);
        if (row.state === 'ACCEPTED') {
          if (
            !accept ||
            !root ||
            root.actorId !== row.acceptedActorId ||
            root.generation !== row.acceptedGeneration
          )
            throw new NotFoundException();
          const ctx = await this.context(
              tx,
              actor,
              row.spaceId,
              now,
              locked,
              begin,
            ),
            seat = await this.seat(ctx, row.companyScopeId!);
          if (seat.accessId !== row.companyAcceptedAccessId)
            throw new NotFoundException();
          return {
            invitation: this.invitation(row),
            membership: await this.membership(
              tx,
              await tx.contextAccess.findUniqueOrThrow({
                where: { id: seat.accessId },
              }),
            ),
          };
        }
        if (
          row.state !== 'PENDING' ||
          row.expiresAt <= now ||
          row.revision !== revision ||
          row.companyRestoreGeneration !==
            (
              await tx.accessScope.findUniqueOrThrow({
                where: { id: row.spaceId },
              })
            ).restoreGeneration
        )
          throw new NotFoundException();
        if (
          row.recipientUserId !== actor.userId &&
          row.recipientEmail !== identity.email
        )
          throw new NotFoundException();
        // The recipient need not already have Company admission for a root offer.
        const issuerRoot = await tx.contextAccess.findUniqueOrThrow({
          where: { id: row.inviterAccessId },
        });
        const ctx: CompanyTransaction = {
          tx,
          actor,
          spaceId: row.spaceId,
          now,
          locked,
          begin,
          root: {
            spaceId: row.spaceId,
            scopeId: row.spaceId,
            actorId: issuerRoot.actorId,
            accessId: issuerRoot.id,
            generation: issuerRoot.generation,
            role: 'MEMBER',
            authorizationVersion: custody.authorizationVersion,
            capability: 'task.read',
          },
        };
        await this.issuer(ctx, row);
        if (
          row.companyScopeId !== row.spaceId &&
          (!root ||
            root.state !== 'ACTIVE' ||
            root.id !== row.companyRecipientRootAccessId ||
            root.generation !== row.companyRecipientRootGeneration)
        )
          throw new NotFoundException();
        const targetSeat = await tx.contextAccess.findFirst({
          where: {
            spaceId: row.spaceId,
            scopeId: row.companyScopeId!,
            SharedActor: { userId: actor.userId, state: 'ACTIVE' },
          },
        });
        if (
          row.companyAdmissionVersion !== 1 ||
          (targetSeat?.id ?? null) !== row.companyTargetAccessId ||
          (targetSeat &&
            (targetSeat.generation !== row.companyTargetGeneration ||
              targetSeat.revision !== row.companyTargetRevision))
        )
          throw new NotFoundException();
        const audit = await begin();
        if (accept)
          await this.kernel.featureGrowth(
            tx,
            row.spaceId,
            row.companyScopeId === row.spaceId
              ? 'shared.membership'
              : 'company.context-membership',
          );
        const admitted = accept
          ? await this.admit(
              tx,
              row.spaceId,
              row.companyScopeId!,
              actor.userId,
              c.CompanyMemberRoleSchema.parse(row.memberRole),
              now,
            )
          : null;
        const changed = await tx.contextInvitation.update({
          where: { id },
          data: {
            state: accept ? 'ACCEPTED' : 'DECLINED',
            endedAt: now,
            recipientUserId: null,
            recipientEmail: null,
            proofHash: accept ? row.proofHash : null,
            acceptedActorId: admitted?.root.actorId ?? null,
            acceptedAccessId: admitted?.root.id ?? null,
            acceptedGeneration: admitted?.root.generation ?? null,
            companyAcceptedAccessId: admitted?.row.id ?? null,
            revision: { increment: 1 },
          },
        });
        let actingActorId = admitted?.root.actorId ?? root?.actorId;
        if (!actingActorId) {
          const local =
            (await tx.sharedActor.findFirst({
              where: {
                spaceId: row.spaceId,
                userId: actor.userId,
                state: 'ACTIVE',
              },
            })) ??
            (await tx.sharedActor.create({
              data: {
                id: randomUUID(),
                spaceId: row.spaceId,
                userId: actor.userId,
                state: 'ACTIVE',
              },
            }));
          actingActorId = local.id;
        }
        const effectCtx = {
          ...ctx,
          root: { ...ctx.root, actorId: actingActorId },
        };
        await this.effect(
          effectCtx,
          'company.invitation.decide',
          id,
          audit,
          accept
            ? row.companyScopeId === row.spaceId
              ? 'shared.membership'
              : 'company.context-membership'
            : undefined,
          1,
          admitted?.row.actorId,
        );
        return {
          invitation: this.invitation(changed),
          membership: admitted ? await this.membership(tx, admitted.row) : null,
        };
      },
    );
  }
  async preview(proof: string | undefined) {
    const hash = proofHash(proof),
      hint = await this.db.client.contextInvitation.findUnique({
        where: { proofHash: hash },
      });
    if (!hint?.companyScopeId) throw new NotFoundException();
    const issuer = await this.issuerUser(hint),
      owner = (
        await this.db.client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: hint.spaceId },
          include: { ContextAccess: { include: { SharedActor: true } } },
        })
      ).ContextAccess?.SharedActor.userId,
      users = [
        ...new Set([issuer, owner].filter((id): id is string => Boolean(id))),
      ];
    return this.kernel
      .offerMaintenance(hint.spaceId, users, async (tx, now) => {
        const row = await tx.contextInvitation.findUniqueOrThrow({
            where: { id: hint.id },
          }),
          custody = await tx.sharedCustody.findUniqueOrThrow({
            where: { spaceId: row.spaceId },
          });
        if (
          custody.kind !== 'COMPANY' ||
          custody.state !== 'ACTIVE' ||
          row.state !== 'PENDING' ||
          row.companyAdmissionVersion !== 1 ||
          row.expiresAt <= now ||
          row.companyRestoreGeneration !==
            (
              await tx.accessScope.findUniqueOrThrow({
                where: { id: row.spaceId },
              })
            ).restoreGeneration
        )
          throw new NotFoundException();
        const root = await tx.contextAccess.findUniqueOrThrow({
          where: { id: row.inviterAccessId },
        });
        const ctx: CompanyTransaction = {
          tx,
          actor: {
            userId: issuer ?? '',
            requestId: row.id,
            correlationId: row.id,
          },
          spaceId: row.spaceId,
          now,
          locked: users,
          root: {
            spaceId: row.spaceId,
            scopeId: row.spaceId,
            actorId: root.actorId,
            accessId: root.id,
            generation: root.generation,
            role: 'MEMBER',
            authorizationVersion: custody.authorizationVersion,
            capability: 'task.read',
          },
          begin: async () => {
            throw new Error('Preview cannot write');
          },
        };
        await this.issuer(ctx, row);
        return { spaceId: row.spaceId, expiresAt: row.expiresAt.toISOString() };
      })
      .catch((error: unknown) => {
        if (
          error instanceof ForbiddenException ||
          error instanceof ConflictException
        )
          throw new NotFoundException();
        throw error;
      });
  }
}
