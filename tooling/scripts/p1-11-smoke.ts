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
  TaskSchema,
  RewardPreferencesSchema,
  RewardProgressSchema,
  AchievementsSchema,
  InsightResponseSchema,
} from '../../packages/api-contracts/dist/index.js';
import { installJobSchema } from '../../apps/api/src/platform/jobs/schema.ts';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const databaseUrl = isolatedTestDatabaseUrl(process.env),
  pool = new Pool({ connectionString: databaseUrl });
const root = path.resolve('.tools/p1-11');
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
  const email = `p111-smoke-${randomUUID()}@example.test`,
    password = 'test-only-compiled-goals-123!';
  const signup = await call('/api/v1/auth/sign-up/email', 'POST', {
    email,
    password,
    name: 'Compiled analytics fixture',
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

async function waitXp(cookie: string, totalXp: string) {
  for (let n = 0; n < 300; n++) {
    const progress = await parsed(
      await call('/api/v1/rewards/progress', 'GET', undefined, cookie),
      200,
      RewardProgressSchema,
    );
    if (
      progress.totalXp === totalXp &&
      progress.freshness.pending === 0 &&
      progress.freshness.failed === 0
    )
      return progress;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Compiled reward catch-up did not reach expected XP');
}
try {
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
  let prefs = await parsed(
    await call('/api/v1/rewards/preferences', 'GET', undefined, a),
    200,
    RewardPreferencesSchema,
  );
  assert.equal(prefs.enabled, false);
  prefs = await parsed(
    await call(
      '/api/v1/rewards/preferences',
      'PATCH',
      { enabled: true, displayAchievements: true },
      a,
      prefs.revision,
      randomUUID(),
    ),
    200,
    RewardPreferencesSchema,
  );
  const t = await parsed(
    await call(
      '/api/v1/tasks',
      'POST',
      { title: 'private-smoke-source', dueAt: '2024-03-10T15:00:00Z' },
      a,
      undefined,
      randomUUID(),
    ),
    201,
    TaskSchema,
  );
  const key = randomUUID();
  const done = await parsed(
    await call(
      '/api/v1/tasks/' + t.id + '/complete',
      'POST',
      {},
      a,
      t.revision,
      key,
    ),
    200,
    TaskSchema,
  );
  await stop();
  await start();
  const query = '?from=2024-03-09&to=2024-03-12&timezone=America%2FNew_York';
  const insights = await parsed(
    await call('/api/v1/insights/tasks' + query, 'GET', undefined, a),
    200,
    InsightResponseSchema,
  );
  assert.equal(
    insights.current.metrics.find((m) => m.id === 'tasks.completion_rate')
      ?.value,
    '100.000000',
  );
  assert.equal(
    (
      await call(
        '/api/v1/tasks/' + t.id + '/complete',
        'POST',
        {},
        a,
        t.revision,
        key,
      )
    ).status,
    409,
  );
  const persisted = await parsed(
    await call('/api/v1/tasks/' + t.id, 'GET', undefined, a),
    200,
    TaskSchema,
  );
  assert.deepEqual(persisted, done);
  assert.equal(
    (
      await call(
        '/api/v1/insights/overview' + query + '&includeMood=true',
        'GET',
        undefined,
        a,
      )
    ).status,
    400,
  );
  const foreign = await parsed(
    await call('/api/v1/insights/tasks' + query, 'GET', undefined, b),
    200,
    InsightResponseSchema,
  );
  assert.equal(
    foreign.current.metrics.find((m) => m.id === 'tasks.completed')?.value,
    '0',
  );
  await startWorker();
  await waitXp(a, '10');
  await stopWorker();
  const reopened = await parsed(
    await call(
      '/api/v1/tasks/' + t.id + '/reopen',
      'POST',
      {},
      a,
      done.revision,
      randomUUID(),
    ),
    200,
    TaskSchema,
  );
  await parsed(
    await call(
      '/api/v1/tasks/' + t.id + '/complete',
      'POST',
      {},
      a,
      reopened.revision,
      randomUUID(),
    ),
    200,
    TaskSchema,
  );
  await startWorker();
  await waitXp(a, '10');
  await stopWorker();
  await stop();
  await start();
  await startWorker();
  const progress = await waitXp(a, '10');
  assert.equal(progress.items.length, 1);
  const badges = await parsed(
    await call('/api/v1/rewards/achievements', 'GET', undefined, a),
    200,
    AchievementsSchema,
  );
  assert(badges.items.find((x) => x.code === 'FIRST_TASK')?.unlockedAt);
  const recalcKey = randomUUID(),
    recalc = await call(
      '/api/v1/rewards/achievements/recalculate',
      'POST',
      { limit: 1 },
      a,
      prefs.revision,
      recalcKey,
    );
  assert.equal(recalc.status, 200);
  const body = await recalc.json();
  await stop();
  await start();
  const recalculated = await call(
    '/api/v1/rewards/achievements/recalculate',
    'POST',
    { limit: 1 },
    a,
    prefs.revision,
    recalcKey,
  );
  assert.equal(recalculated.status, 200);
  assert.deepEqual(await recalculated.json(), body);
  assert.equal(
    (
      await parsed(
        await call('/api/v1/rewards/progress', 'GET', undefined, b),
        200,
        RewardProgressSchema,
      )
    ).totalXp,
    '0',
  );
  const counts = await pool.query(
    'SELECT count(*)::int AS n,sum(points)::text AS total FROM "XpLedger" WHERE "spaceId"=(SELECT id FROM "Space" WHERE "ownerUserId"=$1)',
    [userIds[0]],
  );
  assert.equal(counts.rows[0].n, 1);
  assert.equal(counts.rows[0].total, '10');
  const queued = await pool.query('SELECT data,output FROM ' + schema + '.job');
  assert(!JSON.stringify(queued.rows).includes('private-smoke-source'));
  await fs.writeFile(
    path.join(root, 'compiled-smoke.json'),
    JSON.stringify(
      {
        status: 'PASS',
        compiledApi: true,
        compiledWorker: true,
        apiRestartPersistence: true,
        workerRestartCatchUp: true,
        idempotentReplayAfterRestart: true,
        semanticRewardDeduplication: true,
        ownerIsolation: true,
        privateOptInRejected: true,
        totalXp: '10',
        ledgerRows: 1,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: compiled analytics API, API/worker restarts, durable XP catch-up, semantic deduplication, idempotent replay, badge persistence and ownership/privacy.\n',
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
