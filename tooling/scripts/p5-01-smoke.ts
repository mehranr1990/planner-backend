import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { Client } from 'pg';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';
import { installJobSchema } from '../../apps/api/src/platform/jobs/schema.ts';
import { SharedControl } from '../../apps/api/dist/platform/storage/shared-control.js';
import { ErasureControl } from '../../apps/api/dist/platform/storage/public/index.js';
import { parseEnvironment } from '../../apps/api/dist/bootstrap/environment.js';
import * as c from '../../packages/api-contracts/dist/index.js';

// Actual compiled API and worker processes; owns only this newly created DB.
const original = isolatedTestDatabaseUrl(process.env),
  name = 'p501_smoke_' + randomUUID().replaceAll('-', '') + '_test',
  root = fs.mkdtempSync(path.resolve('.tools/p5-01-smoke-')),
  control = new Client({ connectionString: original });
const url = new URL(original);
url.pathname = '/' + name;
const children = new Set<ChildProcess>();
let owned = false;
async function stop(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  children.delete(child);
}
async function port() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const value = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  return value;
}
const apiPort = await port(),
  origin = 'http://localhost:' + apiPort;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: url.toString(),
  HOST: '127.0.0.1',
  PORT: String(apiPort),
  LOG_LEVEL: 'silent',
  BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
  BETTER_AUTH_URL: origin,
  CORS_ORIGINS: origin,
  MAIL_MODE: 'sink',
  MAIL_SINK_DIR: path.join(root, 'mail'),
  STORAGE_ROOT: path.join(root, 'files'),
  ERASURE_CONTROL_ROOT: path.join(root, 'erasure'),
  SHARED_CONTROL_ROOT: path.join(root, 'shared'),
  SHARED_CONTROL_KEYS: JSON.stringify({
    k1: randomBytes(48).toString('base64url'),
  }),
  SHARED_CONTROL_ACTIVE_KEY_ID: 'k1',
  SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P501-SMOKE-ONLY',
  JOBS_SCHEMA: 'planner_jobs_test_' + randomUUID().replaceAll('-', ''),
  JOBS_POLL_SECONDS: '1',
};
function start(file: string) {
  const child = spawn(process.execPath, [file], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.add(child);
  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });
  return { child, output: () => output };
}
async function workerPass(done?: () => Promise<boolean>) {
  const worker = start('apps/api/dist/worker.js');
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (
        worker.output().includes('Planner notification worker ready') &&
        (!done || (await done()))
      )
        return;
      if (worker.child.exitCode !== null || worker.child.signalCode !== null)
        break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error(
      'Compiled worker readiness failed; inspect local private smoke evidence',
    );
  } finally {
    await stop(worker.child);
  }
}
async function apiStart() {
  const api = start('apps/api/dist/main.js');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (api.child.exitCode !== null || api.child.signalCode !== null) break;
    try {
      const response = await fetch(
        'http://127.0.0.1:' + apiPort + '/health/ready',
      );
      if (response.ok) return api.child;
    } catch {
      /* local readiness */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Compiled API readiness failed; credentials withheld');
}
async function http(
  method: string,
  route: string,
  body?: unknown,
  cookie?: string,
  headers: Record<string, string> = {},
) {
  const response = await fetch('http://127.0.0.1:' + apiPort + route, {
    method,
    headers: {
      ...(method !== 'GET'
        ? { 'Content-Type': 'application/json', Origin: origin }
        : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, method + ' ' + route + ' returned ' + response.status);
  return { response, body: (await response.json()) as Record<string, unknown> };
}
await control.connect();
try {
  assert.match(name, /^p501_smoke_[a-f0-9]{32}_test$/);
  assert.equal(
    (
      await control.query(
        'SELECT count(*)::int n FROM pg_database WHERE datname=$1',
        [name],
      )
    ).rows[0].n,
    0,
  );
  await control.query('CREATE DATABASE "' + name + '"');
  owned = true;
  const migrated = spawnSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--config',
      'prisma.config.ts',
    ],
    { env, encoding: 'utf8' },
  );
  assert.equal(migrated.status, 0, 'Fresh smoke migration failed');
  await installJobSchema(url.toString(), env.JOBS_SCHEMA!);
  const config = parseEnvironment(env);
  await new ErasureControl(config).initialize();
  await new SharedControl(config).initialize();
  let api = await apiStart();
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  try {
    const password = 'Synthetic-p501-smoke-password-only!';
    async function person() {
      const email = randomUUID() + '@example.test';
      await http('POST', '/api/v1/auth/sign-up/email', {
        name: 'Synthetic smoke participant',
        email,
        password,
      });
      await db.query('UPDATE "User" SET "emailVerified"=true WHERE email=$1', [
        email,
      ]);
      const login = await http('POST', '/api/v1/auth/sign-in/email', {
        email,
        password,
      });
      const cookies = login.response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
      const id = (
        await db.query('SELECT id FROM "User" WHERE email=$1', [email])
      ).rows[0].id as string;
      return { id, cookie: cookies };
    }
    const owner = await person(),
      recipient = await person(),
      version = 'synthetic-p501-smoke-' + randomUUID(),
      rule = {
        retainAfterClosureSeconds: 0,
        audience: ['OWNER', 'ADMIN'],
        exportAuthority: ['OWNER'],
        disposalAction: 'PURGE',
      };
    await db.query(
      'INSERT INTO "SharedRetentionPolicy" (version,"approvalReference",configuration) VALUES($1,$2,$3)',
      [
        version,
        'SYNTHETIC-P501-SMOKE-ONLY',
        JSON.stringify({
          policyVersion: version,
          approvalReference: 'SYNTHETIC-P501-SMOKE-ONLY',
          accountableOperator: 'synthetic operator',
          applicableContexts: ['CONVERSATION', 'PROJECT'],
          marketScope: 'isolated local smoke',
          sharedRecoverySeconds: 2592000,
          classRules: {
            workContent: rule,
            commentsHistory: rule,
            filesDerivatives: rule,
            exports: rule,
            accessAuditLifecycle: rule,
          },
          obligations: [],
          holds: [],
          backupPolicyReference: 'synthetic independent evidence',
        }),
      ],
    );
    const id = randomUUID();
    const created = await http(
      'POST',
      '/api/v1/conversations',
      {
        id,
        kind: 'DM',
        participants: [recipient.id],
        retentionPolicyVersion: version,
      },
      owner.cookie,
      { 'Idempotency-Key': randomUUID() },
    );
    c.ConversationSchema.parse(created.body);
    const offers = await http(
        'GET',
        '/api/v1/conversation-invitations',
        undefined,
        recipient.cookie,
      ),
      offer = c.ConversationInvitationPageSchema.parse(offers.body).items[0]!;
    await http(
      'POST',
      '/api/v1/conversation-invitations/' + offer.id + '/accept',
      {},
      recipient.cookie,
      { 'If-Match': '"1"' },
    );
    const input = {
        id: randomUUID(),
        text: 'Synthetic durable restart message',
      },
      key = randomUUID();
    const sent = await http(
      'POST',
      '/api/v1/conversations/' + id + '/messages',
      input,
      owner.cookie,
      { 'Idempotency-Key': key },
    );
    c.ConversationMessageSchema.parse(sent.body);
    const history = c.ConversationMessagePageSchema.parse(
      (
        await http(
          'GET',
          '/api/v1/conversations/' + id + '/messages',
          undefined,
          recipient.cookie,
        )
      ).body,
    );
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0]!.id, input.id);
    // Seed an expired source closure only in this newly owned smoke database.
    // The actual registered worker must stop before deleting its channel history.
    const sourceOwner = await person(),
      sourceId = randomUUID(),
      channelId = randomUUID(),
      jobId = randomUUID();
    await http(
      'POST',
      '/api/v1/projects',
      {
        id: sourceId,
        title: 'Synthetic guarded source',
        retentionPolicyVersion: version,
      },
      sourceOwner.cookie,
      { 'Idempotency-Key': randomUUID() },
    );
    await http(
      'POST',
      '/api/v1/conversations',
      {
        id: channelId,
        kind: 'PROJECT',
        sourceId,
        title: 'Synthetic guarded channel',
        participants: [],
      },
      sourceOwner.cookie,
      { 'Idempotency-Key': randomUUID() },
    );
    await http(
      'POST',
      '/api/v1/conversations/' + channelId + '/messages',
      { id: randomUUID(), text: 'Preserve source channel history' },
      sourceOwner.cookie,
      { 'Idempotency-Key': randomUUID() },
    );
    await db.query('BEGIN');
    try {
      await db.query(
        `UPDATE "ContextAccess" SET state='LEFT',"endedAt"=GREATEST(clock_timestamp(),"joinedAt"),revision=revision+1 WHERE "spaceId"=$1`,
        [sourceId],
      );
      await db.query(
        `UPDATE "ContextAccessInterval" i SET "endedAt"=a."endedAt" FROM "ContextAccess" a WHERE a.id=i."accessId" AND a.generation=i.generation AND a."spaceId"=$1`,
        [sourceId],
      );
      await db.query(
        `INSERT INTO "SharedLifecycleJob"(id,"custodyId","spaceId",generation,state,"effectiveDepartureAt","recoveryDeadline","retentionPolicyVersion","nextAt") VALUES($1,$2,$2,1,'CLEANUP_PENDING',clock_timestamp()-interval '40 days',clock_timestamp()-interval '10 days',$3,clock_timestamp())`,
        [jobId, sourceId, version],
      );
      await db.query(
        `UPDATE "SharedCustody" SET state='CLEANUP_PENDING',"closureGeneration"=1 WHERE "spaceId"=$1`,
        [sourceId],
      );
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
    const guarded = async () =>
      (
        await db.query('SELECT state FROM "SharedLifecycleJob" WHERE id=$1', [
          jobId,
        ])
      ).rows[0].state === 'BLOCKED_POLICY';
    await workerPass(guarded);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM "ConversationMessage" WHERE "conversationId"=$1',
          [channelId],
        )
      ).rows[0].n,
      1,
    );
    await stop(api);
    api = await apiStart();
    const replay = await http(
      'POST',
      '/api/v1/conversations/' + id + '/messages',
      input,
      owner.cookie,
      { 'Idempotency-Key': key },
    );
    assert.deepEqual(replay.body, sent.body);
    const caught = c.ConversationMessagePageSchema.parse(
      (
        await http(
          'GET',
          '/api/v1/conversations/' +
            id +
            '/messages?cursor=' +
            encodeURIComponent(history.nextCursor),
          undefined,
          recipient.cookie,
        )
      ).body,
    );
    assert.deepEqual(caught.items, []);
    assert.equal(caught.nextCursor, history.nextCursor);
    await workerPass(guarded);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM "ConversationMessage" WHERE "conversationId"=$1',
          [id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM "SharedOutboxEvent" WHERE action=$1 AND "spaceId"=$2',
          ['messaging.message.send', id],
        )
      ).rows[0].n,
      1,
    );
    await stop(api);
    process.stdout.write(
      'PASS: fresh compiled API restart preserves accepted DM, ordered history, reusable polling cursor, send idempotency and one audit/outbox effect; actual worker advances source disposal to BLOCKED_POLICY before destructive work and preserves that state across worker restart.\n',
    );
  } finally {
    await db.end();
  }
} finally {
  for (const child of [...children]) await stop(child);
  try {
    if (owned) {
      assert.match(name, /^p501_smoke_[a-f0-9]{32}_test$/);
      assert.notEqual(name, new URL(original).pathname.slice(1));
      await control.query('DROP DATABASE "' + name + '" WITH (FORCE)');
    }
  } finally {
    await control.end();
  }
}
