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
import {
  ProjectsService,
  ProjectToolsService,
  WorkService,
} from '../../src/modules/projects/public/index.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import * as c from '@mehran/api-contracts';
type Person = { actor: RequestActor; cookie: string };
describe('P2-05 versioned workflow, typed fields and explicit rescheduling', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    db: PrismaClient,
    projects: ProjectsService,
    tools: ProjectToolsService,
    work: WorkService,
    collaboration: CollaborationService,
    kernel: SharedKernel,
    grants: ResourceGrants;
  let owner: Person, member: Person, viewer: Person, outsider: Person;
  const version = 'synthetic-p205-' + randomUUID(),
    origin = 'http://localhost:3000';
  async function person(cookie = false): Promise<Person> {
    const userId = randomUUID(),
      sessionId = randomUUID();
    await db.user.create({
      data: {
        id: userId,
        name: 'Synthetic P205',
        email: userId + '@example.test',
        emailVerified: true,
      },
    });
    await db.space.create({
      data: { id: randomUUID(), kind: 'PERSONAL', ownerUserId: userId },
    });
    await db.userSettings.create({ data: { userId } });
    const auth = app.get(AuthService),
      password = 'synthetic-p205-password-123!';
    await db.authAccount.create({
      data: {
        id: randomUUID(),
        userId,
        accountId: userId,
        providerId: 'credential',
        password: await (await auth.auth.$context).password.hash(password),
      },
    });
    await db.authSession.create({
      data: {
        id: sessionId,
        userId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    if (!cookie)
      return {
        actor: {
          userId,
          sessionId,
          requestId: randomUUID(),
          correlationId: randomUUID(),
        },
        cookie: '',
      };
    const login = await request(app.getHttpServer())
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', origin)
        .send({ email: userId + '@example.test', password })
        .expect(200),
      session = await db.authSession.findFirstOrThrow({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
    return {
      actor: {
        userId,
        sessionId: session.id,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
      cookie: (login.headers['set-cookie'] as unknown as string[])
        .map((s) => s.split(';')[0])
        .join('; '),
    };
  }
  beforeAll(async () => {
    sandbox = await migrationSandbox(process.env);
    const r = spawnSync(
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
    if (r.status !== 0) throw new Error('Owned P205 schema replay failed');
    const schema = new URL(sandbox.url).searchParams.get('schema')!,
      base = isolatedTestDatabaseUrl(process.env);
    db = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: base, options: '-c search_path=' + schema, max: 8 },
        { schema },
      ),
    });
    const root = fs.mkdtempSync(path.resolve('.tools/p205-'));
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P205-ONLY',
      },
    });
    await app.get(SharedControl).initialize();
    projects = app.get(ProjectsService);
    tools = app.get(ProjectToolsService);
    work = app.get(WorkService);
    collaboration = app.get(CollaborationService);
    kernel = app.get(SharedKernel);
    grants = app.get(ResourceGrants);
    const rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER', 'ADMIN'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
    await db.sharedRetentionPolicy.create({
      data: {
        version,
        approvalReference: 'SYNTHETIC-ONLY',
        configuration: {
          policyVersion: version,
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
  it('rejects old-generation approvers and rechecks a departed requester', async () => {
    const p = await project(),
      m = await join(p.id),
      t = await task(p.id),
      w = await workflow(p.id, [{ accessId: m.id, generation: m.generation }]);
    await bind(p.id, t.id, w);
    const pending = await tools.transition(
      owner.actor,
      p.id,
      t.id,
      (await current(t.id)).revision,
      w.edgeId,
      randomUUID(),
    );
    await kernel.changeAccess(owner.actor, {
      spaceId: p.id,
      scopeId: p.id,
      accessId: m.id,
      revision: m.revision,
      memberRole: 'MEMBER',
      state: 'REVOKED',
    });
    const rejoined = await join(p.id);
    expect(rejoined.generation).toBeGreaterThan(m.generation);
    await expect(
      tools.decide(member.actor, p.id, t.id, pending.approval!.id, 1, true),
    ).rejects.toThrow();
    const ownerAccess = await db.contextAccess.findFirstOrThrow({
        where: {
          spaceId: p.id,
          actorId: { not: m.actorId },
          memberRole: { not: null },
        },
      }),
      t2 = await task(p.id),
      w2 = await workflow(p.id, [
        { accessId: ownerAccess.id, generation: ownerAccess.generation },
      ]);
    await bind(p.id, t2.id, w2);
    const request = await tools.transition(
      member.actor,
      p.id,
      t2.id,
      (await current(t2.id)).revision,
      w2.edgeId,
      randomUUID(),
    );
    await kernel.changeAccess(owner.actor, {
      spaceId: p.id,
      scopeId: p.id,
      accessId: rejoined.id,
      revision: rejoined.revision,
      memberRole: 'MEMBER',
      state: 'REVOKED',
    });
    await expect(
      tools.decide(owner.actor, p.id, t2.id, request.approval!.id, 1, true),
    ).rejects.toThrow();
    expect((await current(t2.id)).status).toBe('OPEN');
  });
  it('serializes approval before a concurrent approver revocation under the custody fence', async () => {
    const p = await project(),
      m = await join(p.id),
      t = await task(p.id),
      w = await workflow(p.id, [{ accessId: m.id, generation: m.generation }]);
    await bind(p.id, t.id, w);
    const r = await tools.transition(
      owner.actor,
      p.id,
      t.id,
      (await current(t.id)).revision,
      w.edgeId,
      randomUUID(),
    );
    let entered!: () => void, release!: () => void;
    const atFence = new Promise<void>((r) => {
        entered = r;
      }),
      held = new Promise<void>((r) => {
        release = r;
      }),
      original = kernel.toolParticipant.bind(kernel);
    vi.spyOn(kernel, 'toolParticipant').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[2] === m.id) {
        entered();
        await held;
      }
      return result;
    });
    const approval = tools.decide(
      member.actor,
      p.id,
      t.id,
      r.approval!.id,
      1,
      true,
    );
    await atFence;
    const revocation = kernel.changeAccess(owner.actor, {
      spaceId: p.id,
      scopeId: p.id,
      accessId: m.id,
      revision: m.revision,
      memberRole: 'MEMBER',
      state: 'REVOKED',
    });
    try {
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (Date.now() < deadline) {
        const rows = await db.$queryRaw<
          { n: number }[]
        >`SELECT count(*)::int n FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND datname=current_database()`;
        if (rows[0]!.n > 0) {
          blocked = true;
          break;
        }
        await new Promise<void>((r) => setImmediate(r));
      }
      expect(blocked).toBe(true);
    } finally {
      release();
    }
    expect((await approval).approval?.state).toBe('APPROVED');
    await revocation;
    await expect(
      tools.decide(member.actor, p.id, t.id, r.approval!.id, 1, true),
    ).rejects.toThrow();
  });
  it('keeps durable create and transition replays free of duplicate effects after receipt expiry', async () => {
    const p = await project(),
      t = await task(p.id),
      id = randomUUID(),
      raw = randomUUID(),
      input = c.CustomFieldVersionInputSchema.parse({
        name: 'Replay',
        kind: 'NUMBER',
        defaultValue: '5',
      });
    await tools.publishField(owner.actor, p.id, id, 0, input, raw);
    const before = await db.sharedUsageEntry.count({
        where: { spaceId: p.id, feature: 'task.field-version' },
      }),
      audit = await db.sharedAuditEvent.count({ where: { spaceId: p.id } });
    await db.sharedMutationReceipt.deleteMany({
      where: { spaceId: p.id, operation: 'field.publish' },
    });
    await tools.publishField(owner.actor, p.id, id, 0, input, raw);
    expect(
      await db.sharedUsageEntry.count({
        where: { spaceId: p.id, feature: 'task.field-version' },
      }),
    ).toBe(before);
    expect(await db.sharedAuditEvent.count({ where: { spaceId: p.id } })).toBe(
      audit,
    );
    const w = await workflow(p.id);
    await bind(p.id, t.id, w);
    const rev = (await current(t.id)).revision,
      k = randomUUID(),
      first = await tools.transition(owner.actor, p.id, t.id, rev, w.edgeId, k),
      replayed = await tools.transition(
        owner.actor,
        p.id,
        t.id,
        rev,
        w.edgeId,
        k,
      );
    expect(replayed).toEqual(first);
    expect((await current(t.id)).revision).toBe(first.task.revision);
  });
  it('rejects expired approvals/previews and rolls back all rescheduled sources on effect failure', async () => {
    const p = await project(),
      m = await join(p.id),
      t = await task(p.id),
      w = await workflow(p.id, [{ accessId: m.id, generation: m.generation }]);
    await bind(p.id, t.id, w);
    const r = await tools.transition(
      owner.actor,
      p.id,
      t.id,
      (await current(t.id)).revision,
      w.edgeId,
      randomUUID(),
    );
    const original = tools['decide'].bind(tools);
    expect(original).toBeTypeOf('function');
    // Synthetic DB time is injected only at the existing fenced application clock boundary.
    const signed = collaboration.signed.bind(collaboration);
    vi.spyOn(collaboration, 'signed').mockImplementation(
      (actor, pid, users, action, target, body) =>
        signed(actor, pid, users, action, target, (tx, now, locked, begin) =>
          body(tx, new Date(now.getTime() + 1800001), locked, begin),
        ),
    );
    await expect(
      tools.decide(member.actor, p.id, t.id, r.approval!.id, 1, true),
    ).rejects.toThrow();
    vi.restoreAllMocks();
    const a = await scheduled(p.id, 9),
      b = await scheduled(p.id, 10);
    await tools.dependency(owner.actor, p.id, {
      id: randomUUID(),
      predecessorId: a.id,
      successorId: b.id,
      kind: 'FS',
      lagMinutes: 0,
    });
    const preview = await tools.preview(
        owner.actor,
        p.id,
        {
          id: randomUUID(),
          taskId: a.id,
          sourceRevision: (await current(a.id)).revision,
          schedule: schedule(12),
        },
        randomUUID(),
      ),
      beforeA = await current(a.id),
      beforeB = await current(b.id);
    vi.spyOn(kernel, 'offerEffect').mockRejectedValueOnce(
      new Error('Synthetic effect failure'),
    );
    await expect(
      tools.apply(owner.actor, p.id, preview.id, 1, preview.manifestHash),
    ).rejects.toThrow();
    expect(await current(a.id)).toEqual(beforeA);
    expect(await current(b.id)).toEqual(beforeB);
    vi.restoreAllMocks();
    vi.spyOn(collaboration, 'signed').mockImplementation(
      (actor, pid, users, action, target, body) =>
        signed(actor, pid, users, action, target, (tx, now, locked, begin) =>
          body(tx, new Date(now.getTime() + 1800001), locked, begin),
        ),
    );
    await expect(
      tools.apply(owner.actor, p.id, preview.id, 1, preview.manifestHash),
    ).rejects.toThrow();
  });
  const page = { limit: 100 };
  async function project() {
    return projects.create(
      owner.actor,
      { id: randomUUID(), title: 'P205', retentionPolicyVersion: version },
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
    role: 'MEMBER' | 'VIEWER' = 'MEMBER',
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
    if (!('membership' in r)) throw new Error('Missing member');
    return r.membership;
  }
  async function current(id: string) {
    return db.task.findUniqueOrThrow({ where: { id } });
  }
  async function workflow(
    pid: string,
    approvers: { accessId: string; generation: number }[] = [],
  ) {
    const id = randomUUID(),
      start = randomUUID(),
      end = randomUUID(),
      edgeId = randomUUID(),
      input = {
        name: 'Review',
        states: [
          { id: start, label: 'Todo', status: 'OPEN' as const },
          { id: end, label: 'Finished', status: 'DONE' as const },
        ],
        edges: [
          {
            id: edgeId,
            fromStateId: start,
            toStateId: end,
            requiresApproval: Boolean(approvers.length),
            approvers,
          },
        ],
      };
    const published = await tools.publishWorkflow(
      owner.actor,
      pid,
      id,
      0,
      input,
      randomUUID(),
    );
    return { id, start, end, edgeId, input, published };
  }
  async function bind(
    pid: string,
    tid: string,
    w: Awaited<ReturnType<typeof workflow>>,
  ) {
    return tools.bind(owner.actor, pid, tid, (await current(tid)).revision, {
      workflowId: w.id,
      version: 1,
      stateId: w.start,
    });
  }
  const schedule = (hour: number) => ({
    plannedStartAt: `2030-01-01T${String(hour).padStart(2, '0')}:00:00.000Z`,
    dueAt: `2030-01-01T${String(hour + 1).padStart(2, '0')}:00:00.000Z`,
    scheduledDate: null,
  });
  async function scheduled(pid: string, hour: number) {
    const t = await task(pid);
    await work.schedule(owner.actor, pid, t.id, {
      revision: t.revision,
      value: schedule(hour),
    });
    return current(t.id);
  }
  it('pins versions, preserves old status contracts and permits only defined legacy transitions', async () => {
    const p = await project(),
      t = await task(p.id),
      w = await workflow(p.id);
    await bind(p.id, t.id, w);
    await tools.publishWorkflow(
      owner.actor,
      p.id,
      w.id,
      1,
      { ...w.input, name: 'New', edges: [] },
      randomUUID(),
    );
    expect(
      (await tools.binding(owner.actor, p.id, t.id)).binding?.version,
    ).toBe(1);
    const result = await projects.patchTask(
      owner.actor,
      p.id,
      t.id,
      (await current(t.id)).revision,
      { status: 'DONE' },
      randomUUID(),
    );
    expect(result.status).toBe('DONE');
    expect(c.SharedTaskSchema.safeParse(result).success).toBe(true);
    await expect(
      projects.patchTask(
        owner.actor,
        p.id,
        t.id,
        result.revision,
        { status: 'OPEN' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    expect(
      (await tools.history(owner.actor, p.id, t.id, page)).items.map(
        (e) => e.action,
      ),
    ).toContain('WORKFLOW_TRANSITION');
  });
  it('requires exact designated approver, blocks Owner self-approval and atomically applies source status', async () => {
    const p = await project(),
      m = await join(p.id),
      t = await task(p.id),
      ownerAccess = await db.contextAccess.findFirstOrThrow({
        where: {
          spaceId: p.id,
          actorId: { not: m.actorId },
          memberRole: { not: null },
        },
      }),
      w = await workflow(p.id, [
        { accessId: m.id, generation: m.generation },
        { accessId: ownerAccess.id, generation: ownerAccess.generation },
      ]);
    await bind(p.id, t.id, w);
    const r = await tools.transition(
      owner.actor,
      p.id,
      t.id,
      (await current(t.id)).revision,
      w.edgeId,
      randomUUID(),
    );
    expect(r.task.status).toBe('OPEN');
    await expect(
      tools.decide(owner.actor, p.id, t.id, r.approval!.id, 1, true),
    ).rejects.toThrow();
    const approved = await tools.decide(
      member.actor,
      p.id,
      t.id,
      r.approval!.id,
      1,
      true,
    );
    expect(approved.task.status).toBe('DONE');
    expect(approved.approval?.state).toBe('APPROVED');
    const changes = await db.taskChange.count({ where: { taskId: t.id } });
    await tools.decide(member.actor, p.id, t.id, r.approval!.id, 1, true);
    expect(await db.taskChange.count({ where: { taskId: t.id } })).toBe(
      changes,
    );
  });
  it('rejects ordinary status PATCH through an approval edge and rejects stale approval after source edits', async () => {
    const p = await project(),
      m = await join(p.id),
      t = await task(p.id),
      w = await workflow(p.id, [{ accessId: m.id, generation: m.generation }]);
    await bind(p.id, t.id, w);
    await expect(
      projects.patchTask(
        owner.actor,
        p.id,
        t.id,
        (await current(t.id)).revision,
        { status: 'DONE' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const r = await tools.transition(
      owner.actor,
      p.id,
      t.id,
      (await current(t.id)).revision,
      w.edgeId,
      randomUUID(),
    );
    await projects.patchTask(
      owner.actor,
      p.id,
      t.id,
      r.task.revision,
      { title: 'Edited' },
      randomUUID(),
    );
    await expect(
      tools.decide(member.actor, p.id, t.id, r.approval!.id, 1, true),
    ).rejects.toThrow();
    expect((await current(t.id)).status).toBe('OPEN');
  });
  it('rechecks requester admission and current approver policy before approval', async () => {
    const p = await project(),
      m = await join(p.id),
      t = await task(p.id),
      w = await workflow(p.id, [{ accessId: m.id, generation: m.generation }]);
    await bind(p.id, t.id, w);
    const r = await tools.transition(
      owner.actor,
      p.id,
      t.id,
      (await current(t.id)).revision,
      w.edgeId,
      randomUUID(),
    );
    const policy = await kernel.readPolicy(owner.actor, p.id);
    const roleDefaults = structuredClone(policy.roleDefaults) as Parameters<
      SharedKernel['publishPolicy']
    >[1]['roleDefaults'];
    roleDefaults.MEMBER = roleDefaults.MEMBER.filter(
      (x) => x !== 'workflow.transition',
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
      tools.decide(member.actor, p.id, t.id, r.approval!.id, 1, true),
    ).rejects.toThrow();
  });
  it('rolls back approval and status together when durable effects fail', async () => {
    const p = await project(),
      m = await join(p.id),
      t = await task(p.id),
      w = await workflow(p.id, [{ accessId: m.id, generation: m.generation }]);
    await bind(p.id, t.id, w);
    const r = await tools.transition(
      owner.actor,
      p.id,
      t.id,
      (await current(t.id)).revision,
      w.edgeId,
      randomUUID(),
    );
    vi.spyOn(kernel, 'offerEffect').mockRejectedValueOnce(
      new Error('Synthetic effect failure'),
    );
    await expect(
      tools.decide(member.actor, p.id, t.id, r.approval!.id, 1, true),
    ).rejects.toThrow();
    expect((await current(t.id)).status).toBe('OPEN');
    expect(
      (
        await db.taskWorkflowApproval.findUniqueOrThrow({
          where: { id: r.approval!.id },
        })
      ).state,
    ).toBe('REQUESTED');
  });
  for (const kind of [
    'TEXT',
    'NUMBER',
    'DATE',
    'BOOLEAN',
    'SINGLE_SELECT',
    'MULTI_SELECT',
    'PERSON',
    'CURRENCY',
  ] as const)
    it(
      'persists, defaults and searches typed ' +
        kind +
        ' values without changing Personal data',
      async () => {
        const p = await project(),
          m = await join(p.id),
          t = await task(p.id),
          id = randomUUID(),
          option = randomUUID(),
          value =
            kind === 'TEXT'
              ? 'hello'
              : kind === 'NUMBER'
                ? '123.125'
                : kind === 'DATE'
                  ? '2030-02-28'
                  : kind === 'BOOLEAN'
                    ? true
                    : kind === 'SINGLE_SELECT'
                      ? option
                      : kind === 'MULTI_SELECT'
                        ? [option]
                        : kind === 'PERSON'
                          ? { accessId: m.id, generation: m.generation }
                          : { currency: 'USD', amount: '12.34' },
          input = c.CustomFieldVersionInputSchema.parse({
            name: 'Value',
            kind,
            ...(kind.includes('SELECT')
              ? { options: [{ id: option, label: 'A' }] }
              : {}),
            defaultValue: value,
          });
        await tools.publishField(owner.actor, p.id, id, 0, input, randomUUID());
        expect((await tools.values(owner.actor, p.id, t.id)).items).toEqual([]);
        const result = await tools.setValue(
          member.actor,
          p.id,
          t.id,
          id,
          t.revision,
          { version: 1, useDefault: true },
        );
        expect(result.items[0]?.value).toEqual(value);
        const found = await tools.search(owner.actor, p.id, {
          fieldId: id,
          version: 1,
          operator: kind === 'MULTI_SELECT' ? 'HAS' : 'EQ',
          value,
          limit: 10,
        });
        expect(found.items.map((r) => r.id)).toEqual([t.id]);
        const personal = await db.task.findMany({
          where: { createdByUserId: owner.actor.userId },
        });
        expect(personal).toEqual([]);
      },
    );
  it('keeps historical field values and options, rejects invalid type/currency and securely deprecates', async () => {
    const p = await project(),
      t = await task(p.id),
      id = randomUUID(),
      option = randomUUID(),
      input = c.CustomFieldVersionInputSchema.parse({
        name: 'Choice',
        kind: 'SINGLE_SELECT',
        options: [{ id: option, label: 'Old' }],
      });
    await tools.publishField(owner.actor, p.id, id, 0, input, randomUUID());
    await tools.setValue(owner.actor, p.id, t.id, id, t.revision, {
      version: 1,
      value: option,
    });
    await tools.publishField(
      owner.actor,
      p.id,
      id,
      1,
      { ...input, options: [{ id: randomUUID(), label: 'New' }] },
      randomUUID(),
    );
    expect(
      (await tools.values(owner.actor, p.id, t.id)).items[0]?.version,
    ).toBe(1);
    await expect(
      tools.publishField(
        owner.actor,
        p.id,
        id,
        2,
        { name: 'Change type', kind: 'NUMBER', limits: {} },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await tools.deprecateField(owner.actor, p.id, id, 2);
    expect((await tools.values(owner.actor, p.id, t.id)).items[0]?.value).toBe(
      option,
    );
    await expect(
      tools.setValue(
        owner.actor,
        p.id,
        t.id,
        id,
        (await current(t.id)).revision,
        { version: 1, value: option },
      ),
    ).rejects.toThrow();
    await expect(
      tools.search(owner.actor, p.id, {
        fieldId: id,
        version: 1,
        operator: 'EQ',
        value: option,
        limit: 10,
      }),
    ).rejects.toThrow();
  });
  it('preserves explicit null defaults and source optimistic concurrency', async () => {
    const p = await project(),
      t = await task(p.id),
      id = randomUUID();
    await tools.publishField(
      owner.actor,
      p.id,
      id,
      0,
      { name: 'Nullable', kind: 'TEXT', limits: {}, defaultValue: null },
      randomUUID(),
    );
    expect(
      (await tools.field(owner.actor, p.id, id, 1)).defaultValue,
    ).toBeNull();
    await tools.setValue(owner.actor, p.id, t.id, id, 1, {
      version: 1,
      useDefault: true,
    });
    await expect(
      tools.setValue(owner.actor, p.id, t.id, id, 1, {
        version: 1,
        value: 'stale',
      }),
    ).rejects.toThrow();
  });
  it('isolates nested IDs and denies Viewer mutations and grant-only project searches', async () => {
    const p = await project(),
      other = await project(),
      t = await task(p.id),
      f = randomUUID();
    await join(p.id, viewer, 'VIEWER');
    await tools.publishField(
      owner.actor,
      p.id,
      f,
      0,
      { name: 'Secret field', kind: 'TEXT', limits: {} },
      randomUUID(),
    );
    await expect(
      tools.setValue(viewer.actor, p.id, t.id, f, 1, {
        version: 1,
        value: 'denied',
      }),
    ).rejects.toThrow();
    await expect(tools.values(owner.actor, other.id, t.id)).rejects.toThrow();
    await expect(tools.field(outsider.actor, p.id, f, 1)).rejects.toThrow();
    const offer = await projects.grantOffer(
      owner.actor,
      p.id,
      {
        id: randomUUID(),
        recipientUserId: outsider.actor.userId,
        target: { kind: 'TASK', id: t.id },
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
    await tools.setValue(outsider.actor, p.id, t.id, f, 1, {
      version: 1,
      value: 'allowed on named Task',
    });
    await expect(
      tools.search(outsider.actor, p.id, {
        fieldId: f,
        version: 1,
        operator: 'EQ',
        value: 'allowed on named Task',
        limit: 10,
      }),
    ).rejects.toThrow();
    const w = await workflow(p.id);
    await bind(p.id, t.id, w);
    await expect(
      projects.patchTask(
        outsider.actor,
        p.id,
        t.id,
        (await current(t.id)).revision,
        { status: 'DONE' },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('rejects all-kind cycles and cross-space edges under concrete foreign keys', async () => {
    const p = await project(),
      q = await project(),
      a = await task(p.id),
      b = await task(p.id),
      foreign = await task(q.id);
    await tools.dependency(owner.actor, p.id, {
      id: randomUUID(),
      predecessorId: a.id,
      successorId: b.id,
      kind: 'FS',
      lagMinutes: -15,
    });
    await expect(
      tools.dependency(owner.actor, p.id, {
        id: randomUUID(),
        predecessorId: b.id,
        successorId: a.id,
        kind: 'SF',
        lagMinutes: 10,
      }),
    ).rejects.toThrow();
    await expect(
      tools.dependency(owner.actor, p.id, {
        id: randomUUID(),
        predecessorId: a.id,
        successorId: foreign.id,
        kind: 'SS',
        lagMinutes: 0,
      }),
    ).rejects.toThrow();
    const local = await db.sharedActor.findFirstOrThrow({
      where: { spaceId: p.id, userId: owner.actor.userId },
    });
    await expect(
      db.taskDependency.create({
        data: {
          id: randomUUID(),
          spaceId: p.id,
          scopeId: p.id,
          predecessorId: a.id,
          successorId: foreign.id,
          kind: 'FF',
          lagMinutes: 0,
          createdByActorId: local.id,
        },
      }),
    ).rejects.toThrow();
  });
  it('serializes simultaneous opposing graph edges and admits exactly one', async () => {
    const p = await project(),
      a = await task(p.id),
      b = await task(p.id);
    const results = await Promise.allSettled([
      tools.dependency(owner.actor, p.id, {
        id: randomUUID(),
        predecessorId: a.id,
        successorId: b.id,
        kind: 'FS',
        lagMinutes: 0,
      }),
      tools.dependency(owner.actor, p.id, {
        id: randomUUID(),
        predecessorId: b.id,
        successorId: a.id,
        kind: 'SS',
        lagMinutes: 0,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await tools.graph(owner.actor, p.id)).edges).toHaveLength(1);
  });
  it('previews without changing dates, rejects bypasses and applies a complete chain once', async () => {
    const p = await project(),
      a = await scheduled(p.id, 9),
      b = await scheduled(p.id, 10);
    await tools.dependency(owner.actor, p.id, {
      id: randomUUID(),
      predecessorId: a.id,
      successorId: b.id,
      kind: 'FS',
      lagMinutes: 0,
    });
    const before = await current(a.id),
      otherBefore = await current(b.id),
      preview = await tools.preview(
        owner.actor,
        p.id,
        {
          id: randomUUID(),
          taskId: a.id,
          sourceRevision: before.revision,
          schedule: schedule(12),
        },
        randomUUID(),
      );
    expect(await current(a.id)).toEqual(before);
    expect(await current(b.id)).toEqual(otherBefore);
    await expect(
      work.schedule(owner.actor, p.id, a.id, {
        revision: before.revision,
        value: schedule(12),
      }),
    ).rejects.toThrow();
    expect(preview.items.filter((i) => i.changed)).toHaveLength(2);
    await expect(
      tools.apply(owner.actor, p.id, preview.id, 1, '0'.repeat(64)),
    ).rejects.toThrow();
    const result = await tools.apply(
      owner.actor,
      p.id,
      preview.id,
      1,
      preview.manifestHash,
    );
    expect(result.state).toBe('APPLIED');
    expect((await current(b.id)).plannedStartAt?.toISOString()).toBe(
      schedule(13).plannedStartAt,
    );
    const counts = await db.taskChange.count({
      where: { taskId: { in: [a.id, b.id] } },
    });
    await tools.apply(owner.actor, p.id, preview.id, 1, preview.manifestHash);
    expect(
      await db.taskChange.count({ where: { taskId: { in: [a.id, b.id] } } }),
    ).toBe(counts);
  });
  it('invalidates previews after source, graph or authority changes and never invents date-only times', async () => {
    const p = await project(),
      a = await scheduled(p.id, 9),
      b = await scheduled(p.id, 10),
      edge = await tools.dependency(owner.actor, p.id, {
        id: randomUUID(),
        predecessorId: a.id,
        successorId: b.id,
        kind: 'FS',
        lagMinutes: 0,
      }),
      preview = await tools.preview(
        owner.actor,
        p.id,
        {
          id: randomUUID(),
          taskId: a.id,
          sourceRevision: (await current(a.id)).revision,
          schedule: schedule(12),
        },
        randomUUID(),
      );
    await tools.patchDependency(owner.actor, p.id, edge.id, 1, 15);
    await expect(
      tools.apply(owner.actor, p.id, preview.id, 1, preview.manifestHash),
    ).rejects.toThrow();
    const dateOnly = await task(p.id);
    await tools.dependency(owner.actor, p.id, {
      id: randomUUID(),
      predecessorId: b.id,
      successorId: dateOnly.id,
      kind: 'FS',
      lagMinutes: 0,
    });
    await expect(
      tools.preview(
        owner.actor,
        p.id,
        {
          id: randomUUID(),
          taskId: b.id,
          sourceRevision: (await current(b.id)).revision,
          schedule: schedule(13),
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('enforces publication immutability, selection constraints and manifest tamper protection in PostgreSQL', async () => {
    const p = await project(),
      w = await workflow(p.id),
      f = randomUUID(),
      o = randomUUID();
    await tools.publishField(
      owner.actor,
      p.id,
      f,
      0,
      {
        name: 'Published',
        kind: 'SINGLE_SELECT',
        limits: {},
        options: [{ id: o, label: 'Option' }],
        defaultValue: o,
      },
      randomUUID(),
    );
    await expect(
      db.taskWorkflowState.create({
        data: {
          spaceId: p.id,
          scopeId: p.id,
          workflowId: w.id,
          version: 1,
          id: randomUUID(),
          label: 'Injected',
          status: 'OPEN',
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.taskFieldOption.create({
        data: {
          spaceId: p.id,
          scopeId: p.id,
          fieldId: f,
          version: 1,
          id: randomUUID(),
          label: 'Injected',
          position: 1,
        },
      }),
    ).rejects.toThrow();
    const value = await db.taskFieldValue.findFirstOrThrow({
      where: { fieldId: f, taskId: null },
    });
    await expect(
      db.taskFieldValue.delete({ where: { id: value.id } }),
    ).rejects.toThrow();
    const namedTask = await task(p.id);
    await expect(
      db.taskFieldValue.update({
        where: { id: value.id },
        data: { taskId: namedTask.id },
      }),
    ).rejects.toThrow();
    await expect(
      db.taskFieldSelection.updateMany({
        where: { valueId: value.id },
        data: { optionId: randomUUID() },
      }),
    ).rejects.toThrow();
    await expect(
      db.taskWorkflowVersion.updateMany({
        where: { workflowId: w.id },
        data: { name: 'Edited' },
      }),
    ).rejects.toThrow();
  });
  it('applies retained usage-owner checks and rolls back publication when growth is denied', async () => {
    const p = await project(),
      policy = app.get(SharedFeaturePolicy),
      decide = vi
        .spyOn(policy, 'decide')
        .mockResolvedValue({ allowed: false, mode: 'FREE' }),
      id = randomUUID();
    await expect(
      tools.publishField(
        owner.actor,
        p.id,
        id,
        0,
        { name: 'Denied', kind: 'TEXT', limits: {} },
        randomUUID(),
      ),
    ).rejects.toThrow();
    expect(await db.taskField.count({ where: { id } })).toBe(0);
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'task.field-version',
        usageOwner: { kind: 'SHARED_CUSTODY', spaceId: p.id },
      }),
      expect.anything(),
    );
  });
  it('keeps HTTP contracts strict with Origin, If-Match, ETag and no-store', async () => {
    const p = await project(),
      t = await task(p.id);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${p.id}/tasks/${t.id}/workflow`)
      .set('Cookie', owner.cookie)
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('ETag', '"1"');
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${p.id}/workflows`)
      .set('Cookie', owner.cookie)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .put(
        `/api/v1/projects/${p.id}/tasks/${t.id}/field-values/${randomUUID()}`,
      )
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({ version: 1, value: 'missing If-Match' })
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${p.id}/workflows?unexpected=1`)
      .set('Cookie', owner.cookie)
      .expect(400);
  });
});
