import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { DatabaseService } from '../database/database.service.js';
import type {
  Prisma,
  AdminOperationalCommand,
} from '../../generated/prisma/client.js';
import {
  jobSchemaStamp,
  jobSchemaVersion,
  validJobSchema,
  queues,
} from '../jobs/schema.js';
import { AdminCommand } from '../admin/admin-command.js';
import { JobPolicySchema } from '@mehran/api-contracts';

@Injectable()
export class QueueControl {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    validJobSchema(config.JOBS_SCHEMA);
  }
  async verify(tx: Prisma.TransactionClient = this.db.client) {
    const stamp = await tx.$queryRaw<
      { stamp: string }[]
    >`SELECT obj_description(oid,'pg_namespace') stamp FROM pg_namespace WHERE nspname=${this.config.JOBS_SCHEMA}`;
    if (stamp[0]?.stamp !== jobSchemaStamp)
      throw new ServiceUnavailableException({ code: 'QUEUE_SETUP_REQUIRED' });
    const version = await tx.$queryRawUnsafe<{ version: number }[]>(
      `SELECT version FROM ${this.config.JOBS_SCHEMA}.version`,
    );
    if (version.length !== 1 || version[0]?.version !== jobSchemaVersion)
      throw new ServiceUnavailableException({ code: 'QUEUE_SCHEMA_MISMATCH' });
  }
  private boss(tx: Prisma.TransactionClient) {
    // The pinned library executes in the caller's transaction. No pool, timer,
    // DDL, arbitrary SQL endpoint or separately committed queue side effect.
    return new PgBoss({
      schema: this.config.JOBS_SCHEMA,
      db: {
        executeSql: async (text, values = []) => ({
          rows: await tx.$queryRawUnsafe<unknown[]>(text, ...values),
        }),
      },
      migrate: false,
      createSchema: false,
      supervise: false,
      schedule: false,
      persistQueueStats: false,
      reindex: false,
      openTelemetry: { enabled: false },
    });
  }
  async list(
    q: {
      queue?: string | undefined;
      state?: string | undefined;
      after?: string | undefined;
      limit: number;
    },
    tx: Prisma.TransactionClient = this.db.client,
  ) {
    await this.verify(tx);
    const rows = await tx.$queryRawUnsafe<
      Array<{
        id: string;
        queue: string;
        state: string;
        attempts: number;
        retryLimit: number;
        scheduledAt: Date;
        createdAt: Date;
        startedAt: Date | null;
        completedAt: Date | null;
      }>
    >(
      `SELECT id,name queue,state::text,retry_count attempts,retry_limit "retryLimit",start_after "scheduledAt",created_on "createdAt",started_on "startedAt",completed_on "completedAt" FROM ${this.config.JOBS_SCHEMA}.job WHERE name=ANY($1::text[]) AND ($2::text IS NULL OR name=$2) AND ($3::text IS NULL OR state::text=$3) AND ($4::uuid IS NULL OR id>$4::uuid) ORDER BY id LIMIT $5`,
      Object.values(queues),
      q.queue ?? null,
      q.state ?? null,
      q.after ?? null,
      q.limit + 1,
    );
    return {
      items: rows.slice(0, q.limit).map((r) => ({
        ...r,
        scheduledAt: r.scheduledAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        startedAt: r.startedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        errorCode: r.state === 'failed' ? 'JOB_FAILED' : null,
      })),
      nextAfter: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
    };
  }
  view(r: AdminOperationalCommand) {
    return {
      id: r.id,
      kind: r.kind,
      state: r.state,
      queue: r.queue,
      jobId: r.jobId,
      attempts: r.attempts,
      failureCode: r.failureCode,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    };
  }
  async detail(id: string) {
    const row = await this.db.client.adminOperationalCommand.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException();
    return this.view(row);
  }
  async request(
    command: AdminCommand,
    kind: 'RUN' | 'RETRY' | 'CANCEL' | 'CHECK',
    queue: string | null,
    jobId: string | null,
  ) {
    command.require(
      kind === 'CHECK' || command.permission === 'admin.health.repair'
        ? 'admin.health.repair'
        : 'admin.jobs.' + kind.toLowerCase(),
    );
    if (
      (kind !== 'CHECK' && queue !== queues.sweep && queue !== queues.outbox) ||
      (kind === 'CHECK' && queue !== null)
    )
      throw new ConflictException({ code: 'UNSAFE_JOB_KIND' });
    return this.db.client.$transaction((tx) =>
      command.execute(tx, async () => {
        await this.verify(tx);
        const pending = await tx.adminOperationalCommand.count({
          where: { state: { in: ['QUEUED', 'RUNNING'] } },
        });
        if (pending >= 100)
          throw new ConflictException({ code: 'CONTROL_QUEUE_LIMIT' });
        let expectedAttempts: number | null = null;
        if (jobId) {
          const rows = await tx.$queryRawUnsafe<
            { state: string; attempts: number; limit: number }[]
          >(
            `SELECT state::text,retry_count attempts,retry_limit "limit" FROM ${this.config.JOBS_SCHEMA}.job WHERE id=$1::uuid AND name=$2 FOR UPDATE`,
            jobId,
            queue,
          );
          const row = rows[0];
          if (!row) throw new NotFoundException();
          if (
            (kind === 'RETRY' &&
              (row.state !== 'failed' ||
                row.attempts >= 6 ||
                row.limit >= 6)) ||
            (kind === 'CANCEL' && !['created', 'retry'].includes(row.state))
          )
            throw new ConflictException({ code: 'JOB_CONTROL_INELIGIBLE' });
          expectedAttempts = row.attempts;
          if (
            (await tx.adminOperationalCommand.count({
              where: {
                jobId,
                kind,
                state: { in: ['QUEUED', 'RUNNING', 'SUCCEEDED'] },
              },
            })) >= 3
          )
            throw new ConflictException({ code: 'JOB_MANUAL_ATTEMPT_LIMIT' });
        }
        return this.view(
          await tx.adminOperationalCommand.create({
            data: {
              kind,
              queue,
              jobId,
              expectedAttempts,
              actorAdminId: command.adminId,
              permission: command.permission,
            },
          }),
        );
      }),
    );
  }
  async consume(checkDependencies?: () => Promise<void>) {
    return this.db.client.$transaction(async (tx) => {
      const [claim] = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "AdminOperationalCommand" WHERE state='QUEUED' ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!claim) return false;
      const row = await tx.adminOperationalCommand.findUniqueOrThrow({
        where: { id: claim.id },
      });
      try {
        await AdminCommand.requireInitiator(
          tx,
          row.actorAdminId,
          row.permission,
        );
      } catch {
        await tx.adminOperationalCommand.update({
          where: { id: row.id },
          data: {
            state: 'FAILED',
            failureCode: 'AUTHORITY_REVOKED',
            completedAt: new Date(),
            attempts: { increment: 1 },
          },
        });
        await tx.adminAuditEvent.create({
          data: {
            action: 'OPERATIONAL_JOB_DENIED',
            outcome: 'DENIED',
            actorAdminId: row.actorAdminId,
            permission: row.permission,
            requestId: randomUUID(),
            metadata: { controlId: row.id },
          },
        });
        return true;
      }
      await this.verify(tx);
      await tx.adminOperationalCommand.update({
        where: { id: row.id },
        data: { state: 'RUNNING', attempts: { increment: 1 } },
      });
      const boss = this.boss(tx);
      let dispatchedJobId: string | null = null,
        failureCode: string | null = null;
      if (row.kind === 'RUN')
        dispatchedJobId = await boss.send(row.queue!, {}, { id: row.id });
      else if (row.kind === 'CHECK') {
        if (!checkDependencies)
          failureCode = 'HEALTH_CHECK_HANDLER_UNAVAILABLE';
        else await checkDependencies();
      } else if (row.kind === 'RETRY' || row.kind === 'CANCEL') {
        const [job] = await tx.$queryRawUnsafe<
          { state: string; attempts: number; limit: number }[]
        >(
          `SELECT state::text,retry_count attempts,retry_limit "limit" FROM ${this.config.JOBS_SCHEMA}.job WHERE name=$1 AND id=$2::uuid FOR UPDATE`,
          row.queue,
          row.jobId,
        );
        if (
          !job ||
          job.attempts !== row.expectedAttempts ||
          (row.kind === 'RETRY'
            ? job.state !== 'failed' || job.attempts >= 6 || job.limit >= 6
            : !['created', 'retry'].includes(job.state))
        )
          failureCode = 'JOB_STATE_CHANGED';
        else if (row.kind === 'RETRY') await boss.retry(row.queue!, row.jobId!);
        else await boss.cancel(row.queue!, row.jobId!);
      }
      await tx.adminOperationalCommand.update({
        where: { id: row.id },
        data: {
          state: failureCode ? 'FAILED' : 'SUCCEEDED',
          dispatchedJobId,
          failureCode,
          completedAt: new Date(),
        },
      });
      await tx.adminAuditEvent.create({
        data: {
          action: 'OPERATIONAL_JOB_' + row.kind,
          outcome: failureCode ? 'FAILED' : 'SUCCEEDED',
          actorAdminId: row.actorAdminId,
          permission: row.permission,
          requestId: randomUUID(),
          metadata: {
            controlId: row.id,
            jobId: row.jobId,
            queue: row.queue,
            failureCode,
          },
        },
      });
      return true;
    });
  }
  async applyPolicy() {
    return this.db.client.$transaction(async (tx) => {
      await this.verify(tx);
      const row = await tx.adminOperationalPolicy.findUniqueOrThrow({
        where: { section: 'JOBS' },
      });
      const policy = JobPolicySchema.parse(row.value),
        boss = this.boss(tx);
      await boss.schedule(
        queues.sweep,
        policy.sweepMinutes === 1
          ? '* * * * *'
          : '*/' + policy.sweepMinutes + ' * * * *',
        {},
        { tz: 'UTC', key: 'authoritative-sweep' },
      );
      for (const kind of ['sweep', 'outbox', 'delivery', 'dead'] as const) {
        const p = policy[kind];
        // Preserve the existing pending-dispatch lifetime. pg-boss has one
        // terminal default; bounded result-specific expiry below applies the
        // separate completed/failed policies without deleting domain evidence.
        await boss.updateQueue(queues[kind], {
          retentionSeconds: 7 * 86400,
          deleteAfterSeconds: Math.max(p.failedDays, p.completedDays) * 86400,
        });
      }
      return row.revision;
    });
  }
  async expireResults() {
    return this.db.client.$transaction(async (tx) => {
      await this.verify(tx);
      const row = await tx.adminOperationalPolicy.findUniqueOrThrow({
          where: { section: 'JOBS' },
        }),
        policy = JobPolicySchema.parse(row.value),
        boss = this.boss(tx);
      let removed = 0;
      for (const kind of ['sweep', 'outbox', 'delivery', 'dead'] as const) {
        const p = policy[kind];
        const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM ${this.config.JOBS_SCHEMA}.job WHERE name=$1 AND ((state IN ('completed','cancelled') AND completed_on<clock_timestamp()-make_interval(days=>$2::integer)) OR (state='failed' AND completed_on<clock_timestamp()-make_interval(days=>$3::integer))) ORDER BY completed_on,id LIMIT $4 FOR UPDATE SKIP LOCKED`,
          queues[kind],
          p.completedDays,
          p.failedDays,
          100 - removed,
        );
        if (rows.length)
          await boss.deleteJob(
            queues[kind],
            rows.map((r) => r.id),
          );
        removed += rows.length;
        if (removed === 100) break;
      }
      if (removed)
        await tx.adminAuditEvent.create({
          data: {
            action: 'OPERATIONAL_JOB_RESULTS_EXPIRED',
            outcome: 'SUCCEEDED',
            requestId: randomUUID(),
            metadata: { removed, policyRevision: row.revision },
          },
        });
      return removed;
    });
  }
}
