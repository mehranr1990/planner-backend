import { MessagingExtensionsService } from '../../src/modules/messaging/application/messaging-extensions.service.js';
import 'reflect-metadata';
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { randomUUID, randomBytes, createECDH, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setImmediate as tick } from 'node:timers/promises';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PersonalLifecycle } from '../../src/modules/account/public/index.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { DatabaseService } from '../../src/platform/database/database.service.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import {
  SharedKernel,
  CollaborationService,
  MessagingAuthority,
  SharedFeaturePolicy,
  CompanyAccess,
} from '../../src/modules/spaces/public/index.js';
import { MessagingService } from '../../src/modules/messaging/public/index.js';
import { AdvancedMessagingService } from '../../src/modules/messaging/application/advanced-messaging.service.js';
import {
  ProjectsService,
  ProjectCleanupService,
} from '../../src/modules/projects/public/index.js';
import { TeamsService } from '../../src/modules/teams/public/index.js';
import { CompaniesService } from '../../src/modules/companies/public/index.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import { Readable } from 'node:stream';
import { MessageMediaService } from '../../src/modules/messaging/application/message-media.service.js';
import { MessageProgressService } from '../../src/modules/messaging/application/message-progress.service.js';
import { MessageNotices } from '../../src/modules/messaging/application/message-notices.service.js';
import { MessageNoticeWorker } from '../../src/modules/messaging/public/index.js';
import { MessagingPush } from '../../src/modules/notifications/public/index.js';
type Person = { actor: RequestActor; email: string };
const barrier = () => {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
};
const outcome = (p: Promise<unknown>) =>
  p.then(
    (value) => ({ value, error: undefined }),
    (error) => ({ value: undefined, error }),
  );
describe('P5-01 durable messaging, explicit participation and polling', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    db: PrismaClient,
    messages: MessagingService,
    advanced: AdvancedMessagingService,
    media: MessageMediaService,
    progress: MessageProgressService,
    notices: MessageNotices,
    messagingWorker: MessageNoticeWorker,
    messagingPush: MessagingPush,
    kernel: SharedKernel,
    collaboration: CollaborationService,
    auth: AuthService,
    control: SharedControl,
    projects: ProjectsService,
    teams: TeamsService,
    companies: CompaniesService,
    watcher: Client,
    passwordHash: string;
  let owner: Person,
    alice: Person,
    bob: Person,
    viewer: Person,
    outsider: Person;
  const version = 'synthetic-p501-' + randomUUID(),
    password = 'Synthetic-messaging-test-only-123!',
    origin = 'http://localhost:3000',
    applicationName = 'p501-' + randomUUID(),
    page = { limit: 50 };
  async function person(verified = true): Promise<Person> {
    const userId = randomUUID(),
      sessionId = randomUUID(),
      email = randomUUID() + '@example.test';
    await db.user.create({
      data: {
        id: userId,
        name: 'Synthetic messaging participant',
        email,
        emailVerified: verified,
      },
    });
    await db.space.create({
      data: { id: randomUUID(), kind: 'PERSONAL', ownerUserId: userId },
    });
    await db.userSettings.create({ data: { userId } });
    await db.authAccount.create({
      data: {
        id: randomUUID(),
        userId,
        accountId: userId,
        providerId: 'credential',
        password: passwordHash,
      },
    });
    await db.authSession.create({
      data: {
        id: sessionId,
        userId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    return {
      email,
      actor: {
        userId,
        sessionId,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
    };
  }
  async function cookie(who: Person) {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email: who.email, password })
      .expect(200);
    return (login.headers['set-cookie'] as unknown as string[])
      .map((v) => v.split(';')[0])
      .join('; ');
  }
  async function create(
    kind: 'DM' | 'PRIVATE_GROUP' = 'PRIVATE_GROUP',
    participants: Person[] = [alice],
  ) {
    return messages.create(
      owner.actor,
      kind === 'DM'
        ? {
            id: randomUUID(),
            kind,
            participants: [participants[0]!.actor.userId],
            retentionPolicyVersion: version,
          }
        : {
            id: randomUUID(),
            kind,
            title: 'Private conversation',
            participants: participants.map((p) => p.actor.userId),
            retentionPolicyVersion: version,
          },
      randomUUID(),
    );
  }
  async function accept(id: string, who = alice) {
    const offers = await messages.invitations(who.actor, page),
      invite = offers.items.find((v) => v.conversationId === id);
    expect(invite).toBeDefined();
    return messages.decide(who.actor, invite!.id, invite!.revision, true);
  }
  async function send(
    id: string,
    who = owner,
    text = 'Private text',
    key: string = randomUUID(),
    messageId: string = randomUUID(),
  ) {
    return messages.send(who.actor, id, { id: messageId, text }, key);
  }
  async function member(id: string, who = alice) {
    const local = await db.sharedActor.findFirstOrThrow({
      where: {
        spaceId: (await db.conversation.findUniqueOrThrow({ where: { id } }))
          .spaceId,
        userId: who.actor.userId,
      },
    });
    return db.conversationMember.findUniqueOrThrow({
      where: {
        conversationId_actorId: { conversationId: id, actorId: local.id },
      },
    });
  }
  async function work(kind: 'PROJECT' | 'TEAM' | 'COMPANY' = 'PROJECT') {
    const input = {
      id: randomUUID(),
      title: 'Authorized source',
      retentionPolicyVersion: version,
    };
    return kind === 'PROJECT'
      ? projects.create(owner.actor, input, randomUUID())
      : kind === 'TEAM'
        ? teams.create(owner.actor, input, randomUUID())
        : companies.create(owner.actor, input, randomUUID());
  }
  async function join(
    id: string,
    who = alice,
    role: 'MEMBER' | 'VIEWER' | 'ADMIN' = 'MEMBER',
    kind: 'PROJECT' | 'TEAM' = 'PROJECT',
  ) {
    const offer = await collaboration.createInvitation(
      owner.actor,
      id,
      {
        kind: 'MEMBERSHIP',
        memberRole: role,
        recipient: { userId: who.actor.userId },
      },
      randomUUID(),
    );
    const result = await collaboration.decideInvitation(
      who.actor,
      offer.invitation.id,
      offer.proof!,
      1,
      true,
      kind,
    );
    if (!('membership' in result)) throw Error('Missing source membership');
    return result.membership;
  }
  async function channel(
    sourceId: string,
    kind: 'PROJECT' | 'TEAM' | 'COMPANY' = 'PROJECT',
    participants: Person[] = [alice],
  ) {
    return messages.create(
      owner.actor,
      {
        id: randomUUID(),
        kind,
        sourceId,
        title: 'Work channel',
        participants: participants.map((p) => p.actor.userId),
      },
      randomUUID(),
    );
  }
  async function blocked() {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = await watcher.query<{ n: number }>(
        `SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0`,
        [applicationName],
      );
      if (rows.rows[0]!.n > 0) return;
      await tick();
    }
    throw Error('Expected observable PostgreSQL lock waiter');
  }
  beforeAll(async () => {
    sandbox = await migrationSandbox(process.env);
    const deployed = spawnSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--config',
        'prisma.config.ts',
      ],
      { env: { ...process.env, DATABASE_URL: sandbox.url }, encoding: 'utf8' },
    );
    if (deployed.status !== 0)
      throw Error('Owned messaging schema deploy failed; credentials withheld');
    const schema = new URL(sandbox.url).searchParams.get('schema')!,
      base = isolatedTestDatabaseUrl(process.env);
    db = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: base,
          options: '-c search_path=' + schema + ' -c timezone=UTC',
          application_name: applicationName,
          max: 8,
        },
        { schema },
      ),
    });
    const database: DatabaseService = {
      client: db,
      checkConnection: async () => {
        await db.$queryRaw`SELECT 1`;
      },
      onApplicationShutdown: () => db.$disconnect(),
    };
    const root = fs.mkdtempSync(path.resolve('.tools/messaging-test-'));
    app = await testApplication({
      databaseUrl: base,
      databaseInstance: database,
      environment: {
        STORAGE_ROOT: path.join(root, 'files'),
        PUSH_MODE: 'sink',
        NOTIFICATION_SINK_DIR: path.join(root, 'notifications'),
        PERSONAL_ERASURE_POLICY_VERSION: 'synthetic-p503-erasure',
        SHARED_CONTROL_ROOT: path.join(root, 'control'),
        SHARED_CONTROL_KEYS: JSON.stringify({
          k1: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'k1',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P501-ONLY',
      },
    });
    control = app.get(SharedControl);
    await control.initialize();
    messages = app.get(MessagingService);
    advanced = app.get(AdvancedMessagingService);
    media = app.get(MessageMediaService);
    progress = app.get(MessageProgressService);
    notices = app.get(MessageNotices);
    messagingWorker = app.get(MessageNoticeWorker);
    messagingPush = app.get(MessagingPush);
    kernel = app.get(SharedKernel);
    collaboration = app.get(CollaborationService);
    auth = app.get(AuthService);
    projects = app.get(ProjectsService);
    teams = app.get(TeamsService);
    companies = app.get(CompaniesService);
    passwordHash = await (await auth.auth.$context).password.hash(password);
    watcher = new Client({ connectionString: base });
    await watcher.connect();
    const rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER', 'ADMIN'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
    await db.sharedRetentionPolicy.create({
      data: {
        version,
        approvalReference: 'SYNTHETIC-P501-ONLY',
        configuration: {
          policyVersion: version,
          approvalReference: 'SYNTHETIC-P501-ONLY',
          accountableOperator: 'synthetic operator',
          applicableContexts: ['PROJECT', 'TEAM', 'COMPANY', 'CONVERSATION'],
          marketScope: 'isolated fixture',
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
          backupPolicyReference: 'synthetic independent controls',
        },
      },
    });
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    owner = await person();
    alice = await person();
    bob = await person();
    viewer = await person();
    outsider = await person();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await watcher?.end();
    await db?.$disconnect();
    await sandbox?.close();
  });

  it('consolidated gaps: returns current Team and conversation capabilities and private display names', async () => {
    const team = await work('TEAM');
    await join(team.id, alice, 'VIEWER', 'TEAM');
    expect(await teams.accessMe(owner.actor, team.id)).toMatchObject({
      role: 'OWNER',
      capabilities: expect.arrayContaining([
        'settings.manage',
        'conversation.create',
        'announcement.publish',
      ]),
    });
    const view = await teams.accessMe(alice.actor, team.id);
    expect(view.role).toBe('VIEWER');
    expect(view.capabilities).not.toContain('settings.manage');
    await expect(teams.accessMe(outsider.actor, team.id)).rejects.toThrow();
    const people = await teams.members(owner.actor, team.id, { limit: 25 });
    expect(
      people.items.every(
        (m) => m.displayName === 'Synthetic messaging participant',
      ),
    ).toBe(true);
    expect(JSON.stringify(people)).not.toContain(alice.email);
    expect(JSON.stringify(people)).not.toContain(alice.actor.userId);
    const conv = await create();
    await expect(messages.accessMe(alice.actor, conv.id)).rejects.toThrow();
    await accept(conv.id);
    expect(await messages.accessMe(owner.actor, conv.id)).toMatchObject({
      role: 'ADMIN',
      capabilities: expect.arrayContaining([
        'conversation.rename',
        'membership.manage',
      ]),
    });
    expect(
      (await messages.accessMe(alice.actor, conv.id)).capabilities,
    ).not.toContain('conversation.rename');
    const roster = await messages.members(owner.actor, conv.id, page);
    expect(
      roster.items.every(
        (m) => m.displayName === 'Synthetic messaging participant',
      ),
    ).toBe(true);
    await messages.leave(
      alice.actor,
      conv.id,
      (await member(conv.id)).revision,
    );
    expect(
      (await messages.members(owner.actor, conv.id, page)).items.find(
        (r) => r.id === roster.items.find((r) => r.role === 'MEMBER')!.id,
      )?.displayName,
    ).toBeNull();
  });
  it('consolidated gaps: lists only own pending Team offers without disclosing or bypassing proofs', async () => {
    const team = await work('TEAM');
    const offer = await collaboration.createInvitation(
      owner.actor,
      team.id,
      {
        kind: 'MEMBERSHIP',
        memberRole: 'MEMBER',
        recipient: { email: alice.email },
      },
      randomUUID(),
    );
    const mine = await collaboration.pendingOffers(alice.actor, 'TEAM', {
      limit: 25,
    });
    expect(mine.items).toEqual([
      {
        id: offer.invitation.id,
        contextLabel: 'Team',
        revision: 1,
        expiresAt: offer.invitation.expiresAt,
      },
    ]);
    expect(
      (await collaboration.pendingOffers(bob.actor, 'TEAM', { limit: 25 }))
        .items,
    ).toEqual([]);
    expect(
      (
        await collaboration.pendingSent(owner.actor, team.id, { limit: 25 })
      ).items.map((r) => r.id),
    ).toContain(offer.invitation.id);
    await expect(
      collaboration.pendingSent(outsider.actor, team.id, { limit: 25 }),
    ).rejects.toThrow();
    await expect(
      collaboration.decideInvitation(
        alice.actor,
        offer.invitation.id,
        undefined,
        1,
        true,
        'TEAM',
      ),
    ).rejects.toThrow();
    await collaboration.decideInvitation(
      alice.actor,
      offer.invitation.id,
      offer.proof!,
      1,
      true,
      'TEAM',
    );
    expect(
      (await collaboration.pendingOffers(alice.actor, 'TEAM', { limit: 25 }))
        .items,
    ).toEqual([]);
  });
  it('consolidated gaps: summaries honor read floors, private mute, own sends, hides and deletes', async () => {
    const conv = await create();
    await send(conv.id, owner, 'Before join');
    await accept(conv.id);
    const summary = async () =>
      (await media.conversations(alice.actor, page)).items.find(
        (r) => r.id === conv.id,
      )!;
    expect(await summary()).toMatchObject({
      lastMessage: null,
      unreadCount: 0,
      muted: false,
    });
    const incoming = await send(conv.id, owner, 'Incoming');
    expect(await summary()).toMatchObject({
      lastMessage: { id: incoming.id, text: 'Incoming' },
      unreadCount: 1,
    });
    await send(conv.id, alice, 'My own message');
    expect((await summary()).unreadCount).toBe(1);
    await progress.acknowledge(
      alice.actor,
      conv.id,
      { messageId: incoming.id, state: 'READ' },
      randomUUID(),
    );
    expect((await summary()).unreadCount).toBe(0);
    await progress.setNoticeSettings(
      alice.actor,
      conv.id,
      { mode: 'MUTED', quietStart: null, quietEnd: null, mentionQuiet: false },
      randomUUID(),
      1,
    );
    expect((await summary()).muted).toBe(true);
    expect(
      (await media.conversations(owner.actor, page)).items.find(
        (r) => r.id === conv.id,
      )!.muted,
    ).toBe(false);
    const hidden = await send(conv.id, owner, 'Hidden');
    await advanced.act(
      alice.actor,
      conv.id,
      { action: 'hide', messageId: hidden.id },
      randomUUID(),
    );
    const deleted = await send(conv.id, owner, 'Deleted');
    await advanced.act(
      owner.actor,
      conv.id,
      { action: 'delete', messageId: deleted.id },
      randomUUID(),
      1,
    );
    expect(await summary()).toMatchObject({
      unreadCount: 0,
      lastMessage: { text: 'My own message' },
    });
    expect((await media.conversations(outsider.actor, page)).items).toEqual([]);
  });
  it('consolidated gaps: renames require administration and serialize stale writers; invitation lists are scoped', async () => {
    const conv = await create();
    expect(
      (await messages.sentInvitations(owner.actor, conv.id, page)).items,
    ).toHaveLength(1);
    await accept(conv.id);
    expect(
      (await messages.sentInvitations(owner.actor, conv.id, page)).items,
    ).toHaveLength(0);
    await expect(
      messages.sentInvitations(alice.actor, conv.id, page),
    ).rejects.toThrow();
    const revision = (await messages.get(owner.actor, conv.id)).revision;
    await expect(
      messages.rename(alice.actor, conv.id, revision, {
        title: 'Unauthorized',
      }),
    ).rejects.toThrow();
    const results = await Promise.allSettled(
      ['First', 'Second'].map((title) =>
        messages.rename(owner.actor, conv.id, revision, { title }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await messages.get(owner.actor, conv.id)).revision).toBe(
      revision + 1,
    );
    const dm = await create('DM');
    await expect(
      messages.rename(owner.actor, dm.id, dm.revision, { title: 'DM title' }),
    ).rejects.toThrow();
    const ownerCookie = await cookie(owner);
    await request(app.getHttpServer())
      .patch('/api/v1/conversations/' + conv.id)
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .send({ title: 'Missing revision' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/conversations/' + conv.id)
      .set('Cookie', ownerCookie)
      .set('Origin', origin)
      .set('If-Match', '"' + (revision + 1) + '"')
      .send({ title: 'HTTP rename' })
      .expect(200)
      .expect('ETag', '"' + (revision + 2) + '"');
    await request(app.getHttpServer())
      .get('/api/v1/conversations')
      .set('Cookie', ownerCookie)
      .expect(200)
      .then((response) =>
        expect(
          c.ConversationSummaryPageSchema.safeParse(response.body).success,
        ).toBe(true),
      );
  });
  it('consolidated gaps: forwarding summaries disappear when source authority is revoked', async () => {
    const source = await create(),
      target = await create();
    await accept(source.id);
    await accept(target.id);
    const msg = await send(source.id);
    const fid = randomUUID();
    await advanced.act(
      owner.actor,
      target.id,
      {
        action: 'forward',
        id: fid,
        sourceConversationId: source.id,
        sourceId: msg.id,
      },
      randomUUID(),
    );
    expect(
      (await media.conversations(alice.actor, page)).items.find(
        (r) => r.id === target.id,
      ),
    ).toMatchObject({
      unreadCount: 1,
      lastMessage: { id: fid, text: msg.text },
    });
    const admission = await member(source.id);
    await messages.changeMember(
      owner.actor,
      source.id,
      admission.id,
      admission.revision,
      null,
    );
    expect(
      (await media.conversations(alice.actor, page)).items.find(
        (r) => r.id === target.id,
      ),
    ).toMatchObject({ unreadCount: 0, lastMessage: null });
  });
  it('requires explicit DM acceptance, current named recipient, and a fixed pair', async () => {
    const conv = await create('DM');
    expect(conv.writable).toBe(false);
    await expect(send(conv.id)).rejects.toThrow();
    await expect(messages.get(alice.actor, conv.id)).rejects.toThrow();
    const offer = (await messages.invitations(alice.actor, page)).items[0]!;
    await expect(
      messages.decide(outsider.actor, offer.id, 1, true),
    ).rejects.toThrow();
    await accept(conv.id);
    expect((await send(conv.id)).sequence).toBe('1');
    await expect(
      messages.invite(
        owner.actor,
        conv.id,
        (await messages.get(owner.actor, conv.id)).revision,
        { id: randomUUID(), userId: bob.actor.userId },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('atomically rolls back independent custody, participants and offers for an invalid recipient', async () => {
    const id = randomUUID(),
      before = await db.sharedAuditEvent.count();
    await expect(
      messages.create(
        owner.actor,
        {
          id,
          kind: 'PRIVATE_GROUP',
          title: 'Invalid',
          participants: [randomUUID()],
          retentionPolicyVersion: version,
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
    expect(await db.conversation.findUnique({ where: { id } })).toBeNull();
    expect(
      await db.sharedCustody.findUnique({ where: { spaceId: id } }),
    ).toBeNull();
    expect(await db.sharedAuditEvent.count()).toBe(before);
  });
  it('replays creation without duplicate custody or invitations and rejects changed request content', async () => {
    const input = {
        id: randomUUID(),
        kind: 'PRIVATE_GROUP' as const,
        title: 'Retry',
        participants: [alice.actor.userId],
        retentionPolicyVersion: version,
      },
      key = randomUUID();
    await messages.create(owner.actor, input, key);
    await messages.create(owner.actor, input, key);
    expect(
      await db.conversationInvitation.count({
        where: { conversationId: input.id },
      }),
    ).toBe(1);
    await expect(
      messages.create(owner.actor, { ...input, title: 'Changed' }, key),
    ).rejects.toThrow();
  });
  it('persists a single send under concurrent retries with atomic ordered metadata-only effects', async () => {
    const conv = await create();
    await accept(conv.id);
    const input = {
        id: randomUUID(),
        text: 'Never place this private body in audit',
      },
      key = randomUUID();
    const [a, b] = await Promise.all([
      messages.send(owner.actor, conv.id, input, key),
      messages.send(owner.actor, conv.id, input, key),
    ]);
    expect(a).toEqual(b);
    expect(a.sequence).toBe('1');
    const audit = await db.sharedAuditEvent.findMany({
        where: { resourceId: a.id },
      }),
      outbox = await db.sharedOutboxEvent.findMany({
        where: { auditId: { in: audit.map((v) => v.id) } },
      });
    expect(audit).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(
      JSON.stringify({ audit, outbox }, (_key, value) =>
        typeof value === 'bigint' ? String(value) : value,
      ),
    ).not.toContain(input.text);
    await expect(
      messages.send(owner.actor, conv.id, { ...input, text: 'changed' }, key),
    ).rejects.toThrow();
    await expect(
      messages.send(owner.actor, conv.id, input, randomUUID()),
    ).rejects.toThrow();
  });
  it('returns reusable empty polling cursors and bounded pages without skipping later commits', async () => {
    const conv = await create();
    await accept(conv.id);
    const empty = await messages.messages(alice.actor, conv.id, { limit: 2 });
    expect(empty.items).toEqual([]);
    expect(empty.hasMore).toBe(false);
    await Promise.all([
      send(conv.id, owner, 'one'),
      send(conv.id, owner, 'two'),
      send(conv.id, alice, 'three'),
    ]);
    const first = await messages.messages(alice.actor, conv.id, {
      limit: 2,
      cursor: empty.nextCursor,
    });
    expect(first.items.map((v) => v.sequence)).toEqual(['1', '2']);
    expect(first.hasMore).toBe(true);
    const second = await messages.messages(alice.actor, conv.id, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((v) => v.sequence)).toEqual(['3']);
    const end = await messages.messages(alice.actor, conv.id, {
      limit: 2,
      cursor: second.nextCursor,
    });
    expect(end.items).toEqual([]);
    expect(end.nextCursor).toBe(second.nextCursor);
    await send(conv.id);
    expect(
      (
        await messages.messages(alice.actor, conv.id, {
          limit: 2,
          cursor: end.nextCursor,
        })
      ).items[0]!.sequence,
    ).toBe('4');
  });
  it('hides pre-join private history and invalidates old cursors and sends after explicit rejoin', async () => {
    const conv = await create();
    await send(conv.id, owner, 'before join');
    await accept(conv.id);
    expect((await messages.messages(alice.actor, conv.id, page)).items).toEqual(
      [],
    );
    const old = await messages.messages(alice.actor, conv.id, page),
      oldMember = await member(conv.id),
      sent = await send(conv.id, alice, 'old send');
    await messages.changeMember(
      owner.actor,
      conv.id,
      oldMember.id,
      oldMember.revision,
      null,
    );
    await expect(
      messages.messages(alice.actor, conv.id, {
        ...page,
        cursor: old.nextCursor,
      }),
    ).rejects.toThrow();
    await send(conv.id, owner, 'between joins');
    const current = await messages.get(owner.actor, conv.id);
    const offer = await messages.invite(
      owner.actor,
      conv.id,
      current.revision,
      { id: randomUUID(), userId: alice.actor.userId },
      randomUUID(),
    );
    await messages.decide(alice.actor, offer.id, offer.revision, true);
    expect((await member(conv.id)).generation).toBe(2);
    expect((await messages.messages(alice.actor, conv.id, page)).items).toEqual(
      [],
    );
    await expect(
      messages.messages(alice.actor, conv.id, {
        ...page,
        cursor: old.nextCursor,
      }),
    ).rejects.toThrow();
    expect(sent.text).toBe('old send');
  });
  it('rejects cross-user, cross-conversation and tampered polling cursors', async () => {
    const a = await create();
    await accept(a.id);
    const b = await create();
    await accept(b.id);
    const cursor = (await messages.messages(alice.actor, a.id, page))
      .nextCursor;
    await expect(
      messages.messages(owner.actor, a.id, { ...page, cursor }),
    ).rejects.toThrow();
    await expect(
      messages.messages(alice.actor, b.id, { ...page, cursor }),
    ).rejects.toThrow();
    await expect(
      messages.messages(alice.actor, a.id, {
        ...page,
        cursor: cursor.slice(0, -1) + '!',
      }),
    ).rejects.toThrow();
  });
  it('makes a group read-only after its last administrator leaves without deleting history', async () => {
    const conv = await create();
    await accept(conv.id);
    await send(conv.id);
    const admin = await member(conv.id, owner);
    await messages.leave(owner.actor, conv.id, admin.revision);
    expect((await messages.get(alice.actor, conv.id)).writable).toBe(false);
    expect(
      (await messages.messages(alice.actor, conv.id, page)).items,
    ).toHaveLength(1);
    await expect(send(conv.id, alice)).rejects.toThrow();
    await expect(messages.get(owner.actor, conv.id)).rejects.toThrow();
  });
  it('permits explicit administrator delegation and keeps ordinary members from managing admission', async () => {
    const conv = await create();
    await accept(conv.id);
    const a = await member(conv.id);
    await expect(
      messages.invite(
        alice.actor,
        conv.id,
        2,
        { id: randomUUID(), userId: bob.actor.userId },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await messages.changeMember(
      owner.actor,
      conv.id,
      a.id,
      a.revision,
      'ADMIN',
    );
    await messages.leave(
      owner.actor,
      conv.id,
      (await member(conv.id, owner)).revision,
    );
    expect((await messages.get(alice.actor, conv.id)).writable).toBe(true);
    await send(conv.id, alice);
  });
  it('revokes invitations, rejects stale revisions and never enrolls a declined or expired invitee', async () => {
    const conv = await create();
    const offer = (await messages.invitations(alice.actor, page)).items[0]!;
    await expect(
      messages.decide(alice.actor, offer.id, 9, true),
    ).rejects.toThrow();
    await messages.revokeInvitation(owner.actor, conv.id, offer.id, 1);
    await expect(
      messages.decide(alice.actor, offer.id, 1, true),
    ).rejects.toThrow();
    const again = await messages.invite(
      owner.actor,
      conv.id,
      (await messages.get(owner.actor, conv.id)).revision,
      { id: randomUUID(), userId: alice.actor.userId },
      randomUUID(),
    );
    await messages.decide(alice.actor, again.id, again.revision, false);
    await expect(messages.get(alice.actor, conv.id)).rejects.toThrow();
  });
  it.each(['PROJECT', 'TEAM'] as const)(
    'requires exact %s membership plus explicit participation and denies source Viewers sending',
    async (kind) => {
      const source = await work(kind);
      await join(source.id, alice, 'MEMBER', kind);
      await join(source.id, viewer, 'VIEWER', kind);
      await join(source.id, bob, 'MEMBER', kind);
      const conv = await channel(source.id, kind, [alice, viewer]);
      await expect(messages.get(bob.actor, conv.id)).rejects.toThrow();
      await expect(messages.get(alice.actor, conv.id)).rejects.toThrow();
      await send(conv.id, owner, 'prior work');
      await accept(conv.id);
      await accept(conv.id, viewer);
      expect(
        (await messages.messages(alice.actor, conv.id, page)).items,
      ).toEqual([]);
      await send(conv.id, alice);
      expect(
        (await messages.messages(viewer.actor, conv.id, page)).items,
      ).toHaveLength(1);
      await expect(send(conv.id, viewer)).rejects.toThrow();
      await expect(
        messages.create(
          bob.actor,
          {
            id: randomUUID(),
            kind,
            title: 'Escalation',
            sourceId: source.id,
            participants: [],
          },
          randomUUID(),
        ),
      ).rejects.toThrow();
      await expect(
        channel(source.id, kind === 'PROJECT' ? 'TEAM' : 'PROJECT', []),
      ).rejects.toThrow();
    },
  );
  it('creates Company channels without granting their administrators unrelated DM or Project access', async () => {
    const source = await work('COMPANY'),
      conv = await channel(source.id, 'COMPANY', []),
      dm = await create('DM');
    expect((await messages.get(owner.actor, conv.id)).kind).toBe('COMPANY');
    await expect(messages.get(outsider.actor, conv.id)).rejects.toThrow();
    const independentProject = await projects.create(
      outsider.actor,
      {
        id: randomUUID(),
        title: 'Other source',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    await expect(
      channel(independentProject.id, 'PROJECT', []),
    ).rejects.toThrow();
    await expect(messages.get(outsider.actor, dm.id)).rejects.toThrow();
  });
  it('rejects unverified accounts, deleted sessions and closed accounts even on send replay', async () => {
    const unverified = await person(false);
    await expect(
      messages.create(
        unverified.actor,
        {
          id: randomUUID(),
          kind: 'DM',
          participants: [owner.actor.userId],
          retentionPolicyVersion: version,
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const conv = await create();
    await accept(conv.id);
    const key = randomUUID(),
      input = { id: randomUUID(), text: 'Committed' };
    await messages.send(alice.actor, conv.id, input, key);
    await db.authSession.delete({ where: { id: alice.actor.sessionId! } });
    await expect(
      messages.send(alice.actor, conv.id, input, key),
    ).rejects.toThrow();
    await db.space.updateMany({
      where: { kind: 'PERSONAL', ownerUserId: owner.actor.userId },
      data: { accessClosedAt: new Date() },
    });
    await expect(messages.get(owner.actor, conv.id)).rejects.toThrow();
  });
  it('rolls back sequence, body and receipt effects when an outbox write fails', async () => {
    const conv = await create();
    await accept(conv.id);
    const before = await db.sharedAuditEvent.count({
      where: { spaceId: conv.id },
    });
    const spy = vi
      .spyOn(kernel, 'offerEffect')
      .mockRejectedValueOnce(new ConflictException('synthetic outbox fault'));
    await expect(send(conv.id)).rejects.toThrow('synthetic outbox fault');
    spy.mockRestore();
    expect(
      (await db.conversation.findUniqueOrThrow({ where: { id: conv.id } }))
        .lastSequence,
    ).toBe(0n);
    expect(
      await db.conversationMessage.count({
        where: { conversationId: conv.id },
      }),
    ).toBe(0);
    expect(
      await db.sharedAuditEvent.count({ where: { spaceId: conv.id } }),
    ).toBe(before);
    expect((await send(conv.id)).sequence).toBe('1');
  });
  it('uses the existing free-mode feature seam and rolls back growth denial without changing old data', async () => {
    const conv = await create();
    await accept(conv.id);
    const policy = app.get(SharedFeaturePolicy),
      normal = policy.decide.bind(policy);
    const spy = vi
      .spyOn(policy, 'decide')
      .mockImplementation(async (input, tx) =>
        input.feature === 'messaging.message'
          ? { allowed: false, mode: 'FREE' }
          : normal(input, tx),
      );
    await expect(send(conv.id)).rejects.toThrow();
    spy.mockRestore();
    expect(
      await db.conversationMessage.count({
        where: { conversationId: conv.id },
      }),
    ).toBe(0);
  });
  it('serializes a winning send before a waiting source revocation', async () => {
    const source = await work(),
      access = await join(source.id),
      conv = await channel(source.id);
    await accept(conv.id);
    const entered = barrier(),
      release = barrier(),
      authority = app.get(MessagingAuthority),
      normal = authority.proof.bind(authority);
    const spy = vi
      .spyOn(authority, 'proof')
      .mockImplementation(async (...args) => {
        const result = await normal(...args);
        if (args[3] === alice.actor.userId) {
          entered.release();
          await release.promise;
        }
        return result;
      });
    // Sender wins first in this half: revocation must observe it waiting, not erase its commit.
    const sending = outcome(send(conv.id, alice));
    await entered.promise;
    const revoking = outcome(
      kernel.changeAccess(owner.actor, {
        spaceId: source.id,
        scopeId: source.id,
        accessId: access.id,
        revision: access.revision,
        state: 'REVOKED',
        memberRole: 'MEMBER',
      }),
    );
    try {
      await blocked();
    } finally {
      release.release();
      spy.mockRestore();
    }
    expect((await sending).error).toBeUndefined();
    expect((await revoking).error).toBeUndefined();
    await expect(send(conv.id, alice)).rejects.toThrow();
    expect(
      await db.conversationMessage.count({
        where: { conversationId: conv.id },
      }),
    ).toBe(1);
  });
  it('keeps an uncertain signed write failure closed without retaining the rolled-back body', async () => {
    const conv = await create();
    await accept(conv.id);
    const spy = vi
      .spyOn(kernel, 'offerEffect')
      .mockRejectedValueOnce(new Error('synthetic uncertain failure'));
    await expect(send(conv.id)).rejects.toThrow('synthetic uncertain failure');
    spy.mockRestore();
    expect(
      await db.conversationMessage.count({
        where: { conversationId: conv.id },
      }),
    ).toBe(0);
    expect(
      (await db.conversation.findUniqueOrThrow({ where: { id: conv.id } }))
        .lastSequence,
    ).toBe(0n);
    await expect(send(conv.id)).rejects.toThrow();
  });
  it('denies a waiting send and stale polling cursor after source revocation wins the fence', async () => {
    const source = await work(),
      access = await join(source.id),
      conv = await channel(source.id);
    await accept(conv.id);
    const cursor = (await messages.messages(alice.actor, conv.id, page))
        .nextCursor,
      entered = barrier(),
      release = barrier();
    const revoking = outcome(
      kernel.changeAccess(
        owner.actor,
        {
          spaceId: source.id,
          scopeId: source.id,
          accessId: access.id,
          revision: access.revision,
          state: 'REVOKED',
          memberRole: 'MEMBER',
        },
        async (_tx, row) => {
          entered.release();
          await release.promise;
          return row;
        },
      ),
    );
    await entered.promise;
    const sending = outcome(send(conv.id, alice));
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await revoking).error).toBeUndefined();
    expect((await sending).error).toBeDefined();
    expect(
      await db.conversationMessage.count({
        where: { conversationId: conv.id },
      }),
    ).toBe(0);
    await expect(
      messages.messages(alice.actor, conv.id, { ...page, cursor }),
    ).rejects.toThrow();
  });
  it('denies a waiting send after conversation removal wins the same custody fence', async () => {
    const conv = await create();
    await accept(conv.id);
    const target = await member(conv.id),
      entered = barrier(),
      release = barrier();
    const normal = kernel.offerEffect.bind(kernel),
      spy = vi
        .spyOn(kernel, 'offerEffect')
        .mockImplementation(async (...args) => {
          const result = await normal(...args);
          if (args[4] === 'messaging.member.remove') {
            entered.release();
            await release.promise;
          }
          return result;
        });
    const removing = outcome(
      messages.changeMember(
        owner.actor,
        conv.id,
        target.id,
        target.revision,
        null,
      ),
    );
    await entered.promise;
    const sending = outcome(send(conv.id, alice));
    try {
      await blocked();
    } finally {
      release.release();
      spy.mockRestore();
    }
    expect((await removing).error).toBeUndefined();
    expect((await sending).error).toBeDefined();
    expect(
      await db.conversationMessage.count({
        where: { conversationId: conv.id },
      }),
    ).toBe(0);
  });
  it('requires conversation readmission after a source membership generation changes', async () => {
    const source = await work(),
      first = await join(source.id),
      conv = await channel(source.id);
    await accept(conv.id);
    const cursor = (await messages.messages(alice.actor, conv.id, page))
      .nextCursor;
    await kernel.changeAccess(owner.actor, {
      spaceId: source.id,
      scopeId: source.id,
      accessId: first.id,
      revision: first.revision,
      state: 'REVOKED',
      memberRole: 'MEMBER',
    });
    await join(source.id);
    await expect(messages.get(alice.actor, conv.id)).rejects.toThrow();
    const offer = await messages.invite(
      owner.actor,
      conv.id,
      (await messages.get(owner.actor, conv.id)).revision,
      { id: randomUUID(), userId: alice.actor.userId },
      randomUUID(),
    );
    await messages.decide(alice.actor, offer.id, offer.revision, true);
    await expect(
      messages.messages(alice.actor, conv.id, { ...page, cursor }),
    ).rejects.toThrow();
    expect((await messages.messages(alice.actor, conv.id, page)).items).toEqual(
      [],
    );
  });
  it('does not revive conversation admissions from an older restored scope epoch', async () => {
    const conv = await create();
    await accept(conv.id);
    const cursor = (await messages.messages(alice.actor, conv.id, page))
      .nextCursor;
    await db.accessScope.update({
      where: { id: conv.id },
      data: { restoreGeneration: { increment: 1 } },
    });
    await expect(
      messages.messages(alice.actor, conv.id, { ...page, cursor }),
    ).rejects.toThrow();
    await expect(messages.get(owner.actor, conv.id)).rejects.toThrow();
  });
  it('retains shared bodies with opaque erased attribution and does not expose live profile fields', async () => {
    const conv = await create();
    await accept(conv.id);
    await send(conv.id, alice, 'Retained shared content');
    const closedAt = new Date();
    await db.$transaction(async (tx) => {
      await tx.space.updateMany({
        where: { kind: 'PERSONAL', ownerUserId: alice.actor.userId },
        data: { accessClosedAt: closedAt },
      });
      await kernel.enqueueExit(tx, alice.actor.userId, closedAt);
    });
    let complete = false;
    for (let pass = 0; pass < 3 && !complete; pass++)
      complete = await kernel.prepareIdentityErasure(
        alice.actor.userId,
        closedAt,
      );
    expect(complete).toBe(true);
    const history = await messages.messages(owner.actor, conv.id, page);
    expect(history.items).toHaveLength(1);
    expect(JSON.stringify(history)).not.toContain(alice.actor.userId);
    expect(JSON.stringify(history)).not.toContain(alice.email);
    const local = await db.sharedActor.findFirst({
      where: { spaceId: conv.id, state: 'ERASED' },
    });
    expect(local?.userId).toBeNull();
  });
  it('denies grant-only source admissions even if they know a channel ID', async () => {
    const source = await work(),
      conv = await channel(source.id, 'PROJECT', []),
      actorId = randomUUID(),
      accessId = randomUUID(),
      now = new Date();
    await db.$transaction(async (tx) => {
      await tx.sharedActor.create({
        data: {
          id: actorId,
          spaceId: source.id,
          userId: outsider.actor.userId,
          state: 'ACTIVE',
        },
      });
      await tx.contextAccess.create({
        data: {
          id: accessId,
          spaceId: source.id,
          scopeId: source.id,
          actorId,
          state: 'ACTIVE',
          memberRole: null,
          joinedAt: now,
        },
      });
      await tx.contextAccessInterval.create({
        data: { accessId, generation: 1, joinedAt: now },
      });
    });
    await expect(messages.get(outsider.actor, conv.id)).rejects.toThrow();
    await expect(
      messages.invite(
        owner.actor,
        conv.id,
        conv.revision,
        { id: randomUUID(), userId: outsider.actor.userId },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('permits Company Org Admin channel management while keeping Viewers read-only and membership insufficient', async () => {
    const source = await work('COMPANY');
    for (const [who, role] of [
      [alice, 'ORG_ADMIN'],
      [viewer, 'VIEWER'],
      [bob, 'MEMBER'],
    ] as const) {
      const offer = await companies.invite(
        owner.actor,
        source.id,
        source.id,
        { memberRole: role, recipient: { userId: who.actor.userId } },
        randomUUID(),
      );
      await app
        .get(CompanyAccess)
        .decide(who.actor, offer.invitation.id, offer.proof!, 1, true);
    }
    const conv = await messages.create(
      alice.actor,
      {
        id: randomUUID(),
        kind: 'COMPANY',
        sourceId: source.id,
        title: 'Corporate channel',
        participants: [viewer.actor.userId],
      },
      randomUUID(),
    );
    await expect(messages.get(owner.actor, conv.id)).rejects.toThrow();
    await expect(messages.get(bob.actor, conv.id)).rejects.toThrow();
    await accept(conv.id, viewer);
    await send(conv.id, alice);
    expect(
      (await messages.messages(viewer.actor, conv.id, page)).items,
    ).toHaveLength(1);
    await expect(send(conv.id, viewer)).rejects.toThrow();
    await expect(
      messages.create(
        bob.actor,
        {
          id: randomUUID(),
          kind: 'COMPANY',
          sourceId: source.id,
          title: 'Forbidden',
          participants: [],
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('rejects expired offers and invitations whose issuing group administrator lost authority', async () => {
    const conv = await create(),
      offer = (await messages.invitations(alice.actor, page)).items[0]!;
    await db.conversationInvitation.update({
      where: { id: offer.id },
      data: {
        createdAt: new Date(Date.now() - 2 * 86400000),
        expiresAt: new Date(Date.now() - 86400000),
      },
    });
    await expect(
      messages.decide(alice.actor, offer.id, 1, true),
    ).rejects.toThrow();
    const again = await messages.invite(
      owner.actor,
      conv.id,
      conv.revision,
      { id: randomUUID(), userId: bob.actor.userId },
      randomUUID(),
    );
    const admin = await member(conv.id, owner);
    await messages.leave(owner.actor, conv.id, admin.revision);
    await expect(
      messages.decide(bob.actor, again.id, again.revision, true),
    ).rejects.toThrow();
  });
  it('uses current authorization before replaying an old send after conversation re-admission', async () => {
    const conv = await create();
    await accept(conv.id);
    const key = randomUUID(),
      input = { id: randomUUID(), text: 'Previous admission' };
    await messages.send(alice.actor, conv.id, input, key);
    const previous = await member(conv.id);
    await messages.changeMember(
      owner.actor,
      conv.id,
      previous.id,
      previous.revision,
      null,
    );
    await expect(
      messages.send(alice.actor, conv.id, input, key),
    ).rejects.toThrow();
    const offer = await messages.invite(
      owner.actor,
      conv.id,
      (await messages.get(owner.actor, conv.id)).revision,
      { id: randomUUID(), userId: alice.actor.userId },
      randomUUID(),
    );
    await messages.decide(alice.actor, offer.id, offer.revision, true);
    await expect(
      messages.send(alice.actor, conv.id, input, key),
    ).rejects.toThrow();
    expect((await messages.messages(alice.actor, conv.id, page)).items).toEqual(
      [],
    );
  });
  it('enforces same-scope database references and prevents a foreign conversation author interval', async () => {
    const a = await create();
    await accept(a.id);
    const b = await create();
    await accept(b.id);
    const author = await member(a.id, owner);
    await expect(
      db.conversationMessage.create({
        data: {
          id: randomUUID(),
          spaceId: b.id,
          scopeId: b.id,
          conversationId: b.id,
          sequence: 1n,
          memberId: author.id,
          memberGeneration: author.generation,
          text: 'Rejected',
          keyHash: 'a'.repeat(64),
          fingerprint: 'b'.repeat(64),
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.conversationMember.update({
        where: { id: author.id },
        data: { conversationId: b.id },
      }),
    ).rejects.toThrow();
    expect(
      await db.conversationMessage.count({ where: { conversationId: b.id } }),
    ).toBe(0);
  });
  it('disposes expired source messaging only through the policy-claimed bounded owner cleanup', async () => {
    const source = await work(),
      conv = await channel(source.id, 'PROJECT', []);
    await send(conv.id);
    const cleanup = app.get(ProjectCleanupService),
      now = (
        await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      )[0]!.now,
      past = new Date(now.getTime() - 40 * 86400000),
      jobId = randomUUID();
    // An owned, expired lifecycle fixture, preserving all original boundary data.
    await db.$transaction(async (tx) => {
      const root = await tx.contextAccess.findFirstOrThrow({
        where: { spaceId: source.id },
      });
      await tx.contextAccess.update({
        where: { id: root.id },
        data: { state: 'LEFT', endedAt: now, revision: { increment: 1 } },
      });
      await tx.contextAccessInterval.update({
        where: {
          accessId_generation: {
            accessId: root.id,
            generation: root.generation,
          },
        },
        data: { endedAt: now },
      });
      await tx.sharedLifecycleJob.create({
        data: {
          id: jobId,
          custodyId: source.id,
          spaceId: source.id,
          generation: 1,
          state: 'CLEANUP_PENDING',
          effectiveDepartureAt: past,
          recoveryDeadline: new Date(past.getTime() + 30 * 86400000),
          retentionPolicyVersion: version,
          nextAt: past,
        },
      });
      await tx.sharedCustody.update({
        where: { spaceId: source.id },
        data: { state: 'CLEANUP_PENDING', closureGeneration: 1 },
      });
    });
    expect(await cleanup.consume()).toBe(true);
    const job = await db.sharedLifecycleJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    expect(job.state).toBe('PURGING');
    expect(
      await db.conversationMessage.count({
        where: { conversationId: conv.id },
      }),
    ).toBe(1);
    expect(
      await db.project.findUnique({ where: { id: source.id } }),
    ).not.toBeNull();
    for (
      let n = 0;
      n < 120 && (await db.project.findUnique({ where: { id: source.id } }));
      n++
    )
      await cleanup.consume();
    expect(
      await db.project.findUnique({ where: { id: source.id } }),
    ).toBeNull();
    expect(
      await db.conversationMessage.count({
        where: { conversationId: conv.id },
      }),
    ).toBe(0);
  });
  it('rejects HTTP outsiders, malformed requests and untrusted origins while returning OpenAPI-shaped responses', async () => {
    const conv = await create(),
      session = await cookie(owner),
      other = await cookie(outsider);
    const read = await request(app.getHttpServer())
      .get('/api/v1/conversations/' + conv.id)
      .set('Cookie', session)
      .expect(200);
    expect(c.ConversationSchema.safeParse(read.body).success).toBe(true);
    expect(read.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer())
      .get('/api/v1/conversations/' + conv.id)
      .set('Cookie', other)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/conversations/' + conv.id + '/messages?limit=101')
      .set('Cookie', session)
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/conversations/' + conv.id + '/messages')
      .set('Cookie', session)
      .set('Origin', 'https://attacker.invalid')
      .set('Idempotency-Key', randomUUID())
      .send({ id: randomUUID(), text: 'Denied' })
      .expect(403);
    const sent = await request(app.getHttpServer())
      .post('/api/v1/conversations/' + conv.id + '/messages')
      .set('Cookie', session)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({ id: randomUUID(), text: 'HTTP text' })
      .expect(201);
    expect(c.ConversationMessageSchema.safeParse(sent.body).success).toBe(true);
  });
  it('deduplicates simultaneous independent conversation creation under the account fence', async () => {
    const input = {
        id: randomUUID(),
        kind: 'PRIVATE_GROUP' as const,
        title: 'Concurrent creation',
        participants: [alice.actor.userId],
        retentionPolicyVersion: version,
      },
      key = randomUUID();
    const [first, second] = await Promise.all([
      messages.create(owner.actor, input, key),
      messages.create(owner.actor, input, key),
    ]);
    expect(first.id).toBe(second.id);
    expect(
      await db.conversationInvitation.count({
        where: { conversationId: input.id },
      }),
    ).toBe(1);
    expect(
      await db.sharedUsageEntry.count({
        where: { spaceId: input.id, feature: 'messaging.conversation' },
      }),
    ).toBe(1);
  });

  describe('P5-02 advanced messaging', () => {
    it('keeps personal safety actions available in a private group after its last admin leaves', async () => {
      const g = await group(),
        msg = await send(g.id),
        om = await member(g.id, owner);
      await messages.leave(owner.actor, g.id, om.revision);
      await expect(
        advanced.act(
          alice.actor,
          g.id,
          { action: 'reaction', messageId: msg.id, emoji: '👍', active: true },
          randomUUID(),
        ),
      ).rejects.toThrow();
      await advanced.act(
        alice.actor,
        g.id,
        {
          action: 'report',
          id: randomUUID(),
          messageId: msg.id,
          reason: 'Read-only personal safety',
        },
        randomUUID(),
      );
      await advanced.act(
        alice.actor,
        g.id,
        { action: 'hide', messageId: msg.id },
        randomUUID(),
      );
      expect((await advanced.detail(alice.actor, g.id, msg.id)).state).toBe(
        'HIDDEN',
      );
    });
    it.each(['PROJECT', 'TEAM'] as const)(
      'allows accepted %s source administrators to pin/moderate',
      async (kind) => {
        const source = await work(kind);
        await join(source.id, alice, 'ADMIN', kind);
        const g = await channel(source.id, kind);
        await accept(g.id);
        const msg = await send(g.id);
        await advanced.act(
          alice.actor,
          g.id,
          { action: 'pin', messageId: msg.id, active: true },
          randomUUID(),
          1,
        );
        await advanced.act(
          alice.actor,
          g.id,
          {
            action: 'moderate',
            messageId: msg.id,
            reason: 'Current source administrator',
          },
          randomUUID(),
          2,
        );
        expect((await advanced.detail(owner.actor, g.id, msg.id)).state).toBe(
          'DELETED',
        );
      },
    );
    it('uses Company Org Admin content authority only after explicit conversation acceptance', async () => {
      const source = await work('COMPANY');
      const offer = await companies.invite(
        owner.actor,
        source.id,
        source.id,
        { memberRole: 'ORG_ADMIN', recipient: { userId: alice.actor.userId } },
        randomUUID(),
      );
      await app
        .get(CompanyAccess)
        .decide(alice.actor, offer.invitation.id, offer.proof!, 1, true);
      const g = await channel(source.id, 'COMPANY'),
        msg = await send(g.id);
      await expect(
        advanced.act(
          alice.actor,
          g.id,
          { action: 'pin', messageId: msg.id, active: true },
          randomUUID(),
          1,
        ),
      ).rejects.toThrow();
      await accept(g.id);
      // Acceptance starts after this message: even the Org Admin has no prejoin content.
      await expect(
        advanced.act(
          alice.actor,
          g.id,
          {
            action: 'moderate',
            messageId: msg.id,
            reason: 'No prejoin exception',
          },
          randomUUID(),
          1,
        ),
      ).rejects.toThrow();
      const current = await send(g.id);
      await advanced.act(
        alice.actor,
        g.id,
        { action: 'pin', messageId: current.id, active: true },
        randomUUID(),
        1,
      );
      await advanced.act(
        alice.actor,
        g.id,
        {
          action: 'moderate',
          messageId: current.id,
          reason: 'Current Org Admin moderation',
        },
        randomUUID(),
        2,
      );
    });
    it('enforces new database source, reply, admission and TEXT-shape constraints', async () => {
      const g = await group(),
        foreign = await group(),
        msg = await send(g.id),
        other = await send(foreign.id),
        am = await member(g.id, alice);
      const header = await db.messageEntry.findUniqueOrThrow({
        where: { id: msg.id },
      });
      const base = {
        id: randomUUID(),
        conversationId: g.id,
        sequence: 999n,
        memberId: header.memberId,
        memberGeneration: 1,
        kind: 'FORWARD',
        sourceId: other.id,
        sourceConversationId: g.id,
      };
      await expect(db.messageEntry.create({ data: base })).rejects.toThrow();
      await expect(
        db.messageEntry.update({
          where: { id: msg.id },
          data: { replyToId: other.id, threadId: other.id },
        }),
      ).rejects.toThrow();
      await expect(
        db.messageEntry.update({
          where: { id: msg.id },
          data: { textId: null },
        }),
      ).rejects.toThrow();
      await expect(
        db.messageMention.create({
          data: {
            conversationId: g.id,
            messageId: msg.id,
            memberId: am.id,
            generation: 999,
          },
        }),
      ).rejects.toThrow();
      await expect(
        db.messageChange.update({
          where: {
            conversationId_sequence: { conversationId: g.id, sequence: 1n },
          },
          data: { kind: 'EDIT' },
        }),
      ).rejects.toThrow();
    });
    const action = (
      id: string,
      body: z.infer<typeof c.AdvancedMessageActionSchema>,
      who = owner,
      version?: number,
      key = randomUUID(),
    ) => advanced.act(who.actor, id, body, key, version);
    async function group() {
      const g = await create('PRIVATE_GROUP', [alice, bob]);
      await accept(g.id, alice);
      await accept(g.id, bob);
      return g;
    }
    async function age(messageId: string) {
      await db.messageEntry.update({
        where: { id: messageId },
        data: { createdAt: new Date(Date.now() - 49 * 3600000) },
      });
    }
    it('composes typed replies, root threads and explicit accepted mentions', async () => {
      const g = await group(),
        root = await send(g.id),
        am = await member(g.id, alice),
        child = randomUUID();
      await action(g.id, {
        action: 'compose',
        id: child,
        text: 'Thread answer',
        replyToId: root.id,
        mentions: [am.id],
      });
      const detail = await advanced.detail(alice.actor, g.id, child);
      expect(
        (
          await advanced.timeline(alice.actor, g.id, page, { thread: child })
        ).items.map((v) => v.id),
      ).toEqual([root.id, child]);
      expect(detail).toMatchObject({
        replyToId: root.id,
        threadId: root.id,
        mentions: [am.id],
        content: { text: 'Thread answer' },
      });
      expect(
        (
          await advanced.timeline(alice.actor, g.id, page, { thread: root.id })
        ).items.map((v) => v.id),
      ).toEqual([root.id, child]);
      expect(
        (
          await advanced.timeline(alice.actor, g.id, page, { mentions: true })
        ).items.map((v) => v.id),
      ).toEqual([child]);
    });
    it('rejects cross-conversation reply/mention references and rolls all effects back', async () => {
      const a = await group(),
        b = await group(),
        foreign = await send(b.id),
        am = await member(b.id, alice),
        before = await db.sharedAuditEvent.count();
      await expect(
        action(a.id, {
          action: 'compose',
          id: randomUUID(),
          text: 'No',
          replyToId: foreign.id,
          mentions: [],
        }),
      ).rejects.toThrow();
      await expect(
        action(a.id, {
          action: 'compose',
          id: randomUUID(),
          text: 'No',
          mentions: [am.id],
        }),
      ).rejects.toThrow();
      expect(await db.sharedAuditEvent.count()).toBe(before);
      expect(
        await db.messageEntry.count({ where: { conversationId: a.id } }),
      ).toBe(0);
    });
    it('preserves author history, current text and optimistic edit conflicts', async () => {
      const g = await group(),
        msg = await send(g.id);
      await action(
        g.id,
        { action: 'edit', messageId: msg.id, text: 'Changed' },
        owner,
        1,
      );
      expect(
        (await messages.messages(alice.actor, g.id, page)).items[0]!.text,
      ).toBe('Changed');
      expect(
        (await advanced.revisions(owner.actor, g.id, msg.id, page)).items[0]!
          .text,
      ).toBe(msg.text);
      await expect(
        advanced.revisions(alice.actor, g.id, msg.id, page),
      ).rejects.toThrow();
      await expect(
        action(
          g.id,
          { action: 'edit', messageId: msg.id, text: 'Stale' },
          owner,
          1,
        ),
      ).rejects.toThrow();
      expect(
        await db.messageRevision.count({ where: { messageId: msg.id } }),
      ).toBe(1);
    });
    it('blocks late author edits/deletes and permits personal hide after 48 hours', async () => {
      const g = await group(),
        msg = await send(g.id);
      await age(msg.id);
      await expect(
        action(
          g.id,
          { action: 'edit', messageId: msg.id, text: 'Late' },
          owner,
          1,
        ),
      ).rejects.toThrow();
      await expect(
        action(g.id, { action: 'delete', messageId: msg.id }, owner, 1),
      ).rejects.toThrow();
      await action(g.id, { action: 'hide', messageId: msg.id });
      expect((await advanced.detail(owner.actor, g.id, msg.id)).state).toBe(
        'HIDDEN',
      );
      expect(
        (await advanced.detail(alice.actor, g.id, msg.id)).content!.text,
      ).toBe(msg.text);
    });
    it('uses current tombstones for queued CREATE/EDIT events and legacy send retries', async () => {
      const g = await group(),
        key = randomUUID(),
        msg = await send(g.id, owner, 'Never replay deleted body', key);
      const snapshot = await advanced.timeline(alice.actor, g.id, page);
      await action(
        g.id,
        { action: 'edit', messageId: msg.id, text: 'Edited body' },
        owner,
        1,
      );
      await action(g.id, { action: 'delete', messageId: msg.id }, owner, 2);
      const changes = await advanced.changes(alice.actor, g.id, {
        ...page,
        cursor: snapshot.changeCursor,
      });
      expect(changes.items.map((v) => v.kind)).toEqual(['EDIT', 'DELETE']);
      expect(
        changes.items.every(
          (v) => v.message.state === 'DELETED' && v.message.content === null,
        ),
      ).toBe(true);
      expect(
        (await advanced.changes(alice.actor, g.id, page)).items[0]!.message
          .content,
      ).toBeNull();
      expect((await messages.messages(alice.actor, g.id, page)).items).toEqual(
        [],
      );
      await expect(send(g.id, owner, msg.text, key, msg.id)).rejects.toThrow();
      await expect(
        advanced.revisions(owner.actor, g.id, msg.id, page),
      ).rejects.toThrow();
      expect(
        (
          await db.conversationMessage.findUniqueOrThrow({
            where: { id: msg.id },
          })
        ).text,
      ).toBe('Edited body');
    });
    it('hides personal events from peers and never returns hidden legacy/search text', async () => {
      const g = await group(),
        msg = await send(g.id),
        snapshot = await advanced.timeline(bob.actor, g.id, page);
      await action(g.id, { action: 'hide', messageId: msg.id }, alice);
      expect(
        (
          await advanced.changes(bob.actor, g.id, {
            ...page,
            cursor: snapshot.changeCursor,
          })
        ).items,
      ).toEqual([]);
      expect((await messages.messages(alice.actor, g.id, page)).items).toEqual(
        [],
      );
      expect(
        (await advanced.timeline(alice.actor, g.id, page, { search: msg.text }))
          .items,
      ).toEqual([]);
    });
    it('makes emoji add/remove idempotent and convergent without toggle retries', async () => {
      const g = await group(),
        msg = await send(g.id),
        key = randomUUID(),
        body = {
          action: 'reaction' as const,
          messageId: msg.id,
          emoji: '👨‍👩‍👧‍👦',
          active: true,
        };
      const before = await db.sharedAuditEvent.count();
      await Promise.all([
        action(g.id, body, alice, undefined, key),
        action(g.id, body, alice, undefined, key),
      ]);
      expect(await db.sharedAuditEvent.count()).toBe(before + 1);
      expect(
        (await advanced.detail(alice.actor, g.id, msg.id)).reactions,
      ).toEqual([{ emoji: body.emoji, count: 1, mine: true }]);
      await action(g.id, { ...body, active: false }, alice);
      expect(
        (await advanced.detail(owner.actor, g.id, msg.id)).reactions,
      ).toEqual([]);
      await expect(
        action(g.id, { ...body, active: false }, alice, undefined, key),
      ).rejects.toThrow();
    });
    it('serializes two writers with the same revision and preserves exactly one edit', async () => {
      const g = await group(),
        msg = await send(g.id);
      const results = await Promise.allSettled([
        action(
          g.id,
          { action: 'edit', messageId: msg.id, text: 'A' },
          owner,
          1,
        ),
        action(
          g.id,
          { action: 'edit', messageId: msg.id, text: 'B' },
          owner,
          1,
        ),
      ]);
      expect(results.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
      expect(
        await db.messageRevision.count({ where: { messageId: msg.id } }),
      ).toBe(1);
    });
    it('limits private-group pin and moderation to current accepted admins', async () => {
      const g = await group(),
        msg = await send(g.id, alice);
      await expect(
        action(
          g.id,
          { action: 'pin', messageId: msg.id, active: true },
          alice,
          1,
        ),
      ).rejects.toThrow();
      await action(
        g.id,
        { action: 'pin', messageId: msg.id, active: true },
        owner,
        1,
      );
      expect(
        (
          await advanced.timeline(alice.actor, g.id, page, { pins: true })
        ).items.map((v) => v.id),
      ).toEqual([msg.id]);
      await age(msg.id);
      await expect(
        action(
          g.id,
          { action: 'moderate', messageId: msg.id, reason: 'No authority' },
          bob,
          2,
        ),
      ).rejects.toThrow();
      await action(
        g.id,
        {
          action: 'moderate',
          messageId: msg.id,
          reason: 'Approved rule enforcement',
        },
        owner,
        2,
      );
      expect((await advanced.detail(alice.actor, g.id, msg.id)).state).toBe(
        'DELETED',
      );
      expect(
        (
          await db.messageModeration.findFirstOrThrow({
            where: { messageId: msg.id },
          })
        ).reason,
      ).toBe('Approved rule enforcement');
      expect(
        (await advanced.timeline(alice.actor, g.id, page, { pins: true }))
          .items[0]!.content,
      ).toBeNull();
    });
    it('allows both DM peers to pin, keeps reports private, and prohibits peer moderation', async () => {
      const g = await create('DM');
      await accept(g.id);
      const msg = await send(g.id);
      await action(
        g.id,
        { action: 'pin', messageId: msg.id, active: true },
        alice,
        1,
      );
      const reportId = randomUUID();
      await action(
        g.id,
        {
          action: 'report',
          id: reportId,
          messageId: msg.id,
          reason: 'Private receipt',
        },
        alice,
      );
      expect((await advanced.reports(owner.actor, g.id, page)).items).toEqual(
        [],
      );
      expect(
        (await advanced.reports(alice.actor, g.id, page)).items[0]!.id,
      ).toBe(reportId);
      await expect(
        action(
          g.id,
          { action: 'resolve-report', reportId, reason: 'Peer cannot review' },
          owner,
          1,
        ),
      ).rejects.toThrow();
      await expect(
        action(
          g.id,
          {
            action: 'moderate',
            messageId: msg.id,
            reason: 'Peer cannot moderate',
          },
          alice,
          2,
        ),
      ).rejects.toThrow();
    });
    it('stores report references without a copied body and restricts resolution by join history', async () => {
      const g = await group(),
        msg = await send(g.id, alice),
        reportId = randomUUID();
      await action(
        g.id,
        {
          action: 'report',
          id: reportId,
          messageId: msg.id,
          reason: 'Review requested',
        },
        bob,
      );
      expect(
        (await advanced.reports(owner.actor, g.id, page)).items[0]!.reason,
      ).toBe('Review requested');
      await expect(
        action(
          g.id,
          { action: 'resolve-report', reportId, reason: 'Unauthorized' },
          alice,
          1,
        ),
      ).rejects.toThrow();
      await action(
        g.id,
        {
          action: 'resolve-report',
          reportId,
          reason: 'Reviewed within authorized history',
        },
        owner,
        1,
      );
      expect(
        (await advanced.reports(bob.actor, g.id, page)).items[0]!.state,
      ).toBe('RESOLVED');
      expect(
        JSON.stringify(
          await db.messageReport.findUnique({ where: { id: reportId } }),
        ),
      ).not.toContain(msg.text);
    });
    it('defaults work author-delete to denied and requires an accepted source administrator policy', async () => {
      const p = await work();
      await join(p.id);
      const g = await channel(p.id);
      await accept(g.id);
      const msg = await send(g.id, alice);
      await expect(
        action(g.id, { action: 'delete', messageId: msg.id }, alice, 1),
      ).rejects.toThrow();
      await expect(
        action(
          g.id,
          { action: 'policy', authorDelete: true, reason: 'Not administrator' },
          alice,
          1,
        ),
      ).rejects.toThrow();
      await action(
        g.id,
        {
          action: 'policy',
          authorDelete: true,
          reason: 'Owner authorizes author deletion',
        },
        owner,
        1,
      );
      expect(await advanced.policy(alice.actor, g.id)).toEqual({
        revision: 2,
        authorDelete: true,
      });
      await action(g.id, { action: 'delete', messageId: msg.id }, alice, 1);
      expect((await advanced.detail(owner.actor, g.id, msg.id)).state).toBe(
        'DELETED',
      );
      await expect(
        db.messagePolicy.update({
          where: {
            conversationId_revision: { conversationId: g.id, revision: 2 },
          },
          data: { authorDelete: false },
        }),
      ).rejects.toThrow();
    });
    it('never extends the 48-hour author window with a work policy', async () => {
      const p = await work();
      await join(p.id);
      const g = await channel(p.id);
      await accept(g.id);
      const msg = await send(g.id, alice);
      await age(msg.id);
      await action(
        g.id,
        { action: 'policy', authorDelete: true, reason: 'Policy' },
        owner,
        1,
      );
      await expect(
        action(g.id, { action: 'delete', messageId: msg.id }, alice, 1),
      ).rejects.toThrow();
      await action(
        g.id,
        {
          action: 'moderate',
          messageId: msg.id,
          reason: 'Separate administrative rule',
        },
        owner,
        1,
      );
    });
    it('allows Viewer personal hide/report but denies every shared advanced mutation', async () => {
      const p = await work();
      await join(p.id, viewer, 'VIEWER');
      const g = await channel(p.id, 'PROJECT', [viewer]);
      await accept(g.id, viewer);
      const msg = await send(g.id);
      const bodyList: z.infer<typeof c.AdvancedMessageActionSchema>[] = [
        { action: 'compose', id: randomUUID(), text: 'Denied', mentions: [] },
        { action: 'reaction', messageId: msg.id, emoji: '👍', active: true },
        { action: 'pin', messageId: msg.id, active: true },
        { action: 'edit', messageId: msg.id, text: 'Denied' },
        { action: 'delete', messageId: msg.id },
        { action: 'moderate', messageId: msg.id, reason: 'Denied' },
        { action: 'policy', authorDelete: true, reason: 'Denied' },
      ];
      for (const body of bodyList)
        await expect(action(g.id, body, viewer, 1)).rejects.toThrow();
      await action(
        g.id,
        {
          action: 'report',
          id: randomUUID(),
          messageId: msg.id,
          reason: 'Viewer safety',
        },
        viewer,
      );
      await action(g.id, { action: 'hide', messageId: msg.id }, viewer);
      expect((await advanced.detail(viewer.actor, g.id, msg.id)).state).toBe(
        'HIDDEN',
      );
    });
    it('requires accepted content membership even for a source owner/admin', async () => {
      const p = await work();
      await join(p.id);
      const g = await channel(p.id);
      await accept(g.id);
      const msg = await send(g.id, alice);
      const om = await member(g.id, owner);
      await messages.leave(owner.actor, g.id, om.revision);
      await expect(
        advanced.detail(owner.actor, g.id, msg.id),
      ).rejects.toThrow();
      await expect(
        action(
          g.id,
          {
            action: 'moderate',
            messageId: msg.id,
            reason: 'Source owner alone',
          },
          owner,
          1,
        ),
      ).rejects.toThrow();
    });
    it('filters all prejoin APIs and invalidates cursors on leave/rejoin', async () => {
      const g = await create('PRIVATE_GROUP', [alice, bob]);
      await accept(g.id, alice);
      const msg = await send(g.id);
      await accept(g.id, bob);
      await expect(advanced.detail(bob.actor, g.id, msg.id)).rejects.toThrow();
      await expect(
        action(
          g.id,
          {
            action: 'report',
            id: randomUUID(),
            messageId: msg.id,
            reason: 'Prejoin',
          },
          bob,
        ),
      ).rejects.toThrow();
      await expect(
        action(
          g.id,
          {
            action: 'compose',
            id: randomUUID(),
            text: 'Reply',
            replyToId: msg.id,
            mentions: [],
          },
          bob,
        ),
      ).rejects.toThrow();
      const snapshot = await advanced.timeline(alice.actor, g.id, page),
        am = await member(g.id, alice);
      await messages.leave(alice.actor, g.id, am.revision);
      const cv = await messages.get(owner.actor, g.id);
      await messages.invite(
        owner.actor,
        g.id,
        cv.revision,
        { id: randomUUID(), userId: alice.actor.userId },
        randomUUID(),
      );
      await accept(g.id, alice);
      await expect(
        advanced.changes(alice.actor, g.id, {
          ...page,
          cursor: snapshot.changeCursor,
        }),
      ).rejects.toThrow();
      expect((await advanced.timeline(alice.actor, g.id, page)).items).toEqual(
        [],
      );
    });
    it('keeps forwarding live and denies source body/identity to target-only participants', async () => {
      const source = await create('PRIVATE_GROUP', [alice]);
      await accept(source.id, alice);
      const msg = await send(source.id);
      const target = await group(),
        fid = randomUUID();
      await action(target.id, {
        action: 'forward',
        id: fid,
        sourceConversationId: source.id,
        sourceId: msg.id,
      });
      expect(
        (await advanced.detail(alice.actor, target.id, fid)).content,
      ).toMatchObject({ text: msg.text, sourceId: msg.id });
      const denied = await advanced.detail(bob.actor, target.id, fid);
      expect(denied.state).toBe('UNAVAILABLE');
      expect(denied.content).toBeNull();
      expect(JSON.stringify(denied)).not.toContain(msg.id);
      expect(
        (await messages.messages(alice.actor, target.id, page)).items,
      ).toEqual([]);
      const cursor = (await advanced.timeline(alice.actor, target.id, page))
        .changeCursor;
      await action(
        source.id,
        { action: 'edit', messageId: msg.id, text: 'Live edit' },
        owner,
        1,
      );
      await expect(
        advanced.changes(alice.actor, target.id, { ...page, cursor }),
      ).rejects.toThrow();
      expect(
        (await advanced.detail(alice.actor, target.id, fid)).content!.text,
      ).toBe('Live edit');
      expect(
        (
          await advanced.timeline(bob.actor, target.id, page, {
            search: 'Live edit',
          })
        ).items,
      ).toEqual([]);
      await action(
        source.id,
        { action: 'delete', messageId: msg.id },
        owner,
        2,
      );
      expect(
        (await advanced.detail(alice.actor, target.id, fid)).content,
      ).toBeNull();
      expect(
        await db.conversationMessage.count({
          where: { conversationId: target.id },
        }),
      ).toBe(0);
    });
    it('rechecks source acceptance and source visibility for forward creation and replay', async () => {
      const source = await create('PRIVATE_GROUP', [alice]);
      await accept(source.id, alice);
      const msg = await send(source.id);
      const target = await group();
      await expect(
        action(
          target.id,
          {
            action: 'forward',
            id: randomUUID(),
            sourceConversationId: source.id,
            sourceId: msg.id,
          },
          bob,
        ),
      ).rejects.toThrow();
      const key = randomUUID(),
        body = {
          action: 'forward' as const,
          id: randomUUID(),
          sourceConversationId: source.id,
          sourceId: msg.id,
        };
      await action(target.id, body, alice, undefined, key);
      await action(source.id, { action: 'hide', messageId: msg.id }, alice);
      expect(
        (await advanced.detail(alice.actor, target.id, body.id)).content,
      ).toBeNull();
      await expect(
        action(target.id, body, alice, undefined, key),
      ).rejects.toThrow();
      expect(
        (await advanced.detail(owner.actor, target.id, body.id)).content!.text,
      ).toBe(msg.text);
    });
    it('invalidates forward caches on source conversation revocation', async () => {
      const source = await group(),
        msg = await send(source.id),
        target = await group(),
        fid = randomUUID();
      await action(target.id, {
        action: 'forward',
        id: fid,
        sourceConversationId: source.id,
        sourceId: msg.id,
      });
      const cursor = (await advanced.timeline(alice.actor, target.id, page))
          .changeCursor,
        am = await member(source.id, alice);
      await messages.changeMember(
        owner.actor,
        source.id,
        am.id,
        am.revision,
        null,
      );
      await expect(
        advanced.changes(alice.actor, target.id, { ...page, cursor }),
      ).rejects.toThrow();
      expect((await advanced.detail(alice.actor, target.id, fid)).state).toBe(
        'UNAVAILABLE',
      );
    });
    it('supports same-root channel forwards without invalidating on ordinary target writes', async () => {
      const p = await work();
      await join(p.id);
      const source = await channel(p.id),
        target = await channel(p.id);
      await accept(source.id);
      await accept(target.id);
      const msg = await send(source.id),
        fid = randomUUID();
      await action(target.id, {
        action: 'forward',
        id: fid,
        sourceConversationId: source.id,
        sourceId: msg.id,
      });
      const snapshot = await advanced.timeline(alice.actor, target.id, page);
      await send(target.id, owner, 'Target write');
      const changes = await advanced.changes(alice.actor, target.id, {
        ...page,
        cursor: snapshot.changeCursor,
      });
      expect(changes.items).toHaveLength(1);
      expect(changes.items[0]!.message.content!.text).toBe('Target write');
    });
    it('does not let empty/foreign/signed-context cursors cross API or user boundaries', async () => {
      const g = await group();
      await send(g.id);
      const snapshot = await advanced.timeline(owner.actor, g.id, page);
      await expect(
        advanced.changes(alice.actor, g.id, {
          ...page,
          cursor: snapshot.changeCursor,
        }),
      ).rejects.toThrow();
      await expect(
        advanced.timeline(owner.actor, g.id, {
          ...page,
          cursor: snapshot.changeCursor,
        }),
      ).rejects.toThrow();
      await expect(
        advanced.changes(owner.actor, g.id, {
          ...page,
          cursor: snapshot.changeCursor + 'x',
        }),
      ).rejects.toThrow();
    });
    it('retains old-shape API compatibility and validates advanced HTTP input/concurrency', async () => {
      const g = await group(),
        msg = await send(g.id),
        session = await cookie(owner);
      await request(app.getHttpServer())
        .get('/api/v1/conversations/' + g.id + '/message-details/' + msg.id)
        .set('Cookie', session)
        .expect(200)
        .expect('Cache-Control', 'no-store');
      await request(app.getHttpServer())
        .post('/api/v1/conversations/' + g.id + '/advanced-actions')
        .set('Cookie', session)
        .set('Origin', origin)
        .set('Idempotency-Key', randomUUID())
        .send({ action: 'edit', messageId: msg.id, text: 'Needs version' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/v1/conversations/' + g.id + '/advanced-actions')
        .set('Cookie', session)
        .set('Origin', origin)
        .set('Idempotency-Key', randomUUID())
        .send({
          action: 'reaction',
          messageId: msg.id,
          emoji: 'text',
          active: true,
        })
        .expect(400);
      const edited = await request(app.getHttpServer())
        .post('/api/v1/conversations/' + g.id + '/advanced-actions')
        .set('Cookie', session)
        .set('Origin', origin)
        .set('If-Match', '"1"')
        .set('Idempotency-Key', randomUUID())
        .send({ action: 'edit', messageId: msg.id, text: 'HTTP edited' })
        .expect(201);
      expect(edited.body.revision).toBe(2);
      expect(
        c.ConversationMessageSchema.parse(
          (await messages.messages(alice.actor, g.id, page)).items[0],
        ).text,
      ).toBe('HTTP edited');
    });
    it('preserves effects and message history on a signed-control publication failure', async () => {
      const g = await group(),
        msg = await send(g.id),
        before = await db.sharedAuditEvent.count();
      vi.spyOn(control, 'append').mockRejectedValueOnce(
        new Error('Synthetic control failure'),
      );
      await expect(
        action(
          g.id,
          { action: 'edit', messageId: msg.id, text: 'Must roll back' },
          owner,
          1,
        ),
      ).rejects.toThrow();
      expect(
        (
          await db.conversationMessage.findUniqueOrThrow({
            where: { id: msg.id },
          })
        ).text,
      ).toBe(msg.text);
      expect(
        await db.messageRevision.count({ where: { messageId: msg.id } }),
      ).toBe(0);
      expect(await db.sharedAuditEvent.count()).toBe(before);
    });
    it('rechecks every hop of a forward chain and invalidates dependent cursors', async () => {
      const source = await group(),
        middle = await group(),
        target = await group(),
        msg = await send(source.id),
        first = randomUUID(),
        second = randomUUID();
      await action(middle.id, {
        action: 'forward',
        id: first,
        sourceConversationId: source.id,
        sourceId: msg.id,
      });
      await action(target.id, {
        action: 'forward',
        id: second,
        sourceConversationId: middle.id,
        sourceId: first,
      });
      expect(
        (await advanced.detail(alice.actor, target.id, second)).content!.text,
      ).toBe(msg.text);
      const cursor = (await advanced.timeline(alice.actor, target.id, page))
          .changeCursor,
        am = await member(middle.id, alice);
      await messages.changeMember(
        owner.actor,
        middle.id,
        am.id,
        am.revision,
        null,
      );
      await expect(
        advanced.changes(alice.actor, target.id, { ...page, cursor }),
      ).rejects.toThrow();
      expect(
        (await advanced.detail(alice.actor, target.id, second)).content,
      ).toBeNull();
      expect(
        (await advanced.detail(owner.actor, target.id, second)).content!.text,
      ).toBe(msg.text);
    });
    it('fences source revocation before a waiting cross-root forward read', async () => {
      const source = await group(),
        target = await group(),
        msg = await send(source.id),
        fid = randomUUID();
      await action(target.id, {
        action: 'forward',
        id: fid,
        sourceConversationId: source.id,
        sourceId: msg.id,
      });
      const am = await member(source.id, alice),
        entered = barrier(),
        release = barrier(),
        original = messages.effect.bind(messages);
      vi.spyOn(messages, 'effect').mockImplementation(async (s, ...rest) => {
        if (s.conv.id === source.id && rest[0] === 'messaging.member.remove') {
          entered.release();
          await release.promise;
        }
        return original(s, ...rest);
      });
      const removal = outcome(
        messages.changeMember(owner.actor, source.id, am.id, am.revision, null),
      );
      await entered.promise;
      const read = outcome(advanced.detail(alice.actor, target.id, fid));
      try {
        await blocked();
      } finally {
        release.release();
      }
      expect((await removal).error).toBeUndefined();
      expect((await read).value).toMatchObject({
        state: 'UNAVAILABLE',
        content: null,
      });
    });
    it('preserves authorized source history after owner exit, then denies forwarding on the reader departure', async () => {
      const source = await group(),
        msg = await send(source.id),
        targetId = randomUUID();
      const target = await messages.create(
        alice.actor,
        {
          id: targetId,
          kind: 'PRIVATE_GROUP',
          title: 'Separate custody',
          participants: [owner.actor.userId],
          retentionPolicyVersion: version,
        },
        randomUUID(),
      );
      await accept(target.id, owner);
      const fid = randomUUID();
      await action(
        target.id,
        {
          action: 'forward',
          id: fid,
          sourceConversationId: source.id,
          sourceId: msg.id,
        },
        alice,
      );
      const cursor = (await advanced.timeline(alice.actor, target.id, page))
        .changeCursor;
      await db.space.updateMany({
        where: { kind: 'PERSONAL', ownerUserId: owner.actor.userId },
        data: { accessClosedAt: new Date() },
      });
      await expect(
        advanced.changes(alice.actor, target.id, { ...page, cursor }),
      ).rejects.toThrow();
      expect(
        (await advanced.detail(alice.actor, target.id, fid)).content?.text,
      ).toBe('Private text');
      await messages.leave(
        alice.actor,
        source.id,
        (await member(source.id, alice)).revision,
      );
      expect(
        (await advanced.detail(alice.actor, target.id, fid)).content,
      ).toBeNull();
      expect(await messages.disposalBlocker(db, source.id)).toBe(
        'OUTSIDE_MESSAGE_REFERENCE',
      );
      expect(await db.messageEntry.count({ where: { id: msg.id } })).toBe(1);
    });
  });
  describe('P5-03 media and private progress', () => {
    async function conversation() {
      const g = await create('PRIVATE_GROUP', [alice, bob]);
      await accept(g.id, alice);
      await accept(g.id, bob);
      return g;
    }
    function wav(seconds = 1) {
      const rate = 8000,
        data = rate * 2 * seconds,
        b = Buffer.alloc(44 + data);
      b.write('RIFF');
      b.writeUInt32LE(b.length - 8, 4);
      b.write('WAVEfmt ', 8);
      b.writeUInt32LE(16, 16);
      b.writeUInt16LE(1, 20);
      b.writeUInt16LE(1, 22);
      b.writeUInt32LE(rate, 24);
      b.writeUInt32LE(rate * 2, 28);
      b.writeUInt16LE(2, 32);
      b.writeUInt16LE(16, 34);
      b.write('data', 36);
      b.writeUInt32LE(data, 40);
      return b;
    }
    async function upload(
      id: string,
      who = owner,
      data = Buffer.from('Private attachment'),
      voice = false,
    ) {
      const file = await media.initiate(
        who.actor,
        id,
        voice
          ? {
              id: randomUUID(),
              kind: 'VOICE',
              filename: 'recording.wav',
              mimeType: 'audio/wav',
              expectedSize: data.length,
            }
          : {
              id: randomUUID(),
              kind: 'FILE',
              filename: 'private.txt',
              mimeType: 'text/plain',
              expectedSize: data.length,
            },
        randomUUID(),
      );
      await media.complete(
        who.actor,
        id,
        file.id,
        Readable.from([data]),
        String(data.length),
      );
      return file;
    }
    async function publish(
      id: string,
      attachment: string,
      who = owner,
      caption: string | null = null,
    ) {
      return media.create(
        who.actor,
        id,
        { id: randomUUID(), caption, attachments: [attachment], mentions: [] },
        randomUUID(),
      );
    }
    async function bytes(stream: Readable) {
      const parts = [];
      for await (const p of stream) parts.push(Buffer.from(p as Uint8Array));
      return Buffer.concat(parts);
    }
    it('publishes attachment-only messages without fake text and preserves prior contracts', async () => {
      const g = await conversation(),
        file = await upload(g.id),
        msg = await publish(g.id, file.id);
      expect(msg).toMatchObject({
        kind: 'MEDIA',
        state: 'VISIBLE',
        text: null,
        sequence: '1',
      });
      expect(msg.attachments[0]!.id).toBe(file.id);
      expect((await messages.messages(alice.actor, g.id, page)).items).toEqual(
        [],
      );
      expect((await advanced.timeline(alice.actor, g.id, page)).items).toEqual(
        [],
      );
      expect((await advanced.changes(alice.actor, g.id, page)).items).toEqual(
        [],
      );
      await expect(
        advanced.detail(alice.actor, g.id, msg.id),
      ).rejects.toThrow();
      expect(
        (
          await bytes(
            (await media.download(alice.actor, g.id, msg.id, file.id)).stream,
          )
        ).toString(),
      ).toBe('Private attachment');
      expect((await media.timeline(alice.actor, g.id, page)).items[0]!.id).toBe(
        msg.id,
      );
      expect(
        await db.conversationMessage.count({ where: { id: msg.id } }),
      ).toBe(0);
    });
    it('derives voice duration from actual PCM bytes and enforces both limits', async () => {
      const g = await conversation(),
        file = await upload(g.id, owner, wav(120), true),
        msg = await publish(g.id, file.id);
      expect(msg.attachments[0]!.durationMs).toBe(120000);
      const data = wav(121),
        bad = await media.initiate(
          owner.actor,
          g.id,
          {
            id: randomUUID(),
            kind: 'VOICE',
            filename: 'long.wav',
            mimeType: 'audio/wav',
            expectedSize: data.length,
          },
          randomUUID(),
        );
      await expect(
        media.complete(
          owner.actor,
          g.id,
          bad.id,
          Readable.from([data]),
          String(data.length),
        ),
      ).rejects.toThrow();
      expect((await media.status(owner.actor, g.id, bad.id)).status).toBe(
        'REJECTED',
      );
      await expect(
        media.initiate(
          owner.actor,
          g.id,
          {
            id: randomUUID(),
            kind: 'VOICE',
            filename: 'big.wav',
            mimeType: 'audio/wav',
            expectedSize: 10000001,
          },
          randomUUID(),
        ),
      ).rejects.toThrow();
    });
    it('rejects MIME mismatch, unsafe names and unsupported audio', async () => {
      const g = await conversation(),
        file = await media.initiate(
          owner.actor,
          g.id,
          {
            id: randomUUID(),
            kind: 'IMAGE',
            filename: 'fake.png',
            mimeType: 'image/png',
            expectedSize: 4,
          },
          randomUUID(),
        );
      await expect(
        media.complete(
          owner.actor,
          g.id,
          file.id,
          Readable.from([Buffer.from('fake')]),
          '4',
        ),
      ).rejects.toThrow();
      expect((await media.status(owner.actor, g.id, file.id)).status).toBe(
        'REJECTED',
      );
      await expect(
        media.initiate(
          owner.actor,
          g.id,
          {
            id: randomUUID(),
            kind: 'FILE',
            filename: '../secret.txt',
            mimeType: 'text/plain',
            expectedSize: 4,
          },
          randomUUID(),
        ),
      ).rejects.toThrow();
      expect(
        c.MessageAttachmentUploadSchema.safeParse({
          id: randomUUID(),
          kind: 'VOICE',
          filename: 'voice.webm',
          mimeType: 'audio/webm',
          expectedSize: 50,
        }).success,
      ).toBe(false);
    });
    it('requires current uploader/admission and rejects foreign-conversation linking', async () => {
      const g = await conversation(),
        other = await conversation(),
        pending = await media.initiate(
          owner.actor,
          g.id,
          {
            id: randomUUID(),
            kind: 'FILE',
            filename: 'private.txt',
            mimeType: 'text/plain',
            expectedSize: 4,
          },
          randomUUID(),
        );
      await expect(
        media.status(alice.actor, g.id, pending.id),
      ).rejects.toThrow();
      await expect(
        media.complete(
          alice.actor,
          g.id,
          pending.id,
          Readable.from([Buffer.from('test')]),
          '4',
        ),
      ).rejects.toThrow();
      await media.complete(
        owner.actor,
        g.id,
        pending.id,
        Readable.from([Buffer.from('test')]),
        '4',
      );
      await expect(publish(other.id, pending.id)).rejects.toThrow();
      const msg = await publish(g.id, pending.id);
      await expect(publish(g.id, pending.id)).rejects.toThrow();
      await expect(
        media.download(owner.actor, other.id, msg.id, pending.id),
      ).rejects.toThrow();
      await expect(
        media.download(outsider.actor, g.id, msg.id, pending.id),
      ).rejects.toThrow();
      await expect(
        media.cancel(owner.actor, g.id, pending.id, 3),
      ).rejects.toThrow();
    });
    it('denies finalization when membership is revoked during upload', async () => {
      const g = await conversation(),
        file = await media.initiate(
          alice.actor,
          g.id,
          {
            id: randomUUID(),
            kind: 'FILE',
            filename: 'race.txt',
            mimeType: 'text/plain',
            expectedSize: 4,
          },
          randomUUID(),
        ),
        entered = barrier(),
        release = barrier();
      const stream = Readable.from(
        (async function* () {
          yield Buffer.from('te');
          entered.release();
          await release.promise;
          yield Buffer.from('st');
        })(),
      );
      const completion = outcome(
        media.complete(alice.actor, g.id, file.id, stream, '4'),
      );
      await entered.promise;
      const am = await member(g.id, alice);
      await messages.changeMember(owner.actor, g.id, am.id, am.revision, null);
      release.release();
      expect((await completion).error).toBeDefined();
      expect(
        (await db.storedFile.findUniqueOrThrow({ where: { id: file.id } }))
          .status,
      ).not.toBe('READY');
      expect((await media.timeline(owner.actor, g.id, page)).items).toEqual([]);
    });
    it('rechecks download authority after opening bytes before publishing the stream', async () => {
      const g = await conversation(),
        file = await upload(g.id),
        msg = await publish(g.id, file.id),
        entered = barrier(),
        release = barrier(),
        original = media.files.open.bind(media.files);
      let opened: Readable | undefined;
      vi.spyOn(media.files, 'open').mockImplementation(async (f) => {
        const stream = await original(f);
        if (f.id === file.id) {
          opened = stream;
          entered.release();
          await release.promise;
        }
        return stream;
      });
      const downloading = outcome(
        media.download(alice.actor, g.id, msg.id, file.id),
      );
      await entered.promise;
      const am = await member(g.id, alice);
      await messages.changeMember(owner.actor, g.id, am.id, am.revision, null);
      release.release();
      expect((await downloading).error).toBeDefined();
      expect(opened!.destroyed).toBe(true);
    });
    it('keeps forwarded attachment bodies private and live under source deletion', async () => {
      const source = await create('PRIVATE_GROUP', [alice]);
      await accept(source.id, alice);
      const file = await upload(source.id),
        msg = await publish(source.id, file.id),
        target = await conversation(),
        forward = await media.forward(
          owner.actor,
          target.id,
          {
            id: randomUUID(),
            sourceConversationId: source.id,
            sourceId: msg.id,
          },
          randomUUID(),
        );
      expect(
        (await media.detail(alice.actor, target.id, forward.id)).attachments,
      ).toHaveLength(1);
      const hidden = await media.detail(bob.actor, target.id, forward.id);
      expect(hidden).toMatchObject({
        state: 'UNAVAILABLE',
        attachments: [],
        sourceId: null,
        sourceConversationId: null,
      });
      expect(JSON.stringify(hidden)).not.toContain('private.txt');
      await expect(
        media.download(bob.actor, target.id, forward.id, file.id),
      ).rejects.toThrow();
      expect(
        (
          await bytes(
            (await media.download(alice.actor, target.id, forward.id, file.id))
              .stream,
          )
        ).toString(),
      ).toBe('Private attachment');
      await advanced.act(
        owner.actor,
        source.id,
        { action: 'delete', messageId: msg.id },
        randomUUID(),
        1,
      );
      expect(
        (await media.detail(alice.actor, target.id, forward.id)).attachments,
      ).toEqual([]);
      await expect(
        media.download(alice.actor, target.id, forward.id, file.id),
      ).rejects.toThrow();
      expect(
        (await db.storedFile.findUniqueOrThrow({ where: { id: file.id } }))
          .status,
      ).toBe('READY');
    });
    it('preserves caption history and returns only current media tombstones', async () => {
      const g = await conversation(),
        file = await upload(g.id),
        msg = await publish(g.id, file.id, owner, 'Old caption'),
        snapshot = await media.timeline(alice.actor, g.id, page);
      expect(
        (
          await media.edit(
            owner.actor,
            g.id,
            msg.id,
            'Current caption',
            randomUUID(),
            1,
          )
        ).text,
      ).toBe('Current caption');
      expect(
        (await media.revisions(owner.actor, g.id, msg.id, page)).items[0]!
          .caption,
      ).toBe('Old caption');
      await expect(
        media.revisions(alice.actor, g.id, msg.id, page),
      ).rejects.toThrow();
      await advanced.act(
        owner.actor,
        g.id,
        { action: 'delete', messageId: msg.id },
        randomUUID(),
        2,
      );
      expect(
        (
          await media.changes(alice.actor, g.id, {
            ...page,
            cursor: snapshot.changeCursor,
          })
        ).items.every(
          (v) => v.message.attachments.length === 0 && v.message.text === null,
        ),
      ).toBe(true);
      expect(
        (await media.timeline(alice.actor, g.id, page, { search: 'caption' }))
          .items,
      ).toEqual([]);
      await expect(
        media.revisions(owner.actor, g.id, msg.id, page),
      ).rejects.toThrow();
    });
    it('never infers read from polling and requires mutual author/recipient receipt opt-in', async () => {
      const g = await conversation(),
        msg = await send(g.id);
      await media.timeline(alice.actor, g.id, page);
      expect(await progress.get(alice.actor, g.id)).toMatchObject({
        deliveredThrough: '0',
        readThrough: '0',
        shareReceipts: false,
      });
      const before = await db.sharedAuditEvent.count();
      await progress.acknowledge(
        alice.actor,
        g.id,
        { messageId: msg.id, state: 'READ' },
        randomUUID(),
      );
      expect(await db.sharedAuditEvent.count()).toBe(before);
      expect(await progress.summary(owner.actor, g.id, msg.id)).toMatchObject({
        sharing: false,
        deliveredCount: null,
        readCount: null,
      });
      await progress.sharing(owner.actor, g.id, true, randomUUID(), 1);
      expect(await progress.summary(owner.actor, g.id, msg.id)).toMatchObject({
        deliveredCount: 0,
        readCount: 0,
      });
      await progress.sharing(alice.actor, g.id, true, randomUUID(), 2);
      expect(await progress.summary(owner.actor, g.id, msg.id)).toMatchObject({
        deliveredCount: 1,
        readCount: 1,
      });
      await expect(progress.summary(bob.actor, g.id, msg.id)).rejects.toThrow();
      await progress.sharing(alice.actor, g.id, false, randomUUID(), 3);
      expect(await progress.summary(owner.actor, g.id, msg.id)).toMatchObject({
        deliveredCount: 0,
        readCount: 0,
      });
    });
    it('keeps concurrent acknowledgement retries monotonic and idempotent', async () => {
      const g = await conversation(),
        first = await send(g.id),
        last = await send(g.id),
        key = randomUUID(),
        body = { messageId: last.id, state: 'READ' as const };
      await Promise.all([
        progress.acknowledge(alice.actor, g.id, body, key),
        progress.acknowledge(alice.actor, g.id, body, key),
      ]);
      await progress.acknowledge(
        alice.actor,
        g.id,
        { messageId: first.id, state: 'DELIVERED' },
        randomUUID(),
      );
      expect(await progress.get(alice.actor, g.id)).toMatchObject({
        readThrough: '2',
        deliveredThrough: '2',
      });
      expect(
        await db.messagePersonalMutation.count({
          where: { memberId: (await member(g.id, alice)).id },
        }),
      ).toBe(2);
      await expect(
        progress.acknowledge(
          alice.actor,
          g.id,
          { messageId: first.id, state: 'READ' },
          key,
        ),
      ).rejects.toThrow();
    });
    it('starts new receipt progress/consent after rejoin and hides revoked contributions', async () => {
      const g = await conversation(),
        msg = await send(g.id);
      await progress.sharing(owner.actor, g.id, true, randomUUID(), 1);
      await progress.sharing(alice.actor, g.id, true, randomUUID(), 1);
      await progress.acknowledge(
        alice.actor,
        g.id,
        { messageId: msg.id, state: 'READ' },
        randomUUID(),
      );
      const am = await member(g.id, alice);
      await messages.leave(alice.actor, g.id, am.revision);
      expect(
        (await progress.summary(owner.actor, g.id, msg.id)).readCount,
      ).toBe(0);
      await messages.invite(
        owner.actor,
        g.id,
        (await messages.get(owner.actor, g.id)).revision,
        { id: randomUUID(), userId: alice.actor.userId },
        randomUUID(),
      );
      await accept(g.id, alice);
      expect((await progress.get(alice.actor, g.id)).shareReceipts).toBe(false);
      await expect(
        progress.acknowledge(
          alice.actor,
          g.id,
          { messageId: msg.id, state: 'READ' },
          randomUUID(),
        ),
      ).rejects.toThrow();
      await expect(media.detail(alice.actor, g.id, msg.id)).rejects.toThrow();
    });
    it('preserves reactions, pins, mentions and replies on real media messages', async () => {
      const g = await conversation(),
        file = await upload(g.id),
        am = await member(g.id),
        msg = await media.create(
          owner.actor,
          g.id,
          {
            id: randomUUID(),
            caption: null,
            attachments: [file.id],
            mentions: [am.id],
          },
          randomUUID(),
        );
      await advanced.act(
        alice.actor,
        g.id,
        { action: 'reaction', messageId: msg.id, emoji: '👍', active: true },
        randomUUID(),
      );
      await advanced.act(
        owner.actor,
        g.id,
        { action: 'pin', messageId: msg.id, active: true },
        randomUUID(),
        2,
      );
      const projected = await media.detail(alice.actor, g.id, msg.id);
      expect(projected).toMatchObject({
        pinned: true,
        mentions: [am.id],
        reactions: [{ emoji: '👍', count: 1, mine: true }],
      });
      const replyFile = await upload(g.id, alice),
        reply = await media.create(
          alice.actor,
          g.id,
          {
            id: randomUUID(),
            caption: 'Reply',
            attachments: [replyFile.id],
            mentions: [],
            replyToId: msg.id,
          },
          randomUUID(),
        );
      expect(reply).toMatchObject({ replyToId: msg.id, threadId: msg.id });
      expect(
        (await media.timeline(alice.actor, g.id, page, { thread: msg.id }))
          .items,
      ).toHaveLength(2);
      await advanced.act(
        alice.actor,
        g.id,
        { action: 'hide', messageId: msg.id },
        randomUUID(),
      );
      expect(await media.detail(alice.actor, g.id, msg.id)).toMatchObject({
        state: 'HIDDEN',
        attachments: [],
        mentions: [],
        reactions: [],
        pinned: false,
      });
    });
    it('rejects multiple recordings in a single voice message', async () => {
      const g = await conversation(),
        a = await upload(g.id, owner, wav(), true),
        b = await upload(g.id, owner, wav(), true);
      await expect(
        media.create(
          owner.actor,
          g.id,
          {
            id: randomUUID(),
            caption: null,
            attachments: [a.id, b.id],
            mentions: [],
          },
          randomUUID(),
        ),
      ).rejects.toThrow();
      expect(
        await db.messageEntry.count({ where: { conversationId: g.id } }),
      ).toBe(0);
    });
    it('allows Viewer personal acknowledgements while rejecting shared media writes', async () => {
      const p = await work();
      await join(p.id, viewer, 'VIEWER');
      const g = await channel(p.id, 'PROJECT', [viewer]);
      await accept(g.id, viewer);
      const msg = await send(g.id);
      await progress.acknowledge(
        viewer.actor,
        g.id,
        { messageId: msg.id, state: 'READ' },
        randomUUID(),
      );
      expect((await progress.get(viewer.actor, g.id)).readThrough).toBe(
        msg.sequence,
      );
      await expect(
        media.initiate(
          viewer.actor,
          g.id,
          {
            id: randomUUID(),
            kind: 'FILE',
            filename: 'denied.txt',
            mimeType: 'text/plain',
            expectedSize: 1,
          },
          randomUUID(),
        ),
      ).rejects.toThrow();
      await expect(
        media.create(
          viewer.actor,
          g.id,
          {
            id: randomUUID(),
            caption: null,
            attachments: [randomUUID()],
            mentions: [],
          },
          randomUUID(),
        ),
      ).rejects.toThrow();
    });
  });
  describe('P5-03 private notices and durable push', () => {
    beforeEach(async () => {
      // Dispatcher isolation: earlier cases keep their rows but contribute no work.
      await db.messageActivity.updateMany({ data: { processed: true } });
      await db.messageNotice.updateMany({
        where: { state: 'PENDING' },
        data: { state: 'CANCELED' },
      });
      await db.messageNoticeAttempt.updateMany({
        where: { state: { in: ['PENDING', 'RETRY', 'PROCESSING', 'NETWORK'] } },
        data: { state: 'CANCELED' },
      });
    });
    async function ready() {
      const g = await create();
      await accept(g.id);
      return g;
    }
    async function enable(chat = true) {
      const space = await db.space.findFirstOrThrow({
        where: { ownerUserId: alice.actor.userId, kind: 'PERSONAL' },
      });
      await db.notificationPreference.upsert({
        where: { spaceId: space.id },
        create: {
          spaceId: space.id,
          ownerUserId: alice.actor.userId,
          createdByUserId: alice.actor.userId,
          webPush: true,
        },
        update: { webPush: true },
      });
      const key = createECDH('prime256v1');
      key.generateKeys();
      const endpoint = 'https://fcm.googleapis.com/fcm/send/' + randomUUID();
      const sub = await db.pushSubscription.create({
        data: {
          spaceId: space.id,
          ownerUserId: alice.actor.userId,
          createdByUserId: alice.actor.userId,
          endpoint,
          endpointHost: 'fcm.googleapis.com',
          endpointHash: createHash('sha256').update(endpoint).digest('hex'),
          p256dh: key.getPublicKey().toString('base64url'),
          auth: randomBytes(16).toString('base64url'),
        },
      });
      if (chat) {
        const old = await messagingPush.settings(alice.actor);
        await messagingPush.setConsent(
          alice.actor,
          true,
          old.revision,
          randomUUID(),
        );
      }
      return sub;
    }
    async function prepare() {
      for (let i = 0; i < 60; i++) {
        if (!(await notices.fanout())) break;
        if (i === 59) throw Error('Fanout did not settle');
      }
      for (let i = 0; i < 60; i++) {
        if (!(await notices.prepare())) break;
        if (i === 59) throw Error('Preparation did not settle');
      }
    }
    async function notice(messageId: string) {
      return db.messageNotice.findFirstOrThrow({
        where: {
          actorId: (
            await member(
              (
                await db.messageEntry.findUniqueOrThrow({
                  where: { id: messageId },
                })
              ).conversationId,
            )
          ).actorId,
          activity: { messageId },
        },
      });
    }
    async function attempt(messageId: string) {
      return db.messageNoticeAttempt.findFirstOrThrow({
        where: { noticeId: (await notice(messageId)).id },
      });
    }
    async function settings(
      id: string,
      mode: 'ALL' | 'MUTED' | 'MENTIONS_ONLY',
      quietStart: string | null = null,
      quietEnd: string | null = null,
      mentionQuiet = false,
    ) {
      const old = await progress.noticeSettings(alice.actor, id);
      return progress.setNoticeSettings(
        alice.actor,
        id,
        { mode, quietStart, quietEnd, mentionQuiet },
        randomUUID(),
        old.revision,
      );
    }
    async function mention(id: string) {
      const result = await advanced.act(
        owner.actor,
        id,
        {
          action: 'compose',
          id: randomUUID(),
          text: 'Private mention',
          mentions: [(await member(id)).id],
        },
        randomUUID(),
      );
      return { id: result.resourceId };
    }
    it('requires separate chat consent without replaying old events', async () => {
      const g = await ready();
      await enable(false);
      const old = await send(g.id);
      await prepare();
      expect(
        await db.messageNoticeAttempt.count({
          where: { noticeId: (await notice(old.id)).id },
        }),
      ).toBe(0);
      expect(
        (await notices.list(alice.actor, page)).items.some(
          (v) => v.messageId === old.id,
        ),
      ).toBe(true);
      const opt = await messagingPush.settings(alice.actor);
      expect(opt.enabled).toBe(false);
      await messagingPush.setConsent(
        alice.actor,
        true,
        opt.revision,
        randomUUID(),
      );
      const current = await send(g.id);
      await prepare();
      expect((await attempt(current.id)).attempts).toBe(0);
      expect(
        await db.messageNoticeAttempt.count({
          where: { noticeId: (await notice(old.id)).id },
        }),
      ).toBe(0);
    });
    it('fails closed at equal timestamp boundaries for consent, unmute and renewed subscriptions', async () => {
      const g = await ready(),
        sub = await enable(false),
        old = await send(g.id),
        opt = await messagingPush.settings(alice.actor);
      await messagingPush.setConsent(
        alice.actor,
        true,
        opt.revision,
        randomUUID(),
      );
      const consent = await db.notificationPreference.findFirstOrThrow({
        where: { ownerUserId: alice.actor.userId },
      });
      // Establish exact database equality without a host-timezone Date round trip.
      await db.$executeRaw`UPDATE "MessageActivity" SET "createdAt"=(SELECT "messagingEnabledAt" FROM "NotificationPreference" WHERE id=${consent.id}::uuid) WHERE "messageId"=${old.id}::uuid`;
      await prepare();
      expect(
        await db.messageNoticeAttempt.count({
          where: { noticeId: (await notice(old.id)).id },
        }),
      ).toBe(0);
      await settings(g.id, 'MUTED');
      const muted = await send(g.id);
      await settings(g.id, 'ALL');
      const p = await db.messageNoticePreference.findUniqueOrThrow({
        where: {
          memberId_generation: {
            memberId: (await member(g.id)).id,
            generation: 1,
          },
        },
      });
      await db.$executeRaw`UPDATE "MessageActivity" SET "createdAt"=(SELECT "effectiveAt" FROM "MessageNoticePreference" WHERE "memberId"=${p.memberId}::uuid AND generation=${p.generation}) WHERE "messageId"=${muted.id}::uuid`;
      await prepare();
      expect(
        await db.messageNoticeAttempt.count({
          where: { noticeId: (await notice(muted.id)).id },
        }),
      ).toBe(0);
      const renewed = await send(g.id),
        event = await db.messageActivity.findFirstOrThrow({
          where: { messageId: renewed.id },
        });
      await db.$executeRaw`UPDATE "PushSubscription" SET "updatedAt"=(SELECT "createdAt" FROM "MessageActivity" WHERE id=${event.id}::uuid) WHERE id=${sub.id}::uuid`;
      await prepare();
      expect(
        await db.messageNoticeAttempt.count({
          where: { noticeId: (await notice(renewed.id)).id },
        }),
      ).toBe(0);
      const future = await send(g.id);
      await prepare();
      expect(await attempt(future.id)).toBeDefined();
    });
    it('deduplicates concurrent fanout/dispatch and exposes only safe owner metadata', async () => {
      const g = await ready();
      await enable();
      const msg = await send(g.id, owner, 'Never push this confidential body');
      await Promise.all([notices.fanout(), notices.fanout()]);
      await prepare();
      const n = await notice(msg.id),
        spy = vi
          .spyOn(messagingPush, 'send')
          .mockResolvedValue({ outcome: 'ACCEPTED', code: 'ACCEPTED' });
      await Promise.all([
        messagingWorker.delivery(),
        messagingWorker.delivery(),
      ]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect((await attempt(msg.id)).state).toBe('DELIVERED');
      expect(
        JSON.stringify(await notices.attempts(alice.actor, n.id)),
      ).not.toMatch(/endpoint|p256dh|auth|confidential|subscriptionId/);
      await expect(notices.attempts(owner.actor, n.id)).rejects.toThrow();
      expect((await progress.get(alice.actor, g.id)).readThrough).toBe('0');
    });
    it('shows pending invitees only their valid invitation', async () => {
      await enable();
      const g = await create(),
        msg = await send(g.id);
      await prepare();
      expect(
        (await notices.list(alice.actor, page)).items
          .filter((v) => v.conversationId === g.id)
          .map((v) => v.kind),
      ).toEqual(['INVITATION']);
      expect(
        await db.messageNotice.count({
          where: { activity: { messageId: msg.id } },
        }),
      ).toBe(0);
      await expect(media.detail(alice.actor, g.id, msg.id)).rejects.toThrow();
      await accept(g.id);
      expect(
        (await notices.list(alice.actor, page)).items.filter(
          (v) => v.conversationId === g.id,
        ),
      ).toEqual([]);
    });
    it('applies mute/mention-only and retains authorized in-app history', async () => {
      const g = await ready();
      await enable();
      await settings(g.id, 'MENTIONS_ONLY');
      const plain = await send(g.id),
        direct = await mention(g.id);
      await prepare();
      expect(
        await db.messageNoticeAttempt.count({
          where: { noticeId: (await notice(plain.id)).id },
        }),
      ).toBe(0);
      expect(await attempt(direct.id)).toBeDefined();
      await settings(g.id, 'MUTED');
      const spy = vi.spyOn(messagingPush, 'send');
      await messagingWorker.delivery();
      expect(spy).not.toHaveBeenCalled();
      expect((await attempt(direct.id)).state).toBe('CANCELED');
      expect(
        (await notices.list(alice.actor, page)).items.some(
          (v) => v.messageId === direct.id,
        ),
      ).toBe(true);
      await settings(g.id, 'ALL');
      await prepare();
      expect((await attempt(direct.id)).state).toBe('CANCELED');
    });
    it('defers quiet work and permits only opted-in direct mentions through quiet', async () => {
      const g = await ready();
      await enable();
      const now = new Date(),
        minute = now.getUTCHours() * 60 + now.getUTCMinutes(),
        clock = (n: number) =>
          String(Math.floor(((n + 1440) % 1440) / 60)).padStart(2, '0') +
          ':' +
          String((n + 1440) % 60).padStart(2, '0');
      await db.userSettings.update({
        where: { userId: alice.actor.userId },
        data: { timezone: 'UTC' },
      });
      await settings(g.id, 'ALL', clock(minute - 10), clock(minute + 10), true);
      const plain = await send(g.id),
        direct = await mention(g.id);
      await prepare();
      expect((await attempt(plain.id)).notBefore.getTime()).toBeGreaterThan(
        Date.now(),
      );
      const spy = vi
        .spyOn(messagingPush, 'send')
        .mockResolvedValue({ outcome: 'ACCEPTED', code: 'ACCEPTED' });
      await messagingWorker.delivery();
      expect(spy).toHaveBeenCalledTimes(1);
      expect((await attempt(direct.id)).state).toBe('DELIVERED');
      expect((await attempt(plain.id)).attempts).toBe(0);
    });
    it('bounds transient retries to five actual sends and approved backoff', async () => {
      const g = await ready();
      await enable();
      const msg = await send(g.id);
      await prepare();
      const spy = vi
          .spyOn(messagingPush, 'send')
          .mockResolvedValue({ outcome: 'RETRY', code: 'PUSH_TRANSIENT' }),
        delays = [60, 300, 900, 3600];
      for (let i = 0; i < 5; i++) {
        const before = Date.now();
        await messagingWorker.delivery();
        const a = await attempt(msg.id);
        expect(a.attempts).toBe(i + 1);
        expect(a.state).toBe(i === 4 ? 'FAILED' : 'RETRY');
        if (i < 4) {
          expect(a.notBefore.getTime() - before).toBeGreaterThanOrEqual(
            delays[i]! * 1000 - 100,
          );
          await db.messageNoticeAttempt.update({
            where: { id: a.id },
            data: { notBefore: new Date(0) },
          });
        }
      }
      expect(spy).toHaveBeenCalledTimes(5);
      expect(await messagingWorker.delivery()).toBe(false);
    });
    it('revokes gone subscriptions and clears secrets', async () => {
      const g = await ready(),
        sub = await enable();
      const msg = await send(g.id);
      await prepare();
      vi.spyOn(messagingPush, 'send').mockResolvedValue({
        outcome: 'GONE',
        code: 'PUSH_GONE',
      });
      await messagingWorker.delivery();
      expect(
        await db.pushSubscription.findUniqueOrThrow({ where: { id: sub.id } }),
      ).toMatchObject({
        state: 'REVOKED',
        endpoint: null,
        p256dh: null,
        auth: null,
        revision: 2,
      });
      expect((await attempt(msg.id)).state).toBe('FAILED');
    });
    it('never resends an ambiguous outcome, including a network-marker crash', async () => {
      const g = await ready();
      await enable();
      const msg = await send(g.id);
      await prepare();
      const spy = vi
        .spyOn(messagingPush, 'send')
        .mockRejectedValue(new Error('secret provider response'));
      await messagingWorker.delivery();
      expect((await attempt(msg.id)).state).toBe('AMBIGUOUS');
      expect(await messagingWorker.delivery()).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
      const second = await send(g.id);
      await prepare();
      const a = await attempt(second.id);
      await db.messageNoticeAttempt.update({
        where: { id: a.id },
        data: {
          state: 'NETWORK',
          token: randomUUID(),
          attempts: 1,
          leaseUntil: new Date(0),
        },
      });
      await messagingWorker.delivery();
      expect((await attempt(second.id)).state).toBe('AMBIGUOUS');
      expect(spy).toHaveBeenCalledTimes(1);
    });
    it('recovers an expired pre-network claim after restart', async () => {
      const g = await ready();
      await enable();
      const msg = await send(g.id);
      await prepare();
      const a = await attempt(msg.id);
      await db.messageNoticeAttempt.update({
        where: { id: a.id },
        data: {
          state: 'PROCESSING',
          token: randomUUID(),
          leaseUntil: new Date(0),
        },
      });
      const spy = vi
        .spyOn(messagingPush, 'send')
        .mockResolvedValue({ outcome: 'ACCEPTED', code: 'ACCEPTED' });
      await messagingWorker.delivery();
      expect(spy).toHaveBeenCalledTimes(1);
      expect((await attempt(msg.id)).state).toBe('DELIVERED');
    });
    it('reads a notice without acknowledging its message', async () => {
      const g = await ready();
      await enable();
      const msg = await send(g.id);
      await prepare();
      const n = await notice(msg.id);
      await notices.read(alice.actor, n.id, 1);
      expect((await attempt(msg.id)).state).toBe('CANCELED');
      expect((await progress.get(alice.actor, g.id)).readThrough).toBe('0');
      expect((await notices.read(alice.actor, n.id, 1)).read).toBe(true);
    });
    it('rechecks revocation between claim and final network gate', async () => {
      const g = await ready();
      await enable();
      const msg = await send(g.id);
      await prepare();
      const entered = barrier(),
        release = barrier(),
        original = notices.operation.bind(notices);
      let calls = 0;
      vi.spyOn(notices, 'operation').mockImplementation(async (...args) => {
        const result = await original(...args);
        if (++calls === 1) {
          entered.release();
          await release.promise;
        }
        return result;
      });
      const spy = vi.spyOn(messagingPush, 'send'),
        delivery = outcome(messagingWorker.delivery());
      await entered.promise;
      const am = await member(g.id);
      await messages.changeMember(owner.actor, g.id, am.id, am.revision, null);
      release.release();
      expect((await delivery).error).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
      expect((await attempt(msg.id)).state).toBe('CANCELED');
      expect((await notices.list(alice.actor, page)).items).toEqual([]);
    });
    it('prevents retries when notice cancellation wins during network activity', async () => {
      const g = await ready();
      await enable();
      const msg = await send(g.id);
      await prepare();
      const entered = barrier(),
        release = barrier(),
        spy = vi.spyOn(messagingPush, 'send').mockImplementation(async () => {
          entered.release();
          await release.promise;
          return { outcome: 'RETRY', code: 'PUSH_TRANSIENT' };
        });
      const delivery = outcome(messagingWorker.delivery());
      await entered.promise;
      await notices.read(alice.actor, (await notice(msg.id)).id, 1);
      release.release();
      expect((await delivery).error).toBeUndefined();
      expect((await attempt(msg.id)).state).toBe('CANCELED');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await messagingWorker.delivery()).toBe(false);
    });
    it('rejects subscription revision changes before dispatch', async () => {
      const g = await ready(),
        sub = await enable();
      const msg = await send(g.id);
      await prepare();
      await db.pushSubscription.update({
        where: { id: sub.id },
        data: { revision: { increment: 1 } },
      });
      const spy = vi.spyOn(messagingPush, 'send');
      await messagingWorker.delivery();
      expect(spy).not.toHaveBeenCalled();
      expect((await attempt(msg.id)).state).toBe('CANCELED');
    });
    it('clears private receipt/settings data on actual account closure and purges stale subscriptions', async () => {
      const g = await ready(),
        sub = await enable(),
        msg = await send(g.id);
      await prepare();
      await progress.acknowledge(
        alice.actor,
        g.id,
        { messageId: msg.id, state: 'READ' },
        randomUUID(),
      );
      await settings(g.id, 'ALL');
      const am = await member(g.id),
        session = await cookie(alice);
      const challenge = c.DeletionChallengeSchema.parse(
        (
          await request(app.getHttpServer())
            .post('/api/v1/me/deletion-request')
            .set('Cookie', session)
            .set('Origin', origin)
            .set('Idempotency-Key', randomUUID())
            .send({
              password,
              accountRevision: 1,
              retentionAcknowledged: true,
              policyVersion: 'synthetic-p503-erasure',
            })
            .expect(201)
        ).body,
      );
      await request(app.getHttpServer())
        .post('/api/v1/me/deletion-request/confirm')
        .set('Cookie', session)
        .set('Origin', origin)
        .set('X-Deletion-Proof', challenge.confirmationProof)
        .send({ jobId: challenge.job.id, revision: 1 })
        .expect(201);
      expect(
        await db.messageProgress.count({ where: { memberId: am.id } }),
      ).toBe(0);
      expect(
        await db.messageNoticePreference.count({ where: { memberId: am.id } }),
      ).toBe(0);
      expect(
        await db.messagePersonalMutation.count({ where: { memberId: am.id } }),
      ).toBe(0);
      const canceledAttempt = await attempt(msg.id);
      expect(canceledAttempt.state).toBe('CANCELED');
      const spy = vi.spyOn(messagingPush, 'send');
      expect(await messagingWorker.delivery()).toBe(false);
      expect(spy).not.toHaveBeenCalled();
      await db.accountDeletionJob.update({
        where: { id: challenge.job.id },
        data: { eraseAfter: new Date(0), nextAt: new Date(0) },
      });
      const lifecycle = app.get(PersonalLifecycle);
      for (
        let i = 0;
        i < 8 && (await db.user.count({ where: { id: alice.actor.userId } }));
        i++
      )
        await lifecycle.consume();
      expect(await db.user.count({ where: { id: alice.actor.userId } })).toBe(
        0,
      );
      expect(await db.pushSubscription.count({ where: { id: sub.id } })).toBe(
        0,
      );
      expect(
        (
          await db.messageNoticeAttempt.findUniqueOrThrow({
            where: { id: canceledAttempt.id },
          })
        ).subscriptionId,
      ).toBeNull();
      expect(await db.messageEntry.count({ where: { id: msg.id } })).toBe(1);
    });
    it('requires file authority on every forwarded work-channel source', async () => {
      const p = await work();
      await join(p.id);
      const source = await channel(p.id);
      await accept(source.id);
      const file = await media.initiate(
        owner.actor,
        source.id,
        {
          id: randomUUID(),
          kind: 'FILE',
          filename: 'work.txt',
          mimeType: 'text/plain',
          expectedSize: 4,
        },
        randomUUID(),
      );
      await media.complete(
        owner.actor,
        source.id,
        file.id,
        Readable.from([Buffer.from('test')]),
        '4',
      );
      const msg = await media.create(
          owner.actor,
          source.id,
          {
            id: randomUUID(),
            caption: null,
            attachments: [file.id],
            mentions: [],
          },
          randomUUID(),
        ),
        target = await ready(),
        forward = await media.forward(
          owner.actor,
          target.id,
          {
            id: randomUUID(),
            sourceConversationId: source.id,
            sourceId: msg.id,
          },
          randomUUID(),
        );
      const authority = app.get(MessagingAuthority),
        original = authority.proof.bind(authority);
      vi.spyOn(authority, 'proof').mockImplementation(async (...args) => {
        if (args[3] === alice.actor.userId && args[5] === 'file.read')
          throw new ForbiddenException();
        return original(...args);
      });
      expect(
        (await media.detail(alice.actor, target.id, forward.id)).attachments,
      ).toEqual([]);
      await expect(
        media.download(alice.actor, target.id, forward.id, file.id),
      ).rejects.toThrow();
      await expect(
        progress.acknowledge(
          alice.actor,
          target.id,
          { messageId: forward.id, state: 'READ' },
          randomUUID(),
        ),
      ).rejects.toThrow();
    });
    it('cleans expired unlinked uploads while retaining linked message bytes', async () => {
      const g = await ready(),
        body = {
          kind: 'FILE' as const,
          filename: 'retained.txt',
          mimeType: 'text/plain' as const,
          expectedSize: 4,
        },
        linked = await media.initiate(
          owner.actor,
          g.id,
          { ...body, id: randomUUID() },
          randomUUID(),
        ),
        orphan = await media.initiate(
          owner.actor,
          g.id,
          { ...body, id: randomUUID() },
          randomUUID(),
        );
      for (const file of [linked, orphan])
        await media.complete(
          owner.actor,
          g.id,
          file.id,
          Readable.from([Buffer.from('test')]),
          '4',
        );
      const msg = await media.create(
        owner.actor,
        g.id,
        {
          id: randomUUID(),
          caption: null,
          attachments: [linked.id],
          mentions: [],
        },
        randomUUID(),
      );
      await db.messageAttachment.updateMany({
        where: { id: { in: [linked.id, orphan.id] } },
        data: { createdAt: new Date(0) },
      });
      await db.storedFile.updateMany({
        where: { id: { in: [linked.id, orphan.id] } },
        data: { createdAt: new Date(0), uploadExpiresAt: new Date(1000000) },
      });
      await messagingWorker.cleanup();
      expect(
        (
          await db.messageAttachment.findUniqueOrThrow({
            where: { id: orphan.id },
          })
        ).retiredAt,
      ).not.toBeNull();
      expect(
        (await db.storedFile.findUniqueOrThrow({ where: { id: orphan.id } }))
          .status,
      ).toBe('DELETED');
      expect(
        (await media.detail(alice.actor, g.id, msg.id)).attachments,
      ).toHaveLength(1);
    });
    it('rejects actual size and hash mismatch', async () => {
      const g = await ready();
      for (const body of [
        { expectedSize: 3 },
        { expectedSize: 4, sha256: '0'.repeat(64) },
      ]) {
        const f = await media.initiate(
          owner.actor,
          g.id,
          {
            id: randomUUID(),
            kind: 'FILE',
            filename: 'invalid.txt',
            mimeType: 'text/plain',
            ...body,
          },
          randomUUID(),
        );
        await expect(
          media.complete(
            owner.actor,
            g.id,
            f.id,
            Readable.from([Buffer.from('test')]),
            '4',
          ),
        ).rejects.toThrow();
        expect((await media.status(owner.actor, g.id, f.id)).status).toBe(
          'REJECTED',
        );
      }
    });
    it('enforces binary uploads, safe download headers and strict HTTP acknowledgements', async () => {
      const g = await ready(),
        session = await cookie(owner),
        base = '/api/v1/conversations/' + g.id,
        fileId = randomUUID();
      await request(app.getHttpServer())
        .post(base + '/attachments')
        .set('Cookie', session)
        .set('Origin', origin)
        .set('Idempotency-Key', randomUUID())
        .send({
          id: fileId,
          kind: 'FILE',
          filename: 'safe.txt',
          mimeType: 'text/plain',
          expectedSize: 4,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(base + '/attachments/' + fileId + '/complete')
        .set('Cookie', session)
        .set('Origin', origin)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('test'))
        .expect(201);
      const msg = await media.create(
        owner.actor,
        g.id,
        {
          id: randomUUID(),
          caption: null,
          attachments: [fileId],
          mentions: [],
        },
        randomUUID(),
      );
      const response = await request(app.getHttpServer())
        .get(
          base +
            '/media-messages/' +
            msg.id +
            '/attachments/' +
            fileId +
            '/download',
        )
        .set('Cookie', session)
        .expect(200);
      expect(response.headers['content-type']).toBe('application/octet-stream');
      expect(response.headers['content-disposition']).toContain(
        "filename*=UTF-8''safe.txt",
      );
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      await request(app.getHttpServer())
        .post(base + '/acknowledgements')
        .set('Cookie', session)
        .set('Origin', origin)
        .set('Idempotency-Key', randomUUID())
        .send({ messageId: msg.id, state: 'READ', userId: alice.actor.userId })
        .expect(400);
    });
  });

  it('OD-10/OD-11: admin-only channel settings, enforced pin and history rules, private reports and authorized global search', async () => {
    const ext = app.get(MessagingExtensionsService);
    const conv = await create();
    await accept(conv.id);
    const s0 = await ext.settings(alice.actor, conv.id);
    expect(s0).toMatchObject({
      linkPreviews: null,
      newcomerHistory: null,
      membersCanPin: null,
      canManage: false,
    });
    await expect(
      ext.updateSettings(alice.actor, conv.id, s0.revision, {
        membersCanPin: false,
      }),
    ).rejects.toMatchObject({ status: 403 });
    const s1 = await ext.updateSettings(owner.actor, conv.id, s0.revision, {
      membersCanPin: false,
      newcomerHistory: 'FULL',
    });
    expect(s1).toMatchObject({
      membersCanPin: false,
      newcomerHistory: 'FULL',
      canManage: true,
    });
    await expect(
      ext.updateSettings(owner.actor, conv.id, s0.revision, {
        linkPreviews: false,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const token = 'zebra' + randomUUID().slice(0, 8);
    const msg = await send(
      conv.id,
      owner,
      'Plan ' + token + ' https://example.test/doc',
    );
    await expect(
      advanced.act(
        alice.actor,
        conv.id,
        { action: 'pin', messageId: msg.id, active: true },
        randomUUID(),
        1,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await advanced.act(
      owner.actor,
      conv.id,
      { action: 'pin', messageId: msg.id, active: true },
      randomUUID(),
      1,
    );
    await messages.invite(
      owner.actor,
      conv.id,
      (await messages.get(owner.actor, conv.id)).revision,
      { id: randomUUID(), userId: bob.actor.userId },
      randomUUID(),
    );
    await accept(conv.id, bob);
    expect(
      (await messages.messages(bob.actor, conv.id, { limit: 10 })).items.map(
        (m) => m.id,
      ),
    ).toContain(msg.id);
    const mine = await ext.updatePreferences(
      alice.actor,
      conv.id,
      s1.me.revision,
      {
        collapseBlocked: true,
        linkPreviews: false,
      },
    );
    expect(mine.me).toMatchObject({
      collapseBlocked: true,
      linkPreviews: false,
    });
    expect((await ext.settings(bob.actor, conv.id)).me).toMatchObject({
      collapseBlocked: false,
      linkPreviews: null,
    });
    const reportId = randomUUID();
    const filed = await ext.report(alice.actor, conv.id, {
      id: reportId,
      reason: 'Unwanted content',
    });
    expect(filed).toMatchObject({ state: 'OPEN', reason: 'Unwanted content' });
    expect(
      await ext.report(alice.actor, conv.id, {
        id: reportId,
        reason: 'Unwanted content',
      }),
    ).toEqual(filed);
    await expect(ext.reports(alice.actor, conv.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      ext.report(outsider.actor, conv.id, { id: randomUUID(), reason: null }),
    ).rejects.toThrow();
    expect(
      (await ext.reports(owner.actor, conv.id)).items.map((r) => r.id),
    ).toEqual([reportId]);
    const resolved = await ext.resolveReport(
      owner.actor,
      conv.id,
      reportId,
      filed.revision,
      { resolution: 'Handled' },
    );
    expect(resolved).toMatchObject({
      state: 'RESOLVED',
      resolution: 'Handled',
    });
    const other = await create('PRIVATE_GROUP', [bob]);
    await accept(other.id, bob);
    await send(other.id, owner, 'Other ' + token);
    const hits = await ext.search(alice.actor, { q: token, limit: 25 });
    expect(hits.items.map((h) => [h.conversationId, h.message.id])).toEqual([
      [conv.id, msg.id],
    ]);
    expect(
      (await ext.search(owner.actor, { q: token, limit: 25 })).items,
    ).toHaveLength(2);
    expect(
      (
        await ext.search(owner.actor, { q: token, limit: 25, has: 'link' })
      ).items.map((h) => h.message.id),
    ).toEqual([msg.id]);
    expect(
      (await ext.search(outsider.actor, { q: token, limit: 25 })).items,
    ).toEqual([]);
    const paged = await ext.search(owner.actor, { q: token, limit: 1 });
    expect(paged.nextCursor).not.toBeNull();
    const next = await ext.search(owner.actor, {
      q: token,
      limit: 1,
      cursor: paged.nextCursor!,
    });
    expect(next.items[0]?.message.id).not.toBe(paged.items[0]?.message.id);
  });
});
