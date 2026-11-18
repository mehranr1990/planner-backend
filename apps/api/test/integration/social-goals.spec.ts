import 'reflect-metadata';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import request_ from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { DatabaseService } from '../../src/platform/database/database.service.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import {
  SocialGroupsService,
  SocialActivitiesService,
  SocialGoalsService,
  SocialPlanningService,
  SocialData,
} from '../../src/modules/social/public/index.js';
import { CollaborationService } from '../../src/modules/spaces/public/index.js';
import { ExportBudget } from '../../src/platform/lifecycle/personal-data.js';
import { localDay } from '../../src/modules/social/domain/goals.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
type Person = { actor: RequestActor; email: string };
type Goal = Awaited<ReturnType<SocialGoalsService['read']>>;
describe('P6-05 Social Goals and Challenges', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    db: PrismaClient,
    groups: SocialGroupsService,
    activities: SocialActivitiesService,
    goals: SocialGoalsService,
    planning: SocialPlanningService,
    collaboration: CollaborationService,
    passwordHash: string;
  let alice: Person, bob: Person, carol: Person, dave: Person;
  const origin = 'http://localhost:3000',
    password = 'synthetic-activity-password-123!',
    version = 'goals-' + randomUUID(),
    key = () => randomUUID();
  const shift = (d: string, days: number) =>
    new Date(Date.parse(d) + days * 86400000).toISOString().slice(0, 10);
  const today = () => localDay(new Date(), 'UTC');
  async function person(name = 'Private identity'): Promise<Person> {
    const userId = randomUUID(),
      sessionId = randomUUID(),
      email = randomUUID() + '@example.test';
    await db.user.create({
      data: { id: userId, email, name, emailVerified: true },
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
  async function group(...members: Person[]) {
    const g = await groups.create(
      alice.actor,
      {
        id: randomUUID(),
        name: 'Private Social Group',
        description: null,
        publicSummary: '',
        discoverable: false,
        retentionPolicyVersion: version,
      },
      key(),
    );
    for (const who of members) {
      const offer = await groups.invite(
        alice.actor,
        g.id,
        {
          kind: 'MEMBERSHIP',
          memberRole: 'MEMBER',
          recipient: { userId: who.actor.userId },
        },
        key(),
      );
      await groups.decideInvitation(
        who.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
      );
    }
    return g;
  }
  async function membership(groupId: string, who: Person) {
    const actor = await db.sharedActor.findFirstOrThrow({
      where: { spaceId: groupId, userId: who.actor.userId },
    });
    return db.contextAccess.findFirstOrThrow({
      where: { spaceId: groupId, actorId: actor.id, scopeId: groupId },
    });
  }
  async function activity(...accepted: Person[]) {
    const a = await activities.create(
      alice.actor,
      {
        id: randomUUID(),
        groupId: null,
        template: 'TRAVEL',
        title: 'Private trip',
        description: 'Private plan',
        timezone: 'UTC',
        startsAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        endsAt: new Date(Date.now() + 33 * 86400000).toISOString(),
      },
      key(),
    );
    for (const who of accepted) {
      await activities.invite(
        alice.actor,
        a.id,
        { userId: who.actor.userId },
        key(),
      );
      await activities.rsvp(who.actor, a.id, { rsvp: 'GOING' }, key());
    }
    return a;
  }
  function create(
    ctx: { groupId: string } | { activityId: string },
    extra: Partial<Parameters<SocialGoalsService['create']>[1]> = {},
    who = alice,
  ) {
    return goals.create(
      who.actor,
      {
        id: randomUUID(),
        kind: 'CHALLENGE',
        title: '10 km walk',
        description: null,
        unit: 'km',
        target: 10,
        startsOn: shift(today(), -2),
        endsOn: shift(today(), 10),
        timezone: 'UTC',
        reviewRequired: false,
        ...ctx,
        ...extra,
      },
      key(),
    );
  }
  const submit = (
    who: Person,
    g: { id: string },
    amount: number,
    on = today(),
  ) =>
    goals.submit(
      who.actor,
      g.id,
      { id: randomUUID(), amount, occurredOn: on, note: 'my walk' },
      key(),
    );
  const mine = async (who: Person, g: { id: string }) =>
    (await goals.read(who.actor, g.id)).viewer.participant!;
  const status = (p: Promise<unknown>, code: number) =>
    expect(p).rejects.toMatchObject({ status: code });
  const ok = (p: Promise<unknown>, code: string) =>
    expect(p).rejects.toMatchObject({ response: { code } });
  async function erase(who: Person) {
    const data = app.get(SocialData);
    const space = await db.space.findFirstOrThrow({
      where: { ownerUserId: who.actor.userId },
    });
    const scope = { actor: who.actor, spaceId: space.id } as never;
    await db.$transaction((tx) => data.snapshot(tx, scope, new ExportBudget()));
    await db.$transaction((tx) => data.erase(tx, scope));
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
      throw Error(
        'Owned Social goal schema migration failed; credentials withheld',
      );
    const schema = new URL(sandbox.url).searchParams.get('schema')!,
      url = isolatedTestDatabaseUrl(process.env);
    db = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: url,
          options: '-c timezone=UTC -c search_path=' + schema,
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
    const root = fs.mkdtempSync(path.resolve('.tools/p605-integration-'));
    app = await testApplication({
      databaseUrl: url,
      databaseInstance: instance,
      environment: {
        STORAGE_ROOT: path.join(root, 'files'),
        SHARED_CONTROL_ROOT: path.join(root, 'control'),
        SHARED_CONTROL_KEYS: JSON.stringify({
          k1: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'k1',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P605-ONLY',
      },
    });
    await app.get(SharedControl).initialize();
    groups = app.get(SocialGroupsService);
    activities = app.get(SocialActivitiesService);
    goals = app.get(SocialGoalsService);
    planning = app.get(SocialPlanningService);
    collaboration = app.get(CollaborationService);
    passwordHash = await (
      await app.get(AuthService).auth.$context
    ).password.hash(password);
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
  }, 60000);
  beforeEach(async () => {
    await db.sharedRateLimit.deleteMany();
    alice = await person('Alice');
    bob = await person('Bob');
    carol = await person('Carol');
    dave = await person('Dave');
  });
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    await sandbox?.close();
  });

  it('Group challenge: organizer-only creation, voluntary opt-in, self-reported progress and a completion badge', async () => {
    const g = await group(bob, carol);
    const personalGoals = await db.goal.count();
    await ok(create({ groupId: g.id }, {}, bob), 'ORGANIZER_REQUIRED');
    await status(create({ groupId: g.id }, {}, dave), 404);
    const c = await create({ groupId: g.id });
    // No automatic enrollment: membership does not imply participation.
    expect(c.aggregate).toMatchObject({ participantCount: 0, percent: 0 });
    expect(c.viewer).toEqual({
      organizer: true,
      independentReviewerAvailable: false,
      participant: null,
    });
    expect((await goals.read(bob.actor, c.id)).viewer.organizer).toBe(false);
    await status(goals.read(dave.actor, c.id), 404);
    // Explicit join without organizer approval; duplicate joins are refused.
    const joined = await goals.join(bob.actor, c.id, key());
    expect(joined).toMatchObject({
      state: 'ACTIVE',
      approvedTotal: 0,
      badge: null,
    });
    await ok(goals.join(bob.actor, c.id, key()), 'ALREADY_JOINED');
    await status(goals.join(dave.actor, c.id, key()), 404);
    await submit(bob, c, 4);
    expect(await mine(bob, c)).toMatchObject({
      approvedTotal: 4,
      percent: 40,
      completed: false,
    });
    await submit(bob, c, 7);
    const done = await mine(bob, c);
    expect(done).toMatchObject({
      approvedTotal: 11,
      percent: 100,
      completed: true,
    });
    expect(done.badge?.kind).toBe('COMPLETION');
    const view = await goals.read(alice.actor, c.id);
    expect(view.aggregate).toMatchObject({
      participantCount: 1,
      completedCount: 1,
      approvedTotal: 11,
      percent: 100,
      pendingReviewCount: 0,
    });
    const inbox = await planning.notices(bob.actor, { limit: 100 });
    expect(
      inbox.items.map((n) => [n.kind, n.groupId, n.resourceId]),
    ).toContainEqual(['GOAL_COMPLETED', g.id, c.id]);
    // Social progress never touches Personal Goals.
    expect(await db.goal.count()).toBe(personalGoals);
    const history = await goals.history(bob.actor, c.id);
    expect(history.items.map((h) => h.action)).toEqual([
      'goal.created',
      'participant.joined',
      'entry.submitted',
      'entry.submitted',
      'badge.awarded',
    ]);
  });

  it('independent Activity: accepted participants only, no Group required', async () => {
    const a = await activity(bob);
    await activities.invite(
      alice.actor,
      a.id,
      { userId: carol.actor.userId },
      key(),
    );
    const c = await create({ activityId: a.id }, { kind: 'GOAL', target: 20 });
    expect(c).toMatchObject({ groupId: null, activityId: a.id, kind: 'GOAL' });
    await ok(create({ activityId: a.id }, {}, bob), 'ORGANIZER_REQUIRED');
    // Invited but not accepted: no goal authority.
    await ok(
      goals.join(carol.actor, c.id, key()),
      'ACTIVITY_PERMISSION_REQUIRED',
    );
    await status(goals.read(dave.actor, c.id), 404);
    await goals.join(bob.actor, c.id, key());
    await goals.join(alice.actor, c.id, key());
    await submit(bob, c, 12);
    await submit(alice, c, 7);
    let view = await goals.read(bob.actor, c.id);
    expect(view.completedAt).toBeNull();
    expect(view.aggregate).toMatchObject({ approvedTotal: 19, percent: 95 });
    await submit(alice, c, 1);
    view = await goals.read(bob.actor, c.id);
    // Collective completion awards every active participant at that moment.
    expect(view.completedAt).not.toBeNull();
    expect(view.aggregate).toMatchObject({
      approvedTotal: 20,
      percent: 100,
      completedCount: 2,
    });
    expect(view.viewer.participant).toMatchObject({
      completed: true,
      percent: 60,
    });
    await activities.rsvp(carol.actor, a.id, { rsvp: 'GOING' }, key());
    await ok(goals.join(carol.actor, c.id, key()), 'GOAL_COMPLETED');
  });

  it('review: pending never counts, approval/rejection are explicit, self-review is refused', async () => {
    const g = await group(bob, carol);
    const c = await create({ groupId: g.id }, { reviewRequired: true });
    await goals.join(bob.actor, c.id, key());
    await goals.join(carol.actor, c.id, key());
    await goals.join(alice.actor, c.id, key());
    const e1 = await submit(bob, c, 6),
      e2 = await submit(bob, c, 5),
      own = await submit(alice, c, 3);
    expect(e1.state).toBe('PENDING');
    expect(await mine(bob, c)).toMatchObject({
      approvedTotal: 0,
      pendingTotal: 11,
    });
    expect(
      (await goals.read(alice.actor, c.id)).aggregate.pendingReviewCount,
    ).toBe(3);
    expect(
      (await goals.read(bob.actor, c.id)).aggregate.pendingReviewCount,
    ).toBeNull();
    // Peers see only approved entries; the submitter sees their own pending ones.
    expect(
      (await goals.entries(carol.actor, c.id, { limit: 100 })).items,
    ).toHaveLength(0);
    expect(
      (await goals.entries(bob.actor, c.id, { limit: 100 })).items,
    ).toHaveLength(2);
    expect(
      (await goals.entries(alice.actor, c.id, { limit: 100 })).items,
    ).toHaveLength(3);
    const peers = await goals.participants(carol.actor, c.id, { limit: 100 });
    expect(
      peers.items.find((p) => p.userId === bob.actor.userId),
    ).toMatchObject({
      approvedTotal: 0,
      pendingTotal: null,
    });
    // A peer can neither review nor discover another participant's pending entry.
    await status(
      goals.entryAct(carol.actor, c.id, e1.id, 'approve', {}, 1, key()),
      404,
    );
    // Owner policy: nobody approves their own progress, not even the sole organizer.
    // Alice is the only Group Owner/Admin, so her entry stays PENDING and the API says so.
    await ok(
      goals.entryAct(alice.actor, c.id, own.id, 'approve', {}, 1, key()),
      'SELF_REVIEW_FORBIDDEN',
    );
    await ok(
      goals.correct(
        alice.actor,
        c.id,
        {
          id: randomUUID(),
          participantId: (await mine(alice, c)).id,
          delta: 3,
          reason: 'self',
        },
        (await mine(alice, c)).revision,
        key(),
      ),
      'SELF_REVIEW_FORBIDDEN',
    );
    const soleView = await goals.read(alice.actor, c.id);
    expect(soleView.viewer.independentReviewerAvailable).toBe(false);
    expect(soleView.viewer.participant).toMatchObject({
      approvedTotal: 0,
      pendingTotal: 3,
    });
    expect(
      (await goals.read(bob.actor, c.id)).viewer.independentReviewerAvailable,
    ).toBe(true);
    const approved = await goals.entryAct(
      alice.actor,
      c.id,
      e1.id,
      'approve',
      { note: 'ok' },
      1,
      key(),
    );
    expect(approved).toMatchObject({
      state: 'APPROVED',
      reviewedByUserId: alice.actor.userId,
      submittedByUserId: bob.actor.userId,
      reviewNote: 'ok',
    });
    const rejected = await goals.entryAct(
      alice.actor,
      c.id,
      e2.id,
      'reject',
      { note: 'dup' },
      1,
      key(),
    );
    expect(rejected.state).toBe('REJECTED');
    expect(await mine(bob, c)).toMatchObject({
      approvedTotal: 6,
      pendingTotal: 0,
      completed: false,
    });
    // A decided entry cannot be decided again or retracted after review.
    await ok(
      goals.entryAct(alice.actor, c.id, e2.id, 'approve', {}, 2, key()),
      'ENTRY_NOT_PENDING',
    );
    await ok(
      goals.entryAct(bob.actor, c.id, e1.id, 'retract', {}, 2, key()),
      'ENTRY_NOT_RETRACTABLE',
    );
    await ok(
      goals.entryAct(alice.actor, c.id, e1.id, 'approve', {}, 1, key()),
      'REVISION_CONFLICT',
    );
    const inbox = await planning.notices(bob.actor, { limit: 100 });
    expect(
      inbox.items.filter((n) => n.kind === 'GOAL_ENTRY_DECIDED'),
    ).toHaveLength(2);
    const adminInbox = await planning.notices(alice.actor, { limit: 100 });
    expect(
      adminInbox.items.filter((n) => n.kind === 'GOAL_ENTRY_SUBMITTED'),
    ).toHaveLength(2);
  });

  it('organizer corrections are explicit, audited, fenced and never negative', async () => {
    const g = await group(bob);
    const c = await create({ groupId: g.id });
    await goals.join(bob.actor, c.id, key());
    const e = await submit(bob, c, 10);
    let p = await mine(bob, c);
    expect(p.completed).toBe(true);
    await ok(
      goals.correct(
        alice.actor,
        c.id,
        { id: randomUUID(), participantId: p.id, delta: -11, reason: 'typo' },
        p.revision,
        key(),
      ),
      'NEGATIVE_TOTAL',
    );
    await ok(
      goals.correct(
        alice.actor,
        c.id,
        { id: randomUUID(), participantId: p.id, delta: -1, reason: 'typo' },
        p.revision - 1,
        key(),
      ),
      'REVISION_CONFLICT',
    );
    await ok(
      goals.correct(
        bob.actor,
        c.id,
        { id: randomUUID(), participantId: p.id, delta: 5, reason: 'x' },
        p.revision,
        key(),
      ),
      'ORGANIZER_REQUIRED',
    );
    const fix = await goals.correct(
      alice.actor,
      c.id,
      {
        id: randomUUID(),
        participantId: p.id,
        delta: -2,
        reason: 'GPS double count',
        correctsEntryId: e.id,
      },
      p.revision,
      key(),
    );
    expect(fix).toMatchObject({
      kind: 'CORRECTION',
      amount: -2,
      state: 'APPROVED',
      submittedByUserId: alice.actor.userId,
      note: 'GPS double count',
      correctsEntryId: e.id,
    });
    // The participant's own submission is unchanged; the badge is revoked deterministically.
    const entries = await goals.entries(bob.actor, c.id, { limit: 100 });
    expect(entries.items.find((x) => x.id === e.id)).toMatchObject({
      amount: 10,
      state: 'APPROVED',
    });
    p = await mine(bob, c);
    expect(p).toMatchObject({
      approvedTotal: 8,
      completed: false,
      badge: null,
    });
    const actions = (await goals.history(alice.actor, c.id)).items.map(
      (h) => h.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['entry.corrected', 'badge.revoked']),
    );
    expect(
      (await planning.notices(bob.actor, { limit: 100 })).items.map(
        (n) => n.kind,
      ),
    ).toContain('GOAL_CORRECTED');
  });

  it('visibility: aggregate for members, individual progress for participants, revocation is immediate', async () => {
    const g = await group(bob, carol, dave);
    const c = await create({ groupId: g.id });
    await goals.join(bob.actor, c.id, key());
    await goals.join(carol.actor, c.id, key());
    await submit(bob, c, 3);
    // A non-participating member sees the goal and aggregate, not individuals.
    expect(
      (await goals.read(dave.actor, c.id)).aggregate.participantCount,
    ).toBe(2);
    await ok(
      goals.participants(dave.actor, c.id, { limit: 100 }),
      'GOAL_PARTICIPATION_REQUIRED',
    );
    await ok(
      goals.entries(dave.actor, c.id, { limit: 100 }),
      'GOAL_PARTICIPATION_REQUIRED',
    );
    await ok(submit(dave, c, 1), 'GOAL_PARTICIPATION_REQUIRED');
    const list = await goals.participants(carol.actor, c.id, { limit: 100 });
    expect(list.items.map((p) => p.userId).sort()).toEqual(
      [bob.actor.userId, carol.actor.userId].sort(),
    );
    // Revoking Group membership revokes goal access and hides the person from peers.
    const m = await membership(g.id, bob);
    await collaboration.changeMembership(alice.actor, g.id, m.id, m.revision, {
      state: 'REVOKED',
      memberRole: 'MEMBER',
    });
    await status(goals.read(bob.actor, c.id), 404);
    await status(submit(bob, c, 1), 404);
    const after = await goals.participants(carol.actor, c.id, { limit: 100 });
    expect(after.items.map((p) => p.userId)).toEqual([carol.actor.userId]);
    expect(
      (await goals.entries(carol.actor, c.id, { limit: 100 })).items,
    ).toHaveLength(0);
    expect(
      (await goals.read(carol.actor, c.id)).aggregate.participantCount,
    ).toBe(1);
    // Lists are context-scoped; another Group cannot enumerate this goal.
    const other = await group();
    expect(
      (
        await goals.list(alice.actor, {
          groupId: other.id,
          limit: 100,
          participation: 'ANY',
        })
      ).items,
    ).toHaveLength(0);
    await status(
      goals.list(dave.actor, {
        groupId: other.id,
        limit: 100,
        participation: 'ANY',
      }),
      404,
    );
  });

  it('withdrawal retracts pending reports, keeps approved progress, and allows rejoining', async () => {
    const g = await group(bob);
    const c = await create({ groupId: g.id }, { reviewRequired: true });
    await goals.join(bob.actor, c.id, key());
    await submit(bob, c, 2);
    const p = await mine(bob, c);
    await goals.entryAct(
      alice.actor,
      c.id,
      (await goals.entries(alice.actor, c.id, { limit: 10 })).items[0]!.id,
      'approve',
      {},
      1,
      key(),
    );
    await submit(bob, c, 3);
    await ok(
      goals.withdraw(bob.actor, c.id, p.revision, key()),
      'REVISION_CONFLICT',
    );
    const current = await mine(bob, c);
    const out = await goals.withdraw(bob.actor, c.id, current.revision, key());
    expect(out).toMatchObject({
      state: 'WITHDRAWN',
      approvedTotal: 2,
      pendingTotal: 0,
    });
    const states = (await goals.entries(bob.actor, c.id, { limit: 10 })).items
      .map((e) => e.state)
      .sort();
    expect(states).toEqual(['APPROVED', 'RETRACTED']);
    expect(
      (
        await goals.list(bob.actor, {
          groupId: g.id,
          limit: 10,
          participation: 'JOINED',
        })
      ).items,
    ).toHaveLength(0);
    const back = await goals.join(bob.actor, c.id, key());
    expect(back).toMatchObject({ state: 'ACTIVE', approvedTotal: 2 });
    expect(
      (
        await goals.list(bob.actor, {
          groupId: g.id,
          limit: 10,
          participation: 'JOINED',
        })
      ).items,
    ).toHaveLength(1);
  });

  it('concurrency and idempotency: no duplicate joins or double-counted retries', async () => {
    const g = await group(bob);
    const c = await create({ groupId: g.id }, { target: 100 });
    const joins = await Promise.allSettled([
      goals.join(bob.actor, c.id, key()),
      goals.join(bob.actor, c.id, key()),
      goals.join(bob.actor, c.id, key()),
    ]);
    expect(joins.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await db.socialGoalParticipant.count({ where: { goalId: c.id } }),
    ).toBe(1);
    const body = {
        id: randomUUID(),
        amount: 5,
        occurredOn: today(),
        note: null,
      },
      k = key();
    const [a, b] = await Promise.all([
      goals.submit(bob.actor, c.id, body, k),
      goals.submit(bob.actor, c.id, body, k),
    ]);
    expect(a).toEqual(b);
    await ok(goals.submit(bob.actor, c.id, body, key()), 'ENTRY_EXISTS');
    await ok(
      goals.submit(bob.actor, c.id, { ...body, amount: 6 }, k),
      'IDEMPOTENCY_CONFLICT',
    );
    const parallel = await Promise.all(
      Array.from({ length: 6 }, () => submit(bob, c, 1)),
    );
    expect(parallel).toHaveLength(6);
    expect((await mine(bob, c)).approvedTotal).toBe(11);
    const goal = await goals.read(alice.actor, c.id);
    await ok(
      goals.patch(alice.actor, c.id, { title: 'x' }, goal.revision + 1, key()),
      'REVISION_CONFLICT',
    );
    const patched = await goals.patch(
      alice.actor,
      c.id,
      { target: 11 },
      goal.revision,
      key(),
    );
    expect(patched.target).toBe(11);
    expect((await mine(bob, c)).completed).toBe(true);
  });

  it('dates use the goal time zone; windows bound joins and submissions', async () => {
    const g = await group(bob);
    const kiri = localDay(new Date(), 'Pacific/Kiritimati');
    const ahead = await create(
      { groupId: g.id },
      {
        timezone: 'Pacific/Kiritimati',
        startsOn: shift(kiri, -3),
        endsOn: shift(kiri, 3),
      },
    );
    const behind = await create(
      { groupId: g.id },
      {
        timezone: 'Pacific/Pago_Pago',
        startsOn: shift(kiri, -3),
        endsOn: shift(kiri, 3),
      },
    );
    await goals.join(bob.actor, ahead.id, key());
    await goals.join(bob.actor, behind.id, key());
    // "Today" in UTC+14 is still the future in UTC-11.
    expect((await submit(bob, ahead, 1, kiri)).state).toBe('APPROVED');
    await ok(submit(bob, behind, 1, kiri), 'OUTSIDE_WINDOW');
    await ok(submit(bob, ahead, 1, shift(kiri, -4)), 'OUTSIDE_WINDOW');
    const later = await create(
      { groupId: g.id },
      {
        startsOn: shift(today(), 2),
        endsOn: shift(today(), 4),
      },
    );
    expect(later.window).toBe('UPCOMING');
    await goals.join(bob.actor, later.id, key());
    await ok(submit(bob, later, 1, today()), 'WINDOW_NOT_OPEN');
    await ok(
      create(
        { groupId: g.id },
        { startsOn: shift(today(), -9), endsOn: shift(today(), -1) },
      ),
      'WINDOW_ENDED',
    );
    // Closing ends joins and submissions; pending entries remain reviewable.
    const closed = await goals.act(
      alice.actor,
      ahead.id,
      'close',
      (await goals.read(alice.actor, ahead.id)).revision,
      key(),
    );
    expect(closed).toMatchObject({ state: 'CLOSED' });
    expect(closed.closedAt).not.toBeNull();
    await ok(submit(bob, ahead, 1, kiri), 'GOAL_NOT_ACTIVE');
    await ok(
      goals.act(alice.actor, ahead.id, 'cancel', closed.revision, key()),
      'GOAL_NOT_ACTIVE',
    );
    expect(
      (await planning.notices(bob.actor, { limit: 100 })).items.map(
        (n) => n.kind,
      ),
    ).toContain('GOAL_ENDED');
  });

  it('account erasure detaches identity, retracts pending reports and keeps collective totals', async () => {
    const g = await group(bob, carol);
    const c = await create(
      { groupId: g.id },
      { kind: 'GOAL', target: 50, reviewRequired: true },
    );
    await goals.join(bob.actor, c.id, key());
    await goals.join(carol.actor, c.id, key());
    const e = await submit(bob, c, 8);
    await goals.entryAct(
      alice.actor,
      c.id,
      e.id,
      'approve',
      { note: 'fine' },
      1,
      key(),
    );
    await submit(bob, c, 4);
    await erase(bob);
    const p = await db.socialGoalParticipant.findMany({
      where: { goalId: c.id, userId: null },
    });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ state: 'WITHDRAWN' });
    const rows = await db.socialGoalEntry.findMany({ where: { goalId: c.id } });
    expect(
      rows.every((r) => r.submittedByUserId === null && r.note === null),
    ).toBe(true);
    expect(rows.map((r) => r.state).sort()).toEqual(['APPROVED', 'RETRACTED']);
    const view = await goals.read(carol.actor, c.id);
    expect(view.aggregate).toMatchObject({
      participantCount: 1,
      approvedTotal: 8,
    });
    const peers = await goals.participants(carol.actor, c.id, { limit: 100 });
    expect(peers.items.map((x) => x.userId)).toEqual([carol.actor.userId]);
    expect(
      await db.socialNotice.count({ where: { userId: bob.actor.userId } }),
    ).toBe(0);
  });

  it('strict HTTP contracts: auth, Origin, idempotency, overposting and ETags', async () => {
    const g = await group(bob);
    const login = await request_(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email: alice.email, password })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])
      .map((v) => v.split(';')[0])
      .join('; ');
    const body = {
      id: randomUUID(),
      kind: 'CHALLENGE',
      groupId: g.id,
      title: 'Read',
      unit: 'pages',
      target: 100,
      startsOn: today(),
      endsOn: shift(today(), 5),
      timezone: 'UTC',
    };
    await request_(app.getHttpServer())
      .get(`/api/v1/social-goals?groupId=${g.id}`)
      .expect(401);
    await request_(app.getHttpServer())
      .post('/api/v1/social-goals')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body)
      .expect(400);
    await request_(app.getHttpServer())
      .post('/api/v1/social-goals')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .send({ ...body, activityId: randomUUID() })
      .expect(400);
    await request_(app.getHttpServer())
      .post('/api/v1/social-goals')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .send({ ...body, rank: 1 })
      .expect(400);
    const created = await request_(app.getHttpServer())
      .post('/api/v1/social-goals')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .send(body)
      .expect(201);
    expect(created.headers['etag']).toBe('"1"');
    expect(created.headers['cache-control']).toBe('no-store');
    expect((created.body as Goal).reviewRequired).toBe(false);
    await request_(app.getHttpServer())
      .post(`/api/v1/social-goals/${body.id}/actions/close`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .send({})
      .expect(400);
    await request_(app.getHttpServer())
      .post(`/api/v1/social-goals/${body.id}/actions/close`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .set('If-Match', '"2"')
      .send({})
      .expect(409);
    const closed = await request_(app.getHttpServer())
      .post(`/api/v1/social-goals/${body.id}/actions/close`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .set('If-Match', '"1"')
      .send({})
      .expect(201);
    expect(closed.headers['etag']).toBe('"2"');
    const listed = await request_(app.getHttpServer())
      .get(`/api/v1/social-goals?groupId=${g.id}&state=CLOSED`)
      .set('Cookie', cookie)
      .expect(200);
    expect((listed.body as { items: Goal[] }).items.map((x) => x.id)).toEqual([
      body.id,
    ]);
  });
});
