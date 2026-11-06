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
describe('P3-02 Team sources, Calendar and authorized group planning', () => {
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
    work: TeamWorkService,
    projects: ProjectsService;
  let owner: Person,
    member: Person,
    viewer: Person,
    outsider: Person,
    passwordHash: string;
  const password = 'synthetic-p202-password-123!',
    origin = 'http://localhost:3000',
    name = 'p203-' + randomUUID(),
    version = 'synthetic-p203-' + randomUUID();
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P203-ONLY',
      },
    });
    control = app.get(SharedControl);
    await control.initialize();
    service = app.get(CollaborationService);
    teams = app.get(TeamsService);
    work = app.get(TeamWorkService);
    projects = app.get(ProjectsService);
    kernel = app.get(SharedKernel);
    spaces = app.get(SpacesService);
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

  const page = { limit: 25 };
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

  async function task(id: string, who = owner) {
    return work.createTask(
      who.actor,
      id,
      { id: randomUUID(), title: 'Team task', priority: 'NONE' },
      randomUUID(),
    );
  }
  async function goal(id: string, who = owner) {
    return work.createGoal(
      who.actor,
      id,
      {
        id: randomUUID(),
        title: 'Team goal',
        horizon: 'SHORT_TERM',
        timezone: 'Asia/Tehran',
      },
      randomUUID(),
    );
  }
  async function plan(id: string, kind: 'WEEK' | 'SPRINT' = 'WEEK') {
    return work.createPlan(
      owner.actor,
      id,
      {
        id: randomUUID(),
        kind,
        title: 'Work period',
        startDate: '2030-01-07',
        endDate: '2030-01-14',
        timezone: 'Asia/Tehran',
      },
      randomUUID(),
    );
  }
  const eventInput = {
    title: 'Team event',
    schedule: {
      kind: 'TIMED' as const,
      timezone: 'UTC',
      localStart: '2030-01-07T09:00',
      localEnd: '2030-01-07T10:00',
    },
  };
  async function event(id: string, input: c.CalendarEventCreate = eventInput) {
    return c.TeamCalendarEventSchema.parse(
      await work.calendarCommand(
        owner.actor,
        id,
        { kind: 'CREATE', key: randomUUID(), input },
        randomUUID(),
      ),
    );
  }
  it('owns Team Tasks/Goals in existing engines with actor history, receipts, usage and same-custody links', async () => {
    const t = await team(),
      body = {
        id: randomUUID(),
        title: 'Stable source',
        priority: 'NONE' as const,
      },
      key = randomUUID();
    const first = await work.createTask(owner.actor, t.id, body, key);
    expect(await work.createTask(owner.actor, t.id, body, key)).toEqual(first);
    const stored = await client.task.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(stored.createdByUserId).toBeNull();
    expect(stored.scopeId).toBe(t.id);
    expect(
      await client.projectTask.count({ where: { taskId: first.id } }),
    ).toBe(0);
    const g = await goal(t.id);
    expect(
      (await work.linkGoalTask(owner.actor, t.id, g.id, first.id, 1)).revision,
    ).toBe(2);
    expect(
      (
        await client.goalTaskLink.findUniqueOrThrow({
          where: { goalId_taskId: { goalId: g.id, taskId: first.id } },
        })
      ).selectedSourceRevision,
    ).toBe(1);
    expect(await client.taskChange.count({ where: { taskId: first.id } })).toBe(
      1,
    );
    expect(
      await client.sharedUsageEntry.count({
        where: { spaceId: t.id, feature: 'task.shared' },
      }),
    ).toBe(1);
    const other = await team(),
      foreign = await task(other.id);
    await expect(
      work.linkGoalTask(owner.actor, t.id, g.id, foreign.id, 2),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      projects.source(owner.actor, t.id, 'TASK', first.id),
    ).rejects.toThrow();
  });
  it('preserves role boundaries across Teams, source revisions and idempotent mutation replay', async () => {
    const t = await team(),
      other = await team();
    await join(t.id, member, 'MEMBER');
    await join(other.id, member, 'VIEWER');
    const source = await task(t.id, member),
      foreign = await task(other.id);
    await expect(task(other.id, member)).rejects.toHaveProperty('status', 403);
    await expect(goal(t.id, member)).rejects.toHaveProperty('status', 403);
    await expect(
      work.sourceRead(member.actor, t.id, 'TASK', foreign.id),
    ).rejects.toHaveProperty('status', 404);
    const key = randomUUID(),
      updated = await work.patchTask(
        member.actor,
        t.id,
        source.id,
        1,
        { status: 'DONE' },
        key,
      );
    expect(updated.status).toBe('DONE');
    expect(
      await work.patchTask(
        member.actor,
        t.id,
        source.id,
        1,
        { status: 'DONE' },
        key,
      ),
    ).toEqual(updated);
    await expect(
      work.patchTask(
        member.actor,
        t.id,
        source.id,
        1,
        { title: 'Stale' },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 409);
    expect(
      await client.taskChange.count({ where: { taskId: source.id } }),
    ).toBe(2);
    await expect(
      work.sourceRead(outsider.actor, t.id, 'TASK', source.id),
    ).rejects.toHaveProperty('status', 404);
  });
  it('uses the Task schedule engine and preserves exact Goal manual progress', async () => {
    const t = await team(),
      s = await task(t.id),
      g = await goal(t.id);
    const schedule = await work.schedule(owner.actor, t.id, s.id, {
      revision: 1,
      value: {
        plannedStartAt: '2030-01-07T09:00:00Z',
        dueAt: '2030-01-07T10:00:00Z',
        scheduledDate: null,
      },
    });
    expect(schedule.revision).toBe(2);
    expect((await work.schedule(owner.actor, t.id, s.id)).plannedStartAt).toBe(
      '2030-01-07T09:00:00.000Z',
    );
    expect(
      (
        await work.patchGoal(
          owner.actor,
          t.id,
          g.id,
          1,
          { manualProgress: '33.333' },
          randomUUID(),
        )
      ).manualProgress,
    ).toBe('33.333');
    await expect(
      work.schedule(owner.actor, t.id, s.id, {
        revision: 1,
        value: {
          plannedStartAt: null,
          dueAt: null,
          scheduledDate: '2030-01-08',
        },
      }),
    ).rejects.toHaveProperty('status', 409);
  });
  it('Calendar shares the existing recurrence/DST engine while keeping Personal APIs and private TimeBlocks isolated', async () => {
    const t = await team(),
      input = {
        ...eventInput,
        recurrence: {
          version: 1 as const,
          startDate: '2030-01-07',
          endDate: null,
          localTime: '09:00',
          timezone: 'UTC',
          rule: { kind: 'DAILY' as const, interval: 1 },
          exclusionDates: [],
        },
      },
      key = randomUUID();
    const e = c.TeamCalendarEventSchema.parse(
      await work.calendarCommand(
        owner.actor,
        t.id,
        { kind: 'CREATE', key, input },
        key,
      ),
    );
    expect(
      await work.calendarCommand(
        owner.actor,
        t.id,
        { kind: 'CREATE', key, input },
        key,
      ),
    ).toEqual(e);
    expect(
      (await client.calendarEvent.findUniqueOrThrow({ where: { id: e.id } }))
        .createdByUserId,
    ).toBeNull();
    const view = c.CalendarViewSchema.parse(
      await work.calendarCommand(owner.actor, t.id, {
        kind: 'VIEW',
        query: {
          from: '2030-01-07',
          to: '2030-01-10',
          timezone: 'Asia/Tehran',
          limit: '100',
        },
      }),
    );
    expect(view.items).toHaveLength(3);
    expect(
      view.items.every((r) => r.kind === 'EVENT' && r.taskId === null),
    ).toBe(true);
    expect(
      await client.eventRecurrence.count({ where: { eventId: e.id } }),
    ).toBe(1);
    await expect(
      work.calendarCommand(
        owner.actor,
        t.id,
        {
          kind: 'CREATE',
          key: randomUUID(),
          input: {
            title: 'DST gap',
            schedule: {
              kind: 'TIMED',
              timezone: 'America/New_York',
              localStart: '2030-03-10T02:30',
              localEnd: '2030-03-10T03:30',
            },
          },
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 400);
    const personal = await request(app.getHttpServer())
      .get('/api/v1/calendar/events')
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(personal.body.items.some((r: { id: string }) => r.id === e.id)).toBe(
      false,
    );
    await request(app.getHttpServer())
      .get('/api/v1/calendar/events/' + e.id)
      .set('Cookie', owner.cookie)
      .expect(404);
    expect(await client.timeBlock.count({ where: { spaceId: t.id } })).toBe(0);
  });
  it('Calendar validates explicit schedule edits, all-day boundaries, range limits and authority-bound pagination', async () => {
    const t = await team();
    await join(t.id, member, 'VIEWER');
    const e = await event(t.id);
    await event(t.id, {
      title: 'All day',
      schedule: {
        kind: 'ALL_DAY',
        timezone: 'Asia/Tehran',
        startDate: '2030-01-07',
        endDate: '2030-01-08',
      },
    });
    await expect(
      work.calendarCommand(member.actor, t.id, {
        kind: 'PATCH',
        id: e.id,
        revision: 1,
        input: { title: 'Denied' },
      }),
    ).rejects.toHaveProperty('status', 403);
    const first = c.TeamCalendarPageSchema.parse(
      await work.calendarCommand(owner.actor, t.id, {
        kind: 'LIST',
        query: { limit: '1' },
      }),
    );
    expect(first.nextCursor).toBeTruthy();
    const second = c.TeamCalendarPageSchema.parse(
      await work.calendarCommand(owner.actor, t.id, {
        kind: 'LIST',
        query: { limit: '1', cursor: first.nextCursor! },
      }),
    );
    expect(second.items).toHaveLength(1);
    await expect(
      work.calendarCommand(member.actor, t.id, {
        kind: 'LIST',
        query: { limit: '1', cursor: first.nextCursor! },
      }),
    ).rejects.toHaveProperty('status', 400);
    const changed = c.TeamCalendarEventSchema.parse(
      await work.calendarCommand(owner.actor, t.id, {
        kind: 'PATCH',
        id: e.id,
        revision: 1,
        input: { title: 'Updated' },
      }),
    );
    expect(changed.revision).toBe(2);
    await expect(
      work.calendarCommand(owner.actor, t.id, {
        kind: 'PATCH',
        id: e.id,
        revision: 1,
        input: { title: 'Stale' },
      }),
    ).rejects.toHaveProperty('status', 409);
    expect(
      c.TeamCalendarRangeQuerySchema.safeParse({
        from: '2030-01-01',
        to: '2031-01-01',
        timezone: 'UTC',
      }).success,
    ).toBe(false);
  });
  it('Calendar series edit receipts preserve explicit exception/successor identities without a second series engine', async () => {
    const t = await team(),
      input = {
        ...eventInput,
        recurrence: {
          version: 1 as const,
          startDate: '2030-01-07',
          endDate: null,
          localTime: '09:00',
          timezone: 'UTC',
          rule: { kind: 'DAILY' as const, interval: 1 },
          exclusionDates: [],
        },
      },
      e = await event(t.id, input),
      key = randomUUID();
    const command = {
      kind: 'SERIES' as const,
      id: e.id,
      revision: 1,
      key,
      input: {
        scope: 'THIS_OCCURRENCE' as const,
        recurrenceKey: '2030-01-08T09:00',
        exceptionRevision: 0,
        patch: { title: 'Exception' },
      },
    };
    const result = c.TeamCalendarSeriesResultSchema.parse(
      await work.calendarCommand(owner.actor, t.id, command, key),
    );
    expect(result.exception?.title).toBe('Exception');
    expect(await work.calendarCommand(owner.actor, t.id, command, key)).toEqual(
      result,
    );
    expect(await client.calendarEvent.count({ where: { spaceId: t.id } })).toBe(
      2,
    );
  });
  it('weekly plans and optional sprints have explicit revisioned transitions and Team-authored reviews', async () => {
    const t = await team(),
      p = await plan(t.id);
    expect(p.state).toBe('DRAFT');
    await expect(
      work.patchPlan(owner.actor, t.id, p.id, 1, { state: 'CLOSED' }),
    ).rejects.toHaveProperty('status', 409);
    const active = await work.patchPlan(owner.actor, t.id, p.id, 1, {
      state: 'ACTIVE',
    });
    expect(active.revision).toBe(2);
    const review = await work.review(owner.actor, t.id, p.id, 2, {
      summary: 'Team-authored review',
    });
    expect(review.reviewSummary).toBe('Team-authored review');
    expect(review.reviewedByActorId).toBe(p.createdByActorId);
    expect(
      (await work.patchPlan(owner.actor, t.id, p.id, 3, { state: 'CLOSED' }))
        .state,
    ).toBe('CLOSED');
    await expect(
      work.patchPlan(owner.actor, t.id, p.id, 4, { state: 'ACTIVE' }),
    ).rejects.toHaveProperty('status', 409);
    const sprint = await plan(t.id, 'SPRINT');
    await expect(
      work.review(owner.actor, t.id, sprint.id, 1, {
        summary: 'No weekly review',
      }),
    ).rejects.toHaveProperty('status', 409);
    expect((await work.plans(owner.actor, t.id, page)).items).toHaveLength(2);
    expect(
      c.TeamPlanCreateSchema.safeParse({
        id: randomUUID(),
        kind: 'WEEK',
        title: 'Invalid',
        startDate: '2030-01-01',
        endDate: '2030-01-03',
        timezone: 'UTC',
      }).success,
    ).toBe(false);
  });
  it('backlog planning moves typed Task/Goal references without copying, assigning, rescheduling or deleting sources', async () => {
    const t = await team(),
      s = await task(t.id),
      g = await goal(t.id),
      p = await plan(t.id);
    const item = await work.createItem(
      owner.actor,
      t.id,
      {
        id: randomUUID(),
        target: { kind: 'TASK', spaceId: t.id, id: s.id },
        sourceRevision: 1,
        planId: null,
        position: 0,
      },
      randomUUID(),
    );
    const gi = await work.createItem(
      owner.actor,
      t.id,
      {
        id: randomUUID(),
        target: { kind: 'GOAL', spaceId: t.id, id: g.id },
        sourceRevision: 1,
        planId: p.id,
        position: 1,
      },
      randomUUID(),
    );
    expect(
      (
        await work.items(owner.actor, t.id, { limit: 25, planId: 'BACKLOG' })
      ).items.map((r) => r.id),
    ).toEqual([item.id]);
    const moved = await work.patchItem(
      owner.actor,
      t.id,
      item.id,
      1,
      { planId: p.id, position: 2, sourceRevision: 1 },
      item.target,
    );
    expect(moved.planId).toBe(p.id);
    expect(
      (await work.items(owner.actor, t.id, { limit: 25, planId: p.id })).items,
    ).toHaveLength(2);
    expect(
      (await work.sourceRead(owner.actor, t.id, 'TASK', s.id)).revision,
    ).toBe(1);
    expect(
      (await work.schedule(owner.actor, t.id, s.id)).plannedStartAt,
    ).toBeNull();
    await work.removeItem(owner.actor, t.id, gi.id, 1);
    expect(await client.goal.count({ where: { id: g.id } })).toBe(1);
    await expect(
      work.patchItem(
        owner.actor,
        t.id,
        item.id,
        1,
        { planId: null, position: 0, sourceRevision: 1 },
        item.target,
      ),
    ).rejects.toHaveProperty('status', 409);
  });
  it('cross-Project planning requires an active reference and independent current Project authority; filters before paging', async () => {
    const t = await team(),
      p = await project(),
      p2 = await project();
    await join(t.id, member, 'LEAD');
    const s = await projects.createTask(
      owner.actor,
      p.id,
      {
        id: randomUUID(),
        title: 'Authorized Project source',
        priority: 'NONE',
      },
      randomUUID(),
    );
    const hidden = await projects.createTask(
      owner.actor,
      p2.id,
      { id: randomUUID(), title: 'Hidden Project source', priority: 'NONE' },
      randomUUID(),
    );
    const create = (spaceId: string, taskId: string, by = owner) =>
      work.createItem(
        by.actor,
        t.id,
        {
          id: randomUUID(),
          target: { kind: 'TASK', spaceId, id: taskId },
          sourceRevision: 1,
          planId: null,
          position: 0,
        },
        randomUUID(),
      );
    await expect(create(p.id, s.id)).rejects.toHaveProperty('status', 404);
    await teams.reference(owner.actor, t.id, p.id, undefined, true);
    await teams.reference(owner.actor, t.id, p2.id, undefined, true);
    await expect(create(p.id, s.id, member)).rejects.toThrow();
    await join(p.id, member, 'VIEWER');
    const item = await create(p.id, s.id);
    await create(p2.id, hidden.id);
    const result = await work.items(member.actor, t.id, { limit: 1 });
    expect(result.items.map((r) => r.id)).toEqual([item.id]);
    expect(result.nextCursor).toBeNull();
    expect(JSON.stringify(result)).not.toContain(hidden.id);
    expect((await projects.source(owner.actor, p.id, 'TASK', s.id)).id).toBe(
      s.id,
    );
    expect(await client.task.count({ where: { id: s.id } })).toBe(1);
    await teams.reference(owner.actor, t.id, p.id, 1, false);
    expect((await work.items(member.actor, t.id, page)).items).toEqual([]);
    await work.removeItem(owner.actor, t.id, item.id, 1);
    expect(await client.task.count({ where: { id: s.id } })).toBe(1);
  });
  it('rejects Personal/unrelated Team sources, stale source selections, foreign plans and hostile DB branches', async () => {
    const t = await team(),
      other = await team(),
      s = await task(t.id),
      foreign = await task(other.id),
      p = await plan(other.id);
    await expect(
      work.createItem(
        owner.actor,
        t.id,
        {
          id: randomUUID(),
          target: { kind: 'TASK', spaceId: other.id, id: foreign.id },
          sourceRevision: 1,
          planId: null,
          position: 0,
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      work.createItem(
        owner.actor,
        t.id,
        {
          id: randomUUID(),
          target: { kind: 'TASK', spaceId: t.id, id: s.id },
          sourceRevision: 2,
          planId: null,
          position: 0,
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      work.createItem(
        owner.actor,
        t.id,
        {
          id: randomUUID(),
          target: { kind: 'TASK', spaceId: t.id, id: s.id },
          sourceRevision: 1,
          planId: p.id,
          position: 0,
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
    const e = await event(t.id);
    await expect(
      client.calendarEvent.update({
        where: { id: e.id },
        data: { createdByUserId: owner.actor.userId },
      }),
    ).rejects.toThrow();
    await expect(
      client.eventRecurrence.create({
        data: {
          spaceId: t.id,
          createdByUserId: null,
          title: 'Wrong scope',
          kind: 'ALL_DAY',
          timezone: 'UTC',
          startDate: new Date('2030-01-01'),
          endDate: new Date('2030-01-02'),
          eventId: e.id,
          definition: { version: 1 },
          identityTime: '00:00',
          fromKey: '2030-01-01T00:00',
        },
      }),
    ).rejects.toThrow();
  });
  it('source update and admission rejoin invalidate optimistic selections and authority-bound source/calendar/planning cursors', async () => {
    const t = await team(),
      m = await join(t.id, member, 'LEAD');
    await task(t.id);
    await task(t.id);
    await event(t.id);
    await event(t.id);
    const tasks = c.SharedTaskPageSchema.parse(
      await work.sourceList(member.actor, t.id, 'TASK', { limit: 1 }),
    );
    expect(tasks.nextCursor).toBeTruthy();
    const events = c.TeamCalendarPageSchema.parse(
      await work.calendarCommand(member.actor, t.id, {
        kind: 'LIST',
        query: { limit: '1' },
      }),
    );
    await service.changeMembership(owner.actor, t.id, m.id, m.revision, {
      state: 'REVOKED',
      memberRole: 'LEAD',
    });
    await expect(
      work.sourceList(member.actor, t.id, 'TASK', {
        limit: 1,
        after: tasks.nextCursor!,
      }),
    ).rejects.toThrow();
    await join(t.id, member, 'LEAD');
    await expect(
      work.sourceList(member.actor, t.id, 'TASK', {
        limit: 1,
        after: tasks.nextCursor!,
      }),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      work.calendarCommand(member.actor, t.id, {
        kind: 'LIST',
        query: { limit: '1', cursor: events.nextCursor! },
      }),
    ).rejects.toHaveProperty('status', 409);
  });
  it('rolls back source/history/receipt/usage/audit/outbox together and reauthorizes receipt replay after revoke', async () => {
    const t = await team(),
      id = randomUUID(),
      effect = vi
        .spyOn(kernel, 'offerEffect')
        .mockRejectedValueOnce(new Error('Synthetic rollback'));
    await expect(
      work.createTask(
        owner.actor,
        t.id,
        { id, title: 'Rollback', priority: 'NONE' },
        randomUUID(),
      ),
    ).rejects.toThrow('Synthetic');
    effect.mockRestore();
    expect(await client.task.count({ where: { id } })).toBe(0);
    expect(await client.taskChange.count({ where: { taskId: id } })).toBe(0);
    expect(
      await client.sharedMutationReceipt.count({
        where: { spaceId: t.id, operation: 'team.task.create' },
      }),
    ).toBe(0);
    const m = await join(t.id, member, 'MEMBER'),
      body = {
        id: randomUUID(),
        title: 'Revoke replay',
        priority: 'NONE' as const,
      },
      key = randomUUID();
    await work.createTask(member.actor, t.id, body, key);
    await service.changeMembership(owner.actor, t.id, m.id, 1, {
      state: 'REVOKED',
      memberRole: 'MEMBER',
    });
    await expect(
      work.createTask(member.actor, t.id, body, key),
    ).rejects.toThrow();
  });
  it('RACE winning Team revocation blocks Task mutation and Calendar write without late effects', async () => {
    const t = await team(),
      m = await join(t.id, member, 'LEAD'),
      s = await task(t.id),
      g = await goal(t.id),
      e = await event(t.id),
      entered = barrier(),
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
    const taskWrite = outcome(
        work.patchTask(
          member.actor,
          t.id,
          s.id,
          1,
          { title: 'Late' },
          randomUUID(),
        ),
      ),
      goalWrite = outcome(
        work.patchGoal(
          member.actor,
          t.id,
          g.id,
          1,
          { title: 'Late' },
          randomUUID(),
        ),
      ),
      calendarWrite = outcome(
        work.calendarCommand(member.actor, t.id, {
          kind: 'PATCH',
          id: e.id,
          revision: 1,
          input: { title: 'Late' },
        }),
      );
    try {
      await blocked();
    } finally {
      release.release();
    }
    await revoke;
    expect((await taskWrite).error).toBeDefined();
    expect((await goalWrite).error).toBeDefined();
    expect(
      (await client.goal.findUniqueOrThrow({ where: { id: g.id } })).revision,
    ).toBe(1);
    expect((await calendarWrite).error).toBeDefined();
    expect(
      (await client.task.findUniqueOrThrow({ where: { id: s.id } })).revision,
    ).toBe(1);
    expect(
      (await client.calendarEvent.findUniqueOrThrow({ where: { id: e.id } }))
        .revision,
    ).toBe(1);
  });
  it('RACE Team source mutation wins and commits history/receipt/audit before waiting revoke', async () => {
    const t = await team(),
      m = await join(t.id, member, 'MEMBER'),
      s = await task(t.id),
      entered = barrier(),
      release = barrier(),
      run = kernel.run.bind(kernel);
    vi.spyOn(kernel, 'run').mockImplementationOnce(
      (actor, locks, requests, body, onRetry) =>
        run(
          actor,
          locks,
          requests,
          async (tx, a) => {
            const value = await body(tx, a);
            entered.release();
            await release.promise;
            return value;
          },
          onRetry,
        ),
    );
    const mutation = work.patchTask(
      member.actor,
      t.id,
      s.id,
      1,
      { title: 'First' },
      randomUUID(),
    );
    await entered.promise;
    const revoke = service.changeMembership(owner.actor, t.id, m.id, 1, {
      state: 'REVOKED',
      memberRole: 'MEMBER',
    });
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await mutation).revision).toBe(2);
    await revoke;
    expect(await client.taskChange.count({ where: { taskId: s.id } })).toBe(2);
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: t.id, resourceId: s.id, action: 'team.task.update' },
      }),
    ).toBe(1);
  });
  it('RACE Project revocation blocks a queued cross-custody planning reference', async () => {
    const t = await team(),
      p = await project(),
      m = await join(p.id, member, 'MEMBER');
    await join(t.id, member, 'LEAD');
    await teams.reference(owner.actor, t.id, p.id, undefined, true);
    const s = await projects.createTask(
        owner.actor,
        p.id,
        { id: randomUUID(), title: 'Project source', priority: 'NONE' },
        randomUUID(),
      ),
      entered = barrier(),
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
      memberRole: 'MEMBER',
    });
    await entered.promise;
    const create = outcome(
      work.createItem(
        member.actor,
        t.id,
        {
          id: randomUUID(),
          target: { kind: 'TASK', spaceId: p.id, id: s.id },
          sourceRevision: 1,
          planId: null,
          position: 0,
        },
        randomUUID(),
      ),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    await revoke;
    expect((await create).error).toBeDefined();
    expect(await client.teamWorkItem.count({ where: { spaceId: t.id } })).toBe(
      0,
    );
  });
  it('HTTP exposes strict Team work routes and keeps Owner/Admin/Lead authority separate from Member/Viewer', async () => {
    const t = await team(),
      api = request(app.getHttpServer());
    await join(t.id, viewer, 'VIEWER');
    await api
      .post('/api/v1/teams/' + t.id + '/plans')
      .set('Cookie', viewer.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        id: randomUUID(),
        kind: 'WEEK',
        title: 'Denied',
        startDate: '2030-01-07',
        endDate: '2030-01-14',
        timezone: 'UTC',
      })
      .expect(403);
    const created = await api
      .post('/api/v1/teams/' + t.id + '/tasks')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({ id: randomUUID(), title: 'HTTP source' })
      .expect(201);
    expect(created.headers.etag).toBe('"1"');
    await api
      .patch('/api/v1/teams/' + t.id + '/tasks/' + created.body.id)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({ title: 'No revision' })
      .expect(400);
    await api
      .get('/api/v1/teams/' + t.id + '/tasks')
      .set('Cookie', viewer.cookie)
      .expect(200);
    await api
      .post('/api/v1/teams/' + t.id + '/calendar/events')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({ ...eventInput, createdByUserId: owner.actor.userId })
      .expect(400);
    const event = await api
      .post('/api/v1/teams/' + t.id + '/calendar/events')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send(eventInput)
      .expect(201);
    expect(event.body).not.toHaveProperty('createdByUserId');
    await api
      .delete('/api/v1/teams/' + t.id + '/calendar/events/' + event.body.id)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({})
      .expect(200);
    await api
      .get(
        '/api/v1/teams/' +
          t.id +
          '/calendar?from=2030-01-01&to=2030-01-10&timezone=UTC',
      )
      .set('Cookie', viewer.cookie)
      .expect(200);
  });

  it('free-mode growth and failed Calendar publication roll back their new records and accounting', async () => {
    const t = await team(),
      s = await task(t.id),
      feature = app.get(SharedFeaturePolicy),
      decide = feature.decide.bind(feature),
      deny = vi
        .spyOn(feature, 'decide')
        .mockImplementation((input, tx) =>
          ['team.plan', 'team.work-item', 'calendar.shared-event'].includes(
            input.feature,
          )
            ? Promise.resolve({ allowed: false, mode: 'FREE' })
            : decide(input, tx),
        );
    await expect(plan(t.id)).rejects.toHaveProperty('status', 403);
    await expect(
      work.createItem(
        owner.actor,
        t.id,
        {
          id: randomUUID(),
          target: { kind: 'TASK', spaceId: t.id, id: s.id },
          sourceRevision: 1,
          planId: null,
          position: 0,
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    expect(await client.teamWorkItem.count({ where: { spaceId: t.id } })).toBe(
      0,
    );
    await expect(event(t.id)).rejects.toHaveProperty('status', 403);
    deny.mockRestore();
    expect(await client.teamPlan.count({ where: { spaceId: t.id } })).toBe(0);
    expect(await client.calendarEvent.count({ where: { spaceId: t.id } })).toBe(
      0,
    );
    const effect = vi
      .spyOn(kernel, 'offerEffect')
      .mockRejectedValueOnce(new Error('Synthetic Calendar rollback'));
    await expect(event(t.id)).rejects.toThrow('Synthetic');
    effect.mockRestore();
    expect(await client.calendarEvent.count({ where: { spaceId: t.id } })).toBe(
      0,
    );
    expect(
      await client.sharedUsageEntry.count({
        where: { spaceId: t.id, feature: 'calendar.shared-event' },
      }),
    ).toBe(0);
  });
  it('account closure immediately denies Team work while independent shared sources survive attribution detachment', async () => {
    const t = await team(),
      who = await person(),
      m = await join(t.id, who, 'LEAD'),
      s = await task(t.id, who);
    const calendar = c.TeamCalendarEventSchema.parse(
      await work.calendarCommand(
        who.actor,
        t.id,
        { kind: 'CREATE', key: randomUUID(), input: eventInput },
        randomUUID(),
      ),
    );
    const privateSpace = await client.space.findFirstOrThrow({
        where: { ownerUserId: who.actor.userId },
      }),
      closedAt = new Date();
    await client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'personal-access:' + privateSpace.id},0))::text`;
      await tx.space.update({
        where: { id: privateSpace.id },
        data: { accessClosedAt: closedAt },
      });
      await kernel.enqueueExit(tx, who.actor.userId, closedAt);
    });
    await expect(
      work.sourceRead(who.actor, t.id, 'TASK', s.id),
    ).rejects.toThrow();
    await kernel.prepareIdentityErasure(who.actor.userId, closedAt);
    expect(
      (await client.sharedActor.findUniqueOrThrow({ where: { id: m.actorId } }))
        .userId,
    ).toBeNull();
    const taskView = await work.sourceRead(owner.actor, t.id, 'TASK', s.id),
      eventView = await work.calendarCommand(owner.actor, t.id, {
        kind: 'READ',
        id: calendar.id,
      });
    for (const value of [who.actor.userId, who.email])
      expect(JSON.stringify([taskView, eventView])).not.toContain(value);
    expect((await spaces.authorizePersonal(owner.actor)).spaceId).toBeTruthy();
  });

  it('RACE cross-custody planning commits first, then Project revoke removes current visibility without touching sources', async () => {
    const t = await team(),
      p = await project(),
      m = await join(p.id, member, 'VIEWER');
    await join(t.id, member, 'LEAD');
    await teams.reference(owner.actor, t.id, p.id, undefined, true);
    const s = await projects.createTask(
        owner.actor,
        p.id,
        { id: randomUUID(), title: 'Independent source', priority: 'NONE' },
        randomUUID(),
      ),
      entered = barrier(),
      release = barrier(),
      run = kernel.run.bind(kernel);
    vi.spyOn(kernel, 'run').mockImplementationOnce(
      (actor, locks, requests, body, onRetry) =>
        run(
          actor,
          locks,
          requests,
          async (tx, a) => {
            const value = await body(tx, a);
            entered.release();
            await release.promise;
            return value;
          },
          onRetry,
        ),
    );
    const itemId = randomUUID(),
      mutation = work.createItem(
        member.actor,
        t.id,
        {
          id: itemId,
          target: { kind: 'TASK', spaceId: p.id, id: s.id },
          sourceRevision: 1,
          planId: null,
          position: 0,
        },
        randomUUID(),
      );
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
    expect((await mutation).id).toBe(itemId);
    await revoke;
    expect((await work.items(member.actor, t.id, page)).items).toEqual([]);
    expect(await client.teamWorkItem.count({ where: { id: itemId } })).toBe(1);
    expect(
      await client.sharedAuditEvent.count({
        where: {
          spaceId: t.id,
          resourceId: itemId,
          action: 'team.item.create',
        },
      }),
    ).toBe(1);
    expect(
      (await projects.source(owner.actor, p.id, 'TASK', s.id)).revision,
    ).toBe(1);
  });
});
