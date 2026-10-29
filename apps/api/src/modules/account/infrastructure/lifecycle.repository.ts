import {
  Inject,
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { Readable } from 'node:stream';
import type { IncomingHttpHeaders } from 'node:http';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client.js';
import type {
  AccountDeletionJob,
  UserExportJob,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import { APP_CONFIG } from '../../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../../bootstrap/environment.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { PrivacyGate } from '../../../platform/authorization/privacy-gate.js';
import { AuthService } from '../../../platform/auth/auth.service.js';
import { idempotent } from '../../../platform/database/idempotency.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { appendOutbox } from '../../../platform/outbox/outbox.js';
import { ExportBudget } from '../../../platform/lifecycle/personal-data.js';
import type { PersonalData } from '../../../platform/lifecycle/personal-data.js';
import { PlatformPersonalData } from '../../../platform/lifecycle/platform-data.js';
import { STORAGE_PORT } from '../../../platform/storage/storage.port.js';
import type { StoragePort } from '../../../platform/storage/storage.port.js';
import {
  FilePortability,
  ErasureControl,
} from '../../../platform/storage/public/index.js';
import type {
  AttachmentManifest,
  ErasureRecord,
} from '../../../platform/storage/public/index.js';
import { SpacesService } from '../../spaces/public/index.js';
import { TasksData } from '../../tasks/public/index.js';
import { PlanningData } from '../../planning/public/index.js';
import { CalendarData } from '../../calendar/public/index.js';
import { HabitsData } from '../../habits/public/index.js';
import { GoalsData } from '../../goals/public/index.js';
import { FocusData } from '../../focus/public/index.js';
import { NotesData } from '../../notes/public/index.js';
import { JournalData } from '../../journal/public/index.js';
import { CaptureData } from '../../capture/public/index.js';
import { FinanceData } from '../../finance/public/index.js';
import { NotificationsData } from '../../notifications/public/index.js';
import { RewardsData } from '../../rewards/public/index.js';
import { PersonalLifecycle } from '../public/lifecycle.js';
const day = 86400000;
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
// Durable pairs retain BOTH publication and staging identities after lease takeover.
const retiredArtifacts = (values: string[]) => {
  if (values.length % 2 !== 0)
    throw new Error('Invalid export cleanup progress');
  return Array.from({ length: values.length / 2 }, (_, i) => ({
    key: values[i * 2]!,
    attempt: values[i * 2 + 1]!,
  }));
};
const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
@Injectable()
export class LifecycleRepository
  extends PersonalLifecycle
  implements OnApplicationBootstrap
{
  private readonly owners: PersonalData[];
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SpacesService) private readonly spaces: SpacesService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(FilePortability) private readonly files: FilePortability,
    @Inject(ErasureControl) private readonly control: ErasureControl,
    @Inject(PrivacyGate) private readonly gate: PrivacyGate,
    @Inject(PlatformPersonalData)
    private readonly platform: PlatformPersonalData,
    @Inject(TasksData) tasks: TasksData,
    @Inject(PlanningData) planning: PlanningData,
    @Inject(CalendarData) calendar: CalendarData,
    @Inject(HabitsData) habits: HabitsData,
    @Inject(GoalsData) goals: GoalsData,
    @Inject(FocusData) focus: FocusData,
    @Inject(NotesData) notes: NotesData,
    @Inject(JournalData) journal: JournalData,
    @Inject(CaptureData) capture: CaptureData,
    @Inject(FinanceData) finance: FinanceData,
    @Inject(NotificationsData) notifications: NotificationsData,
    @Inject(RewardsData) rewards: RewardsData,
  ) {
    super();
    this.owners = [
      capture,
      notifications,
      planning,
      calendar,
      notes,
      journal,
      goals,
      focus,
      finance,
      habits,
      rewards,
      tasks,
    ];
  }
  async onApplicationBootstrap() {
    await this.verifyControl();
  }
  private capability(id: string, kind: string) {
    return createHmac('sha256', this.config.BETTER_AUTH_SECRET)
      .update('account-lifecycle-capability-v1:' + kind + ':' + id)
      .digest('base64url');
  }
  private proof(job: UserExportJob) {
    const expires = Math.min(Date.now() + 600000, job.expiresAt!.getTime()),
      body = Buffer.from(
        JSON.stringify({ job: job.id, owner: job.ownerUserId, expires }),
      ).toString('base64url');
    return body + '.' + this.capability(body, 'export');
  }
  private exportView(job: UserExportJob) {
    return c.ExportJobSchema.parse({
      id: job.id,
      revision: job.revision,
      state: job.state,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
      expiresAt: job.expiresAt?.toISOString() ?? null,
      failureCode: job.failureCode,
      size: job.artifactSize,
      sha256: job.artifactHash,
      downloadProof:
        job.state === 'READY' && job.expiresAt! > new Date()
          ? this.proof(job)
          : null,
    });
  }
  private deletionView(job: AccountDeletionJob) {
    return c.DeletionJobSchema.parse({
      id: job.id,
      revision: job.revision,
      state: job.state,
      createdAt: job.createdAt.toISOString(),
      eraseAfter: job.eraseAfter?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      failureCode: job.failureCode,
      backupExpiryDeadline:
        job.state === 'ERASED' && job.completedAt
          ? new Date(job.completedAt.getTime() + 30 * day).toISOString()
          : null,
    });
  }
  private policy(version: string, ack: boolean) {
    if (
      !ack ||
      !this.config.PERSONAL_ERASURE_POLICY_VERSION ||
      this.config.PERSONAL_ERASURE_POLICY_VERSION !== version
    )
      throw new ConflictException({ code: 'ERASURE_POLICY_UNAVAILABLE' });
  }
  private async job(scope: AuthorizedSpace, id: string) {
    const row = await this.db.client.userExportJob.findFirst({
      where: { id, spaceId: scope.spaceId, ownerUserId: scope.actor.userId },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async requestExport(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: z.infer<typeof c.ExportRequestSchema>,
  ) {
    if (!key) throw new BadRequestException();
    await this.auth.verifyPassword(scope.actor.userId, input.password);
    const receipt = await idempotent(
      this.db.client,
      scope,
      'account.export',
      key,
      {},
      async (tx) => {
        if (
          await tx.userExportJob.findFirst({
            where: {
              ownerUserId: scope.actor.userId,
              state: { in: ['QUEUED', 'RUNNING'] },
            },
          })
        )
          throw new ConflictException({ code: 'EXPORT_ALREADY_ACTIVE' });
        const job = await tx.userExportJob.create({
          data: { ownerUserId: scope.actor.userId, spaceId: scope.spaceId },
        });
        await writeAudit(tx, {
          action: 'ACCOUNT_EXPORT_REQUEST',
          outcome: 'SUCCEEDED',
          actorUserId: scope.actor.userId,
          resourceId: job.id,
          requestId: scope.actor.requestId,
          correlationId: scope.actor.correlationId,
        });
        return { resultId: job.id, statusCode: 201 };
      },
    );
    return this.exportStatus(scope, receipt.resultId);
  }
  async exportStatus(scope: AuthorizedSpace, id: string) {
    const row = await this.job(scope, id);
    if (row.state === 'READY' && row.expiresAt! <= new Date())
      return this.exportView({ ...row, state: 'EXPIRED' });
    return this.exportView(row);
  }
  async download(
    scope: AuthorizedSpace,
    id: string,
    proof: string | undefined,
    fileId?: string,
  ) {
    const job = await this.job(scope, id);
    if (
      job.state !== 'READY' ||
      !job.expiresAt ||
      job.expiresAt <= new Date() ||
      !job.artifactHash ||
      job.artifactSize === null
    )
      throw new NotFoundException();
    try {
      const [body, signature, ...extra] = (proof ?? '').split('.');
      if (
        !body ||
        !signature ||
        extra.length ||
        !equal(signature, this.capability(body, 'export'))
      )
        throw new Error();
      const claim = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as { job: string; owner: string; expires: number };
      if (
        claim.job !== job.id ||
        claim.owner !== scope.actor.userId ||
        !Number.isSafeInteger(claim.expires) ||
        claim.expires < Date.now() ||
        claim.expires > Date.now() + 600000
      )
        throw new Error();
    } catch {
      throw new ForbiddenException();
    }
    await this.db.client.$transaction(async (tx) => {
      await scope.fence(tx);
      await writeAudit(tx, {
        action: 'ACCOUNT_EXPORT_DOWNLOAD',
        outcome: 'SUCCEEDED',
        actorUserId: scope.actor.userId,
        resourceId: job.id,
        requestId: scope.actor.requestId,
        correlationId: scope.actor.correlationId,
      });
    });
    if (fileId) {
      const manifest = job.manifest as AttachmentManifest[] | null,
        item = manifest?.find((v) => v.id === fileId);
      if (!item) throw new NotFoundException();
      const stream = await this.db.client.$transaction(async (tx) => {
        await scope.fence(tx);
        return this.files.bytes(tx, scope, item);
      });
      return { stream, mimeType: item.mimeType };
    }
    await this.db.client.$transaction((tx) => scope.fence(tx));
    const stream = await this.storage.open(job.objectKey, {
      size: job.artifactSize,
      sha256: job.artifactHash,
    });
    return { stream, mimeType: 'application/json' };
  }
  async requestDeletion(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: z.infer<typeof c.DeletionRequestSchema>,
  ) {
    if (!key) throw new BadRequestException();
    this.policy(input.policyVersion, input.retentionAcknowledged);
    await this.auth.verifyPassword(scope.actor.userId, input.password);
    const receipt = await idempotent(
      this.db.client,
      scope,
      'account.deletion.request',
      key,
      {
        accountRevision: input.accountRevision,
        policyVersion: input.policyVersion,
        retentionAcknowledged: true,
      },
      async (tx) => {
        const settings = await tx.userSettings.findUniqueOrThrow({
          where: { userId: scope.actor.userId },
        });
        if (settings.revision !== input.accountRevision)
          throw new ConflictException();
        await tx.accountDeletionJob.updateMany({
          where: {
            ownerUserId: scope.actor.userId,
            state: 'PENDING',
            createdAt: { lt: new Date(Date.now() - 1800000) },
          },
          data: {
            state: 'EXPIRED',
            confirmationHash: null,
            recoveryHash: null,
          },
        });
        if (
          await tx.accountDeletionJob.findFirst({
            where: {
              ownerUserId: scope.actor.userId,
              state: {
                in: ['PENDING', 'WAITING', 'ERASING', 'BLOCKED_POLICY'],
              },
            },
          })
        )
          throw new ConflictException();
        const id = randomUUID(),
          expires = new Date(Date.now() + 600000);
        const job = await tx.accountDeletionJob.create({
          data: {
            id,
            ownerUserId: scope.actor.userId,
            spaceId: scope.spaceId,
            identityDigest: this.control.digest('identity', scope.actor.userId),
            spaceDigest: this.control.digest('space', scope.spaceId),
            policyVersion: input.policyVersion,
            retentionAcknowledged: true,
            confirmationHash: hash(this.capability(id, 'confirmation')),
            recoveryHash: hash(this.capability(id, 'recovery')),
            confirmationExpiresAt: expires,
            recoveryExpiresAt: new Date(Date.now() + 90 * day),
          },
        });
        await appendOutbox(tx, scope, {
          type: 'account.deletion_requested',
          version: 1,
          aggregateId: job.id,
          payload: {},
        });
        await writeAudit(tx, {
          action: 'ACCOUNT_DELETION_REQUEST',
          outcome: 'SUCCEEDED',
          actorUserId: scope.actor.userId,
          resourceId: job.id,
          requestId: scope.actor.requestId,
          correlationId: scope.actor.correlationId,
        });
        return { resultId: id, statusCode: 201 };
      },
    );
    const job = await this.db.client.accountDeletionJob.findFirstOrThrow({
      where: { id: receipt.resultId, ownerUserId: scope.actor.userId },
    });
    return c.DeletionChallengeSchema.parse({
      job: this.deletionView(job),
      confirmationProof: this.capability(job.id, 'confirmation'),
      recoveryCapability: this.capability(job.id, 'recovery'),
      confirmationExpiresAt: job.confirmationExpiresAt!.toISOString(),
    });
  }
  private async deletionProof(
    id: string,
    value: string | undefined,
    kind: 'confirmation' | 'recovery',
  ) {
    if (!value || value.length > 128) throw new NotFoundException();
    const job = await this.db.client.accountDeletionJob.findUnique({
        where: { id },
      }),
      expected =
        kind === 'confirmation' ? job?.confirmationHash : job?.recoveryHash;
    if (!job || !expected || !equal(hash(value), expected))
      throw new NotFoundException();
    if (
      kind === 'recovery' &&
      (!job.recoveryExpiresAt || job.recoveryExpiresAt <= new Date())
    )
      throw new NotFoundException();
    return job;
  }
  private record(
    job: AccountDeletionJob,
    state: ErasureRecord['state'],
  ): ErasureRecord {
    return {
      jobId: job.id,
      identityDigest: job.identityDigest,
      spaceDigest: job.spaceDigest,
      state,
      at: new Date().toISOString(),
      eraseAfter: job.eraseAfter!.toISOString(),
      policyVersion: job.policyVersion,
      recoveryHash: state === 'CLOSED' ? job.recoveryHash : null,
    };
  }
  async confirm(
    input: z.infer<typeof c.DeletionConfirmSchema>,
    proof: string | undefined,
    headers: IncomingHttpHeaders,
  ) {
    const before = await this.deletionProof(input.jobId, proof, 'confirmation');
    if (
      ['WAITING', 'ERASING', 'ERASED', 'BLOCKED_POLICY'].includes(before.state)
    ) {
      if (before.ownerUserId) await this.auth.revokeAll(before.ownerUserId);
      return this.deletionView(before);
    }
    if (
      before.state !== 'PENDING' ||
      before.confirmationExpiresAt! <= new Date() ||
      Date.now() - before.createdAt.getTime() > 1800000
    )
      throw new ConflictException();
    const session = await this.auth.session(headers);
    if (!session?.user.emailVerified || session.user.id !== before.ownerUserId)
      throw new ForbiddenException();
    this.policy(before.policyVersion, before.retentionAcknowledged);
    const scope = await this.spaces.authorizePersonal({
      userId: session.user.id,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    });
    const after = await this.db.client.$transaction(
      async (tx) => {
        await scope.fence(tx);
        const job = await tx.accountDeletionJob.findUniqueOrThrow({
          where: { id: before.id },
        });
        if (
          job.state !== 'PENDING' ||
          job.revision !== input.revision ||
          job.confirmationExpiresAt! <= new Date()
        )
          throw new ConflictException();
        const confirmedAt = new Date(),
          next = await tx.accountDeletionJob.update({
            where: { id: job.id },
            data: {
              state: 'WAITING',
              revision: { increment: 1 },
              confirmedAt,
              eraseAfter: new Date(confirmedAt.getTime() + 7 * day),
              nextAt: new Date(confirmedAt.getTime() + 7 * day),
            },
          });
        await this.control.append(this.record(next, 'CLOSED'));
        await this.spaces.setClosed(tx, scope, true);
        for (const owner of this.owners) await owner.suspend(tx, scope);
        await this.auth.revokeAllInside(tx, scope.actor.userId);
        await tx.userExportJob.updateMany({
          where: {
            ownerUserId: scope.actor.userId,
            state: { in: ['QUEUED', 'RUNNING', 'READY'] },
          },
          data: {
            state: 'CANCELED',
            failureCode: 'ACCOUNT_CLOSED',
            revision: { increment: 1 },
          },
        });
        await writeAudit(tx, {
          action: 'ACCOUNT_DELETION_CONFIRM',
          outcome: 'SUCCEEDED',
          actorUserId: scope.actor.userId,
          resourceId: job.id,
          requestId: scope.actor.requestId,
          correlationId: scope.actor.correlationId,
        });
        return next;
      },
      { timeout: 30000 },
    );
    await this.auth.revokeAll(session.user.id);
    return this.deletionView(after);
  }
  async deletionStatus(id: string, recovery: string | undefined) {
    return this.deletionView(
      await this.deletionProof(id, recovery, 'recovery'),
    );
  }
  async cancel(
    input: z.infer<typeof c.DeletionCancelSchema>,
    recovery: string | undefined,
  ) {
    const before = await this.deletionProof(input.jobId, recovery, 'recovery');
    if (before.state === 'CANCELED') return this.deletionView(before);
    if (
      !before.ownerUserId ||
      !before.spaceId ||
      before.state !== 'WAITING' ||
      before.eraseAfter! <= new Date()
    )
      throw new ConflictException();
    await this.auth.verifyPassword(before.ownerUserId, input.password);
    const job = await this.db.client.$transaction(async (tx) => {
      const scope = await this.spaces.erasureScope(
          tx,
          before.ownerUserId!,
          before.spaceId!,
          randomUUID(),
        ),
        current = await tx.accountDeletionJob.findUniqueOrThrow({
          where: { id: before.id },
        });
      if (current.state !== 'WAITING' || current.eraseAfter! <= new Date())
        throw new ConflictException();
      const next = await tx.accountDeletionJob.update({
        where: { id: current.id },
        data: {
          state: 'CANCELED',
          revision: { increment: 1 },
          completedAt: new Date(),
          confirmationHash: null,
        },
      });
      await this.control.append(this.record(next, 'CANCELED'));
      await this.spaces.setClosed(tx, scope, false);
      await writeAudit(tx, {
        action: 'ACCOUNT_DELETION_CANCEL',
        outcome: 'SUCCEEDED',
        actorUserId: scope.actor.userId,
        resourceId: current.id,
        requestId: scope.actor.requestId,
        correlationId: scope.actor.correlationId,
      });
      return next;
    });
    return this.deletionView(job);
  }
  async verifyControl() {
    try {
      const records = await this.control.records(),
        settings = await this.db.client.$transaction((tx) =>
          this.auth.identityIds(tx),
        );
      if (settings.length > 100000) throw new Error('Restore bound exceeded');
      for (const record of records) {
        const job = await this.db.client.accountDeletionJob.findUnique({
          where: { id: record.jobId },
        });
        if (
          !job ||
          job.identityDigest !== record.identityDigest ||
          job.spaceDigest !== record.spaceDigest ||
          (record.state === 'ERASED' && job.state !== 'ERASED') ||
          (record.state === 'ERASING' &&
            !['ERASING', 'ERASED', 'FAILED', 'BLOCKED_POLICY'].includes(
              job.state,
            )) ||
          (record.state === 'CLOSED' &&
            !['WAITING', 'BLOCKED_POLICY', 'ERASING', 'ERASED'].includes(
              job.state,
            )) ||
          (record.state === 'CANCELED' && job.state !== 'CANCELED')
        )
          throw new Error('Restore checkpoint mismatch');
        if (job.state === 'ERASED') {
          if (
            settings.some(
              (v) =>
                this.control.digest('identity', v.id) === record.identityDigest,
            )
          )
            throw new Error('Erased identity restored');
          if (record.state !== 'ERASED')
            await this.control.append(this.record(job, 'ERASED'));
        } else if (
          job.ownerUserId &&
          job.spaceId &&
          job.state !== 'CANCELED' &&
          !(await this.db.client.$transaction((tx) =>
            this.spaces.isClosed(tx, job.ownerUserId!, job.spaceId!),
          ))
        )
          throw new Error('Closed identity restored');
      }
      const known = new Set(records.map((v) => v.jobId)),
        missing = await this.db.client.accountDeletionJob.findFirst({
          where: {
            confirmedAt: { not: null },
            id: { notIn: [...known] },
            OR: [
              { evidenceExpiresAt: null },
              { evidenceExpiresAt: { gt: new Date() } },
            ],
          },
        });
      if (missing) throw new Error('Missing current erasure evidence');
      const artifacts = await this.db.client.userExportJob.findMany({
        select: { objectKey: true, attemptKey: true, artifactKeys: true },
        take: 100001,
      });
      if (artifacts.length > 100000) throw new Error('Restore bound exceeded');
      if (
        !(await this.db.client.$transaction((tx) =>
          this.files.verifyInventory(
            tx,
            artifacts.flatMap((v) => [
              { key: v.objectKey, attempt: null },
              { key: v.objectKey, attempt: v.attemptKey },
              ...retiredArtifacts(v.artifactKeys).flatMap((v) => [
                { key: v.key, attempt: null },
                v,
              ]),
            ]),
          ),
        ))
      )
        throw new Error('Unknown restored private file');
      this.gate.release();
      return true;
    } catch {
      this.gate.quarantine();
      return false;
    }
  }
  private async buildExport(job: UserExportJob) {
    const snapshot = await this.db.client.$transaction(
      async (tx) => {
        const scope = await this.spaces.background(
          tx,
          job.spaceId,
          job.id,
          job.id,
        );
        if (!scope || scope.actor.userId !== job.ownerUserId)
          throw new ForbiddenException();
        await scope.fence(tx);
        const budget = new ExportBudget();
        budget.add('profile', [
          await this.auth.profileSnapshot(tx, job.ownerUserId),
        ]);
        budget.add(
          'settings',
          await tx.userSettings.findMany({
            where: { userId: job.ownerUserId },
            take: 1,
          }),
        );
        for (const owner of this.owners)
          await owner.snapshot(tx, scope, budget);
        await this.platform.snapshot(tx, scope, budget);
        const manifest = await this.files.manifest(
          tx,
          scope,
          budget.remaining() + 1,
        );
        budget.add(
          'attachments',
          manifest.map((v) => ({
            ...v,
            downloadRoute:
              v.status === 'READY'
                ? `/api/v1/me/exports/${job.id}/attachments/${v.id}`
                : null,
          })),
        );
        for (const item of manifest)
          if (item.status === 'READY') {
            const stream = await this.files.bytes(tx, scope, item);
            stream.destroy();
          }
        const bytes = Buffer.from(
          JSON.stringify({
            version: 1,
            exportId: job.id,
            capturedAt: new Date().toISOString(),
            recordCount: budget.count,
            data: budget.sections,
          }),
        );
        if (bytes.length > 50 * 1024 * 1024)
          throw new BadRequestException({ code: 'EXPORT_LIMIT' });
        return { bytes, manifest };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 30000,
      },
    );
    await this.storage.remove(job.objectKey, job.attemptKey);
    const evidence = await this.storage.write(
      job.objectKey,
      job.attemptKey,
      Readable.from(snapshot.bytes),
      { size: snapshot.bytes.length, mimeType: 'application/json' },
      new AbortController().signal,
    );
    try {
      await this.db.client.$transaction(async (tx) => {
        const scope = await this.spaces.background(
          tx,
          job.spaceId,
          job.id,
          job.id,
        );
        if (!scope) throw new ForbiddenException();
        await scope.fence(tx);
        const changed = await tx.userExportJob.updateMany({
          where: { id: job.id, state: 'RUNNING', revision: job.revision },
          data: {
            state: 'READY',
            failureCode: null,
            artifactSize: evidence.size,
            artifactHash: evidence.sha256,
            manifest: snapshot.manifest,
            completedAt: new Date(),
            expiresAt: new Date(Date.now() + day),
            leaseUntil: null,
            revision: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new ConflictException();
        await writeAudit(tx, {
          action: 'ACCOUNT_EXPORT_COMPLETE',
          outcome: 'SUCCEEDED',
          actorUserId: job.ownerUserId,
          resourceId: job.id,
          requestId: job.id,
          correlationId: job.id,
        });
      });
    } catch (error) {
      await this.storage.remove(job.objectKey, job.attemptKey);
      throw error;
    }
  }
  private async eraseJob(job: AccountDeletionJob) {
    this.policy(job.policyVersion, job.retentionAcknowledged);
    if (
      !job.ownerUserId ||
      !job.spaceId ||
      !job.eraseAfter ||
      job.eraseAfter > new Date()
    )
      throw new ConflictException();
    const progress = job.progress as {
      fileAfter?: string;
      stage?: string;
    } | null;
    await this.control.append(this.record(job, 'ERASING'));
    if (progress?.stage !== 'IDENTITY') {
      const batch = await this.db.client.$transaction(async (tx) => {
        const scope = await this.spaces.erasureScope(
          tx,
          job.ownerUserId!,
          job.spaceId!,
          job.id,
        );
        return this.files.eraseBatch(tx, scope, progress?.fileAfter ?? null);
      });
      if (batch.length) {
        for (const file of batch) {
          this.policy(job.policyVersion, job.retentionAcknowledged);
          await this.files.removeFile(file);
          const changed = await this.db.client.accountDeletionJob.updateMany({
            where: { id: job.id, revision: job.revision, state: 'ERASING' },
            data: {
              progress: { fileAfter: file.id },
              leaseUntil: new Date(Date.now() + 60000),
              nextAt: new Date(),
              attempts: 0,
            },
          });
          if (changed.count !== 1) throw new ConflictException();
        }
        await this.db.client.accountDeletionJob.updateMany({
          where: { id: job.id, revision: job.revision },
          data: { leaseUntil: null },
        });
        return;
      }
      const artifacts = await this.db.client.userExportJob.findMany({
        where: { ownerUserId: job.ownerUserId, spaceId: job.spaceId },
        take: 100001,
      });
      if (artifacts.length > 100000) throw new ConflictException();
      for (const artifact of artifacts) {
        await this.storage.remove(artifact.objectKey, artifact.attemptKey);
        for (const retired of retiredArtifacts(artifact.artifactKeys))
          await this.storage.remove(retired.key, retired.attempt);
      }
      await this.db.client.$transaction(
        async (tx) => {
          const scope = await this.spaces.erasureScope(
            tx,
            job.ownerUserId!,
            job.spaceId!,
            job.id,
          );
          this.policy(job.policyVersion, job.retentionAcknowledged);
          const current = await tx.accountDeletionJob.findUniqueOrThrow({
            where: { id: job.id },
          });
          if (current.revision !== job.revision || current.state !== 'ERASING')
            throw new ConflictException();
          for (const owner of this.owners) await owner.detach(tx, scope);
          for (const owner of this.owners) await owner.erase(tx, scope);
          await this.platform.erase(tx, scope);
          await tx.userExportJob.deleteMany({
            where: { ownerUserId: job.ownerUserId!, spaceId: job.spaceId! },
          });
          await this.spaces.erase(tx, scope);
          await tx.userSettings.deleteMany({
            where: { userId: job.ownerUserId! },
          });
          await tx.accountDeletionJob.updateMany({
            where: { ownerUserId: job.ownerUserId!, id: { not: job.id } },
            data: {
              ownerUserId: null,
              spaceId: null,
              confirmationHash: null,
              recoveryHash: null,
              progress: Prisma.DbNull,
              evidenceExpiresAt: new Date(Date.now() + 90 * day),
            },
          });
          await this.auth.eraseIdentityInside(tx, job.ownerUserId!);
          await tx.accountDeletionJob.update({
            where: { id: job.id },
            data: {
              state: 'ERASED',
              failureCode: null,
              ownerUserId: null,
              spaceId: null,
              progress: Prisma.DbNull,
              confirmationHash: null,
              recoveryHash: null,
              leaseUntil: null,
              completedAt: new Date(),
              evidenceExpiresAt: new Date(Date.now() + 90 * day),
              revision: { increment: 1 },
            },
          });
        },
        { timeout: 30000 },
      );
    }
    const completed = await this.db.client.accountDeletionJob.findUniqueOrThrow(
      { where: { id: job.id } },
    );
    await this.control.append(this.record(completed, 'ERASED'));
  }
  async consume() {
    this.gate.assert();
    let worked = false;
    const exportJob = await this.db.client.$transaction(async (tx) => {
      const row = await tx.userExportJob.findFirst({
        where: {
          OR: [
            { state: 'QUEUED', nextAt: { lte: new Date() } },
            { state: 'RUNNING', leaseUntil: { lte: new Date() } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!row) return null;
      if (row.attempts >= 5) {
        await tx.userExportJob.update({
          where: { id: row.id },
          data: {
            state: 'FAILED',
            failureCode: 'EXPORT_ATTEMPTS_EXHAUSTED',
            leaseUntil: null,
          },
        });
        return null;
      }
      const scope = await this.spaces.background(
        tx,
        row.spaceId,
        row.id,
        row.id,
      );
      if (!scope) return null;
      await scope.fence(tx);
      const changed = await tx.userExportJob.updateMany({
        where: { id: row.id, revision: row.revision, state: row.state },
        data: {
          state: 'RUNNING',
          objectKey: randomUUID(),
          attemptKey: randomUUID(),
          artifactKeys: { push: [row.objectKey, row.attemptKey] },
          attempts: { increment: 1 },
          leaseUntil: new Date(Date.now() + 60000),
          revision: { increment: 1 },
        },
      });
      return changed.count
        ? tx.userExportJob.findUniqueOrThrow({ where: { id: row.id } })
        : null;
    });
    if (exportJob) {
      worked = true;
      try {
        await this.buildExport(exportJob);
      } catch (error) {
        const code =
          error instanceof ForbiddenException
            ? 'ACCOUNT_CLOSED'
            : error instanceof BadRequestException
              ? 'EXPORT_LIMIT'
              : 'EXPORT_UNAVAILABLE';
        await this.db.client.userExportJob.updateMany({
          where: {
            id: exportJob.id,
            state: 'RUNNING',
            revision: exportJob.revision,
          },
          data: {
            state:
              exportJob.attempts >= 5 ||
              code === 'ACCOUNT_CLOSED' ||
              code === 'EXPORT_LIMIT'
                ? 'FAILED'
                : 'QUEUED',
            failureCode: code,
            leaseUntil: null,
            nextAt: new Date(
              Date.now() + Math.min(300, 2 ** exportJob.attempts) * 1000,
            ),
            revision: { increment: 1 },
          },
        });
      }
    }
    const deletion = await this.db.client.$transaction(async (tx) => {
      const row = await tx.accountDeletionJob.findFirst({
        where: {
          state: { in: ['WAITING', 'ERASING', 'BLOCKED_POLICY'] },
          nextAt: { lte: new Date() },
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!row || !row.ownerUserId || !row.spaceId) return null;
      if (
        row.policyVersion !== this.config.PERSONAL_ERASURE_POLICY_VERSION ||
        !row.retentionAcknowledged
      ) {
        await tx.accountDeletionJob.update({
          where: { id: row.id },
          data: {
            state: 'BLOCKED_POLICY',
            failureCode: 'ERASURE_POLICY_UNAVAILABLE',
            nextAt: new Date(Date.now() + 300000),
            leaseUntil: null,
          },
        });
        return null;
      }
      if (row.attempts >= 5) {
        await tx.accountDeletionJob.update({
          where: { id: row.id },
          data: {
            state: 'FAILED',
            failureCode: 'ERASURE_ATTEMPTS_EXHAUSTED',
            leaseUntil: null,
          },
        });
        return null;
      }
      if ((row.progress as { stage?: string } | null)?.stage !== 'IDENTITY')
        await this.spaces.erasureScope(
          tx,
          row.ownerUserId,
          row.spaceId,
          row.id,
        );
      const changed = await tx.accountDeletionJob.updateMany({
        where: { id: row.id, revision: row.revision, state: row.state },
        data: {
          state: 'ERASING',
          attempts: { increment: 1 },
          leaseUntil: new Date(Date.now() + 60000),
          revision: { increment: 1 },
        },
      });
      return changed.count
        ? tx.accountDeletionJob.findUniqueOrThrow({ where: { id: row.id } })
        : null;
    });
    if (deletion) {
      worked = true;
      try {
        await this.eraseJob(deletion);
      } catch (error) {
        const blocked =
          error instanceof ConflictException &&
          error.getResponse() &&
          typeof error.getResponse() === 'object' &&
          (error.getResponse() as { code?: string }).code ===
            'ERASURE_POLICY_UNAVAILABLE';
        await this.db.client.accountDeletionJob.updateMany({
          where: {
            id: deletion.id,
            state: 'ERASING',
            revision: deletion.revision,
          },
          data: {
            state: blocked
              ? 'BLOCKED_POLICY'
              : deletion.attempts >= 5
                ? 'FAILED'
                : 'ERASING',
            failureCode: blocked
              ? 'ERASURE_POLICY_UNAVAILABLE'
              : 'ERASURE_INCOMPLETE',
            leaseUntil: null,
            nextAt: new Date(
              Date.now() + Math.min(300, 2 ** deletion.attempts) * 1000,
            ),
          },
        });
      }
    }
    const expired = await this.db.client.userExportJob.findMany({
      where: {
        OR: [
          { state: 'READY', expiresAt: { lte: new Date() } },
          {
            state: { in: ['FAILED', 'CANCELED', 'EXPIRED'] },
            createdAt: { lt: new Date(Date.now() - day) },
            OR: [
              { artifactHash: { not: null } },
              { artifactKeys: { isEmpty: false } },
            ],
          },
        ],
      },
      take: 25,
    });
    for (const row of expired) {
      await this.storage.remove(row.objectKey, row.attemptKey);
      for (const retired of retiredArtifacts(row.artifactKeys))
        await this.storage.remove(retired.key, retired.attempt);
      await this.db.client.userExportJob.update({
        where: { id: row.id },
        data: {
          state: 'EXPIRED',
          manifest: Prisma.DbNull,
          artifactKeys: [],
          artifactHash: null,
          artifactSize: null,
        },
      });
      worked = true;
    }
    const oldExports = await this.db.client.userExportJob.findMany({
      where: {
        state: { in: ['EXPIRED', 'FAILED', 'CANCELED'] },
        createdAt: { lt: new Date(Date.now() - 30 * day) },
        artifactHash: null,
        artifactKeys: { isEmpty: true },
      },
      select: { id: true },
      take: 25,
    });
    if (oldExports.length) {
      await this.db.client.userExportJob.deleteMany({
        where: { id: { in: oldExports.map((v) => v.id) } },
      });
      worked = true;
    }
    const pending = await this.db.client.accountDeletionJob.findMany({
      where: {
        state: 'PENDING',
        createdAt: { lt: new Date(Date.now() - 1800000) },
      },
      select: { id: true },
      take: 25,
    });
    if (pending.length) {
      await this.db.client.accountDeletionJob.updateMany({
        where: { id: { in: pending.map((v) => v.id) }, state: 'PENDING' },
        data: {
          state: 'EXPIRED',
          confirmationHash: null,
          recoveryHash: null,
          evidenceExpiresAt: new Date(Date.now() + 30 * day),
        },
      });
      worked = true;
    }
    const pruned = await this.control.prune();
    if (pruned.length) {
      await this.db.client.accountDeletionJob.deleteMany({
        where: { id: { in: pruned }, state: { in: ['CANCELED', 'ERASED'] } },
      });
      worked = true;
    }
    const oldPending = await this.db.client.accountDeletionJob.findMany({
      where: { state: 'EXPIRED', evidenceExpiresAt: { lt: new Date() } },
      select: { id: true },
      take: 25,
    });
    if (oldPending.length) {
      await this.db.client.accountDeletionJob.deleteMany({
        where: { id: { in: oldPending.map((v) => v.id) } },
      });
      worked = true;
    }
    return worked;
  }
  async restoreReplay() {
    this.gate.quarantine();
    try {
      const records = await this.control.records(),
        users = await this.db.client.$transaction((tx) =>
          this.auth.identityIds(tx),
        );
      if (users.length > 100000) return false;
      const identities = new Map(
        users.map((v) => [this.control.digest('identity', v.id), v.id]),
      );
      let processed = 0;
      for (const record of records) {
        let job = await this.db.client.accountDeletionJob.findUnique({
          where: { id: record.jobId },
        });
        const userId = identities.get(record.identityDigest);
        if (
          job &&
          (job.identityDigest !== record.identityDigest ||
            job.spaceDigest !== record.spaceDigest)
        )
          return false;
        if (record.state === 'ERASED' && job?.state === 'ERASED' && !userId)
          continue;
        if (record.state === 'CANCELED' && job?.state === 'CANCELED') continue;
        if (
          record.state === 'CLOSED' &&
          job?.state === 'WAITING' &&
          userId &&
          job.spaceId &&
          (await this.db.client.$transaction((tx) =>
            this.spaces.isClosed(tx, userId, job!.spaceId!),
          ))
        )
          continue;
        if (!userId) {
          if (record.state === 'ERASED' && job?.state === 'ERASED') continue;
          return false;
        }
        if (++processed > 100) return false;
        if (job?.state !== 'ERASING' || job.ownerUserId !== userId)
          job = await this.db.client.$transaction(async (tx) => {
            const row = await this.spaces.restoredPersonal(tx, userId);
            if (
              !row ||
              this.control.digest('space', row.id) !== record.spaceDigest
            )
              throw new Error('Unknown restore owner');
            await this.spaces.restoreClosure(
              tx,
              userId,
              row.id,
              record.state !== 'CANCELED',
              record.jobId,
            );
            await this.auth.revokeAllInside(tx, userId);
            const data = {
              ownerUserId: userId,
              spaceId: row.id,
              identityDigest: record.identityDigest,
              spaceDigest: record.spaceDigest,
              state:
                record.state === 'CANCELED'
                  ? 'CANCELED'
                  : record.state === 'CLOSED'
                    ? 'WAITING'
                    : 'ERASING',
              eraseAfter: new Date(record.eraseAfter),
              confirmedAt: new Date(
                new Date(record.eraseAfter).getTime() - 7 * day,
              ),
              policyVersion: record.policyVersion,
              retentionAcknowledged: true,
              recoveryHash: record.recoveryHash,
              recoveryExpiresAt: new Date(
                new Date(record.eraseAfter).getTime() + 83 * day,
              ),
              progress: Prisma.DbNull,
              leaseUntil: null,
              attempts: 0,
              failureCode: null,
            };
            return tx.accountDeletionJob.upsert({
              where: { id: record.jobId },
              create: { id: record.jobId, ...data },
              update: { ...data, revision: { increment: 1 } },
            });
          });
        if (record.state === 'ERASING' || record.state === 'ERASED') {
          if (!job.eraseAfter || job.eraseAfter > new Date()) return false;
          // One bounded file batch per job/call. Reruns resume from durable progress.
          await this.eraseJob(job);
          const current = await this.db.client.accountDeletionJob.findUnique({
            where: { id: job.id },
          });
          if (current?.state !== 'ERASED') return false;
        }
      }
      return this.verifyControl();
    } catch {
      return false;
    }
  }
}
