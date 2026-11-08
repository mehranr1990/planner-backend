import {
  TeamLifecycleService,
  TeamCleanupService,
  TeamAnalyticsService,
} from '../../src/modules/teams/public/index.js';
import { SharedLifecycleService } from '../../src/modules/spaces/public/index.js';
import { SpacesService } from '../../src/modules/spaces/public/index.js';
import { ProjectCleanupService } from '../../src/modules/projects/public/index.js';
import {
  TeamCareService,
  TeamMeetingsService,
} from '../../src/modules/teams/public/index.js';
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
describe('P3-05 independent Team lifecycle, preservation and local performance', () => {
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
    life: TeamLifecycleService,
    cleanup: TeamCleanupService,
    sharedLife: SharedLifecycleService,
    analytics: TeamAnalyticsService,
    projectCleanup: ProjectCleanupService,
    care: TeamCareService,
    meetings: TeamMeetingsService,
    projects: ProjectsService;
  let reviewer: Person,
    owner: Person,
    member: Person,
    viewer: Person,
    outsider: Person,
    passwordHash: string;
  const password = 'synthetic-p202-password-123!',
    origin = 'http://localhost:3000',
    name = 'p305-' + randomUUID(),
    version = 'synthetic-p305-' + randomUUID();
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P305-ONLY',
      },
    });
    control = app.get(SharedControl);
    await control.initialize();
    service = app.get(CollaborationService);
    teams = app.get(TeamsService);
    work = app.get(TeamWorkService);
    life = app.get(TeamLifecycleService);
    cleanup = app.get(TeamCleanupService);
    sharedLife = app.get(SharedLifecycleService);
    analytics = app.get(TeamAnalyticsService);
    projectCleanup = app.get(ProjectCleanupService);
    care = app.get(TeamCareService);
    meetings = app.get(TeamMeetingsService);
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
    reviewer = await person();
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

  const page = { limit: 25 },
    ref = (m: { id: string; generation: number }) => ({
      accessId: m.id,
      generation: m.generation,
    });
  const q = { fromDate: '2030-01-07', toDate: '2030-01-14', timezone: 'UTC' };
  async function task(id: string, who = owner) {
    return work.createTask(
      who.actor,
      id,
      { id: randomUUID(), title: 'Team lifecycle source', priority: 'NONE' },
      randomUUID(),
    );
  }
  async function seat(id: string, who = owner) {
    return client.contextAccess.findFirstOrThrow({
      where: { spaceId: id, SharedActor: { userId: who.actor.userId } },
    });
  }
  async function elapsed(id: string) {
    const job = await client.sharedLifecycleJob.findFirstOrThrow({
      where: { spaceId: id },
      orderBy: { generation: 'desc' },
    });
    const now = Date.now();
    return client.sharedLifecycleJob.update({
      where: { id: job.id },
      data: {
        effectiveDepartureAt: new Date(now - 31 * 86400000),
        recoveryDeadline: new Date(now - 86400000),
        nextAt: new Date(0),
      },
    });
  }
  async function drain(id: string, max = 160) {
    let passes = 0;
    for (; passes < max; passes++) {
      const job = await client.sharedLifecycleJob.findFirstOrThrow({
        where: { custodyId: id },
        orderBy: { generation: 'desc' },
      });
      if (job.state === 'DELETED') return passes;
      await cleanup.consume();
    }
    throw new Error(
      'Bounded Team cleanup failed to finish ' +
        JSON.stringify(
          await client.sharedLifecycleJob.findMany({
            where: { custodyId: id },
          }),
        ),
    );
  }
  async function rich() {
    const t = await team(),
      m = await join(t.id, member),
      v = await join(t.id, viewer, 'VIEWER'),
      r = await join(t.id, reviewer, 'ADMIN'),
      p = await project(),
      pt = await projects.createTask(
        owner.actor,
        p.id,
        {
          id: randomUUID(),
          title: 'Independent Project source',
          priority: 'NONE',
        },
        randomUUID(),
      );
    await teams.reference(owner.actor, t.id, p.id, undefined, true);
    const source = await task(t.id),
      goal = await work.createGoal(
        owner.actor,
        t.id,
        {
          id: randomUUID(),
          title: 'Team goal',
          horizon: 'SHORT_TERM',
          timezone: 'UTC',
        },
        randomUUID(),
      );
    await work.linkGoalTask(owner.actor, t.id, goal.id, source.id, 1);
    const plan = await work.createPlan(
      owner.actor,
      t.id,
      {
        id: randomUUID(),
        kind: 'WEEK',
        title: 'Preserved work plan',
        startDate: '2030-01-07',
        endDate: '2030-01-14',
        timezone: 'UTC',
      },
      randomUUID(),
    );
    for (const [spaceId, id] of [
      [t.id, source.id],
      [p.id, pt.id],
    ])
      await work.createItem(
        owner.actor,
        t.id,
        {
          id: randomUUID(),
          target: { kind: 'TASK', spaceId: spaceId!, id: id! },
          sourceRevision: 1,
          planId: plan.id,
          position: 0,
        },
        randomUUID(),
      );
    await analytics.capacity(
      owner.actor,
      t.id,
      {
        id: randomUUID(),
        member: ref(m),
        date: '2030-01-07',
        timezone: 'UTC',
        availableMinutes: 480,
      },
      undefined,
      randomUUID(),
    );
    const record = await care.create(
      owner.actor,
      t.id,
      {
        id: randomUUID(),
        kind: 'RECOGNITION',
        subject: ref(v),
        reviewer: ref(r),
        reason: 'Confidential retained recognition',
        evidence: 'Confidential retained evidence',
      },
      randomUUID(),
    );
    const pub = await care.propose(
      owner.actor,
      t.id,
      record.id,
      {
        id: randomUUID(),
        sourceRevision: 1,
        audience: 'TEAM',
        recipients: [],
        summary: 'Reviewed recognition only',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      randomUUID(),
    );
    const approved = await care.decide(reviewer.actor, t.id, pub.id, 1, {
      kind: 'REVIEW',
      approve: true,
      reason: 'Confidential review',
    });
    await care.decide(viewer.actor, t.id, pub.id, approved.revision, {
      kind: 'CONSENT',
      consent: true,
    });
    const meeting = await meetings.create(
      owner.actor,
      t.id,
      {
        id: randomUUID(),
        event: {
          title: 'Retained meeting',
          schedule: {
            kind: 'ALL_DAY',
            timezone: 'UTC',
            startDate: '2030-01-07',
            endDate: '2030-01-08',
          },
        },
        agenda: 'Retained agenda',
      },
      randomUUID(),
    );
    const invitation = await meetings.invite(
      owner.actor,
      t.id,
      meeting.id,
      1,
      {
        id: randomUUID(),
        member: ref(v),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      randomUUID(),
    );
    const event = c.TeamCalendarEventSchema.parse(
      await work.calendarCommand(
        owner.actor,
        t.id,
        {
          kind: 'CREATE',
          key: randomUUID(),
          input: {
            title: 'Recurring Team calendar',
            schedule: {
              kind: 'ALL_DAY',
              timezone: 'UTC',
              startDate: '2030-01-07',
              endDate: '2030-01-08',
            },
            recurrence: {
              version: 1,
              startDate: '2030-01-07',
              endDate: null,
              localTime: '00:00',
              timezone: 'UTC',
              rule: { kind: 'DAILY', interval: 1 },
              exclusionDates: [],
            },
          },
        },
        randomUUID(),
      ),
    );
    await work.calendarCommand(
      owner.actor,
      t.id,
      {
        kind: 'SERIES',
        id: event.id,
        revision: 1,
        key: randomUUID(),
        input: {
          scope: 'THIS_OCCURRENCE',
          recurrenceKey: '2030-01-08T00:00',
          exceptionRevision: 0,
          patch: { title: 'Preserved exception' },
        },
      },
      randomUUID(),
    );
    return {
      t,
      m,
      v,
      r,
      p,
      pt,
      source,
      goal,
      plan,
      record,
      pub,
      meeting,
      invitation,
      event,
    };
  }
  it('hands over independent Team custody by successor consent/password without moving sources or granting confidential case access', async () => {
    const f = await rich(),
      before = await client.task.findUniqueOrThrow({
        where: { id: f.source.id },
      }),
      key = randomUUID();
    const proposed = await life.handover(
      owner.actor,
      f.t.id,
      { successorAccessId: f.m.id },
      key,
    );
    expect(
      await life.handover(
        owner.actor,
        f.t.id,
        { successorAccessId: f.m.id },
        key,
      ),
    ).toEqual(proposed);
    await expect(
      life.decide(
        member.actor,
        f.t.id,
        proposed.id,
        1,
        'accept',
        'wrong-password',
      ),
    ).rejects.toHaveProperty('status', 403);
    const accepted = await life.decide(
      member.actor,
      f.t.id,
      proposed.id,
      1,
      'accept',
      password,
    );
    expect(accepted.state).toBe('ACCEPTED');
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: f.t.id },
        })
      ).primaryOwnerAccessId,
    ).toBe(f.m.id);
    expect(
      await client.task.findUniqueOrThrow({ where: { id: f.source.id } }),
    ).toEqual(before);
    await expect(
      care.read(member.actor, f.t.id, f.record.id),
    ).rejects.toHaveProperty('status', 404);
    expect((await care.read(owner.actor, f.t.id, f.record.id)).id).toBe(
      f.record.id,
    );
    const old = await seat(f.t.id);
    await service.leave(owner.actor, f.t.id, old.revision);
    expect((await teams.read(member.actor, f.t.id)).id).toBe(f.t.id);
    expect(
      (await projects.source(owner.actor, f.p.id, 'TASK', f.pt.id)).id,
    ).toBe(f.pt.id);
  });
  it('protects the last custodian, requires explicit admission and rejects cross-Team handover IDs or stale decisions', async () => {
    const t = await team(),
      m = await join(t.id, member),
      other = await team();
    await expect(service.leave(owner.actor, t.id, 1)).rejects.toHaveProperty(
      'status',
      409,
    );
    await expect(
      life.change(owner.actor, t.id, 1, 'delete', password),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      life.handover(
        owner.actor,
        other.id,
        { successorAccessId: m.id },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
    const p = await life.handover(
      owner.actor,
      t.id,
      { successorAccessId: m.id },
      randomUUID(),
    );
    await expect(
      life.decide(member.actor, other.id, p.id, 1, 'accept', password),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      life.decide(member.actor, t.id, p.id, 2, 'accept', password),
    ).rejects.toHaveProperty('status', 409);
    expect(
      (await life.decide(member.actor, t.id, p.id, 1, 'decline')).state,
    ).toBe('DECLINED');
    const again = await life.handover(
      owner.actor,
      t.id,
      { successorAccessId: m.id },
      randomUUID(),
    );
    expect(
      (await life.decide(owner.actor, t.id, again.id, 1, 'revoke')).state,
    ).toBe('REVOKED');
  });
  it('archives as read-only, preserves Team and Project identities and restores only current eligible read/write authority', async () => {
    const f = await rich();
    await expect(
      life.change(member.actor, f.t.id, 1, 'archive'),
    ).rejects.toHaveProperty('status', 403);
    const archived = await life.change(owner.actor, f.t.id, 1, 'archive');
    expect(archived.revision).toBe(2);
    expect((await teams.read(owner.actor, f.t.id)).state).toBe('ARCHIVED');
    expect(
      (await work.sourceRead(member.actor, f.t.id, 'TASK', f.source.id)).id,
    ).toBe(f.source.id);
    expect(
      (await care.read(viewer.actor, f.t.id, f.record.id)).evidence,
    ).toContain('Confidential');
    expect(
      (await meetings.read(member.actor, f.t.id, f.meeting.id)).agenda,
    ).toBe('Retained agenda');
    expect(
      (await teams.projectList(owner.actor, f.t.id, page)).items,
    ).toHaveLength(1);
    expect(
      c.TeamDashboardSchema.parse(
        await analytics.analyze(owner.actor, f.t.id, q, 'dashboard'),
      ).portfolio.summary.taskCount,
    ).toBe(2);
    await expect(task(f.t.id, member)).rejects.toHaveProperty('status', 404);
    await expect(
      meetings.patch(owner.actor, f.t.id, f.meeting.id, 1, {
        agenda: 'Late write',
      }),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      life.change(owner.actor, f.t.id, 1, 'restore'),
    ).rejects.toHaveProperty('status', 409);
    expect(
      (await life.change(owner.actor, f.t.id, 2, 'restore')).revision,
    ).toBe(3);
    expect((await task(f.t.id, member)).spaceId).toBe(f.t.id);
    expect((await projects.read(owner.actor, f.p.id)).state).toBe('ACTIVE');
  });
  it('does not revive recognition disclosure, meeting invitations, membership invitations or old cursors on archive/restore', async () => {
    const f = await rich(),
      first = await work.sourceList(owner.actor, f.t.id, 'TASK', { limit: 1 });
    await task(f.t.id);
    const cursor = await work.sourceList(owner.actor, f.t.id, 'TASK', {
      limit: 1,
    });
    expect(cursor.nextCursor).toBeTruthy();
    const offer = await service.createInvitation(
      owner.actor,
      f.t.id,
      {
        kind: 'MEMBERSHIP',
        memberRole: 'MEMBER',
        recipient: { userId: outsider.actor.userId },
      },
      randomUUID(),
    );
    await life.change(owner.actor, f.t.id, 1, 'archive');
    await life.change(owner.actor, f.t.id, 2, 'restore');
    expect(
      c.TeamDisclosureSummaryPageSchema.parse(
        await care.summaries(member.actor, f.t.id, page),
      ).items,
    ).toEqual([]);
    expect(
      (await meetings.invitations(viewer.actor, f.t.id, f.meeting.id, page))
        .items[0]!.state,
    ).toBe('UNAVAILABLE');
    await expect(
      meetings.respond(
        viewer.actor,
        f.t.id,
        f.meeting.id,
        f.invitation.id,
        1,
        'ACCEPTED',
      ),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      service.decideInvitation(
        outsider.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
        'TEAM',
      ),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      work.sourceList(owner.actor, f.t.id, 'TASK', {
        limit: 1,
        after: cursor.nextCursor!,
      }),
    ).rejects.toHaveProperty('status', 409);
    expect(first.items[0]!.id).toBe(f.source.id);
  });
  it('keeps Team lifecycle routes separate from generic Project/collaboration entry points', async () => {
    const t = await team(),
      p = await project();
    await expect(
      life.change(owner.actor, p.id, 1, 'archive'),
    ).rejects.toHaveProperty('status', 404);
    await request(app.getHttpServer())
      .post('/api/v1/spaces/' + t.id + '/ownership-handovers')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({ successorAccessId: randomUUID() })
      .expect(404);
    await life.change(owner.actor, t.id, 1, 'delete', password);
    await request(app.getHttpServer())
      .get('/api/v1/projects/' + t.id + '/lifecycle-job')
      .set('Cookie', owner.cookie)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/teams/' + t.id + '/lifecycle-job')
      .set('Cookie', owner.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/teams/' + t.id + '/lifecycle-job')
      .expect(401);
  });
  it('closes sole-owner Team into a 30-day recoverable window and checks current proof, password and generation', async () => {
    const t = await team(),
      source = await task(t.id);
    await expect(
      life.change(owner.actor, t.id, 1, 'delete', 'wrong'),
    ).rejects.toHaveProperty('status', 403);
    await life.change(owner.actor, t.id, 1, 'delete', password);
    const status = await life.status(owner.actor, t.id),
      job = await life.job(owner.actor, t.id);
    expect(status.state).toBe('CLOSING_GRACE');
    expect(Date.parse(status.recoveryDeadline!) - Date.now()).toBeGreaterThan(
      29 * 86400000,
    );
    await expect(teams.read(owner.actor, t.id)).rejects.toHaveProperty(
      'status',
      404,
    );
    await expect(life.job(member.actor, t.id)).rejects.toHaveProperty(
      'status',
      404,
    );
    const proof = await life.proof(owner.actor, t.id, job.revision, password);
    await expect(
      life.recover(
        owner.actor,
        t.id,
        proof.revision,
        proof.generation,
        'a'.repeat(43),
        password,
      ),
    ).rejects.toHaveProperty('status', 404);
    expect(
      (
        await life.recover(
          owner.actor,
          t.id,
          proof.revision,
          proof.generation,
          proof.proof,
          password,
        )
      ).state,
    ).toBe('CANCELED');
    expect((await seat(t.id)).generation).toBe(2);
    expect(
      (await work.sourceRead(owner.actor, t.id, 'TASK', source.id)).id,
    ).toBe(source.id);
    await expect(
      life.recover(
        owner.actor,
        t.id,
        proof.revision,
        proof.generation,
        proof.proof,
        password,
      ),
    ).rejects.toHaveProperty('status', 409);
  });
  it('handles last-member leave and recovery without reviving old source creation receipts or read authority', async () => {
    const t = await team(),
      body = {
        id: randomUUID(),
        title: 'Before departure',
        priority: 'NONE' as const,
      },
      key = randomUUID();
    await work.createTask(owner.actor, t.id, body, key);
    await service.leave(owner.actor, t.id, 1);
    const job = await life.job(owner.actor, t.id),
      proof = await life.proof(owner.actor, t.id, job.revision, password);
    await life.recover(
      owner.actor,
      t.id,
      proof.revision,
      proof.generation,
      proof.proof,
      password,
    );
    await expect(
      work.createTask(owner.actor, t.id, body, key),
    ).rejects.toHaveProperty('status', 409);
    expect(await client.task.count({ where: { spaceId: t.id } })).toBe(1);
  });
  it('purges only the independent Team graph, including recurrence and confidential rows, while preserving multiply referenced Projects and Personal sources', async () => {
    const f = await rich(),
      other = await team(member);
    await join(f.p.id, member, 'ADMIN');
    await teams.reference(member.actor, other.id, f.p.id, undefined, true);
    const personal = await client.space.findFirstOrThrow({
        where: { kind: 'PERSONAL', ownerUserId: owner.actor.userId },
      }),
      personalId = randomUUID();
    await client.task.create({
      data: {
        id: personalId,
        spaceId: personal.id,
        createdByUserId: owner.actor.userId,
        title: 'Personal retained source',
      },
    });
    const projectBefore = await client.task.findUniqueOrThrow({
      where: { id: f.pt.id },
    });
    for (const who of [member, viewer, reviewer]) {
      const m = await seat(f.t.id, who);
      await service.changeMembership(owner.actor, f.t.id, m.id, m.revision, {
        state: 'REVOKED',
        memberRole: m.memberRole as MemberRole,
      });
    }
    await life.change(owner.actor, f.t.id, 1, 'delete', password);
    await elapsed(f.t.id);
    const passes = await drain(f.t.id);
    expect(passes).toBeGreaterThan(10);
    for (const table of [
      'Team',
      'TeamCase',
      'TeamCaseEntry',
      'TeamDisclosure',
      'TeamDisclosureRecipient',
      'TeamMeeting',
      'TeamMeetingInvitation',
      'TeamPlan',
      'TeamWorkItem',
      'TeamCapacityDay',
      'Task',
      'Goal',
      'CalendarEvent',
      'EventRecurrence',
    ]) {
      const result = await sandbox.query(
        `SELECT count(*)::int n FROM "${table}" WHERE "spaceId"=$1`,
        [f.t.id],
      );
      expect(result.rows[0].n).toBe(0);
    }
    expect(
      await client.task.findUniqueOrThrow({ where: { id: f.pt.id } }),
    ).toEqual(projectBefore);
    expect(
      (await client.task.findUniqueOrThrow({ where: { id: personalId } }))
        .spaceId,
    ).toBe(personal.id);
    expect(
      (await teams.projectList(member.actor, other.id, page)).items,
    ).toHaveLength(1);
    expect(
      await client.teamProjectReference.count({ where: { teamId: f.t.id } }),
    ).toBe(0);
    expect(
      (
        await client.sharedLifecycleJob.findFirstOrThrow({
          where: { custodyId: f.t.id },
          orderBy: { generation: 'desc' },
        })
      ).spaceId,
    ).toBeNull();
  });
  it('enforces retention holds and bounded operator release without making held Team content readable', async () => {
    const original = await client.sharedRetentionPolicy.findUniqueOrThrow({
        where: { version },
      }),
      held = 'held-' + randomUUID(),
      holdId = randomUUID();
    const configuration = {
      ...(original.configuration as Record<string, unknown>),
      policyVersion: held,
      holds: [
        {
          id: holdId,
          state: 'ACTIVE',
          nextReviewAt: new Date(Date.now() + 86400000).toISOString(),
          basis: 'synthetic',
          authority: 'synthetic operator',
          scope: 'Team fixture',
          releaseEvidence: null,
        },
      ],
    };
    await client.sharedRetentionPolicy.create({
      data: {
        version: held,
        approvalReference: original.approvalReference,
        configuration,
      },
    });
    const t = await teams.create(
        owner.actor,
        { id: randomUUID(), title: 'Held Team', retentionPolicyVersion: held },
        randomUUID(),
      ),
      s = await task(t.id);
    await life.change(owner.actor, t.id, 1, 'delete', password);
    await elapsed(t.id);
    await cleanup.consume();
    await cleanup.consume();
    const job = await life.job(owner.actor, t.id);
    expect(job.state).toBe('WAITING_OBLIGATIONS');
    expect(
      await client.task.findUnique({ where: { id: s.id } }),
    ).not.toBeNull();
    await expect(
      work.sourceRead(owner.actor, t.id, 'TASK', s.id),
    ).rejects.toHaveProperty('status', 404);
    await sharedLife.release(
      t.id,
      job.jobId,
      job.revision,
      holdId,
      'SYNTHETIC-OWNER-RELEASE',
    );
    await drain(t.id);
    expect(await client.team.findUnique({ where: { id: t.id } })).toBeNull();
  });
  it('fails closed on an unknown reference and resumes after its explicit fixture-only removal', async () => {
    const t = await team(),
      s = await task(t.id);
    await life.change(owner.actor, t.id, 1, 'delete', password);
    await elapsed(t.id);
    await sandbox.query(
      'CREATE TABLE "SyntheticUnknownTeamReference" (id uuid PRIMARY KEY,"teamId" uuid NOT NULL REFERENCES "Team"(id))',
    );
    await sandbox.query(
      'INSERT INTO "SyntheticUnknownTeamReference" VALUES($1,$2)',
      [randomUUID(), t.id],
    );
    try {
      await cleanup.consume();
      await cleanup.consume();
      const job = await client.sharedLifecycleJob.findFirstOrThrow({
        where: { custodyId: t.id },
        orderBy: { generation: 'desc' },
      });
      expect(job.attempts).toBeGreaterThan(0);
      expect(
        await client.task.findUnique({ where: { id: s.id } }),
      ).not.toBeNull();
    } finally {
      await sandbox.query('DROP TABLE "SyntheticUnknownTeamReference"');
    }
    await client.sharedLifecycleJob.updateMany({
      where: { spaceId: t.id },
      data: { nextAt: new Date(0), leaseUntil: null },
    });
    await drain(t.id);
    expect(await client.team.findUnique({ where: { id: t.id } })).toBeNull();
  });
  it('dispatches due Team jobs independently of Project jobs and survives abandoned leases', async () => {
    const t = await team();
    await life.change(owner.actor, t.id, 1, 'delete', password);
    const job = await elapsed(t.id);
    expect(await projectCleanup.consume()).toBe(false);
    expect((await sharedLife.next('TEAM'))!.id).toBe(job.id);
    await client.sharedLifecycleJob.update({
      where: { id: job.id },
      data: { leaseUntil: new Date(Date.now() + 120000) },
    });
    expect(await cleanup.consume()).toBe(false);
    await client.sharedLifecycleJob.update({
      where: { id: job.id },
      data: { leaseUntil: new Date(0) },
    });
    await drain(t.id);
  });
  it('RACE winning archive denies a waiting source mutation without late receipts', async () => {
    const t = await team();
    await join(t.id, member);
    const entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (r.action === 'team.archive' && r.outcome === 'INTENT') {
        entered.release();
        await release.promise;
      }
    });
    const archive = life.change(owner.actor, t.id, 1, 'archive');
    await entered.promise;
    const write = outcome(task(t.id, member));
    try {
      await blocked();
    } finally {
      release.release();
    }
    await archive;
    expect((await write).error).toBeDefined();
    expect(await client.task.count({ where: { spaceId: t.id } })).toBe(0);
  });
  it('RACE recovery wins before a waiting cleanup claim and preserves Team source data', async () => {
    const t = await team(),
      s = await task(t.id);
    await life.change(owner.actor, t.id, 1, 'delete', password);
    const job = await life.job(owner.actor, t.id),
      proof = await life.proof(owner.actor, t.id, job.revision, password);
    await client.sharedLifecycleJob.update({
      where: { id: job.jobId },
      data: { nextAt: new Date(0) },
    });
    const entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (r.action === 'lifecycle.recover' && r.outcome === 'INTENT') {
        entered.release();
        await release.promise;
      }
    });
    const recovery = life.recover(
      owner.actor,
      t.id,
      proof.revision,
      proof.generation,
      proof.proof,
      password,
    );
    await entered.promise;
    const purge = outcome(cleanup.consume());
    try {
      await blocked();
    } finally {
      release.release();
    }
    await recovery;
    await purge;
    expect((await teams.read(owner.actor, t.id)).state).toBe('ACTIVE');
    expect(
      await client.task.findUnique({ where: { id: s.id } }),
    ).not.toBeNull();
  });
  it('RACE winning purge claim rejects a waiting recovery at or after its deadline', async () => {
    const t = await team();
    await life.change(owner.actor, t.id, 1, 'delete', password);
    const job = await life.job(owner.actor, t.id),
      proof = await life.proof(owner.actor, t.id, job.revision, password);
    await elapsed(t.id);
    await cleanup.consume();
    const entered = barrier(),
      release = barrier(),
      purge = kernel.withPurge.bind(kernel);
    vi.spyOn(kernel, 'withPurge').mockImplementationOnce(
      (tx, space, jid, lease, users, body) =>
        purge(tx, space, jid, lease, users, async (s) => {
          const result = await body(s);
          entered.release();
          await release.promise;
          return result;
        }),
    );
    const claim = cleanup.consume();
    await entered.promise;
    const recover = outcome(
      life.recover(
        owner.actor,
        t.id,
        proof.revision,
        proof.generation,
        proof.proof,
        password,
      ),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    await claim;
    const denied = (await recover).error;
    // Atomic hard-link publication can briefly expose two names. The existing
    // integrity guard deliberately denies that read, rather than accepting it.
    if (denied?.message === 'Invalid shared staging artifact')
      expect(denied).toBeInstanceOf(Error);
    else expect(denied).toHaveProperty('status', 409);
    // Once publication has settled, the domain result must still be conflict.
    await expect(
      life.recover(
        owner.actor,
        t.id,
        proof.revision,
        proof.generation,
        proof.proof,
        password,
      ),
    ).rejects.toHaveProperty('status', 409);
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: t.id },
        })
      ).state,
    ).toBe('PURGING');
    expect((await seat(t.id)).state).toBe('LEFT');
    expect(
      (
        await client.sharedLifecycleJob.findUniqueOrThrow({
          where: { id: job.jobId },
        })
      ).recoveryHash,
    ).toBeNull();
  });
  it('allows an independent Team to make progress while another Team custody is locked', async () => {
    const first = await team(),
      second = await team(member);
    await observer.query('BEGIN');
    await observer.query(
      'SELECT "spaceId" FROM "SharedCustody" WHERE "spaceId"=$1 FOR UPDATE',
      [first.id],
    );
    const waiting = task(first.id);
    try {
      await blocked();
      expect((await task(second.id, member)).spaceId).toBe(second.id);
    } finally {
      await observer.query('COMMIT');
    }
    expect((await waiting).spaceId).toBe(first.id);
  });
  it('serializes competing handover proposals and rejects acceptance after the successor leaves', async () => {
    const t = await team(),
      m = await join(t.id, member),
      v = await join(t.id, viewer),
      entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (r.action === 'handover.propose' && r.outcome === 'INTENT') {
        entered.release();
        await release.promise;
      }
    });
    const first = life.handover(
      owner.actor,
      t.id,
      { successorAccessId: m.id },
      randomUUID(),
    );
    // Observe a custody lock waiter rather than relying on a scheduling delay.
    const winner = await Promise.race([
      first.then((value) => ({ value })),
      entered.promise.then(() => ({ value: undefined })),
    ]);
    if (winner.value)
      throw new Error('Expected signed handover intent before commit');
    const second = outcome(
      life.handover(
        owner.actor,
        t.id,
        { successorAccessId: v.id },
        randomUUID(),
      ),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    const p = await first;
    expect((await second).error).toHaveProperty('status', 409);
    await service.leave(member.actor, t.id, m.revision);
    await expect(
      life.decide(member.actor, t.id, p.id, 1, 'accept', password),
    ).rejects.toHaveProperty('status', 404);
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: t.id },
        })
      ).primaryOwnerAccessId,
    ).toBe((await seat(t.id)).id);
  });
  it('freezes owner-account closure with surviving members and permits independent Personal erasure while retaining Team attribution', async () => {
    const former = await person(),
      t = await team(former);
    await join(t.id, member, 'MEMBER', former);
    const source = await task(t.id, former),
      a = await seat(t.id, former);
    const spaces = app.get(SpacesService),
      personal = await spaces.authorizePersonal(former.actor);
    await client.$transaction((tx) => spaces.setClosed(tx, personal, true));
    await expect(
      work.sourceRead(member.actor, t.id, 'TASK', source.id),
    ).rejects.toHaveProperty('status', 403);
    await kernel.consumeExit();
    const job = await client.sharedLifecycleJob.findFirstOrThrow({
      where: { custodyId: t.id },
    });
    expect(job.state).toBe('OWNER_EXIT_FROZEN');
    await sharedLife.advance(
      await elapsed(t.id),
      [],
      async () => {
        throw new Error('Frozen custody must never enter destructive cleanup');
      },
      'TEAM',
    );
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: t.id },
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
      (await client.sharedActor.findUniqueOrThrow({ where: { id: a.actorId } }))
        .userId,
    ).toBeNull();
    expect(
      (await client.task.findUniqueOrThrow({ where: { id: source.id } }))
        .createdByActorId,
    ).toBe(a.actorId);
    expect(
      (
        await client.contextAccess.findUniqueOrThrow({
          where: { id: (await seat(t.id, member)).id },
        })
      ).memberRole,
    ).toBe('MEMBER');
  });
  it('resumes bounded Team task passes after interruption without deleting independent source roots', async () => {
    const t = await team(),
      a = await seat(t.id);
    await client.task.createMany({
      data: Array.from({ length: 401 }, () => ({
        id: randomUUID(),
        spaceId: t.id,
        scopeId: t.id,
        createdByActorId: a.actorId,
        title: 'Bounded cleanup source',
      })),
    });
    await life.change(owner.actor, t.id, 1, 'delete', password);
    await elapsed(t.id);
    for (let n = 0; n < 40; n++) {
      const job = await client.sharedLifecycleJob.findFirstOrThrow({
        where: { custodyId: t.id },
      });
      if ((job.progress as { stage?: string }).stage === 'TASKS') break;
      await cleanup.consume();
    }
    const before = await client.task.count({ where: { spaceId: t.id } });
    expect(before).toBe(401);
    let remaining = before;
    for (let n = 0; n < 20 && remaining === before; n++) {
      await cleanup.consume();
      remaining = await client.task.count({ where: { spaceId: t.id } });
    }
    expect(before - remaining).toBe(200);
    expect(remaining).toBe(201);
    await drain(t.id);
    expect(await client.task.count({ where: { spaceId: t.id } })).toBe(0);
  });
  it('measures bounded source pages and portfolio over 1000 authorized Team tasks without changing ownership or querying private data', async () => {
    const t = await team(),
      a = await seat(t.id);
    await client.task.createMany({
      data: Array.from({ length: 1000 }, () => ({
        id: randomUUID(),
        spaceId: t.id,
        scopeId: t.id,
        createdByActorId: a.actorId,
        title: 'Synthetic performance source',
      })),
    });
    const samples: number[] = [];
    for (let n = 0; n < 10; n++) {
      const start = performance.now();
      const result = await work.sourceList(owner.actor, t.id, 'TASK', {
        limit: 100,
      });
      expect(result.items).toHaveLength(100);
      samples.push(performance.now() - start);
    }
    const start = performance.now(),
      portfolio = c.TeamPortfolioSchema.parse(
        await analytics.analyze(owner.actor, t.id, q, 'portfolio'),
      ),
      portfolioMs = performance.now() - start;
    expect(portfolio.summary.taskCount).toBe(1000);
    expect(portfolio.summary.unknownEstimates).toBe(1000);
    const sorted = [...samples].sort((a, b) => a - b);
    fs.writeFileSync(
      '.tools/p3-05-performance.json',
      JSON.stringify(
        {
          environment: 'local PostgreSQL isolated schema',
          sourceTasks: 1000,
          pageSize: 100,
          samples: 10,
          pageP50Ms: sorted[4],
          pageP95Ms: sorted[9],
          portfolioMs,
          productionSlo: 'DEFERRED_NOT_CLAIMED',
        },
        null,
        2,
      ) + '\n',
    );
  });
});
