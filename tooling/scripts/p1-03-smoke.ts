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
  TaskRecurrenceSchema,
  CatchUpResultSchema,
  DailyPlanSchema,
  WeeklyPlanSchema,
  PlanningReviewSchema,
  CapacitySchema,
  AvailabilitySchema,
  RolloverPreviewSchema,
  RolloverResultSchema,
} from '../../packages/api-contracts/dist/index.js';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const databaseUrl = isolatedTestDatabaseUrl(process.env),
  pool = new Pool({ connectionString: databaseUrl });
const root = path.resolve('.tools/p1-03');
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
  const email = `p103-smoke-${randomUUID()}@example.test`,
    password = 'test-only-compiled-planning-123!';
  const signup = await call('/api/v1/auth/sign-up/email', 'POST', {
    email,
    password,
    name: 'Compiled planning fixture',
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
  const task = await parsed(
    await call(
      '/api/v1/tasks',
      'POST',
      {
        title: 'Compiled planning Task',
        dueAt: '2026-10-30T09:00:00Z',
        scheduledDate: '2026-10-29',
      },
      a,
    ),
    201,
    TaskSchema,
  );
  const availability = await parsed(
    await call('/api/v1/planning/capacity/availability', 'GET', undefined, a),
    200,
    AvailabilitySchema,
  );
  await parsed(
    await call(
      '/api/v1/planning/capacity/availability',
      'PUT',
      {
        availability: {
          version: 1,
          minutesByWeekday: [0, 120, 120, 120, 120, 120, 0],
        },
      },
      a,
      availability.revision,
    ),
    200,
    AvailabilitySchema,
  );
  const week = await parsed(
    await call('/api/v1/planning/weeks/2026-10-26', 'POST', {}, a),
    201,
    WeeklyPlanSchema,
  );
  const empty = await parsed(
    await call('/api/v1/planning/days/2026-10-28', 'POST', {}, a),
    201,
    DailyPlanSchema,
  );
  const day = await parsed(
    await call(
      `/api/v1/planning/days/2026-10-28/items/${task.id}`,
      'PUT',
      { taskRevision: task.revision, plannedMinutes: 90 },
      a,
      empty.revision,
    ),
    200,
    DailyPlanSchema,
  );
  const reflection = 'Private compiled planning reflection';
  const review = await parsed(
    await call(
      '/api/v1/planning/reviews',
      'POST',
      { kind: 'MORNING', localDate: day.localDate, reflection },
      a,
    ),
    201,
    PlanningReviewSchema,
  );
  const preview = await parsed(
    await call(
      '/api/v1/planning/rollover/preview',
      'POST',
      { fromDate: '2026-10-28', toDate: '2026-10-29' },
      a,
    ),
    200,
    RolloverPreviewSchema,
  );
  assert.equal(preview.targetRevision, 0);
  assert.equal(preview.items[0]!.disposition, 'READY');
  const body = {
    fromDate: preview.fromDate,
    toDate: preview.toDate,
    sourceRevision: preview.sourceRevision,
    targetRevision: preview.targetRevision,
    settingsRevision: preview.settingsRevision,
    mode: 'MOVE',
    items: preview.items.map((item) => ({
      taskId: item.taskId,
      taskRevision: item.taskRevision,
      itemRevision: item.itemRevision,
    })),
  };
  const rolled = await parsed(
    await call(
      '/api/v1/planning/rollover/commit',
      'POST',
      body,
      a,
      undefined,
      'compiled-rollover',
    ),
    200,
    RolloverResultSchema,
  );
  assert.equal(rolled.succeeded, 1);
  assert.equal(rolled.source.items.length, 0);
  assert.equal(rolled.target!.items[0]!.taskId, task.id);
  const unchanged = await parsed(
    await call('/api/v1/tasks/' + task.id, 'GET', undefined, a),
    200,
    TaskSchema,
  );
  assert.deepEqual(unchanged, task);
  const master = await parsed(
    await call(
      '/api/v1/tasks',
      'POST',
      { title: 'Recurring planning fixture' },
      a,
    ),
    201,
    TaskSchema,
  );
  const series = await parsed(
    await call(
      '/api/v1/task-recurrences',
      'POST',
      {
        taskId: master.id,
        taskRevision: 1,
        definition: {
          startDate: '2026-10-28',
          endDate: '2026-10-28',
          localTime: '09:00',
          timezone: 'UTC',
          rule: { kind: 'DAILY', interval: 1 },
          exclusionDates: [],
        },
      },
      a,
    ),
    201,
    TaskRecurrenceSchema,
  );
  const occurrences = await parsed(
      await call(
        `/api/v1/task-recurrences/${series.id}/catch-up`,
        'POST',
        { through: '2026-10-28' },
        a,
      ),
      200,
      CatchUpResultSchema,
    ),
    occurrence = occurrences.items[0]!;
  assert(occurrence.taskId);
  const target = await parsed(
    await call(
      `/api/v1/planning/days/2026-10-29/items/${occurrence.taskId}`,
      'PUT',
      { taskRevision: 1, plannedMinutes: null },
      a,
      rolled.target!.revision,
    ),
    200,
    DailyPlanSchema,
  );
  assert.equal(
    (
      await call(
        `/api/v1/planning/days/2026-10-29/items/${master.id}`,
        'PUT',
        { taskRevision: 1, plannedMinutes: 1 },
        a,
        target.revision,
      )
    ).status,
    409,
  );
  const capacity = await parsed(
    await call(
      '/api/v1/planning/capacity?date=2026-10-29',
      'GET',
      undefined,
      a,
    ),
    200,
    CapacitySchema,
  );
  assert.equal(capacity.availableMinutes, 120);
  assert.equal(capacity.knownPlannedMinutes, 90);
  assert.equal(capacity.unknownAllocations, 1);
  assert.equal(capacity.remainingMinutes, null);
  assert.equal(
    (await call('/api/v1/planning/reviews/' + review.id, 'GET', undefined, b))
      .status,
    404,
  );
  assert.equal(
    (await call('/api/v1/planning/days/2026-10-29', 'GET', undefined, b))
      .status,
    404,
  );
  await stop();
  await start();
  const persisted = await parsed(
    await call('/api/v1/planning/days/2026-10-29', 'GET', undefined, a),
    200,
    DailyPlanSchema,
  );
  assert.deepEqual(persisted, target);
  const persistedReview = await parsed(
    await call('/api/v1/planning/reviews/' + review.id, 'GET', undefined, a),
    200,
    PlanningReviewSchema,
  );
  assert.equal(persistedReview.reflection, reflection);
  const persistedWeek = await parsed(
    await call('/api/v1/planning/weeks/2026-10-26', 'GET', undefined, a),
    200,
    WeeklyPlanSchema,
  );
  assert.equal(persistedWeek.days[3]!.selectionCount, 2);
  assert(persistedWeek.revision > week.revision);
  const replay = await parsed(
    await call(
      '/api/v1/planning/rollover/commit',
      'POST',
      body,
      a,
      undefined,
      'compiled-rollover',
    ),
    200,
    RolloverResultSchema,
  );
  assert.deepEqual(replay, rolled);
  const settings = await call('/api/v1/me/settings', 'GET', undefined, a);
  assert.equal(settings.status, 200);
  const settingsRevision = Number(
    settings.headers.get('etag')!.replaceAll('"', ''),
  );
  assert.equal(
    (
      await call(
        '/api/v1/me/settings',
        'PATCH',
        { timezone: 'Asia/Tehran', firstDayOfWeek: 0 },
        a,
        settingsRevision,
      )
    ).status,
    200,
  );
  const newDay = await parsed(
    await call('/api/v1/planning/days/2026-10-30', 'POST', {}, a),
    201,
    DailyPlanSchema,
  );
  assert.equal(newDay.timezone, 'Asia/Tehran');
  const oldWeek = await parsed(
    await call('/api/v1/planning/weeks/2026-10-26', 'GET', undefined, a),
    200,
    WeeklyPlanSchema,
  );
  assert.equal(oldWeek.timezone, 'UTC');
  assert.equal(oldWeek.firstDayOfWeek, 1);
  assert.deepEqual(
    await parsed(
      await call('/api/v1/tasks/' + task.id, 'GET', undefined, a),
      200,
      TaskSchema,
    ),
    task,
  );
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM "TaskChange" WHERE "taskId"=$1',
        [task.id],
      )
    ).rows[0].count,
    1,
  );
  const audits = (
    await pool.query(
      'SELECT * FROM "SecurityAuditEvent" WHERE "resourceId"=$1',
      [review.id],
    )
  ).rows;
  assert(!JSON.stringify(audits).includes(reflection));
  await fs.writeFile(
    path.join(root, 'compiled-smoke.json'),
    JSON.stringify(
      {
        status: 'PASS',
        runtime: process.versions.node,
        postgres: (await pool.query('SHOW server_version')).rows[0]
          .server_version,
        dailyAndWeeklyPlanning: true,
        taskIdentityAndDatesPreserved: true,
        explicitRollover: true,
        rolloverReplayAcrossRestart: true,
        recurringTaskReference: true,
        masterBlocked: true,
        availabilityAndUnknownCapacity: true,
        privateReviewPersistence: true,
        crossUserDenial: true,
        historicalTimezoneAndWeekContext: true,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: compiled API daily/weekly planning, recurrence references, explicit rollover/replay, capacity, private reviews, isolation and restart persistence.\n',
  );
} finally {
  await stop();
  await pool.query(
    'DELETE FROM "SecurityAuditEvent" WHERE "requestId"=ANY($1::uuid[]) OR "actorUserId"=ANY($2::uuid[])',
    [requestIds, userIds],
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
