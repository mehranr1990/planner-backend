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
import {
  TaskIdSchema,
  ReminderSchema,
  NotificationPageSchema,
  NotificationPreferenceSchema,
} from '../../packages/api-contracts/dist/index.js';
import { installJobSchema } from '../../apps/api/src/platform/jobs/schema.ts';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const databaseUrl = isolatedTestDatabaseUrl(process.env),
  pool = new Pool({ connectionString: databaseUrl });
const root = path.resolve('.tools/p1-10');
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
      JOBS_SCHEMA: schema,
      NOTIFICATION_EMAIL_ENABLED: 'true',
      PUSH_MODE: 'sink',
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
) {
  const id = randomUUID();
  requestIds.push(id);
  return fetch(origin + route, {
    method,
    headers: {
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
  const email = `p110-smoke-${randomUUID()}@example.test`,
    password = 'test-only-compiled-goals-123!';
  const signup = await call('/api/v1/auth/sign-up/email', 'POST', {
    email,
    password,
    name: 'Compiled notification fixture',
  });
  assert.equal(signup.status, 200);
  const parsed = (await signup.json()) as { user: { id: unknown } };
  userIds.push(TaskIdSchema.parse(parsed.user.id));
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
      JOBS_SCHEMA: schema,
      JOBS_POLL_SECONDS: '1',
      NOTIFICATION_EMAIL_ENABLED: 'true',
      PUSH_MODE: 'sink',
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
async function waitDelivery(reminderId: string, state: string) {
  for (let n = 0; n < 300; n++) {
    const rows = (
      await pool.query(
        'SELECT state FROM "NotificationDelivery" WHERE "reminderId"=$1',
        [reminderId],
      )
    ).rows;
    if (rows.some((r) => r.state === state)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Compiled worker delivery did not reach ' + state);
}
try {
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM "Reminder"')).rows[0].n,
    0,
    'Smoke requires an isolated test database without other reminder fixtures',
  );
  assert.equal(
    (await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema]))
      .rowCount,
    0,
  );
  ownedSchema = true;
  await installJobSchema(databaseUrl, schema);
  await start();
  const a = await identity(),
    b = await identity();
  const post = (
      route: string,
      body: unknown,
      revision?: number,
      key = randomUUID(),
    ) => call('/api/v1' + route, 'POST', body, a, revision, key),
    get = (route: string, cookie = a) =>
      call('/api/v1' + route, 'GET', undefined, cookie);
  const key = randomUUID(),
    body = {
      title: 'private-smoke-label-not-for-push',
      body: 'private-smoke-finance-journal-content',
      rule: {
        version: 1,
        kind: 'ABSOLUTE',
        at: new Date(Date.now() - 30000).toISOString(),
      },
    },
    first = await parsed(
      await post('/reminders', body, undefined, key),
      201,
      ReminderSchema,
    );
  await startWorker();
  await waitDelivery(first.id, 'DELIVERED');
  const inbox = await parsed(
    await get('/notifications'),
    200,
    NotificationPageSchema,
  );
  assert(inbox.items.some((n) => n.reminderId === first.id));
  assert.equal((await get('/reminders/' + first.id, b)).status, 404);
  await stopWorker();
  await stop();
  await start();
  const persisted = await parsed(
    await get('/reminders/' + first.id),
    200,
    ReminderSchema,
  );
  assert.equal(persisted.id, first.id);
  assert.deepEqual(
    await parsed(
      await post('/reminders', body, undefined, key),
      201,
      ReminderSchema,
    ),
    first,
  );
  const prefs = await parsed(
    await get('/notifications/preferences'),
    200,
    NotificationPreferenceSchema,
  );
  await parsed(
    await call(
      '/api/v1/notifications/preferences',
      'PATCH',
      { email: true },
      a,
      prefs.revision,
      randomUUID(),
    ),
    200,
    NotificationPreferenceSchema,
  );
  const email = await parsed(
      await post('/reminders', { ...body, channels: ['EMAIL'] }),
      201,
      ReminderSchema,
    ),
    old = await parsed(
      await post('/reminders', {
        rule: {
          version: 1,
          kind: 'ABSOLUTE',
          at: new Date(Date.now() - 8 * 86400000).toISOString(),
        },
      }),
      201,
      ReminderSchema,
    );
  const recovery = await parsed(
      await post('/reminders', body),
      201,
      ReminderSchema,
    ),
    unknown = await parsed(
      await post('/reminders', { ...body, channels: ['EMAIL'] }),
      201,
      ReminderSchema,
    );
  await pool.query(
    'UPDATE "NotificationDelivery" SET state=$1,"leaseToken"=$2,"leaseUntil"=now()-interval \'1 second\' WHERE "reminderId"=$3',
    ['PROCESSING', randomUUID(), recovery.id],
  );
  await pool.query(
    'UPDATE "NotificationDelivery" SET state=$1,"leaseToken"=$2,"leaseUntil"=now()-interval \'1 second\',"networkStartedAt"=now(),attempts=1 WHERE "reminderId"=$3',
    ['PROCESSING', randomUUID(), unknown.id],
  );
  const gap = await parsed(
    await post('/reminders', {
      timezoneMode: 'FIXED',
      timezone: 'America/New_York',
      rule: {
        version: 1,
        kind: 'LOCAL',
        startDate: '2024-03-10',
        time: '02:30',
      },
    }),
    201,
    ReminderSchema,
  );
  await startWorker();
  await waitDelivery(email.id, 'DELIVERED');
  await waitDelivery(recovery.id, 'DELIVERED');
  await waitDelivery(unknown.id, 'AMBIGUOUS');
  await waitDelivery(old.id, 'EXPIRED');
  await waitDelivery(gap.id, 'SKIPPED');
  const files = await fs.readdir(path.join(fixture, 'notifications'));
  assert.equal(files.length, 1);
  const payload = await fs.readFile(
    path.join(fixture, 'notifications', files[0]!),
    'utf8',
  );
  assert(!payload.includes('private-smoke'));
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM "Notification" WHERE "reminderId"=$1',
        [first.id],
      )
    ).rows[0].n,
    1,
  );
  await stopWorker();
  await startWorker();
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(
    (await fs.readdir(path.join(fixture, 'notifications'))).length,
    1,
  );
  await waitDelivery(unknown.id, 'AMBIGUOUS');
  const queued = (
    await pool.query('SELECT data,output FROM ' + schema + '.job')
  ).rows;
  assert(!JSON.stringify(queued).includes('private-smoke'));
  const audit = (
    await pool.query(
      'SELECT * FROM "SecurityAuditEvent" WHERE "actorUserId"=ANY($1::uuid[])',
      [userIds],
    )
  ).rows;
  assert(!JSON.stringify(audit).includes('private-smoke'));
  await fs.writeFile(
    path.join(root, 'compiled-smoke.json'),
    JSON.stringify(
      {
        status: 'PASS',
        runtime: process.versions.node,
        postgres: (await pool.query('SHOW server_version')).rows[0]
          .server_version,
        compiledApi: true,
        compiledWorker: true,
        apiRestartPersistence: true,
        workerRestartBackfill: true,
        idempotentReplayAfterRestart: true,
        preNetworkLeaseRecovery: true,
        ambiguousNeverResent: true,
        expiredHistory: true,
        dstGapHistory: true,
        privateSink: true,
        ownerIsolation: true,
        durableQueueSchema: schema,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: compiled API/worker restart, durable backfill, idempotent replay, lease recovery, ambiguous acceptance, expiry/DST history, private delivery and owner isolation.\n',
  );
} finally {
  await stopWorker();
  await stop();
  await pool.query(
    'DELETE FROM "SecurityAuditEvent" WHERE "requestId"=ANY($1::uuid[]) OR "actorUserId"=ANY($2::uuid[])',
    [requestIds, userIds],
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
