import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  Prisma,
  SharedLifecycleJob,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type {
  SharedCleanupScope,
  SharedCleanupStep as LifecycleStep,
} from '../../../platform/lifecycle/shared-cleanup.js';
import { sharedDeleteBatch } from '../../../platform/lifecycle/shared-cleanup.js';
import { SharedKernel } from './shared-kernel.service.js';
import { CollaborationService } from './collaboration.service.js';
import { SharedRetentionSchema } from './shared-retention.js';
const progress = (j: SharedLifecycleJob) =>
  j.progress as Record<string, Prisma.InputJsonValue>;
@Injectable()
export class TeamDomainLifecycle {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(CollaborationService) private readonly signed: CollaborationService,
  ) {}
  async next() {
    const [job] = await this.db.client.$queryRaw<
      SharedLifecycleJob[]
    >`SELECT j.* FROM "SharedLifecycleJob" j JOIN "DomainScopeCustody" d ON d."scopeId"=j."scopeId" AND d."spaceId"=j."spaceId" WHERE d.kind='TEAM' AND j."custodyId"=d."scopeId" AND j.generation=d."closureGeneration" AND j.state NOT IN ('CANCELED','DELETED','FAILED') AND j."nextAt"<=p1_team_lifecycle_now() AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=p1_team_lifecycle_now()) ORDER BY j."nextAt",j.id LIMIT 1`;
    return job ?? null;
  }
  async advance(
    hint: SharedLifecycleJob,
    users: string[],
    handler: (
      tx: Prisma.TransactionClient,
      s: SharedCleanupScope,
      stage: string,
    ) => Promise<LifecycleStep>,
    contentGuard?: (
      tx: Prisma.TransactionClient,
      spaceId: string,
    ) => Promise<string | null>,
  ) {
    if (!hint.spaceId || !hint.scopeId) return null;
    const selector = hint.scopeId;
    const members = await this.db.client.contextAccess.findMany({
      where: { spaceId: hint.spaceId, scopeId: selector },
      select: { SharedActor: { select: { userId: true } } },
    });
    const rootHint = await this.db.client.sharedCustody.findUniqueOrThrow({
      where: { spaceId: hint.spaceId },
      select: { primaryOwnerAccessId: true },
    });
    const rootOwner = rootHint.primaryOwnerAccessId
      ? await this.db.client.contextAccess.findUnique({
          where: { id: rootHint.primaryOwnerAccessId },
          select: { SharedActor: { select: { userId: true } } },
        })
      : null;
    const lockUsers = [
      ...new Set([
        ...users,
        ...members.flatMap((m) =>
          m.SharedActor.userId ? [m.SharedActor.userId] : [],
        ),
        ...(rootOwner?.SharedActor.userId
          ? [rootOwner.SharedActor.userId]
          : []),
      ]),
    ].sort();
    return this.signed.signed(
      null,
      selector,
      lockUsers,
      'lifecycle.advance',
      hint.id,
      async (tx, _now, locked, begin) => {
        const now = (
          await tx.$queryRaw<
            { now: Date }[]
          >`SELECT p1_team_lifecycle_now() now`
        )[0]!.now;
        const c = await tx.domainScopeCustody.findUniqueOrThrow({
            where: { scopeId: selector },
          }),
          job = await tx.sharedLifecycleJob.findUniqueOrThrow({
            where: { id: hint.id },
          });
        if (
          c.kind !== 'TEAM' ||
          c.scopeId === c.spaceId ||
          c.spaceId !== hint.spaceId ||
          job.scopeId !== selector ||
          job.custodyId !== selector
        )
          throw new NotFoundException();
        if (
          job.state !== c.state ||
          job.revision !== hint.revision ||
          job.nextAt > now ||
          (job.leaseUntil && job.leaseUntil > now) ||
          ['CANCELED', 'DELETED', 'FAILED'].includes(job.state)
        )
          return null;
        const p = progress(job),
          source = await tx.sharedRetentionPolicy.findUnique({
            where: { version: job.retentionPolicyVersion },
          }),
          root = await tx.sharedCustody.findUniqueOrThrow({
            where: { spaceId: c.spaceId },
          });
        if (root.primaryOwnerAccessId !== rootHint.primaryOwnerAccessId)
          throw new ConflictException({ code: 'CLEANUP_AUTHORITY_CHANGED' });
        // Administrative read-only state and parent restrictions pause maintenance
        // without consuming attempts or changing the captured closure/deadline.
        try {
          await this.kernel.assertWorkspaceWritable(tx, selector);
        } catch (error) {
          if (
            error instanceof HttpException &&
            [403, 404].includes(error.getStatus())
          )
            return null;
          throw error;
        }
        const audit = await begin();
        await this.kernel.lifecycleEffect(
          tx,
          selector,
          job.id,
          audit,
          'lifecycle.advance',
          source?.approvalReference ?? 'MISSING_POLICY',
        );
        const wait = async (state: string, code: string, nextAt: Date) => {
          await tx.sharedLifecycleJob.update({
            where: { id: job.id },
            data: {
              state,
              nextAt,
              leaseUntil: null,
              revision: { increment: 1 },
              progress: { ...p, failureCode: code },
            },
          });
          await this.kernel.updateLifecycleCustody(tx, selector, { state });
          return { worked: true as const };
        };
        if (job.state === 'OWNER_EXIT_FROZEN')
          return wait(
            job.state,
            'CUSTODIAN_SUCCESSION_REQUIRED',
            new Date(now.getTime() + 86400000),
          );
        if (job.state === 'CLOSING_GRACE')
          return job.recoveryDeadline > now
            ? wait(job.state, 'RECOVERY_WINDOW', job.recoveryDeadline)
            : wait('CLEANUP_PENDING', 'RECOVERY_ENDED', now);
        if (!['ACTIVE', 'ARCHIVED'].includes(root.state))
          return wait(
            'WAITING_OBLIGATIONS',
            'COMPANY_CUSTODY_RECHECK',
            new Date(now.getTime() + 3600000),
          );
        if (await this.kernel.lifecycleMembers(tx, selector))
          return wait(
            'WAITING_OBLIGATIONS',
            'MEMBERSHIP_RECHECK',
            new Date(now.getTime() + 3600000),
          );
        const plan = c.transferId
          ? await tx.companyCustodyTransfer.findUnique({
              where: { id: c.transferId },
            })
          : null;
        const witness = p.custodyWitness as Prisma.JsonObject | undefined;
        const companyPolicy =
          plan?.companyRetentionPolicyVersion ??
          witness?.companyRetentionPolicyVersion;
        if (!companyPolicy || typeof companyPolicy !== 'string')
          return wait(
            'BLOCKED_POLICY',
            'CUSTODY_POLICY_EVIDENCE_REQUIRED',
            new Date(now.getTime() + 3600000),
          );
        const versions = [
          ...new Set([
            job.retentionPolicyVersion,
            companyPolicy,
            root.retentionPolicyVersion,
          ]),
        ];
        const policies = await tx.sharedRetentionPolicy.findMany({
          where: { version: { in: versions } },
        });
        if (policies.length !== versions.length)
          return wait(
            'BLOCKED_POLICY',
            'RETENTION_POLICY_REQUIRED',
            new Date(now.getTime() + 3600000),
          );
        let deadline = job.recoveryDeadline.getTime();
        for (const policy of policies) {
          const parsed = SharedRetentionSchema.safeParse(policy.configuration);
          if (
            !parsed.success ||
            parsed.data.policyVersion !== policy.version ||
            parsed.data.approvalReference !== policy.approvalReference ||
            Object.values(parsed.data.classRules).some(
              (r) => r.disposalAction !== 'PURGE',
            )
          )
            return wait(
              'BLOCKED_POLICY',
              'RETENTION_POLICY_REQUIRED',
              new Date(now.getTime() + 3600000),
            );
          const releases = (p.releases ?? {}) as Record<string, unknown>;
          const pending = [
            ...parsed.data.holds.filter((r) => r.state === 'ACTIVE'),
            ...parsed.data.obligations.filter((r) => r.state === 'OUTSTANDING'),
          ].filter(
            (r) =>
              !(
                typeof releases[policy.version + ':' + r.id] === 'string' ||
                (policy.version === job.retentionPolicyVersion &&
                  typeof releases[r.id] === 'string')
              ),
          );
          if (pending.length)
            return wait(
              'WAITING_OBLIGATIONS',
              'RETENTION_OBLIGATION',
              new Date(now.getTime() + 3600000),
            );
          deadline = Math.max(
            deadline,
            job.effectiveDepartureAt.getTime() +
              Math.max(
                ...Object.values(parsed.data.classRules).map(
                  (r) => r.retainAfterClosureSeconds,
                ),
              ) *
                1000,
          );
        }
        if (!Number.isSafeInteger(deadline) || deadline > 8640000000000000)
          return wait(
            'BLOCKED_POLICY',
            'RETENTION_RANGE',
            new Date(now.getTime() + 3600000),
          );
        if (deadline > now.getTime())
          return wait(
            'WAITING_OBLIGATIONS',
            'RETENTION_WINDOW',
            new Date(deadline),
          );
        const blocker = await contentGuard?.(tx, c.spaceId);
        if (blocker)
          return wait(
            'BLOCKED_POLICY',
            blocker,
            new Date(now.getTime() + 3600000),
          );
        const leaseId = randomUUID(),
          leaseUntil = new Date(now.getTime() + 120000),
          stage = typeof p.stage === 'string' ? p.stage : 'FILES';
        await tx.sharedLifecycleJob.update({
          where: { id: job.id },
          data: {
            state: 'PURGING',
            leaseUntil,
            recoveryHash: null,
            revision: { increment: 1 },
            progress: { ...p, stage, leaseId, failureCode: null },
          },
        });
        await this.kernel.updateLifecycleCustody(tx, selector, {
          state: 'PURGING',
        });
        let result: LifecycleStep;
        try {
          result = await this.kernel.withPurge(
            tx,
            selector,
            job.id,
            leaseId,
            locked,
            (s) => handler(tx, s, stage),
          );
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error)
            throw new ConflictException({
              code: 'UNEXPECTED_SCOPED_CLEANUP_REFERENCE',
            });
          throw error;
        }
        const latest = await tx.sharedLifecycleJob.findUniqueOrThrow({
            where: { id: job.id },
          }),
          after = progress(latest);
        if (result.finalize) {
          await tx.sharedLifecycleJob.update({
            where: { id: job.id },
            data: {
              state: 'DELETED',
              spaceId: null,
              leaseUntil: null,
              recoveryHash: null,
              revision: { increment: 1 },
              nextAt: now,
              progress: {
                ...after,
                stage: 'DELETED',
                completedAt: now.toISOString(),
              },
            },
          });
          return { worked: true as const };
        }
        const files = result.files ?? [];
        await tx.sharedLifecycleJob.update({
          where: { id: job.id },
          data: {
            leaseUntil: files.length ? leaseUntil : null,
            nextAt: now,
            attempts: 0,
            progress: {
              ...after,
              stage: result.nextStage ?? stage,
              ...(files.length ? { leaseId, pendingFiles: files } : {}),
              failureCode: null,
            },
          },
        });
        return {
          worked: true as const,
          ...(files.length
            ? { transfer: { files, leaseId, jobId: job.id, spaceId: selector } }
            : {}),
        };
      },
      true,
      'TEAM',
    );
  }
  /** Scoped history is drained in bounded passes; the last row cycle commits atomically. */
  async core(
    tx: Prisma.TransactionClient,
    s: SharedCleanupScope,
    removeSource: () => Promise<void>,
  ) {
    s.verify(tx);
    if (!s.scopeId) throw new ConflictException();
    let d = await tx.domainScopeCustody.findUniqueOrThrow({
      where: { scopeId: s.scopeId },
    });
    const job = await tx.sharedLifecycleJob.findUniqueOrThrow({
      where: { id: s.jobId },
    });
    if (d.transferId) {
      const [row] = await tx.$queryRaw<
        { witness: Prisma.JsonObject }[]
      >`SELECT company_custody_witness(t) witness FROM "CompanyCustodyTransfer" t WHERE t.id=${d.transferId}::uuid`;
      if (!row) throw new ConflictException();
      await tx.sharedLifecycleJob.update({
        where: { id: job.id },
        data: {
          progress: {
            ...progress(job),
            custodyWitness: row.witness,
            p1DisposalProtocol: 'P1_INDEPENDENT_TEAM_V1',
          },
        },
      });
      for (const table of [
        'DomainScopeAdmissionAlias',
        'DomainScopeActorAlias',
        'CompanyCustodyConsent',
      ]) {
        const count = await tx.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE ctid IN(SELECT ctid FROM "${table}" WHERE "transferId"=$1::uuid LIMIT 200)`,
          d.transferId,
        );
        if (count) return false;
      }
      const transferId = d.transferId;
      d = await tx.domainScopeCustody.update({
        where: { scopeId: s.scopeId },
        data: {
          primaryOwnerAccessId: null,
          transferId: null,
          revision: { increment: 1 },
        },
      });
      await tx.companyCustodyTransfer.delete({ where: { id: transferId } });
    }
    if (
      !(await sharedDeleteBatch(tx, s, [
        'CompanyContextAdmission',
        'ContextInvitation',
        'OwnerHandover',
        'SharedMutationReceipt',
        'SharedUsageEntry',
        'SharedOutboxEvent',
        'SharedAuditEvent',
      ]))
    )
      return false;
    const oldPolicies =
      await tx.$executeRaw`DELETE FROM "ContextCapabilityPolicy" WHERE ctid IN(SELECT p.ctid FROM "ContextCapabilityPolicy" p JOIN "AccessScope" a ON a.id=p."scopeId" WHERE p."spaceId"=${s.spaceId}::uuid AND p."scopeId"=${s.scopeId}::uuid AND p.version<>a."currentPolicyVersion" LIMIT 200)`;
    if (oldPolicies) return false;
    const oldIntervals =
      await tx.$executeRaw`DELETE FROM "ContextAccessInterval" WHERE ctid IN(SELECT i.ctid FROM "ContextAccessInterval" i JOIN "ContextAccess" a ON a.id=i."accessId" WHERE a."spaceId"=${s.spaceId}::uuid AND a."scopeId"=${s.scopeId}::uuid AND i.generation<>a.generation LIMIT 200)`;
    if (oldIntervals) return false;
    const seats = await tx.contextAccess.findMany({
      where: { spaceId: s.spaceId, scopeId: s.scopeId },
      orderBy: { id: 'asc' },
      take: 200,
      select: { id: true },
    });
    if (seats.length) {
      for (const seat of seats) {
        await tx.contextAccessInterval.deleteMany({
          where: { accessId: seat.id },
        });
        await tx.contextAccess.delete({ where: { id: seat.id } });
      }
      return false;
    }
    await tx.contextCapabilityPolicy.deleteMany({
      where: { spaceId: s.spaceId, scopeId: s.scopeId },
    });
    await tx.domainScopeCustody.delete({ where: { scopeId: s.scopeId } });
    await removeSource();
    await tx.accessScope.delete({ where: { id: s.scopeId } });
    await tx.sharedActor.deleteMany({
      where: {
        spaceId: s.spaceId,
        originCustodyId: s.scopeId,
        state: 'HISTORICAL',
      },
    });
    await tx.sharedLifecycleJob.updateMany({
      where: { custodyId: s.scopeId, spaceId: s.spaceId, state: 'CANCELED' },
      data: { spaceId: null, leaseUntil: null, recoveryHash: null },
    });
    return true;
  }
}
