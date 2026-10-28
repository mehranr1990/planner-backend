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
  GoalSchema,
  GoalProgressSchema,
  GoalReviewMutationSchema,
  GoalReviewPageSchema,
  LifeAreaSchema,
  GoalTaskLinkMutationSchema,
  GoalHabitLinkMutationSchema,
  GoalMetricMutationSchema,
  GoalMilestoneMutationSchema,
  TaskSchema,
  HabitSchema,
  HabitEntrySchema,
} from '../../packages/api-contracts/dist/index.js';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const databaseUrl = isolatedTestDatabaseUrl(process.env),
  pool = new Pool({ connectionString: databaseUrl });
const root = path.resolve('.tools/p1-06');
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
  const email = `p106-smoke-${randomUUID()}@example.test`,
    password = 'test-only-compiled-goals-123!';
  const signup = await call('/api/v1/auth/sign-up/email', 'POST', {
    email,
    password,
    name: 'Compiled goals fixture',
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
  const post = async (
    route: string,
    body: unknown,
    revision?: number,
    key = randomUUID(),
  ) => call('/api/v1' + route, 'POST', body, a, revision, key);
  const area = await parsed(
    await post('/life-areas', { title: 'Smoke life area', position: 1 }),
    201,
    LifeAreaSchema,
  );
  let goal = await parsed(
    await post('/goals', {
      title: 'Compiled goal',
      horizon: 'LONG_TERM',
      lifeAreaId: area.id,
      timezone: 'America/New_York',
      progressMode: 'WEIGHTED',
    }),
    201,
    GoalSchema,
  );
  const task = await parsed(
    await post('/tasks', { title: 'Existing Task' }),
    201,
    TaskSchema,
  );
  const habit = await parsed(
    await post('/habits', {
      title: 'Existing Habit',
      type: 'CHECKBOX',
      unit: 'COUNT',
      target: '1',
      timezone: 'UTC',
      schedule: {
        version: 1,
        startDate: '2024-01-01',
        rule: { kind: 'DAILY' },
      },
    }),
    201,
    HabitSchema,
  );
  await parsed(
    await post('/habits/' + habit.id + '/entries', {
      habitRevision: habit.revision,
      localDate: '2024-01-01',
    }),
    201,
    HabitEntrySchema,
  );
  const metric = await parsed(
    await post(
      '/goals/' + goal.id + '/metrics',
      {
        title: 'Measure',
        unit: 'COUNT',
        baseline: '0',
        target: '10',
        current: '5',
        contributes: true,
        weight: '1',
      },
      goal.revision,
    ),
    201,
    GoalMetricMutationSchema,
  );
  goal = await parsed(
    await call('/api/v1/goals/' + goal.id, 'GET', undefined, a),
    200,
    GoalSchema,
  );
  await parsed(
    await post(
      '/goals/' + goal.id + '/milestones',
      {
        title: 'Milestone',
        status: 'COMPLETED',
        contributes: true,
        weight: '1',
      },
      goal.revision,
    ),
    201,
    GoalMilestoneMutationSchema,
  );
  goal = await parsed(
    await call('/api/v1/goals/' + goal.id, 'GET', undefined, a),
    200,
    GoalSchema,
  );
  await parsed(
    await post(
      '/goals/' + goal.id + '/links/tasks',
      {
        taskId: task.id,
        sourceRevision: task.revision,
        contributes: true,
        weight: '1',
      },
      goal.revision,
    ),
    201,
    GoalTaskLinkMutationSchema,
  );
  goal = await parsed(
    await call('/api/v1/goals/' + goal.id, 'GET', undefined, a),
    200,
    GoalSchema,
  );
  await parsed(
    await post(
      '/goals/' + goal.id + '/links/habits',
      {
        habitId: habit.id,
        sourceRevision: habit.revision,
        from: '2024-01-01',
        to: '2024-01-02',
        contributes: true,
        weight: '1',
      },
      goal.revision,
    ),
    201,
    GoalHabitLinkMutationSchema,
  );
  goal = await parsed(
    await call('/api/v1/goals/' + goal.id, 'GET', undefined, a),
    200,
    GoalSchema,
  );
  const readProgress = () =>
    call('/api/v1/goals/' + goal.id + '/progress', 'GET', undefined, a);
  const before = await parsed(await readProgress(), 200, GoalProgressSchema);
  assert.equal(before.percentage, '62.5');
  assert.equal(before.weightSum, '4');
  const reviewKey = randomUUID(),
    reviewRequest = { reflection: 'Private smoke reflection' },
    reviewRevision = goal.revision;
  const review = await parsed(
    await post(
      '/goals/' + goal.id + '/reviews',
      reviewRequest,
      reviewRevision,
      reviewKey,
    ),
    201,
    GoalReviewMutationSchema,
  );
  const child = await parsed(
    await post('/goals', {
      title: 'Subgoal',
      horizon: 'SHORT_TERM',
      parentGoalId: goal.id,
    }),
    201,
    GoalSchema,
  );
  assert.equal(child.parentGoalId, goal.id);
  await stop();
  await start();
  const saved = await parsed(
    await call('/api/v1/goals/' + goal.id, 'GET', undefined, a),
    200,
    GoalSchema,
  );
  assert.equal(saved.revision, review.revision);
  assert.equal(saved.timezone, 'America/New_York');
  assert.equal(saved.lifeAreaId, area.id);
  const replay = await parsed(
    await post(
      '/goals/' + goal.id + '/reviews',
      reviewRequest,
      reviewRevision,
      reviewKey,
    ),
    201,
    GoalReviewMutationSchema,
  );
  assert.deepEqual(replay, review);
  await parsed(
    await post('/tasks/' + task.id + '/complete', {}, task.revision),
    200,
    TaskSchema,
  );
  assert.equal(
    (await parsed(await readProgress(), 200, GoalProgressSchema)).percentage,
    '87.5',
  );
  const metricPatch = await parsed(
    await call(
      '/api/v1/goals/' + goal.id + '/metrics/' + metric.id,
      'PATCH',
      { current: '20' },
      a,
      saved.revision,
    ),
    200,
    GoalMetricMutationSchema,
  );
  assert.equal(metricPatch.item.current, '20');
  assert.equal(
    (await parsed(await readProgress(), 200, GoalProgressSchema)).rawPercentage,
    '125',
  );
  assert.equal(
    (await parsed(await readProgress(), 200, GoalProgressSchema)).percentage,
    '100',
  );
  const history = await parsed(
    await call('/api/v1/goals/' + goal.id + '/reviews', 'GET', undefined, a),
    200,
    GoalReviewPageSchema,
  );
  assert.deepEqual(history.items[0]?.snapshot, review.snapshot);
  assert.equal(
    (await call('/api/v1/goals/' + goal.id + '/progress', 'GET', undefined, b))
      .status,
    404,
  );
  assert.equal(
    (await call('/api/v1/goals/' + goal.id + '/reviews', 'GET', undefined, b))
      .status,
    404,
  );
  const events = (
    await pool.query(
      'SELECT payload FROM "OutboxEvent" WHERE "aggregateId"=$1 AND type=$2',
      [goal.id, 'goal.progress_changed'],
    )
  ).rows;
  assert(events.length >= 7);
  assert(events.every((e) => JSON.stringify(e.payload) === '{}'));
  await fs.writeFile(
    path.join(root, 'compiled-smoke.json'),
    JSON.stringify(
      {
        status: 'PASS',
        runtime: process.versions.node,
        postgres: (await pool.query('SHOW server_version')).rows[0]
          .server_version,
        goalPersistence: true,
        lifeAreaAndHierarchyPersistence: true,
        exactWeightedProgress: true,
        taskHabitReferences: true,
        metricAndMilestoneChanges: true,
        immutableHistory: true,
        receiptReplayAfterRestart: true,
        timezoneContextPreserved: true,
        crossUserDenial: true,
        safeOutbox: true,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: compiled goal/life-area/hierarchy persistence, exact weights, Task/Habit sources, metrics/milestones, immutable reviews, restart/replay, isolation and safe outbox.\n',
  );
} finally {
  await stop();
  await pool.query(
    'DELETE FROM "SecurityAuditEvent" WHERE "requestId"=ANY($1::uuid[]) OR "actorUserId"=ANY($2::uuid[])',
    [requestIds, userIds],
  );
  await pool.query(
    'DELETE FROM "Goal" WHERE "createdByUserId"=ANY($1::uuid[])',
    [userIds],
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
