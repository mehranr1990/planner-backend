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
  NoteSchema,
  NotePageSchema,
  NoteFolderSchema,
  DailyCheckinSchema,
  JournalEntrySchema,
  MoodEntrySchema,
  CaptureSchema,
  VoiceStoredFileSchema,
  PersonalSearchPageSchema,
  CaptureParseResultSchema,
} from '../../packages/api-contracts/dist/index.js';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const databaseUrl = isolatedTestDatabaseUrl(process.env),
  pool = new Pool({ connectionString: databaseUrl });
const root = path.resolve('.tools/p1-08');
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
  const email = `p108-smoke-${randomUUID()}@example.test`,
    password = 'test-only-compiled-goals-123!';
  const signup = await call('/api/v1/auth/sign-up/email', 'POST', {
    email,
    password,
    name: 'Compiled writing fixture',
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
  const get = (route: string, cookie = a) =>
    call('/api/v1' + route, 'GET', undefined, cookie);
  const content = (text: string) => ({
    format: 'MARKDOWN',
    version: 1,
    content: text,
  });
  const folder = await parsed(
    await post('/notes/folders', { title: 'Smoke folder' }),
    201,
    NoteFolderSchema,
  );
  const note = await parsed(
    await post('/notes', {
      title: 'smokeneedle note',
      content: content('Original private writing'),
      folderId: folder.id,
    }),
    201,
    NoteSchema,
  );
  const changed = await parsed(
    await call(
      '/api/v1/notes/' + note.id,
      'PATCH',
      { content: content('Corrected private writing') },
      a,
      note.revision,
    ),
    200,
    NoteSchema,
  );
  const checkin = await parsed(
    await post('/journal/daily-checkins', {
      title: 'smokeneedle journal',
      content: content('Private journal text'),
      localDate: '2024-02-29',
      timezone: 'America/New_York',
      mood: { mood: 4, energy: 3, note: 'smokeneedle mood' },
    }),
    201,
    DailyCheckinSchema,
  );
  assert.equal(checkin.entry.kind, 'CHECK_IN');
  assert.equal(checkin.mood?.localDate, '2024-02-29');
  const source = await parsed(
    await post('/capture', { type: 'TASK', text: 'Captured original source' }),
    201,
    CaptureSchema,
  );
  const key = randomUUID(),
    input = {
      action: 'CREATE_TASK',
      task: { title: 'smokeneedle captured task' },
    };
  const converted = await parsed(
    await post(
      '/capture/' + source.id + '/triage',
      input,
      source.revision,
      key,
    ),
    200,
    CaptureSchema,
  );
  assert(converted.targetTaskId);
  const task = await parsed(
    await get('/tasks/' + converted.targetTaskId),
    200,
    TaskSchema,
  );
  const preview = await parsed(
    await post('/capture/parse', {
      text: 'Plan tomorrow',
      timezone: 'America/New_York',
    }),
    200,
    CaptureParseResultSchema,
  );
  assert.equal(preview.recognized, true);
  const bytes = Buffer.alloc(48);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(40, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(4, 40);
  const upload = await parsed(
    await post('/files/voice/uploads', {
      filename: 'memo.wav',
      mimeType: 'audio/wav',
      expectedSize: bytes.length,
    }),
    201,
    VoiceStoredFileSchema,
  );
  const requestId = randomUUID();
  requestIds.push(requestId);
  const ready = await parsed(
    await fetch(origin + '/api/v1/files/voice/' + upload.id + '/complete', {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: a,
        'X-Request-Id': requestId,
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
    }),
    200,
    VoiceStoredFileSchema,
  );
  const voice = await parsed(
    await post('/capture', { type: 'VOICE_MEMO', voiceFileId: ready.id }),
    201,
    CaptureSchema,
  );
  await stop();
  await start();
  assert.deepEqual(
    await parsed(await get('/notes/' + note.id), 200, NoteSchema),
    changed,
  );
  const history = await parsed(
    await get('/notes/' + note.id + '/history'),
    200,
    NotePageSchema,
  );
  assert.deepEqual(
    history.items.map((r) => r.content.content),
    ['Original private writing', 'Corrected private writing'],
  );
  const persisted = await parsed(
    await get('/journal/daily-checkins/2024-02-29'),
    200,
    DailyCheckinSchema,
  );
  assert.deepEqual(persisted, checkin);
  assert.deepEqual(
    await parsed(
      await get('/journal/entries/' + checkin.entry.id),
      200,
      JournalEntrySchema,
    ),
    checkin.entry,
  );
  assert.deepEqual(
    await parsed(await get('/moods/' + checkin.mood!.id), 200, MoodEntrySchema),
    checkin.mood,
  );
  assert.deepEqual(
    await parsed(
      await post(
        '/capture/' + source.id + '/triage',
        input,
        source.revision,
        key,
      ),
      200,
      CaptureSchema,
    ),
    converted,
  );
  assert.deepEqual(
    await parsed(await get('/tasks/' + task.id), 200, TaskSchema),
    task,
  );
  assert.deepEqual(
    await parsed(await get('/capture/' + voice.id), 200, CaptureSchema),
    voice,
  );
  const download = await get(ready.download!.url.replace('/api/v1', ''));
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const publicSearch = await parsed(
    await get('/search/personal?q=smokeneedle'),
    200,
    PersonalSearchPageSchema,
  );
  assert(publicSearch.items.some((r) => r.id === note.id));
  assert(
    publicSearch.items.every((r) => r.kind !== 'JOURNAL' && r.kind !== 'MOOD'),
  );
  const privateSearch = await parsed(
    await get(
      '/search/personal?q=smokeneedle&includeJournal=true&includeMood=true',
    ),
    200,
    PersonalSearchPageSchema,
  );
  assert(privateSearch.items.some((r) => r.id === checkin.entry.id));
  assert(privateSearch.items.some((r) => r.id === checkin.mood!.id));
  for (const route of [
    '/notes/' + note.id,
    '/journal/entries/' + checkin.entry.id,
    '/moods/' + checkin.mood!.id,
    '/capture/' + source.id,
    ready.download!.url.replace('/api/v1', ''),
  ])
    assert.equal((await get(route, b)).status, 404);
  assert.equal(
    (
      await get(
        ready
          .download!.url.replace('/api/v1', '')
          .replace('/files/voice/', '/files/'),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        '/api/v1/notes/' + note.id,
        'PATCH',
        { title: 'stale' },
        a,
        note.revision,
      )
    ).status,
    409,
  );
  const audits = (
    await pool.query(
      'SELECT * FROM "SecurityAuditEvent" WHERE "actorUserId"=ANY($1::uuid[])',
      [userIds],
    )
  ).rows;
  assert(!JSON.stringify(audits).includes('Private journal text'));
  assert(!JSON.stringify(audits).includes('smokeneedle mood'));
  const events = (
    await pool.query(
      'SELECT payload FROM "OutboxEvent" WHERE "aggregateId"=$1 AND type=$2',
      [source.id, 'capture.triaged'],
    )
  ).rows;
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload, {});
  await fs.writeFile(
    path.join(root, 'compiled-smoke.json'),
    JSON.stringify(
      {
        status: 'PASS',
        runtime: process.versions.node,
        postgres: (await pool.query('SHOW server_version')).rows[0]
          .server_version,
        restartPersistence: true,
        immutableHistory: true,
        checkinAndMood: true,
        triageReceiptReplayAfterRestart: true,
        privateWavPersistence: true,
        privateSearchOptIn: true,
        taskIdentityPreserved: true,
        crossUserDenial: true,
        safeAuditAndOutbox: true,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: compiled private writing/history, check-in/mood, capture atomic triage and restart replay, WAV persistence, search privacy and owner isolation.\n',
  );
} finally {
  await stop();
  await pool.query(
    'DELETE FROM "SecurityAuditEvent" WHERE "requestId"=ANY($1::uuid[]) OR "actorUserId"=ANY($2::uuid[])',
    [requestIds, userIds],
  );
  for (const table of [
    'CaptureItem',
    'Note',
    'MoodEntry',
    'JournalEntry',
    'NoteFolder',
  ])
    await pool.query(
      'DELETE FROM "' + table + '" WHERE "createdByUserId"=ANY($1::uuid[])',
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
