import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  randomUUID,
  randomBytes,
  createHash,
  timingSafeEqual,
} from 'node:crypto';
import type {
  Prisma,
  SharedLifecycleJob,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { AuthService } from '../../../platform/auth/auth.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { SharedCleanupScope } from '../../../platform/lifecycle/shared-cleanup.js';
import { sharedDeleteBatch } from '../../../platform/lifecycle/shared-cleanup.js';
import { SharedKernel } from './shared-kernel.service.js';
import { CollaborationService } from './collaboration.service.js';
import { SharedRetentionSchema } from './shared-retention.js';
export type LifecycleFile = { id: string; key: string; attempt: string | null };
export type LifecycleStep = {
  nextStage?: string;
  files?: LifecycleFile[];
  finalize?: boolean;
};
type LifecycleAdvance = {
  worked: true;
  transfer?: {
    files: LifecycleFile[];
    leaseId: string;
    jobId: string;
    spaceId: string;
  };
};
const progress = (r: SharedLifecycleJob) => ({
  ...(r.progress as Record<string, Prisma.InputJsonValue>),
});
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
@Injectable()
export class SharedLifecycleService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedKernel) private readonly kernel: SharedKernel,
    @Inject(CollaborationService)
    private readonly collaboration: CollaborationService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  private async current(tx: Prisma.TransactionClient, spaceId: string) {
    const c = await tx.sharedCustody.findUniqueOrThrow({ where: { spaceId } }),
      job = await tx.sharedLifecycleJob.findUnique({
        where: {
          custodyId_generation: {
            custodyId: spaceId,
            generation: c.closureGeneration,
          },
        },
      });
    if (!job || job.spaceId !== spaceId) throw new NotFoundException();
    return { c, job };
  }
  private recoverable(job: SharedLifecycleJob, now: Date, expected: number) {
    if (
      job.revision !== expected ||
      !['CLOSING_GRACE', 'OWNER_EXIT_FROZEN'].includes(job.state) ||
      job.recoveryDeadline <= now
    )
      throw new ConflictException({ code: 'RECOVERY_UNAVAILABLE' });
  }
  async status(actor: RequestActor, spaceId: string) {
    return this.kernel.lifecycleParticipant(actor, spaceId, [], async (tx) => {
      const { job } = await this.current(tx, spaceId),
        p = progress(job);
      return {
        jobId: job.id,
        generation: job.generation,
        revision: job.revision,
        state: job.state,
        recoveryDeadline: job.recoveryDeadline.toISOString(),
        nextAt: job.nextAt.toISOString(),
        stage: typeof p.stage === 'string' ? p.stage : null,
        failureCode: typeof p.failureCode === 'string' ? p.failureCode : null,
      };
    });
  }
  issueProof(
    actor: RequestActor,
    spaceId: string,
    expected: number,
    password: string,
  ) {
    return this.collaboration.signed(
      actor,
      spaceId,
      [],
      'lifecycle.recoveryproof',
      spaceId,
      async (tx, now, _locked, begin) => {
        const { job } = await this.current(tx, spaceId);
        this.recoverable(job, now, expected);
        await this.auth.verifyPasswordInside(tx, actor.userId, password);
        const proof = randomBytes(32).toString('base64url'),
          audit = await begin();
        now = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
        )[0]!.now;
        this.recoverable(job, now, expected);
        const row = await tx.sharedLifecycleJob.update({
          where: { id: job.id },
          data: { recoveryHash: hash(proof), revision: { increment: 1 } },
        });
        const seat = await tx.contextAccess.findUniqueOrThrow({
          where: {
            id: (
              await tx.sharedCustody.findUniqueOrThrow({ where: { spaceId } })
            ).primaryOwnerAccessId!,
          },
        });
        await this.kernel.offerEffect(
          tx,
          actor,
          spaceId,
          seat.actorId,
          'lifecycle.recoveryproof',
          spaceId,
          audit,
        );
        return {
          jobId: row.id,
          generation: row.generation,
          revision: row.revision,
          recoveryDeadline: row.recoveryDeadline.toISOString(),
          proof,
        };
      },
      true,
    );
  }
  recover(
    actor: RequestActor,
    spaceId: string,
    expected: number,
    generation: number,
    proof: string | undefined,
    password: string,
    sourceEffect: (tx: Prisma.TransactionClient, now: Date) => Promise<void>,
  ) {
    return this.collaboration.signed(
      actor,
      spaceId,
      [],
      'lifecycle.recover',
      spaceId,
      async (tx, now, _locked, begin) => {
        const { c, job } = await this.current(tx, spaceId);
        this.recoverable(job, now, expected);
        if (
          generation !== job.generation ||
          !proof ||
          !/^[A-Za-z0-9_-]{43}$/.test(proof) ||
          Buffer.from(proof, 'base64url').toString('base64url') !== proof ||
          !job.recoveryHash ||
          !timingSafeEqual(
            Buffer.from(job.recoveryHash, 'hex'),
            Buffer.from(hash(proof), 'hex'),
          )
        )
          throw new NotFoundException();
        await this.auth.verifyPasswordInside(tx, actor.userId, password);
        const seat = await tx.contextAccess.findUniqueOrThrow({
          where: { id: c.primaryOwnerAccessId! },
        });
        if (seat.state !== 'LEFT' || !seat.memberRole)
          throw new ConflictException();
        const audit = await begin();
        now = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
        )[0]!.now;
        this.recoverable(job, now, expected);
        await tx.contextAccess.update({
          where: { id: seat.id },
          data: {
            state: 'ACTIVE',
            generation: { increment: 1 },
            revision: { increment: 1 },
            joinedAt: now,
            endedAt: null,
          },
        });
        await tx.contextAccessInterval.create({
          data: {
            accessId: seat.id,
            generation: seat.generation + 1,
            joinedAt: now,
          },
        });
        await tx.resourceGrant.updateMany({
          where: { spaceId, revokedAt: null },
          data: { revokedAt: now, revision: { increment: 1 } },
        });
        await tx.sharedLifecycleJob.update({
          where: { id: job.id },
          data: {
            state: 'CANCELED',
            recoveryHash: null,
            leaseUntil: null,
            revision: { increment: 1 },
            progress: { stage: 'RECOVERED', recoveredAt: now.toISOString() },
          },
        });
        await tx.sharedCustody.update({
          where: { spaceId },
          data: { state: 'ACTIVE' },
        });
        await tx.accessScope.updateMany({
          where: { spaceId },
          data: { state: 'ACTIVE' },
        });
        await sourceEffect(tx, now);
        await this.kernel.offerEffect(
          tx,
          actor,
          spaceId,
          seat.actorId,
          'lifecycle.recover',
          spaceId,
          audit,
        );
        return {
          jobId: job.id,
          generation: job.generation,
          revision: job.revision + 1,
          state: 'CANCELED' as const,
        };
      },
      true,
    );
  }
  admissions(tx: Prisma.TransactionClient, s: SharedCleanupScope) {
    return sharedDeleteBatch(tx, s, ['ResourceGrantOffer', 'ResourceGrant']);
  }
  async core(tx: Prisma.TransactionClient, s: SharedCleanupScope) {
    s.verify(tx);
    await tx.sharedCustody.update({
      where: { spaceId: s.spaceId },
      data: { primaryOwnerAccessId: null },
    });
    if (
      !(await sharedDeleteBatch(tx, s, [
        'ContextInvitation',
        'OwnerHandover',
        'SharedMutationReceipt',
        'SharedUsageEntry',
        'SharedOutboxEvent',
        'SharedAuditEvent',
      ]))
    )
      return false;
    const policies =
      await tx.$executeRaw`DELETE FROM "ContextCapabilityPolicy" WHERE ctid IN (SELECT p.ctid FROM "ContextCapabilityPolicy" p JOIN "AccessScope" a ON a.id=p."scopeId" WHERE p."spaceId"=${s.spaceId}::uuid AND p.version<>a."currentPolicyVersion" LIMIT 200)`;
    if (policies) return false;
    const old =
      await tx.$executeRaw`DELETE FROM "ContextAccessInterval" WHERE ctid IN (SELECT i.ctid FROM "ContextAccessInterval" i JOIN "ContextAccess" a ON a.id=i."accessId" WHERE a."spaceId"=${s.spaceId}::uuid AND i.generation<>a.generation LIMIT 200)`;
    if (old) return false;
    if (!(await sharedDeleteBatch(tx, s, ['ContextAccess']))) return false;
    const actors =
      await tx.$executeRaw`DELETE FROM "SharedActor" WHERE id IN(SELECT a.id FROM "SharedActor" a WHERE a."spaceId"=${s.spaceId}::uuid AND NOT EXISTS(SELECT 1 FROM "ContextCapabilityPolicy" p WHERE p."spaceId"=a."spaceId" AND p."publishedByActorId"=a.id) ORDER BY a.id LIMIT 200)`;
    if (actors) return false;
    const jobs =
      await tx.$executeRaw`UPDATE "SharedLifecycleJob" SET "spaceId"=NULL,"recoveryHash"=NULL,progress='{}'::jsonb,"leaseUntil"=NULL WHERE id IN(SELECT id FROM "SharedLifecycleJob" WHERE "spaceId"=${s.spaceId}::uuid AND state='CANCELED' ORDER BY id LIMIT 200)`;
    return jobs === 0;
  }
  next() {
    return this.db.client.sharedLifecycleJob.findFirst({
      where: {
        spaceId: { not: null },
        state: { notIn: ['CANCELED', 'DELETED', 'FAILED'] },
        nextAt: { lte: new Date() },
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      },
      orderBy: [{ nextAt: 'asc' }, { id: 'asc' }],
    });
  }
  async advance(
    hint: SharedLifecycleJob,
    users: string[],
    handler: (
      tx: Prisma.TransactionClient,
      s: SharedCleanupScope,
      stage: string,
    ) => Promise<LifecycleStep>,
  ): Promise<LifecycleAdvance | null> {
    if (!hint.spaceId) return null;
    const spaceId = hint.spaceId;
    return this.collaboration.signed(
      null,
      spaceId,
      users,
      'lifecycle.advance',
      hint.id,
      async (tx, now, locked, begin) => {
        const { c, job } = await this.current(tx, spaceId);
        if (
          job.state !== c.state ||
          job.id !== hint.id ||
          job.revision !== hint.revision ||
          job.nextAt > now ||
          (job.leaseUntil && job.leaseUntil > now) ||
          ['CANCELED', 'DELETED', 'FAILED'].includes(job.state)
        )
          return null;
        const p = progress(job),
          policy = await tx.sharedRetentionPolicy.findUnique({
            where: { version: job.retentionPolicyVersion },
          }),
          parsed = SharedRetentionSchema.safeParse(policy?.configuration),
          operator = policy?.approvalReference ?? 'MISSING_POLICY';
        const audit = await begin();
        await this.kernel.lifecycleEffect(
          tx,
          spaceId,
          job.id,
          audit,
          'lifecycle.advance',
          operator,
        );
        const wait = async (state: string, code: string, nextAt: Date) => {
          await tx.sharedLifecycleJob.update({
            where: { id: job.id },
            data: {
              state,
              nextAt,
              recoveryHash: ['CLOSING_GRACE', 'OWNER_EXIT_FROZEN'].includes(
                state,
              )
                ? job.recoveryHash
                : null,
              leaseUntil: null,
              revision: { increment: 1 },
              progress: { ...p, failureCode: code },
            },
          });
          await tx.sharedCustody.update({
            where: { spaceId },
            data: { state },
          });
          return { worked: true as const };
        };
        if (job.state === 'OWNER_EXIT_FROZEN')
          return wait(
            'OWNER_EXIT_FROZEN',
            'CUSTODIAN_SUCCESSION_REQUIRED',
            new Date(now.getTime() + 86400000),
          );
        if (job.state === 'CLOSING_GRACE')
          return job.recoveryDeadline > now
            ? wait('CLOSING_GRACE', 'RECOVERY_WINDOW', job.recoveryDeadline)
            : wait('CLEANUP_PENDING', 'RECOVERY_ENDED', now);
        if (
          c.kind !== 'PROJECT' ||
          (await this.kernel.lifecycleMembers(tx, spaceId)) > 0
        )
          return wait(
            'WAITING_OBLIGATIONS',
            'MEMBERSHIP_RECHECK',
            new Date(now.getTime() + 3600000),
          );
        if (!parsed.success)
          return wait(
            'BLOCKED_POLICY',
            'RETENTION_POLICY_REQUIRED',
            new Date(now.getTime() + 3600000),
          );
        const configuration = parsed.data;
        if (
          Object.values(configuration.classRules).some(
            (r) => r.disposalAction !== 'PURGE',
          )
        )
          return wait(
            'BLOCKED_POLICY',
            'DISPOSITION_REQUIRES_REVIEW',
            new Date(now.getTime() + 3600000),
          );
        const releases: Record<string, unknown> =
            typeof p.releases === 'object' &&
            p.releases !== null &&
            !Array.isArray(p.releases)
              ? (p.releases as Record<string, unknown>)
              : {},
          pending = [
            ...configuration.holds.filter((r) => r.state === 'ACTIVE'),
            ...configuration.obligations.filter(
              (r) => r.state === 'OUTSTANDING',
            ),
          ].filter(
            (r) =>
              typeof releases[r.id] !== 'string' ||
              !String(releases[r.id]).trim(),
          );
        if (pending.length)
          return wait(
            'WAITING_OBLIGATIONS',
            'RETENTION_OBLIGATION',
            new Date(
              Math.max(
                now.getTime() + 3600000,
                Math.min(...pending.map((r) => Date.parse(r.nextReviewAt))),
              ),
            ),
          );
        const retain = Math.max(
            ...Object.values(configuration.classRules).map(
              (r) => r.retainAfterClosureSeconds,
            ),
          ),
          deadline = Math.max(
            job.recoveryDeadline.getTime(),
            job.effectiveDepartureAt.getTime() + retain * 1000,
          );
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
        await tx.sharedCustody.update({
          where: { spaceId },
          data: { state: 'PURGING' },
        });
        let result: LifecycleStep;
        try {
          result = await this.kernel.withPurge(
            tx,
            spaceId,
            job.id,
            leaseId,
            locked,
            (s) => handler(tx, s, stage),
          );
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            ['P2003', 'P2010'].includes(String(error.code))
          )
            throw new ConflictException({
              code: 'UNEXPECTED_CLEANUP_REFERENCE',
            });
          throw error;
        }
        if (result.finalize) {
          await tx.sharedLifecycleJob.updateMany({
            where: { spaceId },
            data: {
              recoveryHash: null,
              progress: { stage: 'CANCELED' },
              leaseUntil: null,
            },
          });
          await tx.sharedLifecycleJob.update({
            where: { id: job.id },
            data: {
              state: 'DELETED',
              revision: { increment: 1 },
              progress: { stage: 'DELETED', completedAt: now.toISOString() },
              nextAt: now,
            },
          });
          await tx.sharedCustody.update({
            where: { spaceId },
            data: { state: 'DELETED' },
          });
          await tx.sharedCustody.delete({ where: { spaceId } });
          await tx.space.delete({ where: { id: spaceId } });
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
              ...p,
              stage: result.nextStage ?? stage,
              ...(files.length ? { leaseId, pendingFiles: files } : {}),
              failureCode: null,
            },
          },
        });
        return {
          worked: true as const,
          ...(files.length
            ? { transfer: { files, leaseId, jobId: job.id, spaceId } }
            : {}),
        };
      },
    );
  }
  ack(
    jobId: string,
    spaceId: string,
    leaseId: string,
    files: LifecycleFile[],
    work: (
      tx: Prisma.TransactionClient,
      s: SharedCleanupScope,
      files: LifecycleFile[],
    ) => Promise<void>,
  ) {
    return this.collaboration.signed(
      null,
      spaceId,
      [],
      'lifecycle.files',
      jobId,
      async (tx, now, locked, begin) => {
        const { job } = await this.current(tx, spaceId),
          p = progress(job);
        const pending = p.pendingFiles;
        if (
          job.id !== jobId ||
          p.leaseId !== leaseId ||
          !Array.isArray(pending) ||
          JSON.stringify(
            pending.map((f) =>
              f && typeof f === 'object' && !Array.isArray(f)
                ? [f.id, f.key, f.attempt]
                : null,
            ),
          ) !== JSON.stringify(files.map((f) => [f.id, f.key, f.attempt]))
        )
          throw new ConflictException();
        const audit = await begin();
        await this.kernel.withPurge(tx, spaceId, jobId, leaseId, locked, (s) =>
          work(tx, s, files),
        );
        delete p.pendingFiles;
        delete p.leaseId;
        await tx.sharedLifecycleJob.update({
          where: { id: jobId },
          data: {
            progress: p,
            leaseUntil: null,
            nextAt: now,
            revision: { increment: 1 },
          },
        });
        const policy = await tx.sharedRetentionPolicy.findUniqueOrThrow({
          where: { version: job.retentionPolicyVersion },
        });
        await this.kernel.lifecycleEffect(
          tx,
          spaceId,
          job.id,
          audit,
          'lifecycle.files',
          policy.approvalReference,
        );
      },
    );
  }
  failure(hint: SharedLifecycleJob, leaseId?: string) {
    if (!hint.spaceId) return Promise.resolve();
    const spaceId = hint.spaceId;
    return this.collaboration.signed(
      null,
      spaceId,
      [],
      'lifecycle.failure',
      hint.id,
      async (tx, now, _locked, begin) => {
        const { job } = await this.current(tx, spaceId);
        if (
          job.id !== hint.id ||
          ['DELETED', 'CANCELED', 'FAILED'].includes(job.state) ||
          (leaseId
            ? progress(job).leaseId !== leaseId
            : job.revision !== hint.revision)
        )
          return;
        const attempts = Math.min(5, job.attempts + 1),
          audit = await begin(),
          state = attempts === 5 ? 'FAILED' : job.state;
        await tx.sharedLifecycleJob.update({
          where: { id: job.id },
          data: {
            attempts,
            state,
            leaseUntil: null,
            nextAt: new Date(now.getTime() + 60000 * 2 ** attempts),
            revision: { increment: 1 },
            progress: {
              ...progress(job),
              failureCode: 'CLEANUP_RETRY_REQUIRED',
            },
          },
        });
        await tx.sharedCustody.update({ where: { spaceId }, data: { state } });
        const policy = await tx.sharedRetentionPolicy.findUniqueOrThrow({
          where: { version: job.retentionPolicyVersion },
        });
        await this.kernel.lifecycleEffect(
          tx,
          spaceId,
          job.id,
          audit,
          'lifecycle.failure',
          policy.approvalReference,
        );
      },
    );
  }
  release(
    spaceId: string,
    jobId: string,
    expected: number,
    id: string,
    evidence: string,
  ) {
    if (!evidence.trim() || evidence.length > 200)
      throw new ConflictException();
    return this.collaboration.signed(
      null,
      spaceId,
      [],
      'lifecycle.release',
      jobId,
      async (tx, now, _locked, begin) => {
        const { job } = await this.current(tx, spaceId);
        if (
          job.id !== jobId ||
          job.revision !== expected ||
          ['DELETED', 'CANCELED', 'FAILED', 'PURGING'].includes(job.state)
        )
          throw new ConflictException();
        const policy = await tx.sharedRetentionPolicy.findUniqueOrThrow({
            where: { version: job.retentionPolicyVersion },
          }),
          configuration = SharedRetentionSchema.parse(policy.configuration);
        if (
          ![...configuration.holds, ...configuration.obligations].some(
            (r) => r.id === id,
          )
        )
          throw new NotFoundException();
        const p = progress(job),
          old = p.releases,
          previous =
            typeof old === 'object' && old !== null && !Array.isArray(old)
              ? old
              : {};
        const audit = await begin();
        await tx.sharedLifecycleJob.update({
          where: { id: jobId },
          data: {
            progress: { ...p, releases: { ...previous, [id]: evidence } },
            revision: { increment: 1 },
            nextAt: now,
          },
        });
        await this.kernel.lifecycleEffect(
          tx,
          spaceId,
          jobId,
          audit,
          'lifecycle.release',
          policy.approvalReference,
        );
      },
    );
  }
}
