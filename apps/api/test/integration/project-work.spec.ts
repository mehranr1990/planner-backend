import { WorkService } from '../../src/modules/projects/public/index.js';
import { BadRequestException } from '@nestjs/common';
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
describe('P2-04 assignment, work projections and private scheduling', () => {
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
    grants: ResourceGrants,
    work: WorkService;
  let owner: Person,
    member: Person,
    viewer: Person,
    outsider: Person,
    passwordHash: string;
  const password = 'synthetic-p202-password-123!',
    origin = 'http://localhost:3000',
    name = 'p204-' + randomUUID(),
    version = 'synthetic-p204-' + randomUUID();
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P204-ONLY',
      },
    });
    control = app.get(SharedControl);
    await control.initialize();
    service = app.get(CollaborationService);
    projects = app.get(ProjectsService);
    work = app.get(WorkService);
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

  async function assignment(
    pid: string,
    tid: string,
    who = member,
    kind: 'PRIMARY' | 'CONTRIBUTOR' = 'PRIMARY',
  ) {
    const access = await join(pid, who);
    const source = await client.task.findUniqueOrThrow({ where: { id: tid } });
    return work.create(
      owner.actor,
      pid,
      tid,
      source.revision,
      {
        id: randomUUID(),
        recipientAccessId: access.id,
        recipientGeneration: access.generation,
        kind,
      },
      randomUUID(),
    );
  }
  async function privateBlock(who = member) {
    const space = await spaces.personalFor(who.actor.userId);
    return client.timeBlock.create({
      data: {
        spaceId: space.id,
        createdByUserId: who.actor.userId,
        title: 'User private title',
        kind: 'TIMED',
        timezone: 'Asia/Tehran',
        localStart: '2026-11-05T09:00',
        localEnd: '2026-11-05T10:00',
        startAt: new Date('2026-11-05T05:30:00Z'),
        endAt: new Date('2026-11-05T06:30:00Z'),
      },
    });
  }
  it('keeps pending assignments in authorized preview and accepted work in a separate source projection', async () => {
    const p = await project(),
      t = await task(p.id),
      row = await assignment(p.id, t.id);
    expect(row.decision).toBe('PENDING');
    const pending = await work.pending(member.actor, { limit: 25 });
    expect(
      pending.items.find((x) => x.assignment.id === row.id)!.preview,
    ).toEqual({ id: t.id, spaceId: p.id, title: t.title, revision: 1 });
    expect(
      pending.items.find((x) => x.assignment.id === row.id),
    ).not.toHaveProperty('task');
    expect(
      (await work.taskProjection(member.actor, { limit: 25, projectId: p.id }))
        .items,
    ).toEqual([]);
    const accepted = await work.respond(member.actor, p.id, t.id, row.id, 1, {
      decision: 'ACCEPTED',
    });
    expect(accepted.decision).toBe('ACCEPTED');
    expect(
      (
        await work.respond(member.actor, p.id, t.id, row.id, 1, {
          decision: 'ACCEPTED',
        })
      ).revision,
    ).toBe(2);
    const projected = (
      await work.taskProjection(member.actor, { limit: 25, projectId: p.id })
    ).items;
    expect(projected).toHaveLength(1);
    expect(projected[0]!.id).toBe(t.id);
    expect(projected[0]!.task.status).toBe('OPEN');
    expect(await client.task.count({ where: { id: t.id } })).toBe(1);
    expect(await client.taskChange.count({ where: { taskId: t.id } })).toBe(1);
    expect(
      (
        await client.sharedUsageEntry.aggregate({
          where: { spaceId: p.id, feature: 'task.assignment' },
          _sum: { delta: true },
        })
      )._sum.delta,
    ).toBe(1);
    const personal = await request(app.getHttpServer())
      .get('/api/v1/tasks')
      .set('Cookie', member.cookie)
      .expect(200);
    expect(JSON.stringify(personal.body)).not.toContain(t.id);
  });
  it('enforces named recipients, current roles, generations and explicit reasoned decline', async () => {
    const p = await project(),
      t = await task(p.id),
      row = await assignment(p.id, t.id);
    await join(p.id, viewer, 'VIEWER');
    await expect(
      work.respond(owner.actor, p.id, t.id, row.id, 1, {
        decision: 'ACCEPTED',
      }),
    ).rejects.toThrow();
    await expect(
      work.respond(viewer.actor, p.id, t.id, row.id, 1, {
        decision: 'ACCEPTED',
      }),
    ).rejects.toThrow();
    await expect(
      work.create(
        member.actor,
        p.id,
        t.id,
        1,
        {
          id: randomUUID(),
          recipientAccessId: row.recipientAccessId,
          recipientGeneration: row.recipientGeneration,
          kind: 'CONTRIBUTOR',
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await expect(
      work.respond(member.actor, p.id, t.id, row.id, 1, {
        decision: 'DECLINED',
        reason: ' ',
      }),
    ).rejects.toThrow();
    const declined = await work.respond(member.actor, p.id, t.id, row.id, 1, {
      decision: 'DECLINED',
      reason: 'Capacity unavailable',
    });
    expect(declined).toMatchObject({
      decision: 'DECLINED',
      declineReason: 'Capacity unavailable',
      endReason: 'DECLINED',
      revision: 2,
    });
    expect(
      (await work.taskProjection(member.actor, { limit: 25, projectId: p.id }))
        .items,
    ).toEqual([]);
    expect(
      (await client.task.findUniqueOrThrow({ where: { id: t.id } })).status,
    ).toBe('OPEN');
    expect(
      (await work.inbox(owner.actor, { limit: 100 })).items.some(
        (n) => n.assignmentId === row.id && n.kind === 'DECLINED',
      ),
    ).toBe(true);
  });
  it('enforces one current primary, distinct contributors and immutable reassignment history', async () => {
    const p = await project(),
      t = await task(p.id),
      first = await assignment(p.id, t.id);
    await work.respond(member.actor, p.id, t.id, first.id, 1, {
      decision: 'ACCEPTED',
    });
    const other = await person(),
      admission = await join(p.id, other);
    await expect(
      work.create(
        owner.actor,
        p.id,
        t.id,
        1,
        {
          id: randomUUID(),
          recipientAccessId: admission.id,
          recipientGeneration: 1,
          kind: 'PRIMARY',
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const next = await work.reassign(
      owner.actor,
      p.id,
      t.id,
      first.id,
      2,
      {
        id: randomUUID(),
        recipientAccessId: admission.id,
        recipientGeneration: 1,
        sourceRevision: 1,
      },
      randomUUID(),
    );
    expect(next.decision).toBe('PENDING');
    const old = await client.taskAssignment.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(old).toMatchObject({
      decision: 'ACCEPTED',
      endReason: 'REASSIGNED',
      revision: 3,
    });
    expect(old.respondedAt).not.toBeNull();
    expect(
      (await work.taskProjection(member.actor, { limit: 25, projectId: p.id }))
        .items,
    ).toEqual([]);
    const contribute = await work.create(
      owner.actor,
      p.id,
      t.id,
      1,
      {
        id: randomUUID(),
        recipientAccessId: first.recipientAccessId,
        recipientGeneration: first.recipientGeneration,
        kind: 'CONTRIBUTOR',
      },
      randomUUID(),
    );
    await work.respond(member.actor, p.id, t.id, contribute.id, 1, {
      decision: 'ACCEPTED',
    });
    expect(
      (
        await work.taskProjection(member.actor, { limit: 25, projectId: p.id })
      ).items.map((x) => x.id),
    ).toEqual([t.id]);
    await expect(
      client.taskAssignment.update({
        where: { id: first.id },
        data: { decision: 'DECLINED', revision: 4 },
      }),
    ).rejects.toThrow();
  });
  it('preserves durable create replay and atomically rolls back notices, usage, audit and outbox on failure', async () => {
    const p = await project(),
      t = await task(p.id),
      m = await join(p.id, member),
      id = randomUUID(),
      key = randomUUID(),
      input = {
        id,
        recipientAccessId: m.id,
        recipientGeneration: m.generation,
        kind: 'PRIMARY' as const,
      };
    const notices = app.get(
      (await import('../../src/modules/notifications/public/index.js'))
        .SharedWorkNotifications,
    );
    const fail = vi
      .spyOn(notices, 'append')
      .mockRejectedValueOnce(
        new BadRequestException('synthetic notice failure'),
      );
    await expect(
      work.create(owner.actor, p.id, t.id, 1, input, key),
    ).rejects.toThrow();
    fail.mockRestore();
    expect(await client.taskAssignment.count({ where: { id } })).toBe(0);
    expect(
      await client.sharedUsageEntry.count({
        where: { spaceId: p.id, feature: 'task.assignment' },
      }),
    ).toBe(0);
    const created = await work.create(owner.actor, p.id, t.id, 1, input, key);
    await client.sharedMutationReceipt.deleteMany({ where: { spaceId: p.id } });
    const audit = await client.sharedAuditEvent.count({
      where: { spaceId: p.id },
    });
    expect((await work.create(owner.actor, p.id, t.id, 1, input, key)).id).toBe(
      created.id,
    );
    expect(
      await client.sharedAuditEvent.count({ where: { spaceId: p.id } }),
    ).toBe(audit);
    expect(
      await client.sharedAssignmentNotification.count({
        where: { assignmentId: id },
      }),
    ).toBe(1);
    await expect(
      work.create(
        owner.actor,
        p.id,
        t.id,
        1,
        { ...input, id: randomUUID() },
        key,
      ),
    ).rejects.toThrow();
    const raw = await client.sharedAssignmentNotification.findFirstOrThrow({
      where: { assignmentId: id },
    });
    expect(raw).not.toHaveProperty('title');
  });
  it('filters shared Goals by current full-scope or exact Goal grant without inventing assignment states', async () => {
    const p = await project(),
      g = await goal(p.id),
      other = await goal(p.id);
    await grant(p.id, { kind: 'GOAL', id: g.id });
    const guests = await work.goalProjection(outsider.actor, {
      limit: 25,
      projectId: p.id,
    });
    expect(guests.items.map((x) => x.id)).toEqual([g.id]);
    expect(guests.items[0]).not.toHaveProperty('assignment');
    await join(p.id, member);
    expect(
      (
        await work.goalProjection(member.actor, { limit: 25, projectId: p.id })
      ).items
        .map((x) => x.id)
        .sort(),
    ).toEqual([g.id, other.id].sort());
    const grantRow = await client.resourceGrant.findFirstOrThrow({
      where: { spaceId: p.id },
    });
    await projects.revokeGrant(owner.actor, p.id, grantRow.id, 1);
    expect(
      (
        await work.goalProjection(outsider.actor, {
          limit: 25,
          projectId: p.id,
        })
      ).items,
    ).toEqual([]);
  });
  it('binds projection cursors to query, actor and current authorization and applies source filters before pagination', async () => {
    const p = await project(),
      t = await task(p.id),
      u = await task(p.id),
      a = await assignment(p.id, t.id);
    await work.respond(member.actor, p.id, t.id, a.id, 1, {
      decision: 'ACCEPTED',
    });
    const b = await work.create(
      owner.actor,
      p.id,
      u.id,
      1,
      {
        id: randomUUID(),
        recipientAccessId: a.recipientAccessId,
        recipientGeneration: a.recipientGeneration,
        kind: 'CONTRIBUTOR',
      },
      randomUUID(),
    );
    await work.respond(member.actor, p.id, u.id, b.id, 1, {
      decision: 'ACCEPTED',
    });
    const first = await work.taskProjection(member.actor, {
      limit: 1,
      projectId: p.id,
    });
    expect(first.nextCursor).not.toBeNull();
    const second = await work.taskProjection(member.actor, {
      limit: 1,
      projectId: p.id,
      after: first.nextCursor!,
    });
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    await expect(
      work.taskProjection(owner.actor, {
        limit: 1,
        projectId: p.id,
        after: first.nextCursor!,
      }),
    ).rejects.toThrow();
    await expect(
      work.taskProjection(member.actor, {
        limit: 1,
        status: 'DONE',
        projectId: p.id,
        after: first.nextCursor!,
      }),
    ).rejects.toThrow();
    await projects.patchTask(
      member.actor,
      p.id,
      t.id,
      1,
      { status: 'DONE' },
      randomUUID(),
    );
    expect(
      (
        await work.taskProjection(member.actor, {
          limit: 1,
          status: 'DONE',
          projectId: p.id,
        })
      ).items.map((x) => x.id),
    ).toEqual([t.id]);
    await expect(
      work.taskProjection(member.actor, {
        limit: 1,
        projectId: p.id,
        after: first.nextCursor!,
      }),
    ).rejects.toThrow();
  });
  it('projects only accepted work into selected calendar overlays with local dates and explicit source schedules', async () => {
    const p = await project(),
      t = await task(p.id);
    await work.schedule(owner.actor, p.id, t.id, {
      revision: 1,
      value: {
        plannedStartAt: '2026-11-04T23:30:00Z',
        dueAt: '2026-11-05T00:30:00Z',
        scheduledDate: null,
      },
    });
    const row = await assignment(p.id, t.id);
    const q = {
      limit: 25,
      from: '2026-11-05',
      to: '2026-11-06',
      timezone: 'Asia/Tehran',
      projectIds: [p.id],
    };
    expect((await work.overlays(member.actor, q)).items).toEqual([]);
    await work.respond(member.actor, p.id, t.id, row.id, 1, {
      decision: 'ACCEPTED',
    });
    expect(
      (await work.taskProjection(member.actor, { limit: 25, projectId: p.id }))
        .items[0]!.schedule.plannedStartAt,
    ).toBe('2026-11-04T23:30:00.000Z');
    const overlays = await work.overlays(member.actor, q);
    expect(overlays.items).toHaveLength(1);
    expect(overlays.items[0]).toMatchObject({
      id: t.id,
      date: '2026-11-05',
      kind: 'TIMED',
      sourceRevision: 2,
    });
    expect(
      (await work.overlays(member.actor, { ...q, timezone: 'UTC' })).items,
    ).toEqual([]);
    expect(
      (await work.overlays(member.actor, { ...q, projectIds: [randomUUID()] }))
        .items,
    ).toEqual([]);
    expect(
      c.WorkOverlayQuerySchema.safeParse({
        limit: 25,
        from: '2026-01-01',
        to: '2026-05-01',
        timezone: 'UTC',
      }).success,
    ).toBe(false);
    await work.revoke(owner.actor, p.id, t.id, row.id, 2);
    expect((await work.overlays(member.actor, q)).items).toEqual([]);
  });
  it('retains user-owned private scheduling after revocation and exports only the private reference metadata', async () => {
    const p = await project(),
      t = await task(p.id),
      row = await assignment(p.id, t.id),
      block = await privateBlock();
    const linked = await work.block(member.actor, block.id, {
      revision: 1,
      value: { spaceId: p.id, taskId: t.id, sourceRevision: 1 },
    });
    expect(linked.availability).toBe('AVAILABLE');
    expect(
      (await client.timeBlock.findUniqueOrThrow({ where: { id: block.id } }))
        .title,
    ).toBe('User private title');
    await expect(work.block(owner.actor, block.id)).rejects.toThrow();
    const { CalendarData } =
      await import('../../src/modules/calendar/public/index.js');
    const { ExportBudget } =
      await import('../../src/platform/lifecycle/personal-data.js');
    const budget = new ExportBudget(),
      scope = await spaces.authorizePersonal(member.actor);
    await client.$transaction((tx) =>
      app.get(CalendarData).snapshot(tx, scope, budget),
    );
    expect(JSON.stringify(budget.sections.timeBlockSharedTaskLink)).toContain(
      t.id,
    );
    expect(JSON.stringify(budget.sections)).not.toContain(t.title);
    await service.changeMembership(
      owner.actor,
      p.id,
      row.recipientAccessId,
      1,
      { state: 'REVOKED', memberRole: 'MEMBER' },
    );
    const unavailable = await work.block(member.actor, block.id);
    expect(unavailable.availability).toBe('UNAVAILABLE');
    expect(unavailable.source).toBeNull();
    expect(
      (await client.timeBlock.findUniqueOrThrow({ where: { id: block.id } }))
        .title,
    ).toBe('User private title');
    const unlinked = await work.block(member.actor, block.id, {
      revision: 2,
      value: null,
    });
    expect(unlinked.availability).toBe('UNLINKED');
    expect(await client.task.count({ where: { id: t.id } })).toBe(1);
  });
  it('rejects mixed Personal/shared block links and same-context or generation reference forgeries in the database', async () => {
    const p = await project(),
      t = await task(p.id),
      row = await assignment(p.id, t.id),
      block = await privateBlock();
    await work.block(member.actor, block.id, {
      revision: 1,
      value: { spaceId: p.id, taskId: t.id, sourceRevision: 1 },
    });
    await expect(
      client.timeBlock.update({
        where: { id: block.id },
        data: { taskId: t.id, selectedTaskRevision: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      client.taskAssignment.update({
        where: { id: row.id },
        data: { recipientGeneration: 2, revision: 2 },
      }),
    ).rejects.toThrow();
    const raw = await client.taskAssignment.findUniqueOrThrow({
      where: { id: row.id },
    });
    await expect(
      client.taskAssignment.create({
        data: {
          ...raw,
          id: randomUUID(),
          creationKey: 'a'.repeat(64),
          recipientGeneration: 99,
        },
      }),
    ).rejects.toThrow();
    await expect(
      client.timeBlockSharedTaskLink.update({
        where: { blockId: block.id },
        data: { ownerUserId: owner.actor.userId },
      }),
    ).rejects.toThrow();
    await expect(
      client.taskAssignment.update({
        where: { id: row.id },
        data: {
          decision: 'DECLINED',
          respondedAt: new Date(),
          endedAt: new Date(),
          endReason: 'DECLINED',
          declineReason: null,
          revision: 2,
        },
      }),
    ).rejects.toThrow();
  });
  it('denies old assignment generations, suspended access and revoked sessions without source or notice effects', async () => {
    const p = await project(),
      t = await task(p.id),
      row = await assignment(p.id, t.id);
    await service.changeMembership(
      owner.actor,
      p.id,
      row.recipientAccessId,
      1,
      { state: 'SUSPENDED', memberRole: 'MEMBER' },
    );
    await expect(
      work.respond(member.actor, p.id, t.id, row.id, 1, {
        decision: 'ACCEPTED',
      }),
    ).rejects.toThrow();
    await service.changeMembership(
      owner.actor,
      p.id,
      row.recipientAccessId,
      2,
      { state: 'REVOKED', memberRole: 'MEMBER' },
    );
    await join(p.id, member);
    await expect(
      work.respond(member.actor, p.id, t.id, row.id, 1, {
        decision: 'ACCEPTED',
      }),
    ).rejects.toThrow();
    expect(
      (await work.pending(member.actor, { limit: 100 })).items.some(
        (x) => x.assignment.id === row.id,
      ),
    ).toBe(false);
    const who = await person(),
      r = await assignment(p.id, await task(p.id).then((t) => t.id), who);
    await client.authSession.delete({ where: { id: who.actor.sessionId! } });
    await expect(
      work.respond(who.actor, p.id, r.taskId, r.id, 1, {
        decision: 'ACCEPTED',
      }),
    ).rejects.toThrow();
    expect(
      (await client.taskAssignment.findUniqueOrThrow({ where: { id: r.id } }))
        .decision,
    ).toBe('PENDING');
  });
  it('RACE winning assignment revocation denies queued acceptance with no late effects', async () => {
    const p = await project(),
      t = await task(p.id),
      row = await assignment(p.id, t.id),
      entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (record) => {
      await append(record);
      if (
        record.action === 'assignment.revoke' &&
        record.outcome === 'INTENT'
      ) {
        entered.release();
        await release.promise;
      }
    });
    const revoked = work.revoke(owner.actor, p.id, t.id, row.id, 1);
    await entered.promise;
    const accepted = outcome(
      work.respond(member.actor, p.id, t.id, row.id, 1, {
        decision: 'ACCEPTED',
      }),
    );
    await blocked();
    release.release();
    await revoked;
    expect((await accepted).error).toBeDefined();
    expect(
      (await client.taskAssignment.findUniqueOrThrow({ where: { id: row.id } }))
        .decision,
    ).toBe('PENDING');
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: p.id, action: 'assignment.accept' },
      }),
    ).toBe(0);
  });
  it('RACE acceptance-first commits its notice before a waiting assignment revocation', async () => {
    const p = await project(),
      t = await task(p.id),
      row = await assignment(p.id, t.id),
      entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (record) => {
      await append(record);
      if (
        record.action === 'assignment.accept' &&
        record.outcome === 'INTENT'
      ) {
        entered.release();
        await release.promise;
      }
    });
    const accepted = work.respond(member.actor, p.id, t.id, row.id, 1, {
      decision: 'ACCEPTED',
    });
    await entered.promise;
    const revoked = work.revoke(owner.actor, p.id, t.id, row.id, 2);
    await blocked();
    release.release();
    await accepted;
    await revoked;
    expect(
      await client.sharedAssignmentNotification.count({
        where: { assignmentId: row.id, kind: 'ACCEPTED' },
      }),
    ).toBe(1);
    expect(
      (await client.taskAssignment.findUniqueOrThrow({ where: { id: row.id } }))
        .decision,
    ).toBe('ACCEPTED');
    expect(
      (await work.taskProjection(member.actor, { limit: 25, projectId: p.id }))
        .items,
    ).toEqual([]);
  });
  it('honors current ordinary assignment policy and free-mode denial atomically', async () => {
    const p = await project(),
      t = await task(p.id),
      row = await assignment(p.id, t.id),
      policy = c.ProjectPolicySchema.parse(
        await kernel.readPolicy(owner.actor, p.id),
      );
    const roleDefaults = structuredClone(policy.roleDefaults);
    roleDefaults.MEMBER = roleDefaults.MEMBER.filter(
      (x) => x !== 'assignment.accept',
    );
    await kernel.publishPolicy(owner.actor, {
      spaceId: p.id,
      scopeId: p.id,
      expectedVersion: policy.version,
      roleDefaults,
      exportMaxRecords: policy.exportMaxRecords,
      exportMaxBytes: policy.exportMaxBytes,
    });
    await expect(
      work.respond(member.actor, p.id, t.id, row.id, 1, {
        decision: 'ACCEPTED',
      }),
    ).rejects.toThrow();
    const feature = app.get(SharedFeaturePolicy);
    vi.spyOn(feature, 'decide').mockResolvedValue({
      allowed: false,
      mode: 'FREE',
    });
    const another = await task(p.id).catch(() => null);
    expect(another).toBeNull();
    const block = await privateBlock();
    await expect(
      work.block(member.actor, block.id, {
        revision: 1,
        value: { spaceId: p.id, taskId: t.id, sourceRevision: 1 },
      }),
    ).rejects.toThrow();
    expect(
      await client.timeBlockSharedTaskLink.count({
        where: { blockId: block.id },
      }),
    ).toBe(0);
  });
  it('HTTP enforces strict bodies, Origin, revision, named decisions, no-store and source-safe inbox read', async () => {
    const p = await project(),
      t = await task(p.id),
      m = await join(p.id, member),
      path = '/api/v1/projects/' + p.id + '/tasks/' + t.id + '/assignments',
      input = {
        id: randomUUID(),
        recipientAccessId: m.id,
        recipientGeneration: m.generation,
        kind: 'PRIMARY',
      };
    await request(app.getHttpServer())
      .post(path)
      .set('Cookie', owner.cookie)
      .set('Idempotency-Key', randomUUID())
      .set('If-Match', '"1"')
      .send(input)
      .expect(403);
    await request(app.getHttpServer())
      .post(path)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(400);
    const created = await request(app.getHttpServer())
      .post(path)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .set('If-Match', '"1"')
      .send(input)
      .expect(201);
    expect(created.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer())
      .post(path + '/' + input.id + '/accept')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .post(path + '/' + input.id + '/accept')
      .set('Cookie', member.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({ decision: 'ACCEPTED' })
      .expect(400);
    await request(app.getHttpServer())
      .post(path + '/' + input.id + '/accept')
      .set('Cookie', member.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({})
      .expect(201);
    const tasks = await request(app.getHttpServer())
      .get('/api/v1/me/work/tasks?projectId=' + p.id)
      .set('Cookie', member.cookie)
      .expect(200);
    c.WorkTaskPageSchema.parse(tasks.body);
    expect(tasks.body.items[0].id).toBe(t.id);
    const inbox = await work.inbox(member.actor, { limit: 100 });
    const notice = inbox.items.find((n) => n.assignmentId === input.id)!;
    const read = await request(app.getHttpServer())
      .post('/api/v1/me/work/notifications/' + notice.id + '/read')
      .set('Cookie', member.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({ spaceId: p.id })
      .expect(201);
    expect(read.body.readAt).not.toBeNull();
    await request(app.getHttpServer())
      .get(
        '/api/v1/me/calendar/overlays?from=2026-01-01&to=2026-06-01&timezone=UTC',
      )
      .set('Cookie', member.cookie)
      .expect(400);
    await expect(
      work.list(outsider.actor, p.id, t.id, { limit: 25 }),
    ).rejects.toThrow();
  });
  it('removes closing-custodian sources from projections while retaining the user private block', async () => {
    const custodian = await person(),
      p = await project(custodian),
      t = await task(p.id, custodian);
    await goal(p.id, custodian);
    const m = await join(p.id, member, 'MEMBER', custodian);
    const row = await work.create(
      custodian.actor,
      p.id,
      t.id,
      1,
      {
        id: randomUUID(),
        recipientAccessId: m.id,
        recipientGeneration: m.generation,
        kind: 'PRIMARY',
      },
      randomUUID(),
    );
    await work.respond(member.actor, p.id, t.id, row.id, 1, {
      decision: 'ACCEPTED',
    });
    const block = await privateBlock();
    await work.block(member.actor, block.id, {
      revision: 1,
      value: { spaceId: p.id, taskId: t.id, sourceRevision: 1 },
    });
    const scope = await spaces.authorizePersonal(custodian.actor);
    await client.$transaction((tx) => spaces.setClosed(tx, scope, true));
    expect(
      (await work.taskProjection(member.actor, { limit: 25, projectId: p.id }))
        .items,
    ).toEqual([]);
    expect(
      (await work.goalProjection(member.actor, { limit: 25, projectId: p.id }))
        .items,
    ).toEqual([]);
    expect((await work.block(member.actor, block.id)).availability).toBe(
      'UNAVAILABLE',
    );
    expect(await client.task.count({ where: { id: t.id } })).toBe(1);
  });
  it('requires a full assignment-eligible admission without broadening existing narrow Task grants', async () => {
    const p = await project(),
      t = await task(p.id),
      guest = await grant(p.id, { kind: 'TASK', id: t.id });
    const access = guest.accepted.admission;
    await expect(
      work.create(
        owner.actor,
        p.id,
        t.id,
        1,
        {
          id: randomUUID(),
          recipientAccessId: access.id,
          recipientGeneration: access.generation,
          kind: 'PRIMARY',
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
    expect((await projects.source(outsider.actor, p.id, 'TASK', t.id)).id).toBe(
      t.id,
    );
    expect(
      (
        await work.taskProjection(outsider.actor, {
          limit: 25,
          projectId: p.id,
        })
      ).items,
    ).toEqual([]);
    expect(
      await client.taskAssignment.count({ where: { spaceId: p.id } }),
    ).toBe(0);
  });
  it('hides unavailable source notifications and rolls back read acknowledgement after source disappearance', async () => {
    const p = await project(),
      t = await task(p.id),
      row = await assignment(p.id, t.id);
    const notice = (await work.inbox(member.actor, { limit: 100 })).items.find(
      (n) => n.assignmentId === row.id,
    )!;
    await client.task.update({
      where: { id: t.id },
      data: {
        deletedAt: new Date(),
        deletionBatchId: randomUUID(),
        revision: { increment: 1 },
      },
    });
    expect(
      (await work.pending(member.actor, { limit: 100 })).items.some(
        (x) => x.assignment.id === row.id,
      ),
    ).toBe(false);
    expect(
      (await work.inbox(member.actor, { limit: 100 })).items.some(
        (n) => n.id === notice.id,
      ),
    ).toBe(false);
    await expect(
      work.markNotification(member.actor, p.id, notice.id, 1),
    ).rejects.toThrow();
    expect(
      (
        await client.sharedAssignmentNotification.findUniqueOrThrow({
          where: { id: notice.id },
        })
      ).readAt,
    ).toBeNull();
  });
});
