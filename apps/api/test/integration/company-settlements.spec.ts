import {
  CompanyFinancialApprovalsService,
  CompanyReimbursementsService,
} from '../../src/modules/companies/public/index.js';
import { setImmediate as tick } from 'node:timers/promises';
import { ConflictException } from '@nestjs/common';
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

import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { DatabaseService } from '../../src/platform/database/database.service.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import {
  CompanyAccess,
  SharedKernel,
} from '../../src/modules/spaces/public/index.js';
import {
  CompaniesService,
  CompanyStaffService,
  CompanyEmployeeCasesService,
  CompanyFinanceService,
} from '../../src/modules/companies/public/index.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
type Person = { actor: RequestActor; email: string; cookie: string };
const ref = (m: { id: string; generation: number }) => ({
  accessId: m.id,
  generation: m.generation,
});
describe('P4-04 exact Company finance and receipt privacy', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    client: PrismaClient,
    observer: Client,
    watcher: Client;
  let companies: CompaniesService,
    flows: CompanyFinancialApprovalsService,
    reimburse: CompanyReimbursementsService,
    finance: CompanyFinanceService,
    staff: CompanyStaffService,
    cases: CompanyEmployeeCasesService,
    access: CompanyAccess,
    kernel: SharedKernel,
    control: SharedControl;
  let owner: Person,
    member: Person,
    viewer: Person,
    admin: Person,
    outsider: Person;
  const version = 'synthetic-p404-' + randomUUID(),
    name = 'p404-' + randomUUID(),
    origin = 'http://localhost:3000',
    password = 'synthetic-p404-only-123!';
  let passwordHash: string;
  async function person(cookie = false): Promise<Person> {
    const userId = randomUUID(),
      sessionId = randomUUID(),
      email = randomUUID() + '@example.test';
    await client.user.create({
      data: {
        id: userId,
        name: 'Synthetic staff fixture',
        email,
        emailVerified: true,
      },
    });
    await client.space.create({
      data: { id: randomUUID(), kind: 'PERSONAL', ownerUserId: userId },
    });
    await client.userSettings.create({ data: { userId } });
    await client.authAccount.create({
      data: {
        id: randomUUID(),
        userId,
        accountId: userId,
        providerId: 'credential',
        password: passwordHash,
      },
    });
    await client.authSession.create({
      data: {
        id: sessionId,
        userId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    let actual: string = sessionId,
      token = '';
    if (cookie) {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', origin)
        .send({ email, password })
        .expect(200);
      token = (login.headers['set-cookie'] as unknown as string[])
        .map((v) => v.split(';')[0])
        .join('; ');
      actual = (
        await client.authSession.findFirstOrThrow({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        })
      ).id;
    }
    return {
      email,
      cookie: token,
      actor: {
        userId,
        sessionId: actual,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
    };
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
      throw new Error(
        'Owned staff schema migration failed (credentials withheld)',
      );
    const schema = new URL(sandbox.url).searchParams.get('schema')!,
      base = isolatedTestDatabaseUrl(process.env);
    client = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: base,
          options: '-c timezone=UTC -c search_path=' + schema,
          application_name: name,
          max: 8,
        },
        { schema },
      ),
    });
    const db: DatabaseService = {
      client,
      checkConnection: async () => {
        await client.$queryRaw`SELECT 1`;
      },
      onApplicationShutdown: () => client.$disconnect(),
    };
    const root = fs.mkdtempSync(path.resolve('.tools/p404-fixture-'));
    app = await testApplication({
      databaseUrl: base,
      databaseInstance: db,
      environment: {
        STORAGE_ROOT: path.join(root, 'files'),
        SHARED_CONTROL_ROOT: path.join(root, 'control'),
        SHARED_CONTROL_KEYS: JSON.stringify({
          k1: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'k1',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P402-ONLY',
      },
    });
    control = app.get(SharedControl);
    await control.initialize();
    companies = app.get(CompaniesService);
    finance = app.get(CompanyFinanceService);
    flows = app.get(CompanyFinancialApprovalsService);
    reimburse = app.get(CompanyReimbursementsService);

    staff = app.get(CompanyStaffService);
    cases = app.get(CompanyEmployeeCasesService);
    access = app.get(CompanyAccess);
    kernel = app.get(SharedKernel);
    passwordHash = await (
      await app.get(AuthService).auth.$context
    ).password.hash(password);
    observer = new Client({
      connectionString: base,
      options: '-c timezone=UTC -c search_path=' + schema,
      application_name: name + '-observer',
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
    await client.sharedRetentionPolicy.create({
      data: {
        version,
        approvalReference: 'SYNTHETIC-ONLY',
        configuration: {
          policyVersion: version,
          approvalReference: 'SYNTHETIC-ONLY',
          accountableOperator: 'synthetic operator',
          applicableContexts: ['COMPANY', 'PROJECT'],
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
          backupPolicyReference: 'synthetic independent control',
        },
      },
    });
    owner = await person(true);
    member = await person(true);
    viewer = await person(true);
    admin = await person();
    outsider = await person();
  }, 30000);
  beforeEach(async () => {
    vi.restoreAllMocks();
    await client.sharedRateLimit.deleteMany();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await client?.$disconnect();
    await observer?.end();
    await watcher?.end();
    await sandbox?.close();
  });
  async function company() {
    return companies.create(
      owner.actor,
      {
        id: randomUUID(),
        title: 'Company staff fixture',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
  }
  async function admit(
    id: string,
    who = member,
    role: z.infer<typeof c.CompanyMemberRoleSchema> = 'MEMBER',
    scope = id,
    by = owner,
  ) {
    const offer = await companies.invite(
      by.actor,
      id,
      scope,
      { memberRole: role, recipient: { userId: who.actor.userId } },
      randomUUID(),
    );
    const result = await access.decide(
      who.actor,
      offer.invitation.id,
      offer.proof!,
      1,
      true,
    );
    if (!result.membership) throw new Error('Missing membership');
    return result.membership;
  }
  async function root(id: string, who = owner) {
    return client.contextAccess.findFirstOrThrow({
      where: {
        spaceId: id,
        scopeId: id,
        SharedActor: { userId: who.actor.userId },
      },
    });
  }
  async function fixture() {
    const co = await company(),
      subject = await admit(co.id),
      reviewer = await admit(co.id, admin, 'ORG_ADMIN');
    await admit(co.id, viewer, 'VIEWER');
    return { co, subject, reviewer };
  }
  async function setup(payerWho = member) {
    const f = await fixture();
    if (payerWho !== member && payerWho !== viewer)
      await admit(f.co.id, payerWho);
    const payer = await root(f.co.id, payerWho),
      ownerSeat = await root(f.co.id);
    const category = await finance.categoryCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), title: 'Expenses' },
      randomUUID(),
    );
    const d = await finance.expenseCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      {
        id: randomUUID(),
        amount: '100.00',
        currency: 'USD',
        categoryId: category.id,
        occurredDate: '2026-11-07',
        timezone: 'UTC',
        vendor: 'private finance sentinel',
        payer: ref(payer),
        projectReferenceId: null,
        allocations: [],
      },
      randomUUID(),
    );
    const submitted = await finance.submit(
      owner.actor,
      f.co.id,
      f.co.id,
      d.id,
      1,
      { reviewer: ref(f.reviewer) },
    );
    const expense = await finance.decide(
      admin.actor,
      f.co.id,
      f.co.id,
      d.id,
      submitted.revision,
      { decision: 'APPROVE' },
    );
    return { ...f, payer, payerWho, ownerSeat, category, expense };
  }
  async function workflow(
    f: Awaited<ReturnType<typeof setup>>,
    kind: 'EXPENSE' | 'REIMBURSEMENT' = 'REIMBURSEMENT',
    steps: z.infer<
      typeof c.CompanyFinancialWorkflowVersionInputSchema
    >['steps'] = [
      {
        label: 'Review',
        primary: ref(f.ownerSeat),
        alternate: ref(f.reviewer),
      },
    ],
  ) {
    const w = await flows.workflowCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), kind, title: 'Financial review' },
      randomUUID(),
    );
    const draft = await flows.versionCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      w.id,
      { id: randomUUID(), title: 'Review version', steps },
      randomUUID(),
    );
    const v = await flows.versionState(
      owner.actor,
      f.co.id,
      f.co.id,
      draft.id,
      1,
      true,
    );
    return { w, v };
  }
  async function requestApproved(
    f: Awaited<ReturnType<typeof setup>>,
    value = '100.00',
  ) {
    const { v } = await workflow(f);
    const r = await reimburse.create(
      f.payerWho.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), expenseId: f.expense.id, amount: value },
      randomUUID(),
    );
    const a = await flows.reimbursementSubmit(
      f.payerWho.actor,
      f.co.id,
      f.co.id,
      r.id,
      r.revision,
      { workflowVersionId: v.id },
    );
    await flows.decision(owner.actor, f.co.id, f.co.id, a.id, a.revision, {
      decision: 'APPROVE',
    });
    return reimburse.read(f.payerWho.actor, f.co.id, f.co.id, r.id);
  }
  async function payment(
    f: Awaited<ReturnType<typeof setup>>,
    requestId: string,
    value = '30.00',
  ) {
    return reimburse.proposePayment(
      owner.actor,
      f.co.id,
      f.co.id,
      requestId,
      {
        id: randomUUID(),
        amount: value,
        reference: 'private payment reference',
      },
      randomUUID(),
    );
  }
  it('keeps approval separate from partial two-party acknowledgement and never spends the expense twice', async () => {
    const f = await setup(),
      r = await requestApproved(f);
    expect(r.acknowledged).toBe('0.00');
    expect(r.reserved).toBe('100.00');
    const p = await payment(f, r.id);
    expect(
      (await reimburse.read(member.actor, f.co.id, f.co.id, r.id)).acknowledged,
    ).toBe('0.00');
    await expect(
      reimburse.paymentDecision(owner.actor, f.co.id, f.co.id, p.id, 1, {
        decision: 'ACKNOWLEDGE',
      }),
    ).rejects.toThrow();
    await reimburse.paymentDecision(member.actor, f.co.id, f.co.id, p.id, 1, {
      decision: 'ACKNOWLEDGE',
    });
    const after = await reimburse.read(member.actor, f.co.id, f.co.id, r.id);
    expect([
      after.acknowledged,
      after.reserved,
      after.pending,
      after.settlement,
    ]).toEqual(['30.00', '70.00', '0.00', 'PARTIAL']);
    expect(
      await client.companyBudgetEffect.count({ where: { spaceId: f.co.id } }),
    ).toBe(0);
    await expect(
      reimburse.paymentDecision(member.actor, f.co.id, f.co.id, p.id, 1, {
        decision: 'ACKNOWLEDGE',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('serializes competing approvals against the exact remaining reimbursement entitlement', async () => {
    const f = await setup(),
      { v } = await workflow(f);
    const approvals = [];
    for (let n = 0; n < 2; n++) {
      const r = await reimburse.create(
        member.actor,
        f.co.id,
        f.co.id,
        { id: randomUUID(), expenseId: f.expense.id, amount: '70.00' },
        randomUUID(),
      );
      approvals.push(
        await flows.reimbursementSubmit(
          member.actor,
          f.co.id,
          f.co.id,
          r.id,
          1,
          { workflowVersionId: v.id },
        ),
      );
    }
    const result = await Promise.allSettled(
      approvals.map((a) =>
        flows.decision(owner.actor, f.co.id, f.co.id, a.id, 1, {
          decision: 'APPROVE',
        }),
      ),
    );
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (
        await reimburse.balances(owner.actor, f.co.id, f.co.id, f.expense.id, {
          limit: 10,
        })
      ).items[0]?.reserved,
    ).toBe('70.00');
  });
  it('reserves competing partial payment assertions, releases disputes and closes only unused approved money', async () => {
    const f = await setup(),
      r = await requestApproved(f);
    const result = await Promise.allSettled([
      payment(f, r.id, '70.00'),
      payment(f, r.id, '70.00'),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const p = (
      await reimburse.payments(member.actor, f.co.id, f.co.id, r.id, {
        limit: 10,
      })
    ).items[0]!;
    await expect(
      reimburse.close(member.actor, f.co.id, f.co.id, r.id, r.revision),
    ).rejects.toThrow();
    await reimburse.paymentDecision(member.actor, f.co.id, f.co.id, p.id, 1, {
      decision: 'DISPUTE',
    });
    const closed = await reimburse.close(
      member.actor,
      f.co.id,
      f.co.id,
      r.id,
      r.revision,
    );
    expect([closed.state, closed.reserved, closed.acknowledged]).toEqual([
      'CLOSED',
      '0.00',
      '0.00',
    ]);
  });
  it('corrects acknowledged evidence with append-only two-party records', async () => {
    const f = await setup(),
      r = await requestApproved(f),
      p = await payment(f, r.id);
    await reimburse.paymentDecision(member.actor, f.co.id, f.co.id, p.id, 1, {
      decision: 'ACKNOWLEDGE',
    });
    const original =
      await client.companyPaymentAcknowledgement.findUniqueOrThrow({
        where: { id: p.id },
      });
    const correction = await reimburse.proposeCorrection(
      admin.actor,
      f.co.id,
      f.co.id,
      p.id,
      { id: randomUUID(), amount: '10.00', reason: 'Record correction only' },
      randomUUID(),
    );
    expect(
      (await reimburse.read(member.actor, f.co.id, f.co.id, r.id)).acknowledged,
    ).toBe('30.00');
    await expect(
      reimburse.correctionDecision(
        admin.actor,
        f.co.id,
        f.co.id,
        correction.id,
        1,
        { decision: 'ACKNOWLEDGE' },
      ),
    ).rejects.toThrow();
    await reimburse.correctionDecision(
      member.actor,
      f.co.id,
      f.co.id,
      correction.id,
      1,
      { decision: 'ACKNOWLEDGE' },
    );
    expect(
      await client.companyPaymentAcknowledgement.findUniqueOrThrow({
        where: { id: p.id },
      }),
    ).toEqual(original);
    const after = await reimburse.read(member.actor, f.co.id, f.co.id, r.id);
    expect([after.acknowledged, after.reserved]).toEqual(['20.00', '80.00']);
    await expect(
      reimburse.proposeCorrection(
        owner.actor,
        f.co.id,
        f.co.id,
        p.id,
        { id: randomUUID(), amount: '21.00', reason: 'excess' },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('retains acknowledged amounts after settled expense correction and reports exact reconciliation excess', async () => {
    const f = await setup(),
      r = await requestApproved(f),
      p = await payment(f, r.id, '80.00');
    await reimburse.paymentDecision(member.actor, f.co.id, f.co.id, p.id, 1, {
      decision: 'ACKNOWLEDGE',
    });
    const correction = await finance.correction(
      owner.actor,
      f.co.id,
      f.co.id,
      f.expense.id,
      f.expense.revision,
      {
        amount: '50.00',
        currency: 'USD',
        categoryId: f.category.id,
        occurredDate: '2026-11-07',
        timezone: 'UTC',
        vendor: null,
        payer: ref(f.payer),
        projectReferenceId: null,
        allocations: [],
      },
      randomUUID(),
    );
    const s = await finance.submit(
      owner.actor,
      f.co.id,
      f.co.id,
      f.expense.id,
      correction.revision,
      { reviewer: ref(f.reviewer) },
    );
    await finance.decide(
      admin.actor,
      f.co.id,
      f.co.id,
      f.expense.id,
      s.revision,
      { decision: 'APPROVE' },
    );
    expect(
      (await reimburse.read(member.actor, f.co.id, f.co.id, r.id)).state,
    ).toBe('INVALIDATED');
    const b = (
      await reimburse.balances(owner.actor, f.co.id, f.co.id, f.expense.id, {
        limit: 10,
      })
    ).items[0]!;
    expect([
      b.entitlement,
      b.acknowledged,
      b.reserved,
      b.excess,
      b.reconciliationRequired,
    ]).toEqual(['50.00', '80.00', '0.00', '30.00', true]);
    const next = await reimburse.create(
        member.actor,
        f.co.id,
        f.co.id,
        { id: randomUUID(), expenseId: f.expense.id, amount: '1.00' },
        randomUUID(),
      ),
      { v } = await workflow(f),
      a = await flows.reimbursementSubmit(
        member.actor,
        f.co.id,
        f.co.id,
        next.id,
        1,
        { workflowVersionId: v.id },
      );
    await expect(
      flows.decision(owner.actor, f.co.id, f.co.id, a.id, 1, {
        decision: 'APPROVE',
      }),
    ).rejects.toThrow();
  });
  it('keeps multi-step expense approval optional and prevents legacy decision or reassignment bypass', async () => {
    const f = await setup(),
      extra = await person(),
      last = await admit(f.co.id, extra, 'ORG_ADMIN');
    const { v } = await workflow(f, 'EXPENSE', [
      { label: 'First', primary: ref(f.reviewer), alternate: null },
      { label: 'Final', primary: ref(last), alternate: null },
    ]);
    const d = await finance.expenseCreate(
      member.actor,
      f.co.id,
      f.co.id,
      {
        id: randomUUID(),
        amount: '10.00',
        currency: 'USD',
        categoryId: f.category.id,
        occurredDate: '2026-11-07',
        timezone: 'UTC',
        vendor: null,
        payer: ref(f.subject),
        projectReferenceId: null,
        allocations: [],
      },
      randomUUID(),
    );
    const a = await flows.expenseSubmit(
      member.actor,
      f.co.id,
      f.co.id,
      d.id,
      1,
      { workflowVersionId: v.id },
    );
    await expect(
      finance.decide(admin.actor, f.co.id, f.co.id, d.id, 2, {
        decision: 'APPROVE',
      }),
    ).rejects.toThrow();
    await expect(
      finance.submit(
        member.actor,
        f.co.id,
        f.co.id,
        d.id,
        2,
        { reviewer: ref(f.ownerSeat) },
        true,
      ),
    ).rejects.toThrow();
    const next = await flows.decision(admin.actor, f.co.id, f.co.id, a.id, 1, {
      decision: 'APPROVE',
    });
    expect(
      (await finance.expense(member.actor, f.co.id, f.co.id, d.id)).state,
    ).toBe('PENDING');
    await expect(
      flows.decision(admin.actor, f.co.id, f.co.id, a.id, next.revision, {
        decision: 'APPROVE',
      }),
    ).rejects.toThrow();
    await flows.decision(extra.actor, f.co.id, f.co.id, a.id, next.revision, {
      decision: 'APPROVE',
    });
    expect(
      (await finance.expense(member.actor, f.co.id, f.co.id, d.id)).state,
    ).toBe('APPROVED');
  });
  it('pins immutable workflow versions, escalates only to the alternate and invalidates the previous pending reviewer', async () => {
    const f = await setup(),
      { v } = await workflow(f);
    await expect(
      flows.versionPatch(owner.actor, f.co.id, f.co.id, v.id, v.revision, {
        title: 'changed',
        steps: [],
      }),
    ).rejects.toThrow();
    const r = await reimburse.create(
      member.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), expenseId: f.expense.id, amount: '20.00' },
      randomUUID(),
    );
    const a = await flows.reimbursementSubmit(
      member.actor,
      f.co.id,
      f.co.id,
      r.id,
      1,
      { workflowVersionId: v.id },
    );
    const escalated = await flows.escalate(
      member.actor,
      f.co.id,
      f.co.id,
      a.id,
      1,
    );
    await expect(
      flows.decision(owner.actor, f.co.id, f.co.id, a.id, escalated.revision, {
        decision: 'APPROVE',
      }),
    ).rejects.toThrow();
    await flows.decision(
      admin.actor,
      f.co.id,
      f.co.id,
      a.id,
      escalated.revision,
      { decision: 'APPROVE' },
    );
    const events = await flows.events(member.actor, f.co.id, f.co.id, a.id, {
      limit: 10,
    });
    expect(events.items.map((e) => e.action).sort()).toEqual([
      'APPROVE',
      'ESCALATE',
      'SUBMIT',
    ]);
  });
  it('restarts unchanged submitted facts under a newly published version without reusing prior decisions', async () => {
    const f = await setup(),
      first = await workflow(f),
      second = await workflow(f);
    const r = await reimburse.create(
      member.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), expenseId: f.expense.id, amount: '30.00' },
      randomUUID(),
    );
    const a = await flows.reimbursementSubmit(
      member.actor,
      f.co.id,
      f.co.id,
      r.id,
      1,
      { workflowVersionId: first.v.id },
    );
    const restarted = await flows.restart(
      member.actor,
      f.co.id,
      f.co.id,
      a.id,
      1,
      { workflowVersionId: second.v.id },
    );
    expect(restarted.attempt).toBe(2);
    await expect(
      flows.decision(owner.actor, f.co.id, f.co.id, a.id, 1, {
        decision: 'APPROVE',
      }),
    ).rejects.toThrow();
    await flows.decision(owner.actor, f.co.id, f.co.id, restarted.id, 1, {
      decision: 'APPROVE',
    });
    expect(
      (await reimburse.read(member.actor, f.co.id, f.co.id, r.id)).reserved,
    ).toBe('30.00');
  });
  it('rejects proxy claims, self-approval designations, stale generations and unrelated financial readers', async () => {
    const f = await setup();
    await expect(
      reimburse.create(
        owner.actor,
        f.co.id,
        f.co.id,
        { id: randomUUID(), expenseId: f.expense.id, amount: '20.00' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const r = await reimburse.create(
      member.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), expenseId: f.expense.id, amount: '20.00' },
      randomUUID(),
    );
    await expect(
      reimburse.read(viewer.actor, f.co.id, f.co.id, r.id),
    ).rejects.toThrow();
    await expect(
      reimburse.read(outsider.actor, f.co.id, f.co.id, r.id),
    ).rejects.toThrow();
    await companies.changeMember(
      owner.actor,
      f.co.id,
      f.co.id,
      f.subject.id,
      f.subject.revision,
      { state: 'REVOKED', memberRole: 'MEMBER' },
    );
    await admit(f.co.id, member, 'MEMBER');
    await expect(
      reimburse.read(member.actor, f.co.id, f.co.id, r.id),
    ).rejects.toThrow();
  });
  it('exposes session-protected APIs and rejects real-payment/provider fields', async () => {
    const f = await setup(),
      route =
        '/api/v1/companies/' +
        f.co.id +
        '/contexts/' +
        f.co.id +
        '/reimbursements';
    await request(app.getHttpServer()).get(route).expect(401);
    await request(app.getHttpServer())
      .post(route)
      .set('Origin', origin)
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        id: randomUUID(),
        expenseId: f.expense.id,
        amount: '20.00',
        provider: 'external',
      })
      .expect(400);
    const response = await request(app.getHttpServer())
      .post(route)
      .set('Origin', origin)
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ id: randomUUID(), expenseId: f.expense.id, amount: '20.00' })
      .expect(201);
    expect(response.body.state).toBe('DRAFT');
  });
  it('requires distinct requestor and payer approvers even when they are financial managers', async () => {
    const f = await setup();
    await companies.changeMember(
      owner.actor,
      f.co.id,
      f.co.id,
      f.subject.id,
      f.subject.revision,
      { state: 'ACTIVE', memberRole: 'ORG_ADMIN' },
    );
    const { v } = await workflow(f, 'REIMBURSEMENT', [
      {
        label: 'Invalid self review',
        primary: ref(f.subject),
        alternate: null,
      },
    ]);
    const r = await reimburse.create(
      member.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), expenseId: f.expense.id, amount: '20.00' },
      randomUUID(),
    );
    await expect(
      flows.reimbursementSubmit(member.actor, f.co.id, f.co.id, r.id, 1, {
        workflowVersionId: v.id,
      }),
    ).rejects.toThrow();
    const good = await requestApproved(f);
    await expect(
      reimburse.proposePayment(
        member.actor,
        f.co.id,
        f.co.id,
        good.id,
        { id: randomUUID(), amount: '1.00', reference: null },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('keeps acknowledged history immutable at database level and denies excess decimal precision', async () => {
    const f = await setup(),
      r = await requestApproved(f),
      p = await payment(f, r.id);
    await reimburse.paymentDecision(member.actor, f.co.id, f.co.id, p.id, 1, {
      decision: 'ACKNOWLEDGE',
    });
    await expect(
      client.companyPaymentAcknowledgement.update({
        where: { id: p.id },
        data: { amount: '99.00', revision: { increment: 1 } },
      }),
    ).rejects.toThrow();
    await expect(
      client.companyReimbursementRequest.update({
        where: { id: r.id },
        data: { amount: '99.00', revision: { increment: 1 } },
      }),
    ).rejects.toThrow();
    await expect(
      client.companyReimbursementEffect.updateMany({
        where: { requestId: r.id },
        data: { acknowledged: '0.00' },
      }),
    ).rejects.toThrow();
    await expect(payment(f, r.id, '1.001')).rejects.toThrow();
    expect(
      (await reimburse.read(member.actor, f.co.id, f.co.id, r.id)).acknowledged,
    ).toBe('30.00');
  });
  it('archives published versions without altering pinned instances and rejects new bindings', async () => {
    const f = await setup(),
      { v } = await workflow(f);
    const r = await reimburse.create(
        member.actor,
        f.co.id,
        f.co.id,
        { id: randomUUID(), expenseId: f.expense.id, amount: '20.00' },
        randomUUID(),
      ),
      a = await flows.reimbursementSubmit(
        member.actor,
        f.co.id,
        f.co.id,
        r.id,
        1,
        { workflowVersionId: v.id },
      );
    await flows.versionState(
      owner.actor,
      f.co.id,
      f.co.id,
      v.id,
      v.revision,
      false,
    );
    await flows.decision(owner.actor, f.co.id, f.co.id, a.id, 1, {
      decision: 'APPROVE',
    });
    const next = await reimburse.create(
      member.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), expenseId: f.expense.id, amount: '10.00' },
      randomUUID(),
    );
    await expect(
      flows.reimbursementSubmit(member.actor, f.co.id, f.co.id, next.id, 1, {
        workflowVersionId: v.id,
      }),
    ).rejects.toThrow();
    const step = await client.companyFinancialWorkflowStep.findFirstOrThrow({
      where: { versionId: v.id },
    });
    await expect(
      client.companyFinancialWorkflowStep.update({
        where: { id: step.id },
        data: { label: 'rewritten', revision: { increment: 1 } },
      }),
    ).rejects.toThrow();
  });
  it('releases disputed assertions after author revocation but never accepts stale managerial authority', async () => {
    const f = await setup(),
      r = await requestApproved(f);
    const p = await reimburse.proposePayment(
      admin.actor,
      f.co.id,
      f.co.id,
      r.id,
      { id: randomUUID(), amount: '30.00', reference: null },
      randomUUID(),
    );
    await companies.changeMember(
      owner.actor,
      f.co.id,
      f.co.id,
      f.reviewer.id,
      f.reviewer.revision,
      { state: 'REVOKED', memberRole: 'ORG_ADMIN' },
    );
    await expect(
      reimburse.paymentDecision(member.actor, f.co.id, f.co.id, p.id, 1, {
        decision: 'ACKNOWLEDGE',
      }),
    ).rejects.toThrow();
    await reimburse.paymentDecision(member.actor, f.co.id, f.co.id, p.id, 1, {
      decision: 'DISPUTE',
    });
    expect(
      (await reimburse.read(member.actor, f.co.id, f.co.id, r.id)).pending,
    ).toBe('0.00');
  });
  it('cancels source approvals atomically and rejects a canceled or rejected instance', async () => {
    const f = await setup(),
      { v } = await workflow(f);
    const r = await reimburse.create(
        member.actor,
        f.co.id,
        f.co.id,
        { id: randomUUID(), expenseId: f.expense.id, amount: '20.00' },
        randomUUID(),
      ),
      a = await flows.reimbursementSubmit(
        member.actor,
        f.co.id,
        f.co.id,
        r.id,
        1,
        { workflowVersionId: v.id },
      );
    await reimburse.cancel(member.actor, f.co.id, f.co.id, r.id, 2);
    expect(
      (await flows.approval(member.actor, f.co.id, f.co.id, a.id)).state,
    ).toBe('CANCELED');
    await expect(
      flows.decision(owner.actor, f.co.id, f.co.id, a.id, 1, {
        decision: 'APPROVE',
      }),
    ).rejects.toThrow();
    const r2 = await reimburse.create(
        member.actor,
        f.co.id,
        f.co.id,
        { id: randomUUID(), expenseId: f.expense.id, amount: '20.00' },
        randomUUID(),
      ),
      a2 = await flows.reimbursementSubmit(
        member.actor,
        f.co.id,
        f.co.id,
        r2.id,
        1,
        { workflowVersionId: v.id },
      );
    await flows.decision(owner.actor, f.co.id, f.co.id, a2.id, 1, {
      decision: 'REJECT',
    });
    expect(
      (await reimburse.read(member.actor, f.co.id, f.co.id, r2.id)).reserved,
    ).toBe('0.00');
  });
  it('reverses acknowledged entitlement without rewriting payment facts or reviving old payout authority', async () => {
    const f = await setup(),
      r = await requestApproved(f),
      p = await payment(f, r.id, '100.00');
    await reimburse.paymentDecision(member.actor, f.co.id, f.co.id, p.id, 1, {
      decision: 'ACKNOWLEDGE',
    });
    const before = await client.companyPaymentAcknowledgement.findUniqueOrThrow(
      { where: { id: p.id } },
    );
    const reverse = await finance.correction(
      owner.actor,
      f.co.id,
      f.co.id,
      f.expense.id,
      f.expense.revision,
      null,
      randomUUID(),
    );
    const pending = await finance.submit(
      owner.actor,
      f.co.id,
      f.co.id,
      f.expense.id,
      reverse.revision,
      { reviewer: ref(f.reviewer) },
    );
    await finance.decide(
      admin.actor,
      f.co.id,
      f.co.id,
      f.expense.id,
      pending.revision,
      { decision: 'APPROVE' },
    );
    const b = (
      await reimburse.balances(owner.actor, f.co.id, f.co.id, f.expense.id, {
        limit: 10,
      })
    ).items[0]!;
    expect([b.entitlement, b.acknowledged, b.excess]).toEqual([
      '0.00',
      '100.00',
      '100.00',
    ]);
    expect(
      await client.companyPaymentAcknowledgement.findUniqueOrThrow({
        where: { id: p.id },
      }),
    ).toEqual(before);
    const correction = await reimburse.proposeCorrection(
      owner.actor,
      f.co.id,
      f.co.id,
      p.id,
      { id: randomUUID(), amount: '100.00', reason: 'Record reconciliation' },
      randomUUID(),
    );
    await reimburse.correctionDecision(
      member.actor,
      f.co.id,
      f.co.id,
      correction.id,
      1,
      { decision: 'ACKNOWLEDGE' },
    );
    const reconciled = (
      await reimburse.balances(owner.actor, f.co.id, f.co.id, f.expense.id, {
        limit: 10,
      })
    ).items[0]!;
    expect([
      reconciled.excess,
      reconciled.reserved,
      reconciled.acknowledged,
    ]).toEqual(['0.00', '0.00', '0.00']);
  });
  it('retains pseudonymous acknowledged evidence while allowing independent Personal identity erasure', async () => {
    const who = await person(),
      f = await setup(who),
      r = await requestApproved(f),
      p = await payment(f, r.id);
    await reimburse.paymentDecision(who.actor, f.co.id, f.co.id, p.id, 1, {
      decision: 'ACKNOWLEDGE',
    });
    const closedAt = new Date();
    await client.space.updateMany({
      where: { ownerUserId: who.actor.userId, kind: 'PERSONAL' },
      data: { accessClosedAt: closedAt },
    });
    for (let pass = 0; pass < 3; pass++)
      if (await kernel.prepareIdentityErasure(who.actor.userId, closedAt))
        break;
    expect(
      (
        await client.sharedActor.findUniqueOrThrow({
          where: { id: f.payer.actorId },
        })
      ).userId,
    ).toBeNull();
    expect(
      (await reimburse.read(owner.actor, f.co.id, f.co.id, r.id)).acknowledged,
    ).toBe('30.00');
    await expect(
      reimburse.read(who.actor, f.co.id, f.co.id, r.id),
    ).rejects.toThrow();
  });
  it('adds no staff-case rights and excludes monetary reference and staff payloads from generic evidence', async () => {
    const f = await setup(),
      reviewer = await admit(f.co.id, await person(), 'ORG_ADMIN');
    const profile = await staff.createProfile(
      owner.actor,
      f.co.id,
      f.co.id,
      {
        id: randomUUID(),
        member: ref(f.subject),
        position: 'private staff sentinel',
        supervisor: null,
        workStatus: 'ACTIVE',
      },
      randomUUID(),
    );
    const employeeCase = await cases.create(
      owner.actor,
      f.co.id,
      f.co.id,
      {
        id: randomUUID(),
        subject: ref(f.subject),
        reviewer: ref(reviewer),
        reason: 'private staff case sentinel',
        evidence: 'private evidence',
      },
      randomUUID(),
    );
    const r = await requestApproved(f);
    await payment(f, r.id);
    await expect(
      cases.read(admin.actor, f.co.id, f.co.id, employeeCase.id),
    ).rejects.toThrow();
    expect(profile.position).toBe('private staff sentinel');
    const encoded = JSON.stringify(
      [
        await client.sharedAuditEvent.findMany({ where: { spaceId: f.co.id } }),
        await client.sharedOutboxEvent.findMany({
          where: { spaceId: f.co.id },
        }),
        await client.sharedMutationReceipt.findMany({
          where: { spaceId: f.co.id },
        }),
        await control.replayEvidence(),
      ],
      (_, v) => (typeof v === 'bigint' ? String(v) : v),
    );
    for (const secret of [
      'private finance sentinel',
      'private payment reference',
      'private staff sentinel',
      'private staff case sentinel',
    ])
      expect(encoded).not.toContain(secret);
  });
  it('requires explicit child admission while preserving scoped root manager and Department authority', async () => {
    const f = await setup(),
      dept = await companies.createContext(
        owner.actor,
        f.co.id,
        null,
        { id: randomUUID(), title: 'Department' },
        randomUUID(),
      );
    await expect(
      flows.workflowCreate(
        owner.actor,
        f.co.id,
        dept.id,
        {
          id: randomUUID(),
          title: 'Denied implicit child',
          kind: 'REIMBURSEMENT',
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const ownerChild = await admit(f.co.id, owner, 'VIEWER', dept.id, admin),
      adminChild = await admit(f.co.id, admin, 'MEMBER', dept.id),
      payer = await admit(f.co.id, member, 'MEMBER', dept.id);
    const category = await finance.categoryCreate(
      owner.actor,
      f.co.id,
      dept.id,
      { id: randomUUID(), title: 'Department' },
      randomUUID(),
    );
    const d = await finance.expenseCreate(
      owner.actor,
      f.co.id,
      dept.id,
      {
        id: randomUUID(),
        amount: '10.00',
        currency: 'USD',
        categoryId: category.id,
        occurredDate: '2026-11-07',
        timezone: 'UTC',
        vendor: null,
        payer: ref(payer),
        projectReferenceId: null,
        allocations: [],
      },
      randomUUID(),
    );
    const submitted = await finance.submit(
      owner.actor,
      f.co.id,
      dept.id,
      d.id,
      1,
      { reviewer: ref(adminChild) },
    );
    await finance.decide(
      admin.actor,
      f.co.id,
      dept.id,
      d.id,
      submitted.revision,
      { decision: 'APPROVE' },
    );
    const w = await flows.workflowCreate(
        owner.actor,
        f.co.id,
        dept.id,
        { id: randomUUID(), title: 'Scoped review', kind: 'REIMBURSEMENT' },
        randomUUID(),
      ),
      draft = await flows.versionCreate(
        owner.actor,
        f.co.id,
        dept.id,
        w.id,
        {
          id: randomUUID(),
          title: 'Scoped version',
          steps: [
            {
              label: 'Review',
              primary: ref(ownerChild),
              alternate: ref(adminChild),
            },
          ],
        },
        randomUUID(),
      ),
      v = await flows.versionState(
        owner.actor,
        f.co.id,
        dept.id,
        draft.id,
        1,
        true,
      );
    const r = await reimburse.create(
        member.actor,
        f.co.id,
        dept.id,
        { id: randomUUID(), expenseId: d.id, amount: '10.00' },
        randomUUID(),
      ),
      a = await flows.reimbursementSubmit(
        member.actor,
        f.co.id,
        dept.id,
        r.id,
        1,
        { workflowVersionId: v.id },
      );
    await flows.decision(owner.actor, f.co.id, dept.id, a.id, 1, {
      decision: 'APPROVE',
    });
    expect(
      (await reimburse.read(member.actor, f.co.id, dept.id, r.id)).reserved,
    ).toBe('10.00');
    await expect(
      reimburse.read(member.actor, f.co.id, f.co.id, r.id),
    ).rejects.toThrow();
  });
  it('denies approval after a winning revocation with an observed PostgreSQL lock wait', async () => {
    const f = await setup(),
      { v } = await workflow(f),
      r = await reimburse.create(
        member.actor,
        f.co.id,
        f.co.id,
        { id: randomUUID(), expenseId: f.expense.id, amount: '20.00' },
        randomUUID(),
      ),
      a = await flows.reimbursementSubmit(
        member.actor,
        f.co.id,
        f.co.id,
        r.id,
        1,
        { workflowVersionId: v.id },
      );
    let entered!: () => void, release!: () => void;
    const atFence = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      canCommit = new Promise<void>((resolve) => {
        release = resolve;
      }),
      original = kernel.offerEffect.bind(kernel);
    vi.spyOn(kernel, 'offerEffect').mockImplementation(async (...args) => {
      if (args[4] === 'company.membership.change') {
        entered();
        await canCommit;
      }
      return original(...args);
    });
    const revoked = companies.changeMember(
      owner.actor,
      f.co.id,
      f.co.id,
      f.subject.id,
      f.subject.revision,
      { state: 'REVOKED', memberRole: 'MEMBER' },
    );
    await atFence;
    const decision = flows
      .decision(owner.actor, f.co.id, f.co.id, a.id, 1, { decision: 'APPROVE' })
      .then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      );
    try {
      const deadline = Date.now() + 5000;
      let observed = false;
      while (Date.now() < deadline) {
        const wait = await watcher.query<{ n: number }>(
          `SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0`,
          [name],
        );
        if (wait.rows[0]!.n) {
          observed = true;
          break;
        }
        await tick();
      }
      expect(observed).toBe(true);
    } finally {
      release();
    }
    await revoked;
    expect((await decision).error).not.toBeNull();
    expect(
      (await reimburse.read(owner.actor, f.co.id, f.co.id, r.id)).reserved,
    ).toBe('0.00');
  });
  it('hides unrelated financial IDs on writes and retains only a claimant’s pinned historical version', async () => {
    const f = await setup(),
      { v } = await workflow(f),
      r = await reimburse.create(
        member.actor,
        f.co.id,
        f.co.id,
        { id: randomUUID(), expenseId: f.expense.id, amount: '10.00' },
        randomUUID(),
      );
    await flows.reimbursementSubmit(member.actor, f.co.id, f.co.id, r.id, 1, {
      workflowVersionId: v.id,
    });
    await flows.versionState(
      owner.actor,
      f.co.id,
      f.co.id,
      v.id,
      v.revision,
      false,
    );
    expect(
      (await flows.version(member.actor, f.co.id, f.co.id, v.id)).state,
    ).toBe('ARCHIVED');
    await expect(
      flows.version(viewer.actor, f.co.id, f.co.id, v.id),
    ).rejects.toHaveProperty('status', 404);
    for (const expenseId of [f.expense.id, randomUUID()])
      await expect(
        reimburse.create(
          viewer.actor,
          f.co.id,
          f.co.id,
          { id: randomUUID(), expenseId, amount: '1.00' },
          randomUUID(),
        ),
      ).rejects.toHaveProperty('status', 404);
    for (const target of [r.id, randomUUID()]) {
      await expect(
        reimburse.patch(viewer.actor, f.co.id, f.co.id, target, 1, {
          amount: '1.00',
        }),
      ).rejects.toHaveProperty('status', 404);
      await expect(
        reimburse.cancel(viewer.actor, f.co.id, f.co.id, target, 1),
      ).rejects.toHaveProperty('status', 404);
      await expect(
        reimburse.close(viewer.actor, f.co.id, f.co.id, target, 1),
      ).rejects.toHaveProperty('status', 404);
      await expect(
        flows.reimbursementSubmit(viewer.actor, f.co.id, f.co.id, target, 1, {
          workflowVersionId: v.id,
        }),
      ).rejects.toHaveProperty('status', 404);
    }
    await expect(
      flows.expenseSubmit(
        viewer.actor,
        f.co.id,
        f.co.id,
        f.expense.id,
        f.expense.revision,
        { workflowVersionId: v.id },
      ),
    ).rejects.toHaveProperty('status', 404);
  });
});
