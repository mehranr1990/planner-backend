import 'reflect-metadata';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { DatabaseService } from '../../src/platform/database/database.service.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import {
  SocialGroupsService,
  SocialActivitiesService,
  SocialPlanningService,
  SocialExpensesService,
  SocialData,
} from '../../src/modules/social/public/index.js';
import { MessagingService } from '../../src/modules/messaging/public/index.js';
import { SpacesService } from '../../src/modules/spaces/public/index.js';
import { LedgerService } from '../../src/modules/finance/application/ledger.service.js';
import { ExportBudget } from '../../src/platform/lifecycle/personal-data.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
type Person = { actor: RequestActor; email: string };
describe('P6-02 Activities and P6-03 shared expenses', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    db: PrismaClient,
    groups: SocialGroupsService,
    activities: SocialActivitiesService,
    planning: SocialPlanningService,
    expenses: SocialExpensesService,
    passwordHash: string;
  let alice: Person, bob: Person, carol: Person, dave: Person;
  const origin = 'http://localhost:3000',
    password = 'synthetic-activity-password-123!',
    version = 'activity-' + randomUUID(),
    page = { limit: 100 },
    key = () => randomUUID();
  const day = (d: string, h = '09:00') => `2030-${d}T${h}:00.000Z`;
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
  const base = {
    template: 'TRAVEL' as const,
    title: 'Private trip',
    description: 'Private plan',
    timezone: 'Asia/Tehran',
    startsAt: day('12-01'),
    endsAt: day('12-04'),
  };
  async function activity(
    extra: Partial<Parameters<SocialActivitiesService['create']>[1]> = {},
    who = alice,
  ) {
    return activities.create(
      who.actor,
      { id: randomUUID(), groupId: null, ...base, ...extra },
      key(),
    );
  }
  async function accept(
    id: string,
    who: Person,
    rsvp: 'GOING' | 'MAYBE' = 'MAYBE',
    inviter = alice,
  ) {
    await activities.invite(
      inviter.actor,
      id,
      { userId: who.actor.userId },
      key(),
    );
    return activities.rsvp(who.actor, id, { rsvp }, key());
  }
  async function group() {
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
    const offer = await groups.invite(
      alice.actor,
      g.id,
      {
        kind: 'MEMBERSHIP',
        memberRole: 'MEMBER',
        recipient: { userId: bob.actor.userId },
      },
      key(),
    );
    await groups.decideInvitation(
      bob.actor,
      offer.invitation.id,
      offer.proof!,
      1,
      true,
    );
    return g;
  }
  const status = (p: Promise<unknown>, code: number) =>
    expect(p).rejects.toMatchObject({ status: code });
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
        'Owned Activity schema migration failed; credentials withheld',
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
    const root = fs.mkdtempSync(path.resolve('.tools/p602-integration-'));
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P602-ONLY',
      },
    });
    await app.get(SharedControl).initialize();
    groups = app.get(SocialGroupsService);
    activities = app.get(SocialActivitiesService);
    planning = app.get(SocialPlanningService);
    expenses = app.get(SocialExpensesService);
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

  it('independent Activity works without a Group and requires explicit acceptance before content', async () => {
    const a = await activity();
    expect(a).toMatchObject({ groupId: null, manage: true, seatsTaken: 1 });
    expect(a.me).toMatchObject({
      role: 'ORGANIZER',
      rsvp: 'GOING',
      seat: 'HELD',
    });
    await activities.invite(
      alice.actor,
      a.id,
      { userId: bob.actor.userId },
      key(),
    );
    const mine = await activities.list(bob.actor, page);
    expect(mine.items.map((i) => [i.id, i.me?.state])).toEqual([
      [a.id, 'INVITED'],
    ]);
    expect(Object.keys(mine.items[0]!)).not.toContain('description');
    await status(activities.read(bob.actor, a.id), 403);
    await status(planning.items(bob.actor, a.id, page), 403);
    await status(activities.read(carol.actor, a.id), 404);
    await status(activities.join(bob.actor, a.id, key()), 404);
    const joined = await activities.rsvp(
      bob.actor,
      a.id,
      { rsvp: 'GOING' },
      key(),
    );
    expect(joined).toMatchObject({
      description: 'Private plan',
      seatsTaken: 2,
    });
    const people = await activities.participants(bob.actor, a.id, page);
    expect(people.items.map((p) => p.displayName).sort()).toEqual([
      'Alice',
      'Bob',
    ]);
    await status(activities.participants(carol.actor, a.id, page), 404);
    // Revocation wins over stored receipts and old authority.
    const bobRow = people.items.find((p) => p.userId === bob.actor.userId)!;
    await activities.remove(
      alice.actor,
      a.id,
      bobRow.id,
      bobRow.revision,
      key(),
    );
    await status(activities.read(bob.actor, a.id), 404);
    await status(
      activities.rsvp(bob.actor, a.id, { rsvp: 'GOING' }, key()),
      404,
    );
    await status(activities.join(bob.actor, a.id, key()), 404);
    // Declining an invitation grants no content authority.
    await activities.invite(
      alice.actor,
      a.id,
      { userId: carol.actor.userId },
      key(),
    );
    await activities.rsvp(carol.actor, a.id, { rsvp: 'DECLINED' }, key());
    await status(activities.read(carol.actor, a.id), 404);
  });

  it('Group Activity enforces Group authorization and limits guests to the invited Activity', async () => {
    const g = await group();
    await status(activity({ groupId: g.id }, carol), 404);
    const a = await activity({ groupId: g.id, capacity: 10 });
    expect(
      (await activities.list(bob.actor, { ...page, groupId: g.id })).items.map(
        (i) => i.id,
      ),
    ).toEqual([a.id]);
    await status(activities.list(carol.actor, { ...page, groupId: g.id }), 404);
    await status(activities.read(bob.actor, a.id), 403);
    await status(activities.join(carol.actor, a.id, key()), 404);
    const joined = await activities.join(bob.actor, a.id, key());
    expect(joined.me).toMatchObject({
      state: 'ACTIVE',
      rsvp: 'PENDING',
      guest: false,
    });
    expect((await activities.read(bob.actor, a.id)).manage).toBe(false);
    await status(
      activities.patch(bob.actor, a.id, { title: 'x' }, joined.revision, key()),
      403,
    );
    // A verified guest sees only this Activity, never the Group.
    const guest = await accept(a.id, carol, 'GOING');
    expect(guest.me).toMatchObject({ guest: true, seat: 'HELD' });
    expect((await activities.read(carol.actor, a.id)).id).toBe(a.id);
    await status(groups.read(carol.actor, g.id), 404);
    await status(groups.members(carol.actor, g.id, page), 404);
    await status(activities.list(carol.actor, { ...page, groupId: g.id }), 404);
    await status(
      expenses.list(carol.actor, { kind: 'GROUP', id: g.id }, page),
      404,
    );
    // Group Owner/Admin manage without joining; a non-participant admin cannot add content.
    const other = await activity({ groupId: g.id }, bob);
    const managed = await activities.read(alice.actor, other.id);
    expect(managed).toMatchObject({ manage: true, me: null });
    await status(
      planning.createItem(
        alice.actor,
        other.id,
        { id: randomUUID(), kind: 'CHECKLIST', title: 'x' },
        key(),
      ),
      403,
    );
  });

  it('RSVP, capacity, FIFO waitlist and twelve-hour offers stay consistent', async () => {
    const a = await activity({ capacity: 2 });
    await accept(a.id, bob, 'GOING');
    const waiting = await accept(a.id, carol, 'GOING');
    expect(waiting.me).toMatchObject({ seat: 'WAITLISTED', rsvp: 'PENDING' });
    expect(waiting).toMatchObject({ seatsTaken: 2, waitlistCount: 1 });
    const daveWait = await accept(a.id, dave, 'GOING');
    expect(daveWait.me?.seat).toBe('WAITLISTED');
    await status(
      activities.patch(alice.actor, a.id, { capacity: 1 }, a.revision, key()),
      409,
    );
    await activities.rsvp(bob.actor, a.id, { rsvp: 'MAYBE' }, key());
    const offered = await activities.read(carol.actor, a.id);
    expect(offered.me?.seat).toBe('OFFERED');
    const expires = Date.parse(offered.me!.offerExpiresAt!) - Date.now();
    expect(expires).toBeGreaterThan(11.9 * 3600000);
    expect(expires).toBeLessThanOrEqual(12 * 3600000 + 60000);
    const notices = await planning.notices(carol.actor, page);
    expect(notices.items.map((n) => n.kind)).toContain('SEAT_OFFERED');
    // An unclaimed offer expires; the place moves FIFO to the next person.
    await db.socialActivityParticipant.update({
      where: { id: offered.me!.participantId },
      data: { offerExpiresAt: new Date(Date.now() - 1000) },
    });
    const after = await activities.read(dave.actor, a.id);
    expect(after.me?.seat).toBe('OFFERED');
    expect((await activities.read(carol.actor, a.id)).me?.seat).toBe('NONE');
    const claimed = await activities.rsvp(
      dave.actor,
      a.id,
      { rsvp: 'GOING' },
      key(),
    );
    expect(claimed.me).toMatchObject({ seat: 'HELD', rsvp: 'GOING' });
    expect(claimed).toMatchObject({ seatsTaken: 2, waitlistCount: 0 });
    const closed = await activities.lifecycle(
      alice.actor,
      a.id,
      'close',
      claimed.revision,
      key(),
    );
    expect(closed.state).toBe('CLOSED');
    await status(
      activities.rsvp(carol.actor, a.id, { rsvp: 'GOING' }, key()),
      409,
    );
  });

  it('concurrent joins never exceed capacity', async () => {
    const a = await activity({ capacity: 2 });
    const people = [bob, carol, dave, await person(), await person()];
    for (const p of people)
      await activities.invite(
        alice.actor,
        a.id,
        { userId: p.actor.userId },
        key(),
      );
    const results = await Promise.allSettled(
      people.map((p) =>
        activities.rsvp(p.actor, a.id, { rsvp: 'GOING' }, key()),
      ),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const rows = await db.socialActivityParticipant.findMany({
      where: { activityId: a.id },
    });
    expect(rows.filter((r) => r.seat === 'HELD')).toHaveLength(2);
    expect(rows.filter((r) => r.seat === 'WAITLISTED')).toHaveLength(4);
  });

  it('polls and consented Free/Busy expose aggregates and busy-only intervals', async () => {
    const a = await activity();
    await accept(a.id, bob);
    await accept(a.id, carol);
    const poll = await planning.createPoll(
      alice.actor,
      a.id,
      {
        id: randomUUID(),
        kind: 'SCHEDULE',
        question: 'When?',
        multiple: true,
        options: [
          {
            id: randomUUID(),
            label: 'Early',
            startsAt: day('12-02'),
            endsAt: day('12-05'),
          },
          {
            id: randomUUID(),
            label: 'Late',
            startsAt: day('12-10'),
            endsAt: day('12-12'),
          },
        ],
      },
      key(),
    );
    const [early, late] = poll.options;
    await planning.vote(
      bob.actor,
      a.id,
      poll.id,
      { optionIds: [early!.id, late!.id] },
      key(),
    );
    const mine = await planning.vote(
      carol.actor,
      a.id,
      poll.id,
      { optionIds: [late!.id] },
      key(),
    );
    expect(mine.options.map((o) => o.votes)).toEqual([1, 2]);
    expect(mine.myOptionIds).toEqual([late!.id]);
    expect(JSON.stringify(mine)).not.toContain(bob.actor.userId);
    await status(
      planning.vote(
        dave.actor,
        a.id,
        poll.id,
        { optionIds: [late!.id] },
        key(),
      ),
      404,
    );
    const closed = await planning.closePoll(
      alice.actor,
      a.id,
      poll.id,
      { chosenOptionId: late!.id },
      poll.revision,
      key(),
    );
    expect(closed.state).toBe('CLOSED');
    expect((await activities.read(alice.actor, a.id)).startsAt).toBe(
      day('12-10'),
    );
    // Free/Busy: Bob's private calendar title never leaves Calendar.
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email: bob.email, password })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])
      .map((v) => v.split(';')[0])
      .join('; ');
    await request(app.getHttpServer())
      .post('/api/v1/calendar/events')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .send({
        title: 'Secret medical appointment',
        description: 'private',
        schedule: {
          kind: 'TIMED',
          timezone: 'UTC',
          localStart: '2030-12-11T08:00',
          localEnd: '2030-12-11T09:00',
        },
      })
      .expect(201);
    expect((await planning.busy(alice.actor, a.id)).items).toEqual([]);
    const shared = await planning.shareBusy(bob.actor, a.id, key());
    expect(shared.intervals).toEqual([
      { start: '2030-12-11T08:00:00.000Z', end: '2030-12-11T09:00:00.000Z' },
    ]);
    const visible = await planning.busy(carol.actor, a.id);
    expect(visible.items).toHaveLength(1);
    expect(JSON.stringify(visible)).not.toMatch(/Secret|medical|private/);
    await status(planning.busy(dave.actor, a.id), 404);
    await planning.revokeBusy(bob.actor, a.id, key());
    expect((await planning.busy(carol.actor, a.id)).items).toEqual([]);
  });

  it('multi-day itineraries use the Activity time zone and stay inside the schedule', async () => {
    const a = await activity();
    await accept(a.id, bob);
    const late = await planning.createItem(
      alice.actor,
      a.id,
      {
        id: randomUUID(),
        kind: 'ITINERARY',
        title: 'Night train',
        startsAt: '2030-12-01T21:00:00.000Z',
      },
      key(),
    );
    // 21:00Z on 1 Dec is 00:30 on 2 Dec in Tehran: second itinerary day.
    expect(late).toMatchObject({ localDate: '2030-12-02', dayIndex: 1 });
    await status(
      planning.createItem(
        alice.actor,
        a.id,
        {
          id: randomUUID(),
          kind: 'ITINERARY',
          title: 'x',
          startsAt: day('12-09'),
        },
        key(),
      ),
      422,
    );
    await status(
      planning.createItem(
        bob.actor,
        a.id,
        { id: randomUUID(), kind: 'AGENDA', title: 'x' },
        key(),
      ),
      403,
    );
    const item = await planning.createItem(
      bob.actor,
      a.id,
      { id: randomUUID(), kind: 'CHECKLIST', title: 'Pack tent' },
      key(),
    );
    const done = await planning.changeItem(
      alice.actor,
      a.id,
      item.id,
      { done: true },
      item.revision,
      key(),
    );
    expect(done.done).toBe(true);
    const task = await planning.task(bob.actor, a.id, item.id, key());
    expect(task.created).toBe(true);
    expect((await planning.task(bob.actor, a.id, item.id, key())).taskId).toBe(
      task.taskId,
    );
    expect(await db.task.count({ where: { id: task.taskId } })).toBe(1);
    await status(
      activities.patch(
        alice.actor,
        a.id,
        { endsAt: day('12-01', '12:00') },
        (await activities.read(alice.actor, a.id)).revision,
        key(),
      ),
      409,
    );
    const feed = await planning.calendarFeed(bob.actor, {
      from: day('11-30'),
      to: day('12-05'),
    });
    expect(feed.items.map((i) => i.kind).sort()).toEqual([
      'ACTIVITY',
      'ITINERARY',
    ]);
    await activities.reminder(bob.actor, a.id, { minutesBefore: 10080 }, key());
  });

  it('creation retries are idempotent and conflicting reuse is rejected', async () => {
    const k = key(),
      body = { id: randomUUID(), groupId: null, ...base };
    const first = await activities.create(alice.actor, body, k);
    expect(await activities.create(alice.actor, body, k)).toEqual(first);
    await expect(
      activities.create(alice.actor, { ...body, title: 'Changed' }, k),
    ).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_CONFLICT' },
    });
    await status(activities.create(alice.actor, body, key()), 409);
    expect(await db.socialActivity.count({ where: { id: body.id } })).toBe(1);
  });

  it('independent participant proposals stay pending until approval and splits reconcile exactly', async () => {
    const a = await activity();
    await accept(a.id, bob);
    await accept(a.id, carol);
    const ref = { kind: 'ACTIVITY' as const, id: a.id };
    const proposal = {
      title: 'Fuel',
      currency: 'USD',
      amountMinor: '100',
      payerUserId: bob.actor.userId,
      method: 'EQUAL' as const,
      incurredOn: '2030-12-01',
      shares: [alice, bob, carol].map((p) => ({ userId: p.actor.userId })),
    };
    const e = await expenses.create(
      bob.actor,
      ref,
      { id: randomUUID(), ...proposal },
      key(),
    );
    expect(e).toMatchObject({
      state: 'PENDING',
      effective: null,
      canDecide: false,
    });
    expect((await expenses.balances(bob.actor, ref, false)).items).toEqual([]);
    await status(
      expenses.decide(bob.actor, ref, e.id, 'approve', {}, e.revision, key()),
      403,
    );
    await status(
      expenses.create(
        dave.actor,
        ref,
        { id: randomUUID(), ...proposal },
        key(),
      ),
      404,
    );
    const approved = await expenses.decide(
      alice.actor,
      ref,
      e.id,
      'approve',
      {},
      e.revision,
      key(),
    );
    expect(approved.effective!.shares.map((s) => s.shareMinor)).toEqual([
      '33',
      '34',
      '33',
    ]);
    const mine = await expenses.read(carol.actor, ref, e.id);
    expect(mine.effective).toMatchObject({ sharesRestricted: true });
    expect(mine.effective!.shares).toEqual([
      expect.objectContaining({ userId: carol.actor.userId, shareMinor: '33' }),
    ]);
    expect((await expenses.balances(carol.actor, ref, false)).items).toEqual([
      expect.objectContaining({
        userId: carol.actor.userId,
        owedMinor: '33',
        receivableMinor: '0',
      }),
    ]);
    await status(expenses.balances(carol.actor, ref, true), 403);
    const all = await expenses.balances(alice.actor, ref, true);
    expect(all.items.reduce((t, r) => t + BigInt(r.netMinor), 0n)).toBe(0n);
    expect(all.items.find((r) => r.userId === bob.actor.userId)).toMatchObject({
      receivableMinor: '66',
      displayName: 'Bob',
    });
    await status(expenses.read(dave.actor, ref, e.id), 404);
    await status(
      expenses.create(
        bob.actor,
        ref,
        {
          id: randomUUID(),
          ...proposal,
          shares: [{ userId: dave.actor.userId }],
        },
        key(),
      ),
      422,
    );
    await status(
      expenses.create(
        bob.actor,
        ref,
        {
          id: randomUUID(),
          ...proposal,
          method: 'FIXED',
          shares: [{ userId: alice.actor.userId, value: '99' }],
        },
        key(),
      ),
      422,
    );
  });

  it('concurrent approvals apply once and pending corrections preserve effective balances', async () => {
    const a = await activity();
    const joined = await accept(a.id, bob);
    await activities.role(
      alice.actor,
      a.id,
      joined.me!.participantId,
      { role: 'ORGANIZER' },
      joined.me!.revision,
      key(),
    );
    const ref = { kind: 'ACTIVITY' as const, id: a.id };
    const e = await expenses.create(
      alice.actor,
      ref,
      {
        id: randomUUID(),
        title: 'Hotel',
        currency: 'EUR',
        amountMinor: '1000',
        payerUserId: alice.actor.userId,
        method: 'PERCENT',
        incurredOn: '2030-12-01',
        shares: [
          { userId: alice.actor.userId, value: '5000' },
          { userId: bob.actor.userId, value: '5000' },
        ],
      },
      key(),
    );
    const outcomes = await Promise.allSettled([
      expenses.decide(alice.actor, ref, e.id, 'approve', {}, e.revision, key()),
      expenses.decide(bob.actor, ref, e.id, 'approve', {}, e.revision, key()),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((o) => o.status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    });
    expect(
      await db.socialExpenseRevision.count({
        where: { expenseId: e.id, state: 'APPROVED' },
      }),
    ).toBe(1);
    const before = await expenses.balances(bob.actor, ref, false);
    expect(before.items[0]).toMatchObject({ owedMinor: '500' });
    const current = await expenses.read(alice.actor, ref, e.id);
    const corrected = await expenses
      .revise(
        bob.actor,
        ref,
        e.id,
        {
          title: 'Hotel',
          currency: 'EUR',
          amountMinor: '1200',
          payerUserId: alice.actor.userId,
          method: 'EQUAL',
          incurredOn: '2030-12-01',
          shares: [
            { userId: alice.actor.userId },
            { userId: bob.actor.userId },
          ],
        },
        current.revision,
        key(),
      )
      .catch((x: unknown) => x);
    // Only the proposer or an approver may correct; Bob is now an organizer/approver.
    expect(corrected).toMatchObject({
      pending: { amountMinor: '1200' },
      effective: { amountMinor: '1000' },
    });
    expect(await expenses.balances(bob.actor, ref, false)).toEqual(before);
    const rejected = await expenses.decide(
      alice.actor,
      ref,
      e.id,
      'reject',
      { note: 'No' },
      (corrected as { revision: number }).revision,
      key(),
    );
    expect(rejected).toMatchObject({
      state: 'APPROVED',
      pending: null,
      effective: { amountMinor: '1000' },
    });
    expect(await expenses.balances(bob.actor, ref, false)).toEqual(before);
    const history = await expenses.history(alice.actor, ref, e.id);
    expect(history.items.map((r) => r.state)).toEqual(['APPROVED', 'REJECTED']);
  });

  it('settlements require counterparty confirmation and repeated requests never duplicate effects', async () => {
    const a = await activity();
    await accept(a.id, bob);
    await accept(a.id, carol);
    const ref = { kind: 'ACTIVITY' as const, id: a.id };
    const e = await expenses.create(
      alice.actor,
      ref,
      {
        id: randomUUID(),
        title: 'Dinner',
        currency: 'IRR',
        amountMinor: '300000',
        payerUserId: alice.actor.userId,
        method: 'WEIGHTED',
        incurredOn: '2030-12-02',
        shares: [
          { userId: alice.actor.userId, value: '1' },
          { userId: bob.actor.userId, value: '2' },
        ],
      },
      key(),
    );
    await expenses.decide(
      alice.actor,
      ref,
      e.id,
      'approve',
      {},
      e.revision,
      key(),
    );
    const k = key(),
      body = {
        id: randomUUID(),
        payeeUserId: alice.actor.userId,
        currency: 'IRR',
        amountMinor: '200000',
      };
    const s = await expenses.settle(bob.actor, ref, body, k);
    expect(await expenses.settle(bob.actor, ref, body, k)).toEqual(s);
    expect(
      await db.socialSettlement.count({ where: { activityId: a.id } }),
    ).toBe(1);
    expect(
      (await expenses.balances(bob.actor, ref, false)).items[0],
    ).toMatchObject({ owedMinor: '200000' });
    await status(
      expenses.decideSettlement(
        bob.actor,
        ref,
        s.id,
        'confirm',
        {},
        s.revision,
        key(),
      ),
      403,
    );
    await status(
      expenses.decideSettlement(
        carol.actor,
        ref,
        s.id,
        'confirm',
        {},
        s.revision,
        key(),
      ),
      404,
    );
    await status(
      expenses.decideSettlement(
        alice.actor,
        ref,
        s.id,
        'dispute',
        {},
        s.revision,
        key(),
      ),
      422,
    );
    const disputed = await expenses.decideSettlement(
      alice.actor,
      ref,
      s.id,
      'dispute',
      { note: 'Not received' },
      s.revision,
      key(),
    );
    expect(disputed).toMatchObject({
      state: 'DISPUTED',
      disputeNote: 'Not received',
    });
    const ck = key();
    const confirmed = await expenses.decideSettlement(
      alice.actor,
      ref,
      s.id,
      'confirm',
      {},
      disputed.revision,
      ck,
    );
    expect(
      await expenses.decideSettlement(
        alice.actor,
        ref,
        s.id,
        'confirm',
        {},
        disputed.revision,
        ck,
      ),
    ).toEqual(confirmed);
    await status(
      expenses.decideSettlement(
        alice.actor,
        ref,
        s.id,
        'confirm',
        {},
        confirmed.revision,
        key(),
      ),
      409,
    );
    expect(
      (await expenses.balances(bob.actor, ref, false)).items[0],
    ).toMatchObject({ owedMinor: '0', netMinor: '0' });
    expect((await expenses.settlements(carol.actor, ref, page)).items).toEqual(
      [],
    );
  });

  it('Group-level expenses use Group membership and Owner/Admin approval', async () => {
    const g = await group();
    const ref = { kind: 'GROUP' as const, id: g.id };
    const e = await expenses.create(
      bob.actor,
      ref,
      {
        id: randomUUID(),
        title: 'Supplies',
        currency: 'USD',
        amountMinor: '7',
        payerUserId: bob.actor.userId,
        method: 'EQUAL',
        incurredOn: '2030-01-01',
        shares: [{ userId: alice.actor.userId }, { userId: bob.actor.userId }],
      },
      key(),
    );
    await status(
      expenses.decide(bob.actor, ref, e.id, 'approve', {}, e.revision, key()),
      403,
    );
    await status(expenses.list(carol.actor, ref, page), 404);
    const ok = await expenses.decide(
      alice.actor,
      ref,
      e.id,
      'approve',
      {},
      e.revision,
      key(),
    );
    expect(ok.effective!.shares.map((s) => s.shareMinor)).toEqual(['3', '4']);
    expect(
      (await planning.notices(bob.actor, page)).items.map((n) => n.kind),
    ).toContain('EXPENSE_DECIDED');
  });

  it('erasure detaches identity while keeping remaining ledgers reconcilable', async () => {
    const a = await activity();
    await accept(a.id, bob, 'GOING');
    const ref = { kind: 'ACTIVITY' as const, id: a.id };
    const e = await expenses.create(
      alice.actor,
      ref,
      {
        id: randomUUID(),
        title: 'Taxi',
        currency: 'USD',
        amountMinor: '10',
        payerUserId: alice.actor.userId,
        method: 'EQUAL',
        incurredOn: '2030-12-01',
        shares: [{ userId: alice.actor.userId }, { userId: bob.actor.userId }],
      },
      key(),
    );
    await expenses.decide(
      alice.actor,
      ref,
      e.id,
      'approve',
      {},
      e.revision,
      key(),
    );
    const data = app.get(SocialData);
    const space = await db.space.findFirstOrThrow({
      where: { ownerUserId: bob.actor.userId },
    });
    const scope = { actor: bob.actor, spaceId: space.id } as never;
    const budget = new ExportBudget();
    await db.$transaction((tx) => data.snapshot(tx, scope, budget));
    await db.$transaction((tx) => data.erase(tx, scope));
    expect(
      await db.socialActivityParticipant.count({
        where: { userId: bob.actor.userId },
      }),
    ).toBe(0);
    expect(
      await db.socialExpenseShare.count({
        where: { userId: bob.actor.userId },
      }),
    ).toBe(0);
    const remaining = await expenses.balances(alice.actor, ref, true);
    expect(remaining.items).toEqual([
      expect.objectContaining({
        userId: alice.actor.userId,
        receivableMinor: '5',
      }),
    ]);
  });

  it('strict HTTP contracts require Origin, idempotency and reject overposting', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email: alice.email, password })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])
      .map((v) => v.split(';')[0])
      .join('; ');
    const body = { id: randomUUID(), ...base };
    await request(app.getHttpServer())
      .get('/api/v1/social-activities')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/social-activities')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body)
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/social-activities')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .send({ ...body, createdByUserId: bob.actor.userId })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/social-activities')
      .set('Cookie', cookie)
      .set('Origin', 'https://untrusted.example')
      .set('Idempotency-Key', key())
      .send(body)
      .expect(403);
    const created = await request(app.getHttpServer())
      .post('/api/v1/social-activities')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .send(body)
      .expect(201);
    expect(created.headers['etag']).toBe('"1"');
    expect(created.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer())
      .post(`/api/v1/social-activities/${body.id}/expenses`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .send({
        id: randomUUID(),
        title: 'x',
        currency: 'USD',
        amountMinor: '1.5',
        payerUserId: alice.actor.userId,
        method: 'EQUAL',
        incurredOn: '2030-01-01',
        shares: [{ userId: alice.actor.userId }],
      })
      .expect(400);
  });

  describe('ADR 0060-0062 gap closure', () => {
    const ref = (id: string) => ({ kind: 'ACTIVITY' as const, id });
    async function shared(amountMinor = '100') {
      const a = await activity();
      await accept(a.id, bob);
      await accept(a.id, carol);
      const e = await expenses.create(
        alice.actor,
        ref(a.id),
        {
          id: randomUUID(),
          title: 'Cabin',
          currency: 'USD',
          amountMinor,
          payerUserId: alice.actor.userId,
          method: 'EQUAL',
          incurredOn: '2030-12-01',
          shares: [alice, bob, carol].map((p) => ({ userId: p.actor.userId })),
        },
        key(),
      );
      return {
        a,
        e: await expenses.decide(
          alice.actor,
          ref(a.id),
          e.id,
          'approve',
          {},
          e.revision,
          key(),
        ),
      };
    }
    it('organizer succession needs nomination and the nominee consent', async () => {
      const a = await activity();
      const bobView = await accept(a.id, bob);
      await accept(a.id, carol);
      await status(activities.leave(alice.actor, a.id, key()), 409);
      await status(
        activities.nominate(
          alice.actor,
          a.id,
          { participantId: randomUUID() },
          a.revision,
          key(),
        ),
        422,
      );
      const nominated = await activities.nominate(
        alice.actor,
        a.id,
        { participantId: bobView.me!.participantId },
        a.revision,
        key(),
      );
      expect(nominated.successorParticipantId).toBe(bobView.me!.participantId);
      await status(
        activities.succession(
          carol.actor,
          a.id,
          'accept',
          nominated.revision,
          key(),
        ),
        404,
      );
      await status(
        activities.nominate(
          bob.actor,
          a.id,
          { participantId: bobView.me!.participantId },
          nominated.revision,
          key(),
        ),
        403,
      );
      const accepted = await activities.succession(
        bob.actor,
        a.id,
        'accept',
        nominated.revision,
        key(),
      );
      expect(accepted).toMatchObject({
        successorParticipantId: null,
        manage: true,
      });
      expect(accepted.me?.role).toBe('ORGANIZER');
      await activities.leave(alice.actor, a.id, key());
      expect((await activities.read(bob.actor, a.id)).orphanedAt).toBeNull();
    });
    it('erasing the last organizer closes an independent Activity without promoting anyone', async () => {
      const { a, e } = await shared();
      const data = app.get(SocialData);
      const space = await db.space.findFirstOrThrow({
        where: { ownerUserId: alice.actor.userId },
      });
      await db.$transaction((tx) =>
        data.erase(tx, { actor: alice.actor, spaceId: space.id } as never),
      );
      const after = await activities.read(bob.actor, a.id);
      expect(after).toMatchObject({ state: 'CLOSED', manage: false });
      expect(after.orphanedAt).not.toBeNull();
      expect(
        await db.socialActivityParticipant.count({
          where: { activityId: a.id, role: 'ORGANIZER', userId: { not: null } },
        }),
      ).toBe(0);
      expect(
        (await expenses.read(bob.actor, ref(a.id), e.id)).effective!
          .amountMinor,
      ).toBe('100');
      expect(
        (await expenses.balances(bob.actor, ref(a.id), false)).items[0],
      ).toMatchObject({ owedMinor: '33' });
    });
    it('deleted content is recoverable for 30 days while financial records stay', async () => {
      const { a, e } = await shared();
      const item = await planning.createItem(
        bob.actor,
        a.id,
        { id: randomUUID(), kind: 'CHECKLIST', title: 'Rope' },
        key(),
      );
      const removedItem = await planning.changeItem(
        bob.actor,
        a.id,
        item.id,
        null,
        item.revision,
        key(),
      );
      expect((await planning.items(bob.actor, a.id, page)).items).toEqual([]);
      const restored = await planning.restoreItem(
        bob.actor,
        a.id,
        item.id,
        removedItem.revision,
        key(),
      );
      expect(restored.id).toBe(item.id);
      const now = await activities.read(alice.actor, a.id);
      await status(
        activities.deleteActivity(bob.actor, a.id, now.revision, key()),
        403,
      );
      const deleted = await activities.deleteActivity(
        alice.actor,
        a.id,
        now.revision,
        key(),
      );
      expect(deleted.state).toBe('DELETED');
      expect(
        Date.parse(deleted.recoverUntil!) - Date.parse(deleted.deletedAt!),
      ).toBe(30 * 86400000);
      await status(activities.read(bob.actor, a.id), 404);
      await status(planning.items(bob.actor, a.id, page), 404);
      expect((await expenses.read(bob.actor, ref(a.id), e.id)).state).toBe(
        'APPROVED',
      );
      const back = await activities.restore(
        alice.actor,
        a.id,
        deleted.revision,
        key(),
      );
      expect(back).toMatchObject({ state: 'PLANNED', deletedAt: null });
      expect((await planning.items(bob.actor, a.id, page)).items).toHaveLength(
        1,
      );
      // Controlled time: move the recovery deadline into the past.
      const again = await activities.deleteActivity(
        alice.actor,
        a.id,
        back.revision,
        key(),
      );
      await db.socialActivity.update({
        where: { id: a.id },
        data: { recoverUntil: new Date(Date.now() - 1000) },
      });
      await status(
        activities.restore(alice.actor, a.id, again.revision, key()),
        409,
      );
      expect(
        await db.socialActivityItem.count({ where: { activityId: a.id } }),
      ).toBe(0);
      expect(
        (await db.socialActivity.findUniqueOrThrow({ where: { id: a.id } }))
          .contentDisposedAt,
      ).not.toBeNull();
      expect(
        await db.socialExpenseRevision.count({ where: { expenseId: e.id } }),
      ).toBe(1);
      expect(
        (await expenses.balances(bob.actor, ref(a.id), false)).items[0],
      ).toMatchObject({ owedMinor: '33' });
    });
    it('Personal Finance posting is explicit, Finance-validated and never duplicated', async () => {
      const { a, e } = await shared();
      const ledger = app.get(LedgerService),
        scope = await app.get(SpacesService).authorizePersonal(bob.actor);
      const usd = await ledger.createAccount(scope, key(), {
        name: 'Wallet',
        currency: 'USD',
      });
      const eur = await ledger.createAccount(scope, key(), {
        name: 'Euro',
        currency: 'EUR',
      });
      const category = await ledger.createCategory(scope, key(), {
        name: 'Trips',
        kind: 'EXPENSE',
        position: 0,
      });
      const count = () =>
        db.transaction.count({ where: { spaceId: scope.spaceId } });
      const before = await count();
      const preview = await expenses.financePreview(
        bob.actor,
        ref(a.id),
        e.id,
        {
          accountId: usd.id,
          categoryId: category.id,
        },
      );
      expect(preview).toMatchObject({
        amountMinor: '33',
        amount: '0.33',
        currency: 'USD',
        transactionType: 'EXPENSE',
        alreadyPosted: null,
      });
      expect(await count()).toBe(before);
      await status(
        expenses.financePreview(bob.actor, ref(a.id), e.id, {
          accountId: eur.id,
          categoryId: null,
        }),
        422,
      );
      await status(
        expenses.financePreview(dave.actor, ref(a.id), e.id, {
          accountId: usd.id,
          categoryId: null,
        }),
        404,
      );
      const body = {
        accountId: usd.id,
        categoryId: category.id,
        revisionId: preview.revisionId,
        confirm: true as const,
      };
      const posted = await expenses.financePost(
        bob.actor,
        ref(a.id),
        e.id,
        body,
        key(),
      );
      expect(posted.created).toBe(true);
      const repeat = await expenses.financePost(
        bob.actor,
        ref(a.id),
        e.id,
        body,
        key(),
      );
      expect(repeat).toMatchObject({
        created: false,
        transactionId: posted.transactionId,
      });
      expect(await count()).toBe(before + 1);
      const tx = await db.transaction.findUniqueOrThrow({
        where: { id: posted.transactionId },
      });
      expect(tx.type).toBe('EXPENSE');
      const aliceSpace = await db.space.findFirstOrThrow({
        where: { ownerUserId: alice.actor.userId },
      });
      expect(
        await db.transaction.count({ where: { spaceId: aliceSpace.id } }),
      ).toBe(0);
      // A later approved revision never rewrites the posting and needs a new review.
      const cur = await expenses.read(alice.actor, ref(a.id), e.id);
      const revised = await expenses.revise(
        alice.actor,
        ref(a.id),
        e.id,
        {
          title: 'Cabin',
          currency: 'USD',
          amountMinor: '300',
          payerUserId: alice.actor.userId,
          method: 'EQUAL',
          incurredOn: '2030-12-01',
          shares: [alice, bob, carol].map((p) => ({ userId: p.actor.userId })),
        },
        cur.revision,
        key(),
      );
      await expenses.decide(
        alice.actor,
        ref(a.id),
        e.id,
        'approve',
        {},
        revised.revision,
        key(),
      );
      expect(
        (
          await db.transaction.findUniqueOrThrow({
            where: { id: posted.transactionId },
          })
        ).revision,
      ).toBe(tx.revision);
      await status(
        expenses.financePost(bob.actor, ref(a.id), e.id, body, key()),
        409,
      );
      const later = await expenses.financePreview(bob.actor, ref(a.id), e.id, {
        accountId: usd.id,
        categoryId: null,
      });
      expect(later.alreadyPosted).toEqual({
        transactionId: posted.transactionId,
        revisionId: preview.revisionId,
      });
    });
    it('Activity chat admits only current accepted participants with join-time history', async () => {
      const a = await activity();
      await accept(a.id, bob);
      await activities.invite(
        alice.actor,
        a.id,
        { userId: carol.actor.userId },
        key(),
      );
      const messaging = app.get(MessagingService);
      await status(
        activities.openConversation(
          bob.actor,
          a.id,
          { id: randomUUID(), retentionPolicyVersion: version },
          a.revision,
          key(),
        ),
        403,
      );
      const opened = await activities.openConversation(
        alice.actor,
        a.id,
        { id: randomUUID(), retentionPolicyVersion: version },
        a.revision,
        key(),
      );
      expect(opened.conversationManaged).toBe(true);
      const conversationId = opened.conversationId!;
      await status(
        activities.conversation(
          alice.actor,
          a.id,
          { conversationId: null },
          opened.revision,
          key(),
        ),
        409,
      );
      await messaging.send(
        alice.actor,
        conversationId,
        { id: randomUUID(), text: 'Before Bob joined' },
        key(),
      );
      await status(messaging.get(bob.actor, conversationId), 404);
      await activities.joinConversation(bob.actor, a.id, key());
      expect((await messaging.get(bob.actor, conversationId)).id).toBe(
        conversationId,
      );
      expect(
        (await messaging.messages(bob.actor, conversationId, { limit: 50 }))
          .items,
      ).toEqual([]);
      await messaging.send(
        bob.actor,
        conversationId,
        { id: randomUUID(), text: 'Hello' },
        key(),
      );
      await status(activities.joinConversation(carol.actor, a.id, key()), 404);
      await status(messaging.get(carol.actor, conversationId), 404);
      // Removal revokes every later read and send through the Messaging guard.
      const bobRow = (
        await activities.participants(alice.actor, a.id, page)
      ).items.find((p) => p.userId === bob.actor.userId)!;
      await activities.remove(
        alice.actor,
        a.id,
        bobRow.id,
        bobRow.revision,
        key(),
      );
      await status(messaging.get(bob.actor, conversationId), 404);
      await status(
        messaging.messages(bob.actor, conversationId, { limit: 50 }),
        404,
      );
      await status(
        messaging.send(
          bob.actor,
          conversationId,
          { id: randomUUID(), text: 'x' },
          key(),
        ),
        404,
      );
      expect(
        (await messaging.list(bob.actor, { limit: 50 })).items.map((c) => c.id),
      ).not.toContain(conversationId);
      expect(
        (await messaging.messages(alice.actor, conversationId, { limit: 50 }))
          .items,
      ).toHaveLength(2);
    });
  });
});
