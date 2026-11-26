import path from 'node:path';
import fs from 'node:fs';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import { TeamsService } from '../../src/modules/teams/public/index.js';
import { EngagementDelivery } from '../../src/modules/notifications/public/engagement-delivery.js';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { testApplication } from '../support/application.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import {
  CommunicationsService,
  SupportService,
  SupportInboundRuntime,
  EngagementEvidence,
} from '../../src/modules/admin-engagement/public/index.js';
import { PostgresSupportInbound } from '../../src/modules/admin-engagement/support-inbound.adapter.js';
import {
  SupportInboundProcessor,
  type VerifiedInboundReply,
} from '../../src/platform/admin/support-inbound.js';
import { AtomicSupportInboundStore } from '../../src/platform/admin/support-inbound-store.js';
const sharedRoot = path.resolve('.tools/p4-shared-' + randomUUID());
const secret =
  'test-only-secret-for-foundation-contracts-at-least-32-characters';
let box: Awaited<ReturnType<typeof migrationSandbox>>,
  app: NestExpressApplication,
  db: DatabaseService;
type Actor = { id: string; cookie: string; sessionId: string };
let owner: Actor,
  other: Actor,
  super1: Actor,
  super2: Actor,
  support: Actor,
  reviewer: Actor;
const signed = (token: string, prefix: string) =>
  prefix +
  '.session_token=' +
  encodeURIComponent(
    token + '.' + createHmac('sha256', secret).update(token).digest('base64'),
  );
async function user(verified = true): Promise<Actor> {
  const user = await db.client.user.create({
    data: {
      email: randomUUID() + '@example.test',
      name: 'P4 owner',
      emailVerified: verified,
      settings: { create: {} },
    },
  });
  await db.client.space.create({ data: { ownerUserId: user.id } });
  const session = await db.client.authSession.create({
    data: {
      userId: user.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return {
    id: user.id,
    cookie: signed(session.token, 'better-auth'),
    sessionId: session.id,
  };
}
async function admin(role: string): Promise<Actor> {
  const row = await db.client.adminUser.create({
      data: {
        email: randomUUID() + '@example.test',
        name: 'P4 operator',
        role,
        twoFactorEnabled: true,
        mfaEnrolledAt: new Date(0),
      },
    }),
    session = await db.client.adminSession.create({
      data: {
        userId: row.id,
        token: randomUUID(),
        createdAt: new Date(Date.now() - 1000),
        mfaVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
  return {
    id: row.id,
    cookie: signed(session.token, 'mehran-admin'),
    sessionId: session.id,
  };
}
const get = (actor: Actor, path: string) =>
  request(app.getHttpServer())
    .get('/api/v1/' + path)
    .set('Cookie', actor.cookie);
const post = (actor: Actor, path: string, body: object, key = randomUUID()) =>
  request(app.getHttpServer())
    .post('/api/v1/' + path)
    .set('Cookie', actor.cookie)
    .set('Origin', 'http://localhost:3000')
    .set('Idempotency-Key', key)
    .send(body);
const general = '00000000-0000-4000-8000-000000000116';
async function ticket() {
  return (
    await post(owner, 'support/tickets', {
      queueId: general,
      subject: 'Private support',
      category: 'GENERAL',
      body: 'User supplied ticket',
    }).expect(200)
  ).body as { id: string; revision: number };
}
beforeAll(async () => {
  box = await migrationSandbox(process.env);
  const deployed = spawnSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--config',
      'prisma.config.ts',
    ],
    { env: { ...process.env, DATABASE_URL: box.url }, encoding: 'utf8' },
  );
  if (deployed.status !== 0) throw new Error(deployed.stdout + deployed.stderr);
  const schema = new URL(box.url).searchParams.get('schema')!,
    client = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: isolatedTestDatabaseUrl(process.env),
          options: '-c search_path=' + schema + ' -c timezone=UTC',
        },
        { schema },
      ),
    });
  app = await testApplication({
    databaseInstance: {
      client,
      checkConnection: async () => {
        await client.$queryRaw`SELECT 1`;
      },
      onApplicationShutdown: () => client.$disconnect(),
    } as DatabaseService,
    environment: {
      SHARED_CONTROL_ROOT: sharedRoot,
      SHARED_CONTROL_KEYS: JSON.stringify({
        p4: Buffer.from(
          'synthetic-only-p4-control-material-at-least-48-bytes',
        ).toString('base64url'),
      }),
      SHARED_CONTROL_ACTIVE_KEY_ID: 'p4',
      SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P4-TEST',
      NOTIFICATION_EMAIL_ENABLED: 'true',
      MAIL_MODE: 'sink',
      PUSH_MODE: 'sink',
    },
  });
  db = app.get(DatabaseService);
  await app.get(SharedControl).initialize();
  owner = await user();
  other = await user();
  super1 = await admin('SUPER_ADMIN');
  super2 = await admin('SUPER_ADMIN');
  support = await admin('SUPPORT');
  reviewer = await admin('SECURITY_REVIEWER');
}, 60000);
afterAll(async () => {
  await app?.close();
  await box?.close();
  if (
    sharedRoot.startsWith(path.resolve('.tools') + path.sep) &&
    path.basename(sharedRoot).startsWith('p4-shared-')
  )
    fs.rmSync(sharedRoot, { recursive: true, force: true });
});
it('creates registered-user tickets and preserves ownership, idempotency and ordinary/Admin isolation', async () => {
  const unverified = await user(false);
  const unverifiedSpace = await db.client.space.findFirstOrThrow({
      where: { ownerUserId: unverified.id },
    }),
    unverifiedTask = await db.client.task.create({
      data: {
        spaceId: unverifiedSpace.id,
        createdByUserId: unverified.id,
        title: 'Verification-bound source',
      },
    });
  await post(unverified, 'moderation/reports', {
    kind: 'TASK',
    targetId: unverifiedTask.id,
    category: 'ABUSE',
    description: 'Requires source access',
  }).expect(403);

  await post(unverified, 'support/tickets', {
    queueId: general,
    subject: 'Unverified support',
    category: 'GENERAL',
    body: 'Please help',
  }).expect(200);
  const key = randomUUID(),
    b = {
      queueId: general,
      subject: 'One ticket',
      category: 'GENERAL',
      body: 'Body',
    };
  const a = await post(owner, 'support/tickets', b, key).expect(200),
    again = await post(owner, 'support/tickets', b, key).expect(200);
  expect(again.body.id).toBe(a.body.id);
  await post(owner, 'support/tickets', { ...b, body: 'Changed' }, key).expect(
    409,
  );
  await get(other, 'support/tickets/' + a.body.id).expect(404);
  await get(owner, 'admin/support/tickets').expect(401);
  await get(support, 'admin/communications').expect(403);
});
it('keeps internal notes out of public replies, receipts and audit payloads', async () => {
  const t = await ticket();
  await post(support, 'admin/support/tickets/' + t.id + '/replies', {
    revision: t.revision,
    body: 'CONFIDENTIAL-INTERNAL-NOTE',
    internal: true,
    reason: 'Case handling',
  }).expect(200);
  const ordinary = await get(owner, 'support/tickets/' + t.id).expect(200);
  expect(JSON.stringify(ordinary.body)).not.toContain('CONFIDENTIAL');
  expect(
    (
      await get(support, 'admin/support/tickets/' + t.id).expect(200)
    ).body.replies.some((r: { internal: boolean }) => r.internal),
  ).toBe(true);
  const audit = await db.client.adminAuditEvent.findMany({
    where: { actorAdminId: support.id },
  });
  expect(JSON.stringify(audit)).not.toContain('CONFIDENTIAL');
});
it('manually assigns eligible operators and enforces revision and lifecycle/reopen windows', async () => {
  const t = await ticket();
  await post(support, 'admin/support/tickets/' + t.id + '/assign', {
    revision: 1,
    assigneeAdminId: reviewer.id,
    queueId: general,
    priority: 'HIGH',
    category: 'GENERAL',
    reason: 'Transfer',
  }).expect(403);
  let r = await post(support, 'admin/support/tickets/' + t.id + '/assign', {
    revision: 1,
    assigneeAdminId: support.id,
    queueId: general,
    priority: 'HIGH',
    category: 'GENERAL',
    reason: 'Manual assignment',
  }).expect(200);
  await post(owner, 'support/tickets/' + t.id + '/replies', {
    revision: 1,
    body: 'Stale',
  }).expect(409);
  r = await post(support, 'admin/support/tickets/' + t.id + '/state', {
    revision: r.body.revision,
    state: 'RESOLVED',
    reason: 'Done',
  }).expect(200);
  await post(owner, 'support/tickets/' + t.id + '/reopen', {
    revision: r.body.revision,
  }).expect(200);
  await db.client.supportTicket.update({
    where: { id: t.id },
    data: { state: 'CLOSED', resolvedAt: new Date(Date.now() - 8 * 86400000) },
  });
  await post(owner, 'support/tickets/' + t.id + '/reopen', {
    revision: 4,
  }).expect(409);
});
it('stores scanned private evidence, blocks foreign downloads and keeps referenced blobs protected', async () => {
  const t = await ticket(),
    upload = await post(owner, 'support/tickets/' + t.id + '/evidence', {
      filename: 'evidence.txt',
      mediaType: 'text/plain',
      base64: Buffer.from('User-provided support evidence').toString('base64'),
    }).expect(200);
  await get(
    other,
    'support/tickets/' + t.id + '/evidence?evidenceId=' + upload.body.id,
  ).expect(404);
  const response = await get(
    owner,
    'support/tickets/' + t.id + '/evidence?evidenceId=' + upload.body.id,
  ).expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['content-disposition']).toContain('attachment');
  const row = await db.client.p4Evidence.findUniqueOrThrow({
    where: { id: upload.body.id },
  });
  expect(row.scanEngine).not.toBe('PENDING');
  await app.get(EngagementEvidence).sweep();
  expect(await db.client.p4Evidence.count({ where: { id: row.id } })).toBe(1);
});
it('keeps the real inbound runtime disabled and applies authenticated fixture replies through PostgreSQL and storage', async () => {
  expect((await app.get(SupportInboundRuntime).receive({})).code).toBe(
    'INBOUND_DISABLED',
  );
  const t = await ticket(),
    token = await post(owner, 'support/tickets/' + t.id + '/email-token', {
      revision: 1,
    }).expect(200),
    u = await db.client.user.findUniqueOrThrow({ where: { id: owner.id } });
  const envelope: VerifiedInboundReply = {
    providerMessageId: randomUUID(),
    messageId: randomUUID(),
    senderEmail: u.email,
    envelopeRecipient: 'support+' + token.body.token + '@inbound.example.test',
    receivedAt: new Date(),
    subject: 'Reply',
    text: 'Authenticated inbound content',
    autoSubmitted: 'no',
    precedence: null,
    returnPath: u.email,
    attachments: [
      {
        filename: 'mail.txt',
        mediaType: 'text/plain',
        content: Buffer.from('Mail evidence'),
      },
    ],
  };
  const processor = new SupportInboundProcessor(
    {
      transportId: 'trusted-test-only',
      verifyConfiguration: async () => true,
      authenticate: async () => envelope,
    },
    new AtomicSupportInboundStore(app.get(PostgresSupportInbound)),
    app.get(EngagementEvidence),
    'inbound.example.test',
  );
  expect((await processor.receive({})).state).toBe('ACCEPTED');
  expect((await processor.receive({})).state).toBe('DUPLICATE');
  envelope.text = 'Changed replay';
  expect((await processor.receive({})).state).toBe('REJECTED');
  expect(
    await db.client.supportReply.count({
      where: { ticketId: t.id, source: 'EMAIL' },
    }),
  ).toBe(1);
  expect(
    await db.client.p4Evidence.count({
      where: { ticketId: t.id, state: 'ATTACHED' },
    }),
  ).toBe(1);
  expect(
    await db.client.supportInboundReceipt.count({ where: { ticketId: t.id } }),
  ).toBe(1);
});
it('binds inbound correlation to current verified sender and handles concurrent duplicates once', async () => {
  const t = await ticket(),
    token = (
      await post(owner, 'support/tickets/' + t.id + '/email-token', {
        revision: 1,
      }).expect(200)
    ).body.token,
    u = await db.client.user.findUniqueOrThrow({ where: { id: owner.id } });
  const e: VerifiedInboundReply = {
    providerMessageId: randomUUID(),
    messageId: randomUUID(),
    senderEmail: u.email,
    envelopeRecipient: 'support+' + token + '@inbound.example.test',
    receivedAt: new Date(),
    subject: 'Reply',
    text: 'Concurrent',
    autoSubmitted: 'no',
    precedence: null,
    returnPath: u.email,
    attachments: [],
  };
  const processor = new SupportInboundProcessor(
    {
      transportId: 'trusted-test-only',
      verifyConfiguration: async () => true,
      authenticate: async () => e,
    },
    new AtomicSupportInboundStore(app.get(PostgresSupportInbound)),
    app.get(EngagementEvidence),
    'inbound.example.test',
  );
  const results = await Promise.all([
    processor.receive({}),
    processor.receive({}),
  ]);
  expect(results.map((r) => r.state).sort()).toEqual(['ACCEPTED', 'DUPLICATE']);
  e.messageId = randomUUID();
  e.providerMessageId = randomUUID();
  e.senderEmail = 'attacker@example.test';
  expect((await processor.receive({})).state).toBe('REJECTED');
});
async function template() {
  const created = await post(super1, 'admin/communications/templates', {
    name: randomUUID(),
    version: 1,
    fallbackLocale: 'en',
    translations: [
      {
        locale: 'en',
        subject: 'Hello {{recipientName}}',
        body: 'Approved {{publicReason}}',
      },
      {
        locale: 'fa',
        subject: 'سلام {{recipientName}}',
        body: 'پیام {{publicReason}}',
      },
    ],
    reason: 'Approved notice',
  }).expect(200);
  await post(
    super1,
    'admin/communications/templates/' + created.body.id + '/approve',
    { reason: 'Content review' },
  ).expect(200);
  return created.body.id as string;
}
it('previews, tests and sends localized durable in-app communication with preferences and deduplication', async () => {
  const templateId = await template();
  await db.client.userSettings.update({
    where: { userId: owner.id },
    data: { locale: 'fa' },
  });
  let r = await post(super1, 'admin/communications/preview', {
    templateId,
    kind: 'DIRECT',
    audience: { kind: 'USERS', userIds: [owner.id] },
    channels: ['IN_APP'],
    variables: { publicReason: 'Notice' },
    reason: 'Direct notice',
  }).expect(200);
  const id = r.body.id;
  expect(r.body.recipients).toBe(1);
  r = await post(super1, 'admin/communications/' + id + '/test', {
    revision: 1,
    reason: 'Test preview',
  }).expect(200);
  r = await post(super1, 'admin/communications/' + id + '/send', {
    revision: 2,
    reason: 'Publish',
  }).expect(200);
  expect(r.body.state).toBe('SCHEDULED');
  const worker = app.get(CommunicationsService);
  expect(await worker.consume()).toBe(true);
  await worker.consume();
  const inbox = await get(owner, 'communications/inbox').expect(200);
  expect(inbox.body.items).toHaveLength(1);
  expect(inbox.body.items[0].locale).toBe('fa');
  expect(inbox.body.items[0].subject).toContain('سلام');
  expect(
    (await get(other, 'communications/inbox').expect(200)).body.items,
  ).toHaveLength(0);
  await worker.sweep();
  expect(
    (await db.client.adminCommunication.findUniqueOrThrow({ where: { id } }))
      .state,
  ).toBe('COMPLETE');
});
it('requires a different currently authorized approver for global broadcasts and supports cancellation', async () => {
  const templateId = await template();
  let r = await post(super1, 'admin/communications/preview', {
    templateId,
    kind: 'GLOBAL',
    audience: { kind: 'GLOBAL' },
    channels: ['IN_APP'],
    variables: { publicReason: 'Broadcast' },
    reason: 'Broadcast preview',
  }).expect(200);
  const id = r.body.id;
  await post(super1, 'admin/communications/' + id + '/test', {
    revision: 1,
    reason: 'Test',
  }).expect(200);
  await post(super1, 'admin/communications/' + id + '/approve', {
    revision: 2,
    reason: 'Self approval',
  }).expect(403);
  await post(super1, 'admin/communications/' + id + '/send', {
    revision: 2,
    reason: 'No approval',
  }).expect(403);
  await post(super2, 'admin/communications/' + id + '/approve', {
    revision: 2,
    reason: 'Independent review',
  }).expect(200);
  r = await post(super1, 'admin/communications/' + id + '/send', {
    revision: 3,
    reason: 'Approved send',
  }).expect(200);
  await post(super1, 'admin/communications/' + id + '/cancel', {
    revision: r.body.revision,
    reason: 'Cancel before send',
  }).expect(200);
  expect(await app.get(CommunicationsService).consume()).toBe(false);
  expect(
    await db.client.adminCommunicationRecipient.count({
      where: { communicationId: id, state: 'SENT' },
    }),
  ).toBe(0);
});
it('reconciles interrupted external delivery conservatively without sending a second network attempt', async () => {
  const templateId = await template();
  const c = await db.client.adminCommunication.create({
    data: {
      templateId,
      kind: 'DIRECT',
      audience: { kind: 'USERS', userIds: [owner.id] },
      variables: { publicReason: 'N' },
      channels: ['EMAIL'],
      createdByAdminId: super1.id,
      state: 'SCHEDULED',
      expiresAt: new Date(Date.now() + 60000),
      scheduledAt: new Date(),
    },
  });
  await db.client.adminCommunicationRecipient.create({
    data: {
      communicationId: c.id,
      userId: owner.id,
      channel: 'EMAIL',
      intent: randomUUID(),
      state: 'SENDING',
      leaseUntil: new Date(0),
      networkStartedAt: new Date(),
      attempts: 1,
    },
  });
  expect(await app.get(CommunicationsService).consume()).toBe(true);
  const row = await db.client.adminCommunicationRecipient.findFirstOrThrow({
    where: { communicationId: c.id },
  });
  expect(row.state).toBe('AMBIGUOUS');
  expect(row.attempts).toBe(1);
});
it('limits moderator content to the exact reported item and records every access without granting membership', async () => {
  const space = await db.client.space.findFirstOrThrow({
    where: { ownerUserId: owner.id },
  });
  const task = await db.client.task.create({
      data: {
        spaceId: space.id,
        createdByUserId: owner.id,
        title: 'Exact reported task',
        descriptionContent: 'PRIVATE-CASE-CONTENT',
      },
    }),
    unrelated = await db.client.task.create({
      data: {
        spaceId: space.id,
        createdByUserId: owner.id,
        title: 'UNRELATED-PRIVATE-ITEM',
      },
    });
  const report = await post(owner, 'moderation/reports', {
      kind: 'TASK',
      targetId: task.id,
      category: 'ABUSE',
      description: 'Review this exact item',
    }).expect(200),
    id = report.body.id;
  await get(
    support,
    'admin/moderation/cases/' + id + '/content?reason=Review',
  ).expect(403);
  const body = (
    await get(
      reviewer,
      'admin/moderation/cases/' + id + '/content?reason=Review',
    ).expect(200)
  ).body;
  expect(body.itemId).toBe(task.id);
  expect(JSON.stringify(body)).toContain('PRIVATE-CASE-CONTENT');
  expect(JSON.stringify(body)).not.toContain('UNRELATED');
  await get(
    reviewer,
    'admin/moderation/cases/' +
      id +
      '/content?reason=Review&itemId=' +
      unrelated.id,
  ).expect(400);
  const events = await db.client.adminAuditEvent.findMany({
    where: {
      actorAdminId: reviewer.id,
      action: 'GET moderation/cases/:id/content',
    },
  });
  expect(events.some((e) => e.outcome === 'SUCCEEDED')).toBe(true);
  expect(JSON.stringify(events)).not.toContain('PRIVATE-CASE-CONTENT');
  expect(
    await db.client.sharedActor.count({ where: { adminUserId: reviewer.id } }),
  ).toBe(0);
});
it('denies foreign reports, manually applies bounded penalties and requires an independent appeal reviewer', async () => {
  const space = await db.client.space.findFirstOrThrow({
      where: { ownerUserId: other.id },
    }),
    noteId = randomUUID();
  await db.client.note.create({
    data: {
      id: noteId,
      logicalId: noteId,
      spaceId: space.id,
      createdByUserId: other.id,
      title: 'Foreign note',
      content: 'Private',
      createdAt: new Date('2026-11-26T00:00:00Z'),
      recordedAt: new Date('2026-11-26T00:00:00Z'),
    },
  });
  await post(owner, 'moderation/reports', {
    kind: 'NOTE',
    targetId: noteId,
    category: 'ABUSE',
    description: 'Unauthorized reference',
  }).expect(404);
  let r = await post(other, 'moderation/reports', {
    kind: 'ACCOUNT',
    targetId: owner.id,
    category: 'ABUSE',
    description: 'Account behavior',
  }).expect(200);
  const id = r.body.id;
  await post(reviewer, 'admin/moderation/cases/' + id + '/penalty', {
    revision: 1,
    action: 'WARNING',
    publicReason: 'Review needed',
    reason: 'Premature penalty',
  }).expect(409);
  r = await post(reviewer, 'admin/moderation/cases/' + id + '/state', {
    revision: 1,
    state: 'TRIAGED',
    reason: 'Triage',
  }).expect(200);
  r = await post(reviewer, 'admin/moderation/cases/' + id + '/state', {
    revision: 2,
    state: 'INVESTIGATING',
    reason: 'Manual review',
  }).expect(200);
  r = await post(reviewer, 'admin/moderation/cases/' + id + '/penalty', {
    revision: 3,
    action: 'RESTRICT_REPORTING',
    until: new Date(Date.now() + 3600000).toISOString(),
    publicReason: 'Temporary reporting restriction',
    reason: 'Manual determination',
  }).expect(200);
  await post(owner, 'moderation/reports', {
    kind: 'ACCOUNT',
    targetId: other.id,
    category: 'ABUSE',
    description: 'Blocked new report',
  }).expect(403);
  r = await post(owner, 'moderation/reports/' + id + '/appeal', {
    revision: r.body.revision,
    text: 'Please independently review',
  }).expect(200);
  await post(reviewer, 'admin/moderation/cases/' + id + '/state', {
    revision: r.body.revision,
    state: 'INVESTIGATING',
    reason: 'Original reviewer',
  }).expect(409);
  r = await post(super2, 'admin/moderation/cases/' + id + '/state', {
    revision: r.body.revision,
    state: 'INVESTIGATING',
    reason: 'Independent appeal review',
  }).expect(200);
  await post(super2, 'admin/moderation/cases/' + id + '/state', {
    revision: r.body.revision,
    state: 'DISMISSED',
    publicOutcome: 'Appeal accepted',
    internalOutcome: 'CONFIDENTIAL-REVIEW',
    reason: 'Independent decision',
  }).expect(200);
  expect(
    JSON.stringify(
      (await get(owner, 'moderation/reports/' + id).expect(200)).body,
    ),
  ).not.toContain('CONFIDENTIAL');
});
it('does not allow a moderator to inherit account suspension authority', async () => {
  let r = await post(other, 'moderation/reports', {
    kind: 'ACCOUNT',
    targetId: owner.id,
    category: 'SECURITY',
    description: 'Review possible abuse',
  }).expect(200);
  const id = r.body.id;
  r = await post(reviewer, 'admin/moderation/cases/' + id + '/state', {
    revision: 1,
    state: 'TRIAGED',
    reason: 'Triage',
  }).expect(200);
  r = await post(reviewer, 'admin/moderation/cases/' + id + '/state', {
    revision: 2,
    state: 'INVESTIGATING',
    reason: 'Review',
  }).expect(200);
  await post(reviewer, 'admin/moderation/cases/' + id + '/penalty', {
    revision: 3,
    action: 'SUSPEND_ACCOUNT',
    publicReason: 'Suspension',
    reason: 'Wrong secondary permission',
  }).expect(403);
  expect(
    (
      await db.client.userSettings.findUniqueOrThrow({
        where: { userId: owner.id },
      })
    ).suspendedAt,
  ).toBeNull();
});
it('honors per-type channel preferences and exposes late-ticket notices only to authorized operators', async () => {
  await request(app.getHttpServer())
    .patch('/api/v1/communications/preferences')
    .set('Cookie', owner.cookie)
    .set('Origin', 'http://localhost:3000')
    .set('Idempotency-Key', randomUUID())
    .send({
      kind: 'DIRECT',
      inApp: false,
      email: false,
      webPush: false,
      revision: 1,
    })
    .expect(200);
  const templateId = await template(),
    r = await post(super1, 'admin/communications/preview', {
      templateId,
      kind: 'DIRECT',
      audience: { kind: 'USERS', userIds: [owner.id] },
      channels: ['IN_APP'],
      variables: { publicReason: 'Optional' },
      reason: 'Preference test',
    }).expect(200);
  const id = r.body.id;
  await post(super1, 'admin/communications/' + id + '/test', {
    revision: 1,
    reason: 'Test',
  }).expect(200);
  await post(super1, 'admin/communications/' + id + '/send', {
    revision: 2,
    reason: 'Send',
  }).expect(200);
  await app.get(CommunicationsService).consume();
  expect(
    (
      await db.client.adminCommunicationRecipient.findFirstOrThrow({
        where: { communicationId: id },
      })
    ).state,
  ).toBe('SUPPRESSED');
  const t = await ticket();
  await db.client.supportTicket.update({
    where: { id: t.id },
    data: { slaDueAt: new Date(0), assigneeAdminId: support.id },
  });
  await app.get(SupportService).sweep();
  expect(
    (await get(support, 'admin/support/notices').expect(200)).body.items.some(
      (n: { ticketId: string }) => n.ticketId === t.id,
    ),
  ).toBe(true);
  expect(
    (await get(owner, 'support/notices').expect(200)).body.items.some(
      (n: { kind: string }) => n.kind === 'SUPPORT_SLA_LATE',
    ),
  ).toBe(false);
});
it('rolls back the entire inbound reply and rate budget when evidence cannot be linked', async () => {
  const t = await ticket(),
    token = (
      await post(owner, 'support/tickets/' + t.id + '/email-token', {
        revision: 1,
      }).expect(200)
    ).body.token,
    u = await db.client.user.findUniqueOrThrow({ where: { id: owner.id } }),
    messageId = randomUUID();
  const e: VerifiedInboundReply = {
    providerMessageId: randomUUID(),
    messageId,
    senderEmail: u.email,
    envelopeRecipient: 'support+' + token + '@inbound.example.test',
    receivedAt: new Date(),
    subject: 'Reply',
    text: 'Must roll back',
    autoSubmitted: 'no',
    precedence: null,
    returnPath: u.email,
    attachments: [],
  };
  const processor = new SupportInboundProcessor(
    {
      transportId: 'trusted-test-only',
      verifyConfiguration: async () => true,
      authenticate: async () => e,
    },
    new AtomicSupportInboundStore(app.get(PostgresSupportInbound)),
    {
      stage: async () => [{ id: randomUUID(), digest: '0'.repeat(64) }],
      cleanup: async () => {},
    },
    'inbound.example.test',
  );
  expect((await processor.receive({})).state).toBe('REJECTED');
  expect(
    await db.client.supportReply.count({
      where: { ticketId: t.id, source: 'EMAIL' },
    }),
  ).toBe(0);
  expect(
    await db.client.supportInboundReceipt.count({ where: { ticketId: t.id } }),
  ).toBe(0);
});
it('enforces inbound sender and ticket budgets in PostgreSQL without losing accepted replies', async () => {
  const recipient = await user(),
    t = (
      await post(recipient, 'support/tickets', {
        queueId: general,
        subject: 'Inbound rate',
        category: 'GENERAL',
        body: 'Body',
      }).expect(200)
    ).body,
    token = (
      await post(recipient, 'support/tickets/' + t.id + '/email-token', {
        revision: 1,
      }).expect(200)
    ).body.token,
    u = await db.client.user.findUniqueOrThrow({ where: { id: recipient.id } });
  const e: VerifiedInboundReply = {
    providerMessageId: randomUUID(),
    messageId: randomUUID(),
    senderEmail: u.email,
    envelopeRecipient: 'support+' + token + '@inbound.example.test',
    receivedAt: new Date(),
    subject: 'Reply',
    text: 'Rate-limited inbound',
    autoSubmitted: 'no',
    precedence: null,
    returnPath: u.email,
    attachments: [],
  };
  const processor = new SupportInboundProcessor(
    {
      transportId: 'trusted-test-only',
      verifyConfiguration: async () => true,
      authenticate: async () => e,
    },
    new AtomicSupportInboundStore(app.get(PostgresSupportInbound)),
    app.get(EngagementEvidence),
    'inbound.example.test',
  );
  for (let n = 0; n < 11; n++) {
    e.messageId = randomUUID();
    e.providerMessageId = randomUUID();
    expect((await processor.receive({})).state).toBe(
      n < 10 ? 'ACCEPTED' : 'REJECTED',
    );
  }
  expect(
    await db.client.supportReply.count({
      where: { ticketId: t.id, source: 'EMAIL' },
    }),
  ).toBe(10);
});
it('records unavailable push devices honestly and publishes a zero-device campaign without claiming a push', async () => {
  const templateId = await template(),
    r = await post(super1, 'admin/communications/preview', {
      templateId,
      kind: 'DIRECT',
      audience: { kind: 'USERS', userIds: [owner.id] },
      channels: ['WEB_PUSH'],
      variables: { publicReason: 'Device check' },
      reason: 'Push availability',
    }).expect(200);
  expect(r.body.recipients).toBe(1);
  const id = r.body.id;
  expect(
    (await get(super1, 'admin/communications/' + id + '/targets').expect(200))
      .body.items,
  ).toEqual([{ userId: owner.id, pushState: 'NO_VALID_DEVICE' }]);
  await post(super1, 'admin/communications/' + id + '/test', {
    revision: 1,
    reason: 'Test',
  }).expect(200);
  await post(super1, 'admin/communications/' + id + '/send', {
    revision: 2,
    reason: 'Schedule',
  }).expect(200);
  await app.get(CommunicationsService).sweep();
  expect(
    (await db.client.adminCommunication.findUniqueOrThrow({ where: { id } }))
      .state,
  ).toBe('COMPLETE');
  expect(
    await db.client.adminCommunicationRecipient.count({
      where: { communicationId: id },
    }),
  ).toBe(0);
});
it('isolates immutable templates, validates policy updates and requires persisted recent MFA for writes', async () => {
  await post(super1, 'admin/communications/templates', {
    name: 'Bad',
    version: 1,
    fallbackLocale: 'en',
    translations: [{ locale: 'en', subject: 'Bad', body: '{{password}}' }],
    reason: 'Invalid variable',
  }).expect(409);
  const expired = await admin('SUPER_ADMIN');
  await db.client.adminSession.update({
    where: { id: expired.sessionId },
    data: { mfaVerifiedAt: new Date(Date.now() - 600000) },
  });
  await post(expired, 'admin/support/queues', {
    name: 'No recent MFA',
    slaMinutes: 60,
    reason: 'Test',
  }).expect(403);
  await request(app.getHttpServer())
    .post('/api/v1/admin/support/queues')
    .set('Cookie', super1.cookie)
    .set('Idempotency-Key', randomUUID())
    .set('Origin', 'https://attacker.test')
    .send({ name: 'Forged', slaMinutes: 60, reason: 'Bad origin' })
    .expect(403);
  const q = await post(super1, 'admin/support/queues', {
    name: 'Priority-' + randomUUID(),
    slaMinutes: 60,
    reason: 'Queue configuration',
  }).expect(200);
  expect(q.body.slaMinutes).toBe(60);
  await request(app.getHttpServer())
    .patch('/api/v1/admin/engagement/policies/SUPPORT')
    .set('Cookie', super1.cookie)
    .set('Origin', 'http://localhost:3000')
    .set('Idempotency-Key', randomUUID())
    .send({
      revision: 1,
      value: {
        reopenDays: 91,
        archiveDays: 100,
        retentionDays: 365,
        inboundTokenDays: 30,
      },
      reason: 'Invalid window',
      previewId: randomUUID(),
      impactFingerprint: 'a'.repeat(64),
      impactAcknowledged: true,
    })
    .expect(409);
});
it('uses the database constraints to reject untyped sources and forged ticket relations', async () => {
  await expect(
    db.client.supportReply.create({
      data: { ticketId: randomUUID(), body: 'Foreign' },
    }),
  ).rejects.toThrow();
  const space = await db.client.space.findFirstOrThrow({
      where: { ownerUserId: owner.id },
    }),
    task = await db.client.task.create({
      data: {
        spaceId: space.id,
        createdByUserId: owner.id,
        title: 'Constraint target',
      },
    });
  await expect(
    db.client.moderationCase.create({
      data: {
        sourceKind: 'ACCOUNT',
        taskId: task.id,
        category: 'INVALID',
        description: 'Incorrect typed reference',
        dedupHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
      },
    }),
  ).rejects.toThrow();
});
it('exports public Support records without internal notes and disposes owner evidence through the real worker', async () => {
  const subject = await user(),
    t = (
      await post(subject, 'support/tickets', {
        queueId: general,
        subject: 'Portability',
        category: 'GENERAL',
        body: 'PUBLIC-EXPORT-BODY',
      }).expect(200)
    ).body;
  await post(support, 'admin/support/tickets/' + t.id + '/replies', {
    revision: 1,
    body: 'DO-NOT-EXPORT-INTERNAL',
    internal: true,
    reason: 'Private handling',
  }).expect(200);
  const upload = await post(subject, 'support/tickets/' + t.id + '/evidence', {
    filename: 'owned.txt',
    mediaType: 'text/plain',
    base64: Buffer.from('Owned evidence').toString('base64'),
  }).expect(200);
  const { EngagementData } =
      await import('../../src/modules/admin-engagement/public/engagement-data.js'),
    { ExportBudget } =
      await import('../../src/platform/lifecycle/personal-data.js'),
    { SpacesService } =
      await import('../../src/modules/spaces/public/index.js');
  const scope = await app.get(SpacesService).authorizePersonal({
      userId: subject.id,
      sessionId: subject.sessionId,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    }),
    budget = new ExportBudget();
  await db.client.$transaction((tx) =>
    app.get(EngagementData).snapshot(tx, scope, budget),
  );
  expect(JSON.stringify(budget.sections)).toContain('PUBLIC-EXPORT-BODY');
  expect(JSON.stringify(budget.sections)).not.toContain(
    'DO-NOT-EXPORT-INTERNAL',
  );
  await db.client.$transaction((tx) =>
    app.get(EngagementData).erase(tx, scope),
  );
  expect(
    (
      await db.client.p4Evidence.findUniqueOrThrow({
        where: { id: upload.body.id },
      })
    ).state,
  ).toBe('DELETING');
  await app.get(EngagementEvidence).sweep();
  expect(
    await db.client.p4Evidence.count({ where: { id: upload.body.id } }),
  ).toBe(0);
  expect(
    await db.client.supportTicket.count({ where: { ownerUserId: owner.id } }),
  ).toBeGreaterThan(0);
});
it('recovers an explicitly retryable provider rejection and fences concurrent delivery workers', async () => {
  const recipient = await user(),
    space = await db.client.space.findFirstOrThrow({
      where: { ownerUserId: recipient.id },
    });
  await db.client.notificationPreference.create({
    data: {
      spaceId: space.id,
      ownerUserId: recipient.id,
      createdByUserId: recipient.id,
      email: true,
    },
  });
  const templateId = await template(),
    r = await post(super1, 'admin/communications/preview', {
      templateId,
      kind: 'DIRECT',
      audience: { kind: 'USERS', userIds: [recipient.id] },
      channels: ['EMAIL'],
      variables: { publicReason: 'Retry behavior' },
      reason: 'Durable test',
    }).expect(200);
  const id = r.body.id;
  await post(super1, 'admin/communications/' + id + '/test', {
    revision: 1,
    reason: 'Test',
  }).expect(200);
  await post(super1, 'admin/communications/' + id + '/send', {
    revision: 2,
    reason: 'Send',
  }).expect(200);
  const delivery = vi
    .spyOn(app.get(EngagementDelivery), 'send')
    .mockResolvedValueOnce({ outcome: 'RETRY', code: 'SMTP_TEMPORARY' })
    .mockResolvedValue({ outcome: 'ACCEPTED', code: 'SMTP_ACCEPTED' });
  try {
    await app.get(CommunicationsService).consume();
    let row = await db.client.adminCommunicationRecipient.findFirstOrThrow({
      where: { communicationId: id },
    });
    expect(row.state).toBe('PENDING');
    expect(row.attempts).toBe(1);
    expect(row.networkStartedAt).toBeNull();
    await db.client.adminCommunicationRecipient.update({
      where: { id: row.id },
      data: { nextAt: new Date(0) },
    });
    await Promise.all([
      app.get(CommunicationsService).consume(),
      app.get(CommunicationsService).consume(),
    ]);
    row = await db.client.adminCommunicationRecipient.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(row.state).toBe('SENT');
    expect(row.attempts).toBe(2);
    expect(delivery).toHaveBeenCalledTimes(2);
  } finally {
    delivery.mockRestore();
  }
});
it('does not send before schedule or after initiating authority is revoked', async () => {
  const recipient = await user(),
    templateId = await template(),
    scheduledAt = new Date(Date.now() + 3600000).toISOString(),
    r = await post(super1, 'admin/communications/preview', {
      templateId,
      kind: 'DIRECT',
      audience: { kind: 'USERS', userIds: [recipient.id] },
      channels: ['IN_APP'],
      scheduledAt,
      variables: { publicReason: 'Scheduled' },
      reason: 'Schedule',
    }).expect(200);
  const id = r.body.id;
  await post(super1, 'admin/communications/' + id + '/test', {
    revision: 1,
    reason: 'Test',
  }).expect(200);
  await post(super1, 'admin/communications/' + id + '/send', {
    revision: 2,
    reason: 'Schedule',
  }).expect(200);
  await app.get(CommunicationsService).consume();
  expect(
    (
      await db.client.adminCommunicationRecipient.findFirstOrThrow({
        where: { communicationId: id },
      })
    ).attempts,
  ).toBe(0);
  await db.client.adminCommunication.update({
    where: { id },
    data: { scheduledAt: new Date(0) },
  });
  await db.client.adminCommunicationRecipient.updateMany({
    where: { communicationId: id },
    data: { nextAt: new Date(0) },
  });
  await db.client.adminUser.update({
    where: { id: super1.id },
    data: { active: false },
  });
  try {
    await app.get(CommunicationsService).consume();
    expect(
      (
        await db.client.adminCommunicationRecipient.findFirstOrThrow({
          where: { communicationId: id },
        })
      ).lastCode,
    ).toBe('OPERATOR_AUTHORITY_CHANGED');
  } finally {
    await db.client.adminUser.update({
      where: { id: super1.id },
      data: { active: true },
    });
  }
});
it('includes Support through the composed Personal export runtime without exposing operator notes', async () => {
  const subject = await user(),
    t = (
      await post(subject, 'support/tickets', {
        queueId: general,
        subject: 'Runtime portability',
        category: 'GENERAL',
        body: 'COMPOSED-SUPPORT-EXPORT',
      }).expect(200)
    ).body;
  await post(support, 'admin/support/tickets/' + t.id + '/replies', {
    revision: 1,
    body: 'COMPOSED-INTERNAL-SECRET',
    internal: true,
    reason: 'Private note',
  }).expect(200);
  const ownEvidence = await post(
    subject,
    'support/tickets/' + t.id + '/evidence',
    {
      filename: 'export.txt',
      mediaType: 'text/plain',
      base64: Buffer.from('P4-OWNED-ZIP-EVIDENCE').toString('base64'),
    },
  ).expect(200);
  const { hashPassword } = await import('better-auth/crypto');
  await db.client.authAccount.create({
    data: {
      userId: subject.id,
      accountId: subject.id,
      providerId: 'credential',
      password: await hashPassword('p4-export-test-password!'),
    },
  });
  const { PersonalLifecycle } =
      await import('../../src/modules/account/public/index.js'),
    { SpacesService } =
      await import('../../src/modules/spaces/public/index.js');
  const lifecycle = app.get(PersonalLifecycle),
    scope = await app.get(SpacesService).authorizePersonal({
      userId: subject.id,
      sessionId: subject.sessionId,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    }),
    job = await lifecycle.requestExport(scope, randomUUID(), {
      password: 'p4-export-test-password!',
    });
  for (let n = 0; n < 10; n++) {
    if ((await lifecycle.exportStatus(scope, job.id)).state !== 'QUEUED') break;
    await lifecycle.consume();
  }
  const status = await lifecycle.exportStatus(scope, job.id);
  expect(status.state).toBe('READY');
  const artifact = await lifecycle.download(
      scope,
      job.id,
      status.downloadProof!,
    ),
    chunks: Buffer[] = [];
  for await (const chunk of artifact.stream)
    chunks.push(Buffer.from(chunk as Uint8Array));
  const body = Buffer.concat(chunks).toString('utf8');
  expect(body).toContain('COMPOSED-SUPPORT-EXPORT');
  expect(body).not.toContain('COMPOSED-INTERNAL-SECRET');
  expect(body).toContain(ownEvidence.body.id);
  const archive = await lifecycle.archive(scope, job.id, status.downloadProof!);
  const zipChunks: Buffer[] = [];
  for await (const chunk of archive)
    zipChunks.push(Buffer.from(chunk as Uint8Array));
  const zip = Buffer.concat(zipChunks);
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  expect(zip.toString('utf8')).toContain('files/' + ownEvidence.body.id);
  expect(zip.toString('utf8')).toContain('P4-OWNED-ZIP-EVIDENCE');
  expect(zip.toString('utf8')).not.toContain('COMPOSED-INTERNAL-SECRET');
  const { EngagementData } =
    await import('../../src/modules/admin-engagement/public/engagement-data.js');
  const manifest = await db.client.$transaction((tx) =>
    app.get(EngagementData).manifest(tx, scope, 100),
  );
  const item = manifest.find((r) => r.id === ownEvidence.body.id)!;
  expect(item).toBeDefined();
  await expect(
    db.client.$transaction((tx) =>
      app
        .get(EngagementData)
        .bytes(tx, scope, { ...item, sha256: 'a'.repeat(64) }),
    ),
  ).rejects.toThrow();
  const foreignScope = await app.get(SpacesService).authorizePersonal({
    userId: other.id,
    sessionId: other.sessionId,
    requestId: randomUUID(),
    correlationId: randomUUID(),
  });
  await expect(
    db.client.$transaction((tx) =>
      app.get(EngagementData).bytes(tx, foreignScope, item),
    ),
  ).rejects.toThrow();
  await db.client.p4Evidence.update({
    where: { id: item.id },
    data: { state: 'DELETING' },
  });
  await expect(
    lifecycle.download(scope, job.id, status.downloadProof!, item.id),
  ).rejects.toThrow();
});
it('denies reported-source reads after its owning space closes while preserving case evidence boundaries', async () => {
  const subject = await user(),
    space = await db.client.space.findFirstOrThrow({
      where: { ownerUserId: subject.id },
    }),
    task = await db.client.task.create({
      data: {
        spaceId: space.id,
        createdByUserId: subject.id,
        title: 'Case source',
      },
    }),
    report = await post(subject, 'moderation/reports', {
      kind: 'TASK',
      targetId: task.id,
      category: 'AVAILABILITY',
      description: 'Exact source',
    }).expect(200);
  await db.client.space.update({
    where: { id: space.id },
    data: { accessClosedAt: new Date() },
  });
  try {
    await get(
      reviewer,
      'admin/moderation/cases/' +
        report.body.id +
        '/content?reason=Current%20source',
    ).expect(404);
  } finally {
    await db.client.space.update({
      where: { id: space.id },
      data: { accessClosedAt: null },
    });
  }
});
it('authorizes Workspace-linked Support and membership audiences through the existing Shared kernel without granting access', async () => {
  const version = 'p4-team-fixture',
    rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER', 'ADMIN'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
  await db.client.sharedRetentionPolicy.create({
    data: {
      version,
      approvalReference: 'SYNTHETIC-P4',
      configuration: {
        policyVersion: version,
        approvalReference: 'SYNTHETIC-P4',
        accountableOperator: 'fixture',
        applicableContexts: ['PROJECT', 'TEAM', 'COMPANY'],
        marketScope: 'test only',
        sharedRecoverySeconds: 604800,
        classRules: {
          workContent: rule,
          commentsHistory: rule,
          filesDerivatives: rule,
          exports: rule,
          accessAuditLifecycle: rule,
        },
        obligations: [],
        holds: [],
        backupPolicyReference: 'independent fixture',
      },
    },
  });
  const team = randomUUID();
  await app.get(TeamsService).create(
    {
      userId: owner.id,
      sessionId: owner.sessionId,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    },
    { id: team, title: 'P4 scoped team', retentionPolicyVersion: version },
    randomUUID(),
  );
  const ticket = await post(owner, 'support/tickets', {
    queueId: general,
    subject: 'Team support',
    category: 'GENERAL',
    body: 'User-provided context',
    scopeId: team,
  }).expect(200);
  expect(ticket.body.spaceId).toBe(team);
  await post(other, 'support/tickets', {
    queueId: general,
    subject: 'Foreign context',
    category: 'GENERAL',
    body: 'No membership',
    scopeId: team,
  }).expect(404);
  const templateId = await template(),
    preview = await post(super1, 'admin/communications/preview', {
      templateId,
      kind: 'GROUP',
      audience: { kind: 'WORKSPACE', scopeId: team },
      channels: ['IN_APP'],
      variables: { publicReason: 'Team notice' },
      reason: 'Scoped audience',
    }).expect(200);
  expect(preview.body.targetUserIds).toEqual([owner.id]);
  expect(
    await db.client.sharedActor.count({
      where: { spaceId: team, adminUserId: super1.id },
    }),
  ).toBe(0);
});
it('persists a real security escalation and exposes its work notice only through the Security permission', async () => {
  const r = await post(other, 'moderation/reports', {
      kind: 'ACCOUNT',
      targetId: owner.id,
      category: 'ESCALATION',
      description: 'Security review requested',
    }).expect(200),
    id = r.body.id;
  await post(reviewer, 'admin/moderation/cases/' + id + '/state', {
    revision: 1,
    state: 'TRIAGED',
    reason: 'Triage',
  }).expect(200);
  await post(reviewer, 'admin/moderation/cases/' + id + '/state', {
    revision: 2,
    state: 'INVESTIGATING',
    reason: 'Investigation',
  }).expect(200);
  await post(reviewer, 'admin/moderation/cases/' + id + '/penalty', {
    revision: 3,
    action: 'ESCALATE_SECURITY',
    publicReason: 'Escalated for security review',
    reason: 'Independent security assessment',
  }).expect(200);
  const inbox = await get(reviewer, 'admin/moderation/escalations').expect(200),
    notice = inbox.body.items.find(
      (row: { caseId: string }) => row.caseId === id,
    );
  expect(notice).toBeTruthy();
  await get(support, 'admin/moderation/escalations').expect(403);
  await post(
    reviewer,
    'admin/moderation/escalations/' + notice.id + '/read',
    {},
  ).expect(200);
});
it('reuses P1 account suspension, session revocation and durable owner notification for an authorized penalty', async () => {
  const subject = await user(),
    report = await post(other, 'moderation/reports', {
      kind: 'ACCOUNT',
      targetId: subject.id,
      category: 'ENFORCEMENT',
      description: 'Manual suspension review',
    }).expect(200),
    id = report.body.id;
  await post(super1, 'admin/moderation/cases/' + id + '/state', {
    revision: 1,
    state: 'TRIAGED',
    reason: 'Triage',
  }).expect(200);
  await post(super1, 'admin/moderation/cases/' + id + '/state', {
    revision: 2,
    state: 'INVESTIGATING',
    reason: 'Review',
  }).expect(200);
  await post(super1, 'admin/moderation/cases/' + id + '/penalty', {
    revision: 3,
    action: 'SUSPEND_ACCOUNT',
    until: new Date(Date.now() + 3600000).toISOString(),
    publicReason: 'Public suspension explanation',
    reason: 'Manual enforcement',
  }).expect(200);
  expect(
    await db.client.authSession.count({ where: { userId: subject.id } }),
  ).toBe(0);
  expect(
    (
      await db.client.userSettings.findUniqueOrThrow({
        where: { userId: subject.id },
      })
    ).suspensionReason,
  ).toBe('Public suspension explanation');
  expect(
    await db.client.adminDelivery.count({
      where: { targetUserId: subject.id, kind: 'ACCOUNT_CHANGED' },
    }),
  ).toBe(1);
  expect(
    (
      await db.client.space.findFirstOrThrow({
        where: { ownerUserId: subject.id },
      })
    ).suspendedAt,
  ).toBeNull();
});

it('requires a fresh actor-bound retention impact preview, acknowledgement and unchanged exact candidate set', async () => {
  const policyPath = 'admin/engagement/policies/SUPPORT';
  const current = await db.client.p4Policy.findUniqueOrThrow({
    where: { section: 'SUPPORT' },
  });
  const original = current.value as Record<string, number>;
  const proposed = { ...original, retentionDays: 180 };
  const input = {
    revision: current.revision,
    value: proposed,
    reason: 'Reviewed retention test',
  };
  const makeOld = () =>
    db.client.supportTicket.create({
      data: {
        ownerUserId: owner.id,
        queueId: general,
        subject: 'Retention candidate',
        category: 'GENERAL',
        slaDueAt: new Date(0),
        state: 'RESOLVED',
        resolvedAt: new Date(Date.now() - 200 * 86400000),
      },
    });
  await makeOld();
  await post(support, policyPath + '/preview', input).expect(403);
  const preview = await post(super1, policyPath + '/preview', input).expect(
    200,
  );
  expect(preview.body.impact.deleteRecords).toBeGreaterThanOrEqual(1);
  const publish = (actor: Actor, body: object, key = randomUUID()) =>
    request(app.getHttpServer())
      .patch('/api/v1/' + policyPath)
      .set('Cookie', actor.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('Idempotency-Key', key)
      .send(body);
  const command = {
    ...input,
    previewId: preview.body.id,
    impactFingerprint: preview.body.impact.fingerprint,
    impactAcknowledged: true,
  };
  await publish(super2, command).expect(409);
  await publish(super1, { ...command, impactAcknowledged: false }).expect(400);
  await publish(super1, {
    ...command,
    value: { ...proposed, retentionDays: 179 },
  }).expect(409);
  await publish(super1, {
    ...command,
    impactFingerprint: 'b'.repeat(64),
  }).expect(409);
  await makeOld();
  await publish(super1, command).expect(409);
  const fresh = await post(super1, policyPath + '/preview', input).expect(200);
  const key = randomUUID();
  const approved = {
    ...command,
    previewId: fresh.body.id,
    impactFingerprint: fresh.body.impact.fingerprint,
  };
  const competingKey = randomUUID();
  const competing = await Promise.all([
    publish(super1, approved, key),
    publish(super1, approved, competingKey),
  ]);
  expect(competing.map((r) => r.status).sort()).toEqual([200, 409]);
  await publish(
    super1,
    approved,
    competing[0]!.status === 200 ? key : competingKey,
  ).expect(200);
  const changed = await db.client.p4Policy.findUniqueOrThrow({
    where: { section: 'SUPPORT' },
  });
  expect(changed.revision).toBe(current.revision + 1);
  await publish(super1, approved).expect(409);
  const restoreInput = {
    revision: changed.revision,
    value: original,
    reason: 'Restore retained test defaults',
  };
  const restore = await post(
    super1,
    policyPath + '/preview',
    restoreInput,
  ).expect(200);
  const receipt = await db.client.adminMutationReceipt.findFirstOrThrow({
    where: { result: { path: ['id'], equals: restore.body.id } },
  });
  await db.client.adminMutationReceipt.update({
    where: {
      actorAdminId_operation_keyHash: {
        actorAdminId: receipt.actorAdminId,
        operation: receipt.operation,
        keyHash: receipt.keyHash,
      },
    },
    data: { result: { ...restore.body, expiresAt: new Date(0).toISOString() } },
  });
  await publish(super1, {
    ...restoreInput,
    previewId: restore.body.id,
    impactFingerprint: restore.body.impact.fingerprint,
    impactAcknowledged: true,
  }).expect(409);
  const last = await post(super1, policyPath + '/preview', restoreInput).expect(
    200,
  );
  await publish(super1, {
    ...restoreInput,
    previewId: last.body.id,
    impactFingerprint: last.body.impact.fingerprint,
    impactAcknowledged: true,
  }).expect(200);
  const audit = await db.client.adminAuditEvent.findFirstOrThrow({
    where: { action: 'PATCH engagement/policies/:id', outcome: 'SUCCEEDED' },
    orderBy: { createdAt: 'desc' },
  });
  expect(JSON.stringify(audit.metadata)).toContain('impact');
});
