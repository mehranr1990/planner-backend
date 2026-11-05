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
import request from 'supertest';
import { PrismaPg } from '@prisma/adapter-pg';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import {
  SharedKernel,
  CollaborationService,
  ResourceGrants,
  SharedFeaturePolicy,
} from '../../src/modules/spaces/public/index.js';
import { SharedTasks } from '../../src/modules/tasks/public/index.js';
import {
  ProjectsService,
  ProjectToolsService,
  ProjectRegisterService,
  ProjectPlansService,
  ProjectWorkMetricsService,
  WorkService,
} from '../../src/modules/projects/public/index.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import * as c from '@mehran/api-contracts';
type Person = { actor: RequestActor; cookie: string };
describe('P2-06 risk register, safe plans and explicit shared work', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    db: PrismaClient,
    projects: ProjectsService,
    register: ProjectRegisterService,
    plans: ProjectPlansService,
    metrics: ProjectWorkMetricsService,
    tools: ProjectToolsService,
    work: WorkService,
    collaboration: CollaborationService,
    kernel: SharedKernel,
    grants: ResourceGrants,
    source: SharedTasks;
  let owner: Person, member: Person, viewer: Person, outsider: Person;
  const policy = 'synthetic-p206-' + randomUUID(),
    origin = 'http://localhost:3000',
    application = 'p206-' + randomUUID();
  async function person(cookie = false): Promise<Person> {
    const userId = randomUUID(),
      sessionId = randomUUID(),
      email = userId + '@example.test';
    await db.user.create({
      data: { id: userId, name: 'Synthetic P206', email, emailVerified: true },
    });
    await db.space.create({
      data: { id: randomUUID(), kind: 'PERSONAL', ownerUserId: userId },
    });
    await db.userSettings.create({ data: { userId } });
    await db.authSession.create({
      data: {
        id: sessionId,
        userId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const actor = {
      userId,
      sessionId,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    };
    if (!cookie) return { actor, cookie: '' };
    const auth = app.get(AuthService),
      password = 'synthetic-p206-password-123!';
    await db.authAccount.create({
      data: {
        id: randomUUID(),
        userId,
        accountId: userId,
        providerId: 'credential',
        password: await (await auth.auth.$context).password.hash(password),
      },
    });
    const response = await request(app.getHttpServer())
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', origin)
        .send({ email, password })
        .expect(200),
      current = await db.authSession.findFirstOrThrow({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
    return {
      actor: { ...actor, sessionId: current.id },
      cookie: (response.headers['set-cookie'] as unknown as string[])
        .map((s) => s.split(';')[0])
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
      throw new Error('Owned P206 schema replay failed');
    const schema = new URL(sandbox.url).searchParams.get('schema')!,
      base = isolatedTestDatabaseUrl(process.env);
    db = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: base,
          options: '-c search_path=' + schema,
          max: 8,
          application_name: application,
        },
        { schema },
      ),
    });
    const root = fs.mkdtempSync(path.resolve('.tools/p206-'));
    app = await testApplication({
      databaseUrl: base,
      databaseInstance: {
        client: db,
        checkConnection: async () => {
          await db.$queryRaw`SELECT 1`;
        },
        onApplicationShutdown: () => db.$disconnect(),
      },
      environment: {
        STORAGE_ROOT: path.join(root, 'files'),
        SHARED_CONTROL_ROOT: path.join(root, 'control'),
        SHARED_CONTROL_KEYS: JSON.stringify({
          k1: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'k1',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P206-ONLY',
      },
    });
    await app.get(SharedControl).initialize();
    projects = app.get(ProjectsService);
    register = app.get(ProjectRegisterService);
    plans = app.get(ProjectPlansService);
    metrics = app.get(ProjectWorkMetricsService);
    tools = app.get(ProjectToolsService);
    work = app.get(WorkService);
    collaboration = app.get(CollaborationService);
    kernel = app.get(SharedKernel);
    grants = app.get(ResourceGrants);
    source = app.get(SharedTasks);
    const rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER', 'ADMIN'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
    await db.sharedRetentionPolicy.create({
      data: {
        version: policy,
        approvalReference: 'SYNTHETIC-ONLY',
        configuration: {
          policyVersion: policy,
          approvalReference: 'SYNTHETIC-ONLY',
          accountableOperator: 'synthetic',
          applicableContexts: ['PROJECT'],
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
    member = await person();
    viewer = await person();
    outsider = await person();
  }, 30000);
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.sharedRateLimit.deleteMany();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await db?.$disconnect();
    await sandbox?.close();
  });
  it('keeps unexpected signed outcomes quarantined while known constraint conflicts remain readable', async () => {
    const p = await project(),
      m = await join(p.id),
      cap = {
        member: { accessId: m.id, generation: m.generation },
        date: '2030-01-01',
        timezone: 'UTC',
        availableMinutes: 60,
      };
    await metrics.capacity(owner.actor, p.id, randomUUID(), 0, cap);
    await expect(
      metrics.capacity(owner.actor, p.id, randomUUID(), 0, cap),
    ).rejects.toThrow();
    expect(
      (await metrics.workload(owner.actor, p.id, range)).rows[0]
        ?.capacityMinutes,
    ).toBe(60);
    const q = await project(),
      plan = await plans.bulk(
        owner.actor,
        q.id,
        { id: randomUUID(), operations: [create()] },
        randomUUID(),
      );
    vi.spyOn(source, 'create').mockRejectedValueOnce(
      new Error('Synthetic unknown transaction outcome'),
    );
    await expect(
      plans.apply(owner.actor, q.id, plan.id, 1, plan.manifestHash),
    ).rejects.toThrow();
    expect(await db.task.count({ where: { spaceId: q.id } })).toBe(0);
    await expect(plans.getPlan(owner.actor, q.id, plan.id)).rejects.toThrow();
  });
  it('removes closed recipients from workload without reading their private planning or Focus', async () => {
    const p = await project(),
      t = await task(p.id),
      a = await assignment(p.id, t.id);
    await work.respond(member.actor, p.id, t.id, a.assignment.id, 1, {
      decision: 'ACCEPTED',
    });
    await metrics.allocation(owner.actor, p.id, randomUUID(), 0, {
      assignmentId: a.assignment.id,
      date: '2030-01-01',
      timezone: 'UTC',
      plannedMinutes: 30,
    });
    await db.space.updateMany({
      where: { ownerUserId: member.actor.userId, kind: 'PERSONAL' },
      data: { accessClosedAt: new Date() },
    });
    try {
      expect((await metrics.workload(owner.actor, p.id, range)).rows).toEqual(
        [],
      );
    } finally {
      await db.space.updateMany({
        where: { ownerUserId: member.actor.userId, kind: 'PERSONAL' },
        data: { accessClosedAt: null },
      });
    }
  });
  const page = { limit: 100 },
    window = { fromAt: '2030-01-01T00:00:00Z', toAt: '2030-01-03T00:00:00Z' },
    range = { fromDate: '2030-01-01', toDate: '2030-01-03', timezone: 'UTC' };
  async function project() {
    return projects.create(
      owner.actor,
      { id: randomUUID(), title: 'P206', retentionPolicyVersion: policy },
      randomUUID(),
    );
  }
  async function task(pid: string) {
    return projects.createTask(
      owner.actor,
      pid,
      { id: randomUUID(), title: 'Source', priority: 'NONE' },
      randomUUID(),
    );
  }
  async function join(
    pid: string,
    who = member,
    role: 'MEMBER' | 'VIEWER' | 'MANAGER' = 'MEMBER',
  ) {
    const offer = await collaboration.createInvitation(
        owner.actor,
        pid,
        {
          kind: 'MEMBERSHIP',
          memberRole: role,
          recipient: { userId: who.actor.userId },
        },
        randomUUID(),
      ),
      r = await collaboration.decideInvitation(
        who.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
      );
    if (!('membership' in r)) throw new Error('Expected member');
    return r.membership;
  }
  async function current(id: string) {
    return db.task.findUniqueOrThrow({ where: { id } });
  }
  const risk = () =>
    c.ProjectRegisterCreateSchema.parse({
      id: randomUUID(),
      kind: 'RISK',
      title: 'Delivery',
      description: 'Explicit risk',
      severity: 'HIGH',
      probability: 40,
      owner: null,
      mitigation: 'Review',
      status: 'OPEN',
    });
  const create = () =>
    c.ProjectCreateTaskOperationSchema.parse({
      kind: 'CREATE_TASK',
      task: { id: randomUUID(), title: 'Fresh' },
    });
  function definition() {
    const phase = randomUUID(),
      section = randomUUID(),
      milestone = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    return c.ProjectTemplateDefinitionSchema.parse({
      schemaVersion: 1,
      phases: [{ key: phase, title: 'Phase', position: 0 }],
      sections: [
        { key: section, title: 'Section', position: 0, phaseKey: phase },
      ],
      milestones: [
        {
          key: milestone,
          title: 'Milestone',
          position: 0,
          phaseKey: phase,
          targetDate: '2030-01-02',
        },
      ],
      tasks: [
        {
          key: a,
          title: 'First',
          description: null,
          priority: 'HIGH',
          estimatedMinutes: 30,
          sectionKey: section,
          milestoneKey: milestone,
        },
        {
          key: b,
          title: 'Second',
          description: null,
          priority: 'NONE',
          estimatedMinutes: null,
          sectionKey: section,
          milestoneKey: null,
        },
      ],
      dependencies: [
        { predecessorKey: a, successorKey: b, kind: 'FS', lagMinutes: -10 },
      ],
    });
  }
  async function assignment(pid: string, tid: string, who = member) {
    const access = await join(pid, who),
      r = await work.create(
        owner.actor,
        pid,
        tid,
        (await current(tid)).revision,
        {
          id: randomUUID(),
          recipientAccessId: access.id,
          recipientGeneration: access.generation,
          kind: 'PRIMARY',
        },
        randomUUID(),
      );
    return { access, assignment: r };
  }
  async function grant(pid: string, tid: string) {
    const offer = await projects.grantOffer(
      owner.actor,
      pid,
      {
        id: randomUUID(),
        recipientUserId: outsider.actor.userId,
        target: { kind: 'TASK', id: tid },
        capabilities: ['read', 'update', 'complete'],
        grantExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      randomUUID(),
    );
    await grants.decide(
      outsider.actor,
      offer.offer.id,
      offer.proof!,
      1,
      true,
      projects.validateGrantTarget,
    );
  }
  it('retains risk/issue owner, severity, probability, mitigation and immutable revision history', async () => {
    const p = await project(),
      m = await join(p.id),
      input = {
        ...risk(),
        owner: { accessId: m.id, generation: m.generation },
      },
      key = randomUUID(),
      first = await register.create(owner.actor, p.id, input, key);
    expect(await register.create(owner.actor, p.id, input, key)).toEqual(first);
    const { id: _id, ...patch } = input,
      updated = await register.update(owner.actor, p.id, first.id, 1, {
        ...patch,
        probability: 60,
        status: 'MITIGATING',
      });
    expect(updated.revision).toBe(2);
    await expect(
      register.update(owner.actor, p.id, first.id, 1, patch),
    ).rejects.toThrow();
    await register.retire(owner.actor, p.id, first.id, 2);
    expect(
      (await register.events(owner.actor, p.id, first.id, page)).items,
    ).toHaveLength(3);
    expect((await register.list(owner.actor, p.id, page)).items).toEqual([]);
    const issue = await register.create(
      owner.actor,
      p.id,
      { ...risk(), kind: 'ISSUE', probability: null },
      randomUUID(),
    );
    expect(issue.kind).toBe('ISSUE');
    await expect(
      db.projectRiskIssueEvent.updateMany({
        where: { itemId: first.id },
        data: { revision: 99 },
      }),
    ).rejects.toThrow();
  });
  it('rejects register mutation by Member/Viewer/outsider and foreign or old-generation owners', async () => {
    const p = await project(),
      q = await project(),
      m = await join(p.id),
      foreign = await join(q.id, outsider);
    await join(p.id, viewer, 'VIEWER');
    for (const who of [member, viewer, outsider])
      await expect(
        register.create(who.actor, p.id, risk(), randomUUID()),
      ).rejects.toThrow();
    await expect(
      register.create(
        owner.actor,
        p.id,
        {
          ...risk(),
          owner: { accessId: foreign.id, generation: foreign.generation },
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await kernel.changeAccess(owner.actor, {
      spaceId: p.id,
      scopeId: p.id,
      accessId: m.id,
      revision: m.revision,
      memberRole: 'MEMBER',
      state: 'REVOKED',
    });
    await join(p.id);
    await expect(
      register.create(
        owner.actor,
        p.id,
        { ...risk(), owner: { accessId: m.id, generation: m.generation } },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('scopes nested register IDs and invalidates signed cursors after writes', async () => {
    const p = await project(),
      q = await project();
    await register.create(owner.actor, p.id, risk(), randomUUID());
    const second = await register.create(
        owner.actor,
        p.id,
        risk(),
        randomUUID(),
      ),
      list = await register.list(owner.actor, p.id, { limit: 1 });
    await expect(register.get(owner.actor, q.id, second.id)).rejects.toThrow();
    await register.create(owner.actor, p.id, risk(), randomUUID());
    await expect(
      register.list(owner.actor, p.id, { limit: 1, after: list.nextCursor! }),
    ).rejects.toThrow();
  });
  it('publishes immutable templates, previews safely and atomically creates fresh structure/Tasks/DAG without assignments', async () => {
    const p = await project(),
      id = randomUUID(),
      v = await plans.publish(
        owner.actor,
        p.id,
        id,
        0,
        { name: 'Plan', definition: definition() },
        randomUUID(),
      ),
      input = { id: randomUUID(), version: v.version },
      key = randomUUID(),
      preview = await plans.templatePreview(owner.actor, p.id, id, input, key);
    expect(await db.task.count({ where: { spaceId: p.id } })).toBe(0);
    expect(
      await plans.templatePreview(owner.actor, p.id, id, input, key),
    ).toEqual(preview);
    const result = await plans.apply(
      owner.actor,
      p.id,
      preview.id,
      1,
      preview.manifestHash,
    );
    expect(result.state).toBe('APPLIED');
    expect(await db.projectPhase.count({ where: { projectId: p.id } })).toBe(1);
    expect(await db.projectSection.count({ where: { projectId: p.id } })).toBe(
      1,
    );
    expect(
      await db.projectMilestone.count({ where: { projectId: p.id } }),
    ).toBe(1);
    expect(
      await db.task.count({ where: { spaceId: p.id, status: 'OPEN' } }),
    ).toBe(2);
    expect(await db.taskDependency.count({ where: { spaceId: p.id } })).toBe(1);
    expect(await db.taskAssignment.count({ where: { spaceId: p.id } })).toBe(0);
    expect(
      (await metrics.currentReport(owner.actor, p.id, window)).estimatedMinutes,
    ).toBe(30);
    const count = await db.taskChange.count({ where: { spaceId: p.id } });
    await plans.apply(owner.actor, p.id, preview.id, 1, preview.manifestHash);
    expect(await db.taskChange.count({ where: { spaceId: p.id } })).toBe(count);
  });
  it('pins template versions, rejects bad closure/cycles and deprecates without changing existing Tasks', async () => {
    const p = await project(),
      id = randomUUID(),
      d = definition();
    await plans.publish(
      owner.actor,
      p.id,
      id,
      0,
      { name: 'V1', definition: d },
      randomUUID(),
    );
    await plans.publish(
      owner.actor,
      p.id,
      id,
      1,
      { name: 'V2', definition: { ...d, dependencies: [] } },
      randomUUID(),
    );
    expect(
      (await plans.template(owner.actor, p.id, id, 1)).definition.dependencies,
    ).toHaveLength(1);
    const cyclic = {
      ...d,
      dependencies: [
        ...d.dependencies,
        {
          predecessorKey: d.tasks[1]!.key,
          successorKey: d.tasks[0]!.key,
          kind: 'SF' as const,
          lagMinutes: 0,
        },
      ],
    };
    await expect(
      plans.publish(
        owner.actor,
        p.id,
        id,
        2,
        { name: 'Bad', definition: cyclic },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await plans.deprecate(owner.actor, p.id, id, 2);
    await expect(
      plans.templatePreview(
        owner.actor,
        p.id,
        id,
        { id: randomUUID(), version: 1 },
        randomUUID(),
      ),
    ).rejects.toThrow();
    expect((await plans.template(owner.actor, p.id, id, 1)).name).toBe('V1');
    await expect(
      db.projectTemplateVersion.updateMany({
        where: { templateId: id },
        data: { name: 'Tampered' },
      }),
    ).rejects.toThrow();
  });
  it('applies mixed bulk owner commands with explicit estimates and source history, preserving old DTOs', async () => {
    const p = await project(),
      t = await task(p.id),
      created = create(),
      preview = await plans.bulk(
        owner.actor,
        p.id,
        {
          id: randomUUID(),
          operations: [
            {
              kind: 'UPDATE_TASK',
              taskId: t.id,
              sourceRevision: t.revision,
              patch: { title: 'Updated' },
              estimatedMinutes: 25,
            },
            created,
          ],
        },
        randomUUID(),
      );
    expect((await current(t.id)).title).toBe('Source');
    await plans.apply(owner.actor, p.id, preview.id, 1, preview.manifestHash);
    expect((await current(t.id)).title).toBe('Updated');
    expect(
      (await metrics.estimate(owner.actor, p.id, t.id)).estimatedMinutes,
    ).toBe(25);
    expect(
      c.SharedTaskSchema.safeParse(
        await projects.source(owner.actor, p.id, 'TASK', t.id),
      ).success,
    ).toBe(true);
    expect(await db.task.count({ where: { id: created.task.id } })).toBe(1);
  });
  it('validates all CSV rows with bounded safe errors and imports quoted UTF-8 data only after explicit apply', async () => {
    const p = await project(),
      invalid = await plans.csv(
        owner.actor,
        p.id,
        {
          id: randomUUID(),
          csv: 'title,priority\nValid,HIGH\nInvalid,UNKNOWN',
        },
        randomUUID(),
      );
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0]?.row).toBe(3);
    expect(await db.task.count({ where: { spaceId: p.id } })).toBe(0);
    expect(
      await db.projectChangePlan.count({ where: { projectId: p.id } }),
    ).toBe(0);
    const result = await plans.csv(
      owner.actor,
      p.id,
      {
        id: randomUUID(),
        csv: '\uFEFFtitle,description,estimatedMinutes\r\n"سلام, project","Line 1\nLine ""2""",45\r\n',
      },
      randomUUID(),
    );
    expect(result.valid).toBe(true);
    expect(await db.task.count({ where: { spaceId: p.id } })).toBe(0);
    await plans.apply(
      owner.actor,
      p.id,
      result.plan!.id,
      1,
      result.plan!.manifestHash,
    );
    const t = await db.task.findFirstOrThrow({ where: { spaceId: p.id } });
    expect(t.title).toBe('سلام, project');
    expect(t.estimatedMinutes).toBe(45);
    expect(t.descriptionContent).toContain('"2"');
  });
  it.each([
    'title\n=CMD()',
    'title,title\na,b',
    'title,ownerUserId\na,foreign',
    'title\n"unterminated',
  ])('rejects unsafe or unsupported CSV %s', async (csv) => {
    const p = await project(),
      r = await plans.csv(
        owner.actor,
        p.id,
        { id: randomUUID(), csv },
        randomUUID(),
      );
    expect(r.valid).toBe(false);
    expect(r.plan).toBeNull();
    expect(await db.task.count({ where: { spaceId: p.id } })).toBe(0);
  });
  it('rejects duplicate commands, cross-project sources, Viewer bulk and wrong manifest hashes', async () => {
    const p = await project(),
      q = await project(),
      t = await task(p.id);
    await join(p.id, viewer, 'VIEWER');
    const update = {
      kind: 'UPDATE_TASK' as const,
      taskId: t.id,
      sourceRevision: 1,
      patch: { title: 'No' },
    };
    await expect(
      plans.bulk(
        owner.actor,
        p.id,
        { id: randomUUID(), operations: [update, update] },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await expect(
      plans.bulk(
        owner.actor,
        q.id,
        { id: randomUUID(), operations: [update] },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await expect(
      plans.bulk(
        viewer.actor,
        p.id,
        { id: randomUUID(), operations: [create()] },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const preview = await plans.bulk(
      owner.actor,
      p.id,
      { id: randomUUID(), operations: [update] },
      randomUUID(),
    );
    await expect(
      plans.apply(owner.actor, p.id, preview.id, 1, '0'.repeat(64)),
    ).rejects.toThrow();
    expect((await current(t.id)).title).toBe('Source');
  });
  it('invalidates plans on source, authority and expiry changes without partial writes', async () => {
    const p = await project(),
      t = await task(p.id),
      preview = await plans.bulk(
        owner.actor,
        p.id,
        {
          id: randomUUID(),
          operations: [
            {
              kind: 'UPDATE_TASK',
              taskId: t.id,
              sourceRevision: 1,
              patch: { title: 'Planned' },
            },
            create(),
          ],
        },
        randomUUID(),
      );
    await projects.patchTask(
      owner.actor,
      p.id,
      t.id,
      1,
      { title: 'Other edit' },
      randomUUID(),
    );
    await expect(
      plans.apply(owner.actor, p.id, preview.id, 1, preview.manifestHash),
    ).rejects.toThrow();
    expect(await db.task.count({ where: { spaceId: p.id } })).toBe(1);
    const next = await plans.bulk(
        owner.actor,
        p.id,
        { id: randomUUID(), operations: [create()] },
        randomUUID(),
      ),
      signed = collaboration.signed.bind(collaboration);
    vi.spyOn(collaboration, 'signed').mockImplementation(
      (actor, pid, users, action, target, body) =>
        signed(actor, pid, users, action, target, (tx, now, locked, begin) =>
          body(tx, new Date(now.getTime() + 1800001), locked, begin),
        ),
    );
    await expect(
      plans.apply(owner.actor, p.id, next.id, 1, next.manifestHash),
    ).rejects.toThrow();
    expect(await db.task.count({ where: { spaceId: p.id } })).toBe(1);
  });
  it('rolls back all created sources and history when a later bulk operation fails', async () => {
    const p = await project(),
      first = create(),
      second = create(),
      plan = await plans.bulk(
        owner.actor,
        p.id,
        { id: randomUUID(), operations: [first, second] },
        randomUUID(),
      ),
      original = source.create.bind(source);
    let calls = 0;
    vi.spyOn(source, 'create').mockImplementation(async (...args) => {
      if (++calls === 2)
        throw new ConflictException('Synthetic second source failure');
      return original(...args);
    });
    await expect(
      plans.apply(owner.actor, p.id, plan.id, 1, plan.manifestHash),
    ).rejects.toThrow();
    expect(await db.task.count({ where: { spaceId: p.id } })).toBe(0);
    expect(await db.taskChange.count({ where: { spaceId: p.id } })).toBe(0);
    expect((await plans.getPlan(owner.actor, p.id, plan.id)).state).toBe(
      'PREVIEWED',
    );
    expect(
      await db.sharedUsageEntry.count({
        where: { spaceId: p.id, feature: 'task.shared' },
      }),
    ).toBe(0);
  });
  it('keeps workflow approval and dependency schedule guards authoritative in bulk', async () => {
    const p = await project(),
      m = await join(p.id),
      t = await task(p.id),
      w = randomUUID(),
      start = randomUUID(),
      end = randomUUID(),
      edge = randomUUID();
    await tools.publishWorkflow(
      owner.actor,
      p.id,
      w,
      0,
      {
        name: 'Approval',
        states: [
          { id: start, label: 'Open', status: 'OPEN' },
          { id: end, label: 'Done', status: 'DONE' },
        ],
        edges: [
          {
            id: edge,
            fromStateId: start,
            toStateId: end,
            requiresApproval: true,
            approvers: [{ accessId: m.id, generation: m.generation }],
          },
        ],
      },
      randomUUID(),
    );
    await tools.bind(owner.actor, p.id, t.id, 1, {
      workflowId: w,
      version: 1,
      stateId: start,
    });
    await expect(
      plans.bulk(
        owner.actor,
        p.id,
        {
          id: randomUUID(),
          operations: [
            {
              kind: 'UPDATE_TASK',
              taskId: t.id,
              sourceRevision: 2,
              patch: { status: 'DONE' },
            },
          ],
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
    expect((await current(t.id)).status).toBe('OPEN');
  });
  it('records author-owned shared effort without Personal Focus writes and corrects via void/replace', async () => {
    const p = await project();
    await join(p.id);
    const t = await task(p.id),
      input = {
        id: randomUUID(),
        startedAt: '2030-01-01T09:00:00Z',
        endedAt: '2030-01-01T10:00:00Z',
      },
      key = randomUUID(),
      entry = await metrics.record(member.actor, p.id, t.id, 1, input, key);
    expect(
      await metrics.record(member.actor, p.id, t.id, 1, input, key),
    ).toEqual(entry);
    expect(await db.timeEntry.count()).toBe(0);
    expect(await db.focusSession.count()).toBe(0);
    expect(
      (await metrics.currentReport(owner.actor, p.id, window)).recordedSeconds,
    ).toBe(3600);
    await expect(
      metrics.void(owner.actor, p.id, t.id, entry.id, 1),
    ).rejects.toThrow();
    await metrics.void(member.actor, p.id, t.id, entry.id, 1);
    await metrics.void(member.actor, p.id, t.id, entry.id, 1);
    expect(
      (await metrics.currentReport(owner.actor, p.id, window)).recordedSeconds,
    ).toBe(0);
    expect(
      (await metrics.logs(owner.actor, p.id, t.id, page)).items[0]?.voidedAt,
    ).not.toBeNull();
  });
  it('denies grant-only work logging and broad reports while preserving named-source estimate rights', async () => {
    const p = await project(),
      t = await task(p.id);
    await grant(p.id, t.id);
    expect(
      (
        await metrics.estimate(outsider.actor, p.id, t.id, {
          revision: 1,
          estimatedMinutes: 10,
        })
      ).estimatedMinutes,
    ).toBe(10);
    await expect(
      metrics.record(
        outsider.actor,
        p.id,
        t.id,
        2,
        {
          id: randomUUID(),
          startedAt: window.fromAt,
          endedAt: '2030-01-01T01:00:00Z',
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await expect(
      metrics.currentReport(outsider.actor, p.id, window),
    ).rejects.toThrow();
    await expect(
      metrics.workload(outsider.actor, p.id, range),
    ).rejects.toThrow();
    await expect(register.list(outsider.actor, p.id, page)).rejects.toThrow();
  });
  it('uses accepted assignments and explicit capacity/allocation, keeping unknowns and overbooking transparent', async () => {
    const p = await project(),
      t = await task(p.id),
      a = await assignment(p.id, t.id),
      input = {
        assignmentId: a.assignment.id,
        date: '2030-01-01',
        timezone: 'UTC',
        plannedMinutes: 90,
      };
    await expect(
      metrics.allocation(owner.actor, p.id, randomUUID(), 0, input),
    ).rejects.toThrow();
    await work.respond(member.actor, p.id, t.id, a.assignment.id, 1, {
      decision: 'ACCEPTED',
    });
    await metrics.allocation(owner.actor, p.id, randomUUID(), 0, input);
    let load = await metrics.workload(owner.actor, p.id, range);
    expect(load.rows[0]).toMatchObject({
      capacityMinutes: null,
      allocatedMinutes: 90,
      overbookedMinutes: null,
      unknownEstimates: 1,
    });
    const cap = await metrics.capacity(owner.actor, p.id, randomUUID(), 0, {
      member: { accessId: a.access.id, generation: a.access.generation },
      date: '2030-01-01',
      timezone: 'UTC',
      availableMinutes: 60,
    });
    load = await metrics.workload(owner.actor, p.id, range);
    expect(load.rows[0]?.overbookedMinutes).toBe(30);
    await metrics.capacity(owner.actor, p.id, cap.id, 1, {
      member: cap.member,
      date: cap.date,
      timezone: cap.timezone,
      availableMinutes: null,
    });
    expect(
      (await metrics.workload(owner.actor, p.id, range)).rows[0]
        ?.capacityMinutes,
    ).toBeNull();
    expect(
      (
        await metrics.records(owner.actor, p.id, 'capacity', {
          ...range,
          limit: 10,
        })
      ).items,
    ).toHaveLength(1);
    await work.revoke(owner.actor, p.id, t.id, a.assignment.id, 2);
    expect(
      (await metrics.workload(owner.actor, p.id, range)).rows[0]
        ?.allocatedMinutes,
    ).toBe(0);
  });
  it('excludes old-generation/closed recipients and rejects foreign assignment allocations', async () => {
    const p = await project(),
      q = await project(),
      t = await task(p.id),
      a = await assignment(p.id, t.id);
    await work.respond(member.actor, p.id, t.id, a.assignment.id, 1, {
      decision: 'ACCEPTED',
    });
    const allocation = {
      assignmentId: a.assignment.id,
      date: '2030-01-01',
      timezone: 'UTC',
      plannedMinutes: 30,
    };
    await expect(
      metrics.allocation(owner.actor, q.id, randomUUID(), 0, allocation),
    ).rejects.toThrow();
    await metrics.allocation(owner.actor, p.id, randomUUID(), 0, allocation);
    await kernel.changeAccess(owner.actor, {
      spaceId: p.id,
      scopeId: p.id,
      accessId: a.access.id,
      revision: a.access.revision,
      memberRole: 'MEMBER',
      state: 'REVOKED',
    });
    await join(p.id);
    expect((await metrics.workload(owner.actor, p.id, range)).rows).toEqual([]);
  });
  it('reports only current shared sources and clipped explicit logs, preserving immutable reauthorized snapshots', async () => {
    const p = await project(),
      t = await task(p.id),
      personal = await db.space.findFirstOrThrow({
        where: { ownerUserId: owner.actor.userId, kind: 'PERSONAL' },
      });
    await db.task.create({
      data: {
        spaceId: personal.id,
        createdByUserId: owner.actor.userId,
        title: 'Private',
        estimatedMinutes: 9999,
      },
    });
    await metrics.estimate(owner.actor, p.id, t.id, {
      revision: 1,
      estimatedMinutes: 30,
    });
    await metrics.record(
      owner.actor,
      p.id,
      t.id,
      2,
      {
        id: randomUUID(),
        startedAt: '2029-12-31T23:30:00Z',
        endedAt: '2030-01-01T00:30:00Z',
      },
      randomUUID(),
    );
    const snapshot = await metrics.createSnapshot(
      owner.actor,
      p.id,
      { id: randomUUID(), ...window },
      randomUUID(),
    );
    expect(snapshot.report).toMatchObject({
      taskCount: 1,
      estimatedMinutes: 30,
      recordedSeconds: 1800,
      workLogCount: 1,
    });
    await metrics.estimate(owner.actor, p.id, t.id, {
      revision: 3,
      estimatedMinutes: 60,
    });
    expect(
      (await metrics.getSnapshot(owner.actor, p.id, snapshot.id)).report
        .estimatedMinutes,
    ).toBe(30);
    await expect(
      metrics.getSnapshot(outsider.actor, p.id, snapshot.id),
    ).rejects.toThrow();
    await expect(
      db.projectReportSnapshot.updateMany({
        where: { id: snapshot.id },
        data: { report: {} },
      }),
    ).rejects.toThrow();
  });
  it('checks aggregate growth ownership for every planned new Task before atomic apply', async () => {
    const p = await project(),
      plan = await plans.bulk(
        owner.actor,
        p.id,
        { id: randomUUID(), operations: [create(), create()] },
        randomUUID(),
      ),
      policy = app.get(SharedFeaturePolicy);
    const decide = vi
      .spyOn(policy, 'decide')
      .mockImplementation(async (input) => ({
        allowed: input.feature !== 'task.shared' || input.currentUsage < 1,
        mode: 'FREE',
      }));
    await expect(
      plans.apply(owner.actor, p.id, plan.id, 1, plan.manifestHash),
    ).rejects.toThrow();
    expect(await db.task.count({ where: { spaceId: p.id } })).toBe(0);
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'task.shared',
        currentUsage: 1,
        usageOwner: { kind: 'SHARED_CUSTODY', spaceId: p.id },
      }),
      expect.anything(),
    );
  });
  it('rejects a plan after revocation wins and serializes mutation-first before removal', async () => {
    const p = await project(),
      m = await join(p.id, member, 'MANAGER'),
      t = await task(p.id),
      plan = await plans.bulk(
        member.actor,
        p.id,
        {
          id: randomUUID(),
          operations: [
            {
              kind: 'UPDATE_TASK',
              taskId: t.id,
              sourceRevision: 1,
              patch: { title: 'Committed first' },
            },
          ],
        },
        randomUUID(),
      );
    let entered!: () => void, release!: () => void;
    const checkpoint = new Promise<void>((r) => {
        entered = r;
      }),
      held = new Promise<void>((r) => {
        release = r;
      }),
      original = source.update.bind(source);
    vi.spyOn(source, 'update').mockImplementation(async (...args) => {
      const row = await original(...args);
      if (args[3] === t.id) {
        entered();
        await held;
      }
      return row;
    });
    const apply = plans.apply(
      member.actor,
      p.id,
      plan.id,
      1,
      plan.manifestHash,
    );
    await checkpoint;
    const revoke = kernel.changeAccess(owner.actor, {
      spaceId: p.id,
      scopeId: p.id,
      accessId: m.id,
      revision: m.revision,
      memberRole: 'MANAGER',
      state: 'REVOKED',
    });
    try {
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        const rows = await db.$queryRaw<
          { n: number }[]
        >`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=${application} AND cardinality(pg_blocking_pids(pid))>0`;
        if (rows[0]!.n) {
          waiting = true;
          break;
        }
        await new Promise<void>((r) => setImmediate(r));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
    }
    expect((await apply).state).toBe('APPLIED');
    await revoke;
    await expect(
      plans.apply(member.actor, p.id, plan.id, 1, plan.manifestHash),
    ).rejects.toThrow();
    const q = await project(),
      other = await join(q.id, member, 'MANAGER'),
      preview = await plans.bulk(
        member.actor,
        q.id,
        { id: randomUUID(), operations: [create()] },
        randomUUID(),
      );
    await kernel.changeAccess(owner.actor, {
      spaceId: q.id,
      scopeId: q.id,
      accessId: other.id,
      revision: other.revision,
      memberRole: 'MANAGER',
      state: 'REVOKED',
    });
    await expect(
      plans.apply(member.actor, q.id, preview.id, 1, preview.manifestHash),
    ).rejects.toThrow();
    expect(await db.task.count({ where: { spaceId: q.id } })).toBe(0);
  });
  it('enforces direct DB scoped references, publication guards and immutable shared effort', async () => {
    const p = await project(),
      q = await project(),
      t = await task(p.id),
      other = await join(q.id),
      local = await db.sharedActor.findFirstOrThrow({
        where: { spaceId: p.id, userId: owner.actor.userId },
      });
    await expect(
      db.projectRiskIssue.create({
        data: {
          id: randomUUID(),
          spaceId: p.id,
          scopeId: p.id,
          projectId: p.id,
          kind: 'RISK',
          title: 'Bad',
          description: '',
          severity: 'LOW',
          probability: 5,
          ownerAccessId: other.id,
          ownerGeneration: other.generation,
          mitigation: '',
          status: 'OPEN',
          createdByActorId: local.id,
          creationKey: 'a'.repeat(64),
          fingerprint: 'b'.repeat(64),
        },
      }),
    ).rejects.toThrow();
    const plan = await plans.bulk(
      owner.actor,
      p.id,
      { id: randomUUID(), operations: [create()] },
      randomUUID(),
    );
    await expect(
      db.projectChangePlan.update({
        where: { id: plan.id },
        data: { manifestHash: '0'.repeat(64) },
      }),
    ).rejects.toThrow();
    const entry = await metrics.record(
      owner.actor,
      p.id,
      t.id,
      1,
      {
        id: randomUUID(),
        startedAt: window.fromAt,
        endedAt: '2030-01-01T01:00:00Z',
      },
      randomUUID(),
    );
    await expect(
      db.sharedTaskWorkLog.update({
        where: { id: entry.id },
        data: { endedAt: new Date('2030-01-01T02:00:00Z') },
      }),
    ).rejects.toThrow();
  });
  it('provides strict HTTP, ETags, no-store, version queries and Origin guards', async () => {
    const p = await project(),
      t = await task(p.id),
      base = `/api/v1/projects/${p.id}`;
    await request(app.getHttpServer())
      .get(base + '/tasks/' + t.id + '/estimate')
      .set('Cookie', owner.cookie)
      .expect(200)
      .expect('ETag', '"1"')
      .expect('Cache-Control', 'no-store');
    await request(app.getHttpServer())
      .put(base + '/tasks/' + t.id + '/estimate')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({ estimatedMinutes: 30 })
      .expect(400);
    await request(app.getHttpServer())
      .post(base + '/register-items')
      .set('Cookie', owner.cookie)
      .send(risk())
      .expect(403);
    await request(app.getHttpServer())
      .get(base + '/workload')
      .set('Cookie', owner.cookie)
      .query({ ...range, unknown: 'x' })
      .expect(400);
    const created = await request(app.getHttpServer())
      .post(base + '/templates')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({ id: randomUUID(), name: 'HTTP', definition: definition() })
      .expect(200);
    await request(app.getHttpServer())
      .get(
        base + '/templates/' + created.body.templateId + '/versions?version=1',
      )
      .set('Cookie', owner.cookie)
      .expect(200);
  });
});
