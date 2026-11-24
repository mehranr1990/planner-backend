import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import type {
  Prisma,
  CompanyCustodyTransfer,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { AuthService } from '../../../platform/auth/auth.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import {
  SharedControl,
  type SharedControlRecord,
} from '../../../platform/storage/shared-control.js';
import { assertTeamCustodyEligibility } from '../../../platform/database/team-custody-eligibility.js';
import { snapshotCustodyGraph } from '../../../platform/database/custody-graph.js';
import { SharedKernel, knownRollback } from './shared-kernel.service.js';
import { captureSharedReplay } from './shared-replay-state.js';
type Source = {
  snapshot: (
    tx: Prisma.TransactionClient,
    companyId: string,
    transferId: string,
  ) => Promise<Prisma.InputJsonValue>;
  move: (
    tx: Prisma.TransactionClient,
    companyId: string,
    transferId: string,
  ) => Promise<void>;
};
type Input = { companyId: string; parentScopeId: string };
type Manifest = {
  protocol: string;
  sourceOwnerUserId: string;
  companyOwnerUserId: string;
  graph: Prisma.JsonValue;
  source: Prisma.JsonValue;
};
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const tables = [
  'SharedCustody',
  'AccessScope',
  'SharedActor',
  'ContextAccess',
  'ContextCapabilityPolicy',
  'SharedAuditEvent',
  'SharedOutboxEvent',
  'SharedUsageEntry',
] as const;
const constraints =
  '"ContextAccess_spaceId_actorId_fkey","ContextAccess_spaceId_scopeId_fkey","ContextCapabilityPolicy_spaceId_publishedByActorId_fkey","ContextCapabilityPolicy_spaceId_scopeId_fkey","Team_spaceId_createdByActorId_fkey","Team_spaceId_scopeId_fkey","SharedAuditEvent_spaceId_actorId_fkey","SharedOutboxEvent_spaceId_actorId_fkey","SharedUsageEntry_spaceId_subjectActorId_fkey"';
@Injectable()
export class TeamCustodyTransfer {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SharedControl) private readonly control: SharedControl,
  ) {}
  private view(p: CompanyCustodyTransfer) {
    return {
      id: p.id,
      teamId: p.sourceTeamId!,
      companyId: p.companyId,
      parentScopeId: p.parentScopeId,
      state: p.state,
      revision: p.revision,
      manifestHash: p.manifestHash,
      expiresAt: p.expiresAt.toISOString(),
      appliedAt: p.appliedAt?.toISOString() ?? null,
    };
  }
  private audit(
    tx: Prisma.TransactionClient,
    actor: RequestActor,
    p: CompanyCustodyTransfer,
    action: string,
    evidence: Prisma.JsonObject = {},
  ) {
    return tx.adminAuditEvent.create({
      data: {
        actorAdminId: null,
        action,
        outcome: 'SUCCEEDED',
        targetUserId: actor.userId,
        targetSpaceId: p.companyId,
        requestId: actor.requestId,
        metadata: {
          teamId: p.sourceTeamId,
          transferId: p.id,
          manifestHash: p.manifestHash,
          acceptedByUserId: actor.userId,
          ...evidence,
        },
      },
    });
  }
  private async owners(
    tx: Prisma.TransactionClient,
    teamId: string,
    companyId: string,
  ) {
    const rows = await tx.sharedCustody.findMany({
      where: { spaceId: { in: [teamId, companyId] } },
      include: { ContextAccess: { include: { SharedActor: true } } },
    });
    const source = rows.find((r) => r.spaceId === teamId),
      company = rows.find((r) => r.spaceId === companyId);
    if (
      !source ||
      source.kind !== 'TEAM' ||
      source.spaceId === companyId ||
      (await tx.domainScopeCustody.findUnique({ where: { scopeId: teamId } }))
    )
      throw new ConflictException({
        code: 'TEAM_CUSTODY_REQUIRES_INDEPENDENT_TEAM',
      });
    if (!company || company.kind !== 'COMPANY') throw new NotFoundException();
    const owner = source.ContextAccess,
      destination = company.ContextAccess;
    if (
      !owner?.SharedActor.userId ||
      !destination?.SharedActor.userId ||
      owner.state !== 'ACTIVE' ||
      destination.state !== 'ACTIVE'
    )
      throw new ConflictException({ code: 'TEAM_CUSTODY_OWNER_UNAVAILABLE' });
    return {
      source,
      company,
      owner,
      destination,
      sourceUser: owner.SharedActor.userId,
      companyUser: destination.SharedActor.userId,
    };
  }
  private async hints(teamId: string, companyId: string) {
    return this.owners(this.db.client, teamId, companyId);
  }
  private async eligible(
    tx: Prisma.TransactionClient,
    actor: RequestActor,
    locked: string[],
    teamId: string,
    companyId: string,
    parentScopeId: string,
    dependencies = true,
  ) {
    const data = await this.owners(tx, teamId, companyId);
    await this.kernel.assertTeamParentAvailable(
      tx,
      companyId,
      parentScopeId,
      false,
      true,
    );
    for (const [spaceId, userId] of [
      [teamId, data.sourceUser],
      [companyId, data.companyUser],
    ])
      await this.kernel.participantAuthority(
        tx,
        actor,
        userId!,
        {
          spaceId: spaceId!,
          scopeId: spaceId!,
          capability: 'custody.handover',
        },
        locked,
      );
    for (const userId of new Set([data.sourceUser, data.companyUser]))
      await this.kernel.participantAuthority(
        tx,
        actor,
        userId,
        { spaceId: companyId, scopeId: parentScopeId, capability: 'task.read' },
        locked,
      );
    if (
      data.source.state !== 'ACTIVE' ||
      data.company.state !== 'ACTIVE' ||
      data.source.retentionPolicyVersion !== data.company.retentionPolicyVersion
    )
      throw new ConflictException({
        code: 'TEAM_CUSTODY_POLICY_OR_LIFECYCLE_CONFLICT',
      });
    await this.kernel.assertWorkspaceWritable(tx, teamId);
    await this.kernel.assertWorkspaceWritable(tx, companyId);
    await this.kernel.assertWorkspaceWritable(tx, parentScopeId);
    const parent = await tx.accessScope.findFirst({
      where: {
        id: parentScopeId,
        spaceId: companyId,
        kind: { in: ['DEPARTMENT', 'UNIT'] },
        state: 'ACTIVE',
      },
    });
    if (!parent)
      throw new ConflictException({ code: 'TEAM_CUSTODY_PARENT_UNAVAILABLE' });
    const actors = await tx.sharedActor.findMany({
        where: { spaceId: teamId },
      }),
      seats = await tx.contextAccess.findMany({ where: { spaceId: teamId } });
    // Other participant/history graphs need their own reviewed mapper; reject rather than discard.
    if (
      actors.length !== 1 ||
      actors[0]!.id !== data.owner.actorId ||
      actors[0]!.state !== 'ACTIVE' ||
      seats.length !== 1 ||
      seats[0]!.id !== data.owner.id ||
      data.owner.generation !== 1 ||
      data.source.closureGeneration !== 0
    )
      throw new ConflictException({
        code: 'TEAM_CUSTODY_PARTICIPANT_GRAPH_UNSUPPORTED',
      });
    for (const user of new Set([data.sourceUser, data.companyUser])) {
      const root = await this.kernel.companyRootAdmission(tx, companyId, user);
      const department = await tx.contextAccess.findFirst({
        where: {
          spaceId: companyId,
          scopeId: parentScopeId,
          actorId: root.actorId,
          state: 'ACTIVE',
          memberRole: { not: null },
        },
      });
      const binding =
        department &&
        (await tx.companyContextAdmission.findUnique({
          where: {
            accessId_generation: {
              accessId: department.id,
              generation: department.generation,
            },
          },
        }));
      if (
        !binding ||
        binding.rootAccessId !== root.id ||
        binding.rootGeneration !== root.generation
      )
        throw new ConflictException({
          code: 'TEAM_CUSTODY_PARENT_ADMISSION_REQUIRED',
        });
    }
    if (dependencies) await assertTeamCustodyEligibility(tx, teamId);
    return data;
  }
  private async graph(
    tx: Prisma.TransactionClient,
    teamId: string,
    companyId: string,
    transferId: string,
  ) {
    const parts = await snapshotCustodyGraph(
      tx,
      {
        sourceSpaceId: teamId,
        destinationSpaceId: companyId,
        transferId,
        verify: (database, moving) => {
          if (database !== tx || moving) throw new ForbiddenException();
        },
      },
      [
        ...tables.map((table) => ({ table, select: ['spaceId'], move: [] })),
        {
          table: 'ContextAccessInterval',
          select: [],
          move: [],
          via: {
            parent: 'ContextAccess',
            foreignKey: 'accessId',
            parentKey: 'id',
            parentSpace: 'spaceId',
          },
        },
      ],
    );
    return JSON.parse(JSON.stringify(parts)) as Prisma.InputJsonValue;
  }
  async preview(
    actor: RequestActor,
    teamId: string,
    input: Input,
    key: string | undefined,
    source: Source,
  ) {
    if (!key || !/^[!-~]{1,128}$/.test(key))
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    const prior = await this.db.client.companyCustodyTransfer.findFirst({
      where: { sourceTeamId: teamId, creationKey: hash(key) },
    });
    if (prior) {
      const m = prior.manifest as unknown as Manifest;
      if (m.sourceOwnerUserId !== actor.userId) throw new ForbiddenException();
      if (prior.fingerprint !== hash(input))
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
      return this.kernel.teamCustodyFence(
        actor,
        prior.state === 'APPLIED'
          ? [prior.companyId]
          : [teamId, prior.companyId],
        [m.sourceOwnerUserId, m.companyOwnerUserId],
        async (tx) => {
          if (prior.state === 'APPLIED') {
            const root = await this.kernel.companyRootAdmission(
              tx,
              prior.companyId,
              actor.userId,
            );
            const custody = await tx.domainScopeCustody.findUniqueOrThrow({
              where: { scopeId: teamId },
            });
            const owner = await tx.contextAccess.findUniqueOrThrow({
              where: { id: custody.primaryOwnerAccessId! },
            });
            if (owner.actorId !== root.actorId || owner.state !== 'ACTIVE')
              throw new ForbiddenException();
          } else if (
            (await this.owners(tx, teamId, prior.companyId)).sourceUser !==
            actor.userId
          )
            throw new ForbiddenException();
          return this.view(
            await tx.companyCustodyTransfer.findUniqueOrThrow({
              where: { id: prior.id },
            }),
          );
        },
      );
    }
    const hints = await this.hints(teamId, input.companyId);
    return this.kernel.teamCustodyFence(
      actor,
      [teamId, input.companyId],
      [hints.sourceUser, hints.companyUser],
      async (tx, locked) => {
        if (
          (await this.owners(tx, teamId, input.companyId)).sourceUser !==
          actor.userId
        )
          throw new ForbiddenException();
        const current = await this.eligible(
          tx,
          actor,
          locked,
          teamId,
          input.companyId,
          input.parentScopeId,
        );
        const retry = await tx.companyCustodyTransfer.findFirst({
          where: { sourceTeamId: teamId, creationKey: hash(key) },
        });
        if (retry) {
          if (retry.fingerprint !== hash(input))
            throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
          return this.view(retry);
        }
        if (
          await tx.companyCustodyTransfer.findFirst({
            where: {
              sourceCustodyId: teamId,
              state: { in: ['PREVIEWED', 'APPLYING'] },
              expiresAt: { gt: new Date() },
            },
          })
        )
          throw new ConflictException({
            code: 'TEAM_CUSTODY_TRANSFER_PENDING',
          });
        const id = randomUUID();
        const manifest = {
          protocol: 'P1_INDEPENDENT_TEAM_V1',
          sourceOwnerUserId: current.sourceUser,
          companyOwnerUserId: current.companyUser,
          graph: await this.graph(tx, teamId, input.companyId, id),
          source: await source.snapshot(tx, input.companyId, id),
        };
        const [m] = await tx.$queryRaw<
          { digest: string }[]
        >`SELECT encode(sha256(convert_to(${JSON.stringify(manifest)}::jsonb::text,'UTF8')),'hex') digest`;
        const now = new Date();
        const plan = await tx.companyCustodyTransfer.create({
          data: {
            id,
            sourceCustodyId: teamId,
            sourceTeamId: teamId,
            companyId: input.companyId,
            parentScopeId: input.parentScopeId,
            sourceOwnerAccessId: current.owner.id,
            sourceOwnerGeneration: current.owner.generation,
            companyOwnerAccessId: current.destination.id,
            companyOwnerGeneration: current.destination.generation,
            sourceVersion: current.source.authorizationVersion,
            companyVersion: current.company.authorizationVersion,
            retentionPolicyVersion: current.source.retentionPolicyVersion,
            companyRetentionPolicyVersion:
              current.company.retentionPolicyVersion,
            manifest,
            manifestHash: m!.digest,
            creationKey: hash(key),
            fingerprint: hash(input),
            state: 'PREVIEWED',
            revision: 1,
            createdAt: now,
            expiresAt: new Date(now.getTime() + 1800000),
          },
        });
        const audit = await this.audit(
          tx,
          actor,
          plan,
          'TEAM_COMPANY_CUSTODY_PREVIEWED',
        );
        await tx.adminDelivery.create({
          data: {
            auditId: audit.id,
            targetUserId: current.companyUser,
            kind: 'WORKSPACE_CHANGED',
            payload: { workspaceId: teamId, transferId: id },
          },
        });
        return this.view(plan);
      },
    );
  }
  private async plan(id: string, teamId: string) {
    const row = await this.db.client.companyCustodyTransfer.findUnique({
      where: { id },
    });
    if (
      !row ||
      row.sourceTeamId !== teamId ||
      (row.manifest as unknown as Manifest).protocol !==
        'P1_INDEPENDENT_TEAM_V1'
    )
      throw new NotFoundException();
    return row;
  }
  async consent(
    actor: RequestActor,
    teamId: string,
    id: string,
    input: {
      purpose: 'SOURCE_OWNER' | 'COMPANY_OWNER' | 'PARTICIPANT';
      manifestHash: string;
      password: string;
      revision: number;
    },
  ) {
    const hint = await this.plan(id, teamId),
      m = hint.manifest as unknown as Manifest;
    return this.kernel.teamCustodyFence(
      actor,
      [teamId, hint.companyId],
      [m.sourceOwnerUserId, m.companyOwnerUserId],
      async (tx, locked) => {
        const p = await tx.companyCustodyTransfer.findUniqueOrThrow({
          where: { id },
        });
        const data = await this.eligible(
          tx,
          actor,
          locked,
          teamId,
          p.companyId,
          p.parentScopeId,
          false,
        );
        if (
          p.state !== 'PREVIEWED' ||
          p.expiresAt <= new Date() ||
          p.manifestHash !== input.manifestHash ||
          p.revision !== input.revision ||
          data.source.authorizationVersion !== p.sourceVersion ||
          data.company.authorizationVersion !== p.companyVersion ||
          data.owner.id !== p.sourceOwnerAccessId ||
          data.owner.generation !== p.sourceOwnerGeneration ||
          data.destination.id !== p.companyOwnerAccessId ||
          data.destination.generation !== p.companyOwnerGeneration
        )
          throw new ConflictException({ code: 'TEAM_CUSTODY_PREVIEW_CHANGED' });
        const company = input.purpose === 'COMPANY_OWNER';
        if (actor.userId !== (company ? data.companyUser : data.sourceUser))
          throw new ForbiddenException();
        await this.auth.verifyPasswordInside(tx, actor.userId, input.password);
        const root = await this.kernel.companyRootAdmission(
            tx,
            p.companyId,
            actor.userId,
          ),
          admission = company ? data.destination : data.owner;
        const now = new Date();
        const row = await tx.companyCustodyConsent.findUnique({
          where: {
            transferId_sourceActorId_purpose: {
              transferId: id,
              sourceActorId: admission.actorId,
              purpose: input.purpose,
            },
          },
        });
        const values = {
          decision: 'ACCEPTED',
          decidedAt: now,
          reauthenticatedAt: now,
        };
        if (row)
          await tx.companyCustodyConsent.update({
            where: {
              transferId_sourceActorId_purpose: {
                transferId: id,
                sourceActorId: admission.actorId,
                purpose: input.purpose,
              },
            },
            data: { ...values, revision: { increment: 1 } },
          });
        else
          await tx.companyCustodyConsent.create({
            data: {
              transferId: id,
              sourceActorId: admission.actorId,
              purpose: input.purpose,
              sourceAccessId: admission.id,
              sourceGeneration: admission.generation,
              destinationRootAccessId: root.id,
              destinationRootGeneration: root.generation,
              destinationRole: company
                ? data.destination.memberRole
                : data.owner.memberRole,
              manifestHash: p.manifestHash,
              revision: 1,
              ...values,
            },
          });
        await this.audit(tx, actor, p, 'TEAM_COMPANY_CUSTODY_CONSENTED', {
          purpose: input.purpose,
          sourceAccessId: admission.id,
          sourceGeneration: admission.generation,
          destinationRootAccessId: root.id,
          destinationRootGeneration: root.generation,
        });
        return this.view(p);
      },
    );
  }
  async apply(
    actor: RequestActor,
    teamId: string,
    id: string,
    input: { manifestHash: string; password: string; revision: number },
    source: Source,
  ) {
    const hint = await this.plan(id, teamId),
      m = hint.manifest as unknown as Manifest,
      records: SharedControlRecord[] = [];
    let committed = false;
    const abort = async () => {
      for (const r of records)
        await this.control.append({
          ...r,
          outcome: 'ABORTED',
          at: new Date().toISOString(),
        });
      records.length = 0;
    };
    try {
      const result = await this.kernel.teamCustodyFence(
        actor,
        hint.state === 'APPLIED' ? [hint.companyId] : [teamId, hint.companyId],
        [m.sourceOwnerUserId, m.companyOwnerUserId],
        async (tx, locked) => {
          const p = await tx.companyCustodyTransfer.findUniqueOrThrow({
            where: { id },
          });
          if (actor.userId !== m.sourceOwnerUserId)
            throw new ForbiddenException();
          if (p.manifestHash !== input.manifestHash)
            throw new ConflictException({
              code: 'TEAM_CUSTODY_PREVIEW_CHANGED',
            });
          if (p.state === 'APPLIED') {
            const custody = await tx.domainScopeCustody.findUniqueOrThrow({
              where: { scopeId: teamId },
            });
            const root = await this.kernel.companyRootAdmission(
              tx,
              p.companyId,
              actor.userId,
            );
            const owner = await tx.contextAccess.findUniqueOrThrow({
              where: { id: custody.primaryOwnerAccessId! },
            });
            if (owner.actorId !== root.actorId || owner.state !== 'ACTIVE')
              throw new ForbiddenException();
            return this.view(p);
          }
          const data = await this.eligible(
            tx,
            actor,
            locked,
            teamId,
            p.companyId,
            p.parentScopeId,
          );
          if (
            p.state !== 'PREVIEWED' ||
            p.revision !== input.revision ||
            p.expiresAt <= new Date() ||
            data.source.authorizationVersion !== p.sourceVersion ||
            data.company.authorizationVersion !== p.companyVersion ||
            data.owner.id !== p.sourceOwnerAccessId ||
            data.destination.id !== p.companyOwnerAccessId ||
            hash(await this.graph(tx, teamId, p.companyId, id)) !==
              hash(m.graph) ||
            hash(await source.snapshot(tx, p.companyId, id)) !== hash(m.source)
          )
            throw new ConflictException({
              code: 'TEAM_CUSTODY_PREVIEW_CHANGED',
            });
          await this.auth.verifyPasswordInside(
            tx,
            actor.userId,
            input.password,
          );
          const consents = await tx.companyCustodyConsent.findMany({
            where: {
              transferId: id,
              decision: 'ACCEPTED',
              manifestHash: p.manifestHash,
              reauthenticatedAt: { gt: new Date(Date.now() - 300000) },
            },
          });
          if (
            !['SOURCE_OWNER', 'COMPANY_OWNER', 'PARTICIPANT'].every((purpose) =>
              consents.some((c) => c.purpose === purpose),
            )
          )
            throw new ConflictException({
              code: 'TEAM_CUSTODY_CONSENT_REQUIRED',
            });
          for (const [spaceId, version, action] of [
            [teamId, p.sourceVersion + 1n, 'company.custody.transfer.retire'],
            [
              p.companyId,
              p.companyVersion + 1n,
              'company.custody.transfer.apply',
            ],
          ] as const) {
            const r: SharedControlRecord = {
              id: randomUUID(),
              spaceId,
              version: String(version),
              action,
              resourceId: id,
              outcome: 'INTENT',
              at: new Date().toISOString(),
            };
            await this.control.append(r);
            records.push(r);
          }
          const now = new Date();
          await tx.companyCustodyTransfer.update({
            where: { id },
            data: {
              state: 'APPLYING',
              startedAt: now,
              retirementControlId: records[0]!.id,
              revision: { increment: 1 },
            },
          });
          await tx.$queryRaw`SELECT set_config('planner.team_transfer_id',${id},true)`;
          await tx.$executeRawUnsafe(
            'SET CONSTRAINTS ' + constraints + ' DEFERRED',
          );
          const root = await this.kernel.companyRootAdmission(
            tx,
            p.companyId,
            data.sourceUser,
          );
          await this.kernel.featureGrowth(
            tx,
            p.companyId,
            'company.context-membership',
          );
          await tx.contextAccessInterval.update({
            where: {
              accessId_generation: {
                accessId: data.owner.id,
                generation: data.owner.generation,
              },
            },
            data: { endedAt: now },
          });
          await tx.contextAccess.update({
            where: { id: data.owner.id },
            data: {
              spaceId: p.companyId,
              state: 'REVOKED',
              memberRole: null,
              endedAt: now,
              revision: { increment: 1 },
            },
          });
          await tx.sharedActor.update({
            where: { id: data.owner.actorId },
            data: {
              spaceId: p.companyId,
              userId: null,
              state: 'HISTORICAL',
              originCustodyId: teamId,
            },
          });
          await tx.accessScope.update({
            where: { id: teamId },
            data: {
              spaceId: p.companyId,
              kind: 'TEAM',
              authorizationVersion: { increment: 1 },
              restoreGeneration: { increment: 1 },
            },
          });
          await tx.contextCapabilityPolicy.updateMany({
            where: { spaceId: teamId },
            data: { spaceId: p.companyId },
          });
          await source.move(tx, p.companyId, id);
          for (const table of [
            'SharedAuditEvent',
            'SharedOutboxEvent',
            'SharedUsageEntry',
          ])
            await tx.$executeRawUnsafe(
              `UPDATE "${table}" SET "spaceId"=$2::uuid,"scopeId"=$1::uuid,"originCustodyId"=$1::uuid WHERE "spaceId"=$1::uuid`,
              teamId,
              p.companyId,
            );
          const accessId = randomUUID();
          await tx.contextAccess.create({
            data: {
              id: accessId,
              spaceId: p.companyId,
              scopeId: teamId,
              actorId: root.actorId,
              state: 'ACTIVE',
              memberRole: data.owner.memberRole,
              joinedAt: now,
            },
          });
          await tx.contextAccessInterval.create({
            data: { accessId, generation: 1, joinedAt: now },
          });
          await tx.companyContextAdmission.create({
            data: {
              spaceId: p.companyId,
              scopeId: teamId,
              accessId,
              generation: 1,
              actorId: root.actorId,
              rootScopeId: p.companyId,
              rootAccessId: root.id,
              rootGeneration: root.generation,
            },
          });
          await tx.domainScopeCustody.create({
            data: {
              scopeId: teamId,
              spaceId: p.companyId,
              parentScopeId: p.parentScopeId,
              kind: 'TEAM',
              teamId,
              originCustodyId: teamId,
              transferId: id,
              primaryOwnerAccessId: accessId,
              state: 'ACTIVE',
              revision: 1,
              authorizationVersion: p.sourceVersion + 1n,
              retentionPolicyVersion: p.retentionPolicyVersion,
              closureGeneration: 0,
              createdAt: data.source.createdAt,
            },
          });
          await tx.domainScopeActorAlias.create({
            data: {
              scopeId: teamId,
              spaceId: p.companyId,
              historicalActorId: data.owner.actorId,
              canonicalActorId: root.actorId,
              transferId: id,
            },
          });
          await tx.domainScopeAdmissionAlias.create({
            data: {
              scopeId: teamId,
              spaceId: p.companyId,
              historicalAccessId: data.owner.id,
              historicalGeneration: data.owner.generation,
              destinationAccessId: accessId,
              destinationGeneration: 1,
              transferId: id,
            },
          });
          await tx.sharedCustody.delete({ where: { spaceId: teamId } });
          await tx.space.delete({ where: { id: teamId } });
          const applied = await tx.companyCustodyTransfer.update({
            where: { id },
            data: {
              state: 'APPLIED',
              appliedAt: now,
              revision: { increment: 1 },
            },
          });
          const event = records[1]!;
          await this.kernel.offerEffect(
            tx,
            actor,
            p.companyId,
            root.actorId,
            event.action,
            id,
            event.id,
            {
              actorId: root.actorId,
              feature: 'company.context-membership',
              delta: 1,
            },
            { teamId, manifestHash: p.manifestHash },
          );
          const retiredAdmission = await tx.sharedAuditEvent.create({
            data: {
              id: randomUUID(),
              spaceId: p.companyId,
              scopeId: teamId,
              originCustodyId: teamId,
              actorId: root.actorId,
              action: 'company.custody.transfer.membership.retire',
              resourceId: data.owner.id,
              requestId: actor.requestId,
              details: { transferId: id, manifestHash: p.manifestHash },
            },
          });
          await tx.sharedUsageEntry.create({
            data: {
              id: randomUUID(),
              spaceId: p.companyId,
              scopeId: teamId,
              originCustodyId: teamId,
              subjectActorId: data.owner.actorId,
              auditId: retiredAdmission.id,
              feature: 'shared.membership',
              delta: -1,
            },
          });
          // The old root remains retired in signed evidence; an old backup may never resurrect it.
          await this.control.appendReplay(
            await captureSharedReplay(tx, { ...records[0]!, actorId: null }),
          );
          const audit = await tx.adminAuditEvent.create({
            data: {
              action: 'TEAM_COMPANY_CUSTODY_APPLIED',
              outcome: 'SUCCEEDED',
              actorAdminId: null,
              targetUserId: actor.userId,
              targetSpaceId: p.companyId,
              requestId: actor.requestId,
              metadata: {
                teamId,
                transferId: id,
                manifestHash: p.manifestHash,
                consentingUserIds: [data.sourceUser, data.companyUser],
              },
            },
          });
          for (const userId of new Set([data.sourceUser, data.companyUser]))
            await tx.adminDelivery.create({
              data: {
                auditId: audit.id,
                targetUserId: userId,
                kind: 'WORKSPACE_CHANGED',
                payload: { workspaceId: teamId },
              },
            });
          await tx.$executeRawUnsafe(
            'SET CONSTRAINTS ' + constraints + ' IMMEDIATE',
          );
          return this.view(applied);
        },
        abort,
        teamId,
      );
      committed = true;
      for (const r of records)
        await this.control.append({
          ...r,
          outcome: 'COMMITTED',
          at: new Date().toISOString(),
        });
      if (!records.length) {
        const applied =
          await this.db.client.companyCustodyTransfer.findUniqueOrThrow({
            where: { id },
          });
        const evidence = (await this.control.records()).filter(
          (r) => r.id === applied.retirementControlId,
        );
        const intent = evidence.find((r) => r.outcome === 'INTENT');
        if (
          !intent ||
          intent.spaceId !== teamId ||
          intent.resourceId !== id ||
          intent.version !== String(applied.sourceVersion + 1n) ||
          intent.action !== 'company.custody.transfer.retire' ||
          evidence.some((r) => r.outcome === 'ABORTED')
        )
          throw new ConflictException({
            code: 'TEAM_CUSTODY_RETIREMENT_EVIDENCE_REQUIRED',
          });
        if (!evidence.some((r) => r.outcome === 'COMMITTED'))
          await this.control.append({
            ...intent,
            outcome: 'COMMITTED',
            at: new Date().toISOString(),
          });
      }
      return result;
    } catch (error) {
      // Leave ambiguous infrastructure failures fail-closed for normal control reconciliation.
      if (!committed && knownRollback(error)) await abort();
      throw error;
    }
  }
}
