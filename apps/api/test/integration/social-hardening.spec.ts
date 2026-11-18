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
  SocialExpensesService,
  SocialPlanningService,
  SocialLifecycle,
  SocialData,
} from '../../src/modules/social/public/index.js';
import { SocialGroupExitService } from '../../src/modules/social/application/group-exit.service.js';
import { ExportBudget } from '../../src/platform/lifecycle/personal-data.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
type Person = { actor: RequestActor; email: string };
type Ref = { kind: 'GROUP' | 'ACTIVITY'; id: string };
describe('P6-06 Social hardening: deletion, recovery, departure, erasure', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    db: PrismaClient,
    groups: SocialGroupsService,
    activities: SocialActivitiesService,
    expenses: SocialExpensesService,
    planning: SocialPlanningService,
    exit: SocialGroupExitService,
    passwordHash: string;
  let alice: Person, bob: Person, carol: Person, dave: Person;
  const origin = 'http://localhost:3000',
    password = 'synthetic-hardening-password-123!',
    version = 'hardening-' + randomUUID(),
    page = { limit: 100 },
    key = () => randomUUID();
  async function person(name: string): Promise<Person> {
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
  async function seat(groupId: string, who: Person) {
    const actor = await db.sharedActor.findFirstOrThrow({
      where: { spaceId: groupId, userId: who.actor.userId },
    });
    return db.contextAccess.findFirstOrThrow({
      where: { spaceId: groupId, actorId: actor.id, scopeId: groupId },
    });
  }
  function activity(groupId: string | null, title = 'Private trip') {
    return activities.create(
      alice.actor,
      {
        id: randomUUID(),
        groupId,
        template: 'TRAVEL',
        title,
        description: 'Private plan',
        timezone: 'UTC',
        startsAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        endsAt: new Date(Date.now() + 33 * 86400000).toISOString(),
      },
      key(),
    );
  }
  async function attend(activityId: string, who: Person) {
    await activities.invite(
      alice.actor,
      activityId,
      { userId: who.actor.userId },
      key(),
    );
    await activities.rsvp(who.actor, activityId, { rsvp: 'GOING' }, key());
  }
  function propose(
    who: Person,
    ref: Ref,
    amountMinor: string,
    shares: Person[],
    title = 'Shared dinner',
  ) {
    return expenses.create(
      who.actor,
      ref,
      {
        id: randomUUID(),
        title,
        note: 'private note',
        currency: 'USD',
        amountMinor,
        payerUserId: alice.actor.userId,
        method: 'EQUAL',
        incurredOn: '2030-12-01',
        shares: shares.map((p) => ({ userId: p.actor.userId })),
      },
      key(),
    );
  }
  async function approved(ref: Ref, amountMinor: string, shares: Person[]) {
    const e = await propose(bob, ref, amountMinor, shares);
    return expenses.decide(
      alice.actor,
      ref,
      e.id,
      'approve',
      {},
      e.revision,
      key(),
    );
  }
  const status = (p: Promise<unknown>, code: number) =>
    expect(p).rejects.toMatchObject({ status: code });
  const reason = (p: Promise<unknown>, code: string) =>
    expect(p).rejects.toMatchObject({ response: { code } });
  async function denied(p: Promise<unknown>) {
    const e = (await p.then(
      () => null,
      (error: unknown) => error,
    )) as { status?: number } | null;
    expect([403, 404]).toContain(e?.status);
  }
  async function erase(who: Person) {
    const data = app.get(SocialData);
    const space = await db.space.findFirstOrThrow({
      where: { ownerUserId: who.actor.userId },
    });
    const scope = { actor: who.actor, spaceId: space.id } as never;
    await db.$transaction((tx) => data.erase(tx, scope));
  }
  async function snapshot(who: Person) {
    const data = app.get(SocialData);
    const space = await db.space.findFirstOrThrow({
      where: { ownerUserId: who.actor.userId },
    });
    const budget = new ExportBudget();
    await db.$transaction((tx) =>
      data.snapshot(
        tx,
        { actor: who.actor, spaceId: space.id } as never,
        budget,
      ),
    );
    return budget.sections;
  }
  async function drain() {
    const worker = app.get(SocialLifecycle);
    for (let i = 0; i < 80; i++) if (!(await worker.consume())) return;
    throw Error('Social cleanup did not settle');
  }
  async function expire(groupId: string) {
    // The 720-hour window is a CHECK invariant; shift the whole window back.
    await db.$executeRaw`UPDATE "SharedLifecycleJob" SET "effectiveDepartureAt"="effectiveDepartureAt"-interval '721 hours',"recoveryDeadline"="recoveryDeadline"-interval '721 hours',"nextAt"=clock_timestamp()-interval '1 minute' WHERE "custodyId"=${groupId}::uuid AND state='CLOSING_GRACE'`;
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
    const root = fs.mkdtempSync(path.resolve('.tools/p606-integration-'));
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P606-ONLY',
      },
    });
    await app.get(SharedControl).initialize();
    groups = app.get(SocialGroupsService);
    activities = app.get(SocialActivitiesService);
    expenses = app.get(SocialExpensesService);
    planning = app.get(SocialPlanningService);
    exit = app.get(SocialGroupExitService);
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

  it('Owner deletion revokes every member; 30-day recovery restores only the Owner', async () => {
    const g = await group(bob, carol);
    const independent = await activity(null);
    await attend(independent.id, bob);
    // Only the primary Owner may delete; members and outsiders cannot.
    await denied(exit.delete(bob.actor, g.id, g.revision, { password }));
    await denied(exit.delete(dave.actor, g.id, g.revision, { password }));
    await status(
      exit.delete(alice.actor, g.id, g.revision + 5, { password }),
      409,
    );
    await expect(
      exit.delete(alice.actor, g.id, g.revision, {
        password: 'wrong-password',
      }),
    ).rejects.toBeDefined();
    const deleted = await exit.delete(alice.actor, g.id, g.revision, {
      password,
    });
    expect(deleted).toMatchObject({ id: g.id, groupId: g.id });
    expect((await seat(g.id, bob)).state).toBe('REVOKED');
    expect((await seat(g.id, carol)).state).toBe('REVOKED');
    expect((await seat(g.id, alice)).state).toBe('LEFT');
    // The deleted Group is unusable for everyone, including its Owner.
    for (const who of [alice, bob, carol])
      await denied(groups.read(who.actor, g.id));
    await denied(activity(g.id));
    await denied(exit.job(bob.actor, g.id));
    // Leaving the Group never touches an unrelated independent Activity.
    expect((await activities.read(bob.actor, independent.id)).id).toBe(
      independent.id,
    );
    const job = c(await exit.job(alice.actor, g.id));
    expect(job.state).toBe('CLOSING_GRACE');
    const window = Date.parse(job.recoveryDeadline) - Date.now();
    expect(window).toBeGreaterThan(30 * 86400000 - 120000);
    expect(window).toBeLessThanOrEqual(30 * 86400000);
    // A revoked member cannot obtain a recovery proof or restore.
    await denied(exit.proof(bob.actor, g.id, job.revision, password));
    const proof = await exit.proof(alice.actor, g.id, job.revision, password);
    await denied(
      exit.recover(
        bob.actor,
        g.id,
        proof.revision,
        proof.generation,
        proof.proof,
        password,
      ),
    );
    const restored = await exit.recover(
      alice.actor,
      g.id,
      proof.revision,
      proof.generation,
      proof.proof,
      password,
    );
    expect(restored.state).toBe('CANCELED');
    expect((await groups.read(alice.actor, g.id)).state).toBe('ACTIVE');
    // No restore-driven privilege resurrection: members need new admission.
    await denied(groups.read(bob.actor, g.id));
    expect((await seat(g.id, bob)).state).toBe('REVOKED');
    const members = await groups.members(alice.actor, g.id, page);
    expect(members.items.map((m) => m.actorId)).toEqual([
      (await seat(g.id, alice)).actorId,
    ]);
    // A replayed proof cannot restore twice.
    await expect(
      exit.recover(
        alice.actor,
        g.id,
        proof.revision,
        proof.generation,
        proof.proof,
        password,
      ),
    ).rejects.toBeDefined();
  });

  it('refuses recovery after the deadline; the idempotent purge fails closed for protected records', async () => {
    const held = await group(bob),
      plain = await group(bob);
    await approved({ kind: 'GROUP', id: held.id }, '900', [bob]);
    const check = await exit.check(alice.actor, held.id);
    await exit.delete(alice.actor, held.id, check.deletion!.groupRevision, {
      password,
      outstandingBalanceConfirmation: check.deletion!.confirmation!,
    });
    await exit.delete(alice.actor, plain.id, plain.revision, { password });
    // Nothing is disposable inside the recovery window.
    await drain();
    expect(await db.socialGroup.count({ where: { id: plain.id } })).toBe(1);
    await expire(held.id);
    await expire(plain.id);
    const job = c(await exit.job(alice.actor, held.id));
    await reason(
      exit.proof(alice.actor, held.id, job.revision, password),
      'RECOVERY_UNAVAILABLE',
    );
    await drain();
    await drain(); // restart/retry: no duplicate destructive effect
    // Eligible content without protected records is disposed of.
    expect(await db.socialGroup.count({ where: { id: plain.id } })).toBe(0);
    expect(await db.sharedCustody.count({ where: { spaceId: plain.id } })).toBe(
      0,
    );
    expect(
      (
        await db.sharedLifecycleJob.findFirstOrThrow({
          where: { custodyId: plain.id },
        })
      ).state,
    ).toBe('DELETED');
    // Financial and audit records are never deleted automatically.
    const blocked = await db.sharedLifecycleJob.findFirstOrThrow({
      where: { custodyId: held.id },
    });
    expect(blocked.state).toBe('BLOCKED_POLICY');
    expect(blocked.progress).toMatchObject({
      failureCode: 'SOCIAL_PROTECTED_RECORDS_RETAINED',
    });
    expect(await db.socialGroup.count({ where: { id: held.id } })).toBe(1);
    expect(await db.socialExpense.count({ where: { groupId: held.id } })).toBe(
      1,
    );
    expect(
      await db.socialAuditEvent.count({ where: { groupId: held.id } }),
    ).toBeGreaterThan(0);
    expect(
      await db.contextAccess.count({
        where: { spaceId: held.id, state: { in: ['ACTIVE', 'SUSPENDED'] } },
      }),
    ).toBe(0);
    await denied(groups.read(alice.actor, held.id));
  });

  it('departure with open balances needs a fresh confirmation and keeps only own obligations', async () => {
    const g = await group(bob, carol, dave);
    const ref: Ref = { kind: 'GROUP', id: g.id };
    await approved(ref, '900', [bob, carol]);
    const grouped = await activity(g.id, 'Group outing'),
      independent = await activity(null);
    await activities.join(bob.actor, grouped.id, key());
    await attend(independent.id, bob);
    const before = await exit.check(bob.actor, g.id);
    expect(before).toMatchObject({
      groupId: g.id,
      deletion: null,
      obligations: [
        {
          ledgerKind: 'GROUP',
          ledgerId: g.id,
          currency: 'USD',
          netMinor: '-450',
          owedMinor: '450',
          receivableMinor: '0',
        },
      ],
    });
    // Privacy-safe: no counterparties, names or expense content.
    expect(JSON.stringify(before)).not.toMatch(
      /Shared dinner|private note|Alice/,
    );
    const revision = before.membershipRevision;
    await reason(
      exit.leave(bob.actor, g.id, revision, undefined),
      'OUTSTANDING_BALANCE_CONFIRMATION_REQUIRED',
    );
    // A balance change invalidates the earlier confirmation.
    await approved(ref, '100', [bob]);
    await reason(
      exit.leave(bob.actor, g.id, revision, {
        outstandingBalanceConfirmation: before.departureConfirmation!,
      }),
      'OUTSTANDING_BALANCE_CONFIRMATION_REQUIRED',
    );
    const fresh = await exit.check(bob.actor, g.id);
    expect(fresh.obligations[0]!.owedMinor).toBe('550');
    await exit.leave(bob.actor, g.id, revision, {
      outstandingBalanceConfirmation: fresh.departureConfirmation!,
    });
    // Group-derived access ends immediately.
    await denied(groups.read(bob.actor, g.id));
    await denied(groups.members(bob.actor, g.id, page));
    await denied(exit.check(bob.actor, g.id));
    await status(expenses.list(bob.actor, ref, page), 404);
    await denied(activities.read(bob.actor, grouped.id));
    expect((await activities.read(bob.actor, independent.id)).id).toBe(
      independent.id,
    );
    // Only the person's own obligation stays reachable.
    const own = await expenses.balances(bob.actor, ref, false);
    expect(own.items).toEqual([
      expect.objectContaining({ userId: bob.actor.userId, owedMinor: '550' }),
    ]);
    await status(expenses.balances(bob.actor, ref, true), 403);
    const settlement = await expenses.settle(
      bob.actor,
      ref,
      {
        id: randomUUID(),
        payeeUserId: alice.actor.userId,
        currency: 'USD',
        amountMinor: '550',
        note: null,
      },
      key(),
    );
    expect(
      (await expenses.settlements(bob.actor, ref, page)).items.map((s) => s.id),
    ).toEqual([settlement.id]);
    // The remaining counterparty keeps the right to confirm.
    await expenses.decideSettlement(
      alice.actor,
      ref,
      settlement.id,
      'confirm',
      {},
      settlement.revision,
      key(),
    );
    // Group notices disappear except the person's own settlement outcome.
    const notices = (await planning.notices(bob.actor, page)).items.filter(
      (n) => n.groupId === g.id,
    );
    expect(notices.every((n) => n.kind.startsWith('SETTLEMENT_'))).toBe(true);
    // Settled: no residual ledger access remains.
    await status(expenses.balances(bob.actor, ref, false), 404);
    // Export: own obligations only, minimized, no Group content.
    const sections = await snapshot(bob);
    expect(sections.socialExpenseShares!.length).toBe(2);
    expect(sections.socialSettlements!.length).toBe(1);
    expect(JSON.stringify(sections)).not.toMatch(
      /Shared dinner|private note|Group outing/,
    );
    // A member without balances leaves without any confirmation.
    const quiet = await exit.check(dave.actor, g.id);
    expect(quiet).toMatchObject({
      obligations: [],
      departureConfirmation: null,
    });
    await exit.leave(dave.actor, g.id, quiet.membershipRevision, undefined);
    await denied(groups.read(dave.actor, g.id));
  });

  it('Owner deletion with open balances requires an explicit confirmation', async () => {
    const g = await group(bob);
    await approved({ kind: 'GROUP', id: g.id }, '500', [bob]);
    const check = await exit.check(alice.actor, g.id);
    expect(check.deletion).toMatchObject({
      outstandingLedgerCount: 1,
      outstandingPartyCount: 2,
    });
    await reason(
      exit.delete(alice.actor, g.id, check.deletion!.groupRevision, {
        password,
      }),
      'OUTSTANDING_BALANCE_CONFIRMATION_REQUIRED',
    );
    await exit.delete(alice.actor, g.id, check.deletion!.groupRevision, {
      password,
      outstandingBalanceConfirmation: check.deletion!.confirmation!,
    });
    expect(await db.socialExpense.count({ where: { groupId: g.id } })).toBe(1);
  });

  it('after Group deletion and past the deadline, parties keep only their own ledger', async () => {
    const eve = await person('Eve');
    const g = await group(bob, carol, dave);
    const ref: Ref = { kind: 'GROUP', id: g.id };
    await approved(ref, '900', [bob, carol]);
    const grouped = await activity(g.id, 'Group outing');
    await activities.join(bob.actor, grouped.id, key());
    const aref: Ref = { kind: 'ACTIVITY', id: grouped.id };
    await approved(aref, '200', [bob]);
    const check = await exit.check(alice.actor, g.id);
    await exit.delete(alice.actor, g.id, check.deletion!.groupRevision, {
      password,
      outstandingBalanceConfirmation: check.deletion!.confirmation!,
    });
    // Own balances only, in the Group ledger and the Group Activity ledger.
    expect((await expenses.balances(bob.actor, ref, false)).items).toEqual([
      expect.objectContaining({ userId: bob.actor.userId, owedMinor: '450' }),
    ]);
    expect((await expenses.balances(bob.actor, aref, false)).items).toEqual([
      expect.objectContaining({ userId: bob.actor.userId, owedMinor: '200' }),
    ]);
    await status(expenses.balances(bob.actor, ref, true), 403);
    // No Group content, membership, expenses or Activities.
    await status(expenses.list(bob.actor, ref, page), 404);
    await denied(groups.read(bob.actor, g.id));
    await denied(groups.members(bob.actor, g.id, page));
    await denied(activities.read(bob.actor, grouped.id));
    // Unrelated people, and former members without a balance: 404.
    for (const who of [dave, eve]) {
      await status(expenses.balances(who.actor, ref, false), 404);
      await status(expenses.settlements(who.actor, ref, page), 404);
    }
    await status(
      expenses.settle(
        eve.actor,
        ref,
        {
          id: randomUUID(),
          payeeUserId: alice.actor.userId,
          currency: 'USD',
          amountMinor: '1',
          note: null,
        },
        key(),
      ),
      404,
    );
    // Recording and confirming retry without duplicate financial effects.
    const body = {
        id: randomUUID(),
        payeeUserId: alice.actor.userId,
        currency: 'USD',
        amountMinor: '450',
        note: null,
      },
      once = key();
    const first = await expenses.settle(bob.actor, ref, body, once);
    expect(await expenses.settle(bob.actor, ref, body, once)).toEqual(first);
    // Only an existing counterparty may settle; nobody else is eligible.
    await expect(
      expenses.settle(
        bob.actor,
        ref,
        { ...body, id: randomUUID(), payeeUserId: eve.actor.userId },
        key(),
      ),
    ).rejects.toMatchObject({ status: 422 });
    await status(
      expenses.decideSettlement(
        carol.actor,
        ref,
        first.id,
        'confirm',
        {},
        first.revision,
        key(),
      ),
      404,
    );
    expect(
      (await expenses.settlements(bob.actor, ref, page)).items.map((s) => s.id),
    ).toEqual([first.id]);
    const confirmKey = key();
    const confirmed = await expenses.decideSettlement(
      alice.actor,
      ref,
      first.id,
      'confirm',
      {},
      first.revision,
      confirmKey,
    );
    expect(
      await expenses.decideSettlement(
        alice.actor,
        ref,
        first.id,
        'confirm',
        {},
        first.revision,
        confirmKey,
      ),
    ).toEqual(confirmed);
    expect(confirmed.state).toBe('CONFIRMED');
    expect(await db.socialSettlement.count({ where: { groupId: g.id } })).toBe(
      1,
    );
    // Bob's Group balance is settled: Group-ledger access ends there.
    await status(expenses.balances(bob.actor, ref, false), 404);
    // Past the deadline: cleanup stays policy-gated and parked.
    await expire(g.id);
    await drain();
    const parked = await db.sharedLifecycleJob.findFirstOrThrow({
      where: { custodyId: g.id },
    });
    expect(parked.state).toBe('BLOCKED_POLICY');
    expect(parked.nextAt.getUTCFullYear()).toBe(9999);
    await drain();
    expect(
      (
        await db.sharedLifecycleJob.findFirstOrThrow({
          where: { custodyId: g.id },
        })
      ).revision,
    ).toBe(parked.revision);
    await reason(
      exit.proof(alice.actor, g.id, parked.revision, password),
      'RECOVERY_UNAVAILABLE',
    );
    // The remaining obligation is still reachable by its parties only.
    expect((await expenses.balances(carol.actor, ref, false)).items).toEqual([
      expect.objectContaining({ owedMinor: '450' }),
    ]);
    await denied(groups.read(carol.actor, g.id));
    // Erasure detaches the identity; protected records survive, nothing leaks.
    await erase(carol);
    expect(await db.socialExpense.count({ where: { groupId: g.id } })).toBe(1);
    expect(await db.socialSettlement.count({ where: { groupId: g.id } })).toBe(
      1,
    );
    expect(
      await db.socialExpenseShare.count({
        where: { userId: carol.actor.userId },
      }),
    ).toBe(0);
    await status(expenses.balances(eve.actor, ref, false), 404);
    expect((await expenses.balances(bob.actor, aref, false)).items).toEqual([
      expect.objectContaining({ owedMinor: '200' }),
    ]);
  });

  it('last organizer erasure closes independent and Group-linked Activities without promotion', async () => {
    const independent = await activity(null);
    await attend(independent.id, bob);
    await activities.invite(
      alice.actor,
      independent.id,
      { userId: carol.actor.userId },
      key(),
    );
    const pending = await propose(
      bob,
      { kind: 'ACTIVITY', id: independent.id },
      '300',
      [bob],
    );
    const g = await group(bob),
      grouped = await activity(g.id, 'Group outing');
    await activities.join(bob.actor, grouped.id, key());
    await erase(alice);
    for (const id of [independent.id, grouped.id]) {
      const row = await db.socialActivity.findUniqueOrThrow({ where: { id } });
      expect(row.state).toBe('CLOSED');
      expect(row.orphanedAt).not.toBeNull();
      expect(
        await db.socialActivityParticipant.count({
          where: { activityId: id, role: 'ORGANIZER', userId: { not: null } },
        }),
      ).toBe(0);
    }
    // Pending actions that needed the organizer end; records are preserved.
    expect(
      (
        await db.socialActivityParticipant.findFirstOrThrow({
          where: { activityId: independent.id, userId: carol.actor.userId },
        })
      ).state,
    ).toBe('DECLINED');
    expect(
      (await db.socialExpense.findUniqueOrThrow({ where: { id: pending.id } }))
        .state,
    ).toBe('WITHDRAWN');
    expect((await activities.read(bob.actor, independent.id)).id).toBe(
      independent.id,
    );
  });

  it('serves the moved leave route and the lifecycle routes over HTTP', async () => {
    const g = await group(dave);
    const login = await request_(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email: dave.email, password })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])
      .map((v) => v.split(';')[0])
      .join('; ');
    await request_(app.getHttpServer())
      .get(`/api/v1/social-groups/${g.id}/exit-check`)
      .expect(401);
    const check = await request_(app.getHttpServer())
      .get(`/api/v1/social-groups/${g.id}/exit-check`)
      .set('Cookie', cookie)
      .expect(200);
    expect(check.body).toMatchObject({ obligations: [], deletion: null });
    await request_(app.getHttpServer())
      .post(`/api/v1/social-groups/${g.id}/delete`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('If-Match', `"${g.revision}"`)
      .send({})
      .expect(400);
    await request_(app.getHttpServer())
      .post(`/api/v1/social-groups/${g.id}/leave`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ unexpected: true })
      .set('If-Match', `"${check.body.membershipRevision}"`)
      .expect(400);
    await request_(app.getHttpServer())
      .post(`/api/v1/social-groups/${g.id}/leave`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('If-Match', `"${check.body.membershipRevision}"`)
      .expect(201);
    await request_(app.getHttpServer())
      .get(`/api/v1/social-groups/${g.id}/lifecycle-job`)
      .set('Cookie', cookie)
      .expect((r) => expect([403, 404]).toContain(r.status));
  });
});
function c<T>(v: T) {
  return v as T & {
    state: string;
    revision: number;
    recoveryDeadline: string;
  };
}
