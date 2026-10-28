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
  CalendarEventSchema,
  TimeBlockSchema,
  CalendarViewSchema,
  CalendarConflictsSchema,
  CalendarSeriesResultSchema,
  DailyPlanSchema,
} from '../../packages/api-contracts/dist/index.js';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const databaseUrl = isolatedTestDatabaseUrl(process.env),
  pool = new Pool({ connectionString: databaseUrl });
const root = path.resolve('.tools/p1-04');
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
  const email = `p104-smoke-${randomUUID()}@example.test`,
    password = 'test-only-compiled-calendar-123!';
  const signup = await call('/api/v1/auth/sign-up/email', 'POST', {
    email,
    password,
    name: 'Compiled calendar fixture',
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
      { title: 'Compiled calendar Task', dueAt: '2030-01-03T09:00:00Z' },
      a,
    ),
    201,
    TaskSchema,
  );
  const day = await parsed(
    await call('/api/v1/planning/days/2030-01-01', 'POST', {}, a),
    201,
    DailyPlanSchema,
  );
  await parsed(
    await call(
      '/api/v1/planning/days/2030-01-01/items/' + task.id,
      'PUT',
      { taskRevision: task.revision, plannedMinutes: 60 },
      a,
      day.revision,
    ),
    200,
    DailyPlanSchema,
  );
  const timed = (
    date: string,
    start = '09:00',
    end = '10:00',
    timezone = 'UTC',
  ) => ({
    kind: 'TIMED',
    timezone,
    localStart: date + 'T' + start,
    localEnd: date + 'T' + end,
  });
  const event = await parsed(
    await call(
      '/api/v1/calendar/events',
      'POST',
      { title: 'Compiled event', schedule: timed('2030-01-01') },
      a,
      undefined,
      randomUUID(),
    ),
    201,
    CalendarEventSchema,
  );
  const allDay = await parsed(
    await call(
      '/api/v1/calendar/events',
      'POST',
      {
        title: 'All-day boundary',
        schedule: {
          kind: 'ALL_DAY',
          timezone: 'Asia/Tehran',
          startDate: '2032-02-29',
          endDate: '2032-03-01',
        },
      },
      a,
      undefined,
      randomUUID(),
    ),
    201,
    CalendarEventSchema,
  );
  assert.equal(allDay.schedule.startAt, null);
  const block = await parsed(
    await call(
      '/api/v1/calendar/time-blocks',
      'POST',
      {
        title: 'Existing Task block',
        schedule: timed('2030-01-01', '09:30', '10:30'),
        taskId: task.id,
        taskRevision: task.revision,
      },
      a,
      undefined,
      randomUUID(),
    ),
    201,
    TimeBlockSchema,
  );
  assert.equal(block.taskId, task.id);
  const conflicts = await parsed(
    await call(
      '/api/v1/calendar/conflicts?from=2030-01-01&to=2030-01-02&timezone=UTC',
      'GET',
      undefined,
      a,
    ),
    200,
    CalendarConflictsSchema,
  );
  assert(
    conflicts.items.some(
      (p) =>
        [p.left, p.right].includes(event.id) &&
        [p.left, p.right].includes(block.id),
    ),
  );
  const seriesInput = {
    title: 'DST series',
    schedule: timed('2030-03-09', '02:30', '03:30', 'America/New_York'),
    recurrence: {
      version: 1,
      startDate: '2030-03-09',
      endDate: null,
      localTime: '02:30',
      timezone: 'America/New_York',
      rule: { kind: 'DAILY', interval: 1 },
      exclusionDates: [],
    },
  };
  const series = await parsed(
    await call(
      '/api/v1/calendar/events',
      'POST',
      seriesInput,
      a,
      undefined,
      randomUUID(),
    ),
    201,
    CalendarEventSchema,
  );
  const view = await parsed(
    await call(
      '/api/v1/calendar/views?from=2030-03-09&to=2030-03-12&timezone=UTC&limit=100',
      'GET',
      undefined,
      a,
    ),
    200,
    CalendarViewSchema,
  );
  assert(
    view.items.some(
      (i) =>
        i.seriesId === series.id &&
        i.status === 'SKIPPED' &&
        i.reason === 'DST_GAP' &&
        i.schedule.startAt === null,
    ),
  );
  const exception = await parsed(
    await call(
      '/api/v1/calendar/events/' + series.id + '/series',
      'POST',
      {
        scope: 'THIS_OCCURRENCE',
        recurrenceKey: '2030-03-11T02:30',
        exceptionRevision: 0,
        patch: { status: 'CANCELED' },
      },
      a,
      series.revision,
    ),
    200,
    CalendarSeriesResultSchema,
  );
  const splitKey = randomUUID(),
    splitInput = {
      scope: 'THIS_AND_FUTURE',
      recurrenceKey: '2030-03-12T02:30',
      event: {
        ...seriesInput,
        title: 'Successor',
        schedule: timed('2030-03-12', '02:30', '03:30', 'America/New_York'),
        recurrence: { ...seriesInput.recurrence, startDate: '2030-03-12' },
      },
    };
  const split = await parsed(
    await call(
      '/api/v1/calendar/events/' + series.id + '/series',
      'POST',
      splitInput,
      a,
      exception.event.revision,
      splitKey,
    ),
    200,
    CalendarSeriesResultSchema,
  );
  assert.equal(split.successor?.previousSeriesId, series.id);
  assert.equal(
    (await call('/api/v1/calendar/events/' + event.id, 'GET', undefined, b))
      .status,
    404,
  );
  assert.equal(
    (
      await call(
        '/api/v1/calendar/time-blocks/' + block.id,
        'GET',
        undefined,
        b,
      )
    ).status,
    404,
  );
  const settingsResponse = await call(
      '/api/v1/me/settings',
      'GET',
      undefined,
      a,
    ),
    settingsRevision = Number(
      settingsResponse.headers.get('etag')?.replaceAll('"', ''),
    );
  assert(Number.isSafeInteger(settingsRevision) && settingsRevision > 0);
  assert.equal(
    (
      await call(
        '/api/v1/me/settings',
        'PATCH',
        { timezone: 'Asia/Tokyo', preferredCalendar: 'JALALI' },
        a,
        settingsRevision,
      )
    ).status,
    200,
  );
  await stop();
  await start();
  assert.deepEqual(
    await parsed(
      await call('/api/v1/calendar/events/' + event.id, 'GET', undefined, a),
      200,
      CalendarEventSchema,
    ),
    event,
  );
  assert.deepEqual(
    await parsed(
      await call(
        '/api/v1/calendar/time-blocks/' + block.id,
        'GET',
        undefined,
        a,
      ),
      200,
      TimeBlockSchema,
    ),
    block,
  );
  assert.deepEqual(
    await parsed(
      await call(
        '/api/v1/calendar/events/' + series.id + '/series',
        'POST',
        splitInput,
        a,
        exception.event.revision,
        splitKey,
      ),
      200,
      CalendarSeriesResultSchema,
    ),
    split,
  );
  const retained = await parsed(
    await call(
      '/api/v1/calendar/views?from=2030-03-11&to=2030-03-12&timezone=Asia%2FTokyo&limit=100',
      'GET',
      undefined,
      a,
    ),
    200,
    CalendarViewSchema,
  );
  assert(
    retained.items.some(
      (i) => i.seriesId === series.id && i.status === 'CANCELED',
    ),
  );
  assert.deepEqual(
    await parsed(
      await call('/api/v1/tasks/' + task.id, 'GET', undefined, a),
      200,
      TaskSchema,
    ),
    task,
  );
  const preservedDay = await parsed(
    await call('/api/v1/planning/days/2030-01-01', 'GET', undefined, a),
    200,
    DailyPlanSchema,
  );
  assert.equal(preservedDay.items[0]?.taskId, task.id);
  assert.equal(
    (
      await call(
        '/api/v1/calendar/time-blocks/' + block.id,
        'DELETE',
        undefined,
        a,
        block.revision,
      )
    ).status,
    204,
  );
  const deleted = await parsed(
    await call('/api/v1/calendar/time-blocks/' + block.id, 'GET', undefined, a),
    200,
    TimeBlockSchema,
  );
  assert(deleted.deletedAt);
  await fs.writeFile(
    path.join(root, 'compiled-smoke.json'),
    JSON.stringify(
      {
        status: 'PASS',
        runtime: process.versions.node,
        postgres: (await pool.query('SHOW server_version')).rows[0]
          .server_version,
        eventAndBlockPersistence: true,
        exclusiveAllDayDates: true,
        recurringDstGap: true,
        exceptionPersistence: true,
        seriesLineage: true,
        splitReplayAfterRestart: true,
        taskAndMyDayPreserved: true,
        advisoryConflicts: true,
        timezonePreserved: true,
        crossUserDenial: true,
        deletionTombstone: true,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: compiled calendar events/blocks, all-day and DST recurrence, exceptions/splits, advisory conflicts, Task/My Day preservation, isolation and restart persistence.\n',
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
