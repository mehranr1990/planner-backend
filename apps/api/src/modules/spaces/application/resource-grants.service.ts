import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type {
  Prisma,
  ResourceGrantOffer,
  ContextAccess,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { SharedKernel } from './shared-kernel.service.js';
import type { SharedRequest } from './shared-kernel.service.js';
import { SharedAuthority } from '../public/shared-authority.js';
import { CollaborationService } from './collaboration.service.js';
import { CollaborationLimit } from './collaboration-limit.js';
type Target = z.infer<typeof c.ResourceTargetSchema>;
type ValidateTarget = (
  tx: Prisma.TransactionClient,
  a: SharedAuthority,
  spaceId: string,
  target: Target,
) => Promise<void>;
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const targetOf = (row: ResourceGrantOffer): Target =>
  row.projectId
    ? { kind: 'PROJECT', id: row.projectId }
    : row.taskId
      ? { kind: 'TASK', id: row.taskId }
      : { kind: 'GOAL', id: row.goalId! };
const view = (row: ResourceGrantOffer) =>
  c.GrantOfferSchema.strip().parse({
    ...row,
    target: targetOf(row),
    expiresAt: row.expiresAt.toISOString(),
    grantExpiresAt: row.grantExpiresAt.toISOString(),
  });
function proofHash(proof: string | undefined) {
  if (
    !proof ||
    !/^[A-Za-z0-9_-]{43}$/.test(proof) ||
    Buffer.from(proof, 'base64url').toString('base64url') !== proof
  )
    throw new NotFoundException();
  return hash(proof);
}
@Injectable()
export class ResourceGrants {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
    @Inject(CollaborationLimit) private readonly limit: CollaborationLimit,
  ) {}
  private async issuerUser(tx: Prisma.TransactionClient, id: string) {
    const access = await tx.contextAccess.findUnique({ where: { id } });
    return access
      ? ((await tx.sharedActor.findUnique({ where: { id: access.actorId } }))
          ?.userId ?? null)
      : null;
  }
  private async recipientCeiling(
    tx: Prisma.TransactionClient,
    spaceId: string,
    access: ContextAccess | null,
    caps: string[],
  ) {
    if (
      access?.memberRole === 'VIEWER' &&
      caps.some((cap) => cap !== 'read') &&
      (await tx.sharedCustody.findUniqueOrThrow({ where: { spaceId } }))
        .primaryOwnerAccessId !== access.id
    )
      throw new BadRequestException({ code: 'RECIPIENT_ROLE_CEILING' });
  }
  private action(target: Target, cap: string): SharedRequest['capability'] {
    return cap === 'read'
      ? 'task.read'
      : target.kind === 'GOAL'
        ? 'goal.manage'
        : cap === 'complete'
          ? 'task.complete'
          : 'task.update';
  }
  private async issuer(
    tx: Prisma.TransactionClient,
    actor: RequestActor,
    spaceId: string,
    userId: string,
    generation: number | undefined,
    target: Target,
    caps: string[],
    locked: string[],
  ) {
    const requests: SharedRequest[] = [
      { spaceId, scopeId: spaceId, capability: 'membership.member' },
      ...caps.map((cap) => ({
        spaceId,
        scopeId: spaceId,
        capability: this.action(target, cap),
      })),
    ];
    const values = [];
    for (const request of requests)
      values.push(
        await this.kernel.participantAuthority(
          tx,
          actor,
          userId,
          { ...request, ...(generation === undefined ? {} : { generation }) },
          locked,
        ),
      );
    return new SharedAuthority(tx, values);
  }
  private async actor(
    tx: Prisma.TransactionClient,
    spaceId: string,
    userId: string,
  ) {
    const row = await tx.sharedActor.findFirst({
      where: { spaceId, userId, state: 'ACTIVE' },
    });
    return (
      row ??
      tx.sharedActor.create({
        data: { id: randomUUID(), spaceId, userId, state: 'ACTIVE' },
      })
    );
  }
  async createOffer(
    actor: RequestActor,
    spaceId: string,
    input: z.infer<typeof c.GrantOfferCreateSchema>,
    key: string | undefined,
    validate: ValidateTarget,
  ) {
    const body = c.GrantOfferCreateSchema.parse(input);
    if (
      !key ||
      !/^[!-~]{1,128}$/.test(key) ||
      !body.capabilities.includes('read')
    )
      throw new BadRequestException();
    const fingerprint = hash(JSON.stringify(body));
    if (!(await this.kernel.recipientUserHint(body.recipientUserId)))
      throw new NotFoundException();
    return this.collaboration.signed(
      actor,
      spaceId,
      [body.recipientUserId],
      'grant.offer.create',
      body.id,
      async (tx, now, locked, begin) => {
        const authority = await this.issuer(
          tx,
          actor,
          spaceId,
          actor.userId,
          undefined,
          body.target,
          body.capabilities,
          locked,
        );
        try {
          const issuer = authority.require(tx, spaceId, 'membership.member');
          const existing = await tx.resourceGrantOffer.findUnique({
            where: {
              spaceId_issuerAccessId_issuerGeneration_keyHash: {
                spaceId,
                issuerAccessId: issuer.accessId,
                issuerGeneration: issuer.generation,
                keyHash: hash(key),
              },
            },
          });
          if (existing) {
            if (existing.fingerprint !== fingerprint)
              throw new ConflictException();
            return { offer: view(existing), proof: null };
          }
          if (body.recipientUserId === actor.userId)
            throw new BadRequestException();
          await this.kernel.verifiedRecipient(tx, body.recipientUserId);
          await validate(tx, authority, spaceId, body.target);
          const expiry = new Date(body.grantExpiresAt);
          if (expiry <= now) throw new BadRequestException();
          const local = await this.actor(tx, spaceId, body.recipientUserId);
          const pending = await tx.resourceGrantOffer.count({
            where: {
              spaceId,
              recipientActorId: local.id,
              state: 'PENDING',
              expiresAt: { gt: now },
              grantExpiresAt: { gt: now },
              ...(body.target.kind === 'PROJECT'
                ? { projectId: body.target.id }
                : body.target.kind === 'TASK'
                  ? { taskId: body.target.id }
                  : { goalId: body.target.id }),
            },
          });
          if (pending >= 100)
            throw new ForbiddenException({
              code: 'RESOURCE_OFFER_SAFETY_LIMIT',
            });
          const admission = await tx.contextAccess.findUnique({
            where: {
              spaceId_scopeId_actorId: {
                spaceId,
                scopeId: spaceId,
                actorId: local.id,
              },
            },
          });
          if (admission?.state === 'SUSPENDED' || admission?.state === 'ERASED')
            throw new NotFoundException();
          await this.recipientCeiling(
            tx,
            spaceId,
            admission,
            body.capabilities,
          );
          await this.limit.take('grant.offer.context:' + spaceId, 20, tx);
          const proof = randomBytes(32).toString('base64url'),
            auditId = await begin();
          const row = await tx.resourceGrantOffer.create({
            data: {
              id: body.id,
              spaceId,
              scopeId: spaceId,
              issuerAccessId: issuer.accessId,
              issuerGeneration: issuer.generation,
              recipientActorId: local.id,
              recipientAccessId: admission?.id ?? null,
              recipientGeneration: admission?.generation ?? null,
              recipientRevision: admission?.revision ?? null,
              projectId: body.target.kind === 'PROJECT' ? body.target.id : null,
              taskId: body.target.kind === 'TASK' ? body.target.id : null,
              goalId: body.target.kind === 'GOAL' ? body.target.id : null,
              capabilities: body.capabilities,
              proofHash: hash(proof),
              keyHash: hash(key),
              fingerprint,
              createdAt: now,
              expiresAt: new Date(now.getTime() + 604800000),
              grantExpiresAt: expiry,
            },
          });
          await this.kernel.offerEffect(
            tx,
            actor,
            spaceId,
            issuer.actorId,
            'grant.offer.create',
            row.id,
            auditId,
          );
          return { offer: view(row), proof };
        } finally {
          authority.close();
        }
      },
    );
  }
  private async hint(id: string, proof: string | undefined) {
    this.kernel.assertEnabled();
    const row = await this.db.client.resourceGrantOffer.findFirst({
      where: { id, proofHash: proofHash(proof) },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async grantView(tx: Prisma.TransactionClient, id: string) {
    const g = await tx.resourceGrant.findUniqueOrThrow({ where: { id } });
    const p = await tx.projectGrant.findUnique({ where: { grantId: id } }),
      t = await tx.taskGrant.findUnique({ where: { grantId: id } }),
      o = await tx.goalGrant.findUnique({ where: { grantId: id } });
    return c.ResourceGrantSchema.strip().parse({
      ...g,
      target: p
        ? { kind: 'PROJECT', id: p.projectId }
        : t
          ? { kind: 'TASK', id: t.taskId }
          : { kind: 'GOAL', id: o!.goalId },
      expiresAt: g.expiresAt.toISOString(),
      revokedAt: g.revokedAt?.toISOString() ?? null,
    });
  }
  async preview(proof: string | undefined, validate: ValidateTarget) {
    this.kernel.assertEnabled();
    const row = await this.db.client.resourceGrantOffer.findUnique({
      where: { proofHash: proofHash(proof) },
    });
    if (!row) throw new NotFoundException();
    const user = await this.issuerUser(this.db.client, row.issuerAccessId);
    if (!user) throw new NotFoundException();
    const users = await this.kernel.offerUserHints(row.spaceId, user);
    try {
      return await this.kernel.offerMaintenance(
        row.spaceId,
        users,
        async (tx, now) => {
          const current = await tx.resourceGrantOffer.findUniqueOrThrow({
            where: { id: row.id },
          });
          if (
            current.state !== 'PENDING' ||
            current.expiresAt <= now ||
            current.grantExpiresAt <= now
          )
            throw new NotFoundException();
          const actor = {
            userId: user,
            requestId: randomUUID(),
            correlationId: randomUUID(),
          };
          const authority = await this.issuer(
            tx,
            actor,
            row.spaceId,
            user,
            current.issuerGeneration,
            targetOf(current),
            current.capabilities,
            users,
          );
          try {
            await validate(tx, authority, row.spaceId, targetOf(current));
            return {
              contextLabel: 'Project' as const,
              offerCategory: 'RESOURCE_GRANT' as const,
              expiresAt: current.expiresAt.toISOString(),
            };
          } finally {
            authority.close();
          }
        },
      );
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      )
        throw new NotFoundException();
      throw error;
    }
  }
  async decide(
    actor: RequestActor,
    id: string,
    proof: string | undefined,
    revision: number,
    accept: boolean,
    validate: ValidateTarget,
  ) {
    const hint = await this.hint(id, proof),
      user = await this.issuerUser(this.db.client, hint.issuerAccessId);
    return this.collaboration.signed(
      actor,
      hint.spaceId,
      user ? [user] : [],
      accept ? 'grant.offer.accept' : 'grant.offer.decline',
      id,
      async (tx, now, locked, begin) => {
        const row = await tx.resourceGrantOffer.findUniqueOrThrow({
            where: { id },
          }),
          local = await tx.sharedActor.findUniqueOrThrow({
            where: { id: row.recipientActorId },
          });
        if (
          row.proofHash !== proofHash(proof) ||
          local.userId !== actor.userId ||
          local.state !== 'ACTIVE'
        )
          throw new NotFoundException();
        if (row.state === 'ACCEPTED' && accept) {
          const grant = await this.grantView(tx, row.grantId!);
          const r = {
            spaceId: row.spaceId,
            scopeId: row.scopeId,
            capability: 'task.read' as const,
            resource: targetOf(row),
            generation: grant.granteeGeneration,
          };
          const access = await this.kernel.participantAuthority(
              tx,
              actor,
              actor.userId,
              r,
              locked,
            ),
            a = new SharedAuthority(tx, [access]);
          try {
            await validate(tx, a, row.spaceId, targetOf(row));
            return {
              offer: view(row),
              grant,
              admission: await this.collaboration.memberView(
                tx,
                await tx.contextAccess.findUniqueOrThrow({
                  where: { id: grant.granteeAccessId },
                }),
              ),
            };
          } finally {
            a.close();
          }
        }
        if (
          row.state !== 'PENDING' ||
          row.expiresAt <= now ||
          row.grantExpiresAt <= now
        )
          throw new NotFoundException();
        if (row.revision !== revision) throw new ConflictException();
        if (!user) throw new NotFoundException();
        const a = await this.issuer(
          tx,
          actor,
          row.spaceId,
          user,
          row.issuerGeneration,
          targetOf(row),
          row.capabilities,
          locked,
        );
        try {
          await validate(tx, a, row.spaceId, targetOf(row));
          let admission = await tx.contextAccess.findUnique({
            where: {
              spaceId_scopeId_actorId: {
                spaceId: row.spaceId,
                scopeId: row.scopeId,
                actorId: local.id,
              },
            },
          });
          if (admission?.state === 'SUSPENDED' || admission?.state === 'ERASED')
            throw new NotFoundException();
          if (
            accept &&
            ((admission?.id ?? null) !== row.recipientAccessId ||
              (admission &&
                (admission.generation !== row.recipientGeneration ||
                  admission.revision !== row.recipientRevision)))
          )
            throw new ConflictException({ code: 'ADMISSION_CHANGED' });
          if (accept && admission) {
            const target = targetOf(row);
            const count = await tx.resourceGrant.count({
              where: {
                spaceId: row.spaceId,
                granteeAccessId: admission.id,
                granteeGeneration: admission.generation,
                revokedAt: null,
                expiresAt: { gt: now },
                ...(target.kind === 'PROJECT'
                  ? { ProjectGrant: { some: { projectId: target.id } } }
                  : target.kind === 'TASK'
                    ? { TaskGrant: { some: { taskId: target.id } } }
                    : { GoalGrant: { some: { goalId: target.id } } }),
              },
            });
            if (count >= 100)
              throw new ForbiddenException({
                code: 'RESOURCE_GRANT_SAFETY_LIMIT',
              });
          }
          if (accept)
            await this.recipientCeiling(
              tx,
              row.spaceId,
              admission,
              row.capabilities,
            );
          if (accept)
            await this.kernel.featureGrowth(
              tx,
              row.spaceId,
              'shared.resource-grant',
            );
          const auditId = await begin();
          let grantId: string | null = null;
          if (accept) {
            if (!admission) {
              admission = await tx.contextAccess.create({
                data: {
                  id: randomUUID(),
                  spaceId: row.spaceId,
                  scopeId: row.scopeId,
                  actorId: local.id,
                  state: 'ACTIVE',
                  memberRole: null,
                  joinedAt: now,
                },
              });
              await tx.contextAccessInterval.create({
                data: { accessId: admission.id, generation: 1, joinedAt: now },
              });
            } else if (['LEFT', 'REVOKED'].includes(admission.state)) {
              admission = await tx.contextAccess.update({
                where: { id: admission.id },
                data: {
                  state: 'ACTIVE',
                  memberRole: null,
                  generation: { increment: 1 },
                  revision: { increment: 1 },
                  joinedAt: now,
                  endedAt: null,
                },
              });
              await tx.contextAccessInterval.create({
                data: {
                  accessId: admission.id,
                  generation: admission.generation,
                  joinedAt: now,
                },
              });
            }
            grantId = randomUUID();
            await tx.resourceGrant.create({
              data: {
                id: grantId,
                spaceId: row.spaceId,
                scopeId: row.scopeId,
                issuerAccessId: row.issuerAccessId,
                issuerGeneration: row.issuerGeneration,
                granteeAccessId: admission.id,
                granteeGeneration: admission.generation,
                capabilities: row.capabilities,
                expiresAt: row.grantExpiresAt,
              },
            });
            const common = {
              grantId,
              spaceId: row.spaceId,
              scopeId: row.scopeId,
            };
            if (row.projectId)
              await tx.projectGrant.create({
                data: { ...common, projectId: row.projectId },
              });
            else if (row.taskId)
              await tx.taskGrant.create({
                data: { ...common, taskId: row.taskId },
              });
            else
              await tx.goalGrant.create({
                data: { ...common, goalId: row.goalId! },
              });
          }
          const result = await tx.resourceGrantOffer.update({
            where: { id },
            data: {
              state: accept ? 'ACCEPTED' : 'DECLINED',
              proofHash: accept ? row.proofHash : null,
              grantId,
              endedAt: now,
              revision: { increment: 1 },
            },
          });
          await this.kernel.offerEffect(
            tx,
            actor,
            row.spaceId,
            local.id,
            accept ? 'grant.offer.accept' : 'grant.offer.decline',
            id,
            auditId,
            accept
              ? {
                  actorId: local.id,
                  feature: 'shared.resource-grant',
                  delta: 1,
                }
              : undefined,
          );
          return accept
            ? {
                offer: view(result),
                grant: await this.grantView(tx, grantId!),
                admission: await this.collaboration.memberView(tx, admission!),
              }
            : view(result);
        } finally {
          a.close();
        }
      },
    );
  }
  async readOffer(actor: RequestActor, spaceId: string, id: string) {
    return this.kernel.participate(
      actor,
      spaceId,
      [],
      async (tx, _now, locked) => {
        const row = await tx.resourceGrantOffer.findFirst({
          where: { id, spaceId },
        });
        if (!row) throw new NotFoundException();
        const a = await this.issuer(
          tx,
          actor,
          spaceId,
          actor.userId,
          undefined,
          targetOf(row),
          row.capabilities,
          locked,
        );
        try {
          return view(row);
        } finally {
          a.close();
        }
      },
    );
  }
  async revokeOffer(
    actor: RequestActor,
    spaceId: string,
    id: string,
    revision: number,
  ) {
    return this.collaboration.signed(
      actor,
      spaceId,
      [],
      'grant.offer.revoke',
      id,
      async (tx, now, locked, begin) => {
        const row = await tx.resourceGrantOffer.findFirst({
          where: { id, spaceId },
        });
        if (!row) throw new NotFoundException();
        const a = await this.issuer(
          tx,
          actor,
          spaceId,
          actor.userId,
          undefined,
          targetOf(row),
          row.capabilities,
          locked,
        );
        try {
          if (row.state !== 'PENDING' || row.revision !== revision)
            throw new ConflictException();
          const after = await tx.resourceGrantOffer.update({
            where: { id },
            data: {
              state: 'REVOKED',
              proofHash: null,
              endedAt: now,
              revision: { increment: 1 },
            },
          });
          await this.kernel.offerEffect(
            tx,
            actor,
            spaceId,
            a.require(tx, spaceId, 'membership.member').actorId,
            'grant.offer.revoke',
            id,
            await begin(),
          );
          return view(after);
        } finally {
          a.close();
        }
      },
    );
  }
  async revoke(
    actor: RequestActor,
    spaceId: string,
    id: string,
    revision: number,
  ) {
    return this.collaboration.signed(
      actor,
      spaceId,
      [],
      'grant.revoke',
      id,
      async (tx, now, locked, begin) => {
        const before = await tx.resourceGrant.findFirst({
          where: { id, spaceId },
        });
        if (!before) throw new NotFoundException();
        const safe = await this.grantView(tx, id),
          a = await this.issuer(
            tx,
            actor,
            spaceId,
            actor.userId,
            undefined,
            safe.target,
            safe.capabilities,
            locked,
          );
        try {
          if (before.revision !== revision || before.revokedAt)
            throw new ConflictException();
          const auditId = await begin();
          await tx.resourceGrant.update({
            where: { id },
            data: { revokedAt: now, revision: { increment: 1 } },
          });
          await this.kernel.offerEffect(
            tx,
            actor,
            spaceId,
            a.require(tx, spaceId, 'membership.member').actorId,
            'grant.revoke',
            id,
            auditId,
          );
          return this.grantView(tx, id);
        } finally {
          a.close();
        }
      },
    );
  }
  async maintain() {
    // No activation attempt or new control namespace when shared settings are absent.
    try {
      this.kernel.assertEnabled();
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
    const rows = await this.db.client.$queryRaw<
      { id: string; spaceId: string }[]
    >`SELECT id,"spaceId" FROM "ResourceGrantOffer" WHERE state='PENDING' AND ("expiresAt"<=clock_timestamp() OR "grantExpiresAt"<=clock_timestamp()) ORDER BY "expiresAt",id LIMIT 25`;
    for (const hint of rows)
      await this.collaboration.signed(
        null,
        hint.spaceId,
        [],
        'grant.offer.expire',
        hint.id,
        async (tx, now, _locked, begin) => {
          const row = await tx.resourceGrantOffer.findUniqueOrThrow({
            where: { id: hint.id },
          });
          if (
            row.state !== 'PENDING' ||
            (row.expiresAt > now && row.grantExpiresAt > now)
          )
            return;
          await tx.resourceGrantOffer.update({
            where: { id: row.id },
            data: {
              state: 'EXPIRED',
              proofHash: null,
              endedAt: now,
              revision: { increment: 1 },
            },
          });
          const issuer = await tx.contextAccess.findUniqueOrThrow({
            where: { id: row.issuerAccessId },
          });
          await this.kernel.offerEffect(
            tx,
            {
              userId: randomUUID(),
              requestId: randomUUID(),
              correlationId: randomUUID(),
            },
            row.spaceId,
            issuer.actorId,
            'grant.offer.expire',
            row.id,
            await begin(),
          );
        },
      );
    return rows.length > 0;
  }
}
