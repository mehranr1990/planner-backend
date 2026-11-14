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
import { setImmediate as tick } from 'node:timers/promises';
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
  CompanyErasure,
} from '../../src/modules/spaces/public/index.js';
import {
  CompaniesService,
  CompanyStaffService,
  CompanyEmployeeCasesService,
} from '../../src/modules/companies/public/index.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
type Person = { actor: RequestActor; email: string; cookie: string };
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
    (error) => ({ value: undefined, error: error as Error }),
  );
const ref = (m: { id: string; generation: number }) => ({
  accessId: m.id,
  generation: m.generation,
});
describe('P4-02 staff privacy, availability and exclusive Company allocations', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    client: PrismaClient,
    observer: Client,
    watcher: Client;
  let companies: CompaniesService,
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
  const version = 'synthetic-p402-' + randomUUID(),
    name = 'p402-' + randomUUID(),
    origin = 'http://localhost:3000',
    password = 'synthetic-p402-only-123!';
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
    const root = fs.mkdtempSync(path.resolve('.tools/p402-fixture-'));
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
  const profileBody = (m: { id: string; generation: number }) => ({
    id: randomUUID(),
    member: ref(m),
    position: 'Engineer',
    supervisor: null,
    workStatus: 'ACTIVE' as const,
  });
  const resourceBody = () => ({
    id: randomUUID(),
    title: 'Single laptop',
    description: null,
  });
  const window = () => ({
    startAt: new Date(Date.now() - 600000).toISOString(),
    endAt: new Date(Date.now() + 3600000).toISOString(),
  });
  async function employeeCase(
    id: string,
    subject: { id: string; generation: number },
    reviewer: { id: string; generation: number },
  ) {
    return cases.create(
      owner.actor,
      id,
      id,
      {
        id: randomUUID(),
        subject: ref(subject),
        reviewer: ref(reviewer),
        reason: 'Confidential reason sentinel',
        evidence: 'Private evidence sentinel',
      },
      randomUUID(),
    );
  }
  async function blocked() {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const r = await watcher.query<{ n: number }>(
        `SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND cardinality(pg_blocking_pids(pid))>0`,
        [[name, name + '-observer']],
      );
      if (r.rows[0]!.n) return;
      await tick();
    }
    throw new Error('Expected observed PostgreSQL lock wait');
  }

  it('keeps profiles explicit, replays one creation and records exactly one receipt/usage effect', async () => {
    const { co, subject } = await fixture(),
      body = profileBody(subject),
      key = randomUUID();
    const row = await staff.createProfile(owner.actor, co.id, co.id, body, key);
    expect(
      await staff.createProfile(owner.actor, co.id, co.id, body, key),
    ).toEqual(row);
    expect(row.workEmail).toBeNull();
    expect(row.member).toEqual({
      ...ref(subject),
      displayName: 'Synthetic staff fixture',
    });
    expect(
      (await staff.profiles(member.actor, co.id, co.id, { limit: 25 })).items,
    ).toHaveLength(1);
    await expect(
      staff.createProfile(
        owner.actor,
        co.id,
        co.id,
        { ...body, position: 'Changed' },
        key,
      ),
    ).rejects.toHaveProperty('status', 409);
    expect(
      await client.sharedUsageEntry.count({
        where: { spaceId: co.id, feature: 'company.staff-profile' },
      }),
    ).toBe(1);
    expect(
      await client.sharedMutationReceipt.count({
        where: { spaceId: co.id, operation: 'company.profile.create' },
      }),
    ).toBe(1);
  });
  it('requires administrative profile authority and rejects cross-Company subjects/supervisors and nested IDs', async () => {
    const { co, subject } = await fixture(),
      other = await company(),
      foreign = await admit(other.id);
    await expect(
      staff.createProfile(
        member.actor,
        co.id,
        co.id,
        profileBody(subject),
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      staff.createProfile(
        owner.actor,
        co.id,
        co.id,
        profileBody(foreign),
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      staff.createProfile(
        owner.actor,
        co.id,
        co.id,
        { ...profileBody(subject), supervisor: ref(foreign) },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
    const row = await staff.createProfile(
      owner.actor,
      co.id,
      co.id,
      profileBody(subject),
      randomUUID(),
    );
    await expect(
      staff.readProfile(owner.actor, other.id, other.id, row.id),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      staff.readProfile(outsider.actor, co.id, co.id, row.id),
    ).rejects.toHaveProperty('status', 404);
  });
  it('publishes verified contact only by subject opt-in and hides a changed provider identity until renewed consent', async () => {
    const { co, subject } = await fixture(),
      row = await staff.createProfile(
        owner.actor,
        co.id,
        co.id,
        profileBody(subject),
        randomUUID(),
      );
    await expect(
      staff.contact(owner.actor, co.id, co.id, row.id, 1, { published: true }),
    ).rejects.toHaveProperty('status', 403);
    const published = await staff.contact(
      member.actor,
      co.id,
      co.id,
      row.id,
      1,
      { published: true },
    );
    expect(published.workEmail).toBe(member.email);
    const original = member.email;
    await client.user.update({
      where: { id: member.actor.userId },
      data: { email: 'changed-' + randomUUID() + '@example.test' },
    });
    try {
      expect(
        (await staff.readProfile(owner.actor, co.id, co.id, row.id)).workEmail,
      ).toBeNull();
    } finally {
      await client.user.update({
        where: { id: member.actor.userId },
        data: { email: original },
      });
    }
    expect(
      (
        await staff.contact(member.actor, co.id, co.id, row.id, 2, {
          published: false,
        })
      ).workEmail,
    ).toBeNull();
  });
  it('redacts subject profiles irreversibly and keeps administration out of the subject erase right', async () => {
    const { co, subject } = await fixture(),
      row = await staff.createProfile(
        owner.actor,
        co.id,
        co.id,
        profileBody(subject),
        randomUUID(),
      );
    await expect(
      staff.eraseProfile(owner.actor, co.id, co.id, row.id, 1),
    ).rejects.toHaveProperty('status', 403);
    expect(
      await staff.eraseProfile(member.actor, co.id, co.id, row.id, 1),
    ).toMatchObject({
      position: null,
      workEmail: null,
      workStatus: 'INACTIVE',
      revision: 2,
    });
    await expect(
      staff.patchProfile(owner.actor, co.id, co.id, row.id, 2, {
        position: 'Revive',
      }),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      client.companyStaffProfile.update({
        where: { id: row.id },
        data: { position: 'Revive', revision: { increment: 1 } },
      }),
    ).rejects.toThrow();
  });
  it('stores explicit availability, permits self Viewer updates, and preserves unknown/zero semantics', async () => {
    const { co } = await fixture(),
      m = await root(co.id, viewer),
      body = {
        id: randomUUID(),
        member: ref(m),
        date: '2026-11-07',
        timezone: 'Asia/Tehran',
        availableMinutes: 0,
      };
    const row = await staff.createAvailability(
      viewer.actor,
      co.id,
      co.id,
      body,
      randomUUID(),
    );
    expect(row.availableMinutes).toBe(0);
    expect(
      (
        await staff.patchAvailability(viewer.actor, co.id, co.id, row.id, 1, {
          availableMinutes: null,
        })
      ).availableMinutes,
    ).toBeNull();
    await expect(
      staff.patchAvailability(member.actor, co.id, co.id, row.id, 2, {
        availableMinutes: 60,
      }),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      staff.patchAvailability(owner.actor, co.id, co.id, row.id, 1, {
        availableMinutes: 60,
      }),
    ).rejects.toHaveProperty('status', 409);
    expect(
      (await staff.availability(owner.actor, co.id, co.id, { limit: 25 }))
        .items,
    ).toHaveLength(1);
  });
  it('requires explicit child admission and restricts Department managers to their admitted child', async () => {
    const { co } = await fixture(),
      dept = await companies.createContext(
        owner.actor,
        co.id,
        null,
        { id: randomUUID(), title: 'Department' },
        randomUUID(),
      );
    await expect(
      staff.resources(owner.actor, co.id, dept.id, { limit: 25 }),
    ).rejects.toHaveProperty('status', 404);
    await admit(co.id, owner, 'MEMBER', dept.id, admin);
    const manager = await admit(co.id, member, 'DEPT_MANAGER', dept.id);
    await admit(co.id, viewer, 'VIEWER', dept.id);
    await staff.createProfile(
      member.actor,
      co.id,
      dept.id,
      profileBody(manager),
      randomUUID(),
    );
    await expect(
      staff.createResource(
        member.actor,
        co.id,
        co.id,
        resourceBody(),
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    const item = await staff.createResource(
      member.actor,
      co.id,
      dept.id,
      resourceBody(),
      randomUUID(),
    );
    await expect(
      staff.readResource(viewer.actor, co.id, co.id, item.id),
    ).rejects.toHaveProperty('status', 404);
  });
  it('intersects inherited mandatory directory policy and invalidates previously issued cursors', async () => {
    const { co, subject } = await fixture();
    await staff.createProfile(
      owner.actor,
      co.id,
      co.id,
      profileBody(subject),
      randomUUID(),
    );
    await staff.createProfile(
      owner.actor,
      co.id,
      co.id,
      profileBody(await root(co.id, viewer)),
      randomUUID(),
    );
    const first = await staff.profiles(member.actor, co.id, co.id, {
      limit: 1,
    });
    expect(first.nextCursor).not.toBeNull();
    await companies.publish(owner.actor, co.id, co.id, 1, {
      rules: [
        {
          key: 'directory.read',
          mode: 'MANDATORY',
          roles: ['OWNER', 'ORG_ADMIN'],
          overrideDefault: false,
        },
      ],
    });
    await expect(
      staff.profiles(member.actor, co.id, co.id, {
        limit: 1,
        after: first.nextCursor!,
      }),
    ).rejects.toHaveProperty('status', 404);
    expect(
      (await staff.profiles(owner.actor, co.id, co.id, { limit: 25 })).items,
    ).toHaveLength(2);
  });
  it('hides old profile and availability generations after explicit leave/rejoin', async () => {
    const { co, subject } = await fixture(),
      body = profileBody(subject);
    await staff.createProfile(owner.actor, co.id, co.id, body, randomUUID());
    await staff.createAvailability(
      member.actor,
      co.id,
      co.id,
      {
        id: randomUUID(),
        member: ref(subject),
        date: '2026-11-07',
        timezone: 'UTC',
        availableMinutes: 30,
      },
      randomUUID(),
    );
    await companies.changeMember(
      owner.actor,
      co.id,
      co.id,
      subject.id,
      subject.revision,
      { state: 'REVOKED', memberRole: 'MEMBER' },
    );
    await admit(co.id);
    expect(
      (await staff.profiles(owner.actor, co.id, co.id, { limit: 25 })).items,
    ).toHaveLength(0);
    expect(
      (await staff.availability(member.actor, co.id, co.id, { limit: 25 }))
        .items,
    ).toHaveLength(0);
    await expect(
      staff.readProfile(member.actor, co.id, co.id, body.id),
    ).rejects.toHaveProperty('status', 404);
  });
  it('rejects overlap, allows adjacency, and preserves terminal allocation/retirement history', async () => {
    const { co, subject } = await fixture(),
      item = await staff.createResource(
        owner.actor,
        co.id,
        co.id,
        resourceBody(),
        randomUUID(),
      ),
      w = window(),
      body = { id: randomUUID(), member: ref(subject), ...w },
      key = randomUUID();
    const row = await staff.createAllocation(
      owner.actor,
      co.id,
      co.id,
      item.id,
      body,
      key,
    );
    expect(
      await staff.createAllocation(
        owner.actor,
        co.id,
        co.id,
        item.id,
        body,
        key,
      ),
    ).toEqual(row);
    await expect(
      staff.createAllocation(
        owner.actor,
        co.id,
        co.id,
        item.id,
        { ...body, id: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 409);
    const adjacent = await staff.createAllocation(
      owner.actor,
      co.id,
      co.id,
      item.id,
      {
        id: randomUUID(),
        member: ref(subject),
        startAt: w.endAt,
        endAt: new Date(Date.parse(w.endAt) + 3600000).toISOString(),
      },
      randomUUID(),
    );
    await expect(
      staff.retireResource(owner.actor, co.id, co.id, item.id, 1),
    ).rejects.toHaveProperty('status', 409);
    await staff.endAllocation(
      owner.actor,
      co.id,
      co.id,
      adjacent.id,
      1,
      'CANCELED',
    );
    await staff.endAllocation(owner.actor, co.id, co.id, row.id, 1, 'RETURNED');
    await expect(
      staff.endAllocation(owner.actor, co.id, co.id, row.id, 2, 'CANCELED'),
    ).rejects.toHaveProperty('status', 409);
    expect(
      (await staff.retireResource(owner.actor, co.id, co.id, item.id, 1)).state,
    ).toBe('RETIRED');
    expect(
      (
        await staff.allocations(viewer.actor, co.id, co.id, item.id, {
          limit: 25,
        })
      ).items,
    ).toHaveLength(2);
  });
  it('serializes raw concurrent overlap through independent PostgreSQL connections', async () => {
    const { co, subject } = await fixture(),
      item = await staff.createResource(
        owner.actor,
        co.id,
        co.id,
        resourceBody(),
        randomUUID(),
      ),
      a = await root(co.id),
      w = window();
    const sql = `INSERT INTO "CompanyResourceAllocation"(id,"spaceId","scopeId","resourceId","memberAccessId","memberGeneration","createdByActorId","startAt","endAt",state) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,'ALLOCATED')`;
    const values = [
      randomUUID(),
      co.id,
      item.id,
      subject.id,
      subject.generation,
      a.actorId,
      w.startAt,
      w.endAt,
    ];
    await observer.query('BEGIN');
    let pending: Promise<unknown> | undefined;
    try {
      await observer.query(sql, values);
      pending = outcome(
        client.$executeRawUnsafe(sql, randomUUID(), ...values.slice(1)),
      );
      await blocked();
      await observer.query('COMMIT');
      expect(((await pending) as { error?: Error }).error).toBeDefined();
    } finally {
      await observer.query('ROLLBACK');
      if (pending) await pending;
    }
    expect(
      await client.companyResourceAllocation.count({
        where: { resourceId: item.id },
      }),
    ).toBe(1);
  });
  it('keeps confidential cases invisible to unnamed Company administrators and ordinary directory counts', async () => {
    const { co, subject, reviewer } = await fixture(),
      row = await employeeCase(co.id, subject, reviewer),
      other = await person();
    await admit(co.id, other, 'ORG_ADMIN');
    expect((await cases.read(member.actor, co.id, co.id, row.id)).reason).toBe(
      'Confidential reason sentinel',
    );
    await expect(
      cases.read(other.actor, co.id, co.id, row.id),
    ).rejects.toHaveProperty('status', 404);
    expect(
      (await cases.list(other.actor, co.id, co.id, { limit: 25 })).items,
    ).toHaveLength(0);
    expect(
      (await cases.list(viewer.actor, co.id, co.id, { limit: 25 })).items,
    ).toHaveLength(0);
    expect(
      await client.sharedAuditEvent.count({
        where: {
          spaceId: co.id,
          resourceId: row.id,
          action: 'company.employee.case.read',
        },
      }),
    ).toBe(1);
  });
  it('requires distinct named reviewers and current Owner/Org Admin status', async () => {
    const { co, subject, reviewer } = await fixture();
    await expect(employeeCase(co.id, subject, subject)).rejects.toHaveProperty(
      'status',
      403,
    );
    const me = await root(co.id);
    await expect(employeeCase(co.id, subject, me)).rejects.toHaveProperty(
      'status',
      409,
    );
    const row = await employeeCase(co.id, subject, reviewer);
    await companies.changeMember(
      owner.actor,
      co.id,
      co.id,
      reviewer.id,
      reviewer.revision,
      { state: 'ACTIVE', memberRole: 'MEMBER' },
    );
    await expect(
      cases.read(admin.actor, co.id, co.id, row.id),
    ).rejects.toHaveProperty('status', 404);
    expect((await cases.read(member.actor, co.id, co.id, row.id)).id).toBe(
      row.id,
    );
  });
  it('lets Viewer subjects respond/appeal and only named reviewer resolve, retaining original evidence', async () => {
    const { co, reviewer } = await fixture(),
      subject = await root(co.id, viewer),
      row = await employeeCase(co.id, subject, reviewer),
      entry = {
        id: randomUUID(),
        kind: 'APPEAL' as const,
        body: 'Private appeal sentinel',
      },
      key = randomUUID();
    const result = await cases.append(
      viewer.actor,
      co.id,
      co.id,
      row.id,
      1,
      entry,
      key,
    );
    expect(result.case.revision).toBe(2);
    expect(
      await cases.append(viewer.actor, co.id, co.id, row.id, 1, entry, key),
    ).toEqual(result);
    await expect(
      cases.append(
        owner.actor,
        co.id,
        co.id,
        row.id,
        2,
        {
          id: randomUUID(),
          kind: 'REVIEW',
          body: 'Not designated',
          state: 'RESOLVED',
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    const reviewed = await cases.append(
      admin.actor,
      co.id,
      co.id,
      row.id,
      2,
      {
        id: randomUUID(),
        kind: 'REVIEW',
        body: 'Reviewed confidentially',
        state: 'RESOLVED',
      },
      randomUUID(),
    );
    expect(reviewed.case).toMatchObject({
      state: 'RESOLVED',
      reason: row.reason,
      evidence: row.evidence,
      revision: 3,
    });
    expect(
      (await cases.entries(viewer.actor, co.id, co.id, row.id, { limit: 25 }))
        .items,
    ).toHaveLength(2);
  });
  it('redacts sensitive case and entries without permitting later revival', async () => {
    const { co, subject, reviewer } = await fixture(),
      row = await employeeCase(co.id, subject, reviewer);
    await cases.append(
      member.actor,
      co.id,
      co.id,
      row.id,
      1,
      { id: randomUUID(), kind: 'RESPONSE', body: 'Sensitive response' },
      randomUUID(),
    );
    await expect(
      cases.erase(owner.actor, co.id, co.id, row.id, 2),
    ).rejects.toHaveProperty('status', 403);
    expect(
      await cases.erase(member.actor, co.id, co.id, row.id, 2),
    ).toMatchObject({ reason: null, evidence: null, revision: 3 });
    expect(
      (await cases.entries(admin.actor, co.id, co.id, row.id, { limit: 25 }))
        .items[0]!.body,
    ).toBeNull();
    await expect(
      cases.append(
        owner.actor,
        co.id,
        co.id,
        row.id,
        3,
        { id: randomUUID(), kind: 'CORRECTION', body: 'Revive' },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      client.companyEmployeeCase.update({
        where: { id: row.id },
        data: { reason: 'Revive', revision: { increment: 1 } },
      }),
    ).rejects.toThrow();
  });
  it('excludes confidential bodies and contacts from receipts, audit, outbox and signed recovery evidence', async () => {
    const { co, subject, reviewer } = await fixture(),
      profile = await staff.createProfile(
        owner.actor,
        co.id,
        co.id,
        profileBody(subject),
        randomUUID(),
      );
    await staff.contact(member.actor, co.id, co.id, profile.id, 1, {
      published: true,
    });
    const row = await employeeCase(co.id, subject, reviewer);
    await cases.read(admin.actor, co.id, co.id, row.id);
    const opaque = JSON.stringify(
      [
        await client.sharedAuditEvent.findMany({ where: { spaceId: co.id } }),
        await client.sharedOutboxEvent.findMany({ where: { spaceId: co.id } }),
        await client.sharedMutationReceipt.findMany({
          where: { spaceId: co.id },
        }),
        await control.replayEvidence(),
      ],
      (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    );
    for (const secret of [row.reason, row.evidence, member.email])
      expect(opaque).not.toContain(secret);
  });
  it('redacts Company subject data before independent Personal identity detachment', async () => {
    const who = await person(),
      { co, reviewer } = await fixture(),
      subject = await admit(co.id, who),
      profile = await staff.createProfile(
        owner.actor,
        co.id,
        co.id,
        profileBody(subject),
        randomUUID(),
      ),
      row = await employeeCase(co.id, subject, reviewer);
    await staff.contact(who.actor, co.id, co.id, profile.id, 1, {
      published: true,
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
      await client.companyStaffProfile.findUniqueOrThrow({
        where: { id: profile.id },
      }),
    ).toMatchObject({ position: null, workEmail: null });
    expect(
      await client.companyEmployeeCase.findUniqueOrThrow({
        where: { id: row.id },
      }),
    ).toMatchObject({ reason: null, evidence: null });
    expect(
      (
        await client.sharedActor.findFirstOrThrow({
          where: { spaceId: co.id, id: subject.actorId },
        })
      ).userId,
    ).toBeNull();
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: co.id },
        })
      ).state,
    ).toBe('ACTIVE');
  });
  it('fails closed when the Company erasure owner is unavailable', async () => {
    const port = new CompanyErasure();
    await expect(
      Promise.resolve().then(() =>
        port.erase(client, randomUUID(), randomUUID()),
      ),
    ).rejects.toHaveProperty('status', 503);
  });
  it('rejects stale writes after winning membership revocation with observed lock ordering', async () => {
    const { co, subject } = await fixture(),
      row = await staff.createProfile(
        owner.actor,
        co.id,
        co.id,
        profileBody(subject),
        randomUUID(),
      ),
      entered = barrier(),
      release = barrier(),
      original = kernel.offerEffect.bind(kernel);
    vi.spyOn(kernel, 'offerEffect').mockImplementation(async (...args) => {
      if (args[4] === 'company.membership.change') {
        entered.release();
        await release.promise;
      }
      return original(...args);
    });
    const revoke = outcome(
      companies.changeMember(
        owner.actor,
        co.id,
        co.id,
        subject.id,
        subject.revision,
        { state: 'REVOKED', memberRole: 'MEMBER' },
      ),
    );
    await entered.promise;
    const stale = outcome(
      staff.contact(member.actor, co.id, co.id, row.id, 1, { published: true }),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await revoke).error).toBeUndefined();
    expect((await stale).error).toHaveProperty('status', 404);
    expect(
      (
        await client.companyStaffProfile.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).workEmail,
    ).toBeNull();
  });
  it('commits a winning mutation before a waiting revocation and denies later effects', async () => {
    const { co, subject } = await fixture(),
      row = await staff.createProfile(
        owner.actor,
        co.id,
        co.id,
        profileBody(subject),
        randomUUID(),
      ),
      entered = barrier(),
      release = barrier(),
      original = kernel.offerEffect.bind(kernel);
    vi.spyOn(kernel, 'offerEffect').mockImplementation(async (...args) => {
      if (args[4] === 'company.contact.change') {
        entered.release();
        await release.promise;
      }
      return original(...args);
    });
    const write = outcome(
      staff.contact(member.actor, co.id, co.id, row.id, 1, { published: true }),
    );
    await entered.promise;
    const revoke = outcome(
      companies.changeMember(
        owner.actor,
        co.id,
        co.id,
        subject.id,
        subject.revision,
        { state: 'REVOKED', memberRole: 'MEMBER' },
      ),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await write).error).toBeUndefined();
    expect((await revoke).error).toBeUndefined();
    await expect(
      staff.readProfile(member.actor, co.id, co.id, row.id),
    ).rejects.toHaveProperty('status', 404);
  });
  it('rolls back source, receipt, usage and audit on effect failure and leaves retry usable', async () => {
    const { co } = await fixture(),
      body = resourceBody(),
      key = randomUUID(),
      original = kernel.offerEffect.bind(kernel);
    const fail = vi
      .spyOn(kernel, 'offerEffect')
      .mockImplementation(async (...args) => {
        if (args[4] === 'company.resource.create')
          throw new ConflictException('Synthetic rollback');
        return original(...args);
      });
    await expect(
      staff.createResource(owner.actor, co.id, co.id, body, key),
    ).rejects.toHaveProperty('status', 409);
    expect(await client.companyResource.count({ where: { id: body.id } })).toBe(
      0,
    );
    expect(
      await client.sharedMutationReceipt.count({
        where: { spaceId: co.id, operation: 'company.resource.create' },
      }),
    ).toBe(0);
    expect(
      await client.sharedUsageEntry.count({
        where: { spaceId: co.id, feature: 'company.resource' },
      }),
    ).toBe(0);
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: co.id, resourceId: body.id },
      }),
    ).toBe(0);
    fail.mockRestore();
    expect(
      (await staff.createResource(owner.actor, co.id, co.id, body, key)).id,
    ).toBe(body.id);
  });
  it('quarantines confidential backup contents before and after restrictive Company restore replay', async () => {
    const { co, subject, reviewer } = await fixture(),
      row = await employeeCase(co.id, subject, reviewer),
      profile = await staff.createProfile(
        owner.actor,
        co.id,
        co.id,
        profileBody(subject),
        randomUUID(),
      );
    const before = await client.sharedCustody.findUniqueOrThrow({
      where: { spaceId: co.id },
    });
    await staff.eraseProfile(member.actor, co.id, co.id, profile.id, 1);
    await client.sharedCustody.update({
      where: { spaceId: co.id },
      data: { authorizationVersion: before.authorizationVersion },
    });
    await expect(
      cases.read(member.actor, co.id, co.id, row.id),
    ).rejects.toHaveProperty('status', 404);
    expect(
      (await kernel.restoreRestrictions(co.id, async () => {})).complete,
    ).toBe(true);
    expect(
      (await client.accessScope.findUniqueOrThrow({ where: { id: co.id } }))
        .state,
    ).toBe('CLOSED');
    await expect(
      cases.read(owner.actor, co.id, co.id, row.id),
    ).rejects.toHaveProperty('status', 404);
    expect(
      (
        await client.companyEmployeeCase.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).reason,
    ).toBe(row.reason);
  });
  it('rejects revoked sessions before confidential reads and planning writes', async () => {
    const { co, reviewer } = await fixture(),
      who = await person(),
      subject = await admit(co.id, who),
      row = await employeeCase(co.id, subject, reviewer);
    await client.authSession.delete({ where: { id: who.actor.sessionId! } });
    await expect(
      cases.read(who.actor, co.id, co.id, row.id),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      staff.createAvailability(
        who.actor,
        co.id,
        co.id,
        {
          id: randomUUID(),
          member: ref(subject),
          date: '2026-11-07',
          timezone: 'UTC',
          availableMinutes: 30,
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    expect(
      await client.companyAvailabilityDay.count({ where: { spaceId: co.id } }),
    ).toBe(0);
  });
  it('enforces same-context resource FKs and immutable availability identity in PostgreSQL', async () => {
    const { co, subject } = await fixture(),
      other = await company(),
      foreign = await staff.createResource(
        owner.actor,
        other.id,
        other.id,
        resourceBody(),
        randomUUID(),
      ),
      me = await root(co.id),
      w = window();
    await expect(
      client.companyResourceAllocation.create({
        data: {
          id: randomUUID(),
          spaceId: co.id,
          scopeId: co.id,
          resourceId: foreign.id,
          memberAccessId: subject.id,
          memberGeneration: subject.generation,
          createdByActorId: me.actorId,
          startAt: new Date(w.startAt),
          endAt: new Date(w.endAt),
          state: 'ALLOCATED',
        },
      }),
    ).rejects.toThrow();
    const available = await staff.createAvailability(
      member.actor,
      co.id,
      co.id,
      {
        id: randomUUID(),
        member: ref(subject),
        date: '2026-11-07',
        timezone: 'UTC',
        availableMinutes: 0,
      },
      randomUUID(),
    );
    await expect(
      client.companyAvailabilityDay.update({
        where: { id: available.id },
        data: {
          date: new Date('2026-11-08T00:00:00Z'),
          revision: { increment: 1 },
        },
      }),
    ).rejects.toThrow();
  });

  it('does not grant the Company Owner implicit access to another administrators sealed case', async () => {
    const { co, subject } = await fixture(),
      other = await person(),
      reviewer = await admit(co.id, other, 'ORG_ADMIN');
    const row = await cases.create(
      admin.actor,
      co.id,
      co.id,
      {
        id: randomUUID(),
        subject: ref(subject),
        reviewer: ref(reviewer),
        reason: 'Sealed from Owner',
        evidence: 'Named grant only',
      },
      randomUUID(),
    );
    await expect(
      cases.read(owner.actor, co.id, co.id, row.id),
    ).rejects.toHaveProperty('status', 404);
    expect(
      (await cases.list(owner.actor, co.id, co.id, { limit: 25 })).items,
    ).toHaveLength(0);
  });
  it('denies a confidential read after a winning revoke using an observed PostgreSQL waiter', async () => {
    const { co, subject, reviewer } = await fixture(),
      row = await employeeCase(co.id, subject, reviewer),
      entered = barrier(),
      release = barrier(),
      original = kernel.offerEffect.bind(kernel);
    vi.spyOn(kernel, 'offerEffect').mockImplementation(async (...args) => {
      if (args[4] === 'company.membership.change') {
        entered.release();
        await release.promise;
      }
      return original(...args);
    });
    const revoke = outcome(
      companies.changeMember(
        owner.actor,
        co.id,
        co.id,
        subject.id,
        subject.revision,
        { state: 'REVOKED', memberRole: 'MEMBER' },
      ),
    );
    await entered.promise;
    const read = outcome(cases.read(member.actor, co.id, co.id, row.id));
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await revoke).error).toBeUndefined();
    expect((await read).error).toHaveProperty('status', 404);
    expect(
      await client.sharedAuditEvent.count({
        where: {
          spaceId: co.id,
          resourceId: row.id,
          action: 'company.employee.case.read',
        },
      }),
    ).toBe(0);
  });

  it('bounds total Company case history so identity redaction cannot expand to a million entries', async () => {
    const { co, subject, reviewer } = await fixture(),
      first = await employeeCase(co.id, subject, reviewer),
      second = await employeeCase(co.id, subject, reviewer),
      author = await root(co.id);
    await client.companyEmployeeCaseEntry.createMany({
      data: Array.from({ length: 1000 }, () => ({
        id: randomUUID(),
        spaceId: co.id,
        scopeId: co.id,
        caseId: first.id,
        createdByActorId: author.actorId,
        kind: 'CORRECTION',
        body: 'Synthetic bounded history',
      })),
    });
    await expect(
      cases.append(
        member.actor,
        co.id,
        co.id,
        second.id,
        1,
        {
          id: randomUUID(),
          kind: 'RESPONSE',
          body: 'Over the aggregate safety bound',
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 413);
    expect(
      await client.companyEmployeeCaseEntry.count({
        where: { spaceId: co.id },
      }),
    ).toBe(1000);
    expect(
      (
        await client.companyEmployeeCase.findUniqueOrThrow({
          where: { id: second.id },
        })
      ).revision,
    ).toBe(1);
  });
  it('uses real HTTP authentication, Origin, strict input, concurrency headers and no-store responses', async () => {
    const { co } = await fixture(),
      base = '/api/v1/companies/' + co.id + '/contexts/' + co.id;
    await request(app.getHttpServer())
      .get(base + '/resources')
      .expect(401);
    await request(app.getHttpServer())
      .post(base + '/resources')
      .set('Cookie', owner.cookie)
      .send(resourceBody())
      .expect(403);
    await request(app.getHttpServer())
      .post(base + '/resources')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({ ...resourceBody(), integration: { enabled: true } })
      .expect(400);
    const created = await request(app.getHttpServer())
      .post(base + '/resources')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send(resourceBody())
      .expect(201);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.headers.etag).toBe('"1"');
    await request(app.getHttpServer())
      .patch(base + '/resources/' + (created.body as { id: string }).id)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({ title: 'Missing revision' })
      .expect(400);
    await request(app.getHttpServer())
      .get(base + '/resources?privateQuery=1')
      .set('Cookie', owner.cookie)
      .expect(400);
  });
});
