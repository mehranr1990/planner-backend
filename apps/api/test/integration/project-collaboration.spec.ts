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
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { PrismaPg } from '@prisma/adapter-pg';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';
import { PersonalLifecycle } from '../../src/modules/account/public/index.js';
import { SpacesService } from '../../src/modules/spaces/public/index.js';
import { APP_CONFIG } from '../../src/bootstrap/configuration.module.js';
import type { AppConfig } from '../../src/bootstrap/environment.js';
import { localSharedSnapshot } from '../../../../tooling/testing/local-shared-snapshot.js';
import {
  SharedKernel,
  SharedLifecycleService,
} from '../../src/modules/spaces/public/index.js';
import { defaultPolicy } from '../../src/modules/spaces/domain/shared-policy.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import { SharedFiles } from '../../src/platform/storage/public/index.js';
import {
  CollaborationService,
  ResourceGrants,
} from '../../src/modules/spaces/public/index.js';
import {
  ProjectsService,
  ProjectContentService,
  ProjectFilesService,
  ProjectViewsService,
  ProjectExportService,
  ProjectTransferService,
  ProjectCleanupService,
} from '../../src/modules/projects/public/index.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import * as c from '@mehran/api-contracts';
type Person = { actor: RequestActor; cookie: string };
describe('P2-07 authorized Project content and consistent views', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    db: PrismaClient,
    projects: ProjectsService,
    content: ProjectContentService,
    files: ProjectFilesService,
    views: ProjectViewsService,
    exports: ProjectExportService,
    transfer: ProjectTransferService,
    cleanup: ProjectCleanupService,
    collaboration: CollaborationService,
    grants: ResourceGrants;
  let owner: Person, member: Person, viewer: Person, outsider: Person;
  const policy = 'synthetic-p207-' + randomUUID(),
    origin = 'http://localhost:3000',
    application = 'p207-' + randomUUID();
  async function person(cookie = false): Promise<Person> {
    const userId = randomUUID(),
      sessionId = randomUUID(),
      email = userId + '@example.test';
    await db.user.create({
      data: { id: userId, name: 'Synthetic P207', email, emailVerified: true },
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
      password = 'synthetic-p207-password-123!';
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
      throw new Error('Owned P207 schema replay failed');
    const schema = new URL(sandbox.url).searchParams.get('schema')!,
      base = isolatedTestDatabaseUrl(process.env);
    db = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: base,
          options: '-c timezone=UTC -c search_path=' + schema,
          max: 8,
          application_name: application,
        },
        { schema },
      ),
    });
    const root = fs.mkdtempSync(path.resolve('.tools/p207-'));
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P207-ONLY',
      },
    });
    await app.get(SharedControl).initialize();
    projects = app.get(ProjectsService);
    content = app.get(ProjectContentService);
    files = app.get(ProjectFilesService);
    views = app.get(ProjectViewsService);
    exports = app.get(ProjectExportService);
    transfer = app.get(ProjectTransferService);
    cleanup = app.get(ProjectCleanupService);
    collaboration = app.get(CollaborationService);
    grants = app.get(ResourceGrants);
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
  async function project(retentionPolicyVersion = policy) {
    return projects.create(
      owner.actor,
      { id: randomUUID(), title: 'P207', retentionPolicyVersion },
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

  const page = { limit: 100 };
  it('publishes versioned documents without altering Personal notes', async () => {
    const p = await project(),
      id = randomUUID(),
      key = randomUUID();
    const first = await content.publishDocument(
      owner.actor,
      p.id,
      id,
      0,
      { title: 'Specification', body: 'Shared content' },
      key,
    );
    expect(c.ProjectDocumentSchema.parse(first).revision).toBe(1);
    expect(
      await content.publishDocument(
        owner.actor,
        p.id,
        id,
        0,
        { title: 'Specification', body: 'Shared content' },
        key,
      ),
    ).toEqual(first);
    await content.publishDocument(owner.actor, p.id, id, 1, {
      title: 'Updated',
      body: 'Second version',
    });
    expect(
      (await content.documentVersions(owner.actor, p.id, id, page)).items,
    ).toHaveLength(2);
    await expect(
      content.publishDocument(owner.actor, p.id, id, 1, {
        title: 'Stale',
        body: '',
      }),
    ).rejects.toThrow();
    expect(await db.note.count({ where: { spaceId: p.id } })).toBe(0);
  });
  it('keeps comment author revision and target identity; Viewer cannot write', async () => {
    const p = await project(),
      t = await task(p.id);
    await join(p.id);
    await join(p.id, viewer, 'VIEWER');
    const target = { kind: 'TASK' as const, id: t.id },
      v = await content.createComment(
        member.actor,
        p.id,
        { id: randomUUID(), target, body: 'Comment' },
        randomUUID(),
      );
    await expect(
      content.updateComment(owner.actor, p.id, v.id, target, 1, {
        body: 'Impersonation',
      }),
    ).rejects.toThrow();
    const updated = await content.updateComment(
      member.actor,
      p.id,
      v.id,
      target,
      1,
      { body: 'Edited' },
    );
    expect(updated.revision).toBe(2);
    await expect(
      content.createComment(
        viewer.actor,
        p.id,
        { id: randomUUID(), target, body: 'Denied' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const deleted = await content.updateComment(
      member.actor,
      p.id,
      v.id,
      target,
      2,
      null,
    );
    expect(deleted.body).toBe('');
    expect(
      (
        await content.comments(owner.actor, p.id, {
          ...page,
          targetKind: 'TASK',
          targetId: t.id,
        })
      ).items,
    ).toEqual([]);
    expect(
      await db.projectCommentVersion.count({ where: { commentId: v.id } }),
    ).toBe(3);
  });
  it('uploads private bytes, exposes no key, and rechecks access on download', async () => {
    const p = await project(),
      t = await task(p.id),
      target = { kind: 'TASK' as const, id: t.id };
    await join(p.id);
    const v = await files.initiate(
      member.actor,
      p.id,
      {
        id: randomUUID(),
        target,
        filename: 'report.txt',
        mimeType: 'text/plain',
        expectedSize: 5,
      },
      randomUUID(),
    );
    const ready = await files.complete(
      member.actor,
      p.id,
      v.id,
      target,
      Readable.from(['hello']),
      '5',
    );
    expect(ready.status).toBe('READY');
    expect(JSON.stringify(ready)).not.toContain('objectKey');
    const dl = await files.download(member.actor, p.id, v.id, target);
    let text = '';
    for await (const b of dl.stream) text += b.toString();
    expect(text).toBe('hello');
    await expect(
      files.download(outsider.actor, p.id, v.id, target),
    ).rejects.toThrow();
    await files.delete(owner.actor, p.id, v.id, target, ready.revision);
    await expect(
      files.download(member.actor, p.id, v.id, target),
    ).rejects.toThrow();
  });
  it('uses current Task sources for all six views with bounded ranges', async () => {
    const p = await project(),
      t = await task(p.id);
    for (const kind of [
      'LIST',
      'KANBAN',
      'CALENDAR',
      'TIMELINE',
      'GANTT',
      'DASHBOARD',
    ] as const) {
      const v = await views.query(owner.actor, p.id, {
        ...page,
        kind,
        from: '2030-01-01',
        to: '2030-01-03',
        timezone: 'UTC',
      });
      expect(v.kind).toBe(kind);
      expect(c.ProjectViewSchema.safeParse(v).success).toBe(true);
    }
    expect(
      (await views.query(owner.actor, p.id, { ...page, kind: 'LIST' })).items[0]
        ?.task.id,
    ).toBe(t.id);
    await expect(
      views.query(outsider.actor, p.id, { ...page, kind: 'DASHBOARD' }),
    ).rejects.toThrow();
  });

  async function personalTask() {
    const space = await db.space.findFirstOrThrow({
      where: { kind: 'PERSONAL', ownerUserId: owner.actor.userId },
    });
    return db.task.create({
      data: {
        id: randomUUID(),
        spaceId: space.id,
        createdByUserId: owner.actor.userId,
        title: 'Selected private task',
      },
    });
  }
  const consent = {
    includeTaskHistory: true,
    includeGoalReviews: false,
    privateReferences: 'REJECT' as const,
    files: 'REJECT' as const,
  };
  it('preserves Task and checklist IDs on consented transfer and emits only departure metadata', async () => {
    const p = await project(),
      source = await personalTask(),
      check = await db.taskChecklistItem.create({
        data: {
          spaceId: source.spaceId,
          taskId: source.id,
          title: 'Preserved checklist',
          position: 0,
        },
      });
    const plan = await transfer.preview(
      owner.actor,
      p.id,
      {
        id: randomUUID(),
        tasks: [{ id: source.id, revision: 1 }],
        goals: [],
        consent,
      },
      randomUUID(),
    );
    expect(plan.manifest.candidates[0]?.blockers).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain('Selected private task');
    const accepted = await transfer.accept(
        owner.actor,
        p.id,
        plan.id,
        1,
        plan.manifestHash,
      ),
      key = randomUUID();
    const applied = await transfer.apply(
      owner.actor,
      p.id,
      plan.id,
      accepted.revision,
      {
        manifestHash: plan.manifestHash,
        password: 'synthetic-p207-password-123!',
      },
      key,
    );
    expect(applied.state).toBe('APPLIED');
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: source.id } })).spaceId,
    ).toBe(p.id);
    expect(
      (
        await db.taskChecklistItem.findUniqueOrThrow({
          where: { id: check.id },
        })
      ).spaceId,
    ).toBe(p.id);
    expect(
      await db.syncChange.findMany({
        where: { spaceId: source.spaceId, resourceId: source.id },
      }),
    ).toEqual([expect.objectContaining({ entity: 'TASK', deleted: true })]);
    expect(
      await transfer.apply(
        owner.actor,
        p.id,
        plan.id,
        accepted.revision,
        {
          manifestHash: plan.manifestHash,
          password: 'synthetic-p207-password-123!',
        },
        key,
      ),
    ).toEqual(applied);
  });
  it('rejects private references and stale transfer graphs without mutating either custody', async () => {
    const p = await project(),
      source = await personalTask();
    const plan = await transfer.preview(
      owner.actor,
      p.id,
      {
        id: randomUUID(),
        tasks: [{ id: source.id, revision: 1 }],
        goals: [],
        consent,
      },
      randomUUID(),
    );
    await db.taskChecklistItem.create({
      data: {
        spaceId: source.spaceId,
        taskId: source.id,
        title: 'New dependency',
        position: 0,
      },
    });
    await expect(
      transfer.accept(owner.actor, p.id, plan.id, 1, plan.manifestHash),
    ).rejects.toThrow();
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: source.id } })).spaceId,
    ).toBe(source.spaceId);
  });
  it('keeps Goal metrics, selected metric and milestones in the same moved source', async () => {
    const p = await project(),
      space = await db.space.findFirstOrThrow({
        where: { kind: 'PERSONAL', ownerUserId: owner.actor.userId },
      }),
      goal = await db.goal.create({
        data: {
          spaceId: space.id,
          createdByUserId: owner.actor.userId,
          title: 'Goal',
          horizon: 'SHORT_TERM',
          timezone: 'UTC',
        },
      }),
      metric = await db.goalMetric.create({
        data: {
          spaceId: space.id,
          goalId: goal.id,
          title: 'Metric',
          unit: 'items',
          baseline: 0,
          target: 10,
          current: 3,
        },
      });
    await db.goal.update({
      where: { id: goal.id },
      data: { metricId: metric.id, progressMode: 'METRIC' },
    });
    const plan = await transfer.preview(
      owner.actor,
      p.id,
      {
        id: randomUUID(),
        tasks: [],
        goals: [{ id: goal.id, revision: 1 }],
        consent,
      },
      randomUUID(),
    );
    await transfer.accept(owner.actor, p.id, plan.id, 1, plan.manifestHash);
    await transfer.apply(
      owner.actor,
      p.id,
      plan.id,
      2,
      {
        manifestHash: plan.manifestHash,
        password: 'synthetic-p207-password-123!',
      },
      randomUUID(),
    );
    expect(
      (await db.goal.findUniqueOrThrow({ where: { id: goal.id } })).metricId,
    ).toBe(metric.id);
    expect(
      (await db.goalMetric.findUniqueOrThrow({ where: { id: metric.id } }))
        .spaceId,
    ).toBe(p.id);
  });
  it('requires explicit comment and file grants and cannot discover unrelated source lists', async () => {
    const p = await project(),
      t = await task(p.id),
      other = await task(p.id),
      target = { kind: 'TASK' as const, id: t.id };
    const offer = await projects.createContentGrantOffer(
      owner.actor,
      p.id,
      {
        id: randomUUID(),
        recipientUserId: outsider.actor.userId,
        target,
        capabilities: ['read', 'comment', 'file.read'],
        grantExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      randomUUID(),
    );
    const accepted = await grants.decide(
      outsider.actor,
      offer.offer.id,
      offer.proof!,
      1,
      true,
      projects.validateGrantTarget,
    );
    if (!('grant' in accepted)) throw new Error('Expected grant');
    const comment = await content.createComment(
      outsider.actor,
      p.id,
      { id: randomUUID(), target, body: 'Narrow comment' },
      randomUUID(),
    );
    expect(comment.target).toEqual(target);
    await expect(
      content.comments(outsider.actor, p.id, {
        ...page,
        targetKind: 'TASK',
        targetId: other.id,
      }),
    ).rejects.toThrow();
    expect(
      (
        await views.query(outsider.actor, p.id, {
          ...page,
          kind: 'DASHBOARD',
          taskId: t.id,
        })
      ).totals?.visibleTasks,
    ).toBe(1);
    await expect(
      views.query(outsider.actor, p.id, { ...page, kind: 'DASHBOARD' }),
    ).rejects.toThrow();
    await projects.revokeGrant(owner.actor, p.id, accepted.grant.id, 1);
    await expect(
      content.comments(outsider.actor, p.id, {
        ...page,
        targetKind: 'TASK',
        targetId: t.id,
      }),
    ).rejects.toThrow();
  });
  it('exports only current Project data with exact bounds and CSV formula protection', async () => {
    const p = await project();
    await projects.createTask(
      owner.actor,
      p.id,
      { id: randomUUID(), title: '=CMD()', priority: 'NONE' },
      randomUUID(),
    );
    const json = await exports.build(owner.actor, p.id, { format: 'JSON' });
    expect(
      c.ProjectExportSchema.parse(JSON.parse(json.body)).tasks,
    ).toHaveLength(1);
    const csv = await exports.build(owner.actor, p.id, { format: 'CSV' });
    expect(csv.body).toContain("'=CMD()");
    expect(csv.body).not.toContain('Selected private task');
    await join(p.id);
    await expect(
      exports.build(member.actor, p.id, { format: 'JSON' }),
    ).rejects.toThrow();
    const current = await projects.policy(owner.actor, p.id);
    await projects.publishPolicy(owner.actor, p.id, current.version, {
      roleDefaults: current.roleDefaults,
      exportMaxRecords: 1,
      exportMaxBytes: 1,
    });
    await expect(
      exports.build(owner.actor, p.id, { format: 'JSON' }),
    ).rejects.toThrow();
  });

  it('recovers only the recorded custodian with fresh provider verification and one-use proof', async () => {
    const p = await project(),
      t = await task(p.id),
      seat = await db.contextAccess.findFirstOrThrow({
        where: { spaceId: p.id },
      });
    await projects.lifecycle(
      owner.actor,
      p.id,
      1,
      'delete',
      'synthetic-p207-password-123!',
    );
    const status = await cleanup.lifecycle.status(owner.actor, p.id);
    await expect(
      cleanup.lifecycle.issueProof(
        outsider.actor,
        p.id,
        status.revision,
        'synthetic-p207-password-123!',
      ),
    ).rejects.toThrow();
    const proof = await cleanup.lifecycle.issueProof(
      owner.actor,
      p.id,
      status.revision,
      'synthetic-p207-password-123!',
    );
    await expect(
      cleanup.recover(
        owner.actor,
        p.id,
        proof.revision,
        proof.generation,
        proof.proof,
        'wrong',
      ),
    ).rejects.toThrow();
    await cleanup.recover(
      owner.actor,
      p.id,
      proof.revision,
      proof.generation,
      proof.proof,
      'synthetic-p207-password-123!',
    );
    expect((await projects.source(owner.actor, p.id, 'TASK', t.id)).id).toBe(
      t.id,
    );
    expect(
      (await db.contextAccess.findUniqueOrThrow({ where: { id: seat.id } }))
        .generation,
    ).toBe(seat.generation + 1);
    expect(
      (
        await db.sharedLifecycleJob.findUniqueOrThrow({
          where: { id: proof.jobId },
        })
      ).recoveryHash,
    ).toBe(null);
    await expect(
      cleanup.recover(
        owner.actor,
        p.id,
        proof.revision,
        proof.generation,
        proof.proof,
        'synthetic-p207-password-123!',
      ),
    ).rejects.toThrow();
  });
  it('resumes bounded byte and owner-row cleanup after the shared recovery deadline', async () => {
    const p = await project(),
      t = await task(p.id),
      target = { kind: 'TASK' as const, id: t.id };
    await content.publishDocument(
      owner.actor,
      p.id,
      randomUUID(),
      0,
      { title: 'Retained document', body: 'Body' },
      randomUUID(),
    );
    await content.createComment(
      owner.actor,
      p.id,
      { id: randomUUID(), target, body: 'Retained history' },
      randomUUID(),
    );
    const f = await files.initiate(
      owner.actor,
      p.id,
      {
        id: randomUUID(),
        target,
        filename: 'retained.txt',
        mimeType: 'text/plain',
        expectedSize: 5,
      },
      randomUUID(),
    );
    await files.complete(
      owner.actor,
      p.id,
      f.id,
      target,
      Readable.from(['hello']),
      '5',
    );
    await projects.lifecycle(
      owner.actor,
      p.id,
      1,
      'delete',
      'synthetic-p207-password-123!',
    );
    const job = await db.sharedLifecycleJob.findFirstOrThrow({
      where: { spaceId: p.id },
    });
    await db.sharedLifecycleJob.update({
      where: { id: job.id },
      data: {
        effectiveDepartureAt: new Date(Date.now() - 31 * 86400000),
        recoveryDeadline: new Date(Date.now() - 31 * 86400000 + 2592000000),
        nextAt: new Date(Date.now() - 1000),
      },
    });
    for (let n = 0; n < 100; n++) {
      const row = await db.sharedLifecycleJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      if (row.state === 'DELETED') break;
      expect(await cleanup.consume()).toBe(true);
    }
    const result = await db.sharedLifecycleJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(result.state).toBe('DELETED');
    expect(result.spaceId).toBe(null);
    expect(await db.space.findUnique({ where: { id: p.id } })).toBe(null);
    expect(
      await db.sharedLifecycleEffect.count({ where: { jobId: job.id } }),
    ).toBeGreaterThan(0);
    expect(
      await db.user.findUnique({ where: { id: owner.actor.userId } }),
    ).not.toBe(null);
  });

  const barrier = () => {
    let release!: () => void;
    const promise = new Promise<void>((r) => {
      release = r;
    });
    return { promise, release };
  };
  async function expire(pid: string) {
    await projects.lifecycle(
      owner.actor,
      pid,
      1,
      'delete',
      'synthetic-p207-password-123!',
    );
    const job = await db.sharedLifecycleJob.findFirstOrThrow({
      where: { spaceId: pid },
    });
    return db.sharedLifecycleJob.update({
      where: { id: job.id },
      data: {
        effectiveDepartureAt: new Date(Date.now() - 31 * 86400000),
        recoveryDeadline: new Date(Date.now() - 86400000),
        nextAt: new Date(Date.now() - 1000),
      },
    });
  }
  it('rejects a revoked admission after streaming bytes without publishing the file', async () => {
    const p = await project(),
      t = await task(p.id),
      seat = await join(p.id),
      target = { kind: 'TASK' as const, id: t.id },
      entered = barrier(),
      release = barrier();
    const f = await files.initiate(
      member.actor,
      p.id,
      {
        id: randomUUID(),
        target,
        filename: 'race.txt',
        mimeType: 'text/plain',
        expectedSize: 5,
      },
      randomUUID(),
    );
    const stream = Readable.from(
      (async function* () {
        entered.release();
        await release.promise;
        yield 'hello';
      })(),
    );
    const upload = files
      .complete(member.actor, p.id, f.id, target, stream, '5')
      .then(
        () => false,
        () => true,
      );
    await entered.promise;
    try {
      await collaboration.changeMembership(
        owner.actor,
        p.id,
        seat.id,
        seat.revision,
        { state: 'REVOKED', memberRole: 'MEMBER' },
      );
    } finally {
      release.release();
    }
    expect(await upload).toBe(true);
    expect(
      (await db.storedFile.findUniqueOrThrow({ where: { id: f.id } })).status,
    ).not.toBe('READY');
    await expect(
      files.download(member.actor, p.id, f.id, target),
    ).rejects.toThrow();
  });
  it('fences document publication behind revocation using a real PostgreSQL lock waiter', async () => {
    const p = await project(),
      seat = await join(p.id, member, 'MANAGER'),
      entered = barrier(),
      release = barrier();
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${member.actor.userId} FOR UPDATE`;
      entered.release();
      await release.promise;
      const endedAt = new Date();
      await tx.contextAccessInterval.update({
        where: {
          accessId_generation: {
            accessId: seat.id,
            generation: seat.generation,
          },
        },
        data: { endedAt },
      });
      await tx.contextAccess.update({
        where: { id: seat.id },
        data: { state: 'REVOKED', endedAt, revision: { increment: 1 } },
      });
    });
    await entered.promise;
    const id = randomUUID(),
      write = content
        .publishDocument(
          member.actor,
          p.id,
          id,
          0,
          { title: 'Must not commit', body: 'Denied' },
          randomUUID(),
        )
        .then(
          () => false,
          () => true,
        );
    try {
      let waiting = false;
      for (let n = 0; n < 200; n++) {
        const r = await db.$queryRaw<
          { n: number }[]
        >`SELECT count(DISTINCT a.pid)::int n FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name=${application} AND cardinality(pg_blocking_pids(a.pid))>0 AND NOT l.granted`;
        if (r[0]!.n > 0) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(waiting).toBe(true);
    } finally {
      release.release();
      await holder;
    }
    expect(await write).toBe(true);
    expect(await db.projectDocument.findUnique({ where: { id } })).toBe(null);
  });
  it('keeps held content intact until a revisioned operator release and disallows post-deadline recovery', async () => {
    const base = await db.sharedRetentionPolicy.findUniqueOrThrow({
        where: { version: policy },
      }),
      version = 'hold-' + randomUUID(),
      hold = randomUUID(),
      configuration = {
        ...(base.configuration as object),
        policyVersion: version,
        holds: [
          {
            id: hold,
            basis: 'Synthetic hold',
            authority: 'Synthetic operator',
            scope: 'Project',
            nextReviewAt: new Date(Date.now() + 86400000).toISOString(),
            state: 'ACTIVE',
            releaseEvidence: null,
          },
        ],
      };
    await db.sharedRetentionPolicy.create({
      data: { version, approvalReference: 'SYNTHETIC-ONLY', configuration },
    });
    const p = await project(version),
      t = await task(p.id),
      job = await expire(p.id);
    await expect(
      cleanup.lifecycle.issueProof(
        owner.actor,
        p.id,
        job.revision,
        'synthetic-p207-password-123!',
      ),
    ).rejects.toThrow();
    expect(await cleanup.consume()).toBe(true);
    expect(await cleanup.consume()).toBe(true);
    const waiting = await db.sharedLifecycleJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(waiting.state).toBe('WAITING_OBLIGATIONS');
    expect(await db.task.findUnique({ where: { id: t.id } })).not.toBe(null);
    await expect(
      cleanup.lifecycle.release(
        p.id,
        job.id,
        waiting.revision - 1,
        hold,
        'SYNTHETIC-RELEASE',
      ),
    ).rejects.toThrow();
    await cleanup.lifecycle.release(
      p.id,
      job.id,
      waiting.revision,
      hold,
      'SYNTHETIC-RELEASE',
    );
    expect(await cleanup.consume()).toBe(true);
    expect(
      (await db.sharedLifecycleJob.findUniqueOrThrow({ where: { id: job.id } }))
        .state,
    ).toBe('PURGING');
    await db.sharedLifecycleJob.update({
      where: { id: job.id },
      data: { nextAt: new Date(Date.now() + 86400000) },
    });
  });
  it('supports HTTP binary completion, safe retry, author history and current metadata activity', async () => {
    const p = await project(),
      t = await task(p.id),
      base = '/api/v1/projects/' + p.id,
      target = { kind: 'TASK' as const, id: t.id };
    const f = await files.initiate(
      owner.actor,
      p.id,
      {
        id: randomUUID(),
        target,
        filename: 'http.txt',
        mimeType: 'text/plain',
        expectedSize: 5,
      },
      randomUUID(),
    );
    const route = base + '/content/TASK/' + t.id + '/files/' + f.id;
    const ready = await request(app.getHttpServer())
      .post(route + '/complete')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('hello'))
      .expect(200);
    await request(app.getHttpServer())
      .post(route + '/complete')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({})
      .expect(200);
    const comment = await content.createComment(
      owner.actor,
      p.id,
      { id: randomUUID(), target, body: 'First' },
      randomUUID(),
    );
    await content.updateComment(owner.actor, p.id, comment.id, target, 1, {
      body: 'Second',
    });
    const history = await request(app.getHttpServer())
      .get(
        base + '/content/TASK/' + t.id + '/comments/' + comment.id + '/history',
      )
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(history.body.items).toHaveLength(2);
    const activity = await content.activityList(owner.actor, p.id, {
      ...page,
      targetKind: 'TASK',
      targetId: t.id,
    });
    expect(activity.items.some((r) => r.action === 'task.create')).toBe(true);
    await files.delete(owner.actor, p.id, f.id, target, ready.body.revision);
    expect(
      (
        await files.list(owner.actor, p.id, {
          ...page,
          targetKind: 'TASK',
          targetId: t.id,
        })
      ).items,
    ).toEqual([]);
  });
  it('caps destructive file passes at 25 and resumes from durable progress', async () => {
    const p = await project(),
      t = await task(p.id),
      target = { kind: 'TASK' as const, id: t.id };
    for (let n = 0; n < 26; n++)
      await files.initiate(
        owner.actor,
        p.id,
        {
          id: randomUUID(),
          target,
          filename: 'bounded.txt',
          mimeType: 'text/plain',
          expectedSize: 5,
        },
        randomUUID(),
      );
    const job = await expire(p.id);
    expect(await cleanup.consume()).toBe(true);
    const storage = app.get(SharedFiles),
      remove = vi.spyOn(storage, 'purgeRemove');
    expect(await cleanup.consume()).toBe(true);
    expect(remove.mock.calls[0]?.[0]).toHaveLength(25);
    expect(
      await db.storedFile.count({
        where: { spaceId: p.id, purgedAt: { not: null } },
      }),
    ).toBe(25);
    expect(await cleanup.consume()).toBe(true);
    expect(remove.mock.calls[1]?.[0]).toHaveLength(1);
    expect(
      await db.storedFile.count({
        where: { spaceId: p.id, purgedAt: { not: null } },
      }),
    ).toBe(26);
    await expect(
      cleanup.lifecycle.issueProof(
        owner.actor,
        p.id,
        1,
        'synthetic-p207-password-123!',
      ),
    ).rejects.toThrow();
    await db.sharedLifecycleJob.update({
      where: { id: job.id },
      data: { nextAt: new Date(Date.now() + 86400000) },
    });
  });
  it('blocks unknown references before any private byte deletion', async () => {
    const p = await project(),
      t = await task(p.id),
      target = { kind: 'TASK' as const, id: t.id },
      f = await files.initiate(
        owner.actor,
        p.id,
        {
          id: randomUUID(),
          target,
          filename: 'unknown.txt',
          mimeType: 'text/plain',
          expectedSize: 5,
        },
        randomUUID(),
      );
    await files.complete(
      owner.actor,
      p.id,
      f.id,
      target,
      Readable.from(['hello']),
      '5',
    );
    const job = await expire(p.id);
    expect(await cleanup.consume()).toBe(true);
    const name = 'P207Unknown_' + randomUUID().replaceAll('-', ''),
      remove = vi.spyOn(app.get(SharedFiles), 'purgeRemove');
    // This table exists only in the newly-created, owned test namespace.
    await sandbox.query(
      `CREATE TABLE "${name}" (id uuid PRIMARY KEY,"taskId" uuid REFERENCES "Task"(id))`,
    );
    try {
      expect(await cleanup.consume()).toBe(true);
      expect(
        (
          await db.sharedLifecycleJob.findUniqueOrThrow({
            where: { id: job.id },
          })
        ).progress,
      ).toMatchObject({ failureCode: 'CLEANUP_RETRY_REQUIRED' });
      expect(remove).not.toHaveBeenCalled();
      expect(
        (await db.storedFile.findUniqueOrThrow({ where: { id: f.id } })).status,
      ).toBe('READY');
    } finally {
      await sandbox.query(`DROP TABLE "${name}"`);
      await db.sharedLifecycleJob.update({
        where: { id: job.id },
        data: { nextAt: new Date(Date.now() + 86400000) },
      });
    }
  });
  async function restored(
    snapshot: Awaited<ReturnType<typeof localSharedSnapshot>>,
    extraEnvironment: NodeJS.ProcessEnv = {},
  ) {
    const copy = await snapshot(),
      schema = new URL(copy.target.url).searchParams.get('schema')!,
      base = isolatedTestDatabaseUrl(process.env),
      config = app.get<AppConfig>(APP_CONFIG);
    const client = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: base,
          options: '-c timezone=UTC -c search_path=' + schema,
          max: 8,
        },
        { schema },
      ),
    });
    const restoredApp = await testApplication({
      databaseUrl: base,
      databaseInstance: {
        client,
        checkConnection: async () => {
          await client.$queryRaw`SELECT 1`;
        },
        onApplicationShutdown: () => client.$disconnect(),
      },
      restoredControl: true,
      environment: {
        STORAGE_ROOT: copy.files,
        ERASURE_CONTROL_ROOT: config.ERASURE_CONTROL_ROOT,
        SHARED_CONTROL_ROOT: config.SHARED_CONTROL_ROOT,
        SHARED_CONTROL_KEYS: config.SHARED_CONTROL_KEYS,
        SHARED_CONTROL_ACTIVE_KEY_ID: config.SHARED_CONTROL_ACTIVE_KEY_ID,
        SHARED_SECURITY_ACCEPTANCE_REFERENCE:
          config.SHARED_SECURITY_ACCEPTANCE_REFERENCE,
        ...extraEnvironment,
      },
    });
    return {
      app: restoredApp,
      db: client,
      close: async () => {
        await restoredApp.close();
        await copy.target.close();
      },
    };
  }
  it('CLOSEOUT: replays committed membership and policy restrictions plus deleted private bytes from a real older snapshot', async () => {
    const p = await project(),
      t = await task(p.id),
      seat = await join(p.id),
      target = { kind: 'TASK' as const, id: t.id };
    await join(p.id, viewer, 'VIEWER');
    const upload = await files.initiate(
      owner.actor,
      p.id,
      {
        id: randomUUID(),
        target,
        filename: 'synthetic.txt',
        mimeType: 'text/plain',
        expectedSize: 5,
      },
      randomUUID(),
    );
    const ready = await files.complete(
      owner.actor,
      p.id,
      upload.id,
      target,
      Readable.from(['hello']),
      '5',
    );
    const snapshot = await localSharedSnapshot(
      sandbox.url,
      app.get<AppConfig>(APP_CONFIG).STORAGE_ROOT,
    );
    await app.get(SharedKernel).changeAccess(owner.actor, {
      spaceId: p.id,
      scopeId: p.id,
      accessId: seat.id,
      revision: seat.revision,
      state: 'REVOKED',
      memberRole: 'MEMBER',
    });
    await app.get(SharedKernel).publishPolicy(owner.actor, {
      spaceId: p.id,
      scopeId: p.id,
      expectedVersion: 1,
      roleDefaults: { ...defaultPolicy, VIEWER: [] },
      exportMaxRecords: 10000,
      exportMaxBytes: 10485760,
    });
    await files.delete(owner.actor, p.id, upload.id, target, ready.revision);
    const copy = await restored(snapshot);
    try {
      const source = copy.app.get(ProjectsService),
        clean = copy.app.get(ProjectCleanupService),
        privateFiles = copy.app.get(ProjectFilesService);
      await expect(
        source.source(member.actor, p.id, 'TASK', t.id),
      ).rejects.toThrow();
      await expect(
        privateFiles.download(owner.actor, p.id, upload.id, target),
      ).rejects.toThrow();
      expect((await clean.restoreRestrictions(p.id)).complete).toBe(true);
      await expect(
        source.source(member.actor, p.id, 'TASK', t.id),
      ).rejects.toThrow();
      await expect(
        source.source(viewer.actor, p.id, 'TASK', t.id),
      ).rejects.toThrow();
      await expect(
        privateFiles.download(owner.actor, p.id, upload.id, target),
      ).rejects.toThrow();
      expect((await source.source(owner.actor, p.id, 'TASK', t.id)).id).toBe(
        t.id,
      );
      expect((await clean.restoreRestrictions(p.id)).processed).toBe(0);
      const row = await copy.db.storedFile.findUniqueOrThrow({
        where: { id: upload.id },
      });
      expect(row.status).toBe('DELETED');
      expect(row.purgedAt).not.toBe(null);
      expect(
        fs.existsSync(
          path.join(
            copy.app.get<AppConfig>(APP_CONFIG).STORAGE_ROOT,
            row.objectKey + '.blob',
          ),
        ),
      ).toBe(false);
    } finally {
      await copy.close();
    }
  }, 60000);
  it('CLOSEOUT: restores closure restrictions and requires a fresh password and new one-use recovery proof', async () => {
    const p = await project(),
      t = await task(p.id),
      snapshot = await localSharedSnapshot(
        sandbox.url,
        app.get<AppConfig>(APP_CONFIG).STORAGE_ROOT,
      );
    await projects.lifecycle(
      owner.actor,
      p.id,
      1,
      'delete',
      'synthetic-p207-password-123!',
    );
    const old = await cleanup.lifecycle.status(owner.actor, p.id),
      stale = await cleanup.lifecycle.issueProof(
        owner.actor,
        p.id,
        old.revision,
        'synthetic-p207-password-123!',
      );
    const copy = await restored(snapshot);
    try {
      const clean = copy.app.get(ProjectCleanupService),
        source = copy.app.get(ProjectsService),
        life = copy.app.get(SharedLifecycleService);
      expect((await clean.restoreRestrictions(p.id)).complete).toBe(true);
      await expect(
        source.source(owner.actor, p.id, 'TASK', t.id),
      ).rejects.toThrow();
      const status = await life.status(owner.actor, p.id);
      await expect(
        clean.recover(
          owner.actor,
          p.id,
          status.revision,
          status.generation,
          stale.proof,
          'synthetic-p207-password-123!',
        ),
      ).rejects.toThrow();
      await expect(
        life.issueProof(owner.actor, p.id, status.revision, 'wrong'),
      ).rejects.toThrow();
      const fresh = await life.issueProof(
        owner.actor,
        p.id,
        status.revision,
        'synthetic-p207-password-123!',
      );
      await clean.recover(
        owner.actor,
        p.id,
        fresh.revision,
        fresh.generation,
        fresh.proof,
        'synthetic-p207-password-123!',
      );
      expect((await source.source(owner.actor, p.id, 'TASK', t.id)).id).toBe(
        t.id,
      );
      await expect(
        clean.recover(
          owner.actor,
          p.id,
          fresh.revision,
          fresh.generation,
          fresh.proof,
          'synthetic-p207-password-123!',
        ),
      ).rejects.toThrow();
    } finally {
      await copy.close();
    }
  }, 60000);
  it('CLOSEOUT: rejects legacy duplicate-ID policy release and keeps distinct holds independent', async () => {
    const base = await db.sharedRetentionPolicy.findUniqueOrThrow({
        where: { version: policy },
      }),
      version = 'closeout-' + randomUUID(),
      one = randomUUID(),
      two = randomUUID();
    const hold = (id: string) => ({
      id,
      basis: 'SYNTHETIC',
      authority: 'SYNTHETIC',
      scope: 'PROJECT',
      nextReviewAt: new Date(Date.now() + 86400000).toISOString(),
      state: 'ACTIVE',
      releaseEvidence: null,
    });
    const configuration = {
      ...(base.configuration as object),
      policyVersion: version,
      holds: [hold(one), hold(two)],
    };
    await db.sharedRetentionPolicy.create({
      data: { version, approvalReference: 'SYNTHETIC-ONLY', configuration },
    });
    const p = await project(version),
      job = await expire(p.id);
    await cleanup.consume();
    await cleanup.consume();
    const waiting = await db.sharedLifecycleJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    await cleanup.lifecycle.release(
      p.id,
      job.id,
      waiting.revision,
      one,
      'SYNTHETIC RELEASE',
    );
    await cleanup.consume();
    expect(
      (await db.sharedLifecycleJob.findUniqueOrThrow({ where: { id: job.id } }))
        .state,
    ).toBe('WAITING_OBLIGATIONS');
    const badVersion = 'duplicate-' + randomUUID();
    await db.sharedRetentionPolicy.create({
      data: {
        version: badVersion,
        approvalReference: 'SYNTHETIC-ONLY',
        configuration: {
          ...configuration,
          policyVersion: badVersion,
          holds: [hold(one), hold(one)],
        },
      },
    });
    await expect(project(badVersion)).rejects.toThrow();
  });
  it('CLOSEOUT: disposes only expired detached evidence and fences every older backup checkpoint', async () => {
    const spaceId = randomUUID(),
      jobId = randomUUID(),
      effectId = randomUUID(),
      now = Date.now(),
      departed = new Date(now - 100 * 86400000),
      deadline = new Date(departed.getTime() + 30 * 86400000),
      terminal = new Date(now - 60 * 86400000),
      through = new Date(now - 40 * 86400000);
    await db.sharedLifecycleJob.create({
      data: {
        id: jobId,
        custodyId: spaceId,
        generation: 1,
        state: 'DELETED',
        effectiveDepartureAt: departed,
        recoveryDeadline: deadline,
        retentionPolicyVersion: policy,
        nextAt: terminal,
        progress: { stage: 'DELETED', completedAt: terminal.toISOString() },
      },
    });
    await db.sharedLifecycleEffect.create({
      data: {
        id: effectId,
        jobId,
        custodyId: spaceId,
        generation: 1,
        action: 'lifecycle.advance',
        authorizationVersion: 2n,
        operatorReference: 'SYNTHETIC',
        createdAt: terminal,
      },
    });
    await expect(
      db.sharedLifecycleEffect.delete({ where: { id: effectId } }),
    ).rejects.toThrow();
    await expect(
      cleanup.lifecycle.disposeTerminalEvidence(
        spaceId,
        new Date(),
        'SYNTHETIC EXPIRY',
      ),
    ).rejects.toThrow();
    const snapshot = await localSharedSnapshot(
      sandbox.url,
      app.get<AppConfig>(APP_CONFIG).STORAGE_ROOT,
    );
    const result = await cleanup.lifecycle.disposeTerminalEvidence(
      spaceId,
      through,
      'SYNTHETIC VERIFIED EXPIRY',
    );
    expect(result.complete).toBe(true);
    await db.sharedEvidenceFloor.update({
      where: { id: 1 },
      data: { before: new Date(through.getTime() + 1) },
    });
    await expect(app.get(SharedKernel).verifyRestoreFloor()).rejects.toThrow();
    await db.sharedEvidenceFloor.update({
      where: { id: 1 },
      data: { before: through },
    });
    await app.get(SharedKernel).verifyRestoreFloor();
    expect(
      await db.sharedLifecycleEffect.findUnique({ where: { id: effectId } }),
    ).toBe(null);
    expect(
      await db.sharedLifecycleJob.findUnique({ where: { id: jobId } }),
    ).toBe(null);
    const copy = await restored(snapshot);
    try {
      await expect(
        copy.app.get(SharedKernel).verifyRestoreFloor(),
      ).rejects.toThrow();
    } finally {
      await copy.close();
    }
    expect(
      (
        await cleanup.lifecycle.disposeTerminalEvidence(
          spaceId,
          through,
          'SYNTHETIC VERIFIED EXPIRY',
        )
      ).complete,
    ).toBe(true);
  }, 60000);

  it('CLOSEOUT: unresolved or legacy committed effects without replay state remain quarantined', async () => {
    const p = await project(),
      c = await db.sharedCustody.findUniqueOrThrow({
        where: { spaceId: p.id },
      }),
      record = {
        id: randomUUID(),
        spaceId: p.id,
        version: String(c.authorizationVersion + 1n),
        action: 'membership.change',
        resourceId: p.id,
        outcome: 'INTENT' as const,
        at: new Date().toISOString(),
      };
    await app.get(SharedControl).append(record);
    await expect(cleanup.restoreRestrictions(p.id)).rejects.toThrow();
    await app.get(SharedControl).append({ ...record, outcome: 'COMMITTED' });
    await expect(cleanup.restoreRestrictions(p.id)).rejects.toThrow();
    expect(
      (await db.sharedCustody.findUniqueOrThrow({ where: { spaceId: p.id } }))
        .authorizationVersion,
    ).toBe(c.authorizationVersion);
  });
  it('CLOSEOUT: replays erased Shared attribution without restoring its live identity link', async () => {
    const p = await project(),
      who = await person(),
      seat = await join(p.id, who),
      snapshot = await localSharedSnapshot(
        sandbox.url,
        app.get<AppConfig>(APP_CONFIG).STORAGE_ROOT,
      ),
      closedAt = new Date();
    await db.space.updateMany({
      where: { ownerUserId: who.actor.userId, kind: 'PERSONAL' },
      data: { accessClosedAt: closedAt },
    });
    await app
      .get(SharedKernel)
      .prepareIdentityErasure(who.actor.userId, closedAt);
    const copy = await restored(snapshot);
    try {
      expect(
        (await copy.app.get(ProjectCleanupService).restoreRestrictions(p.id))
          .complete,
      ).toBe(true);
      const actor = await copy.db.sharedActor.findUniqueOrThrow({
        where: { id: seat.actorId },
      });
      expect(actor.userId).toBe(null);
      expect(actor.state).toBe('ERASED');
      await expect(
        copy.app.get(ProjectsService).read(who.actor, p.id),
      ).rejects.toThrow();
      expect(
        (await copy.app.get(ProjectsService).read(owner.actor, p.id)).id,
      ).toBe(p.id);
    } finally {
      await copy.close();
    }
  }, 60000);
  it('CLOSEOUT: disposal respects explicit retention and holds, and resumes after a control-store failure', async () => {
    const base = await db.sharedRetentionPolicy.findUniqueOrThrow({
        where: { version: policy },
      }),
      version = 'evidence-' + randomUUID(),
      spaceId = randomUUID(),
      jobId = randomUUID(),
      item = randomUUID(),
      now = Date.now(),
      departed = new Date(now - 100 * 86400000),
      terminal = new Date(now - 60 * 86400000),
      through = new Date(now - 40 * 86400000);
    const configuration = {
      ...(base.configuration as object),
      policyVersion: version,
      holds: [
        {
          id: item,
          basis: 'SYNTHETIC',
          authority: 'SYNTHETIC',
          scope: 'evidence',
          state: 'ACTIVE',
          releaseEvidence: null,
          nextReviewAt: new Date(now + 86400000).toISOString(),
        },
      ],
    };
    await db.sharedRetentionPolicy.create({
      data: { version, approvalReference: 'SYNTHETIC-ONLY', configuration },
    });
    await db.sharedLifecycleJob.create({
      data: {
        id: jobId,
        custodyId: spaceId,
        generation: 1,
        state: 'DELETED',
        effectiveDepartureAt: departed,
        recoveryDeadline: new Date(departed.getTime() + 30 * 86400000),
        retentionPolicyVersion: version,
        nextAt: terminal,
        progress: { stage: 'DELETED' },
      },
    });
    await expect(
      cleanup.lifecycle.disposeTerminalEvidence(spaceId, through, 'SYNTHETIC'),
    ).rejects.toThrow();
    await db.sharedLifecycleJob.update({
      where: { id: jobId },
      data: {
        progress: {
          stage: 'DELETED',
          releases: { [item]: 'SYNTHETIC REVIEWED RELEASE' },
        },
      },
    });
    const failure = vi
      .spyOn(app.get(SharedControl), 'disposeEvidence')
      .mockRejectedValueOnce(new Error('Synthetic storage interruption'));
    await expect(
      cleanup.lifecycle.disposeTerminalEvidence(spaceId, through, 'SYNTHETIC'),
    ).rejects.toThrow();
    failure.mockRestore();
    await expect(app.get(SharedKernel).verifyRestoreFloor()).rejects.toThrow();
    expect(
      await db.sharedLifecycleJob.findUnique({ where: { id: jobId } }),
    ).not.toBe(null);
    expect(
      (
        await cleanup.lifecycle.disposeTerminalEvidence(
          spaceId,
          through,
          'SYNTHETIC',
        )
      ).complete,
    ).toBe(true);
    await app.get(SharedKernel).verifyRestoreFloor();
    const longVersion = 'long-evidence-' + randomUUID(),
      futureId = randomUUID(),
      futureSpace = randomUUID(),
      classRules = (
        base.configuration as { classRules: Record<string, unknown> }
      ).classRules;
    await db.sharedRetentionPolicy.create({
      data: {
        version: longVersion,
        approvalReference: 'SYNTHETIC-ONLY',
        configuration: {
          ...(base.configuration as object),
          policyVersion: longVersion,
          classRules: {
            ...classRules,
            accessAuditLifecycle: {
              ...(classRules.accessAuditLifecycle as object),
              retainAfterClosureSeconds: 200 * 86400,
            },
          },
        },
      },
    });
    await db.sharedLifecycleJob.create({
      data: {
        id: futureId,
        custodyId: futureSpace,
        generation: 1,
        state: 'DELETED',
        effectiveDepartureAt: departed,
        recoveryDeadline: new Date(departed.getTime() + 30 * 86400000),
        retentionPolicyVersion: longVersion,
        nextAt: terminal,
      },
    });
    await expect(
      cleanup.lifecycle.disposeTerminalEvidence(
        futureSpace,
        through,
        'SYNTHETIC',
      ),
    ).rejects.toThrow();
    expect(
      await db.sharedLifecycleJob.findUnique({ where: { id: futureId } }),
    ).not.toBe(null);
  });

  it('CLOSEOUT: resumes authorized terminal purge after restoring older work instead of reopening it', async () => {
    const p = await project(),
      t = await task(p.id),
      snapshot = await localSharedSnapshot(
        sandbox.url,
        app.get<AppConfig>(APP_CONFIG).STORAGE_ROOT,
      );
    await expire(p.id);
    for (
      let n = 0;
      n < 100 &&
      (await db.sharedCustody.findUnique({ where: { spaceId: p.id } }));
      n++
    )
      await cleanup.consume();
    expect(
      await db.sharedCustody.findUnique({ where: { spaceId: p.id } }),
    ).toBe(null);
    const copy = await restored(snapshot);
    try {
      const clean = copy.app.get(ProjectCleanupService);
      for (let n = 0; n < 20; n++)
        if ((await clean.restoreRestrictions(p.id)).complete) break;
      await expect(
        copy.app.get(ProjectsService).source(owner.actor, p.id, 'TASK', t.id),
      ).rejects.toThrow();
      for (
        let n = 0;
        n < 100 &&
        (await copy.db.sharedCustody.findUnique({ where: { spaceId: p.id } }));
        n++
      )
        await clean.consume();
      expect(await copy.db.task.findUnique({ where: { id: t.id } })).toBe(null);
      expect(
        await copy.db.sharedCustody.findUnique({ where: { spaceId: p.id } }),
      ).toBe(null);
      expect(
        await copy.db.user.findUnique({ where: { id: owner.actor.userId } }),
      ).not.toBe(null);
    } finally {
      await copy.close();
    }
  }, 60000);
  it('CLOSEOUT: persists the Personal digest key and honors an issued challenge across writer-key rotation', async () => {
    const who = await person(true),
      config = app.get<AppConfig>(APP_CONFIG),
      root = fs.mkdtempSync(path.resolve('.tools/personal-rotation-flow-'));
    const material = () => ({
      control: randomBytes(48).toString('base64url'),
      identity: randomBytes(48).toString('base64url'),
      backup: randomBytes(48).toString('base64url'),
      capability: randomBytes(48).toString('base64url'),
    });
    const keys = JSON.stringify({ a: material(), b: material() }),
      erasure = path.join(root, 'control');
    fs.cpSync(config.ERASURE_CONTROL_ROOT!, erasure, { recursive: true });
    const environment = {
      PERSONAL_EVIDENCE_KEYS: keys,
      PERSONAL_EVIDENCE_ACTIVE_KEY_ID: 'a',
      PERSONAL_EVIDENCE_LEGACY_KEY: config.BETTER_AUTH_SECRET,
      PERSONAL_ERASURE_POLICY_VERSION: 'SYNTHETIC-KEY-ROTATION',
      ERASURE_CONTROL_ROOT: erasure,
    };
    const snapshot = await localSharedSnapshot(
        sandbox.url,
        config.STORAGE_ROOT,
      ),
      copy = await restored(snapshot, environment);
    let rotated: NestExpressApplication | undefined;
    try {
      const scope = await copy.app
          .get(SpacesService)
          .authorizePersonal(who.actor),
        key = randomUUID(),
        settings = await copy.db.userSettings.findUniqueOrThrow({
          where: { userId: who.actor.userId },
        }),
        input = {
          password: 'synthetic-p207-password-123!',
          accountRevision: settings.revision,
          policyVersion: 'SYNTHETIC-KEY-ROTATION',
          retentionAcknowledged: true as const,
        };
      const issued = await copy.app
        .get(PersonalLifecycle)
        .requestDeletion(scope, key, input);
      expect(
        (
          await copy.db.accountDeletionJob.findUniqueOrThrow({
            where: { id: issued.job.id },
          })
        ).evidenceKeyId,
      ).toBe('a');
      const copyConfig = copy.app.get<AppConfig>(APP_CONFIG);
      rotated = await testApplication({
        databaseUrl: isolatedTestDatabaseUrl(process.env),
        databaseInstance: {
          client: copy.db,
          checkConnection: async () => {
            await copy.db.$queryRaw`SELECT 1`;
          },
          onApplicationShutdown: () => copy.db.$disconnect(),
        },
        restoredControl: true,
        environment: {
          STORAGE_ROOT: copyConfig.STORAGE_ROOT,
          SHARED_CONTROL_ROOT: copyConfig.SHARED_CONTROL_ROOT,
          SHARED_CONTROL_KEYS: copyConfig.SHARED_CONTROL_KEYS,
          SHARED_CONTROL_ACTIVE_KEY_ID: copyConfig.SHARED_CONTROL_ACTIVE_KEY_ID,
          SHARED_SECURITY_ACCEPTANCE_REFERENCE:
            copyConfig.SHARED_SECURITY_ACCEPTANCE_REFERENCE,
          ...environment,
          PERSONAL_EVIDENCE_ACTIVE_KEY_ID: 'b',
        },
      });
      const life = rotated.get(PersonalLifecycle),
        rotatedScope = await rotated
          .get(SpacesService)
          .authorizePersonal(who.actor),
        replay = await life.requestDeletion(rotatedScope, key, input);
      expect(replay.confirmationProof).toBe(issued.confirmationProof);
      expect(replay.recoveryCapability).toBe(issued.recoveryCapability);
      expect(
        (
          await life.confirm(
            { jobId: issued.job.id, revision: issued.job.revision },
            issued.confirmationProof,
            { cookie: who.cookie, origin },
          )
        ).state,
      ).toBe('WAITING');
      await expect(
        life.cancel(
          { jobId: issued.job.id, password: 'wrong' },
          issued.recoveryCapability,
        ),
      ).rejects.toThrow();
      expect(
        (
          await life.cancel(
            { jobId: issued.job.id, password: input.password },
            issued.recoveryCapability,
          )
        ).state,
      ).toBe('CANCELED');
      expect(
        await copy.db.authSession.count({
          where: { userId: who.actor.userId },
        }),
      ).toBe(0);
      expect(await life.verifyControl()).toBe(true);
    } finally {
      await rotated?.close();
      await copy.close();
    }
  }, 60000);
});
