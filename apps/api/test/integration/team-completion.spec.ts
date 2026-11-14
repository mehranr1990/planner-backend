import { TeamWorkToolsService } from '../../src/modules/teams/application/team-work-tools.service.js';
import { TeamFilesService } from '../../src/modules/teams/application/team-files.service.js';
import { TeamOperationsService } from '../../src/modules/teams/application/team-operations.service.js';
import { TeamInsightsService } from '../../src/modules/teams/application/team-insights.service.js';
import { RetentionSelectionService } from '../../src/modules/spaces/application/retention-selection.service.js';
import { TeamAnalyticsService } from '../../src/modules/teams/public/index.js';
import { TeamCollaborationService } from '../../src/modules/teams/application/team-collaboration.service.js';
import { TeamPlanningService } from '../../src/modules/teams/application/team-planning.service.js';
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
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { DatabaseService } from '../../src/platform/database/database.service.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import { CollaborationService } from '../../src/modules/spaces/public/index.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { TeamWorkService } from '../../src/modules/teams/public/index.js';
import { TeamsService } from '../../src/modules/teams/public/index.js';
import type { MemberRole } from '../../src/modules/spaces/domain/shared-policy.js';

type Person = { actor: RequestActor; email: string; cookie: string };
describe('Team completion: settings, presence, check-ins, recognition, feedback and planning', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    client: PrismaClient,
    observer: Client,
    watcher: Client,
    service: CollaborationService,
    control: SharedControl,
    auth: AuthService,
    teams: TeamsService,
    work: TeamWorkService,
    collab: TeamCollaborationService,
    planning: TeamPlanningService;
  let reviewer: Person,
    owner: Person,
    member: Person,
    viewer: Person,
    outsider: Person,
    passwordHash: string;
  const password = 'synthetic-p202-password-123!',
    origin = 'http://localhost:3000',
    name = 'tcomp-' + randomUUID(),
    version = 'synthetic-tcomp-' + randomUUID();
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-TCOMP-ONLY',
      },
    });
    control = app.get(SharedControl);
    await control.initialize();
    service = app.get(CollaborationService);
    teams = app.get(TeamsService);
    work = app.get(TeamWorkService);
    collab = app.get(TeamCollaborationService);
    planning = app.get(TeamPlanningService);
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

  const page = { limit: 25 };
  const ref = (m: { id: string; generation: number }) => ({
    accessId: m.id,
    generation: m.generation,
  });
  const today = () => new Date().toISOString().slice(0, 10);
  async function crew() {
    const t = await team(),
      m = await join(t.id, member, 'MEMBER'),
      v = await join(t.id, viewer, 'VIEWER'),
      o = (await collab.myPresence(owner.actor, t.id)).member;
    return { t, m: ref(m), v: ref(v), o };
  }
  const settingsOn = async (id: string) => {
    const s = await collab.settings(owner.actor, id);
    return collab.patchSettings(owner.actor, id, s.revision, {
      statusEnabled: true,
      checkinsEnabled: true,
      checkinSchedule: {
        cadence: 'DAILY',
        opensTime: '00:00',
        closesTime: '00:00',
        timezone: 'UTC',
      },
    });
  };
  const plan = (
    id: string,
    kind: 'WEEK' | 'SPRINT',
    start: string,
    end: string,
  ) =>
    work.createPlan(
      owner.actor,
      id,
      {
        id: randomUUID(),
        kind,
        title: kind,
        startDate: start,
        endDate: end,
        timezone: 'UTC',
      },
      randomUUID(),
    );

  it('serves settings with explicit nulls, role-split writes, revisions and the active-sprint rule', async () => {
    const { t } = await crew();
    expect(await collab.settings(viewer.actor, t.id)).toMatchObject({
      planningMode: 'WEEKLY',
      checkinsEnabled: null,
      statusEnabled: null,
      checkinSchedule: null,
      revision: 1,
    });
    await expect(
      collab.patchSettings(member.actor, t.id, 1, { planningMode: 'SPRINTS' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      collab.patchSettings(owner.actor, t.id, 7, { planningMode: 'SPRINTS' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await collab.patchSettings(owner.actor, t.id, 1, {
        planningMode: 'SPRINTS',
        color: '#4F46E5',
      }),
    ).toMatchObject({ planningMode: 'SPRINTS', revision: 2 });
    const sprint = await plan(t.id, 'SPRINT', '2030-01-05', '2030-01-19');
    await work.patchPlan(owner.actor, t.id, sprint.id, 1, { state: 'ACTIVE' });
    const second = await plan(t.id, 'SPRINT', '2030-01-19', '2030-02-02');
    await expect(
      work.patchPlan(owner.actor, t.id, second.id, 1, { state: 'ACTIVE' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      collab.patchSettings(owner.actor, t.id, 2, { planningMode: 'WEEKLY' }),
    ).rejects.toMatchObject({ status: 409 });
    const summary = await planning.summary(member.actor, t.id, sprint.id);
    expect(summary.sprintNumber).toBe(1);
    expect(summary.publishedAt).not.toBeNull();
    const res = await request(app.getHttpServer())
      .get('/api/v1/teams/' + t.id + '/settings')
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(res.headers.etag).toBe('"2"');
    await expect(collab.settings(outsider.actor, t.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('keeps manual presence off until enabled, member-only and expiry-aware', async () => {
    const { t, m } = await crew();
    const none = {
      status: null,
      note: '',
      clearAfter: 'NEVER' as const,
      until: null,
    };
    await expect(
      collab.setPresence(member.actor, t.id, 1, { ...none, status: 'BUSY' }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await collab.presence(owner.actor, t.id, page)).items).toEqual([]);
    await settingsOn(t.id);
    await expect(
      collab.setPresence(viewer.actor, t.id, 1, { ...none, status: 'AWAY' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      collab.setPresence(member.actor, t.id, 1, {
        status: 'BUSY',
        note: 'x',
        clearAfter: 'HOUR',
        until: new Date(Date.now() + 5 * 3600000).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await collab.setPresence(member.actor, t.id, 1, {
        status: 'OFFLINE',
        note: 'Back Monday',
        clearAfter: 'HOUR',
        until: new Date(Date.now() + 1800000).toISOString(),
      }),
    ).toMatchObject({ status: 'OFFLINE', revision: 2, member: m });
    const list = await collab.presence(viewer.actor, t.id, page);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ member: m, note: 'Back Monday' });
    expect(await collab.setPresence(member.actor, t.id, 2, none)).toMatchObject(
      { status: null, revision: 3 },
    );
    expect((await collab.presence(viewer.actor, t.id, page)).items).toEqual([]);
  });

  it('runs manager-configured check-ins with Viewer read-only access and author-only late flags', async () => {
    const { t, m } = await crew();
    await expect(
      collab.checkinWeek(member.actor, t.id, today()),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      collab.patchSettings(member.actor, t.id, 1, { checkinsEnabled: true }),
    ).rejects.toMatchObject({ status: 403 });
    await settingsOn(t.id);
    await expect(
      collab.reply(viewer.actor, t.id, today(), 1, { kind: 'SKIP' }),
    ).rejects.toMatchObject({ status: 403 });
    const mine = await collab.reply(member.actor, t.id, today(), 1, {
      kind: 'ANSWER',
      did: 'Shipped login',
      next: 'Review',
      blocked: '',
    });
    expect(mine).toMatchObject({ state: 'SENT', late: false, member: m });
    await expect(
      collab.reply(member.actor, t.id, today(), 1, { kind: 'SKIP' }),
    ).rejects.toMatchObject({ status: 409 });
    const comment = await collab.comment(
      owner.actor,
      t.id,
      today(),
      mine.id,
      { id: randomUUID(), body: 'Nice' },
      randomUUID(),
    );
    const seen = await collab.checkinWeek(viewer.actor, t.id, today());
    expect(seen.status).toBe('OPEN');
    expect(seen.can).toEqual({ reply: false, comment: false });
    expect(seen.replies).toHaveLength(1);
    expect(seen.replies[0]!.late).toBeNull();
    expect(seen.replies[0]!.comments[0]!.id).toBe(comment.id);
    expect(seen.notYet.map((n) => n.member.accessId)).not.toContain(m.accessId);
    expect(
      (await collab.checkinWeek(member.actor, t.id, today())).mine.reply?.late,
    ).toBe(false);
    expect(
      await collab.checkinWeek(member.actor, t.id, '2000-01-01'),
    ).toMatchObject({ status: 'CLOSED' });
    await expect(
      collab.reply(member.actor, t.id, '2000-01-01', 1, { kind: 'SKIP' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('shows Team recognition to members only and private thanks to the parties', async () => {
    const { t, m } = await crew();
    const task = await work.createTask(
      owner.actor,
      t.id,
      { id: randomUUID(), title: 'Linked task', priority: 'NONE' },
      randomUUID(),
    );
    const give = (
      who: Person,
      visibility: 'TEAM' | 'PRIVATE',
      link: { kind: 'TASK'; id: string } | null = null,
    ) =>
      collab.give(
        who.actor,
        t.id,
        { id: randomUUID(), recipients: [m], body: 'Thanks', visibility, link },
        randomUUID(),
      );
    const open = await give(owner, 'TEAM', { kind: 'TASK', id: task.id });
    expect(open.link).toMatchObject({ title: 'Linked task' });
    const hidden = await give(owner, 'PRIVATE');
    await expect(give(member, 'TEAM')).rejects.toMatchObject({ status: 409 });
    await expect(give(viewer, 'TEAM')).rejects.toMatchObject({ status: 403 });
    expect(
      (await collab.thanks(viewer.actor, t.id, page)).items.map((x) => x.id),
    ).toEqual([open.id]);
    expect(
      (await collab.thanks(member.actor, t.id, page)).items.map((x) => x.id),
    ).toEqual(expect.arrayContaining([open.id, hidden.id]));
    await expect(
      collab.thanks(outsider.actor, t.id, page),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      collab.hide(viewer.actor, t.id, open.id, true),
    ).rejects.toMatchObject({ status: 403 });
    expect((await collab.hide(member.actor, t.id, open.id, true)).hidden).toBe(
      true,
    );
    expect((await collab.thanks(viewer.actor, t.id, page)).items).toEqual([]);
    await collab.hide(member.actor, t.id, open.id, false);
    await expect(
      collab.remove(member.actor, t.id, open.id),
    ).rejects.toMatchObject({ status: 403 });
    await collab.remove(owner.actor, t.id, open.id);
    expect((await collab.thanks(viewer.actor, t.id, page)).items).toEqual([]);
  });

  it('keeps 1:1 feedback private from Owners and Admins', async () => {
    const { t, m } = await crew();
    const lead = ref(await join(t.id, reviewer, 'LEAD'));
    const asked = await collab.requestFeedback(
      member.actor,
      t.id,
      {
        id: randomUUID(),
        asked: lead,
        about: 'Onboarding flow',
        question: 'What would you cut?',
      },
      randomUUID(),
    );
    const answer = (requestId: string) =>
      collab.writeFeedback(
        reviewer.actor,
        t.id,
        {
          id: randomUUID(),
          recipient: m,
          about: 'Onboarding flow',
          body: 'Cut step three',
          requestId,
        },
        randomUUID(),
      );
    const note = await answer(asked.id);
    await expect(answer(asked.id)).rejects.toMatchObject({ status: 409 });
    const inbox = await collab.feedback(member.actor, t.id);
    expect(inbox.received.map((n) => n.id)).toEqual([note.id]);
    expect(inbox.requested[0]!.status).toBe('ANSWERED');
    expect(await collab.feedback(owner.actor, t.id)).toEqual({
      asked: [],
      requested: [],
      received: [],
      sent: [],
    });
  });

  it('plans Team tasks with board states, estimates, focus, carry-over, backlog order and activity', async () => {
    const { t } = await crew();
    const task = await work.createTask(
      member.actor,
      t.id,
      { id: randomUUID(), title: 'Plan me', priority: 'HIGH' },
      randomUUID(),
    );
    const blocked = await planning.setBoardState(
      member.actor,
      t.id,
      task.id,
      task.revision,
      { state: 'BLOCKED' },
    );
    expect(blocked.boardState).toBe('BLOCKED');
    await expect(
      planning.setBoardState(member.actor, t.id, task.id, task.revision, {
        state: 'REVIEW',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      planning.setBoardState(
        viewer.actor,
        t.id,
        task.id,
        blocked.task.revision,
        { state: 'REVIEW' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    const review = await planning.setBoardState(
      member.actor,
      t.id,
      task.id,
      blocked.task.revision,
      { state: 'REVIEW' },
    );
    expect(review).toMatchObject({
      boardState: 'REVIEW',
      task: { status: 'IN_PROGRESS' },
    });
    const est = await planning.setEstimate(
      member.actor,
      t.id,
      task.id,
      review.task.revision,
      { estimatedMinutes: 90 },
    );
    expect(est.estimatedMinutes).toBe(90);
    const week = await plan(t.id, 'WEEK', '2030-01-05', '2030-01-12');
    const nextWeek = await plan(t.id, 'WEEK', '2030-01-12', '2030-01-19');
    const item = await work.createItem(
      owner.actor,
      t.id,
      {
        id: randomUUID(),
        target: { kind: 'TASK', spaceId: task.spaceId, id: task.id },
        sourceRevision: est.task.revision,
        planId: week.id,
        position: 0,
      },
      randomUUID(),
    );
    await expect(
      planning.setPlanning(member.actor, t.id, week.id, 1, { focus: ['Ship'] }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      planning.setPlanning(owner.actor, t.id, week.id, 1, { goal: 'x' }),
    ).rejects.toMatchObject({ status: 400 });
    const focused = await planning.setPlanning(owner.actor, t.id, week.id, 1, {
      focus: ['Ship login'],
    });
    expect(focused).toMatchObject({
      focus: ['Ship login'],
      planned: 1,
      review: 1,
      plannedMinutes: 90,
      unknownEstimates: 0,
    });
    expect(focused.days).toHaveLength(7);
    expect(
      (await planning.taskPlanning(viewer.actor, t.id, page)).items[0],
    ).toMatchObject({
      boardState: 'REVIEW',
      estimatedMinutes: 90,
      items: [{ id: item.id, planId: week.id }],
    });
    expect(
      await planning.carryOver(
        owner.actor,
        t.id,
        week.id,
        item.id,
        item.revision,
        {
          decision: 'NEXT',
          targetPlanId: nextWeek.id,
          sourceRevision: est.task.revision,
        },
      ),
    ).toMatchObject({ planned: 0, carriedOut: { toPlan: 1, toBacklog: 0 } });
    expect(
      (await planning.summary(member.actor, t.id, nextWeek.id)).carriedIn,
    ).toBe(1);
    const moved = await work.items(owner.actor, t.id, {
      limit: 25,
      planId: nextWeek.id,
    });
    await planning.carryOver(
      owner.actor,
      t.id,
      nextWeek.id,
      item.id,
      moved.items[0]!.revision,
      {
        decision: 'BACKLOG',
        targetPlanId: null,
        sourceRevision: est.task.revision,
      },
    );
    const backlog = await work.items(owner.actor, t.id, {
      limit: 25,
      planId: 'BACKLOG',
    });
    const order = {
      items: [{ id: item.id, revision: backlog.items[0]!.revision }],
    };
    expect(
      (await planning.backlogOrder(owner.actor, t.id, order)).items[0],
    ).toMatchObject({ id: item.id, position: 0 });
    await expect(
      planning.backlogOrder(owner.actor, t.id, order),
    ).rejects.toMatchObject({ status: 409 });
    const activity = await collab.activity(viewer.actor, t.id, 10);
    expect(activity.items.map((a) => a.kind)).toEqual(
      expect.arrayContaining(['CREATED', 'MOVED']),
    );
    expect(activity.items.every((a) => a.taskId === task.id)).toBe(true);
  });

  it('TA: assigns with explicit consent, history, reassignment, reminders and projections', async () => {
    const ops = app.get(TeamOperationsService);
    const { t, m, v, o } = await crew();
    const task = await work.createTask(
      owner.actor,
      t.id,
      { id: randomUUID(), title: 'Assigned', priority: 'NONE' },
      randomUUID(),
    );
    await expect(
      ops.assign(
        owner.actor,
        t.id,
        task.id,
        { id: randomUUID(), assignee: v },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      ops.assign(
        member.actor,
        t.id,
        task.id,
        { id: randomUUID(), assignee: o },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    const key = randomUUID(),
      input = { id: randomUUID(), assignee: m };
    const a = await ops.assign(owner.actor, t.id, task.id, input, key);
    expect(a).toMatchObject({ state: 'PENDING', revision: 1 });
    expect(
      await ops.assign(owner.actor, t.id, task.id, input, key),
    ).toMatchObject({ id: a.id });
    await expect(
      ops.assign(
        owner.actor,
        t.id,
        task.id,
        { id: randomUUID(), assignee: m },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await ops.notifications(member.actor, t.id, page)).items.map(
        (n) => n.kind,
      ),
    ).toContain('ASSIGNMENT');
    expect(
      (await ops.myWork(member.actor, t.id)).pending[0]!.assignment.id,
    ).toBe(a.id);
    await expect(
      ops.respond(owner.actor, t.id, a.id, 1, 'accept'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      ops.respond(member.actor, t.id, a.id, 9, 'accept'),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await ops.respond(member.actor, t.id, a.id, 1, 'accept'),
    ).toMatchObject({
      state: 'ACCEPTED',
      revision: 2,
    });
    await planning.setBoardState(member.actor, t.id, task.id, task.revision, {
      state: 'IN_PROGRESS',
    });
    expect((await ops.nowWorking(viewer.actor, t.id)).items).toEqual([
      { member: m, tasks: [{ sourceId: task.id, title: 'Assigned' }] },
    ]);
    expect(await ops.remind(owner.actor, t.id, a.id)).toEqual({ delivered: 1 });
    expect(await ops.remind(owner.actor, t.id, a.id)).toEqual({ delivered: 0 });
    await expect(ops.remind(member.actor, t.id, a.id)).rejects.toMatchObject({
      status: 403,
    });
    const r = await ops.reassign(owner.actor, t.id, a.id, 2, {
      id: randomUUID(),
      assignee: o,
    });
    expect(r.previous).toMatchObject({
      state: 'REMOVED',
      endReason: 'REASSIGNED',
    });
    expect(r.current).toMatchObject({ state: 'ACCEPTED', assignee: o });
    expect(
      (await ops.assignmentHistory(viewer.actor, t.id, a.id, page)).items.map(
        (h) => h.action,
      ),
    ).toEqual(
      expect.arrayContaining([
        'ASSIGNED',
        'ACCEPTED',
        'REMINDED',
        'REASSIGNED',
      ]),
    );
    const second = await work.createTask(
      owner.actor,
      t.id,
      { id: randomUUID(), title: 'Declined', priority: 'NONE' },
      randomUUID(),
    );
    const d = await ops.assign(
      owner.actor,
      t.id,
      second.id,
      { id: randomUUID(), assignee: m },
      randomUUID(),
    );
    expect(
      await ops.respond(member.actor, t.id, d.id, 1, 'decline', {
        reason: 'Busy',
      }),
    ).toMatchObject({ state: 'DECLINED', declineReason: 'Busy' });
    expect(
      (
        await ops.assignments(viewer.actor, t.id, {
          limit: 25,
          taskId: second.id,
        })
      ).items[0]!.declineReason,
    ).toBeNull();
    expect(
      await ops.assign(
        member.actor,
        t.id,
        second.id,
        { id: randomUUID(), assignee: m },
        randomUUID(),
      ),
    ).toMatchObject({ state: 'ACCEPTED' });
    expect(
      await ops.removalPreview(owner.actor, t.id, m.accessId),
    ).toMatchObject({
      openAssignments: 1,
      pendingAssignments: 0,
    });
    await expect(
      ops.removalPreview(member.actor, t.id, m.accessId),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      ops.assignments(outsider.actor, t.id, page),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('SP/TO/CA: points stay separate from estimates; time off is private and reduces known capacity only', async () => {
    const ops = app.get(TeamOperationsService),
      insights = app.get(TeamInsightsService),
      analytics = app.get(TeamAnalyticsService);
    const { t, m } = await crew();
    const task = await work.createTask(
      owner.actor,
      t.id,
      { id: randomUUID(), title: 'Pointed', priority: 'NONE' },
      randomUUID(),
    );
    expect(
      await ops.setPoints(member.actor, t.id, task.id, 1, { points: 5 }),
    ).toMatchObject({
      points: 5,
      revision: 2,
    });
    await expect(
      ops.setPoints(member.actor, t.id, task.id, 1, { points: 3 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      ops.setPoints(viewer.actor, t.id, task.id, 2, { points: 3 }),
    ).rejects.toMatchObject({ status: 403 });
    const week = await plan(t.id, 'WEEK', '2030-01-05', '2030-01-12');
    await work.createItem(
      owner.actor,
      t.id,
      {
        id: randomUUID(),
        target: { kind: 'TASK', spaceId: task.spaceId, id: task.id },
        sourceRevision: task.revision,
        planId: week.id,
        position: 0,
      },
      randomUUID(),
    );
    expect(await ops.planPoints(viewer.actor, t.id, week.id)).toMatchObject({
      plannedPoints: 5,
      completedPoints: 0,
      plannedTasks: 1,
      unestimatedTasks: 0,
    });
    const off = await ops.requestTimeOff(
      member.actor,
      t.id,
      {
        id: randomUUID(),
        startDate: '2030-01-07',
        endDate: '2030-01-07',
        minutesPerDay: null,
        reason: 'Private',
      },
      randomUUID(),
    );
    await expect(
      ops.requestTimeOff(
        member.actor,
        t.id,
        {
          id: randomUUID(),
          startDate: '2030-01-06',
          endDate: '2030-01-08',
          minutesPerDay: null,
          reason: null,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await ops.timeOff(viewer.actor, t.id, { limit: 25 })).items,
    ).toEqual([]);
    expect(
      (await ops.timeOff(owner.actor, t.id, { limit: 25 })).items[0],
    ).toMatchObject({ reason: 'Private' });
    await expect(
      ops.decideTimeOff(member.actor, t.id, off.id, 1, {
        decision: 'APPROVE',
        note: null,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await ops.decideTimeOff(owner.actor, t.id, off.id, 1, {
        decision: 'APPROVE',
        note: null,
      }),
    ).toMatchObject({ state: 'APPROVED', revision: 2 });
    expect(
      (await ops.timeOffHistory(member.actor, t.id, off.id, page)).items.map(
        (e) => e.action,
      ),
    ).toEqual(expect.arrayContaining(['SUBMITTED', 'APPROVED']));
    for (const date of ['2030-01-07', '2030-01-08'])
      await analytics.capacity(
        owner.actor,
        t.id,
        {
          id: randomUUID(),
          member: m,
          date,
          timezone: 'UTC',
          availableMinutes: 480,
        },
        undefined,
        randomUUID(),
      );
    const summary = await insights.capacitySummary(owner.actor, t.id, {
      from: '2030-01-07',
      to: '2030-01-09',
      timezone: 'UTC',
    });
    const row = summary.members.find((r) => r.member.accessId === m.accessId)!;
    expect(row.days[0]).toMatchObject({
      availableMinutes: 480,
      timeOffMinutes: 480,
      netAvailableMinutes: 0,
    });
    expect(row.days[1]).toMatchObject({
      availableMinutes: 480,
      netAvailableMinutes: 480,
    });
    expect(row.days[2]).toMatchObject({
      availableMinutes: null,
      netAvailableMinutes: null,
    });
    expect(row.totals).toMatchObject({
      unknownDays: 1,
      bookedBasisPoints: null,
    });
    const mine = await insights.capacitySummary(viewer.actor, t.id, {
      from: '2030-01-07',
      to: '2030-01-07',
      timezone: 'UTC',
    });
    expect(mine.members).toHaveLength(1);
    expect(mine.members[0]!.member.accessId).not.toBe(m.accessId);
  });

  it('GL/AN/RM: key results, pace, analytics and idempotent check-in reminders', async () => {
    const ops = app.get(TeamOperationsService),
      insights = app.get(TeamInsightsService);
    const { t, m } = await crew();
    const goal = await work.createGoal(
      owner.actor,
      t.id,
      {
        id: randomUUID(),
        title: 'Grow',
        horizon: 'SHORT_TERM',
        timezone: 'UTC',
      },
      randomUUID(),
    );
    const period = await ops.setGoalPeriod(
      owner.actor,
      t.id,
      goal.id,
      goal.revision,
      {
        startDate: '2020-01-01',
        targetDate: '2020-01-10',
      },
    );
    const kr = await ops.createKeyResult(
      owner.actor,
      t.id,
      goal.id,
      {
        id: randomUUID(),
        title: 'Signups',
        unit: null,
        source: 'MANUAL',
        startValue: '0',
        targetValue: '10',
      },
      randomUUID(),
    );
    expect(kr.progress).toBeNull();
    await expect(
      ops.createKeyResult(
        member.actor,
        t.id,
        goal.id,
        {
          id: randomUUID(),
          title: 'x',
          unit: null,
          source: 'MANUAL',
          startValue: '0',
          targetValue: '1',
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await ops.keyResults(viewer.actor, t.id, goal.id)).toMatchObject({
      progress: null,
      expectedProgress: 10000,
      pace: null,
    });
    await ops.recordKeyResult(
      member.actor,
      t.id,
      goal.id,
      kr.id,
      { id: randomUUID(), value: '5', note: null },
      randomUUID(),
    );
    const task = await work.createTask(
      owner.actor,
      t.id,
      { id: randomUUID(), title: 'Linked', priority: 'NONE' },
      randomUUID(),
    );
    await work.linkGoalTask(
      owner.actor,
      t.id,
      goal.id,
      task.id,
      period.revision,
    );
    await ops.createKeyResult(
      owner.actor,
      t.id,
      goal.id,
      {
        id: randomUUID(),
        title: 'Tasks',
        unit: null,
        source: 'TASKS',
        startValue: '0',
        targetValue: '2',
      },
      randomUUID(),
    );
    const started = await planning.setBoardState(
      owner.actor,
      t.id,
      task.id,
      task.revision,
      { state: 'IN_PROGRESS' },
    );
    await planning.setBoardState(
      owner.actor,
      t.id,
      task.id,
      started.task.revision,
      { state: 'DONE' },
    );
    const view = await ops.keyResults(member.actor, t.id, goal.id);
    expect(
      view.items.map((i) => [i.source, i.currentValue, i.progress]),
    ).toEqual(
      expect.arrayContaining([
        ['MANUAL', '5', 5000],
        ['TASKS', '1', 5000],
      ]),
    );
    expect(view).toMatchObject({ progress: 5000, pace: 'BEHIND' });
    const window = {
      from: new Date(Date.now() - 86400000).toISOString(),
      to: new Date(Date.now() + 86400000).toISOString(),
    };
    expect(await insights.cycleTime(viewer.actor, t.id, window)).toMatchObject({
      completedTasks: 1,
      measuredTasks: 1,
    });
    expect(
      await insights.estimateAccuracy(viewer.actor, t.id, window),
    ).toMatchObject({
      completedTasks: 1,
      measuredTasks: 0,
      medianRatio: null,
    });
    expect(await insights.projectSummaries(owner.actor, t.id, page)).toEqual({
      items: [],
      nextCursor: null,
    });
    await settingsOn(t.id);
    await expect(
      ops.remindCheckin(member.actor, t.id, today()),
    ).rejects.toMatchObject({ status: 403 });
    expect(await ops.remindCheckin(owner.actor, t.id, today())).toEqual({
      delivered: 1,
    });
    expect(await ops.remindCheckin(owner.actor, t.id, today())).toEqual({
      delivered: 0,
    });
    const rs = await ops.reminderSettings(owner.actor, t.id);
    await ops.setReminderSettings(owner.actor, t.id, rs.revision, {
      checkinReminderMinutes: 1440,
    });
    const inbox = await ops.notifications(member.actor, t.id, page);
    expect(
      inbox.items.filter((n) => n.kind === 'CHECKIN_REMINDER'),
    ).toHaveLength(1);
    expect(
      (await ops.readNotification(member.actor, t.id, inbox.items[0]!.id))
        .readAt,
    ).not.toBeNull();
    await expect(
      collab.give(
        owner.actor,
        t.id,
        {
          id: randomUUID(),
          recipients: [m],
          body: 'x',
          visibility: 'TEAM',
          link: null,
          projectId: randomUUID(),
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('R1/R2 retention only grows by comparable catalog policies; OD-4 proofs rotate in-app for the recipient', async () => {
    const retention = app.get(RetentionSelectionService);
    const t = await team();
    await join(t.id, member, 'MEMBER');
    expect(
      (await retention.catalog({ context: 'TEAM' })).items.map(
        (p) => p.version,
      ),
    ).toContain(version);
    const current = await retention.current(owner.actor, t.id);
    expect(current).toMatchObject({
      kind: 'TEAM',
      canChange: true,
      policy: { version },
    });
    expect((await retention.current(member.actor, t.id)).canChange).toBe(false);
    const longer = version + '-longer',
      rule = {
        retainAfterClosureSeconds: 3600,
        audience: ['OWNER', 'ADMIN'],
        exportAuthority: ['OWNER'],
        disposalAction: 'PURGE',
      };
    const base = (
      await client.sharedRetentionPolicy.findUniqueOrThrow({
        where: { version },
      })
    ).configuration as Record<string, unknown>;
    await client.sharedRetentionPolicy.create({
      data: {
        version: longer,
        approvalReference: 'SYNTHETIC-ONLY',
        configuration: {
          ...base,
          policyVersion: longer,
          classRules: {
            workContent: rule,
            commentsHistory: rule,
            filesDerivatives: rule,
            exports: rule,
            accessAuditLifecycle: rule,
          },
        },
      },
    });
    await expect(
      retention.change(member.actor, t.id, current.revision, {
        policyVersion: longer,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      retention.change(owner.actor, t.id, current.revision + 5, {
        policyVersion: longer,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const changed = await retention.change(
      owner.actor,
      t.id,
      current.revision,
      { policyVersion: longer },
    );
    expect(changed).toMatchObject({ policy: { version: longer } });
    expect(changed.revision).toBeGreaterThan(current.revision);
    expect((await retention.current(owner.actor, t.id)).revision).toBe(
      changed.revision,
    );
    await expect(
      retention.change(owner.actor, t.id, changed.revision, {
        policyVersion: version,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'RETENTION_SHORTENING_FORBIDDEN' },
    });
    const other = await team();
    const offered = await invite(other.id, viewer, 'MEMBER');
    expect(
      (await service.pendingOffers(viewer.actor, 'TEAM', page)).items.map(
        (i) => i.id,
      ),
    ).toContain(offered.invitation.id);
    await expect(
      service.issueRecipientProof(
        outsider.actor,
        'TEAM',
        offered.invitation.id,
        1,
      ),
    ).rejects.toMatchObject({ status: 404 });
    const issued = await service.issueRecipientProof(
      viewer.actor,
      'TEAM',
      offered.invitation.id,
      1,
    );
    expect(issued.revision).toBe(2);
    await expect(
      service.decideInvitation(
        viewer.actor,
        offered.invitation.id,
        offered.proof!,
        2,
        true,
        'TEAM',
      ),
    ).rejects.toMatchObject({ status: 404 });
    const accepted = await service.decideInvitation(
      viewer.actor,
      offered.invitation.id,
      issued.proof,
      2,
      true,
      'TEAM',
    );
    expect('membership' in accepted).toBe(true);
    await expect(
      service.issueRecipientProof(
        viewer.actor,
        'TEAM',
        offered.invitation.id,
        3,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('TM-11: private Team folders and versioned files with member uploads, authorized downloads and owner/manager removal', async () => {
    const files = app.get(TeamFilesService);
    const { t } = await crew();
    const bytes = Buffer.from('Team library fixture'),
      sha256 = createHash('sha256').update(bytes).digest('hex'),
      upload = {
        filename: 'notes.txt',
        mimeType: 'text/plain' as const,
        expectedSize: bytes.length,
        sha256,
      };
    await expect(
      files.createFolder(
        viewer.actor,
        t.id,
        { id: randomUUID(), parentId: null, title: 'x' },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    const folder = await files.createFolder(
      member.actor,
      t.id,
      { id: randomUUID(), parentId: null, title: 'Specs' },
      randomUUID(),
    );
    expect(folder.can).toEqual({ rename: true, remove: true });
    const key = randomUUID(),
      input = {
        id: randomUUID(),
        versionId: randomUUID(),
        folderId: folder.id,
        title: 'Notes',
        upload,
      };
    const file = await files.create(member.actor, t.id, input, key);
    expect(await files.create(member.actor, t.id, input, key)).toMatchObject({
      id: file.id,
    });
    expect(file).toMatchObject({
      current: null,
      latest: { status: 'INITIATED', number: 1 },
      versionCount: 1,
    });
    const base =
      '/api/v1/teams/' +
      t.id +
      '/files/' +
      file.id +
      '/versions/' +
      input.versionId;
    await request(app.getHttpServer())
      .post(base + '/complete')
      .set('Origin', origin)
      .set('Cookie', owner.cookie)
      .set('If-Match', '"' + file.latest!.revision + '"')
      .set('Content-Type', 'application/octet-stream')
      .send(bytes)
      .expect(403);
    const done = await request(app.getHttpServer())
      .post(base + '/complete')
      .set('Origin', origin)
      .set('Cookie', member.cookie)
      .set('If-Match', '"' + file.latest!.revision + '"')
      .set('Content-Type', 'application/octet-stream')
      .send(bytes)
      .expect(200);
    expect(done.body).toMatchObject({
      status: 'READY',
      size: bytes.length,
      sha256,
    });
    const got = await request(app.getHttpServer())
      .get(base + '/download')
      .set('Cookie', viewer.cookie)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(got.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(got.body as Buffer, bytes)).toBe(0);
    await expect(
      files.read(outsider.actor, t.id, file.id),
    ).rejects.toMatchObject({ status: 404 });
    const listed = await files.list(viewer.actor, t.id, {
      limit: 25,
      folderId: folder.id,
    });
    expect(listed.items[0]).toMatchObject({
      id: file.id,
      current: { number: 1 },
      can: { remove: false },
    });
    await expect(
      files.createVersion(
        viewer.actor,
        t.id,
        file.id,
        { id: randomUUID(), upload },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    const v2 = await files.createVersion(
      member.actor,
      t.id,
      file.id,
      { id: randomUUID(), upload },
      randomUUID(),
    );
    expect(v2).toMatchObject({ number: 2, status: 'INITIATED' });
    const current = await files.read(owner.actor, t.id, file.id);
    expect(current).toMatchObject({
      current: { number: 1 },
      latest: { number: 2 },
      can: { edit: true },
    });
    const renamed = await files.patch(
      owner.actor,
      t.id,
      file.id,
      current.revision,
      { title: 'Renamed' },
    );
    expect(renamed.title).toBe('Renamed');
    await expect(
      files.patch(member.actor, t.id, file.id, current.revision, {
        title: 'Stale',
      }),
    ).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      files.removeFolder(member.actor, t.id, folder.id, folder.revision),
    ).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      files.remove(viewer.actor, t.id, file.id, renamed.revision),
    ).rejects.toMatchObject({ status: 403 });
    const removed = await files.remove(
      member.actor,
      t.id,
      file.id,
      renamed.revision,
    );
    expect(removed).toMatchObject({ removed: true, can: { remove: false } });
    expect((await files.list(owner.actor, t.id, { limit: 25 })).items).toEqual(
      [],
    );
    await request(app.getHttpServer())
      .get(base + '/download')
      .set('Cookie', member.cookie)
      .expect(404);
    const stored = await client.storedFile.findMany({
      where: { id: { in: [input.versionId, v2.id] } },
    });
    expect(
      stored.every((f) => f.status === 'DELETED' && f.purgedAt !== null),
    ).toBe(true);
    expect(
      await files.removeFolder(member.actor, t.id, folder.id, folder.revision),
    ).toEqual({
      id: folder.id,
      removed: true,
    });
  });

  it('Team checklists, dependencies, readiness and the manager export snapshot', async () => {
    const tools = app.get(TeamWorkToolsService);
    const { t } = await crew();
    const make = (title: string) =>
      work.createTask(
        member.actor,
        t.id,
        { id: randomUUID(), title, priority: 'NONE' },
        randomUUID(),
      );
    const first = await make('Draft'),
      second = await make('Review');
    const empty = await tools.checklist(member.actor, t.id, first.id);
    expect(empty).toMatchObject({ taskId: first.id, items: [], done: 0 });
    const itemA = randomUUID(),
      itemB = randomUUID();
    const one = await tools.changeChecklist(
      member.actor,
      t.id,
      first.id,
      empty.revision,
      {
        kind: 'ADD',
        id: itemA,
        title: 'Outline',
      },
    );
    await expect(
      tools.changeChecklist(member.actor, t.id, first.id, empty.revision, {
        kind: 'ADD',
        id: itemB,
        title: 'Stale',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      tools.changeChecklist(viewer.actor, t.id, first.id, one.revision, {
        kind: 'ADD',
        id: itemB,
        title: 'Viewer',
      }),
    ).rejects.toMatchObject({ status: 403 });
    const two = await tools.changeChecklist(
      member.actor,
      t.id,
      first.id,
      one.revision,
      {
        kind: 'ADD',
        id: itemB,
        title: 'Proofread',
      },
    );
    const done = await tools.changeChecklist(
      member.actor,
      t.id,
      first.id,
      two.revision,
      {
        kind: 'UPDATE',
        id: itemB,
        completed: true,
      },
    );
    const ordered = await tools.changeChecklist(
      member.actor,
      t.id,
      first.id,
      done.revision,
      {
        kind: 'REORDER',
        ids: [itemB, itemA],
      },
    );
    expect(ordered.items.map((i) => [i.id, i.completed, i.position])).toEqual([
      [itemB, true, 0],
      [itemA, false, 1],
    ]);
    expect(ordered.done).toBe(1);
    expect(
      (await tools.checklist(viewer.actor, t.id, first.id)).items,
    ).toHaveLength(2);
    await expect(
      tools.checklist(outsider.actor, t.id, first.id),
    ).rejects.toMatchObject({
      status: 404,
    });
    const edge = {
      id: randomUUID(),
      predecessorId: first.id,
      successorId: second.id,
      kind: 'FS' as const,
      lagMinutes: 0,
    };
    await expect(
      tools.addDependency(member.actor, t.id, edge),
    ).rejects.toMatchObject({ status: 403 });
    const dep = await tools.addDependency(owner.actor, t.id, edge);
    expect(dep).toMatchObject({
      predecessorId: first.id,
      successorId: second.id,
    });
    await expect(
      tools.addDependency(owner.actor, t.id, {
        ...edge,
        id: randomUUID(),
        predecessorId: second.id,
        successorId: first.id,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await tools.dependencies(viewer.actor, t.id)).edges).toHaveLength(
      1,
    );
    const ready = await tools.readiness(member.actor, t.id);
    expect(ready.items.find((i) => i.taskId === second.id)).toMatchObject({
      blockedBy: [first.id],
      ready: false,
    });
    expect(ready.items.find((i) => i.taskId === first.id)).toMatchObject({
      ready: true,
    });
    await expect(
      tools.exportSnapshot(member.actor, t.id),
    ).rejects.toMatchObject({ status: 403 });
    const snapshot = await tools.exportSnapshot(owner.actor, t.id);
    expect(snapshot.teamId).toBe(t.id);
    expect(snapshot.tasks.find((x) => x.id === first.id)).toMatchObject({
      checklist: { done: 1, total: 2 },
    });
    expect(snapshot.tasks.find((x) => x.id === second.id)?.blockedBy).toEqual([
      first.id,
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('passwordHash');
    const retired = await tools.retireDependency(
      owner.actor,
      t.id,
      dep.id,
      dep.revision,
    );
    expect(retired.retiredAt).not.toBeNull();
    expect(
      (await tools.readiness(member.actor, t.id)).items.find(
        (i) => i.taskId === second.id,
      ),
    ).toMatchObject({ blockedBy: [], ready: true });
  });
});
