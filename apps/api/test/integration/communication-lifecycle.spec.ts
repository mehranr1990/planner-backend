import { SharedRetentionSchema } from '../../src/modules/spaces/application/shared-retention.js';
import { MessagingData } from '../../src/modules/messaging/public/index.js';
import { SpacesService } from '../../src/modules/spaces/public/index.js';
import { ExportBudget } from '../../src/platform/lifecycle/personal-data.js';
import { ConversationLifecycle } from '../../src/modules/messaging/public/index.js';
import {
  MeetingLifecycle,
  MeetingsService,
  MeetingDocuments,
  AnnouncementsService,
} from '../../src/modules/meetings/public/index.js';
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
import { PersonalLifecycle } from '../../src/modules/account/public/index.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  PrismaClient,
  type Prisma,
} from '../../src/generated/prisma/client.js';
import type { DatabaseService } from '../../src/platform/database/database.service.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import {
  SharedKernel,
  CollaborationService,
  CompanyAccess,
} from '../../src/modules/spaces/public/index.js';
import { MessagingService } from '../../src/modules/messaging/public/index.js';
import { AdvancedMessagingService } from '../../src/modules/messaging/application/advanced-messaging.service.js';
import {
  ProjectsService,
  ProjectCleanupService,
} from '../../src/modules/projects/public/index.js';
import {
  TeamsService,
  TeamCleanupService,
} from '../../src/modules/teams/public/index.js';
import {
  CompaniesService,
  CompanyCleanupService,
} from '../../src/modules/companies/public/index.js';
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
describe('P5-06 privacy lifecycle and REST recovery', () => {
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
    kind: 'PROJECT' | 'TEAM' | 'COMPANY' = 'PROJECT',
  ) {
    if (kind === 'COMPANY') {
      const offer = await companies.invite(
        owner.actor,
        id,
        id,
        {
          memberRole: role === 'ADMIN' ? 'ORG_ADMIN' : role,
          recipient: { userId: who.actor.userId },
        },
        randomUUID(),
      );
      const result = await app
        .get(CompanyAccess)
        .decide(who.actor, offer.invitation.id, offer.proof!, 1, true);
      if (!result.membership) throw Error('Missing Company membership');
      return result.membership;
    }
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
  });
  beforeAll(async () => {
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P506-ONLY',
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
          applicableContexts: [
            'PROJECT',
            'TEAM',
            'COMPANY',
            'CONVERSATION',
            'MEETING',
          ],
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

  const act = (
    id: string,
    body: z.infer<typeof c.AdvancedMessageActionSchema>,
    who = owner,
    revision?: number,
    key = randomUUID(),
  ) => advanced.act(who.actor, id, body, key, revision);
  async function group() {
    const g = await create('PRIVATE_GROUP', [alice, bob]);
    await accept(g.id, alice);
    await accept(g.id, bob);
    return g;
  }
  async function close(id: string) {
    for (const who of [alice, bob, owner]) {
      const m = await member(id, who).catch(() => null);
      if (m?.state === 'ACTIVE')
        await messages.leave(who.actor, id, m.revision);
    }
  }
  async function due(id: string) {
    const departure = new Date(Date.now() - 31 * 86400000);
    await db.sharedLifecycleJob.updateMany({
      where: { custodyId: id },
      data: {
        effectiveDepartureAt: departure,
        recoveryDeadline: new Date(departure.getTime() + 30 * 86400000),
        nextAt: new Date(Date.now() - 1000),
      },
    });
  }
  async function drain(
    worker: ConversationLifecycle | MeetingLifecycle,
    id: string,
  ) {
    for (let n = 0; n < 140; n++) {
      if (!(await db.sharedCustody.findUnique({ where: { spaceId: id } })))
        return;
      await worker.consume();
    }
    throw Error('Bounded fixture cleanup did not finish');
  }

  it('keeps a finite initial message ceiling and the first mutation cursor over interleaved pages', async () => {
    const g = await group(),
      first = await send(g.id),
      second = await send(g.id, owner, 'Second');
    const a = await media.recovery(alice.actor, g.id, { limit: 1 });
    expect(a.throughSequence).toBe('2');
    expect(a.hasMore).toBe(true);
    await act(
      g.id,
      { action: 'edit', messageId: first.id, text: 'Interleaved edit' },
      owner,
      1,
    );
    const third = await send(g.id, owner, 'After snapshot');
    const b = await media.recovery(alice.actor, g.id, {
      limit: 1,
      cursor: a.nextCursor!,
    });
    expect(b.items.map((m) => m.id)).toEqual([second.id]);
    expect(b.hasMore).toBe(false);
    expect(b.nextCursor).toBeNull();
    expect(b.changeCursor).toBe(a.changeCursor);
    const changes = await media.changes(alice.actor, g.id, {
      ...page,
      cursor: a.changeCursor,
    });
    expect(changes.items.map((v) => v.message.id)).toEqual([
      first.id,
      third.id,
    ]);
    expect(changes.items[0]!.message.text).toBe('Interleaved edit');
    expect(await progress.get(alice.actor, g.id)).toMatchObject({
      readThrough: '0',
      deliveredThrough: '0',
      shareReceipts: false,
    });
  });
  it('recovers explicit hidden/deleted tombstones without disclosing hidden text to another device', async () => {
    const g = await group(),
      one = await send(g.id),
      two = await send(g.id);
    const start = await media.recovery(alice.actor, g.id, { limit: 1 });
    await act(g.id, { action: 'hide', messageId: one.id }, alice);
    await act(g.id, { action: 'delete', messageId: two.id }, owner, 1);
    const second = { ...alice.actor, sessionId: randomUUID() };
    await db.authSession.create({
      data: {
        id: second.sessionId,
        userId: second.userId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const changes = await media.changes(second, g.id, {
      ...page,
      cursor: start.changeCursor,
    });
    expect(changes.items.map((v) => v.message.state)).toEqual([
      'HIDDEN',
      'DELETED',
    ]);
    expect(JSON.stringify(changes)).not.toContain('Private text');
    const fresh = await media.recovery(second, g.id, page);
    expect(fresh.items.map((m) => m.state)).toEqual(['DELETED']);
  });
  it('rejects foreign/tampered/revoked cursors and requires a fresh current-join snapshot', async () => {
    const g = await group();
    await send(g.id);
    await send(g.id);
    const a = await media.recovery(alice.actor, g.id, { limit: 1 });
    await expect(
      media.recovery(bob.actor, g.id, { limit: 1, cursor: a.nextCursor! }),
    ).rejects.toThrow();
    await expect(
      media.recovery(alice.actor, g.id, {
        limit: 1,
        cursor: a.nextCursor! + 'x',
      }),
    ).rejects.toThrow();
    await messages.leave(alice.actor, g.id, (await member(g.id)).revision);
    await expect(
      media.recovery(alice.actor, g.id, { limit: 1, cursor: a.nextCursor! }),
    ).rejects.toThrow();
    const invitation = await messages.invite(
      owner.actor,
      g.id,
      (await messages.get(owner.actor, g.id)).revision,
      { id: randomUUID(), userId: alice.actor.userId },
      randomUUID(),
    );
    await messages.decide(
      alice.actor,
      invitation.id,
      invitation.revision,
      true,
    );
    await expect(
      media.recovery(alice.actor, g.id, { limit: 1, cursor: a.nextCursor! }),
    ).rejects.toThrow();
    expect((await media.recovery(alice.actor, g.id, page)).items).toEqual([]);
    await send(g.id, owner, 'New join');
    expect(
      (await media.recovery(alice.actor, g.id, page)).items.map((m) => m.text),
    ).toEqual(['New join']);
  });
  it('keeps independent device progress monotonic with concurrent idempotent sends and acknowledgements', async () => {
    const g = await group(),
      key = randomUUID(),
      id = randomUUID();
    const sent = await Promise.all([
      send(g.id, owner, 'Same', key, id),
      send(g.id, owner, 'Same', key, id),
    ]);
    expect(sent[0]!.id).toBe(sent[1]!.id);
    const last = await send(g.id, owner, 'Last');
    const k = randomUUID();
    await Promise.all([
      progress.acknowledge(
        alice.actor,
        g.id,
        { messageId: last.id, state: 'READ' },
        k,
      ),
      progress.acknowledge(
        alice.actor,
        g.id,
        { messageId: last.id, state: 'READ' },
        k,
      ),
    ]);
    await progress.acknowledge(
      alice.actor,
      g.id,
      { messageId: id, state: 'DELIVERED' },
      randomUUID(),
    );
    expect(await progress.get(alice.actor, g.id)).toMatchObject({
      readThrough: '2',
      deliveredThrough: '2',
    });
    expect(
      (await media.recovery(bob.actor, g.id, page)).items.map(
        (m) => m.sequence,
      ),
    ).toEqual(['1', '2']);
  });
  it('bounds empty recovery polling and returns Retry-After at the existing HTTP actor limit', async () => {
    const g = await group(),
      find = vi.spyOn(db.messageEntry, 'findMany'),
      view = vi.spyOn(media, 'view');
    for (let i = 0; i < 20; i++)
      expect(
        (await media.recovery(alice.actor, g.id, { limit: 100 })).items,
      ).toEqual([]);
    expect(find).toHaveBeenCalledTimes(20);
    expect(view).not.toHaveBeenCalled();
    for (const [args] of find.mock.calls)
      expect(args?.take).toBeLessThanOrEqual(101);
    const token = await cookie(alice);
    await db.sharedRateLimit.deleteMany();
    for (let i = 0; i < 20; i++)
      await request(app.getHttpServer())
        .get('/api/v1/conversations/' + g.id + '/recovery')
        .set('Cookie', token)
        .expect(200);
    const denied = await request(app.getHttpServer())
      .get('/api/v1/conversations/' + g.id + '/recovery')
      .set('Cookie', token)
      .expect(429);
    expect(denied.headers['retry-after']).toBe('60');
  });
  it('lets a named pending DM invitee block privately without granting message access', async () => {
    const dm = await create('DM'),
      invite = (await messages.invitations(alice.actor, page)).items.find(
        (v) => v.conversationId === dm.id,
      )!;
    const b = await messages.contacts.set(
      alice.actor,
      dm.id,
      true,
      randomUUID(),
      1,
    );
    expect(b.active).toBe(true);
    await expect(messages.get(alice.actor, dm.id)).rejects.toThrow();
    await expect(
      messages.decide(alice.actor, invite.id, invite.revision, true),
    ).rejects.toThrow();
    await expect(
      messages.contacts.get(outsider.actor, dm.id),
    ).rejects.toThrow();
    expect((await messages.contacts.get(owner.actor, dm.id)).active).toBe(
      false,
    );
    expect((await messages.contacts.list(owner.actor, page)).items).toEqual([]);
    await messages.contacts.set(
      alice.actor,
      dm.id,
      false,
      randomUUID(),
      b.revision,
    );
    await expect(
      messages.decide(alice.actor, invite.id, invite.revision, true),
    ).rejects.toThrow();
    await messages.decide(alice.actor, invite.id, invite.revision, false);
  });
  it('blocks contact in both directions and recreated DMs while retaining authorized safety/history actions', async () => {
    const dm = await create('DM');
    await accept(dm.id);
    const m = await send(dm.id);
    const b = await messages.contacts.set(
      alice.actor,
      dm.id,
      true,
      randomUUID(),
      1,
    );
    for (const who of [owner, alice]) {
      await expect(send(dm.id, who)).rejects.toThrow();
      await expect(
        act(
          dm.id,
          { action: 'reaction', messageId: m.id, emoji: '👍', active: true },
          who,
        ),
      ).rejects.toThrow();
    }
    await expect(
      act(dm.id, { action: 'edit', messageId: m.id, text: 'Denied' }, owner, 1),
    ).rejects.toThrow();
    await expect(
      act(dm.id, { action: 'pin', messageId: m.id, active: true }, owner, 1),
    ).rejects.toThrow();
    await expect(create('DM')).rejects.toThrow();
    expect(
      (await media.recovery(owner.actor, dm.id, page)).items[0]!.text,
    ).toBe('Private text');
    expect((await messages.get(alice.actor, dm.id)).writable).toBe(false);
    await act(
      dm.id,
      {
        action: 'report',
        id: randomUUID(),
        messageId: m.id,
        reason: 'Private safety report',
      },
      alice,
    );
    await act(dm.id, { action: 'hide', messageId: m.id }, alice);
    await act(dm.id, { action: 'delete', messageId: m.id }, owner, 1);
    await messages.contacts.set(
      alice.actor,
      dm.id,
      false,
      randomUUID(),
      b.revision,
    );
    await send(dm.id, owner, 'Future explicit contact');
  });
  it('preserves common-group content while suppressing only blocked structured mentions', async () => {
    const dm = await create('DM');
    await accept(dm.id);
    await messages.contacts.set(alice.actor, dm.id, true, randomUUID(), 1);
    const g = await group(),
      a = await member(g.id, alice),
      b = await member(g.id, bob),
      id = randomUUID();
    await act(g.id, {
      action: 'compose',
      id,
      text: 'Shared group content',
      mentions: [a.id, b.id],
    });
    const value = await media.detail(alice.actor, g.id, id);
    expect(value.text).toBe('Shared group content');
    expect(value.mentions).toEqual([b.id]);
    expect((await media.recovery(bob.actor, g.id, page)).items[0]!.text).toBe(
      'Shared group content',
    );
  });
  it('does not revive old shared read signals after unblock without fresh consent from both parties', async () => {
    const dm = await create('DM');
    await accept(dm.id);
    const m = await send(dm.id);
    await progress.acknowledge(
      alice.actor,
      dm.id,
      { messageId: m.id, state: 'READ' },
      randomUUID(),
    );
    await progress.sharing(owner.actor, dm.id, true, randomUUID(), 1);
    await progress.sharing(alice.actor, dm.id, true, randomUUID(), 2);
    expect((await progress.summary(owner.actor, dm.id, m.id)).readCount).toBe(
      1,
    );
    const b = await messages.contacts.set(
      alice.actor,
      dm.id,
      true,
      randomUUID(),
      1,
    );
    expect((await progress.summary(owner.actor, dm.id, m.id)).readCount).toBe(
      0,
    );
    await messages.contacts.set(
      alice.actor,
      dm.id,
      false,
      randomUUID(),
      b.revision,
    );
    expect((await progress.summary(owner.actor, dm.id, m.id)).readCount).toBe(
      0,
    );
    await progress.sharing(owner.actor, dm.id, true, randomUUID(), 2);
    expect((await progress.summary(owner.actor, dm.id, m.id)).readCount).toBe(
      0,
    );
    await progress.sharing(alice.actor, dm.id, true, randomUUID(), 3);
    expect((await progress.summary(owner.actor, dm.id, m.id)).readCount).toBe(
      1,
    );
  });
  it('deduplicates private block commands, checks revisions and cancels stale cursors', async () => {
    const dm = await create('DM'),
      key = randomUUID();
    const a = await messages.contacts.set(alice.actor, dm.id, true, key, 1);
    expect(
      await messages.contacts.set(alice.actor, dm.id, true, key, 1),
    ).toEqual(a);
    await expect(
      messages.contacts.set(alice.actor, dm.id, false, key, a.revision),
    ).rejects.toThrow();
    await expect(
      messages.contacts.set(alice.actor, dm.id, false, randomUUID(), 1),
    ).rejects.toThrow();
    const dm2 = await messages.create(
      bob.actor,
      {
        id: randomUUID(),
        kind: 'DM',
        participants: [alice.actor.userId],
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    await messages.contacts.set(alice.actor, dm2.id, true, randomUUID(), 1);
    const first = await messages.contacts.list(alice.actor, { limit: 1 });
    expect(first.hasMore).toBe(true);
    await messages.contacts.set(
      alice.actor,
      dm.id,
      false,
      randomUUID(),
      a.revision,
    );
    await expect(
      messages.contacts.list(alice.actor, {
        limit: 1,
        cursor: first.nextCursor!,
      }),
    ).rejects.toThrow();
  });
  it('fails closed on an older private block snapshot and replays signed restrictive evidence', async () => {
    const dm = await create('DM');
    await accept(dm.id);
    await messages.contacts.set(alice.actor, dm.id, true, randomUUID(), 1);
    const state = await db.dmContactState.findUniqueOrThrow({
      where: { ownerUserId: alice.actor.userId },
    });
    await db.dmContactBlock.deleteMany({ where: { spaceId: state.spaceId } });
    await db.dmContactMutation.deleteMany({
      where: { spaceId: state.spaceId },
    });
    await db.dmContactState.update({
      where: { spaceId: state.spaceId },
      data: { version: 0n },
    });
    await expect(send(dm.id)).rejects.toThrow();
    expect(await messages.contacts.replay(alice.actor)).toEqual({
      applied: 1,
      hasMore: false,
    });
    expect((await messages.contacts.get(alice.actor, dm.id)).active).toBe(true);
    await expect(send(dm.id)).rejects.toThrow();
  });
  it('suppresses queued pair notifications through block and unblock while preserving other recipients', async () => {
    const dm = await create('DM');
    await accept(dm.id);
    const g = await group(),
      msg = await send(g.id),
      activity = await db.messageActivity.findFirstOrThrow({
        where: { messageId: msg.id },
      });
    const b = await messages.contacts.set(
      alice.actor,
      dm.id,
      true,
      randomUUID(),
      1,
    );
    const a = await member(g.id, alice),
      bobMember = await member(g.id, bob);
    expect(
      await notices.operation(activity, owner.actor.userId, (s) =>
        notices.context(s, activity, a.actorId, a.id, a.generation),
      ),
    ).toBeNull();
    expect(
      await notices.operation(activity, owner.actor.userId, (s) =>
        notices.context(
          s,
          activity,
          bobMember.actorId,
          bobMember.id,
          bobMember.generation,
        ),
      ),
    ).not.toBeNull();
    await messages.contacts.set(
      alice.actor,
      dm.id,
      false,
      randomUUID(),
      b.revision,
    );
    expect(
      await notices.operation(activity, owner.actor.userId, (s) =>
        notices.context(s, activity, a.actorId, a.id, a.generation),
      ),
    ).toBeNull();
  });
  it('closes only after the last independent domain departure and recovers with a fresh history floor', async () => {
    const g = await group(),
      m = await send(g.id),
      cursor = (await media.recovery(owner.actor, g.id, page)).changeCursor;
    await messages.leave(
      owner.actor,
      g.id,
      (await member(g.id, owner)).revision,
    );
    expect((await media.recovery(alice.actor, g.id, page)).items[0]!.id).toBe(
      m.id,
    );
    expect(
      await db.sharedLifecycleJob.count({
        where: { custodyId: g.id, state: 'OWNER_EXIT_FROZEN' },
      }),
    ).toBe(1);
    await messages.leave(
      alice.actor,
      g.id,
      (await member(g.id, alice)).revision,
    );
    await messages.leave(bob.actor, g.id, (await member(g.id, bob)).revision);
    const lifecycle = app.get(ConversationLifecycle),
      j = await lifecycle.status(owner.actor, g.id);
    expect(j.state).toBe('CLOSING_GRACE');
    expect(
      await db.contextAccess.count({
        where: { spaceId: g.id, state: 'ACTIVE' },
      }),
    ).toBe(0);
    await expect(
      media.changes(owner.actor, g.id, { ...page, cursor }),
    ).rejects.toThrow();
    await expect(
      lifecycle.issueProof(alice.actor, g.id, j.revision, password),
    ).rejects.toThrow();
    const p = await lifecycle.issueProof(
      owner.actor,
      g.id,
      j.revision,
      password,
    );
    await lifecycle.recover(
      owner.actor,
      g.id,
      p.revision,
      p.generation,
      p.proof,
      password,
    );
    expect((await media.recovery(owner.actor, g.id, page)).items).toEqual([]);
    await expect(
      media.changes(owner.actor, g.id, { ...page, cursor }),
    ).rejects.toThrow();
    await expect(
      lifecycle.recover(
        owner.actor,
        g.id,
        p.revision,
        p.generation,
        p.proof,
        password,
      ),
    ).rejects.toThrow();
  });
  it('purges eligible independent messaging in bounded restartable stages and preserves private pair blocking', async () => {
    const dm = await create('DM');
    await accept(dm.id);
    const msg = await send(dm.id);
    await act(
      dm.id,
      { action: 'edit', messageId: msg.id, text: 'Version' },
      owner,
      1,
    );
    await messages.contacts.set(alice.actor, dm.id, true, randomUUID(), 1);
    await close(dm.id);
    await due(dm.id);
    const worker = app.get(ConversationLifecycle);
    await worker.consume();
    expect(
      await db.sharedCustody.findUnique({ where: { spaceId: dm.id } }),
    ).not.toBeNull();
    await drain(worker, dm.id);
    expect(
      await db.conversation.findUnique({ where: { id: dm.id } }),
    ).toBeNull();
    expect(
      await db.messageRevision.count({ where: { messageId: msg.id } }),
    ).toBe(0);
    expect(
      (await messages.contacts.list(alice.actor, page)).items[0],
    ).toMatchObject({ active: true, conversationId: null });
    await expect(create('DM')).rejects.toThrow();
  });
  it('does not dispose work-channel content when its last conversation participant leaves an active parent', async () => {
    const source = await work();
    await join(source.id);
    const g = await channel(source.id);
    await accept(g.id);
    const msg = await send(g.id);
    await close(g.id);
    expect(
      await db.sharedLifecycleJob.count({ where: { custodyId: g.id } }),
    ).toBe(0);
    expect(await db.messageEntry.count({ where: { id: msg.id } })).toBe(1);
    expect(
      (
        await db.sharedCustody.findUniqueOrThrow({
          where: { spaceId: source.id },
        })
      ).state,
    ).toBe('ACTIVE');
  });
  it('guards immutable history against ordinary SQL deletion even with a caller-set purge flag', async () => {
    const g = await group(),
      m = await send(g.id);
    await act(
      g.id,
      { action: 'edit', messageId: m.id, text: 'Recorded' },
      owner,
      1,
    );
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.shared_purge','true',true)`;
        await tx.messageRevision.deleteMany({ where: { messageId: m.id } });
      }),
    ).rejects.toThrow();
    expect(
      await db.messageRevision.count({ where: { messageId: m.id } }),
    ).toBeGreaterThan(0);
  });
  it('rejects unsafe communication bytes before READY without leaving a downloadable artifact', async () => {
    const g = await group(),
      data = Buffer.from('text before <script>active</script>'),
      f = await media.initiate(
        owner.actor,
        g.id,
        {
          id: randomUUID(),
          kind: 'FILE',
          filename: 'text.txt',
          mimeType: 'text/plain',
          expectedSize: data.length,
        },
        randomUUID(),
      );
    await expect(
      media.complete(
        owner.actor,
        g.id,
        f.id,
        Readable.from([data]),
        String(data.length),
      ),
    ).rejects.toThrow();
    expect((await media.status(owner.actor, g.id, f.id)).status).toBe(
      'REJECTED',
    );
  });
  async function meeting(participants: Person[] = []) {
    return app.get(MeetingsService).create(
      owner.actor,
      c.MeetingCreateSchema.parse({
        id: randomUUID(),
        kind: 'INDEPENDENT',
        retentionPolicyVersion: version,
        participants: participants.map((p) => p.actor.userId),
        event: {
          title: 'Lifecycle meeting',
          schedule: {
            kind: 'ALL_DAY',
            timezone: 'UTC',
            startDate: '2026-12-01',
            endDate: '2026-12-02',
          },
        },
      }),
      randomUUID(),
    );
  }
  async function meetingMember(id: string, who = owner) {
    return db.meetingMember.findFirstOrThrow({
      where: { meetingId: id, actor: { userId: who.actor.userId } },
    });
  }
  it('closes an independent meeting on its final participant departure and requires fresh proof to recover', async () => {
    const m = await meeting(),
      me = await meetingMember(m.id),
      api = app.get(MeetingsService),
      lifecycle = app.get(MeetingLifecycle);
    await api.leave(owner.actor, m.id, me.revision, randomUUID());
    await expect(api.get(owner.actor, m.id)).rejects.toThrow();
    const j = await lifecycle.status(owner.actor, m.id);
    expect(j.state).toBe('CLOSING_GRACE');
    await expect(
      lifecycle.issueProof(owner.actor, m.id, j.revision, 'incorrect'),
    ).rejects.toThrow();
    const p = await lifecycle.issueProof(
      owner.actor,
      m.id,
      j.revision,
      password,
    );
    await lifecycle.recover(
      owner.actor,
      m.id,
      p.revision,
      p.generation,
      p.proof,
      password,
    );
    expect((await meetingMember(m.id)).generation).toBe(me.generation + 1);
    expect((await api.get(owner.actor, m.id)).role).toBe('ORGANIZER');
  });
  it('preserves accepted meeting reads when the organizer leaves and does not promote another participant', async () => {
    const m = await meeting([alice]),
      api = app.get(MeetingsService),
      offer = (await api.invitations(alice.actor, page)).items.find(
        (v) => v.meetingId === m.id,
      )!;
    await api.rsvp(
      alice.actor,
      offer.id,
      offer.revision,
      'ACCEPTED',
      randomUUID(),
    );
    await api.leave(
      owner.actor,
      m.id,
      (await meetingMember(m.id)).revision,
      randomUUID(),
    );
    expect((await api.get(alice.actor, m.id)).role).toBe('PARTICIPANT');
    await api.propose(
      alice.actor,
      m.id,
      { id: randomUUID(), text: 'Accepted participant proposal' },
      randomUUID(),
    );
    await expect(
      api.patch(alice.actor, m.id, 1, { state: 'CANCELED' }, randomUUID()),
    ).rejects.toThrow();
    await api.leave(
      alice.actor,
      m.id,
      (await meetingMember(m.id, alice)).revision,
      randomUUID(),
    );
    expect(
      (await app.get(MeetingLifecycle).status(owner.actor, m.id)).state,
    ).toBe('CLOSING_GRACE');
  });
  it('purges a finalized independent meeting and its authoritative event without weakening ordinary immutability', async () => {
    const m = await meeting(),
      documents = app.get(MeetingDocuments),
      v = await documents.create(
        owner.actor,
        m.id,
        {
          id: randomUUID(),
          minutes: 'Retained until eligible',
          decisions: [{ id: randomUUID(), text: 'Decision' }],
          actions: [
            {
              id: randomUUID(),
              title: 'Separate personal action',
              description: 'Explicit conversion',
            },
          ],
          attachments: [],
          contributors: [],
        },
        randomUUID(),
      );
    await documents.finalize(owner.actor, m.id, v.id, v.revision, randomUUID());
    const link = await documents.convert(
      owner.actor,
      m.id,
      v.actions[0]!.id,
      {},
      randomUUID(),
    );
    expect(link.personal).toBe(true);
    await expect(
      db.meetingVersion.delete({ where: { id: v.id } }),
    ).rejects.toThrow();
    await app
      .get(MeetingsService)
      .leave(
        owner.actor,
        m.id,
        (await meetingMember(m.id)).revision,
        randomUUID(),
      );
    await due(m.id);
    await drain(app.get(MeetingLifecycle), m.id);
    expect(await db.meetingVersion.count({ where: { meetingId: m.id } })).toBe(
      0,
    );
    expect(
      await db.calendarEvent.findUnique({ where: { id: m.event.id } }),
    ).toBeNull();
    expect(
      await db.task.findUnique({ where: { id: link.task!.id } }),
    ).not.toBeNull();
  });
  it.each(['PROJECT', 'TEAM', 'COMPANY'] as const)(
    'purges finalized meetings, published announcements and calendar events through the %s owner',
    async (kind) => {
      const source = await work(kind);
      await join(source.id, alice, 'MEMBER', kind);
      const conversation = await channel(source.id, kind);
      await accept(conversation.id);
      await send(conversation.id);
      const api = app.get(MeetingsService),
        documents = app.get(MeetingDocuments),
        announcements = app.get(AnnouncementsService);
      const m = await api.create(
        owner.actor,
        c.MeetingCreateSchema.parse({
          id: randomUUID(),
          kind,
          sourceId: source.id,
          participants: [alice.actor.userId],
          event: {
            title: 'Source meeting',
            schedule: {
              kind: 'ALL_DAY',
              timezone: 'UTC',
              startDate: '2026-12-01',
              endDate: '2026-12-02',
            },
          },
        }),
        randomUUID(),
      );
      const invitation = (await api.invitations(alice.actor, page)).items.find(
        (x) => x.meetingId === m.id,
      )!;
      await api.rsvp(
        alice.actor,
        invitation.id,
        invitation.revision,
        'ACCEPTED',
        randomUUID(),
      );
      let v = await documents.create(
        owner.actor,
        m.id,
        {
          id: randomUUID(),
          minutes: 'Final source minutes',
          reviewerMemberId: (await meetingMember(m.id, alice)).id,
          decisions: [{ id: randomUUID(), text: 'Source decision' }],
          actions: [],
          attachments: [],
          contributors: [],
        },
        randomUUID(),
      );
      v = await documents.submit(
        owner.actor,
        m.id,
        v.id,
        v.revision,
        randomUUID(),
      );
      v = await documents.review(
        alice.actor,
        m.id,
        v.id,
        { decision: 'APPROVE', reason: 'Exact snapshot reviewed' },
        v.revision,
        randomUUID(),
      );
      await documents.finalize(
        owner.actor,
        m.id,
        v.id,
        v.revision,
        randomUUID(),
      );
      const a = await announcements.create(
        owner.actor,
        { id: randomUUID(), kind, sourceId: source.id },
        randomUUID(),
      );
      const av = await announcements.createVersion(
        owner.actor,
        a.id,
        {
          id: randomUUID(),
          title: 'Source notice',
          text: 'Published source content',
          acknowledgement: true,
          attachments: [],
        },
        randomUUID(),
      );
      await announcements.publish(
        owner.actor,
        a.id,
        av.id,
        { audience: 'ALL' },
        av.revision,
        randomUUID(),
      );
      for (const who of [alice, owner]) {
        const seat = await db.contextAccess.findFirstOrThrow({
          where: {
            scopeId: source.id,
            SharedActor: { userId: who.actor.userId },
          },
        });
        await kernel.depart(who.actor, {
          spaceId: source.id,
          scopeId: source.id,
          revision: seat.revision,
        });
      }
      await due(source.id);
      const cleanup =
        kind === 'PROJECT'
          ? app.get(ProjectCleanupService)
          : kind === 'TEAM'
            ? app.get(TeamCleanupService)
            : app.get(CompanyCleanupService);
      for (let n = 0; n < 200; n++) {
        if (
          !(await db.sharedCustody.findUnique({
            where: { spaceId: source.id },
          }))
        )
          break;
        await cleanup.consume();
      }
      const remaining = await db.sharedCustody.findUnique({
        where: { spaceId: source.id },
      });
      expect(
        remaining,
        JSON.stringify(
          await db.sharedLifecycleJob.findMany({
            where: { custodyId: source.id },
          }),
        ),
      ).toBeNull();
      expect(
        await db.meetingVersion.count({ where: { meetingId: m.id } }),
      ).toBe(0);
      expect(await db.meeting.findUnique({ where: { id: m.id } })).toBeNull();
      expect(
        await db.announcement.findUnique({ where: { id: a.id } }),
      ).toBeNull();
      expect(
        await db.calendarEvent.findUnique({ where: { id: m.event.id } }),
      ).toBeNull();
      expect(
        await db.conversation.findUnique({ where: { id: conversation.id } }),
      ).toBeNull();
    },
  );
  it('retains and pseudonymizes protected records under PSEUDONYMIZE, with a recorded next review', async () => {
    const policy = await db.sharedRetentionPolicy.findUniqueOrThrow({
        where: { version },
      }),
      config = SharedRetentionSchema.parse(policy.configuration);
    const pv = 'pseudo-' + randomUUID();
    config.policyVersion = pv;
    config.approvalReference = 'SYNTHETIC-P506-ONLY';
    for (const rule of Object.values(config.classRules))
      rule.disposalAction = 'PSEUDONYMIZE';
    await db.sharedRetentionPolicy.create({
      data: {
        version: pv,
        approvalReference: 'SYNTHETIC-P506-ONLY',
        configuration: config,
      },
    });
    const g = await messages.create(
        owner.actor,
        {
          id: randomUUID(),
          kind: 'PRIVATE_GROUP',
          title: 'Protected',
          participants: [],
          retentionPolicyVersion: pv,
        },
        randomUUID(),
      ),
      msg = await send(g.id);
    await close(g.id);
    await due(g.id);
    const worker = app.get(ConversationLifecycle);
    await worker.consume();
    await worker.consume();
    const j = await db.sharedLifecycleJob.findFirstOrThrow({
      where: { custodyId: g.id, state: 'BLOCKED_POLICY' },
    });
    expect(j.progress).toMatchObject({
      failureCode: 'PSEUDONYMIZED_RECORD_RETAINED',
      accountableDisposition: 'RETAIN_PROTECTED_RECORD_OPERATOR_REVIEW',
    });
    expect(j.nextAt > new Date()).toBe(true);
    expect(await db.conversationMessage.count({ where: { id: msg.id } })).toBe(
      1,
    );
    expect(
      await db.sharedActor.count({
        where: { spaceId: g.id, userId: { not: null } },
      }),
    ).toBe(0);
    await expect(media.recovery(owner.actor, g.id, page)).rejects.toThrow();
  });
  it('enforces captured retention holds without physically deleting content', async () => {
    const policy = await db.sharedRetentionPolicy.findUniqueOrThrow({
        where: { version },
      }),
      config = SharedRetentionSchema.parse(policy.configuration),
      pv = 'hold-' + randomUUID();
    config.policyVersion = pv;
    config.approvalReference = 'SYNTHETIC-P506-ONLY';
    config.holds = [
      {
        id: randomUUID(),
        state: 'ACTIVE',
        basis: 'Fixture hold',
        authority: 'Synthetic operator',
        scope: 'Closed fixture',
        releaseEvidence: null,
        nextReviewAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ];
    await db.sharedRetentionPolicy.create({
      data: {
        version: pv,
        approvalReference: 'SYNTHETIC-P506-ONLY',
        configuration: config as Prisma.InputJsonValue,
      },
    });
    const g = await messages.create(
        owner.actor,
        {
          id: randomUUID(),
          kind: 'PRIVATE_GROUP',
          title: 'Held',
          participants: [],
          retentionPolicyVersion: pv,
        },
        randomUUID(),
      ),
      msg = await send(g.id);
    await close(g.id);
    await due(g.id);
    await app.get(ConversationLifecycle).consume();
    await app.get(ConversationLifecycle).consume();
    expect(
      (
        await db.sharedLifecycleJob.findFirstOrThrow({
          where: { custodyId: g.id },
        })
      ).state,
    ).toBe('WAITING_OBLIGATIONS');
    expect(await db.conversationMessage.count({ where: { id: msg.id } })).toBe(
      1,
    );
  });
  it('allows only the private owner to unblock a persistent pair after the original DM is disposed', async () => {
    const dm = await create('DM');
    await accept(dm.id);
    const b = await messages.contacts.set(
      alice.actor,
      dm.id,
      true,
      randomUUID(),
      1,
    );
    await close(dm.id);
    await due(dm.id);
    await drain(app.get(ConversationLifecycle), dm.id);
    await expect(
      messages.contacts.set(
        outsider.actor,
        b.id!,
        false,
        randomUUID(),
        b.revision,
        true,
      ),
    ).rejects.toThrow();
    await messages.contacts.set(
      alice.actor,
      b.id!,
      false,
      randomUUID(),
      b.revision,
      true,
    );
    expect((await create('DM')).kind).toBe('DM');
  });
  it('serializes a contact block against an in-flight send under the shared account fences', async () => {
    const dm = await create('DM');
    await accept(dm.id);
    const entered = barrier(),
      release = barrier(),
      original = messages.contacts.allowed.bind(messages.contacts);
    vi.spyOn(messages.contacts, 'allowed').mockImplementation(
      async (...args) => {
        const result = await original(...args);
        entered.release();
        await release.promise;
        return result;
      },
    );
    const pending = send(dm.id);
    await entered.promise;
    const block = messages.contacts.set(
      alice.actor,
      dm.id,
      true,
      randomUUID(),
      1,
    );
    await blocked();
    release.release();
    await pending;
    await block;
    vi.restoreAllMocks();
    await expect(send(dm.id)).rejects.toThrow();
  });
  it('replays restrictions before serving an older snapshot and offers explicit fresh admission without old history', async () => {
    const g = await group(),
      msg = await send(g.id),
      old = await db.sharedCustody.findUniqueOrThrow({
        where: { spaceId: g.id },
      });
    await messages.leave(bob.actor, g.id, (await member(g.id, bob)).revision);
    await act(g.id, { action: 'hide', messageId: msg.id }, alice);
    await act(g.id, { action: 'delete', messageId: msg.id }, owner, 1);
    // Simulate only this newly owned fixture's older mutable snapshot. Signed
    // independent controls remain current and must deny the restored DB first.
    await db.sharedCustody.update({
      where: { spaceId: g.id },
      data: { authorizationVersion: old.authorizationVersion },
    });
    await db.messageEntry.update({
      where: { id: msg.id },
      data: { deletedAt: null, removalKind: null, revision: 1 },
    });
    await expect(media.recovery(alice.actor, g.id, page)).rejects.toThrow();
    await kernel.restoreRestrictions(g.id, async () => {});
    await expect(media.recovery(alice.actor, g.id, page)).rejects.toThrow();
    const a = await member(g.id, alice),
      key = randomUUID();
    const renewed = await messages.restoreAdmission(
      alice.actor,
      g.id,
      a.revision,
      key,
    );
    expect(renewed.generation).toBe(a.generation + 1);
    expect(
      await messages.restoreAdmission(alice.actor, g.id, a.revision, key),
    ).toEqual(renewed);
    expect((await media.recovery(alice.actor, g.id, page)).items).toEqual([]);
    await expect(
      messages.restoreAdmission(
        bob.actor,
        g.id,
        (await member(g.id, bob)).revision,
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('exports only the caller private block state and keeps shared bodies outside Personal export', async () => {
    const dm = await create('DM');
    await accept(dm.id);
    await send(dm.id, owner, 'Shared confidential body');
    const own = await messages.contacts.set(
        alice.actor,
        dm.id,
        true,
        randomUUID(),
        1,
      ),
      other = await messages.contacts.set(
        owner.actor,
        dm.id,
        true,
        randomUUID(),
        1,
      ),
      scope = await app.get(SpacesService).authorizePersonal(alice.actor),
      budget = new ExportBudget();
    await db.$transaction(async (tx) => {
      await scope.fence(tx);
      await app.get(MessagingData).snapshot(tx, scope, budget);
    });
    expect(budget.sections.privateDmBlocks).toMatchObject([
      { id: own.id, active: true },
    ]);
    const encoded = JSON.stringify(budget.sections);
    expect(encoded).not.toContain(other.id);
    expect(encoded).not.toContain('targetUserId');
    expect(encoded).not.toContain('Shared confidential body');
  });
  it('clears private contact data on actual Personal erasure independently of retained group content', async () => {
    const dm = await create('DM');
    await accept(dm.id);
    await messages.contacts.set(alice.actor, dm.id, true, randomUUID(), 1);
    const g = await group(),
      msg = await send(g.id),
      token = await cookie(alice);
    const challenge = c.DeletionChallengeSchema.parse(
      (
        await request(app.getHttpServer())
          .post('/api/v1/me/deletion-request')
          .set('Cookie', token)
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
      .set('Cookie', token)
      .set('Origin', origin)
      .set('X-Deletion-Proof', challenge.confirmationProof)
      .send({ jobId: challenge.job.id, revision: 1 })
      .expect(201);
    expect(
      await db.dmContactBlock.count({
        where: { ownerUserId: alice.actor.userId },
      }),
    ).toBe(1);
    await db.accountDeletionJob.update({
      where: { id: challenge.job.id },
      data: { eraseAfter: new Date(0), nextAt: new Date(0) },
    });
    for (
      let n = 0;
      n < 10 && (await db.user.count({ where: { id: alice.actor.userId } }));
      n++
    )
      await app.get(PersonalLifecycle).consume();
    expect(await db.user.count({ where: { id: alice.actor.userId } })).toBe(0);
    expect(
      await db.dmContactState.count({
        where: { ownerUserId: alice.actor.userId },
      }),
    ).toBe(0);
    expect(
      await db.dmContactMutation.count({
        where: { ownerUserId: alice.actor.userId },
      }),
    ).toBe(0);
    expect(await db.messageEntry.count({ where: { id: msg.id } })).toBe(1);
    expect((await media.recovery(owner.actor, g.id, page)).items[0]!.id).toBe(
      msg.id,
    );
  });
  it('exposes strict private HTTP contact controls with current-session, Origin and revision checks', async () => {
    const dm = await create('DM'),
      token = await cookie(alice),
      url = '/api/v1/messaging/blocks';
    await request(app.getHttpServer())
      .get('/api/v1/conversations/' + dm.id + '/contact-block')
      .expect(401);
    await request(app.getHttpServer())
      .post(url)
      .set('Cookie', token)
      .set('Idempotency-Key', randomUUID())
      .send({ conversationId: dm.id, active: true })
      .expect(403);
    await request(app.getHttpServer())
      .post(url)
      .set('Cookie', token)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({ conversationId: dm.id, active: true })
      .expect(400);
    const r = await request(app.getHttpServer())
      .post(url)
      .set('Cookie', token)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .set('Idempotency-Key', randomUUID())
      .send({ conversationId: dm.id, active: true })
      .expect(201);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers.etag).toBe('"2"');
    expect(Object.keys(r.body).sort()).toEqual([
      'active',
      'conversationId',
      'id',
      'revision',
    ]);
    await db.authSession.delete({ where: { id: alice.actor.sessionId! } });
    await expect(messages.contacts.list(alice.actor, page)).rejects.toThrow();
  });
  it('lets a current Viewer explicitly renew restore admission without granting participation or pre-join history', async () => {
    const p = await work();
    await join(p.id, viewer, 'VIEWER');
    const g = await channel(p.id, 'PROJECT', [viewer]);
    await accept(g.id, viewer);
    await send(g.id);
    await db.accessScope.update({
      where: { id: p.id },
      data: { restoreGeneration: { increment: 1 } },
    });
    await expect(media.recovery(viewer.actor, g.id, page)).rejects.toThrow();
    await messages.restoreAdmission(
      viewer.actor,
      g.id,
      (await member(g.id, viewer)).revision,
      randomUUID(),
    );
    expect((await media.recovery(viewer.actor, g.id, page)).items).toEqual([]);
    await expect(send(g.id, viewer)).rejects.toThrow();
    await messages.restoreAdmission(
      owner.actor,
      g.id,
      (await member(g.id, owner)).revision,
      randomUUID(),
    );
    await send(g.id, owner, 'Current public work history');
    expect(
      (await media.recovery(viewer.actor, g.id, page)).items[0]!.text,
    ).toBe('Current public work history');
  });
  it('cancels an already prepared Push before dispatch when pair blocking commits', async () => {
    await db.messageActivity.updateMany({ data: { processed: true } });
    await db.messageNotice.updateMany({
      where: { state: 'PENDING' },
      data: { state: 'CANCELED' },
    });
    await db.messageNoticeAttempt.updateMany({
      where: { state: { in: ['PENDING', 'RETRY', 'PROCESSING', 'NETWORK'] } },
      data: { state: 'CANCELED' },
    });
    const dm = await create('DM');
    await accept(dm.id);
    const personal = await db.space.findFirstOrThrow({
      where: { kind: 'PERSONAL', ownerUserId: alice.actor.userId },
    });
    await db.notificationPreference.upsert({
      where: { spaceId: personal.id },
      create: {
        spaceId: personal.id,
        ownerUserId: alice.actor.userId,
        createdByUserId: alice.actor.userId,
        webPush: true,
      },
      update: { webPush: true },
    });
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const endpoint = 'https://fcm.googleapis.com/fcm/send/' + randomUUID();
    await db.pushSubscription.create({
      data: {
        spaceId: personal.id,
        ownerUserId: alice.actor.userId,
        createdByUserId: alice.actor.userId,
        endpoint,
        endpointHost: 'fcm.googleapis.com',
        endpointHash: createHash('sha256').update(endpoint).digest('hex'),
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
    });
    await messagingPush.setConsent(
      alice.actor,
      true,
      (await messagingPush.settings(alice.actor)).revision,
      randomUUID(),
    );
    const msg = await send(dm.id);
    for (let n = 0; n < 60 && (await notices.fanout()); n++);
    for (let n = 0; n < 60 && (await notices.prepare()); n++);
    const attempt = await db.messageNoticeAttempt.findFirstOrThrow({
      where: { notice: { activity: { messageId: msg.id } } },
    });
    expect(attempt.state).toBe('PENDING');
    await messages.contacts.set(alice.actor, dm.id, true, randomUUID(), 1);
    const network = vi.spyOn(messagingPush, 'send');
    await messagingWorker.delivery();
    expect(network).not.toHaveBeenCalled();
    expect(
      (
        await db.messageNoticeAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        })
      ).state,
    ).toBe('CANCELED');
  });
  it('reconciles a pre-P5-06 ended conversation admission without a migration backfill or fresh recovery window', async () => {
    const g = await create('PRIVATE_GROUP', []),
      m = await member(g.id, owner),
      endedAt = (
        await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
      )[0]!.now;
    await db.$transaction(async (tx) => {
      await tx.conversationMember.update({
        where: { id: m.id },
        data: { state: 'LEFT', revision: { increment: 1 } },
      });
      await tx.conversationAdmission.updateMany({
        where: { memberId: m.id, generation: m.generation },
        data: { endedAt },
      });
    });
    for (
      let n = 0;
      n < 50 &&
      (await db.sharedCustody.findUniqueOrThrow({ where: { spaceId: g.id } }))
        .state === 'ACTIVE';
      n++
    )
      await app.get(ConversationLifecycle).consume();
    const j = await app.get(ConversationLifecycle).status(owner.actor, g.id);
    expect(j.state).toBe('CLOSING_GRACE');
    const record = await db.sharedLifecycleJob.findUniqueOrThrow({
      where: { id: j.jobId },
    });
    expect(record.effectiveDepartureAt).toEqual(endedAt);
    expect(record.recoveryDeadline.getTime() - endedAt.getTime()).toBe(
      30 * 86400000,
    );
  });
  it('reconciles a pre-P5-06 ended meeting admission with the same recorded departure date', async () => {
    const g = await meeting(),
      m = await meetingMember(g.id),
      endedAt = (
        await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
      )[0]!.now;
    await db.$transaction(async (tx) => {
      await tx.meetingMember.update({
        where: { id: m.id },
        data: { state: 'LEFT', rsvp: 'DECLINED', revision: { increment: 1 } },
      });
      await tx.meetingAdmission.updateMany({
        where: { memberId: m.id, generation: m.generation },
        data: { endedAt },
      });
    });
    for (
      let n = 0;
      n < 50 &&
      (await db.sharedCustody.findUniqueOrThrow({ where: { spaceId: g.id } }))
        .state === 'ACTIVE';
      n++
    )
      await app.get(MeetingLifecycle).consume();
    const j = await app.get(MeetingLifecycle).status(owner.actor, g.id);
    expect(j.state).toBe('CLOSING_GRACE');
    expect(
      (
        await db.sharedLifecycleJob.findUniqueOrThrow({
          where: { id: j.jobId },
        })
      ).effectiveDepartureAt,
    ).toEqual(endedAt);
  });
  it('preserves remaining reads through owner account closure and supersedes the frozen job on the final account exit', async () => {
    const g = await group(),
      msg = await send(g.id);
    const depart = async (who: Person) => {
      const now = (
        await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
      )[0]!.now;
      await db.$transaction(async (tx) => {
        await tx.space.updateMany({
          where: { kind: 'PERSONAL', ownerUserId: who.actor.userId },
          data: { accessClosedAt: now },
        });
        await kernel.enqueueExit(tx, who.actor.userId, now);
      });
      for (let n = 0; n < 8; n++) {
        await kernel.consumeExit();
        if (
          (
            await db.sharedExitWork.findUnique({
              where: { userId: who.actor.userId },
            })
          )?.completedAt
        )
          break;
      }
    };
    await depart(owner);
    expect((await media.recovery(alice.actor, g.id, page)).items[0]!.id).toBe(
      msg.id,
    );
    await depart(alice);
    await depart(bob);
    const custody = await db.sharedCustody.findUniqueOrThrow({
      where: { spaceId: g.id },
    });
    expect(custody.state).toBe('CLOSING_GRACE');
    expect(
      await db.sharedLifecycleJob.count({
        where: { custodyId: g.id, state: 'OWNER_EXIT_FROZEN' },
      }),
    ).toBe(0);
    expect(
      await db.sharedLifecycleJob.count({
        where: { custodyId: g.id, state: 'CLOSING_GRACE' },
      }),
    ).toBe(1);
  });
  it('measures a bounded multi-device HTTP polling burst and returns backpressure without losing durable state', async () => {
    await app.listen(0, '127.0.0.1');
    const g = await group();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        send(g.id, owner, 'Load message ' + i),
      ),
    ); // Provider-created authenticated sessions are fixture setup; HTTP login-rate behavior is covered separately.
    const sessions = await Promise.all(
      [owner, alice, bob].map(async (who) => {
        const login = await auth.auth.api.signInEmail({
          body: { email: who.email, password },
          returnHeaders: true,
        });
        return login.headers
          .getSetCookie()
          .map((v) => v.split(';')[0])
          .join('; ');
      }),
    );
    await db.sharedRateLimit.deleteMany();
    const started = performance.now();
    const results = await Promise.all(
      sessions.flatMap((token) =>
        Array.from({ length: 16 }, async () => {
          const at = performance.now(),
            response = await request(app.getHttpServer())
              .get('/api/v1/conversations/' + g.id + '/recovery?limit=7')
              .set('Cookie', token);
          return {
            status: response.status,
            latencyMs: performance.now() - at,
            response,
          };
        }),
      ),
    );
    for (const r of results) {
      expect([200, 429]).toContain(r.status);
      if (r.status === 200) {
        const body = c.MessageRecoveryPageSchema.parse(r.response.body);
        expect(body.items.length).toBeLessThanOrEqual(7);
        expect(body.throughSequence).toBe('12');
        expect(body.hasMore).toBe(true);
      } else expect(r.response.headers['retry-after']).toBe('60');
    }
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b),
      counts = {
        ok: results.filter((r) => r.status === 200).length,
        limited: results.filter((r) => r.status === 429).length,
      };
    expect(counts.ok).toBeGreaterThan(0);
    expect(counts.ok).toBeLessThanOrEqual(30);
    expect(counts.limited).toBeGreaterThan(0);
    expect(
      await db.conversationMessage.count({ where: { conversationId: g.id } }),
    ).toBe(12);
    expect((await progress.get(alice.actor, g.id)).readThrough).toBe('0');
    fs.writeFileSync(
      '.tools/p5-06-polling-load.json',
      JSON.stringify(
        {
          scope:
            'Synthetic local isolated fixture; no production SLO/capacity claim',
          requests: results.length,
          devices: 3,
          pageLimit: 7,
          ...counts,
          unexpectedErrors: 0,
          totalMs: performance.now() - started,
          p50Ms: latencies[Math.floor(latencies.length * 0.5)],
          p95Ms: latencies[Math.floor(latencies.length * 0.95)],
          maxMs: latencies.at(-1),
        },
        null,
        2,
      ) + '\n',
    );
  });
});
