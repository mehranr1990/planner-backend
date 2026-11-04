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
  ResourceGrants,
  SharedFeaturePolicy,
} from '../../src/modules/spaces/public/index.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { ProjectsService } from '../../src/modules/projects/public/index.js';
import * as c from '@mehran/api-contracts';
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
describe('P2-03 independent Projects and authorized shared sources', () => {
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
    projects: ProjectsService,
    grants: ResourceGrants;
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
    const result = await service.decideInvitation(
      who.actor,
      offered.invitation.id,
      offered.proof!,
      1,
      true,
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
    projects = app.get(ProjectsService);
    grants = app.get(ResourceGrants);
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
  async function task(id: string, who = owner) {
    return projects.createTask(
      who.actor,
      id,
      { id: randomUUID(), title: 'Shared source', priority: 'NONE' },
      randomUUID(),
    );
  }
  async function goal(id: string, who = owner) {
    return projects.createGoal(
      who.actor,
      id,
      {
        id: randomUUID(),
        title: 'Shared goal',
        horizon: 'SHORT_TERM',
        timezone: 'UTC',
      },
      randomUUID(),
    );
  }
  async function grant(
    id: string,
    target: ReturnType<typeof c.ResourceTargetSchema.parse>,
    who = outsider,
    by = owner,
    capabilities: Array<'read' | 'update' | 'complete'> = ['read'],
  ) {
    const offer = await projects.grantOffer(
      by.actor,
      id,
      {
        id: randomUUID(),
        recipientUserId: who.actor.userId,
        target,
        capabilities,
        grantExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      randomUUID(),
    );
    const accepted = await grants.decide(
      who.actor,
      offer.offer.id,
      offer.proof!,
      1,
      true,
      projects.validateGrantTarget,
    );
    if (!('grant' in accepted)) throw new Error('Expected accepted grant');
    return { offer, accepted };
  }
  it('creates a complete independent Project atomically, preserves stable creation replay and owner usage without Team/Company', async () => {
    const input = {
        id: randomUUID(),
        title: ' Project core ',
        retentionPolicyVersion: version,
      },
      key = randomUUID();
    const first = await projects.create(owner.actor, input, key),
      again = await projects.create(owner.actor, input, key);
    expect(again).toEqual(first);
    expect(first.association).toEqual({ kind: 'INDEPENDENT' });
    expect(first.title).toBe('Project core');
    expect(await client.project.count({ where: { id: first.id } })).toBe(1);
    expect(
      await client.sharedUsageEntry.count({
        where: { spaceId: first.spaceId, feature: 'shared.custody', delta: 1 },
      }),
    ).toBe(1);
    await expect(
      projects.create(owner.actor, { ...input, title: 'different' }, key),
    ).rejects.toHaveProperty('status', 409);
    await expect(projects.read(outsider.actor, first.id)).rejects.toThrow();
    const tables = await client.$queryRaw<
      { tablename: string }[]
    >`SELECT tablename FROM pg_tables WHERE schemaname=current_schema()`;
    expect(tables.some((t) => /^(Team|Company)$/.test(t.tablename))).toBe(
      false,
    );
    expect(
      (await projects.list(owner.actor, { limit: 100 })).items.some(
        (p) => p.id === first.id,
      ),
    ).toBe(true);
    expect((await projects.list(outsider.actor, { limit: 100 })).items).toEqual(
      [],
    );
  });
  it('rolls back boundary, source, history, receipt, usage and outbox together on owner failure', async () => {
    const id = randomUUID();
    const create = vi
      .spyOn(kernel, 'offerEffect')
      .mockRejectedValueOnce(new Error('fixture rollback'));
    await expect(
      projects.create(
        owner.actor,
        { id, title: 'rollback', retentionPolicyVersion: version },
        randomUUID(),
      ),
    ).rejects.toThrow('fixture rollback');
    create.mockRestore();
    expect(await client.space.count({ where: { id } })).toBe(0);
    const p = await project(),
      before = await client.sharedAuditEvent.count({
        where: { spaceId: p.id },
      });
    const fail = vi
      .spyOn(kernel, 'offerEffect')
      .mockRejectedValueOnce(new Error('fixture effect rollback'));
    const taskId = randomUUID();
    await expect(
      projects.createTask(
        owner.actor,
        p.id,
        { id: taskId, title: 'rollback', priority: 'NONE' },
        randomUUID(),
      ),
    ).rejects.toThrow('fixture effect rollback');
    fail.mockRestore();
    expect(await client.task.count({ where: { id: taskId } })).toBe(0);
    expect(await client.taskChange.count({ where: { taskId } })).toBe(0);
    expect(await client.projectTask.count({ where: { taskId } })).toBe(0);
    expect(
      await client.sharedAuditEvent.count({ where: { spaceId: p.id } }),
    ).toBe(before);
  });
  it('enforces role ceilings, structural revisions, typed phase relationships and member responsibilities', async () => {
    const p = await project(),
      m = await join(p.id, member),
      v = await join(p.id, viewer, 'VIEWER'),
      phaseId = randomUUID(),
      sectionId = randomUUID(),
      milestoneId = randomUUID();
    const phase = await projects.createComponent(
      owner.actor,
      p.id,
      'phases',
      { id: phaseId, title: 'Phase', position: 0 },
      randomUUID(),
    );
    const section = await projects.createComponent(
      owner.actor,
      p.id,
      'sections',
      { id: sectionId, title: 'Section', position: 0, phaseId },
      randomUUID(),
    );
    const milestone = await projects.createComponent(
      owner.actor,
      p.id,
      'milestones',
      {
        id: milestoneId,
        title: 'Milestone',
        position: 0,
        phaseId,
        targetDate: '2027-03-21',
      },
      randomUUID(),
    );
    expect(milestone.targetDate).toBe('2027-03-21');
    await expect(
      projects.createComponent(
        member.actor,
        p.id,
        'phases',
        { id: randomUUID(), title: 'Denied', position: 0 },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    const changed = await projects.patchComponent(
      owner.actor,
      p.id,
      'sections',
      section.id,
      1,
      { title: 'Updated' },
    );
    expect(changed.revision).toBe(2);
    await expect(
      projects.patchComponent(owner.actor, p.id, 'sections', section.id, 1, {
        title: 'Stale',
      }),
    ).rejects.toHaveProperty('status', 409);
    const assignment = await projects.assign(
      owner.actor,
      p.id,
      {
        id: randomUUID(),
        accessId: m.id,
        target: { kind: 'PHASE', id: phase.id },
      },
      randomUUID(),
    );
    expect(assignment.generation).toBe(m.generation);
    expect(
      (await projects.assignments(owner.actor, p.id, { limit: 10 })).items[0]!
        .accessId,
    ).toBe(m.id);
    await projects.revokeAssignment(owner.actor, p.id, assignment.id, 1);
    await expect(
      projects.assign(
        viewer.actor,
        p.id,
        {
          id: randomUUID(),
          accessId: v.id,
          target: { kind: 'PHASE', id: phase.id },
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      projects.deleteComponent(owner.actor, p.id, 'phases', phase.id, 1),
    ).rejects.toThrow();
    expect(
      (await projects.components(viewer.actor, p.id, 'sections', { limit: 25 }))
        .items[0]!.title,
    ).toBe('Updated');
  });
  it('uses existing Task/Goal identities, owner facades, revision/history and exact same-Project associations', async () => {
    const p = await project(),
      other = await project(),
      t = await task(p.id),
      g = await goal(p.id),
      foreign = await task(other.id);
    expect(
      (await client.task.findUniqueOrThrow({ where: { id: t.id } }))
        .createdByUserId,
    ).toBeNull();
    expect(
      (await client.goal.findUniqueOrThrow({ where: { id: g.id } }))
        .createdByUserId,
    ).toBeNull();
    const key = randomUUID(),
      updated = await projects.patchTask(
        owner.actor,
        p.id,
        t.id,
        1,
        { status: 'DONE' },
        key,
      );
    expect(updated.status).toBe('DONE');
    expect(
      await projects.patchTask(
        owner.actor,
        p.id,
        t.id,
        1,
        { status: 'DONE' },
        key,
      ),
    ).toEqual(updated);
    expect(await client.taskChange.count({ where: { taskId: t.id } })).toBe(2);
    const progress = await projects.patchGoal(
      owner.actor,
      p.id,
      g.id,
      1,
      { manualProgress: '12.125' },
      randomUUID(),
    );
    expect(progress.manualProgress).toBe('12.125');
    await projects.linkGoalTask(owner.actor, p.id, g.id, t.id, 2);
    expect(
      await client.goalTaskLink.count({
        where: { goalId: g.id, taskId: t.id },
      }),
    ).toBe(1);
    await expect(
      projects.linkGoalTask(owner.actor, p.id, g.id, foreign.id, 3),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      projects.source(owner.actor, other.id, 'TASK', t.id),
    ).rejects.toHaveProperty('status', 404);
    const section = await projects.createComponent(
      owner.actor,
      p.id,
      'sections',
      { id: randomUUID(), title: 'Scoped', position: 0 },
      randomUUID(),
    );
    expect(
      (
        await projects.associate(owner.actor, p.id, 'TASK', t.id, 1, {
          sectionId: section.id,
          milestoneId: null,
        })
      ).revision,
    ).toBe(2);
    await expect(
      projects.associate(owner.actor, other.id, 'TASK', foreign.id, 1, {
        sectionId: section.id,
        milestoneId: null,
      }),
    ).rejects.toHaveProperty('status', 404);
  });
  it('admits a verified external guest only on accepted proof and grants one named Task without directory, counts or unrelated data', async () => {
    const p = await project(),
      t = await task(p.id),
      hidden = await task(p.id),
      recipient = await person(),
      other = await project();
    const input = {
        id: randomUUID(),
        recipientUserId: recipient.actor.userId,
        target: { kind: 'TASK' as const, id: t.id },
        capabilities: ['read', 'update', 'complete'] as Array<
          'read' | 'update' | 'complete'
        >,
        grantExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      key = randomUUID();
    const offer = await projects.grantOffer(owner.actor, p.id, input, key);
    expect(
      (await projects.grantOffer(owner.actor, p.id, input, key)).proof,
    ).toBeNull();
    expect(
      (
        await client.resourceGrantOffer.findUniqueOrThrow({
          where: { id: offer.offer.id },
        })
      ).proofHash,
    ).toBe(createHash('sha256').update(offer.proof!).digest('hex'));
    const local = await client.sharedActor.findFirstOrThrow({
      where: { userId: recipient.actor.userId, spaceId: p.id },
    });
    expect(
      await client.contextAccess.count({ where: { actorId: local.id } }),
    ).toBe(0);
    expect(
      await grants.preview(offer.proof!, projects.validateGrantTarget),
    ).toEqual({
      contextLabel: 'Project',
      offerCategory: 'RESOURCE_GRANT',
      expiresAt: offer.offer.expiresAt,
    });
    await expect(
      grants.decide(
        member.actor,
        offer.offer.id,
        offer.proof!,
        1,
        true,
        projects.validateGrantTarget,
      ),
    ).rejects.toThrow();
    const accepted = c.GrantOfferAcceptanceSchema.parse(
      await grants.decide(
        recipient.actor,
        offer.offer.id,
        offer.proof!,
        1,
        true,
        projects.validateGrantTarget,
      ),
    );
    expect(
      (
        await client.contextAccess.findUniqueOrThrow({
          where: { id: accepted.grant.granteeAccessId },
        })
      ).memberRole,
    ).toBeNull();
    expect(
      c.SharedTaskSchema.parse(
        await projects.source(recipient.actor, p.id, 'TASK', t.id),
      ).id,
    ).toBe(t.id);
    expect(
      (
        await projects.patchTask(
          recipient.actor,
          p.id,
          t.id,
          1,
          { title: 'Guest update' },
          randomUUID(),
        )
      ).revision,
    ).toBe(2);
    await expect(
      projects.source(recipient.actor, p.id, 'TASK', hidden.id),
    ).rejects.toThrow();
    await expect(
      projects.sources(recipient.actor, p.id, 'TASK', { limit: 25 }),
    ).rejects.toThrow();
    await expect(projects.read(recipient.actor, p.id)).rejects.toThrow();
    await expect(projects.read(recipient.actor, other.id)).rejects.toThrow();
    expect((await projects.list(recipient.actor, { limit: 25 })).items).toEqual(
      [],
    );
    const replay = c.GrantOfferAcceptanceSchema.parse(
      await grants.decide(
        recipient.actor,
        offer.offer.id,
        offer.proof!,
        1,
        true,
        projects.validateGrantTarget,
      ),
    );
    expect(replay.grant.id).toBe(accepted.grant.id);
    await projects.revokeGrant(owner.actor, p.id, accepted.grant.id, 1);
    await expect(
      projects.source(recipient.actor, p.id, 'TASK', t.id),
    ).rejects.toThrow();
    await expect(
      grants.decide(
        recipient.actor,
        offer.offer.id,
        offer.proof!,
        1,
        true,
        projects.validateGrantTarget,
      ),
    ).rejects.toThrow();
  });
  it('supports concrete Project and Goal targets without broad mutations or implicit Project-wide source access', async () => {
    const p = await project(),
      g = await goal(p.id),
      who = await person();
    await grant(p.id, { kind: 'PROJECT', id: p.id }, who);
    expect((await projects.read(who.actor, p.id)).id).toBe(p.id);
    await expect(
      projects.sources(who.actor, p.id, 'GOAL', { limit: 25 }),
    ).rejects.toThrow();
    await expect(
      projects.patch(who.actor, p.id, 1, { title: 'Escalate' }),
    ).rejects.toThrow();
    await grant(p.id, { kind: 'GOAL', id: g.id }, who, owner, [
      'read',
      'update',
    ]);
    expect(
      (
        await projects.patchGoal(
          who.actor,
          p.id,
          g.id,
          1,
          { manualProgress: '25' },
          randomUUID(),
        )
      ).manualProgress,
    ).toBe('25');
    await expect(
      projects.createGoal(
        who.actor,
        p.id,
        {
          id: randomUUID(),
          title: 'Escalate',
          horizon: 'SHORT_TERM',
          timezone: 'UTC',
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('invalidates grant delegation on issuer demotion and old generations; full membership remains independent', async () => {
    const p = await project(),
      manager = await join(p.id, member, 'MANAGER'),
      t = await task(p.id),
      who = await person();
    await grant(p.id, { kind: 'TASK', id: t.id }, who, member, [
      'read',
      'update',
    ]);
    await service.changeMembership(
      owner.actor,
      p.id,
      manager.id,
      manager.revision,
      { state: 'ACTIVE', memberRole: 'MEMBER' },
    );
    await expect(
      projects.source(who.actor, p.id, 'TASK', t.id),
    ).rejects.toThrow();
    expect((await projects.source(member.actor, p.id, 'TASK', t.id)).id).toBe(
      t.id,
    );
    const fresh = await person(),
      pending = await projects.grantOffer(
        owner.actor,
        p.id,
        {
          id: randomUUID(),
          recipientUserId: fresh.actor.userId,
          target: { kind: 'TASK', id: t.id },
          capabilities: ['read'],
          grantExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        randomUUID(),
      );
    await join(p.id, fresh);
    await expect(
      grants.decide(
        fresh.actor,
        pending.offer.id,
        pending.proof!,
        1,
        true,
        projects.validateGrantTarget,
      ),
    ).rejects.toHaveProperty('status', 409);
  });
  it('uses current immutable policy and ceilings for source reads/writes and preserves owner repair authority', async () => {
    const p = await project(),
      t = await task(p.id);
    await join(p.id, viewer, 'VIEWER');
    const policy = await projects.policy(owner.actor, p.id);
    await expect(
      projects.publishPolicy(owner.actor, p.id, 1, {
        ...policy,
        roleDefaults: { ...policy.roleDefaults, VIEWER: ['task.update'] },
      }),
    ).rejects.toHaveProperty('status', 400);
    await projects.publishPolicy(owner.actor, p.id, 1, {
      roleDefaults: { ...policy.roleDefaults, VIEWER: [] },
      exportMaxBytes: policy.exportMaxBytes,
      exportMaxRecords: policy.exportMaxRecords,
    });
    await expect(
      projects.source(viewer.actor, p.id, 'TASK', t.id),
    ).rejects.toHaveProperty('status', 403);
    expect(
      (await projects.list(viewer.actor, { limit: 100 })).items.some(
        (v) => v.id === p.id,
      ),
    ).toBe(false);
    expect((await projects.policy(owner.actor, p.id)).version).toBe(2);
  });
  it('archives/restores recoverable content and performs only controlled last-custodian deletion', async () => {
    const sole = await person(),
      p = await project(sole),
      t = await task(p.id, sole);
    await projects.lifecycle(sole.actor, p.id, 1, 'archive');
    expect((await projects.read(sole.actor, p.id)).state).toBe('ARCHIVED');
    await expect(
      projects.patchTask(
        sole.actor,
        p.id,
        t.id,
        1,
        { title: 'No' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await projects.lifecycle(sole.actor, p.id, 2, 'restore');
    await expect(
      projects.lifecycle(sole.actor, p.id, 3, 'delete', 'wrong'),
    ).rejects.toHaveProperty('status', 403);
    await projects.lifecycle(sole.actor, p.id, 3, 'delete', password);
    const custody = await client.sharedCustody.findUniqueOrThrow({
      where: { spaceId: p.id },
    });
    expect(custody.state).toBe('CLOSING_GRACE');
    const job = await client.sharedLifecycleJob.findFirstOrThrow({
      where: { custodyId: p.id },
    });
    expect(
      job.recoveryDeadline!.getTime() - job.effectiveDepartureAt.getTime(),
    ).toBe(2592000000);
    expect(await client.task.count({ where: { id: t.id } })).toBe(1);
    await expect(
      projects.source(sole.actor, p.id, 'TASK', t.id),
    ).rejects.toThrow();
    const shared = await project();
    await join(shared.id, member);
    await expect(
      projects.lifecycle(owner.actor, shared.id, 1, 'delete', password),
    ).rejects.toHaveProperty('status', 409);
  });
  it('RACE winning grant revocation fences a previously authorized Task mutation and receipt replay', async () => {
    const p = await project(),
      t = await task(p.id),
      who = await person(),
      accepted = await grant(p.id, { kind: 'TASK', id: t.id }, who, owner, [
        'read',
        'update',
      ]);
    const entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (record) => {
      await append(record);
      if (record.action === 'grant.revoke' && record.outcome === 'INTENT') {
        entered.release();
        await release.promise;
      }
    });
    const revoke = projects.revokeGrant(
      owner.actor,
      p.id,
      accepted.accepted.grant.id,
      1,
    );
    await entered.promise;
    const mutation = outcome(
      projects.patchTask(
        who.actor,
        p.id,
        t.id,
        1,
        { title: 'Late' },
        randomUUID(),
      ),
    );
    await blocked();
    release.release();
    await revoke;
    expect((await mutation).error).toBeDefined();
    expect(
      (await client.task.findUniqueOrThrow({ where: { id: t.id } })).revision,
    ).toBe(1);
  });
  it('RACE mutation-first commits source/history/receipt/audit before waiting revoke', async () => {
    const p = await project(),
      t = await task(p.id),
      who = await person(),
      accepted = await grant(p.id, { kind: 'TASK', id: t.id }, who, owner, [
        'read',
        'update',
      ]);
    const entered = barrier(),
      release = barrier(),
      run = kernel.run.bind(kernel);
    vi.spyOn(kernel, 'run').mockImplementationOnce(
      (actor, locks, requests, work, onRetry) =>
        run(
          actor,
          locks,
          requests,
          async (tx, a) => {
            const value = await work(tx, a);
            entered.release();
            await release.promise;
            return value;
          },
          onRetry,
        ),
    );
    const mutation = projects.patchTask(
      who.actor,
      p.id,
      t.id,
      1,
      { title: 'First' },
      randomUUID(),
    );
    await entered.promise;
    const revoke = projects.revokeGrant(
      owner.actor,
      p.id,
      accepted.accepted.grant.id,
      1,
    );
    await blocked();
    release.release();
    expect((await mutation).revision).toBe(2);
    await revoke;
    expect(
      (await client.task.findUniqueOrThrow({ where: { id: t.id } })).title,
    ).toBe('First');
    await expect(
      projects.source(who.actor, p.id, 'TASK', t.id),
    ).rejects.toThrow();
    expect(await client.taskChange.count({ where: { taskId: t.id } })).toBe(2);
  });
  it('RACE Goal membership revocation wins before a queued source write', async () => {
    const p = await project(),
      g = await goal(p.id),
      manager = await join(p.id, member, 'MANAGER'),
      entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (record) => {
      await append(record);
      if (
        record.action === 'membership.change' &&
        record.outcome === 'INTENT'
      ) {
        entered.release();
        await release.promise;
      }
    });
    const revoke = service.changeMembership(
      owner.actor,
      p.id,
      manager.id,
      manager.revision,
      { state: 'REVOKED', memberRole: 'MANAGER' },
    );
    await entered.promise;
    const mutation = outcome(
      projects.patchGoal(
        member.actor,
        p.id,
        g.id,
        1,
        { title: 'Late' },
        randomUUID(),
      ),
    );
    await blocked();
    release.release();
    await revoke;
    expect((await mutation).error).toBeDefined();
    expect(
      (await client.goal.findUniqueOrThrow({ where: { id: g.id } })).revision,
    ).toBe(1);
  });
  it('rejects expired offers, revoked proofs, unverified recipients and unsupported grant powers without admission', async () => {
    const p = await project(),
      t = await task(p.id),
      who = await person(),
      unverified = await person(undefined, false),
      input = {
        id: randomUUID(),
        recipientUserId: who.actor.userId,
        target: { kind: 'TASK' as const, id: t.id },
        capabilities: ['read' as const],
        grantExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
    const offered = await projects.grantOffer(
      owner.actor,
      p.id,
      input,
      randomUUID(),
    );
    await projects.revokeGrantOffer(owner.actor, p.id, offered.offer.id, 1);
    await expect(
      grants.preview(offered.proof!, projects.validateGrantTarget),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      projects.grantOffer(
        owner.actor,
        p.id,
        {
          ...input,
          id: randomUUID(),
          recipientUserId: unverified.actor.userId,
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
    const expired = await projects.grantOffer(
      owner.actor,
      p.id,
      { ...input, id: randomUUID() },
      randomUUID(),
    );
    await client.$executeRaw`UPDATE "ResourceGrantOffer" SET "createdAt"=statement_timestamp()-interval '8 days',"expiresAt"=statement_timestamp()-interval '1 day',"grantExpiresAt"=statement_timestamp()+interval '1 day' WHERE id=${expired.offer.id}::uuid`;
    await expect(
      grants.decide(
        who.actor,
        expired.offer.id,
        expired.proof!,
        1,
        true,
        projects.validateGrantTarget,
      ),
    ).rejects.toHaveProperty('status', 404);
    expect(await grants.maintain()).toBe(true);
    expect(
      (
        await client.resourceGrantOffer.findUniqueOrThrow({
          where: { id: expired.offer.id },
        })
      ).proofHash,
    ).toBeNull();
    expect(await grants.maintain()).toBe(false);
    expect(
      c.GrantOfferCreateSchema.safeParse({
        ...input,
        capabilities: ['membership.member'],
      }).success,
    ).toBe(false);
  });
  it('DB rejects Personal/shared attribution bypass, foreign association, missing/multiple grant targets and malformed accepted offers', async () => {
    const p = await project(),
      other = await project(),
      t = await task(p.id),
      foreign = await task(other.id),
      who = await person();
    const personal = await spaces.authorizePersonal(owner.actor);
    await expect(
      client.task.create({
        data: {
          spaceId: personal.spaceId,
          title: 'bad',
          createdByUserId: null,
        },
      }),
    ).rejects.toThrow();
    await expect(
      client.goal.create({
        data: {
          spaceId: p.id,
          createdByUserId: null,
          title: 'bad',
          horizon: 'SHORT_TERM',
          timezone: 'UTC',
        },
      }),
    ).rejects.toThrow();
    await expect(
      client.projectTask.update({
        where: { taskId: t.id },
        data: { taskId: foreign.id },
      }),
    ).rejects.toThrow();
    const accepted = await grant(p.id, { kind: 'TASK', id: t.id }, who),
      g = await client.resourceGrant.findUniqueOrThrow({
        where: { id: accepted.accepted.grant.id },
      });
    const missing = randomUUID();
    await expect(
      client.resourceGrant.create({ data: { ...g, id: missing } }),
    ).rejects.toThrow();
    await expect(
      client.projectGrant.create({
        data: { grantId: g.id, spaceId: p.id, scopeId: p.id, projectId: p.id },
      }),
    ).rejects.toThrow();
    await expect(
      client.taskGrant.delete({ where: { grantId: g.id } }),
    ).rejects.toThrow();
    await expect(
      client.resourceGrantOffer.update({
        where: { id: accepted.offer.offer.id },
        data: {
          recipientActorId: (
            await client.sharedActor.findFirstOrThrow({
              where: { spaceId: p.id, userId: owner.actor.userId },
            })
          ).id,
        },
      }),
    ).rejects.toThrow();
  });
  it('ends only guest admission on explicit departure, invalidates old grants and permits explicit new generation', async () => {
    const p = await project(),
      t = await task(p.id),
      who = await person(),
      accepted = await grant(p.id, { kind: 'TASK', id: t.id }, who);
    const safe = c.GrantOfferAcceptanceSchema.parse(accepted.accepted);
    expect(safe.admission.memberRole).toBeNull();
    await projects.leaveCollaboration(who.actor, p.id, safe.admission.revision);
    await expect(
      projects.source(who.actor, p.id, 'TASK', t.id),
    ).rejects.toThrow();
    await expect(
      grants.decide(
        who.actor,
        accepted.offer.offer.id,
        accepted.offer.proof!,
        1,
        true,
        projects.validateGrantTarget,
      ),
    ).rejects.toThrow();
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: p.id },
        })
      ).state,
    ).toBe('ACTIVE');
    expect(
      await client.sharedLifecycleJob.count({ where: { spaceId: p.id } }),
    ).toBe(0);
    const rejoined = await grant(p.id, { kind: 'TASK', id: t.id }, who);
    expect(rejoined.accepted.admission.generation).toBe(
      safe.admission.generation + 1,
    );
    await expect(
      projects.leaveCollaboration(owner.actor, p.id, 1),
    ).rejects.toHaveProperty('status', 409);
  });
  it('a complete-only grant cannot cancel or otherwise edit a Task', async () => {
    const p = await project(),
      t = await task(p.id),
      who = await person();
    await grant(p.id, { kind: 'TASK', id: t.id }, who, owner, [
      'read',
      'complete',
    ]);
    await expect(
      projects.patchTask(
        who.actor,
        p.id,
        t.id,
        1,
        { status: 'CANCELED' },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    expect(
      (
        await projects.patchTask(
          who.actor,
          p.id,
          t.id,
          1,
          { status: 'DONE' },
          randomUUID(),
        )
      ).status,
    ).toBe('DONE');
  });
  it('enforces fresh session, suspension and database-time grant expiry over cached resource authority', async () => {
    const p = await project(),
      t = await task(p.id),
      who = await person(),
      accepted = await grant(p.id, { kind: 'TASK', id: t.id }, who, owner, [
        'read',
        'update',
      ]);
    await client.authSession.update({
      where: { id: who.actor.sessionId! },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      projects.source(who.actor, p.id, 'TASK', t.id),
    ).rejects.toThrow();
    await client.authSession.update({
      where: { id: who.actor.sessionId! },
      data: { expiresAt: new Date(Date.now() + 86400000) },
    });
    await client.contextAccess.update({
      where: { id: accepted.accepted.grant.granteeAccessId },
      data: { state: 'SUSPENDED', revision: { increment: 1 } },
    });
    await expect(
      projects.source(who.actor, p.id, 'TASK', t.id),
    ).rejects.toThrow();
    await client.contextAccess.update({
      where: { id: accepted.accepted.grant.granteeAccessId },
      data: { state: 'ACTIVE', revision: { increment: 1 } },
    });
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "ResourceGrant" SET "expiresAt"=statement_timestamp()-interval '1 second' WHERE id=${accepted.accepted.grant.id}::uuid`;
      await tx.$executeRaw`UPDATE "ResourceGrantOffer" SET "createdAt"=statement_timestamp()-interval '8 days',"expiresAt"=statement_timestamp()-interval '1 day',"grantExpiresAt"=(SELECT "expiresAt" FROM "ResourceGrant" WHERE id=${accepted.accepted.grant.id}::uuid) WHERE id=${accepted.offer.offer.id}::uuid`;
    });
    await expect(
      projects.source(who.actor, p.id, 'TASK', t.id),
    ).rejects.toThrow();
    expect(
      (await client.task.findUniqueOrThrow({ where: { id: t.id } })).revision,
    ).toBe(1);
  });
  it('preserves shared Task/Goal and Project creator attribution through lawful former-owner identity erasure', async () => {
    const creator = await person(),
      successor = await person(),
      p = await project(creator),
      t = await task(p.id, creator),
      g = await goal(p.id, creator),
      memberAccess = await join(p.id, successor, 'MEMBER', creator);
    const handover = await service.createHandover(
      creator.actor,
      p.id,
      { successorAccessId: memberAccess.id },
      randomUUID(),
    );
    await service.decideHandover(
      successor.actor,
      p.id,
      handover.id,
      1,
      'accept',
      password,
    );
    const personal = await spaces.authorizePersonal(creator.actor);
    await client.$transaction((tx) => spaces.setClosed(tx, personal, true));
    expect(
      await kernel.prepareIdentityErasure(creator.actor.userId, new Date()),
    ).toBe(false);
    expect(
      await kernel.prepareIdentityErasure(creator.actor.userId, new Date()),
    ).toBe(true);
    await client.$transaction(async (tx) => {
      await spaces.erase(tx, personal);
      await auth.eraseIdentityInside(tx, creator.actor.userId);
    });
    expect(
      await client.user.count({ where: { id: creator.actor.userId } }),
    ).toBe(0);
    expect(
      (
        await client.sharedActor.findUniqueOrThrow({
          where: { id: t.createdByActorId },
        })
      ).userId,
    ).toBeNull();
    expect(
      (await projects.source(successor.actor, p.id, 'TASK', t.id)).id,
    ).toBe(t.id);
    expect(
      (await projects.source(successor.actor, p.id, 'GOAL', g.id)).id,
    ).toBe(g.id);
    const usage = await client.sharedUsageEntry.aggregate({
      where: {
        spaceId: p.id,
        feature: 'shared.custody',
        subjectActorId: memberAccess.actorId,
      },
      _sum: { delta: true },
    });
    expect(usage._sum.delta).toBe(1);
  });
  it('executes free-mode feature decisions under the source transaction and preserves atomic usage on denial/replay', async () => {
    const policy = app.get(SharedFeaturePolicy),
      decision = vi.spyOn(policy, 'decide'),
      who = await person(),
      p = await project(who);
    expect(decision).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'shared.custody',
        usageOwner: { kind: 'PERSONAL_ACCOUNT', userId: who.actor.userId },
      }),
      expect.anything(),
    );
    decision.mockResolvedValueOnce({ allowed: false, mode: 'FREE' });
    const id = randomUUID();
    await expect(
      projects.createTask(
        who.actor,
        p.id,
        { id, title: 'Denied fixture', priority: 'NONE' },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    expect(await client.task.count({ where: { id } })).toBe(0);
    const input = {
        id: randomUUID(),
        title: 'Free source',
        priority: 'NONE' as const,
      },
      key = randomUUID();
    await projects.createTask(who.actor, p.id, input, key);
    await projects.createTask(who.actor, p.id, input, key);
    expect(decision).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'task.shared',
        usageOwner: { kind: 'SHARED_CUSTODY', spaceId: p.id },
      }),
      expect.anything(),
    );
    expect(
      await client.sharedUsageEntry.count({
        where: { spaceId: p.id, feature: 'task.shared' },
      }),
    ).toBe(1);
  });
  it('RACE Task membership removal wins before queued mutation and rejects a prior safe receipt', async () => {
    const p = await project(),
      t = await task(p.id),
      m = await join(p.id, member),
      key = randomUUID();
    await projects.patchTask(
      member.actor,
      p.id,
      t.id,
      1,
      { title: 'Before' },
      key,
    );
    const entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (record) => {
      await append(record);
      if (
        record.action === 'membership.change' &&
        record.outcome === 'INTENT'
      ) {
        entered.release();
        await release.promise;
      }
    });
    const revoke = service.changeMembership(
      owner.actor,
      p.id,
      m.id,
      m.revision,
      { state: 'REVOKED', memberRole: 'MEMBER' },
    );
    await entered.promise;
    const mutation = outcome(
      projects.patchTask(member.actor, p.id, t.id, 1, { title: 'Before' }, key),
    );
    await blocked();
    release.release();
    await revoke;
    expect((await mutation).error).toBeDefined();
    expect(
      (await client.task.findUniqueOrThrow({ where: { id: t.id } })).revision,
    ).toBe(2);
  });
  it('RACE policy removal wins before a shared Task mutation', async () => {
    const p = await project(),
      t = await task(p.id);
    await join(p.id, member);
    const policy = await projects.policy(owner.actor, p.id),
      entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (record) => {
      await append(record);
      if (record.action === 'policy.publish' && record.outcome === 'INTENT') {
        entered.release();
        await release.promise;
      }
    });
    const removal = projects.publishPolicy(owner.actor, p.id, policy.version, {
      roleDefaults: { ...policy.roleDefaults, MEMBER: ['task.read'] },
      exportMaxBytes: policy.exportMaxBytes,
      exportMaxRecords: policy.exportMaxRecords,
    });
    await entered.promise;
    const mutation = outcome(
      projects.patchTask(
        member.actor,
        p.id,
        t.id,
        1,
        { title: 'Late' },
        randomUUID(),
      ),
    );
    await blocked();
    release.release();
    await removal;
    expect((await mutation).error).toBeDefined();
    expect(
      (await client.task.findUniqueOrThrow({ where: { id: t.id } })).revision,
    ).toBe(1);
  });
  it('never revives issued grants after issuer demotion/promotion or ordinary-policy removal/repair', async () => {
    const p = await project(),
      m = await join(p.id, member, 'MANAGER'),
      t = await task(p.id),
      who = await person();
    const first = await grant(p.id, { kind: 'TASK', id: t.id }, who, member, [
      'read',
      'update',
    ]);
    const demoted = await service.changeMembership(
      owner.actor,
      p.id,
      m.id,
      m.revision,
      { state: 'ACTIVE', memberRole: 'MEMBER' },
    );
    await service.changeMembership(owner.actor, p.id, m.id, demoted.revision, {
      state: 'ACTIVE',
      memberRole: 'MANAGER',
    });
    expect(
      (
        await client.resourceGrant.findUniqueOrThrow({
          where: { id: first.accepted.grant.id },
        })
      ).revokedAt,
    ).not.toBeNull();
    await expect(
      projects.source(who.actor, p.id, 'TASK', t.id),
    ).rejects.toThrow();
    const second = await grant(p.id, { kind: 'TASK', id: t.id }, who, member, [
        'read',
        'update',
      ]),
      policy = await projects.policy(owner.actor, p.id);
    const reduced = await projects.publishPolicy(
      owner.actor,
      p.id,
      policy.version,
      {
        roleDefaults: { ...policy.roleDefaults, MANAGER: ['task.read'] },
        exportMaxRecords: policy.exportMaxRecords,
        exportMaxBytes: policy.exportMaxBytes,
      },
    );
    await projects.publishPolicy(owner.actor, p.id, reduced.version, {
      roleDefaults: policy.roleDefaults,
      exportMaxRecords: policy.exportMaxRecords,
      exportMaxBytes: policy.exportMaxBytes,
    });
    expect(
      (
        await client.resourceGrant.findUniqueOrThrow({
          where: { id: second.accepted.grant.id },
        })
      ).revokedAt,
    ).not.toBeNull();
    await expect(
      projects.source(who.actor, p.id, 'TASK', t.id),
    ).rejects.toThrow();
    await grant(p.id, { kind: 'TASK', id: t.id }, who, member, [
      'read',
      'update',
    ]);
    expect((await projects.source(who.actor, p.id, 'TASK', t.id)).id).toBe(
      t.id,
    );
  });
  it('enforces the Viewer write ceiling even over a typed grant inserted by a trusted fixture', async () => {
    const p = await project(),
      v = await join(p.id, viewer, 'VIEWER'),
      t = await task(p.id);
    await expect(
      projects.grantOffer(
        owner.actor,
        p.id,
        {
          id: randomUUID(),
          recipientUserId: viewer.actor.userId,
          target: { kind: 'TASK', id: t.id },
          capabilities: ['read', 'update'],
          grantExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 400);
    const custody = await client.sharedCustody.findUniqueOrThrow({
        where: { spaceId: p.id },
      }),
      id = randomUUID();
    await client.$transaction(async (tx) => {
      await tx.resourceGrant.create({
        data: {
          id,
          spaceId: p.id,
          scopeId: p.id,
          issuerAccessId: custody.primaryOwnerAccessId!,
          issuerGeneration: 1,
          granteeAccessId: v.id,
          granteeGeneration: v.generation,
          capabilities: ['read', 'update'],
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      await tx.taskGrant.create({
        data: { grantId: id, spaceId: p.id, scopeId: p.id, taskId: t.id },
      });
    });
    await expect(
      projects.patchTask(
        viewer.actor,
        p.id,
        t.id,
        1,
        { title: 'Cannot bypass ceiling' },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    expect(
      (await client.task.findUniqueOrThrow({ where: { id: t.id } })).revision,
    ).toBe(1);
  });
  it('signs cursors and binds actor, scope, collection and current authorization before source pagination', async () => {
    const who = await person(),
      peer = await person(),
      p = await project(who),
      other = await project(who);
    const peerAccess = await join(p.id, peer, 'MEMBER', who);
    await task(p.id, who);
    await task(p.id, who);
    const first = c.SharedTaskPageSchema.parse(
      await projects.sources(who.actor, p.id, 'TASK', { limit: 1 }),
    );
    expect(first.nextCursor).not.toBeNull();
    const second = c.SharedTaskPageSchema.parse(
      await projects.sources(who.actor, p.id, 'TASK', {
        limit: 1,
        after: first.nextCursor!,
      }),
    );
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    await expect(
      projects.sources(peer.actor, p.id, 'TASK', {
        limit: 1,
        after: first.nextCursor!,
      }),
    ).rejects.toHaveProperty('status', 400);
    await expect(
      projects.sources(who.actor, other.id, 'TASK', {
        limit: 1,
        after: first.nextCursor!,
      }),
    ).rejects.toHaveProperty('status', 400);
    await expect(
      projects.sources(who.actor, p.id, 'GOAL', {
        limit: 1,
        after: first.nextCursor!,
      }),
    ).rejects.toHaveProperty('status', 400);
    const forged = JSON.parse(
      Buffer.from(first.nextCursor!, 'base64url').toString('utf8'),
    ) as { body: string };
    forged.body = JSON.stringify({
      ...(JSON.parse(forged.body) as object),
      after: randomUUID(),
    });
    await expect(
      projects.sources(who.actor, p.id, 'TASK', {
        limit: 1,
        after: Buffer.from(JSON.stringify(forged)).toString('base64url'),
      }),
    ).rejects.toHaveProperty('status', 400);
    const peerPage = c.SharedTaskPageSchema.parse(
      await projects.sources(peer.actor, p.id, 'TASK', { limit: 1 }),
    );
    await service.leave(peer.actor, p.id, peerAccess.revision);
    const rejoined = await join(p.id, peer, 'MEMBER', who);
    expect(rejoined.generation).toBe(2);
    await expect(
      projects.sources(peer.actor, p.id, 'TASK', {
        limit: 1,
        after: peerPage.nextCursor!,
      }),
    ).rejects.toHaveProperty('status', 409);
    const global = await projects.list(who.actor, { limit: 1 });
    expect(global.nextCursor).not.toBeNull();
    await project(who);
    await expect(
      projects.list(who.actor, { limit: 1, after: global.nextCursor! }),
    ).rejects.toHaveProperty('status', 409);
  });
  it('bounds pending offers and live grants per recipient/target independently of commercial entitlements', async () => {
    const p = await project(),
      t = await task(p.id),
      who = await person(),
      input = {
        id: randomUUID(),
        recipientUserId: who.actor.userId,
        target: { kind: 'TASK' as const, id: t.id },
        capabilities: ['read' as const],
        grantExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
    const offered = await projects.grantOffer(
        owner.actor,
        p.id,
        input,
        randomUUID(),
      ),
      template = await client.resourceGrantOffer.findUniqueOrThrow({
        where: { id: offered.offer.id },
      });
    await client.resourceGrantOffer.createMany({
      data: Array.from({ length: 99 }, () => ({
        ...template,
        id: randomUUID(),
        proofHash: createHash('sha256').update(randomUUID()).digest('hex'),
        keyHash: createHash('sha256').update(randomUUID()).digest('hex'),
      })),
    });
    await expect(
      projects.grantOffer(
        owner.actor,
        p.id,
        { ...input, id: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    const accepted = c.GrantOfferAcceptanceSchema.parse(
        await grants.decide(
          who.actor,
          offered.offer.id,
          offered.proof!,
          1,
          true,
          projects.validateGrantTarget,
        ),
      ),
      g = await client.resourceGrant.findUniqueOrThrow({
        where: { id: accepted.grant.id },
      });
    await client.$transaction(async (tx) => {
      for (let n = 0; n < 99; n++) {
        const id = randomUUID();
        await tx.resourceGrant.create({ data: { ...g, id } });
        await tx.taskGrant.create({
          data: { grantId: id, spaceId: p.id, scopeId: p.id, taskId: t.id },
        });
      }
    });
    const fresh = await projects.grantOffer(
      owner.actor,
      p.id,
      { ...input, id: randomUUID() },
      randomUUID(),
    );
    await expect(
      grants.decide(
        who.actor,
        fresh.offer.id,
        fresh.proof!,
        1,
        true,
        projects.validateGrantTarget,
      ),
    ).rejects.toHaveProperty('status', 403);
    expect(await client.resourceGrant.count({ where: { spaceId: p.id } })).toBe(
      100,
    );
  });
  it('HTTP validates actual Project and source contracts, Origin, revisions, strict envelopes and redacted proof headers', async () => {
    const input = {
        id: randomUUID(),
        title: 'HTTP Project',
        retentionPolicyVersion: version,
      },
      server = app.getHttpServer();
    await request(server)
      .post('/api/v1/projects')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, companyId: randomUUID() })
      .expect(400);
    const created = await request(server)
      .post('/api/v1/projects')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(201);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.headers.etag).toBe('"1"');
    await request(server)
      .patch('/api/v1/projects/' + input.id)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({ title: 'missing revision' })
      .expect(400);
    await request(server)
      .patch('/api/v1/projects/' + input.id)
      .set('Cookie', owner.cookie)
      .set('Origin', 'https://untrusted.example')
      .set('If-Match', '"1"')
      .send({ title: 'No' })
      .expect(403);
    const t = await request(server)
      .post('/api/v1/projects/' + input.id + '/tasks')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({ id: randomUUID(), title: 'HTTP Task' })
      .expect(201);
    expect(c.SharedTaskSchema.safeParse(t.body).success).toBe(true);
    await request(server)
      .get('/api/v1/projects/' + input.id + '/tasks')
      .set('Cookie', viewer.cookie)
      .expect(404);
    const offered = await request(server)
      .post('/api/v1/projects/' + input.id + '/resource-invitations')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        id: randomUUID(),
        recipientUserId: member.actor.userId,
        target: { kind: 'TASK', id: t.body.id },
        capabilities: ['read'],
        grantExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      })
      .expect(201);
    await request(server)
      .get('/api/v1/resource-invitations/preview')
      .query({ proof: offered.body.proof })
      .expect(400);
    const preview = await request(server)
      .get('/api/v1/resource-invitations/preview')
      .set('X-Invitation-Proof', offered.body.proof)
      .expect(200);
    expect(Object.keys(preview.body).sort()).toEqual([
      'contextLabel',
      'expiresAt',
      'offerCategory',
    ]);
    await request(server)
      .post('/api/v1/resource-invitations/' + offered.body.offer.id + '/accept')
      .set('Cookie', member.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .set('X-Invitation-Proof', offered.body.proof)
      .send({})
      .expect(201);
    await request(server)
      .get('/api/v1/projects/' + input.id + '/tasks/' + t.body.id)
      .set('Cookie', member.cookie)
      .expect(200);
  });
});
