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
  BulkTaskResponseSchema,
  TaskTemplateSchema,
  SavedTaskFilterSchema,
  TaskPageSchema,
  TaskOccurrenceSchema,
} from '../../packages/api-contracts/dist/index.js';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const databaseUrl = isolatedTestDatabaseUrl(process.env),
  pool = new Pool({ connectionString: databaseUrl });
const root = path.resolve('.tools/p1-02');
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
  const email = `p102-smoke-${randomUUID()}@example.test`,
    password = 'test-only-compiled-recurrence-123!';
  const signup = await call('/api/v1/auth/sign-up/email', 'POST', {
    email,
    password,
    name: 'Compiled recurrence fixture',
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
  const master = await parsed(
    await call(
      '/api/v1/tasks',
      'POST',
      { title: 'Compiled recurring task' },
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
        taskRevision: master.revision,
        definition: {
          startDate: '2024-03-09',
          endDate: '2024-03-11',
          localTime: '02:30',
          timezone: 'America/New_York',
          rule: { kind: 'DAILY', interval: 1 },
          exclusionDates: [],
        },
      },
      a,
    ),
    201,
    TaskRecurrenceSchema,
  );
  const first = await parsed(
    await call(
      `/api/v1/task-recurrences/${series.id}/catch-up`,
      'POST',
      { through: '2024-03-11', limit: 2 },
      a,
    ),
    200,
    CatchUpResultSchema,
  );
  assert.equal(first.items.length, 2);
  assert.equal(first.items[1]!.reason, 'DST_GAP');
  assert.equal(first.items[1]!.taskId, null);
  assert(first.nextCursor);
  const last = await parsed(
    await call(
      `/api/v1/task-recurrences/${series.id}/catch-up`,
      'POST',
      { through: '2024-03-11', limit: 2, cursor: first.nextCursor },
      a,
    ),
    200,
    CatchUpResultSchema,
  );
  assert.equal(last.items.length, 1);
  const foreign = await parsed(
    await call('/api/v1/tasks', 'POST', { title: 'Private foreign smoke' }, b),
    201,
    TaskSchema,
  );
  const item = first.items[0]!,
    task = await parsed(
      await call('/api/v1/tasks/' + item.taskId, 'GET', undefined, a),
      200,
      TaskSchema,
    );
  const bulk = {
    items: [
      { action: 'COMPLETE', id: task.id, revision: task.revision },
      { action: 'COMPLETE', id: foreign.id, revision: 1 },
      {
        action: 'PATCH',
        id: task.id,
        revision: task.revision,
        patch: { title: 'stale' },
      },
    ],
  };
  const result = await parsed(
    await call('/api/v1/tasks/bulk', 'POST', bulk, a, undefined, 'smoke-bulk'),
    200,
    BulkTaskResponseSchema,
  );
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 2);
  const template = await parsed(
    await call(
      '/api/v1/task-templates',
      'POST',
      {
        name: 'Compiled',
        values: {
          version: 1,
          task: { title: 'Copied task' },
          checklist: [{ title: 'Unchecked' }],
        },
      },
      a,
    ),
    201,
    TaskTemplateSchema,
  );
  const applied = await parsed(
    await call(
      `/api/v1/task-templates/${template.id}/apply`,
      'POST',
      { revision: 1 },
      a,
      undefined,
      'smoke-template',
    ),
    201,
    TaskSchema,
  );
  assert.equal(applied.title, 'Copied task');
  const filter = await parsed(
    await call(
      '/api/v1/saved-task-filters',
      'POST',
      { name: 'Open', query: { version: 1, where: { status: 'OPEN' } } },
      a,
    ),
    201,
    SavedTaskFilterSchema,
  );
  const list = await parsed(
    await call(
      `/api/v1/saved-task-filters/${filter.id}/tasks`,
      'GET',
      undefined,
      a,
    ),
    200,
    TaskPageSchema,
  );
  assert(
    !list.items.some(
      (value) => value.id === master.id || value.id === foreign.id,
    ),
  );
  await stop();
  await start();
  const replay = await parsed(
    await call('/api/v1/tasks/bulk', 'POST', bulk, a, undefined, 'smoke-bulk'),
    200,
    BulkTaskResponseSchema,
  );
  assert.deepEqual(replay, result);
  const persisted = await parsed(
    await call('/api/v1/task-occurrences/' + item.id, 'GET', undefined, a),
    200,
    TaskOccurrenceSchema,
  );
  assert.equal(persisted.state, 'DONE');
  const gap = await parsed(
    await call(
      '/api/v1/task-occurrences/' + first.items[1]!.id,
      'GET',
      undefined,
      a,
    ),
    200,
    TaskOccurrenceSchema,
  );
  assert.equal(gap.reason, 'DST_GAP');
  assert.equal(gap.taskId, null);
  assert.equal(
    (await call('/api/v1/task-recurrences/' + series.id, 'GET', undefined, b))
      .status,
    404,
  );
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM "TaskOccurrence" WHERE "seriesId"=$1',
        [series.id],
      )
    ).rows[0].count,
    3,
  );
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM "OutboxEvent" WHERE "aggregateId"=$1 AND type=$2',
        [task.id, 'task.completed'],
      )
    ).rows[0].count,
    1,
  );
  await fs.writeFile(
    path.join(root, 'compiled-smoke.json'),
    JSON.stringify(
      {
        status: 'PASS',
        runtime: process.versions.node,
        postgres: (await pool.query('SHOW server_version')).rows[0]
          .server_version,
        dstGapTrackedWithoutTask: true,
        boundedCatchUp: true,
        bulkPartialSuccess: true,
        receiptPersistsAcrossApiRestart: true,
        terminalStatePersists: true,
        templateCopy: true,
        filterIsolation: true,
        foreignSeries: 404,
        occurrences: 3,
        singleCompletionEvent: true,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: compiled API recurrence/DST/catch-up, mixed bulk/replay, template/filter isolation and process-restart persistence.\n',
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
