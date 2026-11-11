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
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { DatabaseService } from '../../src/platform/database/database.service.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import { ExportBudget } from '../../src/platform/lifecycle/personal-data.js';
import {
  SharedKernel,
  CollaborationService,
  SpacesService,
  SharedFeaturePolicy,
} from '../../src/modules/spaces/public/index.js';
import {
  DmContacts,
  MessagingService,
} from '../../src/modules/messaging/public/index.js';
import {
  ConnectionsService,
  SocialGroupsService,
  SocialData,
  SocialLifecycle,
} from '../../src/modules/social/public/index.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
type Person = { actor: RequestActor; email: string };
const barrier = () => {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
};
describe('P6-01 private social graph and approved Group admission', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    db: PrismaClient,
    social: ConnectionsService,
    groups: SocialGroupsService,
    kernel: SharedKernel,
    collaboration: CollaborationService,
    contacts: DmContacts,
    auth: AuthService,
    control: SharedControl,
    watcher: Client,
    observer: Client;
  let alice: Person, bob: Person, carol: Person, passwordHash: string;
  const origin = 'http://localhost:3000',
    password = 'synthetic-social-password-123!',
    version = 'social-' + randomUUID(),
    applicationName = 'social-' + randomUUID(),
    page = { limit: 25 };
  async function person(verified = true): Promise<Person> {
    const userId = randomUUID(),
      sessionId = randomUUID(),
      email = randomUUID() + '@example.test';
    await db.user.create({
      data: {
        id: userId,
        email,
        name: 'Private identity',
        emailVerified: verified,
      },
    });
    await db.space.create({
      data: { id: randomUUID(), kind: 'PERSONAL', ownerUserId: userId },
    });
    await db.userSettings.create({ data: { userId } });
    await db.authSession.create({
      data: {
        id: sessionId,
        userId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    await db.authAccount.create({
      data: {
        id: randomUUID(),
        userId,
        providerId: 'credential',
        accountId: userId,
        password: passwordHash,
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
  async function discoverable(who = bob) {
    return social.patchPrivacy(
      who.actor,
      { discoverable: true },
      randomUUID(),
      1,
    );
  }
  async function friendship(a = alice, b = bob) {
    await discoverable(b);
    const pending = await social.request(
      a.actor,
      { id: randomUUID(), recipientUserId: b.actor.userId },
      randomUUID(),
    );
    return social.decide(b.actor, pending.id, 'accept', randomUUID(), 1);
  }
  async function group(discoverable = false) {
    return groups.create(
      alice.actor,
      {
        id: randomUUID(),
        name: 'Private Social Group',
        description: 'Private description',
        publicSummary: 'Approved public summary',
        discoverable,
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
  }
  async function join(g: string, who = bob) {
    const offer = await groups.invite(
      alice.actor,
      g,
      {
        kind: 'MEMBERSHIP',
        memberRole: 'MEMBER',
        recipient: { userId: who.actor.userId },
      },
      randomUUID(),
    );
    const result = await groups.decideInvitation(
      who.actor,
      offer.invitation.id,
      offer.proof!,
      1,
      true,
    );
    if (!('membership' in result)) throw Error('Expected membership');
    return result.membership;
  }
  async function waiting() {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (
        (
          await watcher.query(
            'SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0',
            [applicationName],
          )
        ).rows[0].n > 0
      )
        return;
      await tick();
    }
    throw Error('Expected independent database lock waiter');
  }
  beforeAll(async () => {
    sandbox = await migrationSandbox(process.env);
    const migrated = spawnSync(
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
    if (migrated.status !== 0)
      throw Error('Owned Social schema migration failed; credentials withheld');
    const schema = new URL(sandbox.url).searchParams.get('schema')!,
      base = isolatedTestDatabaseUrl(process.env);
    db = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: base,
          options: '-c timezone=UTC -c search_path=' + schema,
          application_name: applicationName,
          max: 12,
        },
        { schema },
      ),
    });
    const instance: DatabaseService = {
      client: db,
      checkConnection: async () => {
        await db.$queryRaw`SELECT 1`;
      },
      onApplicationShutdown: () => db.$disconnect(),
    };
    const root = fs.mkdtempSync(path.resolve('.tools/p601-integration-'));
    app = await testApplication({
      databaseUrl: base,
      databaseInstance: instance,
      environment: {
        STORAGE_ROOT: path.join(root, 'files'),
        SHARED_CONTROL_ROOT: path.join(root, 'control'),
        SHARED_CONTROL_KEYS: JSON.stringify({
          k1: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'k1',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P601-ONLY',
      },
    });
    control = app.get(SharedControl);
    await control.initialize();
    social = app.get(ConnectionsService);
    groups = app.get(SocialGroupsService);
    kernel = app.get(SharedKernel);
    collaboration = app.get(CollaborationService);
    contacts = app.get(DmContacts);
    auth = app.get(AuthService);
    passwordHash = await (await auth.auth.$context).password.hash(password);
    observer = new Client({
      connectionString: base,
      options: '-c search_path=' + schema,
      application_name: applicationName + '-observer',
    });
    await observer.connect();
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
        approvalReference: 'SYNTHETIC-ONLY',
        configuration: {
          policyVersion: version,
          approvalReference: 'SYNTHETIC-ONLY',
          accountableOperator: 'fixture',
          applicableContexts: ['SOCIAL_GROUP', 'CONVERSATION'],
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
          backupPolicyReference: 'synthetic control',
        },
      },
    });
  }, 30000);
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.sharedRateLimit.deleteMany();
    alice = await person();
    bob = await person();
    carol = await person();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await db?.$disconnect();
    await observer?.end();
    await watcher?.end();
    await sandbox?.close();
  });
  it('defaults to undiscoverable and returns identical empty shapes for unknown, opted-out, self and unverified identities', async () => {
    expect(await social.privacy(bob.actor)).toEqual({
      discoverable: false,
      allowFriendRequests: true,
      revision: 1,
    });
    for (const email of [
      bob.email,
      alice.email,
      (await person(false)).email,
      'unknown@example.test',
    ])
      expect(await social.discover(alice.actor, email)).toEqual({ items: [] });
  });
  it('returns only opted-in opaque ID and display name with identity-owner canonicalization', async () => {
    await discoverable();
    expect(await social.discover(alice.actor, bob.email.toUpperCase())).toEqual(
      { items: [{ id: bob.actor.userId, name: 'Private identity' }] },
    );
  });
  it('request opt-out prevents new requests while leaving accepted friendship intact', async () => {
    const friend = await friendship();
    await social.patchPrivacy(
      bob.actor,
      { allowFriendRequests: false },
      randomUUID(),
      2,
    );
    expect((await social.list(bob.actor, page)).items[0]?.id).toBe(friend.id);
    await expect(
      social.request(
        carol.actor,
        { id: randomUUID(), recipientUserId: bob.actor.userId },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('requires recipient acceptance and denies author acceptance and third-party transitions', async () => {
    await discoverable();
    const pending = await social.request(
      alice.actor,
      { id: randomUUID(), recipientUserId: bob.actor.userId },
      randomUUID(),
    );
    await expect(
      social.decide(alice.actor, pending.id, 'accept', randomUUID(), 1),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      social.decide(carol.actor, pending.id, 'accept', randomUUID(), 1),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await social.decide(bob.actor, pending.id, 'accept', randomUUID(), 1))
        .state,
    ).toBe('ACCEPTED');
  });
  it('deduplicates creation and rejects a reused key with different content', async () => {
    await discoverable();
    const id = randomUUID(),
      key = randomUUID(),
      body = { id, recipientUserId: bob.actor.userId };
    const first = await social.request(alice.actor, body, key);
    expect(await social.request(alice.actor, body, key)).toEqual(first);
    await expect(
      social.request(alice.actor, { ...body, id: randomUUID() }, key),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.socialConnection.count({ where: { id } })).toBe(1);
  });
  it('opposing requests never silently accept and produce only one pending pair', async () => {
    await discoverable(alice);
    await discoverable(bob);
    const result = await Promise.allSettled([
      social.request(
        alice.actor,
        { id: randomUUID(), recipientUserId: bob.actor.userId },
        randomUUID(),
      ),
      social.request(
        bob.actor,
        { id: randomUUID(), recipientUserId: alice.actor.userId },
        randomUUID(),
      ),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await db.socialConnection.count({
        where: {
          requesterUserId: { in: [alice.actor.userId, bob.actor.userId] },
          state: 'PENDING',
        },
      }),
    ).toBe(1);
  });
  it('decline, cancel and removal enforce states, revisions and fresh requests', async () => {
    await discoverable();
    const pending = await social.request(
      alice.actor,
      { id: randomUUID(), recipientUserId: bob.actor.userId },
      randomUUID(),
    );
    await expect(
      social.decide(bob.actor, pending.id, 'cancel', randomUUID(), 1),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      social.decide(bob.actor, pending.id, 'decline', randomUUID(), 2),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await social.decide(bob.actor, pending.id, 'decline', randomUUID(), 1))
        .state,
    ).toBe('DECLINED');
    await expect(
      social.decide(bob.actor, pending.id, 'accept', randomUUID(), 2),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await social.request(
          alice.actor,
          { id: randomUUID(), recipientUserId: bob.actor.userId },
          randomUUID(),
        )
      ).state,
    ).toBe('PENDING');
  });
  it('Circles remain private labels and refuse nonfriends and foreign IDs', async () => {
    const f = await friendship(),
      circle = await social.createCircle(
        alice.actor,
        { id: randomUUID(), name: 'Family' },
        randomUUID(),
      );
    await social.label(alice.actor, circle.id, f.id, true, randomUUID(), 1);
    expect((await social.labels(alice.actor, circle.id, page)).items).toEqual([
      { circleId: circle.id, connectionId: f.id },
    ]);
    await expect(social.circle(bob.actor, circle.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      social.label(carol.actor, circle.id, f.id, true, randomUUID(), 2),
    ).rejects.toMatchObject({ status: 404 });
    expect((await groups.list(bob.actor, page)).items).toEqual([]);
  });
  it('friend removal atomically removes labels from both users Circles', async () => {
    const f = await friendship();
    for (const who of [alice, bob]) {
      const circle = await social.createCircle(
        who.actor,
        { id: randomUUID(), name: 'Private' },
        randomUUID(),
      );
      await social.label(who.actor, circle.id, f.id, true, randomUUID(), 1);
    }
    await social.decide(alice.actor, f.id, 'remove', randomUUID(), 2);
    expect(
      await db.socialCircleMember.count({ where: { connectionId: f.id } }),
    ).toBe(0);
  });
  it('social block terminates friendship and labels and unblock restores neither', async () => {
    const f = await friendship(),
      circle = await social.createCircle(
        alice.actor,
        { id: randomUUID(), name: 'Private' },
        randomUUID(),
      );
    await social.label(alice.actor, circle.id, f.id, true, randomUUID(), 1);
    const blocked = await social.block(
      alice.actor,
      bob.actor.userId,
      randomUUID(),
      1,
    );
    expect(blocked.active).toBe(true);
    expect(
      (await db.socialConnection.findUniqueOrThrow({ where: { id: f.id } }))
        .state,
    ).toBe('REMOVED');
    expect((await social.discover(alice.actor, bob.email)).items).toEqual([]);
    await expect(
      social.request(
        alice.actor,
        { id: randomUUID(), recipientUserId: bob.actor.userId },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await contacts.set(
      alice.actor,
      blocked.id!,
      false,
      randomUUID(),
      blocked.revision,
      true,
    );
    expect(
      await db.socialCircleMember.count({ where: { connectionId: f.id } }),
    ).toBe(0);
    expect(
      (await db.socialConnection.findUniqueOrThrow({ where: { id: f.id } }))
        .state,
    ).toBe('REMOVED');
  });
  it('existing DM block endpoints apply the same Social consequences without removing common Group membership', async () => {
    const f = await friendship(),
      g = await group();
    await join(g.id);
    const dm = await app.get(MessagingService).create(
      alice.actor,
      {
        id: randomUUID(),
        kind: 'DM',
        participants: [bob.actor.userId],
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    await contacts.set(bob.actor, dm.id, true, randomUUID(), 1);
    expect(
      (await db.socialConnection.findUniqueOrThrow({ where: { id: f.id } }))
        .state,
    ).toBe('REMOVED');
    expect((await groups.read(bob.actor, g.id)).id).toBe(g.id);
  });
  it('cannot expose either direction of blocking through discovery', async () => {
    await discoverable();
    await discoverable(alice);
    await social.block(bob.actor, alice.actor.userId, randomUUID(), 1);
    expect(await social.discover(alice.actor, bob.email)).toEqual({
      items: [],
    });
    expect(await social.discover(bob.actor, alice.email)).toEqual({
      items: [],
    });
  });
  it('blocks pending pair requests and prevents acceptance after unblock', async () => {
    await discoverable();
    const p = await social.request(
      alice.actor,
      { id: randomUUID(), recipientUserId: bob.actor.userId },
      randomUUID(),
    );
    const b = await social.block(
      bob.actor,
      alice.actor.userId,
      randomUUID(),
      1,
    );
    expect(
      (await db.socialConnection.findUniqueOrThrow({ where: { id: p.id } }))
        .state,
    ).toBe('CANCELED');
    await contacts.set(bob.actor, b.id!, false, randomUUID(), b.revision, true);
    await expect(
      social.decide(bob.actor, p.id, 'accept', randomUUID(), 2),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('requires current sessions and verified accounts for reads and writes', async () => {
    const unverified = await person(false);
    await expect(social.privacy(unverified.actor)).rejects.toMatchObject({
      status: 403,
    });
    await db.authSession.delete({ where: { id: alice.actor.sessionId! } });
    await expect(social.privacy(alice.actor)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('private Group is absent from discovery and outsider content, directory and invitation reads', async () => {
    const g = await group();
    expect((await groups.discover(bob.actor, page)).items).toEqual([]);
    await expect(groups.read(bob.actor, g.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(groups.members(bob.actor, g.id, page)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      groups.join(bob.actor, g.id, { id: randomUUID() }, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('discoverable previews contain only explicitly public metadata, never private content/counts/member identity', async () => {
    const g = await group(true);
    expect((await groups.discover(bob.actor, page)).items).toEqual([
      { id: g.id, name: g.name, publicSummary: g.publicSummary },
    ]);
    await expect(groups.read(bob.actor, g.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('join request grants no rights until current Owner/Admin approval and creates one generation', async () => {
    const g = await group(true),
      pending = await groups.join(
        bob.actor,
        g.id,
        { id: randomUUID() },
        randomUUID(),
      );
    await expect(groups.read(bob.actor, g.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      groups.decideJoin(carol.actor, g.id, pending.id, 'approve', 1),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await groups.decideJoin(alice.actor, g.id, pending.id, 'approve', 1))
        .state,
    ).toBe('APPROVED');
    expect((await groups.read(bob.actor, g.id)).id).toBe(g.id);
    await expect(
      groups.decideJoin(alice.actor, g.id, pending.id, 'approve', 1),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('applicants see only their own requests and cannot approve themselves', async () => {
    const g = await group(true),
      p = await groups.join(
        bob.actor,
        g.id,
        { id: randomUUID() },
        randomUUID(),
      );
    expect((await groups.requests(carol.actor, g.id, page)).items).toEqual([]);
    expect(
      (await groups.requests(bob.actor, g.id, page)).items.map((r) => r.id),
    ).toEqual([p.id]);
    await expect(
      groups.decideJoin(bob.actor, g.id, p.id, 'approve', 1),
    ).rejects.toBeDefined();
  });
  it('join cancellation and rejection preserve no access, with no cross-Group request substitution', async () => {
    const g = await group(true),
      other = await group(true),
      p = await groups.join(
        bob.actor,
        g.id,
        { id: randomUUID() },
        randomUUID(),
      );
    await expect(
      groups.decideJoin(alice.actor, other.id, p.id, 'approve', 1),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await groups.decideJoin(bob.actor, g.id, p.id, 'cancel', 1)).state,
    ).toBe('CANCELED');
    const next = await groups.join(
      bob.actor,
      g.id,
      { id: randomUUID() },
      randomUUID(),
    );
    expect(
      (await groups.decideJoin(alice.actor, g.id, next.id, 'reject', 1)).state,
    ).toBe('REJECTED');
    await expect(groups.read(bob.actor, g.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('requires named recipient acceptance and rejects forwarded invitation proof', async () => {
    const g = await group(),
      offer = await groups.invite(
        alice.actor,
        g.id,
        {
          kind: 'MEMBERSHIP',
          memberRole: 'MEMBER',
          recipient: { userId: bob.actor.userId },
        },
        randomUUID(),
      );
    expect(
      await collaboration.preview(offer.proof!, 'SOCIAL_GROUP'),
    ).toMatchObject({
      contextLabel: 'Social Group',
      offerCategory: 'MEMBERSHIP',
    });
    await expect(groups.read(bob.actor, g.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      groups.decideInvitation(
        carol.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await groups.decideInvitation(
        bob.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
      ),
    ).toHaveProperty('membership');
  });
  it('revoked and expired invitations do not admit', async () => {
    const g = await group(),
      offer = await groups.invite(
        alice.actor,
        g.id,
        {
          kind: 'MEMBERSHIP',
          memberRole: 'MEMBER',
          recipient: { userId: bob.actor.userId },
        },
        randomUUID(),
      );
    await collaboration.revokeInvitation(
      alice.actor,
      g.id,
      offer.invitation.id,
      1,
    );
    await expect(
      groups.decideInvitation(
        bob.actor,
        offer.invitation.id,
        offer.proof!,
        2,
        true,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('Owner alone promotes Admin; ordinary Members cannot change settings/invite/manage others', async () => {
    const g = await group(),
      m = await join(g.id);
    await expect(
      groups.patch(bob.actor, g.id, { name: 'Overreach' }, 1),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      groups.invite(
        bob.actor,
        g.id,
        {
          kind: 'MEMBERSHIP',
          memberRole: 'MEMBER',
          recipient: { userId: carol.actor.userId },
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    const admin = await collaboration.changeMembership(
      alice.actor,
      g.id,
      m.id,
      m.revision,
      { state: 'ACTIVE', memberRole: 'ADMIN' },
    );
    const peer = await join(g.id, carol);
    await expect(
      collaboration.changeMembership(bob.actor, g.id, peer.id, peer.revision, {
        state: 'ACTIVE',
        memberRole: 'ADMIN',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await groups.patch(
          bob.actor,
          g.id,
          { name: 'Approved admin change' },
          1,
        )
      ).name,
    ).toBe('Approved admin change');
    expect(admin.memberRole).toBe('ADMIN');
  });
  it('Admin may remove an ordinary Member but cannot remove Owner or another Admin', async () => {
    const g = await group(),
      m = await join(g.id),
      peer = await join(g.id, carol);
    await collaboration.changeMembership(alice.actor, g.id, m.id, m.revision, {
      state: 'ACTIVE',
      memberRole: 'ADMIN',
    });
    const members = await groups.members(alice.actor, g.id, page),
      owner = members.items.find((r) => r.role === 'OWNER')!;
    await expect(
      collaboration.changeMembership(
        bob.actor,
        g.id,
        owner.id,
        owner.revision,
        { state: 'REVOKED', memberRole: 'ADMIN' },
      ),
    ).rejects.toBeDefined();
    await collaboration.changeMembership(
      bob.actor,
      g.id,
      peer.id,
      peer.revision,
      { state: 'REVOKED', memberRole: 'MEMBER' },
    );
    await expect(groups.read(carol.actor, g.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('issuer demotion before invitation acceptance is authoritative', async () => {
    const g = await group(),
      m = await join(g.id);
    const admin = await collaboration.changeMembership(
      alice.actor,
      g.id,
      m.id,
      m.revision,
      { state: 'ACTIVE', memberRole: 'ADMIN' },
    );
    const offer = await groups.invite(
      bob.actor,
      g.id,
      {
        kind: 'MEMBERSHIP',
        memberRole: 'MEMBER',
        recipient: { userId: carol.actor.userId },
      },
      randomUUID(),
    );
    await collaboration.changeMembership(
      alice.actor,
      g.id,
      m.id,
      admin.revision,
      { state: 'ACTIVE', memberRole: 'MEMBER' },
    );
    await expect(
      groups.decideInvitation(
        carol.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('blocking an inviter prevents direct invitations and stale acceptance after unblock', async () => {
    await discoverable(alice);
    const g = await group(),
      offer = await groups.invite(
        alice.actor,
        g.id,
        {
          kind: 'MEMBERSHIP',
          memberRole: 'MEMBER',
          recipient: { userId: bob.actor.userId },
        },
        randomUUID(),
      );
    const blocked = await social.block(
      bob.actor,
      alice.actor.userId,
      randomUUID(),
      1,
    );
    await expect(
      groups.decideInvitation(
        bob.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await contacts.set(
      bob.actor,
      blocked.id!,
      false,
      randomUUID(),
      blocked.revision,
      true,
    );
    await expect(
      groups.decideInvitation(
        bob.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('rejoining after removal increments membership generation and invalidates old receipt/cursor authority', async () => {
    const g = await group(true),
      m = await join(g.id);
    await collaboration.changeMembership(alice.actor, g.id, m.id, m.revision, {
      state: 'REVOKED',
      memberRole: 'MEMBER',
    });
    const p = await groups.join(
      bob.actor,
      g.id,
      { id: randomUUID() },
      randomUUID(),
    );
    await groups.decideJoin(alice.actor, g.id, p.id, 'approve', 1);
    const next = (await groups.members(bob.actor, g.id, page)).items.find(
      (r) => r.id === m.id,
    )!;
    expect(next.generation).toBe(m.generation + 1);
  });
  it('last departure creates the existing 30-day closure and keeps new admissions inaccessible', async () => {
    const g = await group(),
      owner = (await groups.members(alice.actor, g.id, page)).items.find(
        (r) => r.role === 'OWNER',
      )!;
    await collaboration.leave(alice.actor, g.id, owner.revision);
    const custody = await db.sharedCustody.findUniqueOrThrow({
      where: { spaceId: g.id },
    });
    expect(custody.state).toBe('CLOSING_GRACE');
    expect(
      await db.sharedLifecycleJob.count({ where: { spaceId: g.id } }),
    ).toBe(1);
    await expect(groups.read(alice.actor, g.id)).rejects.toMatchObject({
      status: 404,
    });
    await db.sharedLifecycleJob.updateMany({
      where: { spaceId: g.id },
      data: { nextAt: new Date(0) },
    });
    expect(await app.get(SocialLifecycle).consume()).toBe(true);
    expect(
      (await db.sharedCustody.findUniqueOrThrow({ where: { spaceId: g.id } }))
        .state,
    ).toBe('CLOSING_GRACE');
  });
  it('private social portability and erasure preserve another user Group and identity', async () => {
    await friendship();
    await social.createCircle(
      alice.actor,
      { id: randomUUID(), name: 'Personal' },
      randomUUID(),
    );
    const g = await group(),
      scope = await app.get(SpacesService).authorizePersonal(alice.actor),
      data = app.get(SocialData),
      budget = new ExportBudget();
    await db.$transaction((tx) => data.snapshot(tx, scope, budget));
    expect(budget.sections.socialConnections).toHaveLength(1);
    expect(budget.sections.socialCircles).toHaveLength(1);
    await db.$transaction((tx) => data.erase(tx, scope));
    expect(
      await db.socialCircle.count({
        where: { ownerUserId: alice.actor.userId },
      }),
    ).toBe(0);
    expect(
      await db.user.findUnique({ where: { id: bob.actor.userId } }),
    ).not.toBeNull();
    expect(
      await db.socialGroup.findUnique({ where: { id: g.id } }),
    ).not.toBeNull();
  });
  it('rejects SQL-level cross-owner Circle labels and unsupported Social roles', async () => {
    const f = await friendship(),
      circle = await social.createCircle(
        carol.actor,
        { id: randomUUID(), name: 'Unrelated' },
        randomUUID(),
      );
    const scope = await db.socialCircle.findUniqueOrThrow({
      where: { id: circle.id },
    });
    await expect(
      db.socialCircleMember.create({
        data: {
          circleId: circle.id,
          spaceId: scope.spaceId,
          connectionId: f.id,
        },
      }),
    ).rejects.toBeDefined();
    const g = await group(),
      m = await join(g.id);
    await expect(
      db.contextAccess.update({
        where: { id: m.id },
        data: { memberRole: 'VIEWER' },
      }),
    ).rejects.toBeDefined();
  });
  it('uses the existing feature policy seam in free mode for growth with authoritative usage', async () => {
    const spy = vi.spyOn(app.get(SharedFeaturePolicy), 'decide');
    await discoverable();
    await social.request(
      alice.actor,
      { id: randomUUID(), recipientUserId: bob.actor.userId },
      randomUUID(),
    );
    await social.createCircle(
      alice.actor,
      { id: randomUUID(), name: 'Usage' },
      randomUUID(),
    );
    await group();
    expect(spy.mock.calls.map((r) => r[0].feature)).toEqual(
      expect.arrayContaining([
        'social.connection',
        'social.circle',
        'social.group',
        'shared.custody',
      ]),
    );
  });
  it('database-committed block wins a pending accept using observable independent lock ordering', async () => {
    await discoverable();
    const p = await social.request(
      alice.actor,
      { id: randomUUID(), recipientUserId: bob.actor.userId },
      randomUUID(),
    );
    await observer.query('BEGIN');
    const locks = (
      await observer.query(
        'SELECT id FROM "Space" WHERE "ownerUserId"=ANY($1::uuid[]) ORDER BY id',
        [[alice.actor.userId, bob.actor.userId]],
      )
    ).rows;
    for (const row of locks)
      await observer.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        ['personal-access:' + row.id],
      );
    let accept: Promise<unknown> | undefined;
    try {
      accept = social
        .decide(bob.actor, p.id, 'accept', randomUUID(), 1)
        .catch((e) => e);
      await waiting();
      const owner = await db.space.findFirstOrThrow({
        where: { ownerUserId: alice.actor.userId, kind: 'PERSONAL' },
      });
      await observer.query(
        'INSERT INTO "DmContactState"("spaceId","ownerUserId",version,"updatedAt") VALUES($1,$2,0,now()) ON CONFLICT DO NOTHING',
        [owner.id, alice.actor.userId],
      );
      await observer.query(
        'INSERT INTO "DmContactBlock"(id,"spaceId","ownerUserId","targetUserId",active,"updatedAt") VALUES($1,$2,$3,$4,true,now())',
        [randomUUID(), owner.id, alice.actor.userId, bob.actor.userId],
      );
      await observer.query('COMMIT');
      expect(await accept).toBeInstanceOf(Error);
      expect(
        (await db.socialConnection.findUniqueOrThrow({ where: { id: p.id } }))
          .state,
      ).toBe('CANCELED');
    } finally {
      await observer.query('ROLLBACK');
      await accept;
    }
  });
  it('current revocation wins a blocked Group update without stale audit/outbox effects', async () => {
    const g = await group(),
      m = await join(g.id);
    await collaboration.changeMembership(alice.actor, g.id, m.id, m.revision, {
      state: 'ACTIVE',
      memberRole: 'ADMIN',
    });
    const entered = barrier(),
      release = barrier(),
      original = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (record) => {
      if (
        record.action === 'membership.change' &&
        record.outcome === 'INTENT'
      ) {
        entered.release();
        await release.promise;
      }
      return original(record);
    });
    const current = await db.contextAccess.findUniqueOrThrow({
      where: { id: m.id },
    });
    const revoke = collaboration.changeMembership(
      alice.actor,
      g.id,
      m.id,
      current.revision,
      { state: 'REVOKED', memberRole: 'ADMIN' },
    );
    await entered.promise;
    const update = groups
      .patch(bob.actor, g.id, { name: 'Must not commit' }, 1)
      .catch((e) => e);
    try {
      await waiting();
    } finally {
      release.release();
    }
    await revoke;
    expect(await update).toBeInstanceOf(Error);
    expect(
      (await db.socialGroup.findUniqueOrThrow({ where: { id: g.id } })).name,
    ).toBe(g.name);
  });
  it('strict HTTP schemas reject overposting, absent auth, bad Origin, and bound lookup rates', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/social/privacy')
      .expect(401);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email: alice.email, password })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])
      .map((v) => v.split(';')[0])
      .join('; ');
    await request(app.getHttpServer())
      .patch('/api/v1/social/privacy')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .set('Idempotency-Key', randomUUID())
      .send({ discoverable: true, ownerUserId: bob.actor.userId })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/social/discovery')
      .set('Cookie', cookie)
      .set('Origin', 'https://untrusted.example')
      .send({ email: bob.email })
      .expect(403);
    for (let i = 0; i < 22; i++)
      await request(app.getHttpServer())
        .post('/api/v1/social/discovery')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ email: bob.email });
    await request(app.getHttpServer())
      .post('/api/v1/social/discovery')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ email: bob.email })
      .expect(429);
  });
  it('succession needs named successor acceptance and fresh provider-backed reauthentication before old Owner leaves', async () => {
    const g = await group(),
      m = await join(g.id),
      owner = (await groups.members(alice.actor, g.id, page)).items.find(
        (r) => r.role === 'OWNER',
      )!;
    await expect(
      collaboration.leave(alice.actor, g.id, owner.revision),
    ).rejects.toMatchObject({ status: 409 });
    const offer = await collaboration.createHandover(
      alice.actor,
      g.id,
      { successorAccessId: m.id },
      randomUUID(),
    );
    await expect(
      collaboration.decideHandover(
        bob.actor,
        g.id,
        offer.id,
        1,
        'accept',
        'incorrect-password',
      ),
    ).rejects.toBeDefined();
    const accepted = await collaboration.decideHandover(
      bob.actor,
      g.id,
      offer.id,
      1,
      'accept',
      password,
    );
    expect(accepted.state).toBe('ACCEPTED');
    const previous = (await groups.members(alice.actor, g.id, page)).items.find(
      (r) => r.id === owner.id,
    )!;
    await collaboration.leave(alice.actor, g.id, previous.revision);
    expect(
      (await groups.members(bob.actor, g.id, page)).items.find(
        (r) => r.id === m.id,
      )?.role,
    ).toBe('OWNER');
  });
  it('signed restrictive privacy evidence fails closed on restored old preferences and explicit replay keeps discovery off', async () => {
    await discoverable();
    await social.patchPrivacy(
      bob.actor,
      { discoverable: false, allowFriendRequests: false },
      randomUUID(),
      2,
    );
    const owner = await db.space.findFirstOrThrow({
      where: { ownerUserId: bob.actor.userId, kind: 'PERSONAL' },
    });
    await db.socialPrivacy.update({
      where: { spaceId: owner.id },
      data: { version: 0n, discoverable: true, allowFriendRequests: true },
    });
    await expect(social.privacy(bob.actor)).rejects.toMatchObject({
      status: 403,
    });
    expect(await social.discover(alice.actor, bob.email)).toEqual({
      items: [],
    });
    expect((await social.replay(bob.actor)).applied).toBeGreaterThan(0);
    expect(await social.privacy(bob.actor)).toMatchObject({
      discoverable: false,
      allowFriendRequests: false,
    });
  });
  it('join creation keys are scoped, replay current terminal outcomes and reject changed payloads', async () => {
    const g = await group(true),
      id = randomUUID(),
      key = randomUUID();
    const pending = await groups.join(bob.actor, g.id, { id }, key);
    expect(await groups.join(bob.actor, g.id, { id }, key)).toEqual(pending);
    await expect(
      groups.join(bob.actor, g.id, { id: randomUUID() }, key),
    ).rejects.toMatchObject({ status: 409 });
    await groups.decideJoin(alice.actor, g.id, id, 'reject', 1);
    expect((await groups.join(bob.actor, g.id, { id }, key)).state).toBe(
      'REJECTED',
    );
  });
  it('ordinary validation conflicts abort control intents and atomically preserve source/audit/outbox/receipt counts', async () => {
    const circle = await social.createCircle(
      alice.actor,
      { id: randomUUID(), name: 'Conflict fixture' },
      randomUUID(),
    );
    const before = {
      circles: await db.socialCircle.count(),
      audits: await db.securityAuditEvent.count(),
      events: await db.outboxEvent.count(),
      receipts: await db.idempotencyRecord.count(),
    };
    await expect(
      social.editCircle(
        alice.actor,
        circle.id,
        { name: 'Must roll back' },
        randomUUID(),
        9,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await social.circle(alice.actor, circle.id)).toEqual(circle);
    expect({
      circles: await db.socialCircle.count(),
      audits: await db.securityAuditEvent.count(),
      events: await db.outboxEvent.count(),
      receipts: await db.idempotencyRecord.count(),
    }).toEqual(before);
  });
  it('account closure hides discovery and Group previews without exposing a closed identity', async () => {
    await discoverable();
    const g = await group(true);
    await db.space.updateMany({
      where: { ownerUserId: alice.actor.userId, kind: 'PERSONAL' },
      data: { accessClosedAt: new Date() },
    });
    expect(
      (await groups.discover(bob.actor, page)).items.some((r) => r.id === g.id),
    ).toBe(false);
    await db.space.updateMany({
      where: { ownerUserId: bob.actor.userId, kind: 'PERSONAL' },
      data: { accessClosedAt: new Date() },
    });
    expect(await social.discover(carol.actor, bob.email)).toEqual({
      items: [],
    });
    await expect(social.list(bob.actor, page)).rejects.toBeDefined();
  });
  it('email invitations keep known and unknown recipient response shapes private', async () => {
    const g = await group();
    const known = await groups.invite(
      alice.actor,
      g.id,
      {
        kind: 'MEMBERSHIP',
        memberRole: 'MEMBER',
        recipient: { email: bob.email },
      },
      randomUUID(),
    );
    const unknown = await groups.invite(
      alice.actor,
      g.id,
      {
        kind: 'MEMBERSHIP',
        memberRole: 'MEMBER',
        recipient: { email: 'unknown-' + randomUUID() + '@example.test' },
      },
      randomUUID(),
    );
    expect(Object.keys(known.invitation).sort()).toEqual(
      Object.keys(unknown.invitation).sort(),
    );
    expect(known.invitation.state).toBe(unknown.invitation.state);
    expect(JSON.stringify(known)).not.toContain(bob.email);
    expect(JSON.stringify(unknown)).not.toContain('unknown-');
  });
  it('Social suspension cancels pending requests and erasure works without Shared activation or signing keys', async () => {
    await discoverable();
    await social.request(
      alice.actor,
      { id: randomUUID(), recipientUserId: bob.actor.userId },
      randomUUID(),
    );
    const scope = await app.get(SpacesService).authorizePersonal(bob.actor),
      data = app.get(SocialData);
    await db.$transaction((tx) => data.suspend(tx, scope));
    expect((await social.privacy(bob.actor)).allowFriendRequests).toBe(false);
    expect(
      await db.socialConnection.count({
        where: { recipientUserId: bob.actor.userId, state: 'PENDING' },
      }),
    ).toBe(0);
    const spy = vi.spyOn(kernel, 'assertEnabled').mockImplementation(() => {
      throw Error('Shared deliberately unavailable');
    });
    await db.$transaction((tx) => data.erase(tx, scope));
    expect(
      await db.socialPrivacy.count({
        where: { ownerUserId: bob.actor.userId },
      }),
    ).toBe(0);
    spy.mockRestore();
  });
  it('purges a Social Group only after the recovery deadline through bounded owner cleanup, retaining Personal users', async () => {
    const g = await group(true);
    await groups.join(bob.actor, g.id, { id: randomUUID() }, randomUUID());
    const owner = (await groups.members(alice.actor, g.id, page)).items.find(
      (r) => r.role === 'OWNER',
    )!;
    await collaboration.leave(alice.actor, g.id, owner.revision);
    const job = await db.sharedLifecycleJob.findFirstOrThrow({
      where: { spaceId: g.id },
    });
    await db.sharedLifecycleJob.update({
      where: { id: job.id },
      data: {
        effectiveDepartureAt: new Date(Date.now() - 31 * 86400000),
        recoveryDeadline: new Date(Date.now() - 86400000),
        nextAt: new Date(0),
      },
    });
    for (let pass = 0; pass < 40; pass++) {
      if (
        (
          await db.sharedLifecycleJob.findUniqueOrThrow({
            where: { id: job.id },
          })
        ).state === 'DELETED'
      )
        break;
      await app.get(SocialLifecycle).consume();
    }
    expect(
      (await db.sharedLifecycleJob.findUniqueOrThrow({ where: { id: job.id } }))
        .state,
    ).toBe('DELETED');
    expect(await db.socialGroup.findUnique({ where: { id: g.id } })).toBeNull();
    expect(await db.socialJoinRequest.count({ where: { groupId: g.id } })).toBe(
      0,
    );
    expect(
      await db.user.findUnique({ where: { id: bob.actor.userId } }),
    ).not.toBeNull();
  });
  it('restored Circle labels stay denied until existing pair-block replay removes stale friendship and labels', async () => {
    const f = await friendship(),
      circle = await social.createCircle(
        alice.actor,
        { id: randomUUID(), name: 'Restore-safe labels' },
        randomUUID(),
      );
    await social.label(alice.actor, circle.id, f.id, true, randomUUID(), 1);
    const previous = await db.socialConnection.findUniqueOrThrow({
        where: { id: f.id },
      }),
      label = await db.socialCircleMember.findUniqueOrThrow({
        where: {
          circleId_connectionId: { circleId: circle.id, connectionId: f.id },
        },
      });
    const block = await social.block(
      alice.actor,
      bob.actor.userId,
      randomUUID(),
      1,
    );
    await db.dmContactBlock.update({
      where: { id: block.id! },
      data: { active: false },
    });
    const contact = await db.dmContactBlock.findUniqueOrThrow({
      where: { id: block.id! },
    });
    await db.dmContactState.update({
      where: { spaceId: contact.spaceId },
      data: { version: 0n },
    });
    await db.socialConnection.delete({ where: { id: f.id } });
    await db.socialConnection.create({ data: previous });
    await db.socialCircleMember.create({ data: label });
    await expect(
      social.labels(alice.actor, circle.id, page),
    ).rejects.toMatchObject({ status: 403 });
    await contacts.replay(alice.actor);
    expect((await social.labels(alice.actor, circle.id, page)).items).toEqual(
      [],
    );
    expect(
      (await db.socialConnection.findUniqueOrThrow({ where: { id: f.id } }))
        .state,
    ).toBe('REMOVED');
  });
  it('signed Group privacy survives restored metadata and explicit authorized republication remains possible', async () => {
    const g = await group(true);
    const hidden = await groups.patch(
      alice.actor,
      g.id,
      { discoverable: false },
      1,
    );
    expect(hidden.discoverable).toBe(false);
    await db.socialGroup.update({
      where: { id: g.id },
      data: { discoverable: true },
    });
    expect(
      (await groups.discover(bob.actor, page)).items.some((r) => r.id === g.id),
    ).toBe(false);
    expect((await groups.read(alice.actor, g.id)).discoverable).toBe(false);
    const published = await groups.patch(
      alice.actor,
      g.id,
      { discoverable: true },
      2,
    );
    expect(published.discoverable).toBe(true);
    expect(
      (await groups.discover(bob.actor, page)).items.some((r) => r.id === g.id),
    ).toBe(true);
  });
});
