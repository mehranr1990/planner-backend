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
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setImmediate as tick } from 'node:timers/promises';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { ConflictException } from '@nestjs/common';
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
    key = randomUUID(),
    messageId = randomUUID(),
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
          options: '-c search_path=' + schema,
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
  it('blocks source disposal before any destructive pass until messaging retention is implemented', async () => {
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
    expect(job.state).toBe('BLOCKED_POLICY');
    expect(job.progress).toMatchObject({
      failureCode: 'MESSAGING_RETENTION_PENDING',
    });
    expect(
      await db.conversationMessage.count({
        where: { conversationId: conv.id },
      }),
    ).toBe(1);
    expect(
      await db.project.findUnique({ where: { id: source.id } }),
    ).not.toBeNull();
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
});
