import { Readable } from 'node:stream';
import { SharedFiles } from '../../src/platform/storage/public/index.js';
import {
  ProjectsService,
  ProjectCleanupService,
} from '../../src/modules/projects/public/index.js';
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
  CompanyReceiptService,
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
describe('P4-03 exact Company finance and receipt privacy', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    client: PrismaClient,
    observer: Client,
    watcher: Client;
  let companies: CompaniesService,
    finance: CompanyFinanceService,
    receipts: CompanyReceiptService,
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
  const version = 'synthetic-p403-' + randomUUID(),
    name = 'p403-' + randomUUID(),
    origin = 'http://localhost:3000',
    password = 'synthetic-p403-only-123!';
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
    const root = fs.mkdtempSync(path.resolve('.tools/p403-fixture-'));
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
    receipts = app.get(CompanyReceiptService);
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
  const facts = (
    categoryId: string,
    amount = '20.00',
    allocations: z.infer<typeof c.CompanyExpenseAllocationInputSchema>[] = [],
  ) => ({
    amount,
    currency: 'USD',
    categoryId,
    occurredDate: '2026-11-07',
    timezone: 'UTC',
    vendor: 'Private vendor sentinel',
    payer: null,
    projectReferenceId: null,
    allocations,
  });
  async function setup() {
    const f = await fixture();
    const category = await finance.categoryCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), title: 'Private category' },
      randomUUID(),
    );
    const budget = await finance.budgetCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      {
        id: randomUUID(),
        title: 'Budget',
        amount: '100.00',
        currency: 'USD',
        startDate: '2026-01-01',
        endDate: '2027-01-01',
        timezone: 'UTC',
        projectReferenceId: null,
      },
      randomUUID(),
    );
    return { ...f, category, budget };
  }
  async function draft(
    f: Awaited<ReturnType<typeof setup>>,
    value = '20.00',
    commitmentId: string | null = null,
  ) {
    return finance.expenseCreate(
      member.actor,
      f.co.id,
      f.co.id,
      {
        id: randomUUID(),
        ...facts(f.category.id, value, [
          { budgetId: f.budget.id, commitmentId, amount: value },
        ]),
      },
      randomUUID(),
    );
  }
  async function approved(
    f: Awaited<ReturnType<typeof setup>>,
    value = '20.00',
    commitmentId: string | null = null,
  ) {
    const d = await draft(f, value, commitmentId);
    const s = await finance.submit(
      member.actor,
      f.co.id,
      f.co.id,
      d.id,
      d.revision,
      { reviewer: ref(f.reviewer) },
    );
    return finance.decide(admin.actor, f.co.id, f.co.id, d.id, s.revision, {
      decision: 'APPROVE',
    });
  }
  it('counts only approval, consumes reservations once and preserves canonical exact amounts', async () => {
    const f = await setup();
    const r = await finance.commitmentCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      f.budget.id,
      { id: randomUUID(), amount: '30.00' },
      randomUUID(),
    );
    const d = await draft(f, '20.00', r.id);
    expect(
      (await finance.budget(owner.actor, f.co.id, f.co.id, f.budget.id)).spent,
    ).toBe('0.00');
    const submitted = await finance.submit(
      member.actor,
      f.co.id,
      f.co.id,
      d.id,
      1,
      { reviewer: ref(f.reviewer) },
    );
    await finance.decide(
      admin.actor,
      f.co.id,
      f.co.id,
      d.id,
      submitted.revision,
      { decision: 'APPROVE' },
    );
    const b = await finance.budget(owner.actor, f.co.id, f.co.id, f.budget.id);
    expect([b.spent, b.reserved, b.available]).toEqual([
      '20.00',
      '10.00',
      '70.00',
    ]);
    await expect(
      finance.decide(admin.actor, f.co.id, f.co.id, d.id, submitted.revision, {
        decision: 'APPROVE',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects over-reservation and reductions below encumbered totals without unresolved intent', async () => {
    const f = await setup();
    await finance.commitmentCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      f.budget.id,
      { id: randomUUID(), amount: '80.00' },
      randomUUID(),
    );
    await expect(
      finance.commitmentCreate(
        owner.actor,
        f.co.id,
        f.co.id,
        f.budget.id,
        { id: randomUUID(), amount: '30.00' },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      finance.budgetChange(owner.actor, f.co.id, f.co.id, f.budget.id, 1, {
        amount: '21.00',
        direction: 'DECREASE',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (await finance.budget(owner.actor, f.co.id, f.co.id, f.budget.id))
        .available,
    ).toBe('20.00');
  });
  it('keeps approved facts effective until correction approval and retains inverse ledger history', async () => {
    const f = await setup();
    const old = await approved(f);
    const original = await client.companyExpenseVersion.findUniqueOrThrow({
      where: { id: old.current.id },
    });
    const correction = await finance.correction(
      member.actor,
      f.co.id,
      f.co.id,
      old.id,
      old.revision,
      facts(f.category.id, '35.00', [
        { budgetId: f.budget.id, commitmentId: null, amount: '35.00' },
      ]),
      randomUUID(),
    );
    expect(
      (await finance.budget(owner.actor, f.co.id, f.co.id, f.budget.id)).spent,
    ).toBe('20.00');
    const s = await finance.submit(
      member.actor,
      f.co.id,
      f.co.id,
      old.id,
      correction.revision,
      { reviewer: ref(f.reviewer) },
    );
    const replacement = await finance.decide(
      admin.actor,
      f.co.id,
      f.co.id,
      old.id,
      s.revision,
      { decision: 'APPROVE' },
    );
    expect(
      (await finance.budget(owner.actor, f.co.id, f.co.id, f.budget.id)).spent,
    ).toBe('35.00');
    expect(
      await client.companyExpenseVersion.findUniqueOrThrow({
        where: { id: original.id },
      }),
    ).toEqual(original);
    const reversal = await finance.correction(
      member.actor,
      f.co.id,
      f.co.id,
      old.id,
      replacement.revision,
      null,
      randomUUID(),
    );
    const rs = await finance.submit(
      member.actor,
      f.co.id,
      f.co.id,
      old.id,
      reversal.revision,
      { reviewer: ref(f.reviewer) },
    );
    const done = await finance.decide(
      admin.actor,
      f.co.id,
      f.co.id,
      old.id,
      rs.revision,
      { decision: 'APPROVE' },
    );
    expect(done.state).toBe('REVERSED');
    expect(
      (await finance.budget(owner.actor, f.co.id, f.co.id, f.budget.id)).spent,
    ).toBe('0.00');
    expect(
      await client.companyBudgetEffect.count({ where: { spaceId: f.co.id } }),
    ).toBe(4);
  });
  it('restores only active commitments and never revives a released reservation', async () => {
    const f = await setup();
    const r = await finance.commitmentCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      f.budget.id,
      { id: randomUUID(), amount: '30.00' },
      randomUUID(),
    );
    const e = await approved(f, '20.00', r.id);
    await finance.commitmentRelease(owner.actor, f.co.id, f.co.id, r.id, 1);
    const reverse = await finance.correction(
      member.actor,
      f.co.id,
      f.co.id,
      e.id,
      e.revision,
      null,
      randomUUID(),
    );
    const s = await finance.submit(
      member.actor,
      f.co.id,
      f.co.id,
      e.id,
      reverse.revision,
      { reviewer: ref(f.reviewer) },
    );
    await finance.decide(admin.actor, f.co.id, f.co.id, e.id, s.revision, {
      decision: 'APPROVE',
    });
    const b = await finance.budget(owner.actor, f.co.id, f.co.id, f.budget.id);
    expect([b.spent, b.reserved, b.available]).toEqual([
      '0.00',
      '0.00',
      '100.00',
    ]);
  });
  it('prevents own approval and a proxy payer approving their claimed payment', async () => {
    const f = await setup();
    const rootOwner = await root(f.co.id);
    const d = await finance.expenseCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), ...facts(f.category.id) },
      randomUUID(),
    );
    await expect(
      finance.submit(owner.actor, f.co.id, f.co.id, d.id, 1, {
        reviewer: ref(rootOwner),
      }),
    ).rejects.toThrow();
    const payer = await finance.expenseCreate(
      member.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), ...facts(f.category.id), payer: ref(f.reviewer) },
      randomUUID(),
    );
    await expect(
      finance.submit(member.actor, f.co.id, f.co.id, payer.id, 1, {
        reviewer: ref(f.reviewer),
      }),
    ).rejects.toThrow();
  });
  it('denies financial directory access, viewer submission, outsider enumeration and stale revisions', async () => {
    const f = await setup();
    await expect(
      finance.budgets(member.actor, f.co.id, f.co.id, { limit: 10 }),
    ).rejects.toThrow();
    await expect(
      finance.expenseCreate(
        viewer.actor,
        f.co.id,
        f.co.id,
        { id: randomUUID(), ...facts(f.category.id) },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const d = await draft(f);
    await expect(
      finance.expense(viewer.actor, f.co.id, f.co.id, d.id),
    ).rejects.toThrow();
    await expect(
      finance.expense(outsider.actor, f.co.id, f.co.id, d.id),
    ).rejects.toThrow();
    await expect(
      finance.expensePatch(
        member.actor,
        f.co.id,
        f.co.id,
        d.id,
        3,
        facts(f.category.id),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('enforces exact sums, known currency scale and immutable submitted amounts', async () => {
    const f = await setup();
    for (const value of ['1.001', '0.00', '-1.00', '1000000000000000000'])
      await expect(
        finance.expenseCreate(
          member.actor,
          f.co.id,
          f.co.id,
          { id: randomUUID(), ...facts(f.category.id, value) },
          randomUUID(),
        ),
      ).rejects.toThrow();
    await expect(
      finance.expenseCreate(
        member.actor,
        f.co.id,
        f.co.id,
        {
          id: randomUUID(),
          ...facts(f.category.id, '20.00', [
            { budgetId: f.budget.id, commitmentId: null, amount: '19.00' },
          ]),
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const d = await draft(f);
    await finance.submit(member.actor, f.co.id, f.co.id, d.id, 1, {
      reviewer: ref(f.reviewer),
    });
    await expect(
      finance.expensePatch(
        member.actor,
        f.co.id,
        f.co.id,
        d.id,
        2,
        facts(f.category.id),
      ),
    ).rejects.toThrow();
    await expect(
      client.companyExpenseVersion.update({
        where: { id: d.current.id },
        data: { amount: '99.00' },
      }),
    ).rejects.toThrow();
  });
  it('serializes competing approvals under the hard ceiling', async () => {
    const f = await setup();
    const a = await draft(f, '70.00'),
      b = await draft(f, '70.00');
    const sa = await finance.submit(member.actor, f.co.id, f.co.id, a.id, 1, {
        reviewer: ref(f.reviewer),
      }),
      sb = await finance.submit(member.actor, f.co.id, f.co.id, b.id, 1, {
        reviewer: ref(f.reviewer),
      });
    const results = await Promise.allSettled([
      finance.decide(admin.actor, f.co.id, f.co.id, a.id, sa.revision, {
        decision: 'APPROVE',
      }),
      finance.decide(admin.actor, f.co.id, f.co.id, b.id, sb.revision, {
        decision: 'APPROVE',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await finance.budget(owner.actor, f.co.id, f.co.id, f.budget.id)).spent,
    ).toBe('70.00');
  });
  it('keeps generic audit/outbox/receipt/control free of financial payloads', async () => {
    const f = await setup();
    await approved(f);
    const rows = await client.sharedAuditEvent.findMany({
      where: { spaceId: f.co.id },
    });
    const outbox = await client.sharedOutboxEvent.findMany({
      where: { spaceId: f.co.id },
    });
    const once = await client.sharedMutationReceipt.findMany({
      where: { spaceId: f.co.id },
    });
    expect(
      JSON.stringify([rows, outbox, once], (_, v) =>
        typeof v === 'bigint' ? String(v) : v,
      ),
    ).not.toContain('Private vendor sentinel');
  });
  it('exposes finance routes with session auth and rejects unknown request fields', async () => {
    const f = await setup();
    const route =
      '/api/v1/companies/' + f.co.id + '/contexts/' + f.co.id + '/expenses';
    await request(app.getHttpServer()).get(route).expect(401);
    await request(app.getHttpServer())
      .post(route)
      .set('Origin', origin)
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ id: randomUUID(), ...facts(f.category.id), paid: true })
      .expect(400);
    const response = await request(app.getHttpServer())
      .post(route)
      .set('Origin', origin)
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ id: randomUUID(), ...facts(f.category.id) })
      .expect(201);
    expect(response.body.current.amount).toBe('20.00');
  });
  it('uploads private receipts, pins immutable evidence and audits authorized downloads', async () => {
    const f = await setup(),
      d = await draft(f),
      bytes = Buffer.from('%PDF-1.4\nsynthetic receipt\n%%EOF\n');
    const file = await receipts.initiate(
      member.actor,
      f.co.id,
      f.co.id,
      d.id,
      d.current.id,
      {
        id: randomUUID(),
        filename: 'receipt.pdf',
        mimeType: 'application/pdf',
        expectedSize: bytes.length,
      },
      randomUUID(),
    );
    await expect(
      finance.submit(member.actor, f.co.id, f.co.id, d.id, 1, {
        reviewer: ref(f.reviewer),
      }),
    ).rejects.toThrow();
    const ready = await receipts.complete(
      member.actor,
      f.co.id,
      f.co.id,
      d.id,
      d.current.id,
      file.id,
      1,
      Readable.from([bytes]),
      String(bytes.length),
    );
    expect(ready.status).toBe('READY');
    await expect(
      receipts.download(
        viewer.actor,
        f.co.id,
        f.co.id,
        d.id,
        d.current.id,
        file.id,
      ),
    ).rejects.toThrow();
    const s = await finance.submit(member.actor, f.co.id, f.co.id, d.id, 1, {
      reviewer: ref(f.reviewer),
    });
    const list = await receipts.list(
      admin.actor,
      f.co.id,
      f.co.id,
      d.id,
      d.current.id,
      { limit: 10 },
    );
    expect(list.items[0]?.pinnedHash).toBe(ready.sha256);
    await expect(
      receipts.remove(
        member.actor,
        f.co.id,
        f.co.id,
        d.id,
        d.current.id,
        file.id,
        ready.revision,
      ),
    ).rejects.toThrow();
    const download = await receipts.download(
      admin.actor,
      f.co.id,
      f.co.id,
      d.id,
      d.current.id,
      file.id,
    );
    const chunks = [];
    for await (const chunk of download.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(
      await client.sharedAuditEvent.count({
        where: {
          spaceId: f.co.id,
          resourceId: file.id,
          action: 'company.finance.receipt.read',
        },
      }),
    ).toBe(1);
    await finance.decide(admin.actor, f.co.id, f.co.id, d.id, s.revision, {
      decision: 'APPROVE',
    });
  });
  it('rejects invalid receipt bytes, cleans rejected uploads, and requires exact expense binding', async () => {
    const f = await setup(),
      d = await draft(f);
    const file = await receipts.initiate(
      member.actor,
      f.co.id,
      f.co.id,
      d.id,
      d.current.id,
      {
        id: randomUUID(),
        filename: 'bad.pdf',
        mimeType: 'application/pdf',
        expectedSize: 3,
      },
      randomUUID(),
    );
    await expect(
      receipts.complete(
        member.actor,
        f.co.id,
        f.co.id,
        d.id,
        d.current.id,
        file.id,
        1,
        Readable.from(['bad']),
        '3',
      ),
    ).rejects.toThrow();
    await client.storedFile.update({
      where: { id: file.id },
      data: { uploadStartedAt: new Date(Date.now() - 86400000) },
    });
    expect(
      (await receipts.reconcile(owner.actor, f.co.id, f.co.id)).cleaned,
    ).toBe(1);
    const other = await draft(f);
    await expect(
      receipts.download(
        member.actor,
        f.co.id,
        f.co.id,
        other.id,
        other.current.id,
        file.id,
      ),
    ).rejects.toThrow();
    expect(
      (await client.storedFile.findUniqueOrThrow({ where: { id: file.id } }))
        .purgedAt,
    ).not.toBeNull();
  });
  it('denies finalization after revocation during private byte IO', async () => {
    const f = await setup(),
      d = await draft(f),
      bytes = Buffer.from('%PDF-1.4\nsynthetic\n%%EOF\n');
    const file = await receipts.initiate(
      member.actor,
      f.co.id,
      f.co.id,
      d.id,
      d.current.id,
      {
        id: randomUUID(),
        filename: 'private.pdf',
        mimeType: 'application/pdf',
        expectedSize: bytes.length,
      },
      randomUUID(),
    );
    const storage = app.get(SharedFiles),
      original = storage.write.bind(storage);
    vi.spyOn(storage, 'write').mockImplementation(async (...args) => {
      const evidence = await original(...args);
      await companies.changeMember(
        owner.actor,
        f.co.id,
        f.co.id,
        f.subject.id,
        f.subject.revision,
        { state: 'REVOKED', memberRole: 'MEMBER' },
      );
      return evidence;
    });
    await expect(
      receipts.complete(
        member.actor,
        f.co.id,
        f.co.id,
        d.id,
        d.current.id,
        file.id,
        1,
        Readable.from([bytes]),
        String(bytes.length),
      ),
    ).rejects.toThrow();
    expect(
      (await client.storedFile.findUniqueOrThrow({ where: { id: file.id } }))
        .status,
    ).toBe('INITIATED');
    await expect(
      receipts.download(
        member.actor,
        f.co.id,
        f.co.id,
        d.id,
        d.current.id,
        file.id,
      ),
    ).rejects.toThrow();
  });
  it('revalidates reviewer role and reassignment and rejects old pending authority', async () => {
    const f = await setup(),
      d = await draft(f);
    const submitted = await finance.submit(
      member.actor,
      f.co.id,
      f.co.id,
      d.id,
      1,
      { reviewer: ref(f.reviewer) },
    );
    const newReviewer = ref(await root(f.co.id));
    const reassigned = await finance.submit(
      member.actor,
      f.co.id,
      f.co.id,
      d.id,
      submitted.revision,
      { reviewer: newReviewer },
      true,
    );
    await expect(
      finance.decide(admin.actor, f.co.id, f.co.id, d.id, reassigned.revision, {
        decision: 'APPROVE',
      }),
    ).rejects.toThrow();
    await finance.decide(
      owner.actor,
      f.co.id,
      f.co.id,
      d.id,
      reassigned.revision,
      { decision: 'REJECT' },
    );
    expect(
      (await finance.budget(owner.actor, f.co.id, f.co.id, f.budget.id)).spent,
    ).toBe('0.00');
    const next = await draft(f);
    const pending = await finance.submit(
      member.actor,
      f.co.id,
      f.co.id,
      next.id,
      1,
      { reviewer: ref(f.reviewer) },
    );
    await companies.changeMember(
      owner.actor,
      f.co.id,
      f.co.id,
      f.reviewer.id,
      f.reviewer.revision,
      { state: 'ACTIVE', memberRole: 'MEMBER' },
    );
    await expect(
      finance.decide(admin.actor, f.co.id, f.co.id, next.id, pending.revision, {
        decision: 'APPROVE',
      }),
    ).rejects.toThrow();
  });
  it('keeps staff cases confidential from a scoped financial administrator', async () => {
    const f = await setup();
    const profile = await staff.createProfile(
      owner.actor,
      f.co.id,
      f.co.id,
      {
        id: randomUUID(),
        member: ref(f.subject),
        position: 'Confidential staff',
        supervisor: null,
        workStatus: 'ACTIVE',
      },
      randomUUID(),
    );
    const caseReviewer = await admit(f.co.id, await person(), 'ORG_ADMIN');
    const employeeCase = await cases.create(
      owner.actor,
      f.co.id,
      f.co.id,
      {
        id: randomUUID(),
        subject: ref(f.subject),
        reviewer: ref(caseReviewer),
        reason: 'Confidential staff case',
        evidence: 'Private evidence',
      },
      randomUUID(),
    );
    await finance.budgets(admin.actor, f.co.id, f.co.id, { limit: 10 });
    await expect(
      cases.read(admin.actor, f.co.id, f.co.id, employeeCase.id),
    ).rejects.toThrow();
    expect(profile.position).toBe('Confidential staff');
  });
  it('retains Company financial facts pseudonymously without blocking Personal identity erasure', async () => {
    const who = await person(),
      f = await setup(),
      subject = await admit(f.co.id, who);
    const d = await finance.expenseCreate(
      who.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), ...facts(f.category.id) },
      randomUUID(),
    );
    const s = await finance.submit(who.actor, f.co.id, f.co.id, d.id, 1, {
      reviewer: ref(f.reviewer),
    });
    await finance.decide(admin.actor, f.co.id, f.co.id, d.id, s.revision, {
      decision: 'APPROVE',
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
          where: { id: subject.actorId },
        })
      ).userId,
    ).toBeNull();
    expect(
      (await finance.expense(owner.actor, f.co.id, f.co.id, d.id)).current
        .amount,
    ).toBe('20.00');
  });
  it('requires independent Project management, hides source metadata and preserves Company facts after Project disposal', async () => {
    const f = await setup(),
      projects = app.get(ProjectsService),
      cleanup = app.get(ProjectCleanupService);
    const project = await projects.create(
      owner.actor,
      {
        id: randomUUID(),
        title: 'Independent private Project',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    await expect(
      finance.referenceCreate(
        admin.actor,
        f.co.id,
        f.co.id,
        { id: randomUUID(), projectId: project.id },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const reference = await finance.referenceCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), projectId: project.id },
      randomUUID(),
    );
    expect(reference.project?.id).toBe(project.id);
    expect(
      (await finance.references(admin.actor, f.co.id, f.co.id, { limit: 10 }))
        .items[0]?.project,
    ).toBeNull();
    const budget = await finance.budgetCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      {
        id: randomUUID(),
        title: 'Project finance',
        amount: '100.00',
        currency: 'USD',
        startDate: '2026-01-01',
        endDate: '2027-01-01',
        timezone: 'UTC',
        projectReferenceId: reference.id,
      },
      randomUUID(),
    );
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: project.id },
        })
      ).kind,
    ).toBe('PROJECT');
    await projects.lifecycle(owner.actor, project.id, 1, 'delete', password);
    const job = await client.sharedLifecycleJob.findFirstOrThrow({
      where: { spaceId: project.id },
    });
    await client.sharedLifecycleJob.update({
      where: { id: job.id },
      data: {
        effectiveDepartureAt: new Date(Date.now() - 31 * 86400000),
        recoveryDeadline: new Date(Date.now() - 86400000),
        nextAt: new Date(Date.now() - 1000),
      },
    });
    for (
      let n = 0;
      n < 100 &&
      (await client.project.findUnique({ where: { id: project.id } }));
      n++
    )
      await cleanup.consume();
    expect(
      await client.project.findUnique({ where: { id: project.id } }),
    ).toBeNull();
    expect(
      (await finance.budget(owner.actor, f.co.id, f.co.id, budget.id)).limit,
    ).toBe('100.00');
    expect(
      (await finance.references(owner.actor, f.co.id, f.co.id, { limit: 10 }))
        .items[0]?.project,
    ).toBeNull();
  });
  it('preserves root finance roles only after explicit child admission and scopes Department managers', async () => {
    const f = await setup(),
      dept = await companies.createContext(
        owner.actor,
        f.co.id,
        null,
        { id: randomUUID(), title: 'Finance department' },
        randomUUID(),
      );
    await expect(
      finance.budgets(owner.actor, f.co.id, dept.id, { limit: 10 }),
    ).rejects.toThrow();
    const ownerChild = await admit(f.co.id, owner, 'VIEWER', dept.id, admin),
      adminChild = await admit(f.co.id, admin, 'MEMBER', dept.id),
      manager = await admit(f.co.id, member, 'DEPT_MANAGER', dept.id);
    const category = await finance.categoryCreate(
      member.actor,
      f.co.id,
      dept.id,
      { id: randomUUID(), title: 'Department category' },
      randomUUID(),
    );
    await expect(
      finance.categoryCreate(
        member.actor,
        f.co.id,
        f.co.id,
        { id: randomUUID(), title: 'Forbidden root category' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const first = await finance.expenseCreate(
      owner.actor,
      f.co.id,
      dept.id,
      { id: randomUUID(), ...facts(category.id) },
      randomUUID(),
    );
    const submitted = await finance.submit(
      owner.actor,
      f.co.id,
      dept.id,
      first.id,
      1,
      { reviewer: ref(adminChild) },
    );
    await finance.decide(
      admin.actor,
      f.co.id,
      dept.id,
      first.id,
      submitted.revision,
      { decision: 'APPROVE' },
    );
    const second = await finance.expenseCreate(
      member.actor,
      f.co.id,
      dept.id,
      { id: randomUUID(), ...facts(category.id) },
      randomUUID(),
    );
    const pending = await finance.submit(
      member.actor,
      f.co.id,
      dept.id,
      second.id,
      1,
      { reviewer: ref(ownerChild) },
    );
    await companies.changeMember(
      owner.actor,
      f.co.id,
      dept.id,
      manager.id,
      manager.revision,
      { state: 'REVOKED', memberRole: 'DEPT_MANAGER' },
    );
    const rejoined = await admit(f.co.id, member, 'DEPT_MANAGER', dept.id);
    expect(rejoined.generation).toBeGreaterThan(manager.generation);
    await expect(
      finance.decide(
        owner.actor,
        f.co.id,
        dept.id,
        second.id,
        pending.revision,
        { decision: 'APPROVE' },
      ),
    ).rejects.toThrow();
  });
  it('allows a current named payer but excludes unrelated financial readers and foreign budget references', async () => {
    const f = await setup(),
      other = await setup(),
      payer = await root(f.co.id, viewer);
    const expense = await finance.expenseCreate(
      member.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), ...facts(f.category.id), payer: ref(payer) },
      randomUUID(),
    );
    expect(
      (await finance.expense(viewer.actor, f.co.id, f.co.id, expense.id)).id,
    ).toBe(expense.id);
    await expect(
      finance.expenseCreate(
        member.actor,
        f.co.id,
        f.co.id,
        {
          id: randomUUID(),
          ...facts(f.category.id, '20.00', [
            { budgetId: other.budget.id, commitmentId: null, amount: '20.00' },
          ]),
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await companies.changeMember(
      owner.actor,
      f.co.id,
      f.co.id,
      payer.id,
      payer.revision,
      { state: 'REVOKED', memberRole: 'VIEWER' },
    );
    await admit(f.co.id, viewer, 'VIEWER');
    await expect(
      finance.expense(viewer.actor, f.co.id, f.co.id, expense.id),
    ).rejects.toThrow();
  });
  it('appends successful budget limit changes and rejects archived growth while allowing history', async () => {
    const f = await setup();
    const increased = await finance.budgetChange(
      owner.actor,
      f.co.id,
      f.co.id,
      f.budget.id,
      1,
      { amount: '10.00', direction: 'INCREASE' },
    );
    expect(increased.limit).toBe('110.00');
    const reduced = await finance.budgetChange(
      owner.actor,
      f.co.id,
      f.co.id,
      f.budget.id,
      2,
      { amount: '5.00', direction: 'DECREASE' },
    );
    expect(reduced.limit).toBe('105.00');
    const archived = await finance.budgetChange(
      owner.actor,
      f.co.id,
      f.co.id,
      f.budget.id,
      3,
      { archived: true },
    );
    await expect(
      finance.commitmentCreate(
        owner.actor,
        f.co.id,
        f.co.id,
        f.budget.id,
        { id: randomUUID(), amount: '1.00' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    expect(archived.archived).toBe(true);
    const rows = await client.companyBudgetAdjustment.findMany({
      where: { budgetId: f.budget.id },
    });
    expect(rows).toHaveLength(2);
    await expect(
      client.companyBudgetAdjustment.update({
        where: { id: rows[0]!.id },
        data: { amount: '100.00' },
      }),
    ).rejects.toThrow();
  });
});
