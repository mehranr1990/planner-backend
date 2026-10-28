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
  FocusViewSchema,
  FocusHistoryPageSchema,
  TimeEntrySchema,
  TimePageSchema,
  ProductivityTaskSchema,
  ProductivitySummarySchema,
} from '../../packages/api-contracts/dist/index.js';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const databaseUrl = isolatedTestDatabaseUrl(process.env),
  pool = new Pool({ connectionString: databaseUrl });
const root = path.resolve('.tools/p1-07');
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
  const email = `p107-smoke-${randomUUID()}@example.test`,
    password = 'test-only-compiled-goals-123!';
  const signup = await call('/api/v1/auth/sign-up/email', 'POST', {
    email,
    password,
    name: 'Compiled focus fixture',
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

try {
  await start();
  const a = await identity(),
    b = await identity();
  const post = (
    route: string,
    body: unknown,
    revision?: number,
    key = randomUUID(),
  ) => call('/api/v1' + route, 'POST', body, a, revision, key);
  async function callResult(id: string) {
    return call('/api/v1/focus/sessions/' + id, 'GET', undefined, a);
  }
  const task = await parsed(
    await post('/tasks', { title: 'Compiled existing Task' }),
    201,
    TaskSchema,
  );
  const props = await parsed(
    await call(
      '/api/v1/tasks/' + task.id + '/productivity',
      'PATCH',
      { estimatedMinutes: 45, important: true, urgent: false },
      a,
      task.revision,
    ),
    200,
    ProductivityTaskSchema,
  );
  assert.equal(props.quadrant, 'SCHEDULE');
  let session = await parsed(
    await post('/focus/sessions', {
      title: 'Compiled focus',
      taskId: task.id,
      taskRevision: props.revision,
      timezone: 'America/New_York',
    }),
    201,
    FocusViewSchema,
  );
  const act = async (s: typeof session, op: string, key = randomUUID()) =>
    parsed(
      await post('/focus/sessions/' + s.id + '/' + op, {}, s.revision, key),
      200,
      FocusViewSchema,
    );
  session = await act(session, 'start');
  await new Promise((resolve) => setTimeout(resolve, 50));
  session = await act(session, 'pause');
  assert(session.workMs > 0);
  const paused = session;
  await stop();
  await start();
  const persisted = await parsed(
    await callResult(session.id),
    200,
    FocusViewSchema,
  );
  assert.equal(persisted.revision, paused.revision);
  assert.equal(persisted.state, 'PAUSED');
  assert.equal(persisted.workMs, paused.workMs);
  assert.equal(persisted.timezone, 'America/New_York');
  session = await act(persisted, 'resume');
  await new Promise((resolve) => setTimeout(resolve, 50));
  const finishing = session,
    finishKey = randomUUID();
  session = await act(finishing, 'finish', finishKey);
  const expected =
    paused.workMs +
    Date.parse(session.recordedAt) -
    Date.parse(finishing.runningSince!);
  assert.equal(session.workMs, expected);
  const replay = await act(finishing, 'finish', finishKey);
  assert.deepEqual(replay, session);
  const time = await parsed(
    await call(
      '/api/v1/time-entries?sessionId=' + session.id,
      'GET',
      undefined,
      a,
    ),
    200,
    TimePageSchema,
  );
  assert.equal(time.items.length, 2);
  assert.equal(
    time.items.reduce((n, r) => n + r.durationMs, 0),
    expected,
  );
  assert.equal(
    (
      await call(
        '/api/v1/time-entries/' + time.items[0]!.id,
        'DELETE',
        undefined,
        a,
        1,
      )
    ).status,
    409,
  );
  let running = await act(
    await parsed(
      await post('/focus/sessions', { title: 'Restart running' }),
      201,
      FocusViewSchema,
    ),
    'start',
  );
  await stop();
  await start();
  assert.deepEqual(await act(finishing, 'finish', finishKey), session);
  const resumed = await parsed(
    await callResult(running.id),
    200,
    FocusViewSchema,
  );
  assert.equal(resumed.state, 'RUNNING');
  assert.equal(resumed.runningSince, running.runningSince);
  assert(resumed.workMs >= running.workMs);
  running = await act(resumed, 'finish');
  assert(running.workMs > 0);
  const manual = await parsed(
    await post('/time-entries', {
      startAt: '2024-03-11T03:59:59.999Z',
      endAt: '2024-03-11T04:00:00.001Z',
      note: 'Private compiled note',
      timezone: 'America/New_York',
    }),
    201,
    TimeEntrySchema,
  );
  assert.equal(manual.durationMs, 2);
  const corrected = await parsed(
    await call(
      '/api/v1/time-entries/' + manual.id,
      'PATCH',
      { endAt: '2024-03-11T04:00:00.002Z' },
      a,
      manual.revision,
    ),
    200,
    TimeEntrySchema,
  );
  assert.equal(corrected.durationMs, 3);
  const history = await parsed(
    await call(
      '/api/v1/time-entries/' + manual.id + '/history',
      'GET',
      undefined,
      a,
    ),
    200,
    TimePageSchema,
  );
  assert.equal(history.items.length, 2);
  assert.equal(history.items[0]?.durationMs, 2);
  const summary = await parsed(
    await call(
      '/api/v1/productivity/summary?from=2024-03-10&to=2024-03-12&timezone=America%2FNew_York',
      'GET',
      undefined,
      a,
    ),
    200,
    ProductivitySummarySchema,
  );
  assert.equal(summary.recordedMs, 3);
  assert.deepEqual(
    summary.days.map((d) => d.recordedMs),
    [1, 2],
  );
  assert(summary.tasks.estimatedMinutes >= 45);
  const taskAfter = await parsed(
    await call('/api/v1/tasks/' + task.id, 'GET', undefined, a),
    200,
    TaskSchema,
  );
  assert.equal(taskAfter.revision, props.revision);
  assert.equal(taskAfter.status, 'OPEN');
  const transitions = await parsed(
    await call(
      '/api/v1/focus/sessions/' + session.id + '/history',
      'GET',
      undefined,
      a,
    ),
    200,
    FocusHistoryPageSchema,
  );
  assert.deepEqual(
    transitions.items.map((r) => r.action),
    ['CREATE', 'START', 'PAUSE', 'RESUME', 'FINISH'],
  );
  assert.equal(
    (await call('/api/v1/focus/sessions/' + session.id, 'GET', undefined, b))
      .status,
    404,
  );
  assert.equal(
    (await call('/api/v1/time-entries/' + manual.id, 'GET', undefined, b))
      .status,
    404,
  );
  const audits = (
    await pool.query(
      'SELECT * FROM "SecurityAuditEvent" WHERE "actorUserId"=ANY($1::uuid[])',
      [userIds],
    )
  ).rows;
  assert(!JSON.stringify(audits).includes('Private compiled note'));
  await fs.writeFile(
    path.join(root, 'compiled-smoke.json'),
    JSON.stringify(
      {
        status: 'PASS',
        runtime: process.versions.node,
        postgres: (await pool.query('SHOW server_version')).rows[0]
          .server_version,
        pausedRestartPersistence: true,
        runningRestartPersistence: true,
        exactServerElapsedTime: true,
        uniqueTrackedEntries: true,
        receiptReplayAfterRestart: true,
        typedTransitionHistory: true,
        manualCorrectionHistory: true,
        dstMidnightSummary: true,
        taskOwnershipPreserved: true,
        crossUserDenial: true,
        safeAudit: true,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: compiled focus pause/running restart recovery, exact database-clock durations, unique tracked work, receipt replay, manual history, DST summary and owner isolation.\n',
  );
} finally {
  await stop();
  await pool.query(
    'DELETE FROM "SecurityAuditEvent" WHERE "requestId"=ANY($1::uuid[]) OR "actorUserId"=ANY($2::uuid[])',
    [requestIds, userIds],
  );
  await pool.query(
    'DELETE FROM "TimeEntry" WHERE "createdByUserId"=ANY($1::uuid[])',
    [userIds],
  );
  await pool.query(
    'DELETE FROM "FocusSession" WHERE "createdByUserId"=ANY($1::uuid[])',
    [userIds],
  );
  await pool.query('DELETE FROM "Space" WHERE "ownerUserId"=ANY($1::uuid[])', [
    userIds,
  ]);
  await pool.query('DELETE FROM "User" WHERE id=ANY($1::uuid[])', [userIds]);
  await pool.end();
  if (
    !fixture.startsWith(root + path.sep) ||
    !path.basename(fixture).startsWith('smoke-')
  )
    throw new Error('Refusing unsafe fixture cleanup');
  await fs.rm(fixture, { recursive: true, force: true });
}
