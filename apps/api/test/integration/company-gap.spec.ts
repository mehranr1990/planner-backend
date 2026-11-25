import 'reflect-metadata';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { CompanyStaffContext } from '../../src/modules/companies/application/company-staff.context.js';
import {
  CompanyErasure,
  CompanyAccess,
} from '../../src/modules/spaces/public/index.js';
import {
  CompaniesService,
  CompanyStaffService,
  CompanyFinanceService,
  CompanyFinancialApprovalsService,
} from '../../src/modules/companies/public/index.js';
import { CompanyAssetsService } from '../../src/modules/companies/application/company-assets.service.js';
import { CompanyPerformanceService } from '../../src/modules/companies/application/company-performance.service.js';
import { CompanyAccessGovernanceService } from '../../src/modules/companies/application/company-access-governance.service.js';
import { CompanyApprovalPoliciesService } from '../../src/modules/companies/application/company-approval-policies.service.js';
import { CompanyGapQueriesService } from '../../src/modules/companies/application/company-gap-queries.service.js';
import { CompanyFinanceRequestsService } from '../../src/modules/companies/application/company-finance-requests.service.js';
import { CompanyBudgetAlertsService } from '../../src/modules/companies/application/company-budget-alerts.service.js';
import { CompanyPolicyWorker } from '../../src/modules/companies/application/company-policy-worker.service.js';
import {
  CompanyCleanupService,
  CompanyLifecycleService,
} from '../../src/modules/companies/public/index.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
type Person = { actor: RequestActor; email: string; cookie: string };
const ref = (m: { id: string; generation: number }) => ({
    accessId: m.id,
    generation: m.generation,
  }),
  page = { limit: 100 };
describe('P4-GAP-CLOSURE authorization, state and evidence', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    client: PrismaClient;
  let companies: CompaniesService,
    staff: CompanyStaffService,
    finance: CompanyFinanceService,
    flows: CompanyFinancialApprovalsService,
    assets: CompanyAssetsService,
    performance: CompanyPerformanceService,
    governance: CompanyAccessGovernanceService,
    policies: CompanyApprovalPoliciesService,
    queries: CompanyGapQueriesService,
    access: CompanyAccess,
    budgetRequests: CompanyFinanceRequestsService,
    alerts: CompanyBudgetAlertsService,
    worker: CompanyPolicyWorker;
  let owner: Person,
    admin: Person,
    second: Person,
    member: Person,
    outsider: Person,
    passwordHash: string;
  const version = 'synthetic-gap-' + randomUUID(),
    password = 'Synthetic-gap-password-123!',
    origin = 'http://localhost:3000';
  async function person(cookie = false): Promise<Person> {
    const userId = randomUUID(),
      sessionId = randomUUID(),
      email = randomUUID() + '@example.test';
    await client.user.create({
      data: {
        id: userId,
        name: 'Synthetic Company gap',
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
    if (!cookie)
      return {
        actor: {
          userId,
          sessionId,
          requestId: randomUUID(),
          correlationId: randomUUID(),
        },
        email,
        cookie: '',
      };
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email, password })
      .expect(200);
    return {
      actor: {
        userId,
        sessionId: (
          await client.authSession.findFirstOrThrow({
            where: { userId },
            orderBy: { createdAt: 'desc' },
          })
        ).id,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
      email,
      cookie: (login.headers['set-cookie'] as unknown as string[])
        .map((c) => c.split(';')[0])
        .join('; '),
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
      throw Error('Owned Company gap schema migration failed');
    const schema = new URL(sandbox.url).searchParams.get('schema')!,
      base = isolatedTestDatabaseUrl(process.env);
    client = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: base,
          options: '-c timezone=UTC -c search_path=' + schema,
          max: 8,
        },
        { schema },
      ),
    });
    const root = fs.mkdtempSync(path.resolve('.tools/company-gap-fixture-'));
    app = await testApplication({
      databaseUrl: base,
      databaseInstance: {
        client,
        checkConnection: async () => {
          await client.$queryRaw`SELECT 1`;
        },
        onApplicationShutdown: () => client.$disconnect(),
      },
      environment: {
        STORAGE_ROOT: path.join(root, 'files'),
        SHARED_CONTROL_ROOT: path.join(root, 'control'),
        SHARED_CONTROL_KEYS: JSON.stringify({
          k1: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'k1',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P4-GAP-ONLY',
      },
    });
    await app.get(SharedControl).initialize();
    companies = app.get(CompaniesService);
    staff = app.get(CompanyStaffService);
    finance = app.get(CompanyFinanceService);
    flows = app.get(CompanyFinancialApprovalsService);
    assets = app.get(CompanyAssetsService);
    performance = app.get(CompanyPerformanceService);
    governance = app.get(CompanyAccessGovernanceService);
    policies = app.get(CompanyApprovalPoliciesService);
    queries = app.get(CompanyGapQueriesService);
    access = app.get(CompanyAccess);
    budgetRequests = app.get(CompanyFinanceRequestsService);
    alerts = app.get(CompanyBudgetAlertsService);
    worker = app.get(CompanyPolicyWorker);
    passwordHash = await (
      await app.get(AuthService).auth.$context
    ).password.hash(password);
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
          applicableContexts: ['COMPANY'],
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
          backupPolicyReference: 'synthetic test only',
        },
      },
    });
    owner = await person(true);
    admin = await person();
    second = await person();
    member = await person(true);
    outsider = await person();
  }, 60000);
  beforeEach(async () => {
    await client.sharedRateLimit.deleteMany();
  });
  afterAll(async () => {
    await app?.close();
    await client?.$disconnect();
    await sandbox?.close();
  });
  async function admit(
    id: string,
    who: Person,
    role: 'MEMBER' | 'ORG_ADMIN' = 'MEMBER',
    scopeId = id,
  ) {
    const offer = await companies.invite(
      owner.actor,
      id,
      scopeId,
      { memberRole: role, recipient: { userId: who.actor.userId } },
      randomUUID(),
    );
    const proof = await access.issueProof(
      who.actor,
      offer.invitation.id,
      offer.invitation.revision,
    );
    const result = await access.decide(
      who.actor,
      offer.invitation.id,
      proof.proof,
      proof.revision,
      true,
    );
    return result.membership!;
  }
  async function fixture() {
    const co = await companies.create(
      owner.actor,
      {
        id: randomUUID(),
        title: 'Gap Company',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    await companies.setCurrency(owner.actor, co.id, co.revision, {
      currency: 'USD',
    });
    const subject = await admit(co.id, member),
      reviewer = await admit(co.id, admin, 'ORG_ADMIN'),
      alternate = await admit(co.id, second, 'ORG_ADMIN');
    return { id: co.id, subject, reviewer, alternate };
  }
  const budget = () => ({
    id: randomUUID(),
    title: 'Explicit budget',
    currency: 'USD',
    amount: '100.00',
    startDate: '2026-11-01',
    endDate: '2026-12-01',
    timezone: 'UTC',
    projectReferenceId: null,
  });
  async function workflow(
    f: Awaited<ReturnType<typeof fixture>>,
    kind: 'EXPENSE' | 'BUDGET_CHANGE' = 'EXPENSE',
    two = false,
  ) {
    const w = await flows.workflowCreate(
      owner.actor,
      f.id,
      f.id,
      { id: randomUUID(), title: 'Explicit ordered path', kind },
      randomUUID(),
    );
    const draft = await flows.versionCreate(
      owner.actor,
      f.id,
      f.id,
      w.id,
      {
        id: randomUUID(),
        title: 'Version',
        steps: two
          ? [
              { label: 'First', primary: ref(f.reviewer), alternate: null },
              { label: 'Second', primary: ref(f.alternate), alternate: null },
            ]
          : [
              {
                label: 'Review',
                primary: ref(f.reviewer),
                alternate: ref(f.alternate),
              },
            ],
      },
      randomUUID(),
    );
    return flows.versionState(
      owner.actor,
      f.id,
      f.id,
      draft.id,
      draft.revision,
      true,
    );
  }
  async function expense(f: Awaited<ReturnType<typeof fixture>>) {
    const cat = await finance.categoryCreate(
      owner.actor,
      f.id,
      f.id,
      { id: randomUUID(), title: 'Explicit category' },
      randomUUID(),
    );
    return finance.expenseCreate(
      member.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        amount: '20.00',
        currency: 'USD',
        categoryId: cat.id,
        occurredDate: '2026-11-01',
        timezone: 'UTC',
        vendor: null,
        payer: null,
        projectReferenceId: null,
        allocations: [],
      },
      randomUUID(),
    );
  }
  it('enforces Company-scoped tags, mutually exclusive custody, return and maintenance without ownership changes', async () => {
    const f = await fixture(),
      resource = await staff.createResource(
        owner.actor,
        f.id,
        f.id,
        { id: randomUUID(), title: 'Physical asset', description: null },
        randomUUID(),
      );
    expect(
      await assets.setTag(
        owner.actor,
        f.id,
        f.id,
        resource.id,
        resource.revision,
        { assetTag: '  Ab-1  ' },
      ),
    ).toMatchObject({ assetTag: 'Ab-1' });
    const other = await staff.createResource(
      owner.actor,
      f.id,
      f.id,
      { id: randomUUID(), title: 'Other asset', description: null },
      randomUUID(),
    );
    await expect(
      assets.setTag(owner.actor, f.id, f.id, other.id, 1, { assetTag: 'Ab-1' }),
    ).rejects.toMatchObject({ status: 409 });
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        assets.assign(
          owner.actor,
          f.id,
          f.id,
          resource.id,
          { id: randomUUID(), member: ref(f.subject), expectedReturnAt: null },
          randomUUID(),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(
      staff.retireResource(owner.actor, f.id, f.id, resource.id, 2),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      assets.custody(member.actor, f.id, f.id, resource.id, page),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      assets.schedule(
        owner.actor,
        f.id,
        f.id,
        resource.id,
        {
          id: randomUUID(),
          kind: 'Inspection',
          reason: null,
          scheduledAt: new Date().toISOString(),
          responsible: ref(f.reviewer),
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    const custody = (
      await assets.custody(owner.actor, f.id, f.id, resource.id, page)
    ).items[0]!;
    await assets.returnAsset(
      owner.actor,
      f.id,
      f.id,
      resource.id,
      custody.id,
      1,
    );
    const maintenance = await assets.schedule(
      owner.actor,
      f.id,
      f.id,
      resource.id,
      {
        id: randomUUID(),
        kind: 'Inspection',
        reason: null,
        scheduledAt: new Date().toISOString(),
        responsible: ref(f.reviewer),
      },
      randomUUID(),
    );
    await assets.changeMaintenance(
      owner.actor,
      f.id,
      f.id,
      resource.id,
      maintenance.id,
      1,
      { state: 'COMPLETED' },
    );
    expect(
      (await assets.custody(owner.actor, f.id, f.id, resource.id, page))
        .items[0]!.returnedAt,
    ).not.toBeNull();
    expect(
      (
        await assets.utilization(owner.actor, f.id, f.id, {
          from: new Date(Date.now() - 60000).toISOString(),
          to: new Date(Date.now() + 60000).toISOString(),
        })
      ).items.find((r) => r.resourceId === resource.id),
    ).toMatchObject({
      occupancyEvidence: 'UNKNOWN',
      custodyEvidence: 'OBSERVED',
    });
    await expect(
      assets.tag(outsider.actor, f.id, f.id, resource.id),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('keeps review and one-on-one contents participant-private, revisioned and out of Company analytics', async () => {
    const f = await fixture(),
      cycle = await performance.createCycle(
        owner.actor,
        f.id,
        f.id,
        {
          id: randomUUID(),
          title: 'Explicit cycle',
          periodStart: '2026-01-01T00:00:00Z',
          periodEnd: '2026-12-31T00:00:00Z',
        },
        randomUUID(),
      );
    const review = await performance.assignReview(
      owner.actor,
      f.id,
      f.id,
      cycle.id,
      { id: randomUUID(), subject: ref(f.subject), reviewer: ref(f.reviewer) },
      randomUUID(),
    );
    await performance.changeCycle(owner.actor, f.id, f.id, cycle.id, 1, {
      state: 'OPEN',
    });
    await expect(
      performance.reviewRead(owner.actor, f.id, f.id, review.id),
    ).rejects.toMatchObject({ status: 404 });
    const submitted = await performance.submitReview(
      admin.actor,
      f.id,
      f.id,
      review.id,
      1,
      { body: 'Private review sentinel' },
    );
    await expect(
      performance.submitReview(admin.actor, f.id, f.id, review.id, 1, {
        body: 'stale',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await performance.completeReview(
      member.actor,
      f.id,
      f.id,
      review.id,
      submitted.revision,
    );
    await performance.changeCycle(owner.actor, f.id, f.id, cycle.id, 2, {
      state: 'CLOSED',
    });
    expect(
      (
        await performance.reviewHistory(
          member.actor,
          f.id,
          f.id,
          review.id,
          page,
        )
      ).items,
    ).toHaveLength(2);
    const one = await performance.createOne(
      admin.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        employee: ref(f.subject),
        meetingAt: new Date().toISOString(),
        notes: 'Private one-on-one sentinel',
      },
      randomUUID(),
    );
    await expect(
      performance.readOne(owner.actor, f.id, f.id, one.id),
    ).rejects.toMatchObject({ status: 404 });
    await performance.patchOne(member.actor, f.id, f.id, one.id, 1, {
      meetingAt: new Date().toISOString(),
      notes: 'Agreed correction',
    });
    const action = await performance.action(
      member.actor,
      f.id,
      f.id,
      one.id,
      { id: randomUUID(), body: 'Private follow-up' },
      randomUUID(),
    );
    await performance.changeAction(
      admin.actor,
      f.id,
      f.id,
      one.id,
      action.id,
      1,
      { state: 'DONE' },
    );
    expect(
      (await performance.oneHistory(member.actor, f.id, f.id, one.id, page))
        .items,
    ).toHaveLength(2);
    const visible = await request(app.getHttpServer())
      .get(`/api/v1/companies/${f.id}/contexts/${f.id}/one-on-ones/${one.id}`)
      .set('Cookie', member.cookie)
      .expect(200);
    expect(visible.body.notes).toBe('Agreed correction');
    expect(visible.headers.etag).toBe('"2"');
    const analytics = await queries.analytics(owner.actor, f.id, f.id, {
      from: new Date(Date.now() - 60000).toISOString(),
      to: new Date(Date.now() + 60000).toISOString(),
    });
    expect(JSON.stringify(analytics)).not.toContain('Private');
    expect(analytics.reviewCompletion.completed).toBe(1);
    await expect(
      client.companyReviewRevision.update({
        where: {
          id: (
            await client.companyReviewRevision.findFirstOrThrow({
              where: { reviewId: review.id },
            })
          ).id,
        },
        data: { body: 'tampered', revision: { increment: 1 } },
      }),
    ).rejects.toThrow();
  });
  it('requires explicit policy tiers, pins versions, rejects overlaps and executes delegated approval exactly once', async () => {
    const f = await fixture(),
      w = await workflow(f),
      e = await expense(f);
    await expect(
      flows.expenseSubmit(member.actor, f.id, f.id, e.id, 1, null),
    ).rejects.toMatchObject({ status: 409 });
    const body = {
      id: randomUUID(),
      kind: 'EXPENSE' as const,
      effectiveFrom: '2026-01-01T00:00:00Z',
      effectiveUntil: null,
      rules: [
        {
          currency: 'USD',
          minimum: '0',
          maximum: null,
          categoryId: null,
          workflowVersionId: w.id,
          escalateAfterSeconds: null,
        },
      ],
    };
    const policy = await policies.create(
      owner.actor,
      f.id,
      f.id,
      body,
      randomUUID(),
    );
    await policies.change(owner.actor, f.id, f.id, policy.id, 1, {
      state: 'PUBLISHED',
    });
    const conflict = await policies.create(
      owner.actor,
      f.id,
      f.id,
      { ...body, id: randomUUID() },
      randomUUID(),
    );
    await expect(
      policies.change(owner.actor, f.id, f.id, conflict.id, 1, {
        state: 'PUBLISHED',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      finance.submit(member.actor, f.id, f.id, e.id, 1, {
        reviewer: ref(f.reviewer),
      }),
    ).rejects.toMatchObject({ status: 409 });
    const different = await workflow(f);
    await expect(
      flows.expenseSubmit(member.actor, f.id, f.id, e.id, 1, {
        workflowVersionId: different.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const approval = await flows.expenseSubmit(
      member.actor,
      f.id,
      f.id,
      e.id,
      1,
      null,
    );
    expect(
      (
        await client.companyFinancialApproval.findUniqueOrThrow({
          where: { id: approval.id },
        })
      ).policyVersionId,
    ).toBe(policy.id);
    const delegation = await governance.delegation(
      admin.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        delegate: ref(f.alternate),
        workflowVersionId: w.id,
        validFrom: '2026-01-01T00:00:00Z',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      randomUUID(),
    );
    const key = randomUUID();
    const result = await flows.decision(
      second.actor,
      f.id,
      f.id,
      approval.id,
      approval.revision,
      { decision: 'APPROVE' },
      key,
    );
    expect(result.state).toBe('APPROVED');
    expect(
      (
        await flows.decision(
          second.actor,
          f.id,
          f.id,
          approval.id,
          approval.revision,
          { decision: 'APPROVE' },
          key,
        )
      ).id,
    ).toBe(approval.id);
    const timeline = await flows.timeline(
      owner.actor,
      f.id,
      f.id,
      approval.id,
      page,
    );
    expect(
      timeline.items.find((i) => i.action === 'APPROVE')?.delegationId,
    ).toBe(delegation.id);
    expect(
      await client.companyExpenseReviewEvent.count({
        where: { versionId: e.current.id, action: 'APPROVE' },
      }),
    ).toBe(1);
    await policies.change(owner.actor, f.id, f.id, policy.id, 2, {
      state: 'ARCHIVED',
    });
    await expect(
      policies.op.read(
        owner.actor,
        f.id,
        f.id,
        (s) =>
          policies.select(
            s,
            'EXPENSE',
            { currency: 'USD', amount: '20.00', categoryId: null },
            false,
          ),
        false,
      ),
    ).rejects.toMatchObject({ response: { code: 'APPROVAL_POLICY_REQUIRED' } });
  });
  it('runs ordered budget approvals through the same engine and blocks direct decision bypass', async () => {
    const f = await fixture(),
      b = await finance.budgetCreate(
        owner.actor,
        f.id,
        f.id,
        budget(),
        randomUUID(),
      ),
      w = await workflow(f, 'BUDGET_CHANGE', true),
      r = await budgetRequests.create(
        owner.actor,
        f.id,
        f.id,
        b.id,
        {
          id: randomUUID(),
          amount: '20.00',
          direction: 'INCREASE',
          reason: null,
        },
        randomUUID(),
      );
    const a = await flows.budgetSubmit(owner.actor, f.id, f.id, r.id, 1, {
      workflowVersionId: w.id,
    });
    expect(
      await client.sharedUsageEntry.count({
        where: { spaceId: f.id, feature: 'company.financial-approval' },
      }),
    ).toBe(1);
    await expect(
      budgetRequests.decide(admin.actor, f.id, f.id, r.id, 1, {
        decision: 'APPROVE',
        reason: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      flows.decision(second.actor, f.id, f.id, a.id, 1, {
        decision: 'APPROVE',
      }),
    ).rejects.toMatchObject({ status: 403 });
    const first = await flows.decision(admin.actor, f.id, f.id, a.id, 1, {
      decision: 'APPROVE',
    });
    expect(first.state).toBe('ACTIVE');
    const last = await flows.decision(
      second.actor,
      f.id,
      f.id,
      a.id,
      first.revision,
      { decision: 'APPROVE' },
    );
    expect(last.state).toBe('APPROVED');
    expect((await finance.budget(owner.actor, f.id, f.id, b.id)).limit).toBe(
      '120.00',
    );
  });
  it('expires temporary access in the authorization path and audits safe grant revocation', async () => {
    const f = await fixture();
    await companies.publish(owner.actor, f.id, f.id, 1, {
      rules: [
        {
          key: 'directory.read',
          mode: 'DEFAULT',
          roles: ['OWNER', 'ORG_ADMIN'],
          overrideDefault: false,
        },
      ],
    });
    await expect(
      staff.directory(member.actor, f.id, f.id, page),
    ).rejects.toMatchObject({ status: 404 });
    const grant = await governance.temporary(
      owner.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        member: ref(f.subject),
        capabilities: ['directory.read'],
        validFrom: '2026-01-01T00:00:00Z',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        reason: 'Explicit access',
      },
      randomUUID(),
    );
    expect(
      await staff.directory(member.actor, f.id, f.id, page),
    ).toHaveProperty('items');
    await governance.revokeTemporary(owner.actor, f.id, f.id, grant.id, 1);
    await expect(
      staff.directory(member.actor, f.id, f.id, page),
    ).rejects.toMatchObject({ status: 404 });
    const role = await governance.createRole(
      owner.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        title: 'Directory reader',
        capabilities: ['directory.read'],
      },
      randomUUID(),
    );
    await governance.assignRole(
      owner.actor,
      f.id,
      f.id,
      role.id,
      { id: randomUUID(), member: ref(f.subject) },
      randomUUID(),
    );
    expect(
      await staff.directory(member.actor, f.id, f.id, page),
    ).toHaveProperty('items');
    await governance.review(
      owner.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        member: ref(f.subject),
        decision: 'REVOKE',
        reason: 'No longer required',
      },
      randomUUID(),
    );
    await expect(
      staff.directory(member.actor, f.id, f.id, page),
    ).rejects.toMatchObject({ status: 404 });
    await client.companyTemporaryGrant.create({
      data: {
        id: randomUUID(),
        spaceId: f.id,
        scopeId: f.id,
        memberAccessId: f.subject.id,
        memberGeneration: f.subject.generation,
        capabilities: ['directory.read'],
        validFrom: new Date(Date.now() - 120000),
        expiresAt: new Date(Date.now() - 60000),
        actorId: f.reviewer.actorId,
        reason: 'Historical expired grant',
      },
    });
    await expect(
      staff.directory(member.actor, f.id, f.id, page),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      governance.createRole(
        member.actor,
        f.id,
        f.id,
        {
          id: randomUUID(),
          title: 'Escalate',
          capabilities: ['directory.read'],
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('deduplicates configured budget threshold notices without recording settlement or new spending', async () => {
    const f = await fixture(),
      b = await finance.budgetCreate(
        owner.actor,
        f.id,
        f.id,
        budget(),
        randomUUID(),
      );
    await alerts.create(
      owner.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        budgetId: b.id,
        threshold: '20.00',
        basis: 'COMMITTED',
      },
      randomUUID(),
    );
    await finance.commitmentCreate(
      owner.actor,
      f.id,
      f.id,
      b.id,
      { id: randomUUID(), amount: '20.00' },
      randomUUID(),
    );
    expect(
      await client.companyBudgetAlertOccurrence.count({
        where: { spaceId: f.id },
      }),
    ).toBe(1);
    expect(
      await client.companyNotification.count({
        where: { spaceId: f.id, kind: 'BUDGET_THRESHOLD' },
      }),
    ).toBe(3);
    await finance.categoryCreate(
      owner.actor,
      f.id,
      f.id,
      { id: randomUUID(), title: 'Unrelated' },
      randomUUID(),
    );
    expect(
      await client.companyBudgetAlertOccurrence.count({
        where: { spaceId: f.id },
      }),
    ).toBe(1);
  });
  it('keeps KPI history observed, recovery drafts inactive and retention approvals separate', async () => {
    const f = await fixture();
    const observation = await performance.recordObservation(
      owner.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        metric: 'Recorded work',
        unit: 'items',
        value: '12',
        source: 'Explicit observation',
        periodStart: '2026-01-01T00:00:00Z',
        periodEnd: '2026-02-01T00:00:00Z',
      },
      randomUUID(),
    );
    expect(observation.value).toBe('12.0000');
    await expect(
      performance.observations(member.actor, f.id, f.id, {
        ...page,
        from: '2026-01-01T00:00:00Z',
        to: '2026-03-01T00:00:00Z',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await governance.recovery(
        member.actor,
        f.id,
        { id: randomUUID(), evidenceReference: null },
        randomUUID(),
      ),
    ).toMatchObject({ state: 'POLICY_GATED', executable: false });
    expect(
      await governance.recoveryPolicyDraft(
        owner.actor,
        f.id,
        {
          id: randomUUID(),
          version: 'draft-1',
          requiredApprovals: null,
          approvers: [],
          proofValiditySeconds: null,
          waitingSeconds: null,
          approvalReference: null,
        },
        randomUUID(),
      ),
    ).toMatchObject({ state: 'DRAFT', executable: false });
    expect(await access.retentionReadiness(owner.actor, f.id)).toMatchObject({
      approvalRecorded: true,
      activationAuthorized: false,
    });
  });
  it('returns inviter-safe details, rotates recipient proofs on resend and hides proof material on HTTP creation', async () => {
    const f = await fixture();
    const created = await request(app.getHttpServer())
      .post(`/api/v1/companies/${f.id}/contexts/${f.id}/invitations`)
      .set('Origin', origin)
      .set('Cookie', owner.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        memberRole: 'MEMBER',
        recipient: { userId: outsider.actor.userId },
      })
      .expect(201);
    expect(created.body.proof).toBeNull();
    const offer = created.body.invitation as { id: string; revision: number };
    const before = await access.issueProof(
      outsider.actor,
      offer.id,
      offer.revision,
    );
    await access.resend(
      owner.actor,
      f.id,
      f.id,
      offer.id,
      before.revision,
      randomUUID(),
    );
    await expect(
      access.decide(
        outsider.actor,
        offer.id,
        before.proof,
        before.revision,
        true,
      ),
    ).rejects.toThrow();
    const sent = await access.sentDetails(owner.actor, f.id, f.id, page);
    expect(sent.items.find((i) => i.id === offer.id)?.recipientEmail).toBe(
      outsider.email,
    );
    expect(JSON.stringify(sent)).not.toContain('proof');
    await expect(
      access.sentDetails(member.actor, f.id, f.id, page),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('escalates only after the explicitly published policy timeout and preserves a pending decision', async () => {
    const f = await fixture(),
      w = await workflow(f),
      e = await expense(f),
      p = await policies.create(
        owner.actor,
        f.id,
        f.id,
        {
          id: randomUUID(),
          kind: 'EXPENSE',
          effectiveFrom: '2026-01-01T00:00:00Z',
          effectiveUntil: null,
          rules: [
            {
              currency: 'USD',
              minimum: '0',
              maximum: null,
              categoryId: null,
              workflowVersionId: w.id,
              escalateAfterSeconds: 1,
            },
          ],
        },
        randomUUID(),
      );
    await policies.change(owner.actor, f.id, f.id, p.id, 1, {
      state: 'PUBLISHED',
    });
    const a = await flows.expenseSubmit(
      member.actor,
      f.id,
      f.id,
      e.id,
      1,
      null,
    );
    // Recreate the handler with no in-memory request state; the deadline/source live in PostgreSQL.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const restarted = new CompanyPolicyWorker(
      app.get(DatabaseService),
      access,
      app.get(CompanyStaffContext),
      companies,
      flows,
    );
    expect(await restarted.consume()).toBe(true);
    const row = await client.companyFinancialApproval.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(row).toMatchObject({ state: 'ACTIVE', escalated: true });
    expect(await worker.consume()).toBe(false);
    expect(
      await client.companyFinancialApprovalEvent.count({
        where: { approvalId: a.id, action: 'ESCALATE' },
      }),
    ).toBe(1);
  });
  it('projects only admitted hierarchy branches and preserves immutable transfer placements', async () => {
    const f = await fixture(),
      a = await companies.createContext(
        owner.actor,
        f.id,
        null,
        { id: randomUUID(), title: 'Source department' },
        randomUUID(),
      ),
      b = await companies.createContext(
        owner.actor,
        f.id,
        null,
        { id: randomUUID(), title: 'Destination department' },
        randomUUID(),
      ),
      unit = await companies.createContext(
        owner.actor,
        f.id,
        a.id,
        { id: randomUUID(), title: 'Unit' },
        randomUUID(),
      );
    const original = await admit(f.id, member, 'MEMBER', unit.id);
    await admit(f.id, member, 'MEMBER', a.id);
    const chart = await queries.chart(member.actor, f.id);
    expect(chart.nodes.map((n) => n.id)).toContain(unit.id);
    expect(chart.nodes.map((n) => n.id)).not.toContain(b.id);
    const transferred = await access.transfer(owner.actor, f.id, {
      id: randomUUID(),
      accessId: original.id,
      fromScopeId: unit.id,
      toScopeId: b.id,
      memberRole: 'MEMBER',
      revision: original.revision,
    });
    await expect(
      client.companyDepartmentTransfer.update({
        where: { id: transferred.id },
        data: { role: 'VIEWER' },
      }),
    ).rejects.toThrow();
    const history = await queries.transfers(owner.actor, f.id, page);
    expect(history.items.find((r) => r.id === transferred.id)).toMatchObject({
      fromDepartmentId: a.id,
      fromUnitId: unit.id,
      toDepartmentId: b.id,
      toUnitId: null,
      state: 'CONFIRMED',
    });
    await expect(
      queries.transfers(member.actor, f.id, page),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('redacts new confidential content during independent identity erasure while preserving structural history', async () => {
    const f = await fixture(),
      one = await performance.createOne(
        admin.actor,
        f.id,
        f.id,
        {
          id: randomUUID(),
          employee: ref(f.subject),
          meetingAt: new Date().toISOString(),
          notes: 'Erasure sentinel',
        },
        randomUUID(),
      );
    await performance.action(
      member.actor,
      f.id,
      f.id,
      one.id,
      { id: randomUUID(), body: 'Private erased follow-up' },
      randomUUID(),
    );
    await client.$transaction((tx) =>
      app.get(CompanyErasure).erase(tx, f.id, f.subject.actorId),
    );
    expect(
      await client.companyOneOnOne.findUniqueOrThrow({ where: { id: one.id } }),
    ).toMatchObject({ notes: null });
    expect(
      (
        await client.companyOneOnOneRevision.findMany({
          where: { recordId: one.id },
        })
      ).every((r) => r.notes === null && r.redactedAt !== null),
    ).toBe(true);
    expect(
      (
        await client.companyOneOnOneAction.findMany({
          where: { recordId: one.id },
        })
      ).every((r) => r.body === null),
    ).toBe(true);
  });
  it('disposes controlled budget approvals and new private/asset/governance relationships child-first', async () => {
    const f = await fixture(),
      b = await finance.budgetCreate(
        owner.actor,
        f.id,
        f.id,
        budget(),
        randomUUID(),
      ),
      w = await workflow(f, 'BUDGET_CHANGE');
    const policy = await policies.create(
      owner.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        kind: 'BUDGET_CHANGE',
        effectiveFrom: '2026-01-01T00:00:00Z',
        effectiveUntil: null,
        rules: [
          {
            currency: 'USD',
            minimum: '0',
            maximum: null,
            categoryId: null,
            workflowVersionId: w.id,
            escalateAfterSeconds: null,
          },
        ],
      },
      randomUUID(),
    );
    await policies.change(owner.actor, f.id, f.id, policy.id, 1, {
      state: 'PUBLISHED',
    });
    const delegation = await governance.delegation(
      admin.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        delegate: ref(f.alternate),
        workflowVersionId: w.id,
        validFrom: '2026-01-01T00:00:00Z',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      randomUUID(),
    );
    const r = await budgetRequests.create(
      owner.actor,
      f.id,
      f.id,
      b.id,
      {
        id: randomUUID(),
        amount: '20.00',
        direction: 'INCREASE',
        reason: null,
      },
      randomUUID(),
    );
    expect(
      (await budgetRequests.get(admin.actor, f.id, f.id, r.id)).can.decide,
    ).toBe(false);
    await expect(
      budgetRequests.decide(admin.actor, f.id, f.id, r.id, 1, {
        decision: 'APPROVE',
        reason: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const a = await flows.budgetSubmit(owner.actor, f.id, f.id, r.id, 1, null);
    await flows.decision(second.actor, f.id, f.id, a.id, 1, {
      decision: 'APPROVE',
    });
    expect(
      (await flows.timeline(owner.actor, f.id, f.id, a.id, page)).items.some(
        (e) => e.delegationId === delegation.id,
      ),
    ).toBe(true);
    const asset = await staff.createResource(
        owner.actor,
        f.id,
        f.id,
        { id: randomUUID(), title: 'Retained asset', description: null },
        randomUUID(),
      ),
      custody = await assets.assign(
        owner.actor,
        f.id,
        f.id,
        asset.id,
        { id: randomUUID(), member: ref(f.subject), expectedReturnAt: null },
        randomUUID(),
      );
    await assets.returnAsset(owner.actor, f.id, f.id, asset.id, custody.id, 1);
    const maintenance = await assets.schedule(
      owner.actor,
      f.id,
      f.id,
      asset.id,
      {
        id: randomUUID(),
        kind: 'Inspection',
        reason: null,
        scheduledAt: new Date().toISOString(),
        responsible: ref(f.reviewer),
      },
      randomUUID(),
    );
    await assets.changeMaintenance(
      owner.actor,
      f.id,
      f.id,
      asset.id,
      maintenance.id,
      1,
      { state: 'COMPLETED' },
    );
    const one = await performance.createOne(
      admin.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        employee: ref(f.subject),
        meetingAt: new Date().toISOString(),
        notes: 'Private disposal sentinel',
      },
      randomUUID(),
    );
    await performance.action(
      member.actor,
      f.id,
      f.id,
      one.id,
      { id: randomUUID(), body: 'Private follow-up' },
      randomUUID(),
    );
    const cycle = await performance.createCycle(
      owner.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        title: 'Retained cycle',
        periodStart: '2026-01-01T00:00:00Z',
        periodEnd: '2026-12-31T00:00:00Z',
      },
      randomUUID(),
    );
    await performance.assignReview(
      owner.actor,
      f.id,
      f.id,
      cycle.id,
      { id: randomUUID(), subject: ref(f.subject), reviewer: ref(f.reviewer) },
      randomUUID(),
    );
    await governance.recovery(
      member.actor,
      f.id,
      { id: randomUUID(), evidenceReference: null },
      randomUUID(),
    );
    await governance.recoveryPolicyDraft(
      owner.actor,
      f.id,
      {
        id: randomUUID(),
        version: 'disposal-draft',
        requiredApprovals: null,
        approvers: [],
        proofValiditySeconds: null,
        waitingSeconds: null,
        approvalReference: null,
      },
      randomUUID(),
    );
    const role = await governance.createRole(
      owner.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        title: 'Retained role',
        capabilities: ['directory.read'],
      },
      randomUUID(),
    );
    await governance.assignRole(
      owner.actor,
      f.id,
      f.id,
      role.id,
      { id: randomUUID(), member: ref(f.subject) },
      randomUUID(),
    );
    await governance.temporary(
      owner.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        member: ref(f.subject),
        capabilities: ['directory.read'],
        validFrom: '2026-01-01T00:00:00Z',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        reason: 'Explicit temporary grant',
      },
      randomUUID(),
    );
    await governance.review(
      owner.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        member: ref(f.subject),
        decision: 'RETAIN',
        reason: 'Reviewed',
      },
      randomUUID(),
    );
    await alerts.create(
      owner.actor,
      f.id,
      f.id,
      {
        id: randomUUID(),
        budgetId: b.id,
        threshold: '20.00',
        basis: 'COMMITTED',
      },
      randomUUID(),
    );
    await finance.commitmentCreate(
      owner.actor,
      f.id,
      f.id,
      b.id,
      { id: randomUUID(), amount: '20.00' },
      randomUUID(),
    );
    for (const who of [member, admin, second]) {
      const seat = await client.contextAccess.findFirstOrThrow({
        where: {
          spaceId: f.id,
          scopeId: f.id,
          SharedActor: { userId: who.actor.userId },
        },
      });
      await companies.leave(who.actor, f.id, f.id, seat.revision);
    }
    const life = app.get(CompanyLifecycleService),
      cleanup = app.get(CompanyCleanupService),
      co = await companies.read(owner.actor, f.id);
    await life.change(owner.actor, f.id, co.revision, 'delete', password);
    // Fixture-only time advance, using the existing lifecycle rehearsal convention.
    const closure = await client.sharedLifecycleJob.findFirstOrThrow({
        where: { spaceId: f.id },
      }),
      recoveryWindow =
        +closure.recoveryDeadline - +closure.effectiveDepartureAt,
      shiftedDeparture = new Date(Date.now() - 31 * 86400000);
    expect(recoveryWindow).toBe(7 * 86400000);
    await client.sharedLifecycleJob.updateMany({
      where: { spaceId: f.id },
      data: {
        effectiveDepartureAt: shiftedDeparture,
        recoveryDeadline: new Date(+shiftedDeparture + recoveryWindow),
        nextAt: new Date(0),
      },
    });
    for (
      let i = 0;
      i < 100 && (await client.company.findUnique({ where: { id: f.id } }));
      i++
    )
      await cleanup.consume();
    expect(await client.company.findUnique({ where: { id: f.id } })).toBeNull();
    expect(
      await client.companyFinancialApproval.count({ where: { spaceId: f.id } }),
    ).toBe(0);
    expect(
      await client.user.findUnique({ where: { id: member.actor.userId } }),
    ).not.toBeNull();
  }, 30000);
});
