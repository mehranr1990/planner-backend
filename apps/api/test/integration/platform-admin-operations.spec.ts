import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID, createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { spawnSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  type Prisma,
} from '../../src/generated/prisma/client.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { testApplication } from '../support/application.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { AdminCommand } from '../../src/platform/admin/admin-command.js';
import { OperationsPolicy } from '../../src/platform/operations/operations-policy.js';
import { QueueControl } from '../../src/platform/operations/queue-control.js';
import { SystemHealth } from '../../src/platform/operations/system-health.js';
import { BackupRuns } from '../../src/platform/operations/backup-runs.js';
import { BackupOperator } from '../../src/platform/operations/backup-operator.js';
import { OperationsControl } from '../../src/platform/operations/operations-control.js';
import { StorageOperations } from '../../src/platform/storage/storage-operations.js';
import { StorageAdmission } from '../../src/platform/storage/storage-admission.js';
import {
  STORAGE_PORT,
  type StoragePort,
} from '../../src/platform/storage/storage.port.js';
import { PrivacyGate } from '../../src/platform/authorization/privacy-gate.js';
import { installJobSchema } from '../../src/platform/jobs/schema.js';
import { assertSharedCleanupCatalog } from '../../src/platform/lifecycle/shared-cleanup-catalog.js';
import { PrivateFileQuerySchema } from '@mehran/api-contracts';
import { TeamsService } from '../../src/modules/teams/public/index.js';
import { CompaniesService } from '../../src/modules/companies/public/index.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';

describe('Platform Admin P3 operational boundaries', () => {
  const secret =
    'test-only-secret-for-foundation-contracts-at-least-32-characters';
  const queueSchema = 'planner_jobs_test_' + randomUUID().replaceAll('-', '');
  const controlRoot = path.resolve('.tools/p3-ops-control-' + randomUUID());
  const sharedRoot = path.resolve('.tools/p3-ops-shared-' + randomUUID());
  let box: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    db: DatabaseService;
  let policies: OperationsPolicy,
    queue: QueueControl,
    storage: StorageOperations,
    backups: BackupRuns;
  type Operator = { id: string; sessionId: string; token: string };
  let first: Operator, second: Operator, reviewer: Operator;
  async function operator(role = 'SUPER_ADMIN'): Promise<Operator> {
    const user = await db.client.adminUser.create({
      data: {
        email: 'p3-' + randomUUID() + '@example.test',
        name: 'Operational fixture',
        role,
        twoFactorEnabled: true,
        mfaEnrolledAt: new Date(0),
      },
    });
    const session = await db.client.adminSession.create({
      data: {
        userId: user.id,
        token: randomUUID(),
        createdAt: new Date(Date.now() - 1000),
        mfaVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    return { id: user.id, sessionId: session.id, token: session.token };
  }
  function cookie(actor: Operator) {
    return (
      'mehran-admin.session_token=' +
      encodeURIComponent(
        actor.token +
          '.' +
          createHmac('sha256', secret).update(actor.token).digest('base64'),
      )
    );
  }
  async function cmd(
    actor: Operator,
    permission: string,
    input: Prisma.InputJsonValue = {},
    key = randomUUID(),
  ) {
    const event = await db.client.adminAuditEvent.create({
      data: {
        action:
          permission === 'admin.storage.private_files.read'
            ? 'GET operations/storage/files/:id/content'
            : 'P3_FIXTURE',
        requestId: randomUUID(),
        outcome: 'ATTEMPTED',
        permission,
      },
    });
    return new AdminCommand(
      actor.id,
      actor.sessionId,
      permission,
      event.requestId,
      event.id,
      key,
      input,
    );
  }
  beforeAll(async () => {
    box = await migrationSandbox(process.env);
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--config',
        'prisma.config.ts',
      ],
      { env: { ...process.env, DATABASE_URL: box.url }, encoding: 'utf8' },
    );
    if (result.status !== 0)
      throw new Error('P3 owned-schema deployment failed');
    await installJobSchema(isolatedTestDatabaseUrl(process.env), queueSchema);
    const schema = new URL(box.url).searchParams.get('schema')!;
    const client = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: isolatedTestDatabaseUrl(process.env),
          options: '-c search_path=' + schema + ' -c timezone=UTC',
        },
        { schema },
      ),
    });
    app = await testApplication({
      databaseInstance: {
        client,
        checkConnection: async () => {
          await client.$queryRaw`SELECT 1`;
        },
        onApplicationShutdown: async () => client.$disconnect(),
      } as DatabaseService,
      environment: {
        JOBS_SCHEMA: queueSchema,
        OPERATIONS_CONTROL_ROOT: controlRoot,
        SHARED_CONTROL_ROOT: sharedRoot,
        SHARED_CONTROL_KEYS: JSON.stringify({
          p3: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'p3',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P3-ONLY',
      },
    });
    db = app.get(DatabaseService);
    policies = app.get(OperationsPolicy);
    queue = app.get(QueueControl);
    storage = app.get(StorageOperations);
    backups = app.get(BackupRuns);
    await app.get(OperationsControl).write('READY', randomUUID());
    await app.get(SharedControl).initialize();
    first = await operator();
    second = await operator();
    reviewer = await operator('SECURITY_REVIEWER');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    if (box) {
      if (!/^planner_jobs_test_[a-f0-9]{32}$/.test(queueSchema))
        throw new Error('Unsafe queue fixture');
      await box.query('DROP SCHEMA "' + queueSchema + '" CASCADE');
      await box.close();
    }
    if (!controlRoot.startsWith(path.resolve('.tools') + path.sep))
      throw new Error('Unsafe fixture cleanup');
    await fs.rm(controlRoot, { recursive: true, force: true });
    if (!sharedRoot.startsWith(path.resolve('.tools') + path.sep))
      throw new Error('Unsafe fixture cleanup');
    await fs.rm(sharedRoot, { recursive: true, force: true });
  });
  async function fileFixture(text = 'Private file fixture') {
    const user = await db.client.user.create({
      data: {
        email: 'p3-file-' + randomUUID() + '@example.test',
        name: 'Private fixture',
        emailVerified: true,
        settings: { create: {} },
        spaces: { create: { kind: 'PERSONAL' } },
      },
      include: { spaces: true },
    });
    const key = randomUUID(),
      bytes = Buffer.from(text),
      evidence = await app
        .get<StoragePort>(STORAGE_PORT)
        .write(
          key,
          randomUUID(),
          Readable.from(bytes),
          { size: bytes.length, mimeType: 'text/plain' },
          new AbortController().signal,
        );
    const row = await db.client.storedFile.create({
      data: {
        spaceId: user.spaces[0]!.id,
        ownerUserId: user.id,
        objectKey: key,
        filename: 'sensitive-original.txt',
        mimeType: 'text/plain',
        expectedSize: bytes.length,
        actualSize: bytes.length,
        sha256: evidence.sha256,
        status: 'READY',
        uploadExpiresAt: new Date(Date.now() + 3600000),
        completedAt: new Date(),
      },
    });
    return { row, user, bytes };
  }
  it('enforces realm, permissions, strict inputs and recent MFA on real Admin HTTP routes', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/operations/health')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/operations/health')
      .set('Cookie', cookie(first))
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/admin/operations/backups')
      .set('Cookie', cookie(reviewer))
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/operations/jobs/run')
      .set('Cookie', cookie(first))
      .set('Origin', 'http://localhost:3000')
      .set('Idempotency-Key', randomUUID())
      .send({ queue: 'planner.delivery', reason: 'unsafe' })
      .expect(400);
    await db.client.adminSession.update({
      where: { id: first.sessionId },
      data: { mfaVerifiedAt: new Date(Date.now() - 301000) },
    });
    await request(app.getHttpServer())
      .post('/api/v1/admin/operations/backups')
      .set('Cookie', cookie(first))
      .set('Origin', 'http://localhost:3000')
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'old MFA' })
      .expect(403);
    await db.client.adminSession.update({
      where: { id: first.sessionId },
      data: { mfaVerifiedAt: new Date() },
    });
  });
  it('returns strict policy response contracts through the authenticated HTTP dispatcher', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/operations/policies')
      .set('Cookie', cookie(first))
      .expect(200);
    expect(list.body.items).toHaveLength(4);
    const preview = await request(app.getHttpServer())
      .post('/api/v1/admin/operations/policies/preview')
      .set('Cookie', cookie(first))
      .set('Origin', 'http://localhost:3000')
      .set('Idempotency-Key', randomUUID())
      .send({
        section: 'STORAGE',
        revision: 1,
        value: {
          mode: 'WARN',
          minimumFreeBytes: 1073741824,
          graceMinutes: 60,
          cleanupAgeHours: 24,
        },
        reason: 'Review storage admission',
      })
      .expect(200);
    expect(preview.body).toMatchObject({
      section: 'STORAGE',
      state: 'PREVIEW',
      expectedRevision: 1,
    });
    expect(preview.body).not.toHaveProperty('requesterAdminId');
  });
  it('preserves the cleanup FK catalog and immutable policy previews with revision conflict handling', async () => {
    await db.client.$transaction((tx) => assertSharedCleanupCatalog(tx));
    const input = {
      section: 'JOBS',
      revision: 1,
      value: {
        sweepMinutes: 2,
        sweep: { completedDays: 7, failedDays: 7 },
        outbox: { completedDays: 7, failedDays: 7 },
        delivery: { completedDays: 7, failedDays: 7 },
        dead: { completedDays: 7, failedDays: 7 },
      },
      reason: 'Reviewed recurring cadence',
    };
    const a = await policies.preview(
        await cmd(first, 'admin.operations.policy.publish', input),
        input,
      ),
      b = await policies.preview(
        await cmd(first, 'admin.operations.policy.publish', input),
        input,
      );
    await expect(
      db.client.adminOperationalPolicyDraft.update({
        where: { id: a.id },
        data: { value: {} },
      }),
    ).rejects.toThrow();
    await policies.publish(
      await cmd(first, 'admin.operations.policy.publish', { id: a.id }),
      a.id,
    );
    await expect(
      policies.publish(
        await cmd(first, 'admin.operations.policy.publish', { id: b.id }),
        b.id,
      ),
    ).rejects.toHaveProperty('status', 409);
    await queue.applyPolicy();
    const schedule = await box.query(
      `SELECT cron FROM ${queueSchema}.schedule WHERE name='planner.sweep'`,
    );
    expect(schedule.rows[0].cron).toBe('*/2 * * * *');
  });
  it('durably dispatches exactly one safe manual run across receipt replays and worker restart', async () => {
    const key = randomUUID(),
      input = { queue: 'planner.sweep' },
      firstRun = await queue.request(
        await cmd(first, 'admin.jobs.run', input, key),
        'RUN',
        'planner.sweep',
        null,
      ),
      duplicate = await queue.request(
        await cmd(first, 'admin.jobs.run', input, key),
        'RUN',
        'planner.sweep',
        null,
      );
    expect(duplicate.id).toBe(firstRun.id);
    await queue.consume();
    expect(await queue.consume()).toBe(false);
    expect(await queue.detail(firstRun.id)).toMatchObject({
      state: 'SUCCEEDED',
      attempts: 1,
    });
    const jobs = await queue.list({ limit: 100 });
    expect(jobs.items.filter((j) => j.id === firstRun.id)).toHaveLength(1);
    expect(JSON.stringify(jobs)).not.toMatch(/"data"|"output"|password|token/);
    await expect(
      queue.request(
        await cmd(first, 'admin.jobs.run'),
        'RUN',
        'planner.delivery',
        null,
      ),
    ).rejects.toHaveProperty('status', 409);
  });
  it('rechecks queued control authority and refuses active cancel or changed job attempts', async () => {
    const run = await queue.request(
      await cmd(first, 'admin.jobs.run'),
      'RUN',
      'planner.outbox',
      null,
    );
    await db.client.adminUser.update({
      where: { id: first.id },
      data: { active: false },
    });
    await queue.consume();
    expect(await queue.detail(run.id)).toMatchObject({
      state: 'FAILED',
      failureCode: 'AUTHORITY_REVOKED',
    });
    await db.client.adminUser.update({
      where: { id: first.id },
      data: { active: true },
    });
    const job = randomUUID();
    await box.query(
      `INSERT INTO ${queueSchema}.job (id,name,state,retry_limit,retry_count) VALUES ($1,'planner.outbox','failed',3,3)`,
      [job],
    );
    const retry = await queue.request(
      await cmd(first, 'admin.jobs.retry'),
      'RETRY',
      'planner.outbox',
      job,
    );
    await box.query(`UPDATE ${queueSchema}.job SET retry_count=4 WHERE id=$1`, [
      job,
    ]);
    await queue.consume();
    expect(await queue.detail(retry.id)).toMatchObject({
      state: 'FAILED',
      failureCode: 'JOB_STATE_CHANGED',
    });
    await box.query(
      `UPDATE ${queueSchema}.job SET state='active' WHERE id=$1`,
      [job],
    );
    await expect(
      queue.request(
        await cmd(first, 'admin.jobs.cancel'),
        'CANCEL',
        'planner.outbox',
        job,
      ),
    ).rejects.toHaveProperty('status', 409);
  });
  it('serializes concurrent idempotent queue requests before dispatch', async () => {
    const key = randomUUID(),
      input = { queue: 'planner.outbox' },
      a = await cmd(first, 'admin.jobs.run', input, key),
      b = await cmd(first, 'admin.jobs.run', input, key);
    const results = await Promise.all([
      queue.request(a, 'RUN', 'planner.outbox', null),
      queue.request(b, 'RUN', 'planner.outbox', null),
    ]);
    expect(results[0]!.id).toBe(results[1]!.id);
    await queue.consume();
    expect(
      (
        await box.query(`SELECT id FROM ${queueSchema}.job WHERE id=$1::uuid`, [
          results[0]!.id,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it('permits only three extra retry budgets and keeps delivery/deletion work out of the control catalog', async () => {
    const job = randomUUID();
    await box.query(
      `INSERT INTO ${queueSchema}.job (id,name,state,retry_limit,retry_count) VALUES ($1,'planner.sweep','failed',3,3)`,
      [job],
    );
    for (let n = 0; n < 3; n++) {
      const control = await queue.request(
        await cmd(first, 'admin.jobs.retry'),
        'RETRY',
        'planner.sweep',
        job,
      );
      await queue.consume();
      expect(await queue.detail(control.id)).toMatchObject({
        state: 'SUCCEEDED',
      });
      await box.query(
        `UPDATE ${queueSchema}.job SET state='failed',retry_count=retry_limit WHERE id=$1`,
        [job],
      );
    }
    await expect(
      queue.request(
        await cmd(first, 'admin.jobs.retry'),
        'RETRY',
        'planner.sweep',
        job,
      ),
    ).rejects.toHaveProperty('status', 409);
  });
  it('streams only the exact authorized private file and audits successful/denied targets without filenames or bytes', async () => {
    const f = await fileFixture(),
      base = '/api/v1/admin/operations/storage/files/' + f.row.id + '/content';
    const read = await request(app.getHttpServer())
      .get(base)
      .query({
        spaceId: f.row.spaceId,
        reason: 'Approved operational inspection',
      })
      .set('Cookie', cookie(first))
      .expect(200);
    expect(read.headers['content-disposition']).toBe(
      'attachment; filename="private-file"',
    );
    expect(read.headers['cache-control']).toBe('no-store');
    expect(read.body).toEqual(f.bytes);
    const evidence = await db.client.adminAuditEvidence.findFirstOrThrow({
      where: { requestId: read.headers['x-request-id'] as string },
    });
    expect(evidence).toMatchObject({
      actorId: first.id,
      targetFileId: f.row.id,
      targetSpaceId: f.row.spaceId,
      outcome: 'SUCCEEDED',
    });
    expect(JSON.stringify(evidence)).not.toContain('sensitive-original');
    expect(JSON.stringify(evidence)).not.toContain('Private file fixture');
    await request(app.getHttpServer())
      .get(base)
      .query({ spaceId: randomUUID() })
      .set('Cookie', cookie(first))
      .expect(404);
    await request(app.getHttpServer())
      .get(base)
      .query({ spaceId: f.row.spaceId })
      .set('Cookie', cookie(reviewer))
      .expect(403);
    await request(app.getHttpServer())
      .get(base)
      .query({ spaceId: f.row.spaceId, scopeId: randomUUID() })
      .set('Cookie', cookie(first))
      .expect(404);
  });
  it('refuses closed custody, deleted files, revoked sessions and replay quarantine even for Super Admin', async () => {
    const f = await fileFixture(),
      q = PrivateFileQuerySchema.parse({ spaceId: f.row.spaceId });
    await db.client.space.update({
      where: { id: f.row.spaceId },
      data: { accessClosedAt: new Date() },
    });
    await expect(
      storage.privateFile(
        await cmd(first, 'admin.storage.private_files.read'),
        f.row.id,
        q,
      ),
    ).rejects.toHaveProperty('status', 404);
    await db.client.space.update({
      where: { id: f.row.spaceId },
      data: { accessClosedAt: null },
    });
    const gate = app.get(PrivacyGate);
    gate.quarantine();
    await expect(
      storage.privateFile(
        await cmd(first, 'admin.storage.private_files.read'),
        f.row.id,
        q,
      ),
    ).rejects.toHaveProperty('status', 403);
    gate.release();
    const revoked = await operator(),
      command = await cmd(revoked, 'admin.storage.private_files.read');
    await db.client.adminSession.delete({ where: { id: revoked.sessionId } });
    await expect(
      storage.privateFile(command, f.row.id, q),
    ).rejects.toHaveProperty('status', 403);
    await db.client.storedFile.update({
      where: { id: f.row.id },
      data: {
        status: 'DELETED',
        deletedAt: new Date(),
        revision: { increment: 1 },
      },
    });
    await expect(
      storage.privateFile(
        await cmd(first, 'admin.storage.private_files.read'),
        f.row.id,
        q,
      ),
    ).rejects.toHaveProperty('status', 404);
  });
  it('rechecks metadata while streaming and never bypasses scan/hash integrity', async () => {
    const f = await fileFixture(),
      q = PrivateFileQuerySchema.parse({ spaceId: f.row.spaceId }),
      result = await storage.privateFile(
        await cmd(first, 'admin.storage.private_files.read'),
        f.row.id,
        q,
      );
    await db.client.storedFile.update({
      where: { id: f.row.id },
      data: {
        status: 'DELETED',
        deletedAt: new Date(),
        revision: { increment: 1 },
      },
    });
    await expect(buffer(result.stream)).rejects.toThrow();
    const broken = await fileFixture(),
      configRoot = (await import('../../src/bootstrap/configuration.module.js'))
        .APP_CONFIG,
      config = app.get<{ STORAGE_ROOT: string }>(configRoot);
    await fs.writeFile(
      path.join(config.STORAGE_ROOT, broken.row.objectKey + '.blob'),
      'tampered',
    );
    await expect(
      storage.privateFile(
        await cmd(first, 'admin.storage.private_files.read'),
        broken.row.id,
        PrivateFileQuerySchema.parse({ spaceId: broken.row.spaceId }),
      ),
    ).rejects.toHaveProperty('status', 503);
    const failed = await request(app.getHttpServer())
      .get(
        '/api/v1/admin/operations/storage/files/' + broken.row.id + '/content',
      )
      .query({ spaceId: broken.row.spaceId })
      .set('Cookie', cookie(first))
      .expect(503);
    expect(
      await db.client.adminAuditEvidence.findFirstOrThrow({
        where: { requestId: failed.headers['x-request-id'] as string },
      }),
    ).toMatchObject({
      targetFileId: broken.row.id,
      outcome: 'FAILED',
      actorId: first.id,
    });
  });
  it('aggregates metadata by exact scope and blocks capacity admission without deleting existing files', async () => {
    const f = await fileFixture(),
      usage = await storage.usage({
        groupBy: 'SPACE',
        spaceId: f.row.spaceId,
        limit: 25,
      });
    expect(usage.total.files).toBe(1);
    expect(usage.total.bytes).toBe(String(f.bytes.length));
    const prior = await db.client.adminOperationalPolicy.findUniqueOrThrow({
      where: { section: 'STORAGE' },
    });
    await db.client.adminOperationalPolicy.update({
      where: { section: 'STORAGE' },
      data: {
        value: {
          mode: 'BLOCK',
          minimumFreeBytes: Number.MAX_SAFE_INTEGER,
          graceMinutes: 1,
          cleanupAgeHours: 24,
        },
      },
    });
    await expect(
      app
        .get<StoragePort>(STORAGE_PORT)
        .write(
          randomUUID(),
          randomUUID(),
          Readable.from('x'),
          { size: 1, mimeType: 'text/plain' },
          new AbortController().signal,
        ),
    ).rejects.toHaveProperty('status', 503);
    expect(
      (
        await db.client.storedFile.findUniqueOrThrow({
          where: { id: f.row.id },
        })
      ).status,
    ).toBe('READY');
    await db.client.adminOperationalPolicy.update({
      where: { section: 'STORAGE' },
      data: { value: prior.value as Prisma.InputJsonValue },
    });
    const admission = app.get(StorageAdmission);
    await admission.check(9999999999999999n);
  });
  it('previews aged orphans only, protects live/export references and revalidates cleanup with idempotency', async () => {
    const f = await fileFixture(),
      configRoot = (await import('../../src/bootstrap/configuration.module.js'))
        .APP_CONFIG,
      root = app.get<{ STORAGE_ROOT: string }>(configRoot).STORAGE_ROOT;
    const orphan = randomUUID(),
      fresh = randomUUID(),
      old = new Date(Date.now() - 25 * 3600000);
    await fs.writeFile(path.join(root, orphan + '.blob'), 'orphan');
    await fs.utimes(path.join(root, orphan + '.blob'), old, old);
    await fs.writeFile(path.join(root, fresh + '.blob'), 'fresh');
    await fs.utimes(path.join(root, f.row.objectKey + '.blob'), old, old);
    const preview = await storage.preview(
      await cmd(first, 'admin.storage.cleanup'),
    );
    expect(preview.candidates).toBe(1);
    await expect(
      storage.cleanup(
        await cmd(first, 'admin.storage.cleanup'),
        preview.id,
        'f'.repeat(64),
      ),
    ).rejects.toHaveProperty('status', 409);
    const key = randomUUID(),
      input = { id: preview.id, fingerprint: preview.fingerprint };
    expect(
      (
        await storage.cleanup(
          await cmd(first, 'admin.storage.cleanup', input, key),
          preview.id,
          preview.fingerprint,
        )
      ).removed,
    ).toBe(1);
    expect(
      (
        await storage.cleanup(
          await cmd(first, 'admin.storage.cleanup', input, key),
          preview.id,
          preview.fingerprint,
        )
      ).removed,
    ).toBe(1);
    await expect(
      fs.lstat(path.join(root, orphan + '.blob')),
    ).rejects.toHaveProperty('code', 'ENOENT');
    await expect(
      fs.lstat(path.join(root, f.row.objectKey + '.blob')),
    ).resolves.toBeDefined();
    await expect(
      fs.lstat(path.join(root, fresh + '.blob')),
    ).resolves.toBeDefined();
  });
  it('captures backup retention, deduplicates pending manual requests and never reports queued work as success', async () => {
    const key = randomUUID(),
      a = await backups.request(
        await cmd(first, 'admin.backups.request', {}, key),
      ),
      b = await backups.request(
        await cmd(first, 'admin.backups.request', {}, key),
      );
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({
      state: 'QUEUED',
      retentionDays: 30,
      encrypted: false,
      offHostVerified: false,
    });
    await expect(
      backups.request(await cmd(second, 'admin.backups.request')),
    ).rejects.toHaveProperty('status', 409);
    await db.client.adminAuditRetentionPolicy.update({
      where: { category: 'BACKUP' },
      data: { days: 1, revision: { increment: 1 } },
    });
    expect((await backups.detail(a.id)).retentionDays).toBe(30);
    const run = await backups.claim('backup', a.id);
    await expect(backups.claim('backup', a.id)).rejects.toHaveProperty(
      'status',
      409,
    );
    await db.client.adminBackupRun.update({
      where: { id: a.id },
      data: {
        state: 'FAILED',
        failureCode: 'SYNTHETIC_FAILURE',
        completedAt: new Date(),
      },
    });
    expect(run.operatorLeaseId).toBeTruthy();
  });
  async function verifiedBackupFixture() {
    const now = new Date();
    // Synthetic request evidence only; cryptography tests exercise real bytes.
    return db.client.adminBackupRun.create({
      data: {
        state: 'VERIFIED',
        origin: 'MANUAL',
        actorAdminId: first.id,
        retentionDays: 1,
        policyRevision: 1,
        encrypted: true,
        offHostVerified: true,
        manifestDigest: 'a'.repeat(64),
        expiresAt: new Date(+now + 3600000),
        completedAt: now,
        evidence: { fixture: true },
      },
    });
  }
  it('requires a distinct current restore approver and exact expiring target review', async () => {
    const backup = await verifiedBackupFixture(),
      input = {
        backupId: backup.id,
        mode: 'DRILL' as const,
        targetReference: 'isolated-p3',
      },
      review = await backups.restore(
        await cmd(first, 'admin.restores.request', input),
        input,
      );
    await expect(
      backups.approve(
        await cmd(first, 'admin.restores.approve'),
        review.id,
        input,
      ),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      backups.approve(await cmd(second, 'admin.restores.approve'), review.id, {
        ...input,
        targetReference: 'other',
      }),
    ).rejects.toHaveProperty('status', 409);
    await backups.approve(
      await cmd(second, 'admin.restores.approve'),
      review.id,
      input,
    );
    await db.client.adminUser.update({
      where: { id: second.id },
      data: { active: false },
    });
    await expect(backups.claim('restore', review.id)).rejects.toHaveProperty(
      'status',
      403,
    );
    await db.client.adminUser.update({
      where: { id: second.id },
      data: { active: true },
    });
    const claimed = await backups.claim('restore', review.id);
    expect(claimed.state).toBe('RUNNING');
    await expect(backups.claim('restore', review.id)).rejects.toHaveProperty(
      'status',
      409,
    );
    await expect(
      db.client.adminRestoreRun.update({
        where: { id: review.id },
        data: { state: 'VERIFIED', completedAt: new Date() },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.adminRestoreRun.update({
        where: { id: review.id },
        data: { targetReference: 'swapped' },
      }),
    ).rejects.toThrow();
  });
  it('keeps incidents deduplicated with immutable notes, configurable silence and recovery history', async () => {
    const health = app.get(SystemHealth);
    await db.client.adminOperationalPolicy.update({
      where: { section: 'HEALTH' },
      data: {
        value: {
          rules: [
            {
              rule: 'WORKER',
              enabled: true,
              severity: 'WARNING',
              threshold: 1,
              repeatMinutes: 5,
              channels: ['IN_APP'],
              silencedUntil: new Date(Date.now() + 60000).toISOString(),
            },
          ],
        },
      },
    });
    await health.detect();
    await health.detect();
    const incidents = await health.incidents({ limit: 100, state: 'OPEN' });
    expect(incidents.items).toHaveLength(1);
    expect(incidents.items[0]!.lastNotifiedAt).toBeNull();
    const note = await health.note(
      await cmd(first, 'admin.health.notes'),
      incidents.items[0]!.id,
      'Investigated worker heartbeat',
    );
    await expect(
      db.client.adminOperationalNote.update({
        where: { id: note.id },
        data: { note: 'rewritten' },
      }),
    ).rejects.toThrow();
    await db.client.adminOperationalHeartbeat.upsert({
      where: { name: 'worker' },
      create: { name: 'worker', instanceId: randomUUID() },
      update: { lastSeenAt: new Date() },
    });
    await health.detect();
    expect(
      (await health.incidents({ limit: 100, state: 'RECOVERED' })).items,
    ).toHaveLength(1);
    expect(
      (await health.notes(note.incidentId, { limit: 25 })).items,
    ).toHaveLength(1);
  });
  it('validates Shared file custody through Spaces without creating Admin membership', async () => {
    const f = await fileFixture(),
      session = await db.client.authSession.create({
        data: {
          userId: f.user.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
    const version = 'p3-shared-files',
      rule = {
        retainAfterClosureSeconds: 0,
        audience: ['OWNER', 'ADMIN'],
        exportAuthority: ['OWNER'],
        disposalAction: 'PURGE',
      };
    await db.client.sharedRetentionPolicy.create({
      data: {
        version,
        approvalReference: 'SYNTHETIC-P3',
        configuration: {
          policyVersion: version,
          approvalReference: 'SYNTHETIC-P3',
          accountableOperator: 'fixture',
          applicableContexts: ['PROJECT', 'TEAM', 'COMPANY'],
          marketScope: 'test only',
          sharedRecoverySeconds: 604800,
          classRules: {
            workContent: rule,
            commentsHistory: rule,
            filesDerivatives: rule,
            exports: rule,
            accessAuditLifecycle: rule,
          },
          obligations: [],
          holds: [],
          backupPolicyReference: 'independent fixture',
        },
      },
    });
    const id = randomUUID();
    await app.get(TeamsService).create(
      {
        userId: f.user.id,
        sessionId: session.id,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
      { id, title: 'P3 shared fixture', retentionPolicyVersion: version },
      randomUUID(),
    );
    const actor = await db.client.sharedActor.findFirstOrThrow({
        where: { spaceId: id, userId: f.user.id, state: 'ACTIVE' },
      }),
      objectKey = randomUUID(),
      bytes = Buffer.from('Shared private file');
    const evidence = await app
      .get<StoragePort>(STORAGE_PORT)
      .write(
        objectKey,
        randomUUID(),
        Readable.from(bytes),
        { size: bytes.length, mimeType: 'text/plain' },
        new AbortController().signal,
      );
    const file = await db.client.storedFile.create({
      data: {
        spaceId: id,
        scopeId: id,
        ownerUserId: null,
        createdByActorId: actor.id,
        objectKey,
        filename: 'shared-private.txt',
        mimeType: 'text/plain',
        expectedSize: bytes.length,
        actualSize: bytes.length,
        sha256: evidence.sha256,
        status: 'READY',
        completedAt: new Date(),
        uploadExpiresAt: new Date(Date.now() + 3600000),
      },
    });
    const result = await storage.privateFile(
      await cmd(first, 'admin.storage.private_files.read'),
      file.id,
      PrivateFileQuerySchema.parse({ spaceId: id, scopeId: id }),
    );
    expect(await buffer(result.stream)).toEqual(bytes);
    await expect(
      storage.privateFile(
        await cmd(first, 'admin.storage.private_files.read'),
        file.id,
        PrivateFileQuerySchema.parse({ spaceId: id }),
      ),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      storage.privateFile(
        await cmd(first, 'admin.storage.private_files.read'),
        file.id,
        PrivateFileQuerySchema.parse({ spaceId: f.row.spaceId, scopeId: id }),
      ),
    ).rejects.toHaveProperty('status', 404);
    const companyId = randomUUID();
    await app.get(CompaniesService).create(
      {
        userId: f.user.id,
        sessionId: session.id,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
      {
        id: companyId,
        title: 'P3 Company root fixture',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    const companyActor = await db.client.sharedActor.findFirstOrThrow({
        where: { spaceId: companyId, userId: f.user.id, state: 'ACTIVE' },
      }),
      companyKey = randomUUID();
    await app
      .get<StoragePort>(STORAGE_PORT)
      .write(
        companyKey,
        randomUUID(),
        Readable.from(bytes),
        { size: bytes.length, mimeType: 'text/plain' },
        new AbortController().signal,
      );
    const companyFile = await db.client.storedFile.create({
      data: {
        spaceId: companyId,
        scopeId: companyId,
        ownerUserId: null,
        createdByActorId: companyActor.id,
        objectKey: companyKey,
        filename: 'company-private.txt',
        mimeType: 'text/plain',
        expectedSize: bytes.length,
        actualSize: bytes.length,
        sha256: evidence.sha256,
        status: 'READY',
        completedAt: new Date(),
        uploadExpiresAt: new Date(Date.now() + 3600000),
      },
    });
    const companyResult = await storage.privateFile(
      await cmd(first, 'admin.storage.private_files.read'),
      companyFile.id,
      PrivateFileQuerySchema.parse({ spaceId: companyId, scopeId: companyId }),
    );
    expect(await buffer(companyResult.stream)).toEqual(bytes);
    expect(
      await db.client.sharedActor.count({ where: { adminUserId: first.id } }),
    ).toBe(0);
  });
  it('expires terminal results by outcome and preserves pending work and domain evidence', async () => {
    const row = await db.client.adminOperationalPolicy.findUniqueOrThrow({
        where: { section: 'JOBS' },
      }),
      policy = JSON.parse(JSON.stringify(row.value)) as {
        sweep: { completedDays: number; failedDays: number };
      };
    policy.sweep.failedDays = 14;
    await db.client.adminOperationalPolicy.update({
      where: { section: 'JOBS' },
      data: { value: policy },
    });
    const oldComplete = randomUUID(),
      oldFailed = randomUUID(),
      pending = randomUUID();
    for (const [id, state] of [
      [oldComplete, 'completed'],
      [oldFailed, 'failed'],
      [pending, 'created'],
    ])
      await box.query(
        `INSERT INTO ${queueSchema}.job (id,name,state,created_on,completed_on) VALUES ($1,'planner.sweep',$2::${queueSchema}.job_state,now()-interval '8 days',CASE WHEN $2='created' THEN NULL ELSE now()-interval '8 days' END)`,
        [id, state],
      );
    expect(await queue.expireResults()).toBe(1);
    const remaining = await box.query(
      `SELECT id FROM ${queueSchema}.job WHERE id=ANY($1::uuid[])`,
      [[oldComplete, oldFailed, pending]],
    );
    expect(remaining.rows.map((r) => r.id).sort()).toEqual(
      [oldFailed, pending].sort(),
    );
  });
  it('refuses cleanup if a previewed orphan becomes referenced and protects export publication identities', async () => {
    const f = await fileFixture(),
      configToken = (
        await import('../../src/bootstrap/configuration.module.js')
      ).APP_CONFIG,
      root = app.get<{ STORAGE_ROOT: string }>(configToken).STORAGE_ROOT,
      orphan = randomUUID(),
      exportKey = randomUUID(),
      old = new Date(Date.now() - 25 * 3600000);
    for (const key of [orphan, exportKey]) {
      await fs.writeFile(path.join(root, key + '.blob'), 'orphan');
      await fs.utimes(path.join(root, key + '.blob'), old, old);
    }
    await db.client.userExportJob.create({
      data: {
        ownerUserId: f.user.id,
        spaceId: f.row.spaceId,
        objectKey: exportKey,
      },
    });
    const preview = await storage.preview(
      await cmd(first, 'admin.storage.cleanup'),
    );
    expect(preview.candidates).toBe(1);
    await db.client.storedFile.create({
      data: {
        ownerUserId: f.user.id,
        spaceId: f.row.spaceId,
        objectKey: orphan,
        filename: 'new-reference.txt',
        mimeType: 'text/plain',
        expectedSize: 6,
        uploadExpiresAt: new Date(Date.now() + 3600000),
      },
    });
    await expect(
      storage.cleanup(
        await cmd(first, 'admin.storage.cleanup'),
        preview.id,
        preview.fingerprint,
      ),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      fs.lstat(path.join(root, orphan + '.blob')),
    ).resolves.toBeDefined();
    await expect(
      fs.lstat(path.join(root, exportKey + '.blob')),
    ).resolves.toBeDefined();
  });
  it('fails interrupted operator leases without retrying or clearing independent maintenance', async () => {
    const id = randomUUID(),
      control = app.get(OperationsControl);
    await control.write('VERIFYING', id);
    const run = await db.client.adminBackupRun.create({
      data: {
        origin: 'MANUAL',
        actorAdminId: first.id,
        state: 'RUNNING',
        retentionDays: 1,
        policyRevision: 1,
        operatorLeaseId: randomUUID(),
        leaseUntil: new Date(Date.now() - 1000),
      },
    });
    await backups.failExpiredLeases();
    expect(await backups.detail(run.id)).toMatchObject({
      state: 'FAILED',
      failureCode: 'OPERATOR_LEASE_EXPIRED',
    });
    await expect(backups.claim('backup', run.id)).rejects.toHaveProperty(
      'status',
      409,
    );
    expect(await control.status()).toMatchObject({
      state: 'VERIFYING',
      runId: id,
    });
    await control.write('READY', id);
  });
  it('keeps verified backup evidence immutable and rejects wrong runs or widened deadlines', async () => {
    const requested = await backups.request(
        await cmd(first, 'admin.backups.request'),
      ),
      run = await backups.claim('backup', requested.id),
      operator = app.get(BackupOperator),
      now = new Date();
    const bundle = {
      version: 1 as const,
      runId: requested.id,
      capturedAt: now.toISOString(),
      expiresAt: new Date(+now + 3600000).toISOString(),
      manifestDigest: 'a'.repeat(64),
      artifacts: (
        [
          'planner.dump',
          'files.tar.gz',
          'control.tar.gz',
          'manifest.json',
        ] as const
      ).map((name) => ({
        name,
        sha256: 'b'.repeat(64),
        encryptedSha256: 'c'.repeat(64),
        iv: '0'.repeat(24),
        tag: '0'.repeat(32),
      })),
    };
    await expect(
      operator.backupVerified(
        requested.id,
        run.operatorLeaseId!,
        { ...bundle, runId: randomUUID() },
        'SYNTHETIC',
      ),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      operator.backupVerified(
        requested.id,
        run.operatorLeaseId!,
        { ...bundle, expiresAt: new Date(+now + 31 * 86400000).toISOString() },
        'SYNTHETIC',
      ),
    ).rejects.toHaveProperty('status', 409);
    await operator.backupVerified(
      requested.id,
      run.operatorLeaseId!,
      bundle,
      'SYNTHETIC-P3-PORT-ONLY',
    );
    expect(await backups.detail(requested.id)).toMatchObject({
      state: 'VERIFIED',
      encrypted: true,
      offHostVerified: true,
      capturedAt: now.toISOString(),
    });
    await expect(
      db.client.adminBackupRun.update({
        where: { id: requested.id },
        data: { evidence: { rewritten: true } },
      }),
    ).rejects.toThrow();
  });
  it('keeps Admin control available during independent maintenance and never reopens at a countdown', async () => {
    const control = app.get(OperationsControl),
      id = randomUUID();
    await control.write('RESTORING', id);
    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/health/ready').expect(503);
    await request(app.getHttpServer())
      .get('/api/v1/admin/operations/health')
      .set('Cookie', cookie(first))
      .expect(200);
    await request(app.getHttpServer()).get('/api/v1/me').expect(503);
    expect(await control.status()).toMatchObject({
      state: 'RESTORING',
      runId: id,
    });
    await control.write('READY', id);
  });
});
