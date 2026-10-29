import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import * as c from '../../packages/api-contracts/dist/index.js';
import { ErasureControl } from '../../apps/api/dist/platform/storage/erasure-control.js';
import { parseEnvironment } from '../../apps/api/src/bootstrap/environment.ts';
import { installJobSchema } from '../../apps/api/src/platform/jobs/schema.ts';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const databaseUrl = isolatedTestDatabaseUrl(process.env),
  pool = new Pool({ connectionString: databaseUrl });
const root = path.resolve('.tools/p1-12');
await fs.mkdir(root, { recursive: true });
const fixture = await fs.mkdtemp(path.join(root, 'smoke-')),
  mail = path.join(fixture, 'mail'),
  storage = path.join(fixture, 'private');
const listener = net.createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = (listener.address() as AddressInfo).port;
await new Promise<void>((resolve) => listener.close(() => resolve()));
const origin = `http://127.0.0.1:${port}`,
  secret = randomBytes(48).toString('base64url'),
  userIds: string[] = [],
  requestIds: string[] = [];
const schema = 'planner_jobs_test_' + randomUUID().replaceAll('-', '');
let worker: ChildProcess | undefined;
let ownedSchema = false;
let child: ChildProcess | undefined;
async function start() {
  child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: secret,
      LOG_LEVEL: 'silent',
      MAIL_MODE: 'sink',
      MAIL_SINK_DIR: mail,
      STORAGE_ROOT: storage,
      PERSONAL_ERASURE_POLICY_VERSION: 'personal-local-v1',
      JOBS_SCHEMA: schema,
      NOTIFICATION_EMAIL_ENABLED: 'false',
      PUSH_MODE: 'disabled',
      NOTIFICATION_SINK_DIR: path.join(fixture, 'notifications'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout?.on('data', (value) => {
    output += String(value);
  });
  child.stderr?.on('data', (value) => {
    output += String(value);
  });
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      if ((await fetch(origin + '/health/ready')).status === 200) return;
    } catch {
      /* Wait for this fixture process to bind. */
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await fs.writeFile(path.join(root, 'smoke-startup.log'), output);
  throw new Error(
    'Compiled API startup failed; inspect ignored local evidence.',
  );
}
async function stop() {
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, 'exit');
  }
}
async function call(
  route: string,
  method = 'GET',
  body?: unknown,
  cookie?: string,
  revision?: number,
  key?: string,
  proofs: Record<string, string> = {},
) {
  const id = randomUUID();
  requestIds.push(id);
  return fetch(origin + route, {
    method,
    headers: {
      ...proofs,
      Origin: origin,
      'X-Request-Id': id,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(revision ? { 'If-Match': `"${revision}"` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function identity() {
  const email = `p112-smoke-${randomUUID()}@example.test`,
    password = 'test-only-compiled-lifecycle-123!';
  const signup = await call('/api/v1/auth/sign-up/email', 'POST', {
    email,
    password,
    name: 'Compiled lifecycle fixture',
  });
  assert.equal(signup.status, 200);
  const parsed = (await signup.json()) as { user: { id: unknown } };
  userIds.push(c.TaskIdSchema.parse(parsed.user.id));
  let message: { url: string } | undefined;
  for (const name of await fs.readdir(mail)) {
    const value = JSON.parse(
      await fs.readFile(path.join(mail, name), 'utf8'),
    ) as { to: string; url: string };
    if (value.to === email && typeof value.url === 'string') message = value;
  }
  assert(message);
  const url = new URL(message.url);
  url.searchParams.delete('callbackURL');
  assert.equal((await call(url.pathname + url.search)).status, 200);
  const login = await call('/api/v1/auth/sign-in/email', 'POST', {
    email,
    password,
  });
  assert.equal(login.status, 200);
  return login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}
async function parsed<T>(
  response: Response,
  status: number,
  schema: { parse(value: unknown): T },
): Promise<T> {
  assert.equal(response.status, status);
  return schema.parse(await response.json());
}

async function startWorker() {
  worker = spawn(process.execPath, ['apps/api/dist/worker.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: secret,
      LOG_LEVEL: 'silent',
      MAIL_MODE: 'sink',
      MAIL_SINK_DIR: mail,
      STORAGE_ROOT: storage,
      PERSONAL_ERASURE_POLICY_VERSION: 'personal-local-v1',
      JOBS_SCHEMA: schema,
      JOBS_POLL_SECONDS: '1',
      NOTIFICATION_EMAIL_ENABLED: 'false',
      PUSH_MODE: 'disabled',
      NOTIFICATION_SINK_DIR: path.join(fixture, 'notifications'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  worker.stdout?.on('data', (v) => {
    output += String(v);
  });
  worker.stderr?.on('data', (v) => {
    output += String(v);
  });
  for (let n = 0; n < 300; n++) {
    if (output.includes('Planner notification worker ready')) return;
    if (worker.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await fs.writeFile(path.join(root, 'smoke-worker-startup.log'), output);
  throw new Error('Compiled worker startup failed; ignored evidence retained.');
}
async function stopWorker() {
  if (worker && worker.exitCode === null) {
    worker.kill();
    await once(worker, 'exit');
  }
}

const deletionIds: string[] = [];
const password = 'test-only-compiled-lifecycle-123!';
async function waitExport(cookie: string, id: string) {
  for (let n = 0; n < 10; n++) {
    const value = await parsed(
      await call('/api/v1/me/exports/' + id, 'GET', undefined, cookie),
      200,
      c.ExportJobSchema,
    );
    if (value.state === 'READY') return value;
    assert.notEqual(value.state, 'FAILED');
    await new Promise((r) => setTimeout(r, 6000));
  }
  throw new Error('Compiled export worker did not finish');
}
try {
  assert.equal(
    (await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema]))
      .rowCount,
    0,
  );
  ownedSchema = true;
  await installJobSchema(databaseUrl, schema);
  await new ErasureControl(
    parseEnvironment({
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: secret,
      STORAGE_ROOT: storage,
    }),
  ).initialize();
  await start();
  const a = await identity(),
    b = await identity();
  const state = await parsed(
    await call('/api/v1/sync/status', 'GET', undefined, a),
    200,
    c.SyncStatusSchema,
  );
  const command = {
      clientMutationId: randomUUID(),
      baseRevision: 0,
      operation: 'TASK_CREATE',
      body: { title: 'Compiled offline source' },
    },
    payload = { epoch: state.epoch, operations: [command] };
  const pushed = await parsed(
    await call('/api/v1/sync/push', 'POST', payload, a),
    201,
    c.SyncPushResultSchema,
  );
  assert.equal(pushed.results[0]!.status, 'APPLIED');
  const bytes = Buffer.from('Compiled private attachment'),
    sha256 = (await import('node:crypto'))
      .createHash('sha256')
      .update(bytes)
      .digest('hex');
  const file = await parsed(
    await call(
      '/api/v1/files/uploads',
      'POST',
      {
        filename: 'private.txt',
        mimeType: 'text/plain',
        expectedSize: bytes.length,
        sha256,
      },
      a,
    ),
    201,
    c.StoredFileSchema,
  );
  const uploaded = await fetch(
    origin + '/api/v1/files/' + file.id + '/complete',
    {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: a,
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
    },
  );
  assert.equal(uploaded.status, 200);
  const key = randomUUID(),
    job = await parsed(
      await call('/api/v1/me/export', 'POST', { password }, a, undefined, key),
      201,
      c.ExportJobSchema,
    );
  await startWorker();
  await waitExport(a, job.id);
  await stopWorker();
  await stop();
  await start();
  await startWorker();
  const ready = await waitExport(a, job.id);
  assert.equal(ready.id, job.id);
  assert.equal(
    (
      await parsed(
        await call('/api/v1/sync/push', 'POST', payload, a),
        201,
        c.SyncPushResultSchema,
      )
    ).results[0]!.status,
    'DUPLICATE',
  );
  assert.equal(
    (
      await parsed(
        await call(
          '/api/v1/me/export',
          'POST',
          { password },
          a,
          undefined,
          key,
        ),
        201,
        c.ExportJobSchema,
      )
    ).id,
    job.id,
  );
  const downloaded = await call(
    '/api/v1/me/exports/' + job.id + '/download',
    'GET',
    undefined,
    a,
    undefined,
    undefined,
    { 'X-Export-Proof': ready.downloadProof! },
  );
  assert.equal(downloaded.status, 200);
  const data = await downloaded.json();
  assert(JSON.stringify(data).includes('Compiled offline source'));
  assert(!JSON.stringify(data).includes(password));
  const attachment = await call(
    '/api/v1/me/exports/' + job.id + '/attachments/' + file.id,
    'GET',
    undefined,
    a,
    undefined,
    undefined,
    { 'X-Export-Proof': ready.downloadProof! },
  );
  assert.equal(attachment.status, 200);
  assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), bytes);
  assert.equal(
    (
      await call(
        '/api/v1/me/exports/' + job.id + '/download',
        'GET',
        undefined,
        b,
        undefined,
        undefined,
        { 'X-Export-Proof': ready.downloadProof! },
      )
    ).status,
    404,
  );
  const settings = await pool.query(
    'SELECT revision FROM "UserSettings" WHERE "userId"=$1',
    [userIds[0]],
  );
  const challenge = await parsed(
    await call(
      '/api/v1/me/deletion-request',
      'POST',
      {
        password,
        accountRevision: settings.rows[0].revision,
        retentionAcknowledged: true,
        policyVersion: 'personal-local-v1',
      },
      a,
      undefined,
      randomUUID(),
    ),
    201,
    c.DeletionChallengeSchema,
  );
  deletionIds.push(challenge.job.id);
  const confirmed = await parsed(
    await call(
      '/api/v1/me/deletion-request/confirm',
      'POST',
      { jobId: challenge.job.id, revision: 1 },
      a,
      undefined,
      undefined,
      { 'X-Deletion-Proof': challenge.confirmationProof },
    ),
    201,
    c.DeletionJobSchema,
  );
  assert.equal(confirmed.state, 'WAITING');
  assert.equal(
    (await call('/api/v1/sync/status', 'GET', undefined, a)).status,
    401,
  );
  await stopWorker();
  await stop();
  await start();
  await startWorker();
  assert.equal(
    (await call('/api/v1/me/exports/' + job.id, 'GET', undefined, a)).status,
    401,
  );
  const recovery = { 'X-Deletion-Recovery': challenge.recoveryCapability };
  const safe = await parsed(
    await call(
      '/api/v1/me/deletion-request?jobId=' + challenge.job.id,
      'GET',
      undefined,
      undefined,
      undefined,
      undefined,
      recovery,
    ),
    200,
    c.DeletionJobSchema,
  );
  assert.equal(safe.state, 'WAITING');
  const canceled = await parsed(
    await call(
      '/api/v1/me/deletion-request/cancel',
      'POST',
      { jobId: challenge.job.id, password },
      undefined,
      undefined,
      undefined,
      recovery,
    ),
    201,
    c.DeletionJobSchema,
  );
  assert.equal(canceled.state, 'CANCELED');
  // Exercise actual compiled-worker erasure only for this isolated fixture owner.
  const erasedFile = await parsed(
    await call(
      '/api/v1/files/uploads',
      'POST',
      {
        filename: 'erase.txt',
        mimeType: 'text/plain',
        expectedSize: bytes.length,
        sha256,
      },
      b,
    ),
    201,
    c.StoredFileSchema,
  );
  assert.equal(
    (
      await fetch(origin + '/api/v1/files/' + erasedFile.id + '/complete', {
        method: 'POST',
        headers: {
          Origin: origin,
          Cookie: b,
          'Content-Type': 'application/octet-stream',
        },
        body: bytes,
      })
    ).status,
    200,
  );
  const ownedObject = (
    await pool.query('SELECT "objectKey" FROM "StoredFile" WHERE id=$1', [
      erasedFile.id,
    ])
  ).rows[0].objectKey as string;
  const bRevision = (
    await pool.query('SELECT revision FROM "UserSettings" WHERE "userId"=$1', [
      userIds[1],
    ])
  ).rows[0].revision;
  const erase = await parsed(
    await call(
      '/api/v1/me/deletion-request',
      'POST',
      {
        password,
        accountRevision: bRevision,
        retentionAcknowledged: true,
        policyVersion: 'personal-local-v1',
      },
      b,
      undefined,
      randomUUID(),
    ),
    201,
    c.DeletionChallengeSchema,
  );
  deletionIds.push(erase.job.id);
  await parsed(
    await call(
      '/api/v1/me/deletion-request/confirm',
      'POST',
      { jobId: erase.job.id, revision: 1 },
      b,
      undefined,
      undefined,
      { 'X-Deletion-Proof': erase.confirmationProof },
    ),
    201,
    c.DeletionJobSchema,
  );
  await stopWorker();
  await pool.query(
    'UPDATE "AccountDeletionJob" SET "eraseAfter"=now()-interval \'1 second\',"nextAt"=now()-interval \'1 second\' WHERE id=$1 AND "ownerUserId"=$2',
    [erase.job.id, userIds[1]],
  );
  await startWorker();
  let liveErased = false;
  for (let n = 0; n < 300; n++) {
    const row = (
      await pool.query('SELECT state FROM "AccountDeletionJob" WHERE id=$1', [
        erase.job.id,
      ])
    ).rows[0];
    if (row.state === 'ERASED') {
      liveErased = true;
      break;
    }
    assert.notEqual(row.state, 'FAILED');
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(liveErased);
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS n FROM "User" WHERE id=$1', [
        userIds[1],
      ])
    ).rows[0].n,
    0,
  );
  await assert.rejects(fs.stat(path.join(storage, ownedObject + '.blob')), {
    code: 'ENOENT',
  });
  assert.equal(
    (await call('/api/v1/sync/status', 'GET', undefined, a)).status,
    401,
  );
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS n FROM "Task" WHERE id=$1', [
        pushed.results[0]!.resource!.id,
      ])
    ).rows[0].n,
    1,
  );
  await fs.writeFile(
    path.join(root, 'compiled-smoke.json'),
    JSON.stringify(
      {
        status: 'PASS',
        compiledApi: true,
        compiledWorker: true,
        restartPersistence: true,
        privateAttachmentBytes: true,
        syncReplay: true,
        exportReplay: true,
        closureAndRecoveryAfterRestart: true,
        revokedSessionsRemainInvalid: true,
        liveErasureAfterGrace: true,
        erasedPrivateBytesAbsent: true,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: compiled API/worker restart, sync and export replay, private attachment bytes, isolation, closure persistence and recovery cancellation.\n',
  );
} finally {
  await stopWorker();
  await stop();
  await pool.query(
    'DELETE FROM "SecurityAuditEvent" WHERE "requestId"=ANY($1::uuid[]) OR "actorUserId"=ANY($2::uuid[])',
    [requestIds, userIds],
  );
  await pool.query(
    'DELETE FROM "AccountDeletionJob" WHERE id=ANY($1::uuid[])',
    [deletionIds],
  );
  await pool.query('DELETE FROM "Space" WHERE "ownerUserId"=ANY($1::uuid[])', [
    userIds,
  ]);
  await pool.query('DELETE FROM "User" WHERE id=ANY($1::uuid[])', [userIds]);
  if (
    ownedSchema &&
    /^planner_jobs_test_[a-f0-9]{32}$/.test(schema) &&
    isolatedTestDatabaseUrl(process.env) === databaseUrl
  )
    await pool.query('DROP SCHEMA ' + schema + ' CASCADE');
  await pool.end();
  if (
    !fixture.startsWith(root + path.sep) ||
    !path.basename(fixture).startsWith('smoke-')
  )
    throw new Error('Refusing unsafe fixture cleanup');
  await fs.rm(fixture, { recursive: true, force: true });
}
