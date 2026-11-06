import { TeamAnalyticsService } from '../../src/modules/teams/public/index.js';
import { SharedFeaturePolicy } from '../../src/modules/spaces/public/index.js';
import {
  ProjectWorkMetricsService,
  WorkService,
} from '../../src/modules/projects/public/index.js';
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
  ResourceGrants,
  CollaborationService,
} from '../../src/modules/spaces/public/index.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { ProjectsService } from '../../src/modules/projects/public/index.js';
import * as c from '@mehran/api-contracts';
import { TeamWorkService } from '../../src/modules/teams/public/index.js';
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
describe('P3-03 Team capacity and authorized portfolio analytics', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    client: PrismaClient,
    observer: Client,
    watcher: Client,
    service: CollaborationService,
    kernel: SharedKernel,
    control: SharedControl,
    auth: AuthService,
    teams: TeamsService,
    work: TeamWorkService,
    analytics: TeamAnalyticsService,
    metrics: ProjectWorkMetricsService,
    projectWork: WorkService,
    projects: ProjectsService;
  let owner: Person,
    member: Person,
    viewer: Person,
    outsider: Person,
    passwordHash: string;
  const password = 'synthetic-p202-password-123!',
    origin = 'http://localhost:3000',
    name = 'p303-' + randomUUID(),
    version = 'synthetic-p303-' + randomUUID();
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
          options: '-c search_path=' + schema,
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P303-ONLY',
      },
    });
    control = app.get(SharedControl);
    await control.initialize();
    service = app.get(CollaborationService);
    teams = app.get(TeamsService);
    work = app.get(TeamWorkService);
    analytics = app.get(TeamAnalyticsService);
    metrics = app.get(ProjectWorkMetricsService);
    projectWork = app.get(WorkService);
    projects = app.get(ProjectsService);
    kernel = app.get(SharedKernel);
    auth = app.get(AuthService);
    observer = new Client({
      connectionString: base,
      options: '-c search_path=' + schema,
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
          applicableContexts: ['PROJECT', 'TEAM'],
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

  async function team(who = owner) {
    return teams.create(
      who.actor,
      {
        id: randomUUID(),
        title: 'Independent Team',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
  }

  const q = { fromDate: '2030-01-07', toDate: '2030-01-14', timezone: 'UTC' };
  async function ownMember(id: string, who = owner) {
    return client.contextAccess.findFirstOrThrow({
      where: { spaceId: id, SharedActor: { userId: who.actor.userId } },
    });
  }
  const body = (
    m: { id: string; generation: number },
    minutes: number | null = 480,
  ) => ({
    id: randomUUID(),
    member: { accessId: m.id, generation: m.generation },
    date: q.fromDate,
    timezone: q.timezone,
    availableMinutes: minutes,
  });
  const portfolio = async (id: string, who = owner) =>
    c.TeamPortfolioSchema.parse(
      await analytics.analyze(who.actor, id, q, 'portfolio'),
    );
  const workload = async (id: string, who = owner) =>
    c.TeamWorkloadSchema.parse(
      await analytics.analyze(who.actor, id, q, 'workload'),
    );
  async function source(pid: string) {
    return projects.createTask(
      owner.actor,
      pid,
      { id: randomUUID(), title: 'Authorized Project work', priority: 'NONE' },
      randomUUID(),
    );
  }
  async function linked() {
    const t = await team(),
      p = await project();
    await teams.reference(owner.actor, t.id, p.id, undefined, true);
    return { t, p };
  }
  it('stores generation-bound capacity with one receipt, usage and audit; optimistic updates preserve identity', async () => {
    const t = await team(),
      m = await ownMember(t.id),
      input = body(m),
      key = randomUUID();
    const first = await analytics.capacity(
      owner.actor,
      t.id,
      input,
      undefined,
      key,
    );
    expect(
      await analytics.capacity(owner.actor, t.id, input, undefined, key),
    ).toEqual(first);
    expect(first).toMatchObject({
      teamId: t.id,
      revision: 1,
      availableMinutes: 480,
    });
    expect(
      await client.teamCapacityDay.count({ where: { spaceId: t.id } }),
    ).toBe(1);
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: t.id, action: 'team.capacity.change' },
      }),
    ).toBe(1);
    expect(
      (
        await client.sharedUsageEntry.aggregate({
          where: { spaceId: t.id, feature: 'team.capacity-day' },
          _sum: { delta: true },
        })
      )._sum.delta,
    ).toBe(1);
    expect(
      (
        await analytics.capacity(
          owner.actor,
          t.id,
          { ...input, availableMinutes: 0 },
          1,
        )
      ).revision,
    ).toBe(2);
    await expect(
      analytics.capacity(owner.actor, t.id, input, 1),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      analytics.capacity(
        owner.actor,
        t.id,
        { ...input, date: '2030-01-08' },
        2,
      ),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      analytics.capacity(
        owner.actor,
        t.id,
        { ...input, availableMinutes: 90 },
        undefined,
        key,
      ),
    ).rejects.toHaveProperty('status', 409);
    expect(
      (await analytics.capacities(owner.actor, t.id, { ...q, limit: 25 }))
        .items[0]!.availableMinutes,
    ).toBe(0);
  });
  it('enforces role ceilings, independent Teams, foreign members and anonymous/strict HTTP inputs', async () => {
    const t = await team(),
      other = await team(),
      m = await join(t.id, member),
      v = await join(t.id, viewer, 'VIEWER');
    await join(other.id, member, 'LEAD');
    await expect(
      analytics.capacity(member.actor, t.id, body(m), undefined, randomUUID()),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      analytics.capacity(viewer.actor, t.id, body(v), undefined, randomUUID()),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      analytics.capacity(
        owner.actor,
        t.id,
        body(await ownMember(other.id)),
        undefined,
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
    await expect(portfolio(t.id, outsider)).rejects.toHaveProperty(
      'status',
      404,
    );
    const http = request(app.getHttpServer());
    await http
      .get('/api/v1/teams/' + t.id + '/dashboard')
      .query(q)
      .expect(401);
    const response = await http
      .get('/api/v1/teams/' + t.id + '/dashboard')
      .set('Cookie', viewer.cookie)
      .query(q)
      .expect(200);
    expect(response.headers['cache-control']).toContain('no-store');
    await http
      .get('/api/v1/teams/' + t.id + '/portfolio')
      .set('Cookie', owner.cookie)
      .query({ ...q, unknown: 'private' })
      .expect(400);
    await http
      .post('/api/v1/teams/' + t.id + '/capacity')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send(body(m))
      .expect(400);
    await http
      .patch('/api/v1/teams/' + t.id + '/capacity/' + randomUUID())
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send(c.TeamCapacityInputSchema.strip().parse(body(m)))
      .expect(400);
  });
  it('allows Lead capacity management and Viewer reads without exporting live User identities', async () => {
    const t = await team(),
      m = await join(t.id, member, 'LEAD');
    await join(t.id, viewer, 'VIEWER');
    await analytics.capacity(
      member.actor,
      t.id,
      body(m),
      undefined,
      randomUUID(),
    );
    const result = await workload(t.id, viewer);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      member: { accessId: m.id, generation: m.generation },
      capacityMinutes: 480,
      allocatedMinutes: 0,
      overbookedMinutes: 0,
    });
    expect(JSON.stringify(result)).not.toContain(member.actor.userId);
  });
  it('filters unauthorized Project sources and planning counts; multiple Team references preserve one source', async () => {
    const { t, p } = await linked(),
      t2 = await team();
    await join(t.id, member, 'LEAD');
    await teams.reference(owner.actor, t2.id, p.id, undefined, true);
    const task = await source(p.id),
      own = await work.createTask(
        owner.actor,
        t.id,
        { id: randomUUID(), title: 'Team work', priority: 'NONE' },
        randomUUID(),
      );
    await work.createItem(
      owner.actor,
      t.id,
      {
        id: randomUUID(),
        target: { kind: 'TASK', spaceId: p.id, id: task.id },
        sourceRevision: 1,
        planId: null,
        position: 0,
      },
      randomUUID(),
    );
    await work.createItem(
      owner.actor,
      t.id,
      {
        id: randomUUID(),
        target: { kind: 'TASK', spaceId: t.id, id: own.id },
        sourceRevision: 1,
        planId: null,
        position: 0,
      },
      randomUUID(),
    );
    const personal = await client.space.findFirstOrThrow({
      where: { ownerUserId: owner.actor.userId, kind: 'PERSONAL' },
    });
    await client.task.create({
      data: {
        id: randomUUID(),
        spaceId: personal.id,
        createdByUserId: owner.actor.userId,
        title: 'PRIVATE task excluded',
      },
    });
    await client.goal.create({
      data: {
        id: randomUUID(),
        spaceId: personal.id,
        createdByUserId: owner.actor.userId,
        title: 'PRIVATE goal excluded',
        horizon: 'SHORT_TERM',
        timezone: 'UTC',
      },
    });
    expect((await portfolio(t.id)).summary.taskCount).toBe(2);
    expect((await portfolio(t.id)).summary.goalCount).toBe(0);
    const hidden = c.TeamDashboardSchema.parse(
      await analytics.analyze(member.actor, t.id, q, 'dashboard'),
    );
    expect(hidden.portfolio.sources).toHaveLength(1);
    expect(hidden.portfolio.summary.taskCount).toBe(1);
    expect(hidden.planning.visibleBacklogItems).toBe(1);
    expect(JSON.stringify(hidden)).not.toContain(p.id);
    expect((await portfolio(t2.id)).summary.taskCount).toBe(1);
    expect(await client.task.count({ where: { id: task.id } })).toBe(1);
    await join(p.id, member, 'VIEWER');
    expect((await portfolio(t.id, member)).summary.taskCount).toBe(2);
    await teams.reference(owner.actor, t.id, p.id, 1, false);
    expect((await portfolio(t.id)).summary.taskCount).toBe(1);
    expect(await client.task.count({ where: { id: task.id } })).toBe(1);
  });
  it('excludes narrow collaborators from Project-wide analytics despite their Team membership', async () => {
    const { t, p } = await linked(),
      task = await source(p.id);
    await join(t.id, member);
    const offer = await projects.grantOffer(
      owner.actor,
      p.id,
      {
        id: randomUUID(),
        recipientUserId: member.actor.userId,
        target: { kind: 'TASK', id: task.id },
        capabilities: ['read'],
        grantExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      randomUUID(),
    );
    await app
      .get(ResourceGrants)
      .decide(
        member.actor,
        offer.offer.id,
        offer.proof!,
        1,
        true,
        projects.validateGrantTarget,
      );
    expect((await portfolio(t.id, member)).sources).toHaveLength(1);
  });
  it('sums only accepted allocations for current Team members and open tasks without double-counting estimates', async () => {
    const { t, p } = await linked(),
      tm = await join(t.id, member),
      pm = await join(p.id, member),
      task = await source(p.id);
    await analytics.capacity(
      owner.actor,
      t.id,
      body(tm, 60),
      undefined,
      randomUUID(),
    );
    // Exercise existing source-owner assignment/acceptance and allocation contracts.
    const assignment = await projectWork.create(
      owner.actor,
      p.id,
      task.id,
      1,
      {
        id: randomUUID(),
        recipientAccessId: pm.id,
        recipientGeneration: pm.generation,
        kind: 'PRIMARY',
      },
      randomUUID(),
    );
    await projectWork.respond(member.actor, p.id, task.id, assignment.id, 1, {
      decision: 'ACCEPTED',
    });
    await metrics.estimate(owner.actor, p.id, task.id, {
      revision: (await metrics.estimate(owner.actor, p.id, task.id))
        .sourceRevision,
      estimatedMinutes: 120,
    });
    await metrics.allocation(owner.actor, p.id, randomUUID(), 0, {
      assignmentId: assignment.id,
      date: q.fromDate,
      timezone: q.timezone,
      plannedMinutes: 90,
    });
    let report = await workload(t.id);
    expect(report.rows[0]).toMatchObject({
      capacityMinutes: 60,
      allocatedMinutes: 90,
      overbookedMinutes: 30,
      taskCount: 1,
      estimatedMinutes: 120,
      unknownEstimates: 0,
    });
    expect((await portfolio(t.id)).summary.estimatedMinutes).toBe(120);
    await service.changeMembership(owner.actor, p.id, pm.id, 1, {
      state: 'REVOKED',
      memberRole: 'MEMBER',
    });
    report = await workload(t.id);
    expect(report.rows[0]!.allocatedMinutes).toBe(0);
    expect(
      (await client.task.findUniqueOrThrow({ where: { id: task.id } })).spaceId,
    ).toBe(p.id);
  });
  it('uses unknown capacity rather than zero and excludes prior membership generations after rejoin', async () => {
    const t = await team(),
      m = await join(t.id, member);
    await analytics.capacity(
      owner.actor,
      t.id,
      body(m, null),
      undefined,
      randomUUID(),
    );
    expect((await workload(t.id)).rows[0]!.overbookedMinutes).toBeNull();
    await service.changeMembership(owner.actor, t.id, m.id, 1, {
      state: 'REVOKED',
      memberRole: 'MEMBER',
    });
    expect(
      (await analytics.capacities(owner.actor, t.id, { ...q, limit: 25 }))
        .items,
    ).toEqual([]);
    const again = await join(t.id, member);
    expect(again.generation).toBeGreaterThan(m.generation);
    expect((await workload(t.id)).rows).toEqual([]);
    await expect(
      analytics.capacity(owner.actor, t.id, body(m), undefined, randomUUID()),
    ).rejects.toHaveProperty('status', 409);
  });
  it('binds capacity pagination to actor, query and current authorization; forged/stale cursors fail safely', async () => {
    const t = await team(),
      m = await ownMember(t.id);
    await join(t.id, viewer, 'VIEWER');
    await analytics.capacity(
      owner.actor,
      t.id,
      body(m),
      undefined,
      randomUUID(),
    );
    await analytics.capacity(
      owner.actor,
      t.id,
      { ...body(m), date: '2030-01-08' },
      undefined,
      randomUUID(),
    );
    const first = await analytics.capacities(owner.actor, t.id, {
      ...q,
      limit: 1,
    });
    expect(first.nextCursor).toBeTruthy();
    const cursor = first.nextCursor!;
    expect(
      (
        await analytics.capacities(owner.actor, t.id, {
          ...q,
          limit: 1,
          after: cursor,
        })
      ).items,
    ).toHaveLength(1);
    await expect(
      analytics.capacities(viewer.actor, t.id, {
        ...q,
        limit: 1,
        after: cursor,
      }),
    ).rejects.toHaveProperty('status', 400);
    await expect(
      analytics.capacities(owner.actor, t.id, {
        ...q,
        toDate: '2030-01-15',
        limit: 1,
        after: cursor,
      }),
    ).rejects.toHaveProperty('status', 400);
    await expect(
      analytics.capacities(owner.actor, t.id, {
        ...q,
        limit: 1,
        after: cursor.slice(0, -1) + 'x',
      }),
    ).rejects.toHaveProperty('status', 400);
    await join(t.id, member);
    await expect(
      analytics.capacities(owner.actor, t.id, {
        ...q,
        limit: 1,
        after: cursor,
      }),
    ).rejects.toHaveProperty('status', 409);
  });
  it('rolls back capacity, receipt, usage, audit and outbox together on an effect failure', async () => {
    const t = await team(),
      input = body(await ownMember(t.id)),
      key = randomUUID();
    const effects = vi
      .spyOn(kernel, 'offerEffect')
      .mockRejectedValueOnce(new Error('synthetic effect failure'));
    await expect(
      analytics.capacity(owner.actor, t.id, input, undefined, key),
    ).rejects.toThrow('synthetic effect failure');
    effects.mockRestore();
    expect(
      await client.teamCapacityDay.count({ where: { spaceId: t.id } }),
    ).toBe(0);
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: t.id, action: 'team.capacity.change' },
      }),
    ).toBe(0);
    expect(
      await client.sharedUsageEntry.count({
        where: { spaceId: t.id, feature: 'team.capacity-day' },
      }),
    ).toBe(0);
    expect(
      await client.sharedMutationReceipt.count({
        where: { spaceId: t.id, operation: 'team.capacity.create' },
      }),
    ).toBe(0);
    await analytics.capacity(owner.actor, t.id, input, undefined, key);
    expect(
      await client.sharedOutboxEvent.count({
        where: { spaceId: t.id, action: 'team.capacity.change' },
      }),
    ).toBe(1);
  });
  it('RACE winning Team revocation prevents capacity writes and receipt replay with no late effects', async () => {
    const t = await team(),
      m = await join(t.id, member, 'LEAD'),
      input = body(m),
      key = randomUUID();
    await analytics.capacity(member.actor, t.id, input, undefined, key);
    const entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (r.action === 'membership.change' && r.outcome === 'INTENT') {
        entered.release();
        await release.promise;
      }
    });
    const revoke = service.changeMembership(owner.actor, t.id, m.id, 1, {
      state: 'REVOKED',
      memberRole: 'LEAD',
    });
    await entered.promise;
    const late = outcome(analytics.capacity(member.actor, t.id, input, 1));
    try {
      await blocked();
    } finally {
      release.release();
    }
    await revoke;
    expect((await late).error).toBeDefined();
    await expect(
      analytics.capacity(member.actor, t.id, input, undefined, key),
    ).rejects.toHaveProperty('status', 404);
    expect(
      (
        await client.teamCapacityDay.findUniqueOrThrow({
          where: { id: input.id },
        })
      ).revision,
    ).toBe(1);
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: t.id, action: 'team.capacity.change' },
      }),
    ).toBe(1);
  });
  it('RACE capacity wins and commits its effects before waiting Team revocation', async () => {
    const t = await team(),
      m = await join(t.id, member, 'LEAD'),
      input = body(m),
      entered = barrier(),
      release = barrier(),
      run = kernel.run.bind(kernel);
    vi.spyOn(kernel, 'run').mockImplementationOnce(
      (actor, locks, requests, callback, onRetry) =>
        run(
          actor,
          locks,
          requests,
          async (tx, a) => {
            const result = await callback(tx, a);
            entered.release();
            await release.promise;
            return result;
          },
          onRetry,
        ),
    );
    const write = analytics.capacity(
      member.actor,
      t.id,
      input,
      undefined,
      randomUUID(),
    );
    await entered.promise;
    const revoke = service.changeMembership(owner.actor, t.id, m.id, 1, {
      state: 'REVOKED',
      memberRole: 'LEAD',
    });
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await write).revision).toBe(1);
    await revoke;
    expect(
      await client.sharedMutationReceipt.count({
        where: { spaceId: t.id, operation: 'team.capacity.create' },
      }),
    ).toBe(1);
    expect((await workload(t.id)).rows).toEqual([]);
  });
  it('RACE winning Project revocation denies a dashboard awaiting its cross-custody locks', async () => {
    const { t, p } = await linked();
    await join(t.id, member, 'LEAD');
    const m = await join(p.id, member, 'VIEWER');
    await source(p.id);
    const entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (r.action === 'membership.change' && r.outcome === 'INTENT') {
        entered.release();
        await release.promise;
      }
    });
    const revoke = service.changeMembership(owner.actor, p.id, m.id, 1, {
      state: 'REVOKED',
      memberRole: 'VIEWER',
    });
    await entered.promise;
    const read = outcome(analytics.analyze(member.actor, t.id, q, 'dashboard'));
    try {
      await blocked();
    } finally {
      release.release();
    }
    await revoke;
    expect((await read).error).toBeDefined();
    expect((await portfolio(t.id, member)).sources).toHaveLength(1);
  });
  it('rejects stale identity sessions and hides work members after verification is removed', async () => {
    const t = await team(),
      m = await join(t.id, member);
    await analytics.capacity(
      owner.actor,
      t.id,
      body(m),
      undefined,
      randomUUID(),
    );
    await client.user.update({
      where: { id: member.actor.userId },
      data: { emailVerified: false },
    });
    expect((await workload(t.id)).rows).toEqual([]);
    await client.user.update({
      where: { id: member.actor.userId },
      data: { emailVerified: true },
    });
    const stale = await person();
    await join(t.id, stale);
    await client.authSession.delete({ where: { id: stale.actor.sessionId! } });
    await expect(portfolio(t.id, stale)).rejects.toHaveProperty('status', 403);
  });
  it('uses the existing free growth seam with authoritative capacity usage and rejects duplicate natural keys', async () => {
    const t = await team(),
      m = await ownMember(t.id),
      policy = app.get(SharedFeaturePolicy),
      decide = policy.decide.bind(policy);
    const calls: unknown[] = [];
    vi.spyOn(policy, 'decide').mockImplementation(async (input, tx) => {
      if (input.feature === 'team.capacity-day') calls.push(input);
      return decide(input, tx);
    });
    await analytics.capacity(
      owner.actor,
      t.id,
      body(m),
      undefined,
      randomUUID(),
    );
    await analytics.capacity(
      owner.actor,
      t.id,
      { ...body(m), date: '2030-01-08' },
      undefined,
      randomUUID(),
    );
    expect(calls).toEqual(
      [0, 1].map((currentUsage) => ({
        feature: 'team.capacity-day',
        usageOwner: { kind: 'SHARED_CUSTODY', spaceId: t.id },
        growth: 1,
        currentUsage,
      })),
    );
    await expect(
      analytics.capacity(owner.actor, t.id, body(m), undefined, randomUUID()),
    ).rejects.toHaveProperty('status', 409);
    expect(
      await client.teamCapacityDay.count({ where: { spaceId: t.id } }),
    ).toBe(2);
  });
  it('resolves reporting windows as civil boundaries across daylight-saving transitions', async () => {
    const t = await team();
    const result = c.TeamPortfolioSchema.parse(
      await analytics.analyze(
        owner.actor,
        t.id,
        {
          fromDate: '2026-03-08',
          toDate: '2026-03-09',
          timezone: 'America/New_York',
        },
        'portfolio',
      ),
    );
    expect(result.window).toEqual({
      fromAt: '2026-03-08T05:00:00.000Z',
      toAt: '2026-03-09T04:00:00.000Z',
    });
    expect(result.summary.taskCount).toBe(0);
  });
  it('RACE a dashboard holding both custody fences commits before waiting Project revocation', async () => {
    const { t, p } = await linked();
    await join(t.id, member, 'VIEWER');
    const m = await join(p.id, member, 'VIEWER');
    await source(p.id);
    const entered = barrier(),
      release = barrier(),
      run = kernel.run.bind(kernel);
    vi.spyOn(kernel, 'run').mockImplementationOnce(
      (actor, locks, requests, callback, onRetry) =>
        run(
          actor,
          locks,
          requests,
          async (tx, a) => {
            const result = await callback(tx, a);
            entered.release();
            await release.promise;
            return result;
          },
          onRetry,
        ),
    );
    const read = analytics.analyze(member.actor, t.id, q, 'dashboard');
    await entered.promise;
    const revoke = service.changeMembership(owner.actor, p.id, m.id, 1, {
      state: 'REVOKED',
      memberRole: 'VIEWER',
    });
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect(
      c.TeamDashboardSchema.parse(await read).portfolio.sources,
    ).toHaveLength(2);
    await revoke;
    expect((await portfolio(t.id, member)).sources).toHaveLength(1);
  });
  it('enforces migration same-Team/generation/unique/day-minute constraints and immutable identity', async () => {
    const t = await team(),
      other = await team(),
      m = await ownMember(t.id),
      input = body(m);
    await analytics.capacity(owner.actor, t.id, input, undefined, randomUUID());
    const stored = await client.teamCapacityDay.findUniqueOrThrow({
      where: { id: input.id },
    });
    await expect(
      client.teamCapacityDay.create({
        data: {
          ...stored,
          id: randomUUID(),
          spaceId: other.id,
          scopeId: other.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      client.teamCapacityDay.create({
        data: { ...stored, id: randomUUID(), generation: 99 },
      }),
    ).rejects.toThrow();
    await expect(
      client.teamCapacityDay.create({ data: { ...stored, id: randomUUID() } }),
    ).rejects.toThrow();
    await expect(
      client.teamCapacityDay.update({
        where: { id: input.id },
        data: { availableMinutes: 1441, revision: { increment: 1 } },
      }),
    ).rejects.toThrow();
    await expect(
      client.teamCapacityDay.update({
        where: { id: input.id },
        data: { date: new Date('2030-01-09'), revision: { increment: 1 } },
      }),
    ).rejects.toThrow();
    expect(
      (
        await client.teamCapacityDay.findUniqueOrThrow({
          where: { id: input.id },
        })
      ).revision,
    ).toBe(1);
  });
});
