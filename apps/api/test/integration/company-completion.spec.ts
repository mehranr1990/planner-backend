import { Readable } from 'node:stream';
import { CompanyGoalsService } from '../../src/modules/companies/application/company-goals.service.js';
import { CompanyRoomsService } from '../../src/modules/companies/application/company-rooms.service.js';
import { CompanyKnowledgeService } from '../../src/modules/companies/application/company-knowledge.service.js';
import { CompanyKnowledgePagesService } from '../../src/modules/companies/application/company-knowledge-pages.service.js';
import { CompanyEmployeeFilesService } from '../../src/modules/companies/application/company-employee-files.service.js';
import { ProjectsService } from '../../src/modules/projects/public/index.js';
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
import { CompanyAccess } from '../../src/modules/spaces/public/index.js';
import {
  CompaniesService,
  CompanyStaffService,
  CompanyFinanceService,
  CompanyResourceRequestsService,
  CompanyReportsService,
  CompanyAssociationsService,
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
describe('Company Backend completion: currency, directory, KPIs, resource approvals', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    client: PrismaClient,
    observer: Client,
    watcher: Client;
  let companies: CompaniesService,
    finance: CompanyFinanceService,
    requests: CompanyResourceRequestsService,
    reports: CompanyReportsService,
    associations: CompanyAssociationsService,
    staff: CompanyStaffService,
    access: CompanyAccess,
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
    requests = app.get(CompanyResourceRequestsService);
    reports = app.get(CompanyReportsService);
    associations = app.get(CompanyAssociationsService);
    staff = app.get(CompanyStaffService);
    access = app.get(CompanyAccess);
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
    const co = await companies.create(
      owner.actor,
      {
        id: randomUUID(),
        title: 'Company staff fixture',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    // OD-9: Company finance records require the fixed Company currency first.
    await companies.setCurrency(owner.actor, co.id, co.revision, {
      currency: 'USD',
    });
    return companies.read(owner.actor, co.id);
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
  async function fixture() {
    const co = await company(),
      subject = await admit(co.id),
      reviewer = await admit(co.id, admin, 'ORG_ADMIN');
    await admit(co.id, viewer, 'VIEWER');
    return { co, subject, reviewer };
  }
  const reason = (e: unknown) =>
    (e as { response?: { code?: string } }).response?.code;
  const facts = (categoryId: string) => ({
    amount: '20.00',
    currency: 'USD',
    categoryId,
    occurredDate: '2026-11-07',
    timezone: 'UTC',
    vendor: null,
    payer: null,
    projectReferenceId: null,
    allocations: [],
  });
  async function bare() {
    return companies.create(
      owner.actor,
      {
        id: randomUUID(),
        title: 'Company without currency',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
  }
  async function category(id: string, scope = id) {
    return finance.categoryCreate(
      owner.actor,
      id,
      scope,
      { id: randomUUID(), title: 'Category' },
      randomUUID(),
    );
  }
  const budget = (currency = 'USD', limit = '100.00') => ({
    id: randomUUID(),
    title: 'Budget',
    currency,
    amount: limit,
    startDate: '2026-11-01',
    endDate: '2026-12-01',
    timezone: 'UTC',
    projectReferenceId: null,
  });
  it('fixes one Company currency, locks it at the first financial record and refuses other currencies (OD-9)', async () => {
    const co = await bare();
    expect(await companies.settings(owner.actor, co.id)).toMatchObject({
      currency: null,
      scale: null,
      currencyLocked: false,
    });
    await admit(co.id);
    const cat = await category(co.id);
    expect(
      reason(
        await finance
          .expenseCreate(
            member.actor,
            co.id,
            co.id,
            { id: randomUUID(), ...facts(cat.id) },
            randomUUID(),
          )
          .catch((e: unknown) => e),
      ),
    ).toBe('COMPANY_CURRENCY_REQUIRED');
    await expect(
      companies.setCurrency(member.actor, co.id, co.revision, {
        currency: 'EUR',
      }),
    ).rejects.toThrow();
    const eur = await companies.setCurrency(owner.actor, co.id, co.revision, {
      currency: 'EUR',
    });
    expect(eur).toMatchObject({
      currency: 'EUR',
      scale: 2,
      currencyLocked: false,
    });
    // Still changeable before the first record; stale revisions are refused.
    await expect(
      companies.setCurrency(owner.actor, co.id, co.revision, {
        currency: 'USD',
      }),
    ).rejects.toThrow();
    const usd = await companies.setCurrency(owner.actor, co.id, eur.revision, {
      currency: 'USD',
    });
    expect(
      reason(
        await finance
          .budgetCreate(owner.actor, co.id, co.id, budget('EUR'), randomUUID())
          .catch((e: unknown) => e),
      ),
    ).toBe('COMPANY_CURRENCY_MISMATCH');
    await finance.budgetCreate(
      owner.actor,
      co.id,
      co.id,
      budget(),
      randomUUID(),
    );
    expect(await companies.settings(owner.actor, co.id)).toMatchObject({
      currency: 'USD',
      currencyLocked: true,
    });
    expect(
      reason(
        await companies
          .setCurrency(owner.actor, co.id, usd.revision, { currency: 'EUR' })
          .catch((e: unknown) => e),
      ),
    ).toBe('COMPANY_CURRENCY_LOCKED');
    // The database guard holds even if application checks were bypassed.
    await expect(
      client.$executeRaw`UPDATE "Company" SET currency='EUR', revision=revision+1 WHERE id=${co.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      client.$executeRaw`UPDATE "Company" SET currency=NULL, scale=NULL, revision=revision+1 WHERE id=${co.id}::uuid`,
    ).rejects.toThrow();
    expect(
      (await client.company.findUniqueOrThrow({ where: { id: co.id } }))
        .currency,
    ).toBe('USD');
  });
  it('serializes a concurrent currency change against the first record without mixing currencies', async () => {
    for (let i = 0; i < 3; i++) {
      const co = await bare(),
        set = await companies.setCurrency(owner.actor, co.id, co.revision, {
          currency: 'USD',
        });
      await Promise.allSettled([
        companies.setCurrency(owner.actor, co.id, set.revision, {
          currency: 'EUR',
        }),
        finance.budgetCreate(owner.actor, co.id, co.id, budget(), randomUUID()),
      ]);
      const fixed = await client.company.findUniqueOrThrow({
        where: { id: co.id },
      });
      const rows = await client.companyBudget.findMany({
        where: { spaceId: co.id },
      });
      for (const r of rows) expect(r.currency).toBe(fixed.currency);
    }
  });
  it('routes resource requests through the published role-based workflow version with audit history (C4)', async () => {
    const { co } = await fixture(),
      other = await person();
    await admit(co.id, other);
    const kind = await requests.createType(
      owner.actor,
      co.id,
      co.id,
      { id: randomUUID(), title: 'Laptop' },
      randomUUID(),
    );
    await expect(
      requests.createType(
        member.actor,
        co.id,
        co.id,
        { id: randomUUID(), title: 'Denied' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const item = await staff.createResource(
      owner.actor,
      co.id,
      co.id,
      { id: randomUUID(), title: 'Laptop 7', description: null },
      randomUUID(),
    );
    expect(item.typeId).toBeNull();
    const typed = await requests.assignType(
      owner.actor,
      co.id,
      co.id,
      item.id,
      item.revision,
      { typeId: kind.id },
    );
    expect(typed.typeId).toBe(kind.id);
    const window = {
      startAt: '2027-01-01T09:00:00.000Z',
      endAt: '2027-01-02T09:00:00.000Z',
    };
    expect(
      reason(
        await requests
          .createRequest(
            member.actor,
            co.id,
            co.id,
            item.id,
            { id: randomUUID(), ...window, reason: 'Travel' },
            randomUUID(),
          )
          .catch((e: unknown) => e),
      ),
    ).toBe('RESOURCE_APPROVAL_WORKFLOW_REQUIRED');
    const draft = await requests.createWorkflow(
      owner.actor,
      co.id,
      co.id,
      {
        id: randomUUID(),
        typeId: kind.id,
        steps: [{ roles: ['ORG_ADMIN'] }, { roles: ['OWNER'] }],
      },
      randomUUID(),
    );
    const v1 = await requests.changeWorkflow(
      owner.actor,
      co.id,
      co.id,
      draft.id,
      draft.revision,
      { kind: 'publish' },
    );
    expect(v1.state).toBe('PUBLISHED');
    expect(
      reason(
        await requests
          .changeWorkflow(owner.actor, co.id, co.id, v1.id, v1.revision, {
            kind: 'steps',
            input: { steps: [{ roles: ['OWNER'] }] },
          })
          .catch((e: unknown) => e),
      ),
    ).toBe('WORKFLOW_VERSION_IMMUTABLE');
    await expect(
      requests.createRequest(
        viewer.actor,
        co.id,
        co.id,
        item.id,
        { id: randomUUID(), ...window, reason: null },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const r = await requests.createRequest(
      member.actor,
      co.id,
      co.id,
      item.id,
      { id: randomUUID(), ...window, reason: 'Travel' },
      randomUUID(),
    );
    expect(r).toMatchObject({
      state: 'PENDING',
      step: 0,
      stepCount: 2,
      pendingRoles: ['ORG_ADMIN'],
      workflowVersionId: v1.id,
    });
    // A later publication never rewrites the bound version.
    const v2 = await requests.createWorkflow(
      owner.actor,
      co.id,
      co.id,
      { id: randomUUID(), typeId: kind.id, steps: [{ roles: ['OWNER'] }] },
      randomUUID(),
    );
    await requests.changeWorkflow(
      owner.actor,
      co.id,
      co.id,
      v2.id,
      v2.revision,
      { kind: 'publish' },
    );
    // Unrelated members cannot see the request; requesters cannot approve it.
    await expect(
      requests.readRequest(other.actor, co.id, co.id, r.id),
    ).rejects.toThrow();
    expect(
      (await requests.requests(other.actor, co.id, co.id, { limit: 50 })).items,
    ).toEqual([]);
    expect(
      reason(
        await requests
          .decide(member.actor, co.id, co.id, r.id, r.revision, {
            decision: 'APPROVE',
            reason: null,
          })
          .catch((e: unknown) => e),
      ),
    ).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(
      reason(
        await requests
          .decide(owner.actor, co.id, co.id, r.id, r.revision, {
            decision: 'APPROVE',
            reason: null,
          })
          .catch((e: unknown) => e),
      ),
    ).toBe('APPROVAL_ROLE_REQUIRED');
    const step1 = await requests.decide(
      admin.actor,
      co.id,
      co.id,
      r.id,
      r.revision,
      { decision: 'APPROVE', reason: null },
    );
    expect(step1).toMatchObject({
      state: 'PENDING',
      step: 1,
      pendingRoles: ['OWNER'],
    });
    await expect(
      requests.decide(owner.actor, co.id, co.id, r.id, r.revision, {
        decision: 'APPROVE',
        reason: null,
      }),
    ).rejects.toThrow();
    const done = await requests.decide(
      owner.actor,
      co.id,
      co.id,
      r.id,
      step1.revision,
      { decision: 'APPROVE', reason: null },
    );
    expect(done.state).toBe('APPROVED');
    const allocation = await client.companyResourceAllocation.findUniqueOrThrow(
      {
        where: { id: done.allocationId! },
      },
    );
    expect(allocation).toMatchObject({
      state: 'ALLOCATED',
      memberAccessId: r.requester.accessId,
    });
    const history = await requests.history(member.actor, co.id, co.id, r.id);
    expect(history.items.map((e) => [e.kind, e.step])).toEqual([
      ['SUBMIT', null],
      ['APPROVE', 0],
      ['APPROVE', 1],
    ]);
    // Terminal requests and history are immutable in the database.
    await expect(
      client.$executeRaw`UPDATE "CompanyResourceRequest" SET state='REJECTED', revision=revision+1 WHERE id=${r.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      client.$executeRaw`UPDATE "CompanyResourceRequestEvent" SET kind='REJECT' WHERE "requestId"=${r.id}::uuid`,
    ).rejects.toThrow();
    // Overlaps are refused; a later request binds v2 and a rejection keeps its reason.
    expect(
      reason(
        await requests
          .createRequest(
            other.actor,
            co.id,
            co.id,
            item.id,
            { id: randomUUID(), ...window, reason: null },
            randomUUID(),
          )
          .catch((e: unknown) => e),
      ),
    ).toBe('RESOURCE_UNAVAILABLE');
    const late = await requests.createRequest(
      other.actor,
      co.id,
      co.id,
      item.id,
      {
        id: randomUUID(),
        startAt: '2027-02-01T09:00:00.000Z',
        endAt: '2027-02-02T09:00:00.000Z',
        reason: null,
      },
      randomUUID(),
    );
    expect(late.workflowVersionId).toBe(v2.id);
    const rejected = await requests.decide(
      owner.actor,
      co.id,
      co.id,
      late.id,
      late.revision,
      { decision: 'REJECT', reason: 'Not available for this trip' },
    );
    expect(rejected).toMatchObject({ state: 'REJECTED', allocationId: null });
    const pending = await requests.createRequest(
      member.actor,
      co.id,
      co.id,
      item.id,
      {
        id: randomUUID(),
        startAt: '2027-03-01T09:00:00.000Z',
        endAt: '2027-03-02T09:00:00.000Z',
        reason: null,
      },
      randomUUID(),
    );
    await expect(
      requests.withdraw(
        other.actor,
        co.id,
        co.id,
        pending.id,
        pending.revision,
      ),
    ).rejects.toThrow();
    expect(
      (
        await requests.withdraw(
          member.actor,
          co.id,
          co.id,
          pending.id,
          pending.revision,
        )
      ).state,
    ).toBe('WITHDRAWN');
  });
  it('serves the public directory with work-contact fields only and keeps edits to self or managers', async () => {
    const { co, subject } = await fixture(),
      other = await person();
    await admit(co.id, other);
    const profile = await staff.createProfile(
      owner.actor,
      co.id,
      co.id,
      {
        id: randomUUID(),
        member: ref(subject),
        position: 'Analyst',
        supervisor: null,
        workStatus: 'ACTIVE',
      },
      randomUUID(),
    );
    await expect(
      staff.setWorkDetails(
        other.actor,
        co.id,
        co.id,
        profile.id,
        profile.revision,
        { workPhone: '+1 555 0100' },
      ),
    ).rejects.toThrow();
    const mine = await staff.setWorkDetails(
      member.actor,
      co.id,
      co.id,
      profile.id,
      profile.revision,
      {
        workPhone: '+1 555 0100',
        workLocation: 'HQ 3F',
        workHours: '09:00-17:00',
      },
    );
    const managed = await staff.setWorkDetails(
      owner.actor,
      co.id,
      co.id,
      profile.id,
      mine.revision,
      { workLocation: 'HQ 4F' },
    );
    expect(managed).toMatchObject({
      workPhone: '+1 555 0100',
      workLocation: 'HQ 4F',
      workHours: '09:00-17:00',
    });
    const dir = await staff.directory(other.actor, co.id, co.id, { limit: 50 });
    expect(dir.items).toHaveLength(1);
    expect(dir.items[0]).toMatchObject({
      profileId: profile.id,
      scopeId: co.id,
      position: 'Analyst',
      workPhone: '+1 555 0100',
    });
    expect(Object.keys(dir.items[0]!)).not.toContain('supervisor');
    await expect(
      staff.directory(outsider.actor, co.id, co.id, { limit: 50 }),
    ).rejects.toThrow();
    const erased = await staff.eraseProfile(
      member.actor,
      co.id,
      co.id,
      profile.id,
      managed.revision,
    );
    expect(erased.redactedAt).not.toBeNull();
    const row = await client.companyStaffProfile.findUniqueOrThrow({
      where: { id: profile.id },
    });
    expect([row.workPhone, row.workLocation, row.workHours]).toEqual([
      null,
      null,
      null,
    ]);
    expect(
      (await staff.directory(other.actor, co.id, co.id, { limit: 50 })).items,
    ).toEqual([]);
  });
  it('reports KPIs with explicit sources, null goals and fixed-currency budget usage to managers only', async () => {
    const { co } = await fixture();
    await finance.budgetCreate(
      owner.actor,
      co.id,
      co.id,
      budget('USD', '250.00'),
      randomUUID(),
    );
    const q = { fromDate: '2026-11-01', toDate: '2026-12-01', timezone: 'UTC' };
    const k = await reports.kpis(owner.actor, co.id, co.id, q);
    expect(k.goals).toBeNull();
    expect(k.tasks).toMatchObject({
      projectCount: 0,
      completion: { numerator: 0, denominator: 0, basisPoints: null },
    });
    expect(k.expenses).toMatchObject({
      currency: 'USD',
      budgetCount: 1,
      usageBasisPoints: 0,
    });
    expect(k.capacity.memberCount).toBeGreaterThan(0);
    await expect(reports.kpis(member.actor, co.id, co.id, q)).rejects.toThrow();
    await expect(
      reports.kpis(outsider.actor, co.id, co.id, q),
    ).rejects.toThrow();
  });
  it('lists only caller-owned unassociated attach candidates and requires context admission', async () => {
    const { co } = await fixture(),
      dept = await companies.createContext(
        owner.actor,
        co.id,
        null,
        { id: randomUUID(), title: 'Department' },
        randomUUID(),
      ),
      projects = app.get(ProjectsService);
    const mine = await projects.create(
      owner.actor,
      {
        id: randomUUID(),
        title: 'Owned Project',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    await projects.create(
      outsider.actor,
      {
        id: randomUUID(),
        title: 'Foreign Project',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    await expect(
      associations.candidates(owner.actor, co.id, dept.id),
    ).rejects.toThrow();
    await admit(co.id, owner, 'VIEWER', dept.id, admin);
    const list = await associations.candidates(owner.actor, co.id, dept.id);
    expect(list.items).toEqual([
      { kind: 'PROJECT', sourceId: mine.id, title: 'Owned Project' },
    ]);
    expect(
      (await associations.summaries(owner.actor, co.id, dept.id, { limit: 50 }))
        .items,
    ).toEqual([]);
    await expect(
      associations.candidates(outsider.actor, co.id, dept.id),
    ).rejects.toThrow();
  });
  it('enforces the new routes over HTTP with Origin, If-Match and ETag', async () => {
    const co = await bare();
    const read = await request(app.getHttpServer())
      .get(`/api/v1/companies/${co.id}/settings`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(read.headers['cache-control']).toBe('no-store');
    expect(read.headers.etag).toBe(`"${co.revision}"`);
    await request(app.getHttpServer())
      .put(`/api/v1/companies/${co.id}/settings/currency`)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({ currency: 'USD' })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/api/v1/companies/${co.id}/settings/currency`)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('If-Match', `"${co.revision}"`)
      .send({ currency: 'XXQ' })
      .expect(400);
    const set = await request(app.getHttpServer())
      .put(`/api/v1/companies/${co.id}/settings/currency`)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('If-Match', `"${co.revision}"`)
      .send({ currency: 'JPY' })
      .expect(200);
    expect(set.body).toMatchObject({ currency: 'JPY', scale: 0 });
    const denied = await request(app.getHttpServer())
      .get(`/api/v1/companies/${co.id}/settings`)
      .set('Cookie', viewer.cookie);
    expect([403, 404]).toContain(denied.status);
  });
  it('LS/OD-4: stores legal and fiscal settings for admins and delivers Company proofs in-app to the recipient only', async () => {
    const co = await company();
    await admit(co.id, admin, 'ORG_ADMIN');
    const before = await companies.settings(owner.actor, co.id);
    expect(before).toMatchObject({ legalName: null, fiscalStartMonth: null });
    await expect(
      companies.setLegal(member.actor, co.id, before.revision, {
        legalName: 'X',
      }),
    ).rejects.toThrow();
    await expect(
      companies.setLegal(owner.actor, co.id, before.revision + 3, {
        legalName: 'X',
      }),
    ).rejects.toMatchObject({ status: 409 });
    const set = await companies.setLegal(owner.actor, co.id, before.revision, {
      legalName: 'Fixture Legal Ltd',
      fiscalStartMonth: 4,
    });
    expect(set).toMatchObject({
      legalName: 'Fixture Legal Ltd',
      fiscalStartMonth: 4,
      currency: 'USD',
      revision: before.revision + 1,
    });
    const offer = await companies.invite(
      owner.actor,
      co.id,
      co.id,
      { memberRole: 'MEMBER', recipient: { userId: viewer.actor.userId } },
      randomUUID(),
    );
    await expect(
      access.issueProof(outsider.actor, offer.invitation.id, 1),
    ).rejects.toMatchObject({ status: 404 });
    const issued = await access.issueProof(
      viewer.actor,
      offer.invitation.id,
      1,
    );
    await expect(
      access.decide(
        viewer.actor,
        offer.invitation.id,
        offer.proof!,
        issued.revision,
        true,
      ),
    ).rejects.toThrow();
    const accepted = await access.decide(
      viewer.actor,
      offer.invitation.id,
      issued.proof,
      issued.revision,
      true,
    );
    expect(accepted.membership).toBeTruthy();
  });

  it('OD-2: manager-owned Company goals with key results, check-ins, pace and KPI goals', async () => {
    const goals = app.get(CompanyGoalsService);
    const { co } = await fixture();
    const kr = randomUUID();
    const input = {
      id: randomUUID(),
      title: 'Grow clients',
      description: null,
      parentId: null,
      startDate: '2026-11-01',
      targetDate: '2026-12-31',
      timezone: 'UTC',
      keyResult: {
        id: kr,
        title: 'Clients',
        unit: null,
        startValue: '0',
        targetValue: '10',
      },
    };
    await expect(
      goals.create(
        member.actor,
        co.id,
        co.id,
        { ...input, id: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const g = await goals.create(
      owner.actor,
      co.id,
      co.id,
      input,
      randomUUID(),
    );
    expect(g).toMatchObject({
      scopeId: co.id,
      status: 'PLANNED',
      progress: null,
    });
    expect(g.keyResults).toHaveLength(1);
    await goals.record(
      owner.actor,
      co.id,
      co.id,
      g.id,
      kr,
      { id: randomUUID(), value: '5', note: 'Halfway' },
      randomUUID(),
    );
    const read = await goals.read(owner.actor, co.id, co.id, g.id);
    expect(read.keyResults[0]).toMatchObject({
      currentValue: '5',
      progress: 5000,
    });
    expect(read.progress).toBe(5000);
    expect(
      (await goals.checkins(owner.actor, co.id, co.id, g.id, kr, { limit: 25 }))
        .items,
    ).toHaveLength(1);
    await expect(
      goals.read(outsider.actor, co.id, co.id, g.id),
    ).rejects.toThrow();
    const patched = await goals.patch(
      owner.actor,
      co.id,
      co.id,
      g.id,
      read.revision,
      { status: 'ACTIVE' },
    );
    expect(patched.status).toBe('ACTIVE');
    await expect(
      goals.patch(owner.actor, co.id, co.id, g.id, read.revision, {
        title: 'Stale',
      }),
    ).rejects.toMatchObject({ status: 409 });
    const k = await reports.kpis(owner.actor, co.id, co.id, {
      fromDate: '2026-11-01',
      toDate: '2026-12-01',
      timezone: 'UTC',
    });
    expect(k.goals).toEqual({
      source: 'COMPANY_GOAL_KEY_RESULTS',
      goalCount: 1,
      measuredGoals: 1,
      averageProgress: 5000,
    });
  });

  it('OD-3: room profiles never infer capacity; utilization is manager-only and null without resources', async () => {
    const rooms = app.get(CompanyRoomsService);
    const { co } = await fixture();
    const room = await staff.createResource(
      owner.actor,
      co.id,
      co.id,
      { id: randomUUID(), title: 'Room A', description: null },
      randomUUID(),
    );
    const day = { day: '2026-11-10', timezone: 'UTC' };
    expect(
      (await rooms.rooms(member.actor, co.id, co.id, day)).items.find(
        (r) => r.id === room.id,
      ),
    ).toBeUndefined();
    await expect(
      rooms.setProfile(member.actor, co.id, co.id, room.id, 1, {
        seats: 8,
        floor: '2',
      }),
    ).rejects.toThrow();
    const profile = await rooms.setProfile(
      owner.actor,
      co.id,
      co.id,
      room.id,
      1,
      { seats: 8, floor: '2' },
    );
    expect(
      (await rooms.rooms(member.actor, co.id, co.id, day)).items.find(
        (r) => r.id === room.id,
      ),
    ).toMatchObject({ name: 'Room A', seats: 8, floor: '2', bookings: [] });
    expect(profile).toMatchObject({ seats: 8, floor: '2' });
    await expect(
      rooms.setProfile(owner.actor, co.id, co.id, room.id, 1, {
        seats: 9,
        floor: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const q = {
      periods: '2026-11-01/2026-11-30,2026-12-01/2026-12-31',
      timezone: 'UTC',
    };
    const u = await rooms.utilization(owner.actor, co.id, co.id, q);
    expect(u.periods).toEqual([
      { from: '2026-11-01', to: '2026-11-30' },
      { from: '2026-12-01', to: '2026-12-31' },
    ]);
    expect(u.rows.find((r) => r.scopeId === co.id)).toMatchObject({
      resources: 1,
      values: [0, 0],
    });
    await expect(
      rooms.utilization(member.actor, co.id, co.id, q),
    ).rejects.toThrow();
    const empty = await company();
    expect(
      (await rooms.utilization(owner.actor, empty.id, empty.id, q)).rows.find(
        (r) => r.scopeId === empty.id,
      ),
    ).toMatchObject({
      resources: 0,
      values: [null, null],
    });
  });

  it('OD-6: versioned knowledge pages publish to members with acknowledgements and deduplicated reminders', async () => {
    const knowledge = app.get(CompanyKnowledgeService),
      pages = app.get(CompanyKnowledgePagesService);
    const { co } = await fixture();
    const folder = await knowledge.folderCreate(
      owner.actor,
      co.id,
      co.id,
      { id: randomUUID(), parentId: null, title: 'Policies' },
      randomUUID(),
    );
    const doc = await knowledge.documentCreate(
      owner.actor,
      co.id,
      co.id,
      {
        id: randomUUID(),
        folderId: folder.id,
        title: 'Handbook',
        description: null,
      },
      randomUUID(),
    );
    const p0 = await pages.page(owner.actor, co.id, co.id, doc.id);
    expect(p0).toMatchObject({
      number: null,
      body: null,
      publishedNumber: null,
      canEdit: true,
    });
    await expect(
      pages.page(member.actor, co.id, co.id, doc.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      pages.save(member.actor, co.id, co.id, doc.id, p0.revision, {
        body: 'x',
        note: null,
      }),
    ).rejects.toThrow();
    const v1 = await pages.save(
      owner.actor,
      co.id,
      co.id,
      doc.id,
      p0.revision,
      { body: '# Rules\n\nBe kind.', note: 'First' },
    );
    expect(v1).toMatchObject({ number: 1, body: '# Rules\n\nBe kind.' });
    const v2 = await pages.save(
      owner.actor,
      co.id,
      co.id,
      doc.id,
      v1.revision,
      { body: '# Rules v2', note: null },
    );
    expect(v2.versions.map((v) => v.number)).toEqual(
      expect.arrayContaining([1, 2]),
    );
    const pub = await pages.publish(
      owner.actor,
      co.id,
      co.id,
      doc.id,
      v2.revision,
      { number: 1, ackRequired: true },
    );
    expect(pub).toMatchObject({ publishedNumber: 1, ackRequired: true });
    const seen = await pages.page(member.actor, co.id, co.id, doc.id);
    expect(seen).toMatchObject({
      number: 1,
      body: '# Rules\n\nBe kind.',
      acknowledged: false,
      canEdit: false,
    });
    await expect(
      pages.page(member.actor, co.id, co.id, doc.id, 2),
    ).rejects.toThrow();
    const report = await pages.acknowledgements(
      owner.actor,
      co.id,
      co.id,
      doc.id,
    );
    expect(report).toMatchObject({ number: 1, acknowledged: 0 });
    expect(report.audience).toBeGreaterThanOrEqual(2);
    await expect(
      pages.acknowledgements(member.actor, co.id, co.id, doc.id),
    ).rejects.toThrow();
    const sent = await pages.remind(owner.actor, co.id, co.id, doc.id);
    expect(sent.delivered).toBeGreaterThanOrEqual(1);
    expect(await pages.remind(owner.actor, co.id, co.id, doc.id)).toEqual({
      delivered: 0,
    });
    const inbox = await pages.notifications(member.actor, co.id, co.id, {
      limit: 25,
    });
    const note = inbox.items.find((n) => n.subjectId === doc.id);
    expect(note).toMatchObject({
      kind: 'KNOWLEDGE_ACK_REMINDER',
      readAt: null,
    });
    await expect(
      pages.readNotification(admin.actor, co.id, co.id, note!.id),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await pages.readNotification(member.actor, co.id, co.id, note!.id))
        .readAt,
    ).not.toBeNull();
    expect(
      (await pages.acknowledge(member.actor, co.id, co.id, doc.id))
        .acknowledged,
    ).toBe(true);
    expect(
      (await pages.acknowledge(member.actor, co.id, co.id, doc.id))
        .acknowledged,
    ).toBe(true);
    expect(
      (await pages.acknowledgements(owner.actor, co.id, co.id, doc.id))
        .acknowledged,
    ).toBe(1);
  });

  it('OD-8/C9: employee files stay sealed except to the subject and owner-granted, time-boxed HR access', async () => {
    const files = app.get(CompanyEmployeeFilesService),
      pages = app.get(CompanyKnowledgePagesService);
    const { co, subject, reviewer } = await fixture();
    expect(await files.file(admin.actor, co.id, subject.id)).toEqual({
      status: 'sealed',
      subjectAccessId: subject.id,
      requested: false,
    });
    expect(await files.file(member.actor, co.id, subject.id)).toMatchObject({
      status: 'open',
      own: true,
      access: { kind: 'SELF', expiresAt: null },
    });
    expect(await files.file(viewer.actor, co.id, subject.id)).toEqual({
      status: 'sealed',
      subjectAccessId: subject.id,
      requested: false,
    });
    await expect(
      files.file(outsider.actor, co.id, subject.id),
    ).rejects.toThrow();
    expect(await files.requestAccess(admin.actor, co.id, subject.id)).toEqual({
      requested: true,
    });
    expect(
      (
        await pages.notifications(owner.actor, co.id, co.id, { limit: 25 })
      ).items.some(
        (n) => n.kind === 'EMPLOYEE_FILE_REQUEST' && n.subjectId === subject.id,
      ),
    ).toBe(true);
    const later = new Date(Date.now() + 86400000).toISOString();
    const grantee = { accessId: reviewer.id, generation: reviewer.generation };
    await expect(
      files.grant(
        admin.actor,
        co.id,
        { id: randomUUID(), grantee, kind: 'HR', expiresAt: later },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await expect(
      files.grant(
        owner.actor,
        co.id,
        {
          id: randomUUID(),
          grantee,
          kind: 'HR',
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const grant = await files.grant(
      owner.actor,
      co.id,
      { id: randomUUID(), grantee, kind: 'HR', expiresAt: later },
      randomUUID(),
    );
    expect(grant).toMatchObject({ kind: 'HR', revokedAt: null });
    expect(await files.file(admin.actor, co.id, subject.id)).toMatchObject({
      status: 'open',
      own: false,
      access: { kind: 'HR' },
    });
    const bytes = Buffer.from('Employment contract fixture');
    const doc = await files.addDocument(
      admin.actor,
      co.id,
      subject.id,
      {
        id: randomUUID(),
        title: 'Contract',
        kind: 'CONTRACT',
        upload: {
          filename: 'contract.txt',
          mimeType: 'text/plain',
          expectedSize: bytes.length,
        },
      },
      randomUUID(),
    );
    expect(doc.status).toBe('INITIATED');
    const ready = await files.complete(
      admin.actor,
      co.id,
      subject.id,
      doc.id,
      doc.revision,
      Readable.from([bytes]),
      String(bytes.length),
    );
    expect(ready).toMatchObject({ status: 'READY', size: bytes.length });
    const down = await files.download(admin.actor, co.id, subject.id, doc.id);
    const chunks: Buffer[] = [];
    for await (const chunk of down.stream)
      chunks.push(Buffer.from(chunk as Buffer));
    expect(Buffer.concat(chunks).equals(bytes)).toBe(true);
    expect(
      (await files.pack(member.actor, co.id, subject.id)).files,
    ).toHaveLength(1);
    const opened = await files.file(member.actor, co.id, subject.id);
    expect(opened.status === 'open' && opened.log.map((l) => l.action)).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
    expect(await files.revoke(owner.actor, co.id, grant.id)).toMatchObject({
      revokedAt: expect.any(String),
    });
    expect((await files.file(admin.actor, co.id, subject.id)).status).toBe(
      'sealed',
    );
    await expect(
      files.download(admin.actor, co.id, subject.id, doc.id),
    ).rejects.toThrow();
    await expect(files.pack(admin.actor, co.id, subject.id)).rejects.toThrow();
  });

  it('OD-5: administrators transfer an employee between departments with blockers, new seat and history', async () => {
    const { co } = await fixture();
    const dept = (title: string) =>
      companies.createContext(
        owner.actor,
        co.id,
        null,
        { id: randomUUID(), title },
        randomUUID(),
      );
    const sales = await dept('Sales'),
      support = await dept('Support');
    const seat = await admit(co.id, member, 'MEMBER', sales.id);
    const q = {
      accessId: seat.id,
      fromScopeId: sales.id,
      toScopeId: support.id,
    };
    expect(await access.transferPreview(owner.actor, co.id, q)).toEqual({
      role: 'MEMBER',
      activeAllocations: 0,
      pendingResourceRequests: 0,
      pendingExpenseReviews: 0,
      allowed: true,
    });
    await expect(
      access.transferPreview(member.actor, co.id, q),
    ).rejects.toThrow();
    const input = {
      id: randomUUID(),
      ...q,
      memberRole: 'MEMBER' as const,
      revision: seat.revision,
    };
    await expect(access.transfer(member.actor, co.id, input)).rejects.toThrow();
    const moved = await access.transfer(owner.actor, co.id, input);
    expect(moved).toMatchObject({
      from: { scopeId: sales.id, accessId: seat.id },
      to: { scopeId: support.id },
      memberRole: 'MEMBER',
    });
    expect(
      (await client.contextAccess.findUniqueOrThrow({ where: { id: seat.id } }))
        .state,
    ).not.toBe('ACTIVE');
    expect(
      (
        await client.contextAccess.findUniqueOrThrow({
          where: { id: moved.to.accessId },
        })
      ).state,
    ).toBe('ACTIVE');
    await expect(
      access.transfer(owner.actor, co.id, { ...input, id: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      access.transferPreview(owner.actor, co.id, {
        ...q,
        toScopeId: sales.id,
        fromScopeId: support.id,
        accessId: seat.id,
      }),
    ).rejects.toThrow();
  });
  it('OD-5: administrators move a whole unit under another department with preview, refusals, live policy and audit', async () => {
    const { co } = await fixture();
    const ctx = (title: string, departmentId: string | null = null) =>
      companies.createContext(
        owner.actor,
        co.id,
        departmentId,
        { id: randomUUID(), title },
        randomUUID(),
      );
    const a = await ctx('Product'),
      b = await ctx('Sales'),
      strict = await ctx('Legal'),
      unit = await ctx('Design', a.id);
    const seat = await admit(co.id, member, 'MEMBER', unit.id);
    const directory = (roles: z.infer<typeof c.CompanyRoleSchema>[]) => ({
      key: 'directory.read' as const,
      roles,
      overrideDefault: false,
    });
    // The unit lets members read its directory; Legal mandates managers only.
    await companies.publish(owner.actor, co.id, unit.id, 1, {
      rules: [
        {
          ...directory(['OWNER', 'ORG_ADMIN', 'DEPT_MANAGER', 'MEMBER']),
          mode: 'DEFAULT',
        },
      ],
    });
    await companies.publish(owner.actor, co.id, b.id, 1, {
      rules: [{ ...directory(['OWNER', 'ORG_ADMIN']), mode: 'DEFAULT' }],
    });
    await companies.publish(owner.actor, co.id, strict.id, 1, {
      rules: [
        {
          ...directory(['OWNER', 'ORG_ADMIN', 'DEPT_MANAGER']),
          mode: 'MANDATORY',
        },
      ],
    });
    const preview = (scopeId: string, parentId?: string) =>
      companies.contextMovePreview(owner.actor, co.id, { scopeId, parentId });
    expect(await preview(unit.id, strict.id)).toEqual({
      scopeId: unit.id,
      kind: 'UNIT',
      fromParentId: a.id,
      parentId: strict.id,
      people: 1,
      teams: 0,
      budgets: [],
      accessChanges: 1,
      revision: 1,
      allowed: true,
      refusal: null,
    });
    for (const [scopeId, parentId, refusal] of [
      [unit.id, unit.id, 'MOVE_SELF_PARENT'],
      [a.id, unit.id, 'MOVE_CYCLE'],
      [a.id, b.id, 'MOVE_LEVEL_CHANGE'],
      [unit.id, undefined, 'MOVE_LEVEL_CHANGE'],
      [unit.id, a.id, 'MOVE_SAME_PARENT'],
      [unit.id, b.id, 'MOVE_POLICY_CONFLICT'],
    ] as const)
      expect(await preview(scopeId, parentId)).toMatchObject({
        allowed: false,
        refusal,
      });
    await expect(preview(unit.id, randomUUID())).rejects.toThrow();
    await expect(
      companies.contextMovePreview(member.actor, co.id, {
        scopeId: unit.id,
        parentId: strict.id,
      }),
    ).rejects.toThrow();
    // Before the move the member reads the unit directory through the unit rule.
    await companies.members(member.actor, co.id, unit.id, { limit: 10 });
    const input = { id: randomUUID(), scopeId: unit.id, parentId: strict.id };
    await expect(
      companies.contextMove(member.actor, co.id, 1, input),
    ).rejects.toThrow();
    await expect(
      companies.contextMove(owner.actor, co.id, 2, input),
    ).rejects.toMatchObject({ response: { code: 'STALE_REVISION' } });
    await expect(
      companies.contextMove(owner.actor, co.id, 1, {
        ...input,
        id: randomUUID(),
        parentId: b.id,
      }),
    ).rejects.toMatchObject({ response: { code: 'MOVE_POLICY_CONFLICT' } });
    await expect(
      companies.contextMove(owner.actor, co.id, 1, {
        id: randomUUID(),
        scopeId: a.id,
        parentId: b.id,
      }),
    ).rejects.toMatchObject({ response: { code: 'MOVE_LEVEL_CHANGE' } });
    const moved = await companies.contextMove(owner.actor, co.id, 1, input);
    expect(moved).toMatchObject({
      id: input.id,
      scopeId: unit.id,
      fromParentId: a.id,
      parentId: strict.id,
      revision: 2,
      accessChanges: 1,
    });
    // Idempotent replay; the same id with another destination conflicts.
    expect(await companies.contextMove(owner.actor, co.id, 2, input)).toEqual(
      moved,
    );
    await expect(
      companies.contextMove(owner.actor, co.id, 2, {
        ...input,
        parentId: b.id,
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(
      await client.companyUnit.findUniqueOrThrow({ where: { id: unit.id } }),
    ).toMatchObject({ departmentId: strict.id, revision: 2 });
    expect(
      await companies.contextRead(owner.actor, co.id, unit.id, 'UNIT'),
    ).toMatchObject({ departmentId: strict.id, revision: 2 });
    // The seat is preserved and the destination MANDATORY rule applies at once.
    expect(
      (await client.contextAccess.findUniqueOrThrow({ where: { id: seat.id } }))
        .state,
    ).toBe('ACTIVE');
    await expect(
      companies.members(member.actor, co.id, unit.id, { limit: 10 }),
    ).rejects.toThrow();
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: co.id, action: 'company.context.move' },
      }),
    ).toBe(1);
    // The database refuses reparenting without a recorded move.
    await expect(
      client.$executeRaw`UPDATE "CompanyUnit" SET "departmentId"=${a.id}::uuid, revision=revision+1 WHERE id=${unit.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      client.$executeRaw`UPDATE "CompanyContextMove" SET "accessChanges"=0 WHERE id=${input.id}::uuid`,
    ).rejects.toThrow();
    // HTTP: Origin and If-Match are required on the move.
    const http = await request(app.getHttpServer())
      .get(`/api/v1/companies/${co.id}/context-moves/preview`)
      .query({ scopeId: unit.id, parentId: a.id })
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(http.body).toMatchObject({ allowed: true, revision: 2 });
    await request(app.getHttpServer())
      .post(`/api/v1/companies/${co.id}/context-moves`)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({ id: randomUUID(), scopeId: unit.id, parentId: a.id })
      .expect(400);
    const back = await request(app.getHttpServer())
      .post(`/api/v1/companies/${co.id}/context-moves`)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('If-Match', '"2"')
      .send({ id: randomUUID(), scopeId: unit.id, parentId: a.id })
      .expect(201);
    expect(back.body).toMatchObject({ parentId: a.id, revision: 3 });
  });
  it('OD-3: room booking titles are optional, set by the booker only and private unless shared', async () => {
    const rooms = app.get(CompanyRoomsService);
    const { co, subject } = await fixture();
    const room = await staff.createResource(
      owner.actor,
      co.id,
      co.id,
      { id: randomUUID(), title: 'Room B', description: null },
      randomUUID(),
    );
    await rooms.setProfile(owner.actor, co.id, co.id, room.id, 1, {
      seats: 4,
      floor: null,
    });
    const start = new Date(Date.now() + 2 * 86400000);
    start.setUTCHours(10, 0, 0, 0);
    const booking = await staff.createAllocation(
      owner.actor,
      co.id,
      co.id,
      room.id,
      {
        id: randomUUID(),
        member: ref(subject),
        startAt: start.toISOString(),
        endAt: new Date(start.getTime() + 3600000).toISOString(),
      },
      randomUUID(),
    );
    const day = { day: start.toISOString().slice(0, 10), timezone: 'UTC' };
    const seen = async (who: Person) =>
      (await rooms.rooms(who.actor, co.id, co.id, day)).items
        .find((r) => r.id === room.id)!
        .bookings.find((b) => b.id === booking.id)!;
    expect(await seen(member)).toMatchObject({ mine: true, title: null });
    for (const who of [owner, viewer])
      await expect(
        rooms.setBookingTitle(who.actor, co.id, co.id, booking.id, 1, {
          title: 'Not mine',
          shared: true,
        }),
      ).rejects.toMatchObject({ status: 404 });
    const set = await rooms.setBookingTitle(
      member.actor,
      co.id,
      co.id,
      booking.id,
      1,
      { title: '  Design review ', shared: false },
    );
    expect(set).toEqual({
      allocationId: booking.id,
      title: 'Design review',
      shared: false,
      revision: 2,
    });
    expect((await seen(member)).title).toBe('Design review');
    // Private by default, also from managers.
    expect((await seen(viewer)).title).toBeNull();
    expect((await seen(owner)).title).toBeNull();
    await expect(
      rooms.setBookingTitle(member.actor, co.id, co.id, booking.id, 1, {
        title: 'Stale',
        shared: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await rooms.setBookingTitle(member.actor, co.id, co.id, booking.id, 2, {
      title: 'Design review',
      shared: true,
    });
    expect((await seen(viewer)).title).toBe('Design review');
    await rooms.setBookingTitle(member.actor, co.id, co.id, booking.id, 3, {
      title: null,
      shared: true,
    });
    expect((await seen(viewer)).title).toBeNull();
  });
});
