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
  SocialLendingService,
  SocialLostFoundService,
  SocialPlanningService,
  SocialData,
} from '../../src/modules/social/public/index.js';
import { CollaborationService } from '../../src/modules/spaces/public/index.js';
import { ExportBudget } from '../../src/platform/lifecycle/personal-data.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
type Person = { actor: RequestActor; email: string };
describe('P6-04 lending and Lost & Found', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    db: PrismaClient,
    groups: SocialGroupsService,
    lending: SocialLendingService,
    lostFound: SocialLostFoundService,
    planning: SocialPlanningService,
    collaboration: CollaborationService,
    passwordHash: string;
  let alice: Person, bob: Person, carol: Person, dave: Person;
  const origin = 'http://localhost:3000',
    password = 'synthetic-activity-password-123!',
    version = 'lending-' + randomUUID(),
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
    const root = fs.mkdtempSync(path.resolve('.tools/p604-integration-'));
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P604-ONLY',
      },
    });
    await app.get(SharedControl).initialize();
    groups = app.get(SocialGroupsService);
    lending = app.get(SocialLendingService);
    lostFound = app.get(SocialLostFoundService);
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

  const ok = (p: Promise<unknown>, code: string) =>
    expect(p).rejects.toMatchObject({ response: { code } });
  async function connect(a: Person, b: Person) {
    await db.socialConnection.create({
      data: {
        id: randomUUID(),
        requesterUserId: a.actor.userId,
        recipientUserId: b.actor.userId,
        state: 'ACCEPTED',
      },
    });
  }
  async function asset(
    who: Person,
    audience: 'PRIVATE' | 'CONNECTIONS' | 'GROUP',
    groupId: string | null = null,
  ) {
    return lending.createAsset(
      who.actor,
      {
        id: randomUUID(),
        audience,
        groupId,
        title: 'Camping tent',
        description: 'Green',
      },
      key(),
    );
  }
  type Loan = Awaited<ReturnType<SocialLendingService['readLoan']>>;
  const act = (
    who: Person,
    l: Loan,
    action: Parameters<SocialLendingService['act']>[2],
    note?: string,
  ) => lending.act(who.actor, l.id, action, { note }, l.revision, key());
  async function request(who: Person, assetId: string) {
    return lending.createLoan(
      who.actor,
      { id: randomUUID(), assetId, mode: 'REQUEST', dueAt: day('12-10') },
      key(),
    );
  }
  async function membership(groupId: string, who: Person) {
    const actor = await db.sharedActor.findFirstOrThrow({
      where: { spaceId: groupId, userId: who.actor.userId },
    });
    return db.contextAccess.findFirstOrThrow({
      where: { spaceId: groupId, actorId: actor.id, scopeId: groupId },
    });
  }

  it('personal lending: an owner statement is not custody until the borrower acknowledges', async () => {
    const tent = await asset(alice, 'PRIVATE');
    await status(lending.readAsset(bob.actor, tent.id), 404);
    await status(request(bob, tent.id), 404);
    let l = await lending.createLoan(
      alice.actor,
      {
        id: randomUUID(),
        assetId: tent.id,
        mode: 'OFFER',
        borrowerUserId: bob.actor.userId,
        alreadyWithBorrower: true,
        dueAt: day('12-10'),
      },
      key(),
    );
    expect(l).toMatchObject({
      state: 'OFFERED',
      custodyConfirmed: false,
      myRole: 'LENDER',
    });
    expect(l.lenderHandoverAt).not.toBeNull();
    await ok(act(alice, l, 'accept'), 'LOAN_COUNTERPARTY_REQUIRED');
    l = await act(bob, l, 'accept');
    expect(l).toMatchObject({
      state: 'ACCEPTED',
      custodyConfirmed: false,
      myRole: 'BORROWER',
    });
    expect(l.allowedActions).toContain('receive');
    l = await act(bob, l, 'receive');
    expect(l).toMatchObject({
      state: 'HANDED_OVER',
      custodyConfirmed: true,
      overdue: false,
    });
    expect((await lending.readAsset(alice.actor, tent.id)).available).toBe(
      false,
    );
    await ok(
      lending.archiveAsset(
        alice.actor,
        tent.id,
        (await lending.readAsset(alice.actor, tent.id)).revision,
        key(),
      ),
      'ASSET_ON_LOAN',
    );
    l = await act(bob, l, 'return');
    expect(l.state).toBe('RETURN_REQUESTED');
    await ok(act(bob, l, 'confirm-return'), 'LOAN_COUNTERPARTY_REQUIRED');
    l = await act(alice, l, 'confirm-return');
    expect(l).toMatchObject({ state: 'RETURNED', custodyConfirmed: false });
    expect((await lending.readAsset(alice.actor, tent.id)).available).toBe(
      true,
    );
    const history = await lending.loanHistory(bob.actor, l.id);
    expect(history.items.map((e) => e.action)).toEqual([
      'loan.offered',
      'loan.handover',
      'loan.accept',
      'loan.receive',
      'loan.return',
      'loan.confirm-return',
    ]);
    await status(lending.readLoan(carol.actor, l.id), 404);
    await status(lending.loanHistory(carol.actor, l.id), 404);
  });

  it('connection requests, overdue, disputes and lost/damaged outcomes need the counterparty', async () => {
    await connect(alice, bob);
    const tent = await asset(alice, 'CONNECTIONS');
    await status(lending.readAsset(carol.actor, tent.id), 404);
    await status(request(carol, tent.id), 404);
    const seen = await lending.listAssets(bob.actor, {
      view: 'CONNECTIONS',
      limit: 100,
    });
    expect(seen.items.map((i) => i.id)).toEqual([tent.id]);
    let l = await request(bob, tent.id);
    await ok(request(bob, tent.id), 'LOAN_PENDING');
    expect(
      (
        await lending.listLoans(alice.actor, {
          role: 'ANY',
          actionRequired: 'true',
          limit: 100,
        })
      ).items.map((i) => i.id),
    ).toEqual([l.id]);
    l = await act(alice, l, 'accept');
    l = await act(alice, l, 'handover');
    expect(l.custodyConfirmed).toBe(false);
    l = await act(bob, l, 'receive');
    // Overdue is derived from authoritative state; no worker is required.
    await db.socialLoan.update({
      where: { id: l.id },
      data: { dueAt: new Date(Date.now() - 1000) },
    });
    l = await lending.readLoan(bob.actor, l.id);
    expect(l.overdue).toBe(true);
    await ok(act(bob, l, 'dispute', '  '), 'DISPUTE_NOTE_REQUIRED');
    l = await act(bob, l, 'dispute', 'It was already broken');
    expect(l).toMatchObject({
      state: 'DISPUTED',
      stateBeforeDispute: 'HANDED_OVER',
    });
    l = await act(alice, l, 'report-damaged');
    await ok(act(alice, l, 'accept-outcome'), 'LOAN_COUNTERPARTY_REQUIRED');
    l = await act(bob, l, 'accept-outcome');
    expect(l).toMatchObject({ state: 'DAMAGED', overdue: false });
    expect(l.returnedAt).not.toBeNull();
  });

  it('Group-associated assets follow current membership; moderators read, outsiders see nothing', async () => {
    const g = await group();
    const tent = await asset(alice, 'GROUP', g.id);
    expect(
      (
        await lending.listAssets(bob.actor, {
          view: 'GROUP',
          groupId: g.id,
          limit: 100,
        })
      ).items,
    ).toHaveLength(1);
    await status(
      lending.listAssets(carol.actor, {
        view: 'GROUP',
        groupId: g.id,
        limit: 100,
      }),
      404,
    );
    await status(lending.readAsset(carol.actor, tent.id), 404);
    await status(request(carol, tent.id), 404);
    const l = await request(bob, tent.id);
    // Owner/Admin moderation view (read-only).
    const modView = await lending.listLoans(alice.actor, {
      role: 'ANY',
      groupId: g.id,
      limit: 100,
    });
    expect(modView.items[0]).toMatchObject({ id: l.id, myRole: 'LENDER' });
    await status(
      lending.listLoans(bob.actor, { role: 'ANY', groupId: g.id, limit: 100 }),
      404,
    );
    // Revoked membership: the request cannot be accepted, but the party record remains.
    const m = await membership(g.id, bob);
    await collaboration.changeMembership(alice.actor, g.id, m.id, m.revision, {
      state: 'REVOKED',
      memberRole: 'MEMBER',
    });
    await ok(act(alice, l, 'accept'), 'BORROWER_INELIGIBLE');
    await status(lending.readAsset(bob.actor, tent.id), 404);
    expect((await lending.readLoan(bob.actor, l.id)).state).toBe('REQUESTED');
    expect((await act(bob, l, 'cancel')).state).toBe('CANCELED');
  });

  it('retries are idempotent and concurrent acceptance/custody steps apply once', async () => {
    await connect(alice, bob);
    await connect(alice, carol);
    const tent = await asset(alice, 'CONNECTIONS');
    const body = {
      id: randomUUID(),
      assetId: tent.id,
      mode: 'REQUEST' as const,
    };
    const k = key();
    const first = await lending.createLoan(bob.actor, body, k);
    expect(await lending.createLoan(bob.actor, body, k)).toEqual(first);
    await ok(
      lending.createLoan(bob.actor, { ...body, note: 'changed' }, k),
      'IDEMPOTENCY_CONFLICT',
    );
    const second = await request(carol, tent.id);
    const results = await Promise.allSettled([
      act(alice, first, 'accept'),
      act(alice, second, 'accept'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await db.socialLoan.count({
        where: { assetId: tent.id, state: 'ACCEPTED' },
      }),
    ).toBe(1);
    const accepted = await lending.readLoan(
      alice.actor,
      (
        await db.socialLoan.findFirstOrThrow({
          where: { assetId: tent.id, state: 'ACCEPTED' },
        })
      ).id,
    );
    const borrower = accepted.borrowerUserId === bob.actor.userId ? bob : carol;
    const steps = await Promise.allSettled([
      act(alice, accepted, 'handover'),
      act(borrower, accepted, 'receive'),
    ]);
    expect(steps.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const after = await lending.readLoan(alice.actor, accepted.id);
    expect(after.state).toBe('ACCEPTED');
    expect(after.revision).toBe(accepted.revision + 1);
  });

  it('Lost & Found works without a loan; claims stay private and never prove ownership', async () => {
    await connect(bob, alice);
    await connect(bob, carol);
    const r = await lostFound.create(
      bob.actor,
      {
        id: randomUUID(),
        kind: 'LOST',
        audience: 'CONNECTIONS',
        title: 'Blue umbrella',
        description: 'Left at the cafe',
      },
      key(),
    );
    expect(
      await db.socialLoan.count({
        where: { borrowerUserId: bob.actor.userId },
      }),
    ).toBe(0);
    await status(lostFound.read(dave.actor, r.id), 404);
    await status(
      lostFound.claim(
        dave.actor,
        r.id,
        { id: randomUUID(), note: 'mine' },
        key(),
      ),
      404,
    );
    await ok(
      lostFound.claim(
        bob.actor,
        r.id,
        { id: randomUUID(), note: 'self' },
        key(),
      ),
      'PARTICIPANT_INELIGIBLE',
    );
    await ok(
      lostFound.claim(
        alice.actor,
        r.id,
        { id: randomUUID(), note: 'x', linkedReportId: r.id },
        key(),
      ),
      'LINKED_REPORT_INVALID',
    );
    const own = await lostFound.create(
      alice.actor,
      {
        id: randomUUID(),
        kind: 'FOUND',
        audience: 'CONNECTIONS',
        title: 'Umbrella found',
      },
      key(),
    );
    const matches = await lostFound.matches(bob.actor, r.id, { limit: 100 });
    expect(matches.items.map((i) => i.id)).toEqual([own.id]);
    await status(lostFound.matches(alice.actor, r.id, { limit: 100 }), 404);
    let a = await lostFound.claim(
      alice.actor,
      r.id,
      { id: randomUUID(), note: 'I have it', linkedReportId: own.id },
      key(),
    );
    const c2 = await lostFound.claim(
      carol.actor,
      r.id,
      { id: randomUUID(), note: 'I have one too' },
      key(),
    );
    expect(await lostFound.read(bob.actor, r.id)).toMatchObject({
      contested: true,
      openClaimCount: 2,
    });
    expect(await lostFound.read(alice.actor, r.id)).toMatchObject({
      contested: null,
      myClaimId: a.id,
    });
    expect(
      (await lostFound.claims(carol.actor, r.id, { limit: 100 })).items.map(
        (i) => i.id,
      ),
    ).toEqual([c2.id]);
    await status(lostFound.readClaim(carol.actor, r.id, a.id), 404);
    await lostFound.addClaimEvidence(
      alice.actor,
      r.id,
      a.id,
      {
        id: randomUUID(),
        kind: 'IDENTIFYING',
        label: 'Initials on the handle',
      },
      key(),
    );
    await status(lostFound.claimEvidence(carol.actor, r.id, a.id), 404);
    expect(
      (await lostFound.claimEvidence(bob.actor, r.id, a.id)).items[0],
    ).toMatchObject({ content: null });
    a = await lostFound.actClaim(
      bob.actor,
      r.id,
      a.id,
      'acknowledge',
      {},
      a.revision,
      key(),
    );
    await ok(
      lostFound.actClaim(
        bob.actor,
        r.id,
        c2.id,
        'acknowledge',
        {},
        c2.revision,
        key(),
      ),
      'CLAIM_CONFLICT',
    );
    expect(a.allowedActions).toEqual(['reject', 'receive', 'dispute']);
    a = await lostFound.actClaim(
      alice.actor,
      r.id,
      a.id,
      'handover',
      {},
      a.revision,
      key(),
    );
    expect(a.state).toBe('ACKNOWLEDGED');
    a = await lostFound.actClaim(
      bob.actor,
      r.id,
      a.id,
      'receive',
      {},
      a.revision,
      key(),
    );
    expect(a).toMatchObject({ state: 'RESOLVED', ownershipVerified: false });
    expect((await lostFound.read(bob.actor, r.id)).state).toBe('RESOLVED');
    expect((await lostFound.readClaim(carol.actor, r.id, c2.id)).state).toBe(
      'SUPERSEDED',
    );
    expect((await lostFound.read(alice.actor, own.id)).state).toBe('RESOLVED');
    const h = await lostFound.history(carol.actor, r.id);
    expect(h.items.every((e) => e.claimId === c2.id)).toBe(true);
  });

  it('Group Lost & Found: members see, moderators hide, disputes need a note', async () => {
    const g = await group();
    const r = await lostFound.create(
      bob.actor,
      {
        id: randomUUID(),
        kind: 'FOUND',
        audience: 'GROUP',
        groupId: g.id,
        title: 'Keys',
      },
      key(),
    );
    expect(
      (
        await lostFound.list(alice.actor, {
          view: 'GROUP',
          groupId: g.id,
          limit: 100,
        })
      ).items,
    ).toHaveLength(1);
    await status(lostFound.read(carol.actor, r.id), 404);
    let cl = await lostFound.claim(
      alice.actor,
      r.id,
      { id: randomUUID(), note: 'Mine' },
      key(),
    );
    cl = await lostFound.actClaim(
      bob.actor,
      r.id,
      cl.id,
      'acknowledge',
      {},
      cl.revision,
      key(),
    );
    await ok(
      lostFound.actClaim(
        alice.actor,
        r.id,
        cl.id,
        'dispute',
        {},
        cl.revision,
        key(),
      ),
      'DISPUTE_NOTE_REQUIRED',
    );
    cl = await lostFound.actClaim(
      alice.actor,
      r.id,
      cl.id,
      'dispute',
      { note: 'Wrong keys shown' },
      cl.revision,
      key(),
    );
    expect(cl.state).toBe('DISPUTED');
    await ok(
      lostFound.actClaim(
        bob.actor,
        r.id,
        cl.id,
        'resume',
        {},
        cl.revision,
        key(),
      ),
      'CLAIM_PARTY_REQUIRED',
    );
    const report = await lostFound.read(bob.actor, r.id);
    await ok(
      lostFound.act(bob.actor, r.id, 'hide', report.revision, key()),
      'MODERATOR_REQUIRED',
    );
    const hidden = await lostFound.act(
      alice.actor,
      r.id,
      'hide',
      report.revision,
      key(),
    );
    expect(hidden.state).toBe('HIDDEN');
    expect(
      (
        await lostFound.list(alice.actor, {
          view: 'GROUP',
          groupId: g.id,
          limit: 100,
        })
      ).items,
    ).toHaveLength(1);
    // The claimant keeps party access to the hidden post; no other member gains it.
    expect((await lostFound.read(alice.actor, r.id)).state).toBe('HIDDEN');
  });

  async function erase(who: Person) {
    const data = app.get(SocialData);
    const space = await db.space.findFirstOrThrow({
      where: { ownerUserId: who.actor.userId },
    });
    const scope = { actor: who.actor, spaceId: space.id } as never;
    await db.$transaction((tx) => data.snapshot(tx, scope, new ExportBudget()));
    await db.$transaction((tx) => data.erase(tx, scope));
  }
  it('erasure keeps minimal shared history and removes the person’s own text and evidence', async () => {
    await connect(alice, bob);
    const tent = await asset(alice, 'CONNECTIONS'),
      lamp = await asset(alice, 'CONNECTIONS');
    let held = await lending.createLoan(
      bob.actor,
      {
        id: randomUUID(),
        assetId: tent.id,
        mode: 'REQUEST',
        note: 'Bob private note',
      },
      key(),
    );
    held = await act(alice, held, 'accept');
    held = await act(alice, held, 'handover');
    held = await act(bob, held, 'receive');
    held = await lending.proposeDue(
      bob.actor,
      held.id,
      { dueAt: day('12-20') },
      held.revision,
      key(),
    );
    held = await act(bob, held, 'dispute', 'Bob private dispute');
    const pending = await request(bob, lamp.id);
    for (const who of [alice, bob])
      await lending.addLoanEvidence(
        who.actor,
        held.id,
        {
          id: randomUUID(),
          kind: 'CONDITION',
          label: who === bob ? 'Bob photo note' : 'Alice note',
        },
        key(),
      );
    const r = await lostFound.create(
      bob.actor,
      {
        id: randomUUID(),
        kind: 'LOST',
        audience: 'CONNECTIONS',
        title: 'Private description',
      },
      key(),
    );
    await erase(bob);
    const kept = await lending.readLoan(alice.actor, held.id);
    expect(kept).toMatchObject({
      state: 'DISPUTED',
      borrowerUserId: null,
      orphaned: true,
      note: null,
      disputeNote: '[erased]',
      disputedByUserId: null,
      proposedDueAt: null,
      assetTitle: 'Camping tent',
      allowedActions: ['confirm-return'],
    });
    expect((await lending.readLoan(alice.actor, pending.id)).state).toBe(
      'CANCELED',
    );
    expect(
      (await lending.loanEvidence(alice.actor, held.id)).items.map(
        (e) => e.label,
      ),
    ).toEqual(['Alice note']);
    const history = await lending.loanHistory(alice.actor, held.id);
    expect(history.items.map((e) => e.action)).toContain('loan.receive');
    expect(
      history.items
        .filter((e) => e.actorUserId === null)
        .every((e) => e.note === null),
    ).toBe(true);
    expect(JSON.stringify(history)).not.toContain('Bob private');
    expect(
      await db.socialNotice.count({ where: { userId: bob.actor.userId } }),
    ).toBe(0);
    expect((await act(alice, kept, 'confirm-return')).state).toBe('RETURNED');
    expect(
      await db.socialLostFoundReport.findUniqueOrThrow({ where: { id: r.id } }),
    ).toMatchObject({
      state: 'WITHDRAWN',
      title: null,
      description: null,
      reporterUserId: null,
    });
    expect(
      await db.socialLendingEvent.count({
        where: { actorUserId: bob.actor.userId },
      }),
    ).toBe(0);
    // Owner erasure: the borrower keeps the minimal item identity, not the private description.
    let lent = await lending.createLoan(
      dave.actor,
      {
        id: randomUUID(),
        assetId: (await asset(dave, 'PRIVATE')).id,
        mode: 'OFFER',
        borrowerUserId: carol.actor.userId,
      },
      key(),
    );
    lent = await act(carol, lent, 'accept');
    await erase(dave);
    const mine = await lending.readLoan(carol.actor, lent.id);
    expect(mine).toMatchObject({
      lenderUserId: null,
      assetTitle: 'Camping tent',
      orphaned: true,
    });
    expect(
      await db.socialAsset.findUniqueOrThrow({ where: { id: lent.assetId } }),
    ).toMatchObject({
      ownerUserId: null,
      description: null,
      state: 'ARCHIVED',
    });
    await status(lending.readAsset(carol.actor, lent.assetId), 404);
    expect(
      (
        await lending.listAssets(carol.actor, {
          view: 'CONNECTIONS',
          limit: 100,
          q: 'Camping',
        })
      ).items,
    ).toHaveLength(0);
  });

  it('notices reach only the counterparty, survive retries once, and polling stays authoritative', async () => {
    await connect(alice, bob);
    const tent = await asset(alice, 'CONNECTIONS');
    const body = {
      id: randomUUID(),
      assetId: tent.id,
      mode: 'REQUEST' as const,
      note: 'Secret reason',
    };
    const k = key();
    await lending.createLoan(bob.actor, body, k);
    await lending.createLoan(bob.actor, body, k); // idempotent replay
    const notices = await db.socialNotice.findMany({
      where: { loanId: body.id },
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      userId: alice.actor.userId,
      kind: 'LOAN_REQUESTED',
      resourceId: body.id,
    });
    const inbox = await planning.notices(alice.actor, { limit: 100 });
    expect(inbox.items).toEqual([
      expect.objectContaining({
        kind: 'LOAN_REQUESTED',
        resourceId: body.id,
        activityId: null,
        groupId: null,
      }),
    ]);
    expect(JSON.stringify(inbox)).not.toContain('Secret reason');
    expect(
      (await planning.notices(carol.actor, { limit: 100 })).items,
    ).toHaveLength(0);
    // Polling fallback works with the inbox emptied (delivery is not part of the loan's state).
    await db.socialNotice.deleteMany({ where: { loanId: body.id } });
    const waiting = await lending.listLoans(alice.actor, {
      role: 'ANY',
      actionRequired: 'true',
      limit: 100,
    });
    expect(waiting.items.map((i) => i.id)).toEqual([body.id]);
    let l = await lending.readLoan(alice.actor, body.id);
    l = await act(alice, l, 'accept');
    l = await act(alice, l, 'handover');
    expect(
      await db.socialNotice.findMany({
        where: { loanId: l.id, userId: bob.actor.userId },
        select: { kind: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { kind: 'LOAN_DECIDED' },
        { kind: 'LOAN_HANDOVER' },
      ]),
    );
    // A rejected transition (stale revision) commits no notice and no state change.
    const before = await db.socialNotice.count();
    await ok(
      lending.act(bob.actor, l.id, 'receive', {}, l.revision - 1, key()),
      'REVISION_CONFLICT',
    );
    expect(await db.socialNotice.count()).toBe(before);
    expect((await lending.readLoan(bob.actor, l.id)).state).toBe('ACCEPTED');
    l = await act(bob, l, 'receive');
    expect(
      await db.socialNotice.count({
        where: {
          loanId: l.id,
          userId: alice.actor.userId,
          kind: 'LOAN_RECEIVED',
        },
      }),
    ).toBe(1);
    // Lost & Found notices name the post, not the claim text.
    const post = await lostFound.create(
      alice.actor,
      { id: randomUUID(), kind: 'LOST', audience: 'CONNECTIONS', title: 'Hat' },
      key(),
    );
    await lostFound.claim(
      bob.actor,
      post.id,
      { id: randomUUID(), note: 'Private detail' },
      key(),
    );
    const claimNotice = await db.socialNotice.findFirstOrThrow({
      where: { userId: alice.actor.userId, kind: 'CLAIM_SUBMITTED' },
    });
    expect(claimNotice).toMatchObject({
      lostFoundReportId: post.id,
      resourceId: post.id,
      loanId: null,
    });
  });

  it('due dates change only by mutual agreement, with stale and concurrent proposals rejected', async () => {
    await connect(alice, bob);
    const tent = await asset(alice, 'CONNECTIONS');
    let l = await request(bob, tent.id);
    await ok(
      lending.proposeDue(
        bob.actor,
        l.id,
        { dueAt: day('12-25') },
        l.revision,
        key(),
      ),
      'LOAN_STATE_CONFLICT',
    );
    l = await act(alice, l, 'accept');
    const agreed = l.dueAt;
    await status(
      lending.proposeDue(
        carol.actor,
        l.id,
        { dueAt: day('12-25') },
        l.revision,
        key(),
      ),
      404,
    );
    await ok(
      lending.proposeDue(
        bob.actor,
        l.id,
        { dueAt: '2001-01-01T00:00:00.000Z' },
        l.revision,
        key(),
      ),
      'DUE_IN_PAST',
    );
    const race = await Promise.allSettled([
      lending.proposeDue(
        bob.actor,
        l.id,
        { dueAt: day('12-25') },
        l.revision,
        key(),
      ),
      lending.proposeDue(
        alice.actor,
        l.id,
        { dueAt: day('12-26') },
        l.revision,
        key(),
      ),
    ]);
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    l = await lending.readLoan(alice.actor, l.id);
    expect(l.dueAt).toBe(agreed);
    const proposer = l.dueProposedByUserId === bob.actor.userId ? bob : alice,
      other = proposer === bob ? alice : bob;
    await ok(act(proposer, l, 'accept-due'), 'LOAN_COUNTERPARTY_REQUIRED');
    await ok(
      lending.proposeDue(
        other.actor,
        l.id,
        { dueAt: day('12-27') },
        l.revision,
        key(),
      ),
      'DUE_CHANGE_PENDING',
    );
    const declined = await act(other, l, 'decline-due');
    expect(declined).toMatchObject({ dueAt: agreed, proposedDueAt: null });
    l = await lending.proposeDue(
      bob.actor,
      l.id,
      { dueAt: day('12-28') },
      declined.revision,
      key(),
    );
    expect(
      await db.socialNotice.count({
        where: {
          loanId: l.id,
          userId: alice.actor.userId,
          kind: 'LOAN_DUE_PROPOSED',
        },
      }),
    ).toBeGreaterThan(0);
    expect(
      (
        await lending.listLoans(alice.actor, {
          role: 'ANY',
          actionRequired: 'true',
          limit: 100,
        })
      ).items.map((i) => i.id),
    ).toEqual([l.id]);
    l = await act(alice, l, 'accept-due');
    expect(l).toMatchObject({
      dueAt: day('12-28'),
      proposedDueAt: null,
      dueProposedByUserId: null,
    });
    expect(
      (await lending.loanHistory(bob.actor, l.id)).items.map((e) => e.action),
    ).toEqual(
      expect.arrayContaining([
        'loan.propose-due',
        'loan.decline-due',
        'loan.accept-due',
      ]),
    );
  });

  it('audience changes are owner-only and revoke the previous audience immediately', async () => {
    await connect(alice, bob);
    const g = await group();
    const tent = await asset(alice, 'CONNECTIONS');
    const req = await request(bob, tent.id);
    let a = await lending.readAsset(alice.actor, tent.id);
    await status(
      lending.patchAsset(
        bob.actor,
        tent.id,
        { audience: 'PRIVATE' },
        a.revision,
        key(),
      ),
      404,
    );
    await status(
      lending.patchAsset(
        alice.actor,
        tent.id,
        { audience: 'GROUP', groupId: randomUUID() },
        a.revision,
        key(),
      ),
      404,
    );
    a = await lending.patchAsset(
      alice.actor,
      tent.id,
      { audience: 'PRIVATE' },
      a.revision,
      key(),
    );
    expect(a.audience).toBe('PRIVATE');
    await status(lending.readAsset(bob.actor, tent.id), 404);
    expect(
      (await lending.listAssets(bob.actor, { view: 'CONNECTIONS', limit: 100 }))
        .items,
    ).toHaveLength(0);
    expect((await lending.readLoan(bob.actor, req.id)).state).toBe('CANCELED');
    await ok(
      lending.patchAsset(
        alice.actor,
        tent.id,
        { title: 'x' },
        a.revision - 1,
        key(),
      ),
      'REVISION_CONFLICT',
    );
    // Moving to a Group: current members see it; the previous connections audience does not.
    a = await lending.patchAsset(
      alice.actor,
      tent.id,
      { audience: 'GROUP', groupId: g.id },
      a.revision,
      key(),
    );
    expect((await lending.readAsset(bob.actor, tent.id)).groupId).toBe(g.id);
    await connect(alice, carol);
    await status(lending.readAsset(carol.actor, tent.id), 404);
    // An agreed loan survives an audience change.
    let held = await request(bob, tent.id);
    held = await act(alice, held, 'accept');
    a = await lending.patchAsset(
      alice.actor,
      tent.id,
      { audience: 'PRIVATE' },
      a.revision,
      key(),
    );
    expect((await lending.readLoan(bob.actor, held.id)).state).toBe('ACCEPTED');
    await status(lending.readAsset(bob.actor, tent.id), 404);
  });

  it('strict HTTP contracts: auth, Origin, idempotency, overposting and ETags', async () => {
    const login = await request_(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email: alice.email, password })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])
      .map((v) => v.split(';')[0])
      .join('; ');
    const body = { id: randomUUID(), audience: 'PRIVATE', title: 'Drill' };
    await request_(app.getHttpServer())
      .get('/api/v1/social-assets')
      .expect(401);
    await request_(app.getHttpServer())
      .post('/api/v1/social-assets')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body)
      .expect(400);
    await request_(app.getHttpServer())
      .post('/api/v1/social-assets')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .send({ ...body, ownerUserId: bob.actor.userId })
      .expect(400);
    const created = await request_(app.getHttpServer())
      .post('/api/v1/social-assets')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .send(body)
      .expect(201);
    expect(created.headers['etag']).toBe('"1"');
    expect(created.headers['cache-control']).toBe('no-store');
    await request_(app.getHttpServer())
      .post(`/api/v1/social-assets/${body.id}/actions/archive`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .send({})
      .expect(400);
    await request_(app.getHttpServer())
      .post(`/api/v1/social-assets/${body.id}/actions/archive`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .set('If-Match', '"1"')
      .send({})
      .expect(201);
    await request_(app.getHttpServer())
      .post('/api/v1/social-lost-found')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key())
      .send({
        id: randomUUID(),
        kind: 'FOUND',
        audience: 'CONNECTIONS',
        title: 'x',
        assetId: body.id,
      })
      .expect(400);
  });
});
