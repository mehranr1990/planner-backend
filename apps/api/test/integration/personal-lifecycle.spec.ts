import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as c from '@mehran/api-contracts';
import { testApplication } from '../support/application.js';
import { cleanupFixtureIdentities } from '../support/fixture-cleanup.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { PersonalLifecycle } from '../../src/modules/account/public/index.js';
import { ErasureControl } from '../../src/platform/storage/public/index.js';
import { PrivacyGate } from '../../src/platform/authorization/privacy-gate.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { STORAGE_PORT } from '../../src/platform/storage/storage.port.js';
import type { StoragePort } from '../../src/platform/storage/storage.port.js';
type Actor = { id: string; spaceId: string; cookie: string; email: string };
describe('P1-12 private export and staged account erasure', () => {
  let app: NestExpressApplication,
    db: DatabaseService,
    a: Actor,
    b: Actor,
    lifecycle: PersonalLifecycle;
  const users: string[] = [],
    jobs: string[] = [],
    databaseUrl = isolatedTestDatabaseUrl(process.env),
    origin = 'http://localhost:3000',
    password = 'test-only-lifecycle-password-123!',
    policyVersion = 'personal-local-v1';
  const call = (who: Actor, method: 'get' | 'post' | 'patch', path: string) =>
    request(app.getHttpServer())
      [method]('/api/v1' + path)
      .set('Cookie', who.cookie)
      .set('Origin', origin);
  async function identity() {
    const email = `life-${randomUUID()}@example.test`;
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'Lifecycle fixture' })
      .expect(200);
    const id = signup.body.user.id as string;
    users.push(id);
    const link = new URL(
      app.get(IdentityMailService).latestForTest(email, 'verify-email')!.url,
    );
    link.searchParams.delete('callbackURL');
    await request(app.getHttpServer())
      .get(link.pathname + link.search)
      .expect(200);
    const cookie = await login(email);
    const space = await db.client.space.findFirstOrThrow({
      where: { ownerUserId: id },
    });
    return { id, spaceId: space.id, cookie, email };
  }
  async function login(email: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email, password })
      .expect(200);
    return (response.headers['set-cookie'] as unknown as string[])
      .map((v) => v.split(';')[0])
      .join('; ');
  }
  const content = (text: string) => ({
    format: 'MARKDOWN',
    version: 1,
    content: text,
  });
  const create = async (who: Actor, path: string, input: object) =>
    (
      await call(who, 'post', path)
        .set('Idempotency-Key', randomUUID())
        .send(input)
        .expect(201)
    ).body as Record<string, unknown>;
  async function deletion(who: Actor) {
    const settings = await db.client.userSettings.findUniqueOrThrow({
        where: { userId: who.id },
      }),
      value = c.DeletionChallengeSchema.parse(
        await create(who, '/me/deletion-request', {
          password,
          accountRevision: settings.revision,
          retentionAcknowledged: true,
          policyVersion,
        }),
      );
    jobs.push(value.job.id);
    return value;
  }
  beforeAll(async () => {
    app = await testApplication({
      databaseUrl,
      environment: { PERSONAL_ERASURE_POLICY_VERSION: policyVersion },
    });
    db = app.get(DatabaseService);
    lifecycle = app.get(PersonalLifecycle);
    a = await identity();
    b = await identity();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (db) {
      await db.client.accountDeletionJob.deleteMany({
        where: { id: { in: jobs } },
      });
      await cleanupFixtureIdentities(databaseUrl, { ids: users });
    }
    await app?.close();
  });
  let exported: zExport;
  const attachmentBytes = Buffer.from('Private export attachment bytes');
  let attachmentId: string;
  async function upload(who: Actor) {
    const initiated = c.StoredFileSchema.parse(
      (
        await call(who, 'post', '/files/uploads')
          .send({
            filename: 'private.txt',
            mimeType: 'text/plain',
            expectedSize: attachmentBytes.length,
            sha256: createHash('sha256').update(attachmentBytes).digest('hex'),
          })
          .expect(201)
      ).body,
    );
    await call(who, 'post', '/files/' + initiated.id + '/complete')
      .set('Content-Type', 'application/octet-stream')
      .send(attachmentBytes)
      .expect(200);
    return initiated.id;
  }
  type zExport = ReturnType<typeof c.ExportJobSchema.parse>;
  it('requires fresh provider password and scoped idempotency for export requests', async () => {
    await call(a, 'post', '/me/export')
      .set('Idempotency-Key', randomUUID())
      .send({ password: 'incorrect' })
      .expect(403);
    const key = randomUUID();
    exported = c.ExportJobSchema.parse(
      (
        await call(a, 'post', '/me/export')
          .set('Idempotency-Key', key)
          .send({ password })
          .expect(201)
      ).body,
    );
    const replay = c.ExportJobSchema.parse(
      (
        await call(a, 'post', '/me/export')
          .set('Idempotency-Key', key)
          .send({ password })
          .expect(201)
      ).body,
    );
    expect(replay.id).toBe(exported.id);
    expect(
      await db.client.userExportJob.count({ where: { ownerUserId: a.id } }),
    ).toBe(1);
    await call(b, 'get', '/me/exports/' + exported.id).expect(404);
  });
  it('exports complete retained histories without credentials and verifies private download proof', async () => {
    attachmentId = await upload(a);
    const note = await create(a, '/notes', {
      title: 'Export private note',
      content: content('Original retained text'),
    });
    await call(a, 'patch', '/notes/' + String(note.id))
      .set('If-Match', '"1"')
      .send({ content: content('Corrected retained text') })
      .expect(200);
    await create(b, '/notes', {
      title: 'Foreign excluded note',
      content: content('Foreign private body'),
    });
    await create(a, '/journal/entries', {
      localDate: '2026-10-28',
      content: content('Private journal export'),
    });
    expect(await lifecycle.consume()).toBe(true);
    exported = c.ExportJobSchema.parse(
      (await call(a, 'get', '/me/exports/' + exported.id).expect(200)).body,
    );
    expect(exported.state).toBe('READY');
    expect(exported.downloadProof).toBeTruthy();
    await call(a, 'get', '/me/exports/' + exported.id + '/download').expect(
      403,
    );
    const download = await call(
      a,
      'get',
      '/me/exports/' + exported.id + '/download',
    )
      .set('X-Export-Proof', exported.downloadProof!)
      .expect(200);
    const text = JSON.stringify(download.body);
    expect(text).toContain('Original retained text');
    expect(text).toContain('Corrected retained text');
    expect(text).toContain('Private journal export');
    expect(text).not.toContain('Foreign private body');
    expect(text).not.toContain(password);
    expect(text).not.toContain('objectKey');
    expect(text).not.toContain('authaccounts');
    expect(text).toContain('/attachments/' + attachmentId);
    const attachment = await call(
      a,
      'get',
      '/me/exports/' + exported.id + '/attachments/' + attachmentId,
    )
      .set('X-Export-Proof', exported.downloadProof!)
      .expect(200);
    expect(attachment.text).toBe(attachmentBytes.toString());
    await call(b, 'get', '/me/exports/' + exported.id + '/download')
      .set('X-Export-Proof', exported.downloadProof!)
      .expect(404);
    await call(
      a,
      'get',
      '/me/exports/' + exported.id + '/attachments/' + randomUUID(),
    )
      .set('X-Export-Proof', exported.downloadProof!)
      .expect(404);
  });
  it('rejects corrupted export bytes and attachment deletion without serving replacements', async () => {
    const storage = app.get<StoragePort>(STORAGE_PORT),
      spy = vi
        .spyOn(storage, 'open')
        .mockRejectedValueOnce(new Error('Corrupt artifact'));
    await call(a, 'get', '/me/exports/' + exported.id + '/download')
      .set('X-Export-Proof', exported.downloadProof!)
      .expect(500);
    spy.mockRestore();
    await request(app.getHttpServer())
      .delete('/api/v1/files/' + attachmentId)
      .set('Cookie', a.cookie)
      .set('Origin', origin)
      .expect(204);
    await call(
      a,
      'get',
      '/me/exports/' + exported.id + '/attachments/' + attachmentId,
    )
      .set('X-Export-Proof', exported.downloadProof!)
      .expect(404);
  });
  it('expires export proofs and artifacts without returning private bytes', async () => {
    await db.client.userExportJob.update({
      where: { id: exported.id },
      data: {
        expiresAt: new Date(Date.now() - 1000),
        completedAt: new Date(Date.now() - 86400000),
      },
    });
    expect(
      c.ExportJobSchema.parse(
        (await call(a, 'get', '/me/exports/' + exported.id).expect(200)).body,
      ).state,
    ).toBe('EXPIRED');
    await call(a, 'get', '/me/exports/' + exported.id + '/download')
      .set('X-Export-Proof', exported.downloadProof!)
      .expect(404);
    await lifecycle.consume();
    expect(
      (
        await db.client.userExportJob.findUniqueOrThrow({
          where: { id: exported.id },
        })
      ).state,
    ).toBe('EXPIRED');
  });
  it('retries an interrupted export without exposing partial files or losing attempt identities', async () => {
    const id = c.ExportJobSchema.parse(
        await create(a, '/me/export', { password }),
      ).id,
      storage = app.get<StoragePort>(STORAGE_PORT);
    const fault = vi
      .spyOn(storage, 'write')
      .mockRejectedValueOnce(new Error('Interrupted export publication'));
    await lifecycle.consume();
    fault.mockRestore();
    const failed = await db.client.userExportJob.findUniqueOrThrow({
      where: { id },
    });
    expect(failed.state).toBe('QUEUED');
    expect(failed.artifactHash).toBeNull();
    expect(failed.attempts).toBe(1);
    await call(a, 'get', '/me/exports/' + id + '/download').expect(404);
    await db.client.userExportJob.update({
      where: { id },
      data: { nextAt: new Date(0) },
    });
    await lifecycle.consume();
    const ready = await db.client.userExportJob.findUniqueOrThrow({
      where: { id },
    });
    expect(ready.state).toBe('READY');
    expect(ready.attempts).toBe(2);
    expect(ready.artifactKeys).toContain(failed.objectKey);
    expect(ready.artifactKeys).toContain(failed.attemptKey);
    await db.client.userExportJob.update({
      where: { id },
      data: {
        expiresAt: new Date(Date.now() - 1000),
        completedAt: new Date(Date.now() - 86400000),
      },
    });
    await lifecycle.consume();
    expect(
      (await db.client.userExportJob.findUniqueOrThrow({ where: { id } }))
        .artifactKeys,
    ).toEqual([]);
  });
  let challenge: ReturnType<typeof c.DeletionChallengeSchema.parse>;
  it('checks revision, acknowledgement and staged confirmation before closure', async () => {
    await call(a, 'post', '/me/deletion-request')
      .set('Idempotency-Key', randomUUID())
      .send({
        password,
        accountRevision: 999,
        policyVersion,
        retentionAcknowledged: true,
      })
      .expect(409);
    challenge = await deletion(a);
    expect(challenge.job.state).toBe('PENDING');
    await call(a, 'get', '/notes').expect(200);
    await call(a, 'post', '/me/deletion-request/confirm')
      .set('X-Deletion-Proof', 'invalid')
      .send({ jobId: challenge.job.id, revision: 1 })
      .expect(404);
    await call(a, 'post', '/me/deletion-request/confirm')
      .set('X-Deletion-Proof', challenge.confirmationProof)
      .send({ jobId: challenge.job.id, revision: 99 })
      .expect(409);
  });
  it('revokes sessions, closes private APIs and keeps source data intact during grace', async () => {
    const confirmed = c.DeletionJobSchema.parse(
      (
        await call(a, 'post', '/me/deletion-request/confirm')
          .set('X-Deletion-Proof', challenge.confirmationProof)
          .send({ jobId: challenge.job.id, revision: 1 })
          .expect(201)
      ).body,
    );
    expect(confirmed.state).toBe('WAITING');
    expect(confirmed.backupExpiryDeadline).toBeNull();
    expect(
      new Date(confirmed.eraseAfter!).getTime() -
        new Date(
          (
            await db.client.accountDeletionJob.findUniqueOrThrow({
              where: { id: challenge.job.id },
            })
          ).confirmedAt!,
        ).getTime(),
    ).toBe(7 * 86400000);
    expect(await db.client.authSession.count({ where: { userId: a.id } })).toBe(
      0,
    );
    await call(a, 'get', '/notes').expect(401);
    await call(a, 'get', '/sync/status').expect(401);
    expect(await db.client.note.count({ where: { spaceId: a.spaceId } })).toBe(
      2,
    );
    const replay = c.DeletionJobSchema.parse(
      (
        await call(a, 'post', '/me/deletion-request/confirm')
          .set('X-Deletion-Proof', challenge.confirmationProof)
          .send({ jobId: challenge.job.id, revision: 1 })
          .expect(201)
      ).body,
    );
    expect(replay.id).toBe(confirmed.id);
    await lifecycle.consume();
    expect(await db.client.user.count({ where: { id: a.id } })).toBe(1);
  });
  it('requires recovery proof and current password to cancel without restoring old sessions', async () => {
    await call(a, 'get', '/me/deletion-request?jobId=' + challenge.job.id)
      .set('X-Deletion-Recovery', 'invalid')
      .expect(404);
    await call(a, 'post', '/me/deletion-request/cancel')
      .set('X-Deletion-Recovery', challenge.recoveryCapability)
      .send({ jobId: challenge.job.id, password: 'incorrect' })
      .expect(403);
    expect(
      (await db.client.space.findUniqueOrThrow({ where: { id: a.spaceId } }))
        .accessClosedAt,
    ).not.toBeNull();
    const response = c.DeletionJobSchema.parse(
      (
        await call(a, 'post', '/me/deletion-request/cancel')
          .set('X-Deletion-Recovery', challenge.recoveryCapability)
          .send({ jobId: challenge.job.id, password })
          .expect(201)
      ).body,
    );
    expect(response.state).toBe('CANCELED');
    expect(await db.client.authSession.count({ where: { userId: a.id } })).toBe(
      0,
    );
    await call(a, 'get', '/notes').expect(401);
    a.cookie = await login(a.email);
    await call(a, 'get', '/notes').expect(200);
  });
  it('purges only the confirmed closed owner after grace, including identity and source references', async () => {
    const task = await create(b, '/tasks', { title: 'Erase owned task' });
    const fileId = await upload(b);
    const snapshot = {
      user: await db.client.user.findUniqueOrThrow({ where: { id: b.id } }),
      space: await db.client.space.findUniqueOrThrow({
        where: { id: b.spaceId },
      }),
      settings: await db.client.userSettings.findUniqueOrThrow({
        where: { userId: b.id },
      }),
      accounts: await db.client.authAccount.findMany({
        where: { userId: b.id },
      }),
      sessions: await db.client.authSession.findMany({
        where: { userId: b.id },
      }),
      task: await db.client.task.findUniqueOrThrow({
        where: { id: String(task.id) },
      }),
      file: await db.client.storedFile.findUniqueOrThrow({
        where: { id: fileId },
      }),
    };
    await create(b, '/notes', {
      title: 'Erase linked note',
      taskId: task.id,
      content: content('Erase body'),
    });
    await create(b, '/capture', {
      type: 'EXPENSE',
      text: 'Expense draft',
      voiceFileId: null,
    });
    const habit = await create(b, '/habits', {
      title: 'Erased habit',
      type: 'CHECKBOX',
      unit: 'COUNT',
      target: '1',
      timezone: 'UTC',
      schedule: {
        version: 1,
        startDate: '2024-01-01',
        rule: { kind: 'DAILY' },
      },
    });
    await create(b, '/habits/' + String(habit.id) + '/entries', {
      habitRevision: 1,
      localDate: '2024-01-01',
      action: 'LOG',
    });
    const goal = await create(b, '/goals', {
      title: 'Erased metric goal',
      horizon: 'SHORT_TERM',
    });
    const metric = (
      await call(b, 'post', '/goals/' + String(goal.id) + '/metrics')
        .set('If-Match', '"1"')
        .set('Idempotency-Key', randomUUID())
        .send({
          title: 'Exact metric',
          unit: 'COUNT',
          baseline: '0',
          target: '10',
          current: '5',
        })
        .expect(201)
    ).body as { id: string };
    await call(b, 'patch', '/goals/' + String(goal.id))
      .set('If-Match', '"2"')
      .send({ progressMode: 'METRIC', metricId: metric.id })
      .expect(200);
    const account = await create(b, '/finance/accounts', {
        name: 'Erased account',
        currency: 'USD',
      }),
      draft = await create(b, '/capture', {
        type: 'EXPENSE',
        text: 'Converted erased expense',
      });
    await create(b, '/finance/transactions/from-capture', {
      captureId: draft.id,
      captureRevision: 1,
      expense: {
        type: 'EXPENSE',
        accountId: account.id,
        amount: '3.21',
        occurredAt: '2024-03-10T12:00:00Z',
        timezone: 'UTC',
      },
    });
    const next = await deletion(b);
    await call(b, 'post', '/me/deletion-request/confirm')
      .set('X-Deletion-Proof', next.confirmationProof)
      .send({ jobId: next.job.id, revision: 1 })
      .expect(201);
    await db.client.accountDeletionJob.update({
      where: { id: next.job.id },
      data: {
        eraseAfter: new Date(Date.now() - 1000),
        nextAt: new Date(Date.now() - 1000),
        policyVersion: 'unapproved-policy',
      },
    });
    await lifecycle.consume();
    expect(
      (
        await db.client.accountDeletionJob.findUniqueOrThrow({
          where: { id: next.job.id },
        })
      ).state,
    ).toBe('BLOCKED_POLICY');
    expect(await db.client.user.count({ where: { id: b.id } })).toBe(1);
    await db.client.accountDeletionJob.update({
      where: { id: next.job.id },
      data: { policyVersion, nextAt: new Date(0) },
    });
    const storage = app.get<StoragePort>(STORAGE_PORT),
      fault = vi
        .spyOn(storage, 'remove')
        .mockRejectedValueOnce(new Error('Interrupted private file cleanup'));
    await lifecycle.consume();
    fault.mockRestore();
    expect(
      (
        await db.client.accountDeletionJob.findUniqueOrThrow({
          where: { id: next.job.id },
        })
      ).failureCode,
    ).toBe('ERASURE_INCOMPLETE');
    expect(await db.client.user.count({ where: { id: b.id } })).toBe(1);
    await db.client.accountDeletionJob.update({
      where: { id: next.job.id },
      data: { nextAt: new Date(0) },
    });
    await lifecycle.consume();
    expect(
      (
        await db.client.accountDeletionJob.findUniqueOrThrow({
          where: { id: next.job.id },
        })
      ).progress,
    ).toEqual({ fileAfter: fileId });
    await lifecycle.consume();
    const job = await db.client.accountDeletionJob.findUniqueOrThrow({
      where: { id: next.job.id },
    });
    expect(job.failureCode).toBeNull();
    expect(job.state).toBe('ERASED');
    expect(job.ownerUserId).toBeNull();
    expect(job.spaceId).toBeNull();
    expect(await db.client.user.count({ where: { id: b.id } })).toBe(0);
    expect(await db.client.task.count({ where: { spaceId: b.spaceId } })).toBe(
      0,
    );
    expect(await db.client.note.count({ where: { spaceId: a.spaceId } })).toBe(
      2,
    );
    expect(
      (await app.get(ErasureControl).records()).find(
        (v) => v.jobId === next.job.id,
      )?.state,
    ).toBe('ERASED');
    // Restore this fixture's earlier consistent identity/Task/file subset only.
    // The independent current erasure namespace is deliberately left untouched.
    await db.client.$transaction(async (tx) => {
      await tx.user.create({ data: snapshot.user });
      for (const row of snapshot.accounts)
        await tx.authAccount.create({ data: row });
      for (const row of snapshot.sessions)
        await tx.authSession.create({ data: row });
      await tx.space.create({ data: snapshot.space });
      await tx.userSettings.create({
        data: {
          ...snapshot.settings,
          planningAvailability:
            snapshot.settings.planningAvailability ?? Prisma.DbNull,
        },
      });
      await tx.task.create({ data: snapshot.task });
      await tx.storedFile.create({ data: snapshot.file });
    });
    await storage.write(
      snapshot.file.objectKey,
      randomUUID(),
      Readable.from(attachmentBytes),
      {
        size: attachmentBytes.length,
        mimeType: 'text/plain',
        sha256: snapshot.file.sha256,
      },
      new AbortController().signal,
    );
    expect(await lifecycle.verifyControl()).toBe(false);
    await call(b, 'get', '/tasks').expect(403);
    expect(await lifecycle.restoreReplay()).toBe(false); // Bounded file batch first.
    expect(await lifecycle.restoreReplay()).toBe(true);
    expect(await db.client.user.count({ where: { id: b.id } })).toBe(0);
    await expect(
      storage.open(snapshot.file.objectKey, {
        size: attachmentBytes.length,
        sha256: snapshot.file.sha256!,
      }),
    ).rejects.toThrow();
    expect(await db.client.note.count({ where: { spaceId: a.spaceId } })).toBe(
      2,
    );
  });
  it('quarantines missing restore evidence and reopens only after verified control state', async () => {
    const control = app.get(ErasureControl),
      spy = vi
        .spyOn(control, 'records')
        .mockRejectedValueOnce(new Error('Missing independent checkpoint'));
    expect(await lifecycle.verifyControl()).toBe(false);
    expect(() => app.get(PrivacyGate).assert()).toThrow();
    await call(a, 'get', '/notes').expect(403);
    spy.mockRestore();
    expect(await lifecycle.verifyControl()).toBe(true);
    await call(a, 'get', '/notes').expect(200);
  });
});
