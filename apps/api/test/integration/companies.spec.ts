import type { z } from 'zod';
import { CompaniesService } from '../../src/modules/companies/public/index.js';
import { CompanyAccess } from '../../src/modules/spaces/public/index.js';
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
import request from 'supertest';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { DatabaseService } from '../../src/platform/database/database.service.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import {
  SharedKernel,
  SpacesService,
  CollaborationService,
  SharedFeaturePolicy,
} from '../../src/modules/spaces/public/index.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { ProjectsService } from '../../src/modules/projects/public/index.js';
import type * as c from '@mehran/api-contracts';
import { TeamsService } from '../../src/modules/teams/public/index.js';
import type { MemberRole } from '../../src/modules/spaces/domain/shared-policy.js';

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
describe('P4-01 Company contexts, corporate admission and bounded policy inheritance', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    client: PrismaClient,
    observer: Client,
    watcher: Client,
    service: CollaborationService,
    kernel: SharedKernel,
    spaces: SpacesService,
    control: SharedControl,
    auth: AuthService,
    teams: TeamsService,
    projects: ProjectsService,
    companies: CompaniesService,
    access: CompanyAccess;
  let owner: Person,
    member: Person,
    viewer: Person,
    outsider: Person,
    passwordHash: string;
  const password = 'synthetic-p202-password-123!',
    origin = 'http://localhost:3000',
    name = 'p401-' + randomUUID(),
    version = 'synthetic-p401-' + randomUUID();
  async function person(
    email = randomUUID() + '@example.test',
    verified = true,
    cookie = false,
  ): Promise<Person> {
    const userId = randomUUID(),
      sessionId = randomUUID();
    await client.user.create({
      data: {
        id: userId,
        name: 'Synthetic collaboration fixture',
        email,
        emailVerified: verified,
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
    if (cookie) {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', origin)
        .send({ email, password })
        .expect(200);
      const active = await client.authSession.findFirstOrThrow({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      return {
        email,
        cookie: (login.headers['set-cookie'] as unknown as string[])
          .map((c) => c.split(';')[0])
          .join('; '),
        actor: {
          userId,
          sessionId: active.id,
          requestId: randomUUID(),
          correlationId: randomUUID(),
        },
      };
    }
    return {
      email,
      cookie: '',
      actor: {
        userId,
        sessionId,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
    };
  }
  async function invite(
    spaceId: string,
    who = member,
    role: MemberRole = 'MEMBER',
    by = owner,
    key = randomUUID(),
  ) {
    return service.createInvitation(
      by.actor,
      spaceId,
      {
        kind: 'MEMBERSHIP',
        memberRole: role,
        recipient: { userId: who.actor.userId },
      },
      key,
    );
  }
  async function join(
    spaceId: string,
    who = member,
    role: MemberRole = 'MEMBER',
    by = owner,
  ) {
    const offered = await invite(spaceId, who, role, by);
    const kind = (
      await client.sharedCustody.findUniqueOrThrow({ where: { spaceId } })
    ).kind;
    const result = await service.decideInvitation(
      who.actor,
      offered.invitation.id,
      offered.proof!,
      1,
      true,
      kind as 'PROJECT' | 'TEAM',
    );
    if (!('membership' in result))
      throw new Error('Expected accepted membership');
    return result.membership;
  }
  async function blocked() {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const row = await watcher.query<{ n: number }>(
        `SELECT count(DISTINCT a.pid)::int n FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name=ANY($1) AND cardinality(pg_blocking_pids(a.pid))>0 AND NOT l.granted`,
        [[name, name + '-observer']],
      );
      if (row.rows[0]!.n > 0) return;
      await tick();
    }
    throw new Error('Expected independent PostgreSQL lock waiter');
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
        'Owned collaboration schema replay failed (credentials withheld)',
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
    const root = fs.mkdtempSync(path.resolve('.tools/p2-collaboration-'));
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P401-ONLY',
      },
    });
    control = app.get(SharedControl);
    await control.initialize();
    service = app.get(CollaborationService);
    teams = app.get(TeamsService);
    projects = app.get(ProjectsService);
    companies = app.get(CompaniesService);
    access = app.get(CompanyAccess);
    kernel = app.get(SharedKernel);
    spaces = app.get(SpacesService);
    auth = app.get(AuthService);
    observer = new Client({
      connectionString: base,
      options: '-c timezone=UTC -c search_path=' + schema,
      application_name: name + '-observer',
    });
    await observer.connect();
    watcher = new Client({
      connectionString: base,
      application_name: name + '-watch',
    });
    await watcher.connect();
    passwordHash = await (await auth.auth.$context).password.hash(password);
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
          applicableContexts: ['PROJECT', 'TEAM', 'COMPANY'],
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
          backupPolicyReference: 'synthetic current independent control',
        },
      },
    });
    owner = await person(undefined, true, true);
    member = await person(undefined, true, true);
    viewer = await person(undefined, true, true);
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

  async function project(who = owner) {
    return projects.create(
      who.actor,
      {
        id: randomUUID(),
        title: 'Independent fixture',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
  }

  const page = { limit: 25 },
    allRoles = [
      'OWNER',
      'ORG_ADMIN',
      'DEPT_MANAGER',
      'TEAM_LEAD',
      'MEMBER',
      'VIEWER',
    ] as const;
  async function company(who = owner) {
    return companies.create(
      who.actor,
      {
        id: randomUUID(),
        title: 'Independent Company',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
  }
  async function department(id: string) {
    return companies.createContext(
      owner.actor,
      id,
      null,
      { id: randomUUID(), title: 'Private Department' },
      randomUUID(),
    );
  }
  async function unit(id: string, dept: string) {
    return companies.createContext(
      owner.actor,
      id,
      dept,
      { id: randomUUID(), title: 'Private Unit' },
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
    if (!result.membership) throw new Error('Expected Company membership');
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
  const rule = (
    key: 'structure.read' | 'directory.read',
    mode: 'MANDATORY' | 'DEFAULT' | 'OPTIONAL',
    roles: readonly (typeof allRoles)[number][],
    overrideDefault = false,
  ) => ({ key, mode, roles: [...roles], overrideDefault });
  it('creates one Company custody atomically with stable replay and no unrelated domain attachment', async () => {
    const input = {
        id: randomUUID(),
        title: 'Independent Company',
        retentionPolicyVersion: version,
      },
      key = randomUUID(),
      created = await companies.create(owner.actor, input, key);
    expect(await companies.create(owner.actor, input, key)).toEqual(created);
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: created.id },
        })
      ).kind,
    ).toBe('COMPANY');
    expect((await root(created.id)).memberRole).toBe('ORG_ADMIN');
    await expect(
      companies.create(
        owner.actor,
        { ...input, title: 'Changed fingerprint' },
        key,
      ),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      companies.create(member.actor, input, key),
    ).rejects.toHaveProperty('status', 404);
    expect(await client.team.count({ where: { spaceId: created.id } })).toBe(0);
    expect(await client.project.count({ where: { spaceId: created.id } })).toBe(
      0,
    );
    expect(
      await client.sharedUsageEntry.count({
        where: { spaceId: created.id, feature: 'shared.custody' },
      }),
    ).toBe(1);
  });
  it('requires explicit Company retention applicability and rolls back all foundation rows on unavailable growth', async () => {
    const policy = await client.sharedRetentionPolicy.findUniqueOrThrow({
        where: { version },
      }),
      other = 'no-company-' + randomUUID();
    await client.sharedRetentionPolicy.create({
      data: {
        version: other,
        approvalReference: policy.approvalReference,
        configuration: {
          ...(policy.configuration as Record<string, unknown>),
          policyVersion: other,
          applicableContexts: ['PROJECT', 'TEAM'],
        },
      },
    });
    const id = randomUUID();
    await expect(
      companies.create(
        owner.actor,
        { id, title: 'Denied policy', retentionPolicyVersion: other },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    expect(await client.space.findUnique({ where: { id } })).toBeNull();
    const co = await company(),
      child = randomUUID(),
      features = app.get(SharedFeaturePolicy),
      decide = features.decide.bind(features);
    vi.spyOn(features, 'decide').mockImplementation(async (i, tx) =>
      i.feature === 'company.department'
        ? { allowed: false, mode: 'FREE' }
        : decide(i, tx),
    );
    await expect(
      companies.createContext(
        owner.actor,
        co.id,
        null,
        { id: child, title: 'Denied growth' },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    expect(
      await client.accessScope.findUnique({ where: { id: child } }),
    ).toBeNull();
    expect(
      await client.companyDepartment.findUnique({ where: { id: child } }),
    ).toBeNull();
  });
  it('keeps departments and typed units inside one Company Space with stable identities and optimistic edits', async () => {
    const co = await company(),
      key = randomUUID(),
      body = { id: randomUUID(), title: 'Department' },
      d = await companies.createContext(owner.actor, co.id, null, body, key);
    expect(
      await companies.createContext(owner.actor, co.id, null, body, key),
    ).toEqual(d);
    const u = await unit(co.id, d.id);
    expect(u.spaceId).toBe(co.id);
    expect(u.departmentId).toBe(d.id);
    expect(
      (await client.accessScope.findUniqueOrThrow({ where: { id: u.id } }))
        .kind,
    ).toBe('UNIT');
    expect(await client.space.findUnique({ where: { id: u.id } })).toBeNull();
    expect(
      (
        await companies.contextPatch(owner.actor, co.id, u.id, 'UNIT', 1, {
          title: 'Updated Unit',
        })
      ).revision,
    ).toBe(2);
    await expect(
      companies.contextPatch(owner.actor, co.id, u.id, 'UNIT', 1, {
        title: 'Stale',
      }),
    ).rejects.toHaveProperty('status', 409);
    expect(
      await client.contextAccess.count({
        where: { spaceId: co.id, scopeId: u.id },
      }),
    ).toBe(0);
    await expect(
      companies.createContext(
        member.actor,
        co.id,
        d.id,
        { id: randomUUID(), title: 'Outsider' },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
  });
  it('requires explicit child admission and hides unrelated departments, units, directory entries and counts', async () => {
    const co = await company(),
      d = await department(co.id),
      other = await department(co.id),
      u = await unit(co.id, other.id);
    await admit(co.id, member, 'DEPT_MANAGER');
    expect(
      (await companies.contextList(member.actor, co.id, null, page)).items,
    ).toEqual([]);
    await expect(
      companies.contextRead(member.actor, co.id, d.id, 'DEPARTMENT'),
    ).rejects.toHaveProperty('status', 404);
    await admit(co.id, member, 'MEMBER', d.id);
    expect(
      (await companies.contextList(member.actor, co.id, null, page)).items.map(
        (r) => r.id,
      ),
    ).toEqual([d.id]);
    await expect(
      companies.contextRead(member.actor, co.id, u.id, 'UNIT'),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      companies.contextList(member.actor, co.id, other.id, page),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      companies.invite(
        member.actor,
        co.id,
        other.id,
        { memberRole: 'ORG_ADMIN', recipient: { userId: viewer.actor.userId } },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      companies.members(member.actor, co.id, other.id, page),
    ).rejects.toHaveProperty('status', 404);
    expect(
      (await companies.members(member.actor, co.id, d.id, page)).items,
    ).toHaveLength(1);
  });
  it('supports different roles in multiple Companies and enforces fixed corporate delegation without self-promotion', async () => {
    const one = await company(),
      two = await company(),
      admin = await admit(one.id, member, 'ORG_ADMIN');
    await admit(two.id, member, 'VIEWER');
    expect(
      (
        await companies.patch(member.actor, one.id, 1, {
          title: 'Organization administration',
        })
      ).revision,
    ).toBe(2);
    await expect(
      companies.patch(member.actor, two.id, 1, { title: 'Denied Viewer' }),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      companies.invite(
        member.actor,
        one.id,
        one.id,
        { memberRole: 'ORG_ADMIN', recipient: { userId: viewer.actor.userId } },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      companies.changeMember(member.actor, one.id, one.id, admin.id, 1, {
        state: 'ACTIVE',
        memberRole: 'ORG_ADMIN',
      }),
    ).rejects.toHaveProperty('status', 403);
    const d = await department(one.id);
    await admit(one.id, viewer, 'MEMBER');
    const lead = await admit(one.id, viewer, 'DEPT_MANAGER', d.id);
    await admit(one.id, outsider, 'MEMBER');
    await expect(
      companies.invite(
        viewer.actor,
        one.id,
        d.id,
        {
          memberRole: 'TEAM_LEAD',
          recipient: { userId: outsider.actor.userId },
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    const offered = await companies.invite(
      viewer.actor,
      one.id,
      d.id,
      { memberRole: 'VIEWER', recipient: { userId: outsider.actor.userId } },
      randomUUID(),
    );
    expect(offered.invitation.scopeId).toBe(d.id);
    await companies.changeMember(owner.actor, one.id, d.id, lead.id, 1, {
      state: 'ACTIVE',
      memberRole: 'TEAM_LEAD',
    });
    await expect(
      companies.invite(
        viewer.actor,
        one.id,
        d.id,
        { memberRole: 'MEMBER', recipient: { userId: outsider.actor.userId } },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
  });
  it('rejects cross-Company nested IDs and role catalogs at application and database boundaries', async () => {
    const a = await company(),
      b = await company(),
      d = await department(a.id);
    await expect(
      companies.createContext(
        owner.actor,
        b.id,
        d.id,
        { id: randomUUID(), title: 'Foreign parent' },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      companies.policy(owner.actor, b.id, d.id),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      companies.members(owner.actor, b.id, d.id, page),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      client.contextAccess.update({
        where: { id: (await root(a.id)).id },
        data: { memberRole: 'ADMIN' },
      }),
    ).rejects.toThrow();
    const t = await teams.create(
        owner.actor,
        {
          id: randomUUID(),
          title: 'Independent Team',
          retentionPolicyVersion: version,
        },
        randomUUID(),
      ),
      ta = await client.contextAccess.findFirstOrThrow({
        where: { spaceId: t.id },
      });
    await expect(
      client.contextAccess.update({
        where: { id: ta.id },
        data: { memberRole: 'ORG_ADMIN' },
      }),
    ).rejects.toThrow();
    await expect(
      client.$transaction(async (tx) => {
        await tx.accessScope.create({
          data: { id: randomUUID(), spaceId: t.id, kind: 'DEPARTMENT' },
        });
      }),
    ).rejects.toThrow();
    await expect(
      client.companyUnit.update({
        where: { id: (await unit(a.id, d.id)).id },
        data: { departmentId: randomUUID(), revision: { increment: 1 } },
      }),
    ).rejects.toThrow();
  });
  it('requires current verified recipient, canonical proof and explicit root admission before accepting a child offer', async () => {
    const co = await company(),
      d = await department(co.id);
    await expect(
      companies.invite(
        owner.actor,
        co.id,
        d.id,
        { memberRole: 'MEMBER', recipient: { userId: member.actor.userId } },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
    const rootOffer = await companies.invite(
      owner.actor,
      co.id,
      co.id,
      {
        memberRole: 'MEMBER',
        recipient: { email: member.email.toUpperCase() },
      },
      randomUUID(),
    );
    expect((await companies.preview(rootOffer.proof!)).title).toBe(
      'Independent Company',
    );
    await expect(
      access.decide(
        viewer.actor,
        rootOffer.invitation.id,
        rootOffer.proof!,
        1,
        true,
      ),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      access.decide(
        member.actor,
        rootOffer.invitation.id,
        'a'.repeat(43),
        1,
        true,
      ),
    ).rejects.toHaveProperty('status', 404);
    await access.decide(
      member.actor,
      rootOffer.invitation.id,
      rootOffer.proof!,
      1,
      true,
    );
    const offer = await companies.invite(
        owner.actor,
        co.id,
        d.id,
        { memberRole: 'MEMBER', recipient: { userId: member.actor.userId } },
        randomUUID(),
      ),
      accepted = await access.decide(
        member.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
      );
    expect(accepted.membership!.scopeId).toBe(d.id);
    expect(
      await access.decide(
        member.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
      ),
    ).toEqual(accepted);
    expect(
      (
        await client.companyContextAdmission.findUniqueOrThrow({
          where: {
            accessId_generation: {
              accessId: accepted.membership!.id,
              generation: 1,
            },
          },
        })
      ).rootAccessId,
    ).toBe((await root(co.id, member)).id);
  });
  it('expires and revokes Company offers through the existing durable Shared maintenance path', async () => {
    const co = await company(),
      offer = await companies.invite(
        owner.actor,
        co.id,
        co.id,
        { memberRole: 'MEMBER', recipient: { userId: member.actor.userId } },
        randomUUID(),
      );
    const expiredAt = new Date(Date.now() - 86400000);
    await client.contextInvitation.update({
      where: { id: offer.invitation.id },
      data: {
        createdAt: new Date(expiredAt.getTime() - 604800000),
        expiresAt: expiredAt,
      },
    });
    expect(await service.maintain()).toBe(true);
    expect(
      (
        await client.contextInvitation.findUniqueOrThrow({
          where: { id: offer.invitation.id },
        })
      ).state,
    ).toBe('EXPIRED');
    await expect(companies.preview(offer.proof!)).rejects.toHaveProperty(
      'status',
      404,
    );
    const another = await companies.invite(
      owner.actor,
      co.id,
      co.id,
      { memberRole: 'VIEWER', recipient: { userId: viewer.actor.userId } },
      randomUUID(),
    );
    await companies.invitation(
      owner.actor,
      co.id,
      co.id,
      another.invitation.id,
      true,
      1,
    );
    await expect(
      access.decide(
        viewer.actor,
        another.invitation.id,
        another.proof!,
        1,
        true,
      ),
    ).rejects.toHaveProperty('status', 404);
  });
  it('does not revive child authority, old invitations or cursors when root admission ends and explicitly rejoins', async () => {
    const co = await company(),
      d = await department(co.id);
    await admit(co.id);
    const old = await admit(co.id, member, 'MEMBER', d.id);
    await admit(co.id, viewer);
    await admit(co.id, viewer, 'MEMBER', d.id);
    const cursor = await companies.members(member.actor, co.id, d.id, {
        limit: 1,
      }),
      pending = await companies.invite(
        owner.actor,
        co.id,
        d.id,
        { memberRole: 'VIEWER', recipient: { userId: member.actor.userId } },
        randomUUID(),
      );
    expect(cursor.nextCursor).toBeTruthy();
    const r = await root(co.id, member);
    await companies.leave(member.actor, co.id, co.id, r.revision);
    await expect(
      companies.contextRead(member.actor, co.id, d.id, 'DEPARTMENT'),
    ).rejects.toHaveProperty('status', 404);
    await admit(co.id);
    await expect(
      companies.contextRead(member.actor, co.id, d.id, 'DEPARTMENT'),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      access.decide(
        member.actor,
        pending.invitation.id,
        pending.proof!,
        1,
        true,
      ),
    ).rejects.toHaveProperty('status', 404);
    const growth = vi.spyOn(app.get(SharedFeaturePolicy), 'decide');
    const fresh = await admit(co.id, member, 'MEMBER', d.id);
    expect(
      growth.mock.calls.some(
        ([i]) =>
          i.feature === 'company.context-membership' && i.currentUsage === 1,
      ),
    ).toBe(true);
    expect(fresh.id).toBe(old.id);
    expect(fresh.generation).toBe(2);
    await expect(
      companies.members(member.actor, co.id, d.id, {
        limit: 1,
        after: cursor.nextCursor!,
      }),
    ).rejects.toHaveProperty('status', 409);
  });
  it('applies suspended and revoked root/child hard denial without exposing source data', async () => {
    const co = await company(),
      d = await department(co.id),
      r = await admit(co.id),
      child = await admit(co.id, member, 'MEMBER', d.id);
    await companies.changeMember(owner.actor, co.id, co.id, r.id, 1, {
      memberRole: 'MEMBER',
      state: 'SUSPENDED',
    });
    await expect(
      companies.members(member.actor, co.id, d.id, page),
    ).rejects.toHaveProperty('status', 404);
    await companies.changeMember(owner.actor, co.id, co.id, r.id, 2, {
      memberRole: 'MEMBER',
      state: 'ACTIVE',
    });
    expect(
      (await companies.members(member.actor, co.id, d.id, page)).items,
    ).toHaveLength(1);
    await companies.changeMember(owner.actor, co.id, d.id, child.id, 1, {
      memberRole: 'MEMBER',
      state: 'SUSPENDED',
    });
    await companies.leave(member.actor, co.id, d.id, 2);
    const rejoined = await admit(co.id, member, 'MEMBER', d.id);
    await companies.changeMember(
      owner.actor,
      co.id,
      d.id,
      rejoined.id,
      rejoined.revision,
      { memberRole: 'VIEWER', state: 'REVOKED' },
    );
    await expect(
      companies.contextRead(member.actor, co.id, d.id, 'DEPARTMENT'),
    ).rejects.toHaveProperty('status', 404);
    expect((await companies.read(member.actor, co.id)).id).toBe(co.id);
  });
  it('inherits immutable policy versions, requires explicit default override and cannot override mandatory restrictions', async () => {
    const co = await company(),
      d = await department(co.id),
      u = await unit(co.id, d.id);
    await admit(co.id);
    await admit(co.id, member, 'MEMBER', u.id);
    await companies.publish(owner.actor, co.id, d.id, 1, {
      rules: [rule('structure.read', 'DEFAULT', ['OWNER', 'ORG_ADMIN'])],
    });
    await expect(
      companies.contextRead(member.actor, co.id, u.id, 'UNIT'),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      companies.publish(owner.actor, co.id, u.id, 1, {
        rules: [rule('structure.read', 'DEFAULT', allRoles)],
      }),
    ).rejects.toHaveProperty('status', 409);
    await companies.publish(owner.actor, co.id, u.id, 1, {
      rules: [rule('structure.read', 'DEFAULT', allRoles, true)],
    });
    expect(
      (await companies.contextRead(member.actor, co.id, u.id, 'UNIT')).id,
    ).toBe(u.id);
    await companies.publish(owner.actor, co.id, co.id, 1, {
      rules: [rule('structure.read', 'MANDATORY', ['OWNER', 'ORG_ADMIN'])],
    });
    await expect(
      companies.contextRead(member.actor, co.id, u.id, 'UNIT'),
    ).rejects.toHaveProperty('status', 404);
    expect(
      (await companies.policy(owner.actor, co.id, u.id)).chain.map(
        (p) => p.version,
      ),
    ).toEqual([2, 2, 2]);
    await expect(
      companies.publish(owner.actor, co.id, u.id, 1, { rules: [] }),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      client.companyScopePolicy.update({
        where: {
          spaceId_scopeId_version: {
            spaceId: co.id,
            scopeId: u.id,
            version: 2,
          },
        },
        data: { rules: [] },
      }),
    ).rejects.toThrow();
  });
  it('bounds optional policies and fixed security/admin capabilities; child managers cannot publish or manufacture overrides', async () => {
    const co = await company(),
      d = await department(co.id);
    await admit(co.id);
    await admit(co.id, member, 'DEPT_MANAGER', d.id);
    await expect(
      companies.publish(member.actor, co.id, d.id, 1, {
        rules: [rule('directory.read', 'DEFAULT', allRoles, true)],
      }),
    ).rejects.toHaveProperty('status', 403);
    await companies.publish(owner.actor, co.id, d.id, 1, {
      rules: [rule('directory.read', 'OPTIONAL', ['OWNER', 'ORG_ADMIN'])],
    });
    await expect(
      companies.members(member.actor, co.id, d.id, page),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      companies.publish(owner.actor, co.id, d.id, 2, {
        rules: [
          {
            key: 'identity.verified',
            mode: 'OPTIONAL',
            roles: [...allRoles],
            overrideDefault: true,
          },
        ] as never,
      }),
    ).rejects.toThrow();
    expect(
      (await companies.publish(owner.actor, co.id, d.id, 2, { rules: [] }))
        .version,
    ).toBe(3);
    expect(
      (await companies.members(member.actor, co.id, d.id, page)).items,
    ).toHaveLength(1);
  });
  it('keeps Company administration separate from independent Team, Project, Personal and confidential-source authority', async () => {
    const co = await company();
    await admit(co.id, member, 'ORG_ADMIN');
    const p = await project(),
      t = await teams.create(
        owner.actor,
        {
          id: randomUUID(),
          title: 'Independent confidential Team',
          retentionPolicyVersion: version,
        },
        randomUUID(),
      );
    await expect(teams.read(member.actor, t.id)).rejects.toHaveProperty(
      'status',
      404,
    );
    await expect(projects.read(member.actor, p.id)).rejects.toHaveProperty(
      'status',
      404,
    );
    await expect(
      companies.invite(
        owner.actor,
        co.id,
        t.id,
        { memberRole: 'MEMBER', recipient: { userId: member.actor.userId } },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
    await join(p.id, member);
    expect((await projects.read(member.actor, p.id)).id).toBe(p.id);
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: p.id },
        })
      ).kind,
    ).toBe('PROJECT');
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: t.id },
        })
      ).kind,
    ).toBe('TEAM');
    const personal = await spaces.authorizePersonal(owner.actor);
    await request(app.getHttpServer())
      .get('/api/v1/tasks')
      .set('Cookie', member.cookie)
      .query({ spaceId: personal.spaceId })
      .expect(400);
  });
  it('counts only root memberships for closure, protects the last custodian and never lets stale child seats trigger Company purge', async () => {
    const co = await company(),
      d = await department(co.id),
      r = await admit(co.id);
    await admit(co.id, member, 'MEMBER', d.id);
    await expect(
      companies.leave(owner.actor, co.id, co.id, 1),
    ).rejects.toHaveProperty('status', 409);
    await companies.leave(member.actor, co.id, co.id, r.revision);
    await companies.leave(owner.actor, co.id, co.id, 1);
    const job = await client.sharedLifecycleJob.findFirstOrThrow({
      where: { spaceId: co.id },
    });
    expect(job.state).toBe('CLOSING_GRACE');
    expect(
      job.recoveryDeadline.getTime() - job.effectiveDepartureAt.getTime(),
    ).toBe(2592000000);
    expect(
      (await sandbox.query('SELECT shared_purge_allowed($1::uuid) ok', [co.id]))
        .rows[0].ok,
    ).toBe(false);
    expect(
      await client.companyDepartment.findUnique({ where: { id: d.id } }),
    ).not.toBeNull();
  });
  it('freezes Company owner exit with surviving members and permits Personal erasure while preserving organizational attribution', async () => {
    const former = await person(),
      co = await company(former);
    await admit(co.id, member, 'MEMBER', co.id, former);
    const personal = await spaces.authorizePersonal(former.actor),
      seat = await root(co.id, former);
    await client.$transaction((tx) => spaces.setClosed(tx, personal, true));
    await expect(companies.read(member.actor, co.id)).rejects.toHaveProperty(
      'status',
      404,
    );
    await kernel.consumeExit();
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: co.id },
        })
      ).state,
    ).toBe('OWNER_EXIT_FROZEN');
    let ready = false;
    for (let n = 0; n < 5; n++) {
      ready = await kernel.prepareIdentityErasure(
        former.actor.userId,
        new Date(),
      );
      if (ready) break;
    }
    expect(ready).toBe(true);
    await client.$transaction((tx) => spaces.erase(tx, personal));
    await client.user.delete({ where: { id: former.actor.userId } });
    expect(
      (
        await client.sharedActor.findUniqueOrThrow({
          where: { id: seat.actorId },
        })
      ).userId,
    ).toBeNull();
    expect(
      (await client.company.findUniqueOrThrow({ where: { id: co.id } }))
        .createdByActorId,
    ).toBe(seat.actorId);
  });
  it('RACE a winning child-manager revocation denies a waiting invitation without late offers or audit effects', async () => {
    const co = await company(),
      d = await department(co.id);
    await admit(co.id);
    await admit(co.id, viewer);
    const manager = await admit(co.id, member, 'DEPT_MANAGER', d.id),
      entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (r.action === 'company.membership.change' && r.outcome === 'INTENT') {
        entered.release();
        await release.promise;
      }
    });
    const revoke = companies.changeMember(
      owner.actor,
      co.id,
      d.id,
      manager.id,
      1,
      { state: 'REVOKED', memberRole: 'DEPT_MANAGER' },
    );
    await entered.promise;
    const write = outcome(
      companies.invite(
        member.actor,
        co.id,
        d.id,
        { memberRole: 'MEMBER', recipient: { userId: viewer.actor.userId } },
        randomUUID(),
      ),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    await revoke;
    expect((await write).error).toBeDefined();
    expect(
      await client.contextInvitation.count({
        where: { spaceId: co.id, companyScopeId: d.id, state: 'PENDING' },
      }),
    ).toBe(0);
    await expect(
      companies.invite(
        member.actor,
        co.id,
        d.id,
        { memberRole: 'MEMBER', recipient: { userId: viewer.actor.userId } },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
  });
  it('RACE a winning mandatory policy restriction denies a waiting ordinary directory read and stale cursor', async () => {
    const co = await company();
    await admit(co.id);
    await admit(co.id, viewer);
    const cursor = await companies.members(member.actor, co.id, co.id, {
        limit: 1,
      }),
      entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    expect(cursor.nextCursor).toBeTruthy();
    vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (r.action === 'company.policy.publish' && r.outcome === 'INTENT') {
        entered.release();
        await release.promise;
      }
    });
    const policy = companies.publish(owner.actor, co.id, co.id, 1, {
      rules: [rule('directory.read', 'MANDATORY', ['OWNER', 'ORG_ADMIN'])],
    });
    await entered.promise;
    const read = outcome(companies.members(member.actor, co.id, co.id, page));
    try {
      await blocked();
    } finally {
      release.release();
    }
    await policy;
    expect((await read).error).toBeDefined();
    await expect(
      companies.members(member.actor, co.id, co.id, {
        limit: 1,
        after: cursor.nextCursor!,
      }),
    ).rejects.toHaveProperty('status', 404);
  });
  it('allows independent Company progress while a different Company custody is locked', async () => {
    const one = await company(),
      two = await company(member);
    await observer.query('BEGIN');
    await observer.query(
      'SELECT "spaceId" FROM "SharedCustody" WHERE "spaceId"=$1 FOR UPDATE',
      [one.id],
    );
    const waiting = companies.patch(owner.actor, one.id, 1, {
      title: 'Waiting metadata',
    });
    try {
      await blocked();
      expect(
        (
          await companies.patch(member.actor, two.id, 1, {
            title: 'Independent progress',
          })
        ).revision,
      ).toBe(2);
    } finally {
      await observer.query('COMMIT');
    }
    expect((await waiting).revision).toBe(2);
  });
  it('does not let a competing old root or child offer undo a later explicit removal', async () => {
    const co = await company(),
      d = await department(co.id);
    const offers = [];
    for (const role of ['MEMBER', 'VIEWER'] as const)
      offers.push(
        await companies.invite(
          owner.actor,
          co.id,
          co.id,
          { memberRole: role, recipient: { userId: member.actor.userId } },
          randomUUID(),
        ),
      );
    const admitted = await access.decide(
      member.actor,
      offers[0]!.invitation.id,
      offers[0]!.proof!,
      1,
      true,
    );
    await companies.leave(
      member.actor,
      co.id,
      co.id,
      admitted.membership!.revision,
    );
    await expect(
      access.decide(
        member.actor,
        offers[1]!.invitation.id,
        offers[1]!.proof!,
        1,
        true,
      ),
    ).rejects.toHaveProperty('status', 404);
    await admit(co.id);
    const first = await companies.invite(
        owner.actor,
        co.id,
        d.id,
        { memberRole: 'MEMBER', recipient: { userId: member.actor.userId } },
        randomUUID(),
      ),
      second = await companies.invite(
        owner.actor,
        co.id,
        d.id,
        { memberRole: 'VIEWER', recipient: { userId: member.actor.userId } },
        randomUUID(),
      );
    const child = await access.decide(
      member.actor,
      first.invitation.id,
      first.proof!,
      1,
      true,
    );
    await companies.changeMember(
      owner.actor,
      co.id,
      d.id,
      child.membership!.id,
      1,
      { state: 'REVOKED', memberRole: 'MEMBER' },
    );
    await expect(
      access.decide(member.actor, second.invitation.id, second.proof!, 1, true),
    ).rejects.toHaveProperty('status', 404);
    expect(
      (
        await client.contextAccess.findUniqueOrThrow({
          where: { id: child.membership!.id },
        })
      ).state,
    ).toBe('REVOKED');
  });
  it('RACE invitation creation commits before revocation but loses all future delegation at acceptance', async () => {
    const co = await company(),
      d = await department(co.id);
    await admit(co.id);
    await admit(co.id, viewer);
    const manager = await admit(co.id, member, 'DEPT_MANAGER', d.id),
      entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (r.action === 'company.invitation.create' && r.outcome === 'INTENT') {
        entered.release();
        await release.promise;
      }
    });
    const invitation = companies.invite(
      member.actor,
      co.id,
      d.id,
      { memberRole: 'MEMBER', recipient: { userId: viewer.actor.userId } },
      randomUUID(),
    );
    await entered.promise;
    const revoke = companies.changeMember(
      owner.actor,
      co.id,
      d.id,
      manager.id,
      1,
      { state: 'REVOKED', memberRole: 'DEPT_MANAGER' },
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    const offer = await invitation;
    await revoke;
    await expect(
      access.decide(viewer.actor, offer.invitation.id, offer.proof!, 1, true),
    ).rejects.toHaveProperty('status', 404);
    expect(
      await client.contextAccess.count({
        where: {
          spaceId: co.id,
          scopeId: d.id,
          SharedActor: { userId: viewer.actor.userId },
        },
      }),
    ).toBe(0);
  });
  it('quarantines restored Company authorization until separately reviewed domain reconciliation without replaying private metadata', async () => {
    const co = await company();
    await admit(co.id);
    const before = await client.sharedCustody.findUniqueOrThrow({
      where: { spaceId: co.id },
    });
    await companies.publish(owner.actor, co.id, co.id, 1, {
      rules: [rule('directory.read', 'MANDATORY', ['OWNER'])],
    });
    const evidence = (await control.replayEvidence()).filter(
      (r) => r.spaceId === co.id,
    );
    expect(evidence.every((r) => r.companyRestricted)).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain('Independent Company');
    await client.sharedCustody.update({
      where: { spaceId: co.id },
      data: { authorizationVersion: before.authorizationVersion },
    });
    await expect(companies.read(owner.actor, co.id)).rejects.toHaveProperty(
      'status',
      404,
    );
    expect(
      (await kernel.restoreRestrictions(co.id, async () => {})).complete,
    ).toBe(true);
    expect(
      (await client.accessScope.findUniqueOrThrow({ where: { id: co.id } }))
        .state,
    ).toBe('CLOSED');
    await expect(companies.read(owner.actor, co.id)).rejects.toHaveProperty(
      'status',
      404,
    );
    expect(
      await client.company.findUnique({ where: { id: co.id } }),
    ).not.toBeNull();
  });
  it('denies unverified identities and stale provider sessions before Company creation or reads', async () => {
    const unverified = await person(undefined, false),
      id = randomUUID();
    await expect(
      companies.create(
        unverified.actor,
        { id, title: 'Denied identity', retentionPolicyVersion: version },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    expect(await client.company.findUnique({ where: { id } })).toBeNull();
    const co = await company(),
      active = await person();
    await admit(co.id, active);
    await client.authSession.delete({ where: { id: active.actor.sessionId! } });
    await expect(companies.read(active.actor, co.id)).rejects.toHaveProperty(
      'status',
      403,
    );
  });
  it('authenticates invitation decisions before counting actor abuse and retains failed-proof throttling', async () => {
    const co = await company(),
      offer = await companies.invite(
        owner.actor,
        co.id,
        co.id,
        { memberRole: 'VIEWER', recipient: { userId: viewer.actor.userId } },
        randomUUID(),
      ),
      api = request(app.getHttpServer());
    await api
      .post('/api/v1/company-invitations/' + offer.invitation.id + '/accept')
      .set('Cookie', viewer.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .set('X-Invitation-Proof', offer.proof!)
      .send({})
      .expect(200);
    const actorKey = control.opaqueRateKey(
      'collaboration.actor:' + viewer.actor.userId,
    );
    expect(
      (
        await client.sharedRateLimit.findUniqueOrThrow({
          where: { keyHash: actorKey },
        })
      ).requests,
    ).toBe(1);
    for (let n = 0; n < 21; n++)
      await api
        .post('/api/v1/company-invitations/' + offer.invitation.id + '/accept')
        .set('Cookie', member.cookie)
        .set('Origin', origin)
        .set('If-Match', '"1"')
        .set('X-Invitation-Proof', 'A'.repeat(43))
        .send({})
        .expect(n === 20 ? 429 : 404);
  });
  it('matches live HTTP security, strict fields, optimistic concurrency and generic wrong-context responses', async () => {
    const co = await company(),
      api = request(app.getHttpServer());
    await api.get('/api/v1/companies/' + co.id).expect(401);
    await api
      .get('/api/v1/companies/' + co.id)
      .set('Cookie', member.cookie)
      .expect(404);
    await api
      .patch('/api/v1/companies/' + co.id)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({ title: 'Missing revision' })
      .expect(400);
    await api
      .patch('/api/v1/companies/' + co.id)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({ title: 'Strict', teamId: randomUUID() })
      .expect(400);
    const changed = await api
      .patch('/api/v1/companies/' + co.id)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({ title: 'HTTP Company' })
      .expect(200);
    expect(changed.headers.etag).toBe('"2"');
    expect(changed.headers['cache-control']).toBe('no-store');
    await api
      .patch('/api/v1/companies/' + co.id)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({ title: 'Stale HTTP' })
      .expect(409);
    await api
      .get('/api/v1/teams/' + co.id)
      .set('Cookie', owner.cookie)
      .expect(404);
    await api
      .get('/api/v1/projects/' + co.id)
      .set('Cookie', owner.cookie)
      .expect(404);
  });
});
