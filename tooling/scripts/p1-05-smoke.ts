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
  HabitSchema,
  HabitEntrySchema,
  HabitEntryPageSchema,
  HabitStatsSchema,
  WaterSummarySchema,
  RoutineSchema,
} from '../../packages/api-contracts/dist/index.js';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const databaseUrl = isolatedTestDatabaseUrl(process.env),
  pool = new Pool({ connectionString: databaseUrl });
const root = path.resolve('.tools/p1-05');
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
  const email = `p105-smoke-${randomUUID()}@example.test`,
    password = 'test-only-compiled-habits-123!';
  const signup = await call('/api/v1/auth/sign-up/email', 'POST', {
    email,
    password,
    name: 'Compiled habits fixture',
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
    b = await identity(),
    definition = {
      version: 1,
      startDate: '2024-01-01',
      rule: { kind: 'DAILY' },
    };
  const habit = await parsed(
    await call(
      '/api/v1/habits',
      'POST',
      {
        title: 'Compiled habit',
        type: 'CHECKBOX',
        unit: 'COUNT',
        target: '1',
        timezone: 'UTC',
        schedule: definition,
      },
      a,
      undefined,
      randomUUID(),
    ),
    201,
    HabitSchema,
  );
  const water = await parsed(
    await call(
      '/api/v1/habits',
      'POST',
      {
        title: 'Compiled water',
        type: 'QUANTITY',
        unit: 'ML',
        purpose: 'WATER',
        target: '500',
        timezone: 'UTC',
        schedule: definition,
      },
      a,
      undefined,
      randomUUID(),
    ),
    201,
    HabitSchema,
  );
  const record = async (
    id: string,
    localDate: string,
    value?: string,
    key = randomUUID(),
    habitRevision = 1,
    action = 'LOG',
  ) =>
    parsed(
      await call(
        '/api/v1/habits/' + id + '/entries',
        'POST',
        {
          habitRevision,
          localDate,
          action,
          ...(value === undefined ? {} : { value }),
        },
        a,
        undefined,
        key,
      ),
      201,
      HabitEntrySchema,
    );
  await record(habit.id, '2024-01-01');
  const toggle = await record(habit.id, '2024-01-02');
  const statsPath =
    '/api/v1/habits/' +
    habit.id +
    '/stats?from=2024-01-01&to=2024-01-03&asOfDate=2024-01-03';
  assert.equal(
    (
      await parsed(
        await call(statsPath, 'GET', undefined, a),
        200,
        HabitStatsSchema,
      )
    ).currentStreak,
    2,
  );
  const corrected = await parsed(
    await call(
      '/api/v1/habits/' + habit.id + '/entries/' + toggle.id,
      'PATCH',
      { habitRevision: 1, value: '0' },
      a,
      toggle.revision,
    ),
    200,
    HabitEntrySchema,
  );
  assert.equal(corrected.id, toggle.id);
  assert.notEqual(corrected.revisionId, toggle.revisionId);
  assert.equal(
    (
      await parsed(
        await call(statsPath, 'GET', undefined, a),
        200,
        HabitStatsSchema,
      )
    ).currentStreak,
    0,
  );
  const skip = await record(
    habit.id,
    '2024-01-03',
    undefined,
    randomUUID(),
    1,
    'SKIP',
  );
  assert.equal(skip.kind, 'SKIP');
  const paused = await parsed(
    await call(
      '/api/v1/habits/' + habit.id,
      'PATCH',
      {
        status: 'PAUSED',
        effectiveFrom: '2024-01-04',
        confirmHistoricalChange: true,
      },
      a,
      1,
    ),
    200,
    HabitSchema,
  );
  const resumed = await parsed(
    await call(
      '/api/v1/habits/' + habit.id,
      'PATCH',
      {
        status: 'ACTIVE',
        effectiveFrom: '2024-01-06',
        confirmHistoricalChange: true,
      },
      a,
      paused.revision,
    ),
    200,
    HabitSchema,
  );
  await record(
    habit.id,
    '2024-01-06',
    undefined,
    randomUUID(),
    resumed.revision,
  );
  const key = randomUUID(),
    logged = await record(water.id, '2024-01-01', '100.1', key);
  await record(water.id, '2024-01-01', '200.2');
  await record(water.id, '2024-01-01', '199.7');
  const summaryPath =
    '/api/v1/habits/water-summary?from=2024-01-01&to=2024-01-02&habitId=' +
    water.id;
  assert.equal(
    (
      await parsed(
        await call(summaryPath, 'GET', undefined, a),
        200,
        WaterSummarySchema,
      )
    ).totalML,
    '500',
  );
  const routine = await parsed(
    await call(
      '/api/v1/routines',
      'POST',
      { title: 'Ordered routine', habitIds: [habit.id, water.id] },
      a,
      undefined,
      randomUUID(),
    ),
    201,
    RoutineSchema,
  );
  const ordered = await parsed(
    await call(
      '/api/v1/routines/' + routine.id,
      'PATCH',
      { habitIds: [water.id, habit.id] },
      a,
      routine.revision,
    ),
    200,
    RoutineSchema,
  );
  assert.equal(ordered.habits[0]?.habitId, water.id);
  assert.equal(
    (await call('/api/v1/habits/' + habit.id, 'GET', undefined, b)).status,
    404,
  );
  assert.equal(
    (
      await call(
        '/api/v1/habits/' + habit.id + '/entries/' + toggle.id,
        'GET',
        undefined,
        b,
      )
    ).status,
    404,
  );
  assert.equal((await call(summaryPath, 'GET', undefined, b)).status, 404);
  assert.equal(
    (await call('/api/v1/routines/' + routine.id, 'GET', undefined, b)).status,
    404,
  );
  const settings = await call('/api/v1/me/settings', 'GET', undefined, a),
    settingsRevision = Number(
      settings.headers.get('etag')?.replaceAll('"', ''),
    );
  assert.equal(
    (
      await call(
        '/api/v1/me/settings',
        'PATCH',
        { timezone: 'Asia/Tokyo' },
        a,
        settingsRevision,
      )
    ).status,
    200,
  );
  const archived = await parsed(
    await call('/api/v1/habits/' + water.id, 'DELETE', undefined, a, 1),
    200,
    HabitSchema,
  );
  assert.equal(archived.currentSchedule?.status, 'ARCHIVED');
  await parsed(
    await call(
      '/api/v1/habits/' + water.id + '/entries/' + logged.id,
      'PATCH',
      { habitRevision: archived.revision, value: '150.1' },
      a,
      logged.revision,
    ),
    200,
    HabitEntrySchema,
  );
  const routineSnapshot = await parsed(
    await call('/api/v1/routines/' + routine.id, 'GET', undefined, a),
    200,
    RoutineSchema,
  );
  await stop();
  await start();
  assert.deepEqual(
    await parsed(
      await call('/api/v1/habits/' + habit.id, 'GET', undefined, a),
      200,
      HabitSchema,
    ),
    resumed,
  );
  assert.deepEqual(
    await parsed(
      await call('/api/v1/routines/' + routine.id, 'GET', undefined, a),
      200,
      RoutineSchema,
    ),
    routineSnapshot,
  );
  const history = await parsed(
    await call(
      '/api/v1/habits/' + habit.id + '/entries/' + toggle.id + '/history',
      'GET',
      undefined,
      a,
    ),
    200,
    HabitEntryPageSchema,
  );
  assert.deepEqual(
    history.items.map((e) => e.value),
    ['1', '0'],
  );
  assert.equal(history.items[0]?.recordedAt, toggle.recordedAt);
  assert.deepEqual(await record(water.id, '2024-01-01', '100.1', key), logged);
  const summary = await parsed(
    await call(summaryPath, 'GET', undefined, a),
    200,
    WaterSummarySchema,
  );
  assert.equal(summary.totalML, '550');
  const stats = await parsed(
    await call(
      '/api/v1/habits/' +
        habit.id +
        '/stats?from=2024-01-01&to=2024-01-07&asOfDate=2024-01-07',
      'GET',
      undefined,
      a,
    ),
    200,
    HabitStatsSchema,
  );
  assert.equal(stats.skipped, 1);
  assert.deepEqual(
    stats.days.map((d) => d.outcome),
    ['COMPLETED', 'MISSED', 'SKIPPED', 'PAUSED', 'PAUSED', 'COMPLETED'],
  );
  assert.equal(archived.latestSchedule.timezone, 'UTC');
  const events = (
    await pool.query(
      'SELECT payload FROM "OutboxEvent" WHERE "aggregateId"=ANY($1::uuid[])',
      [[habit.id, water.id]],
    )
  ).rows;
  assert(events.length > 0);
  assert(events.every((e) => JSON.stringify(e.payload) === '{}'));
  await fs.writeFile(
    path.join(root, 'compiled-smoke.json'),
    JSON.stringify(
      {
        status: 'PASS',
        runtime: process.versions.node,
        postgres: (await pool.query('SHOW server_version')).rows[0]
          .server_version,
        habitPersistence: true,
        exactWaterTotals: true,
        correctionHistory: true,
        streakRecalculation: true,
        skipPauseResume: true,
        orderedRoutinePersistence: true,
        receiptReplayAfterRestart: true,
        archiveHistoryPreserved: true,
        timezoneContextPreserved: true,
        crossUserDenial: true,
        safeOutbox: true,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: compiled habits, exact water totals, typed corrections/streaks, skip/pause/resume, ordered routines, isolation, saved zones and restart/idempotency persistence.\n',
  );
} finally {
  await stop();
  await pool.query(
    'DELETE FROM "SecurityAuditEvent" WHERE "requestId"=ANY($1::uuid[]) OR "actorUserId"=ANY($2::uuid[])',
    [requestIds, userIds],
  );
  await pool.query(
    'DELETE FROM "Routine" WHERE "createdByUserId"=ANY($1::uuid[])',
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
