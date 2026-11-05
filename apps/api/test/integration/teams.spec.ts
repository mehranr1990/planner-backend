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
describe('P3-01 independent Teams and explicit Project visibility', () => {
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
  it('creates independent custody atomically, safely replays creation and rejects different fingerprints/creators', async () => {
    const body = {
        id: randomUUID(),
        title: 'Team',
        retentionPolicyVersion: version,
      },
      key = randomUUID();
    const t = await teams.create(owner.actor, body, key);
    expect(await teams.create(owner.actor, body, key)).toEqual(t);
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: t.id },
        })
      ).kind,
    ).toBe('TEAM');
    expect((await teams.members(owner.actor, t.id, page)).items[0]!.role).toBe(
      'OWNER',
    );
    expect(await client.project.count({ where: { spaceId: t.id } })).toBe(0);
    await expect(
      teams.create(owner.actor, { ...body, title: 'Changed' }, key),
    ).rejects.toThrow();
    await expect(teams.create(outsider.actor, body, key)).rejects.toThrow();
    expect(
      await client.sharedUsageEntry.count({
        where: { spaceId: t.id, feature: 'shared.custody' },
      }),
    ).toBe(1);
    const denied = randomUUID();
    const growth = vi
      .spyOn(app.get(SharedFeaturePolicy), 'decide')
      .mockResolvedValue({ allowed: false, mode: 'FREE' });
    await expect(
      teams.create(owner.actor, { ...body, id: denied }, randomUUID()),
    ).rejects.toThrow();
    growth.mockRestore();
    expect(await client.space.count({ where: { id: denied } })).toBe(0);
  });
  it('rolls back custody, Team, admission, audit, outbox and usage on a failed creation effect', async () => {
    const id = randomUUID();
    const effect = vi
      .spyOn(kernel, 'offerEffect')
      .mockRejectedValueOnce(new Error('synthetic failure'));
    await expect(
      teams.create(
        owner.actor,
        { id, title: 'Rollback', retentionPolicyVersion: version },
        randomUUID(),
      ),
    ).rejects.toThrow('synthetic');
    effect.mockRestore();
    expect(await client.space.count({ where: { id } })).toBe(0);
    expect(await client.team.count({ where: { id } })).toBe(0);
    expect(
      await client.sharedAuditEvent.count({ where: { spaceId: id } }),
    ).toBe(0);
    expect(
      await client.sharedOutboxEvent.count({ where: { spaceId: id } }),
    ).toBe(0);
    expect(
      await client.sharedUsageEntry.count({ where: { spaceId: id } }),
    ).toBe(0);
  });
  it('requires explicit TEAM retention applicability and rejects Company input', async () => {
    const current = await client.sharedRetentionPolicy.findUniqueOrThrow({
        where: { version },
      }),
      v = 'project-only-' + randomUUID();
    await client.sharedRetentionPolicy.create({
      data: {
        version: v,
        approvalReference: current.approvalReference,
        configuration: {
          ...(current.configuration as object),
          policyVersion: v,
          applicableContexts: ['PROJECT'],
        },
      },
    });
    await expect(
      teams.create(
        owner.actor,
        { id: randomUUID(), title: 'Denied', retentionPolicyVersion: v },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    expect(
      c.TeamCreateSchema.safeParse({
        id: randomUUID(),
        title: 'No Company',
        retentionPolicyVersion: version,
        companyId: randomUUID(),
      }).success,
    ).toBe(false);
  });
  it('uses distinct Team Lead and Project Manager catalogs and validates them at the DB boundary', async () => {
    const t = await team(),
      p = await project();
    const lead = await join(t.id, member, 'LEAD');
    expect(lead.role).toBe('LEAD');
    expect(
      (await teams.members(member.actor, t.id, page)).items.some(
        (r) => r.role === 'LEAD',
      ),
    ).toBe(true);
    await expect(invite(t.id, viewer, 'MANAGER')).rejects.toHaveProperty(
      'status',
      400,
    );
    await expect(invite(p.id, viewer, 'LEAD')).rejects.toHaveProperty(
      'status',
      400,
    );
    await expect(
      client.contextAccess.update({
        where: { id: lead.id },
        data: { memberRole: 'MANAGER' },
      }),
    ).rejects.toThrow();
    const manager = await join(p.id, viewer, 'MANAGER');
    await expect(
      client.contextAccess.update({
        where: { id: manager.id },
        data: { memberRole: 'LEAD' },
      }),
    ).rejects.toThrow();
    await expect(
      client.team.create({
        data: {
          id: p.id,
          spaceId: p.id,
          scopeId: p.id,
          title: 'Wrong domain',
          createdByActorId: p.createdByActorId,
          creationKey: 'a'.repeat(64),
          creationFingerprint: 'b'.repeat(64),
        },
      }),
    ).rejects.toThrow();
    expect((await projects.read(viewer.actor, p.id)).id).toBe(p.id);
  });
  it('enforces Lead invitation/delegation ceilings, Admin appointment and Owner protection', async () => {
    const t = await team();
    await join(t.id, member, 'LEAD');
    const v = await join(t.id, viewer, 'VIEWER', member);
    await expect(invite(t.id, outsider, 'LEAD', member)).rejects.toHaveProperty(
      'status',
      403,
    );
    await expect(
      invite(t.id, outsider, 'ADMIN', member),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      service.changeMembership(member.actor, t.id, v.id, v.revision, {
        state: 'ACTIVE',
        memberRole: 'LEAD',
      }),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      teams.patch(member.actor, t.id, 1, { title: 'Escalation' }),
    ).rejects.toHaveProperty('status', 403);
    const promoted = await service.changeMembership(
      owner.actor,
      t.id,
      v.id,
      v.revision,
      { state: 'ACTIVE', memberRole: 'ADMIN' },
    );
    expect(promoted.role).toBe('ADMIN');
    const own = (await teams.members(owner.actor, t.id, page)).items.find(
      (r) => r.role === 'OWNER',
    )!;
    await expect(
      service.changeMembership(viewer.actor, t.id, own.id, own.revision, {
        state: 'REVOKED',
        memberRole: 'MEMBER',
      }),
    ).rejects.toThrow();
  });
  it('denies outsiders, suspended actors, stale sessions and unverified recipients without directory leakage', async () => {
    const t = await team(),
      u = await person(undefined, false),
      m = await join(t.id, member, 'MEMBER');
    await expect(teams.read(outsider.actor, t.id)).rejects.toHaveProperty(
      'status',
      404,
    );
    await expect(
      teams.members(outsider.actor, t.id, page),
    ).rejects.toHaveProperty('status', 404);
    const offer = await invite(t.id, u);
    await expect(
      service.decideInvitation(
        u.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
        'TEAM',
      ),
    ).rejects.toThrow();
    await service.changeMembership(owner.actor, t.id, m.id, m.revision, {
      state: 'SUSPENDED',
      memberRole: 'MEMBER',
    });
    await expect(teams.read(member.actor, t.id)).rejects.toHaveProperty(
      'status',
      404,
    );
    expect(
      (await teams.list(member.actor, page)).items.some((r) => r.id === t.id),
    ).toBe(false);
    await client.authSession.update({
      where: { id: owner.actor.sessionId! },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await expect(teams.read(owner.actor, t.id)).rejects.toThrow();
    await client.authSession.update({
      where: { id: owner.actor.sessionId! },
      data: { expiresAt: new Date(Date.now() + 86400000) },
    });
  });
  it('requires verified exact recipient, Team route, current issuer and idempotent acceptance', async () => {
    const t = await team(),
      offer = await invite(t.id, member, 'LEAD');
    expect(await service.preview(offer.proof!, 'TEAM')).toHaveProperty(
      'contextLabel',
      'Team',
    );
    await expect(service.preview(offer.proof!)).rejects.toHaveProperty(
      'status',
      404,
    );
    await expect(
      service.decideInvitation(
        outsider.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
        'TEAM',
      ),
    ).rejects.toThrow();
    await expect(
      service.decideInvitation(
        member.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
      ),
    ).rejects.toHaveProperty('status', 404);
    const accepted = await service.decideInvitation(
      member.actor,
      offer.invitation.id,
      offer.proof!,
      1,
      true,
      'TEAM',
    );
    expect(
      await service.decideInvitation(
        member.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
        'TEAM',
      ),
    ).toEqual(accepted);
    expect(
      (await invite(t.id, viewer, 'VIEWER', member)).invitation.memberRole,
    ).toBe('VIEWER');
  });
  it('links multiple Teams without changing Project custody or implying Project membership', async () => {
    const t = await team(),
      other = await team(),
      p = await project();
    await join(t.id, member);
    await join(other.id, member);
    const first = await teams.reference(
      owner.actor,
      t.id,
      p.id,
      undefined,
      true,
    );
    expect(
      await teams.reference(owner.actor, t.id, p.id, undefined, true),
    ).toEqual(first);
    await teams.reference(owner.actor, other.id, p.id, undefined, true);
    expect((await teams.projectList(member.actor, t.id, page)).items).toEqual(
      [],
    );
    await expect(projects.read(member.actor, p.id)).rejects.toThrow();
    expect(await client.contextAccess.count({ where: { spaceId: p.id } })).toBe(
      1,
    );
    await join(p.id, member, 'VIEWER');
    for (const id of [t.id, other.id])
      expect(
        (await teams.projectList(member.actor, id, page)).items.map(
          (r) => r.project.id,
        ),
      ).toEqual([p.id]);
    expect((await projects.read(member.actor, p.id)).association).toEqual({
      kind: 'INDEPENDENT',
    });
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: p.id },
        })
      ).kind,
    ).toBe('PROJECT');
    const removed = await teams.reference(
      owner.actor,
      t.id,
      p.id,
      first.revision,
      false,
    );
    expect((await teams.projectList(member.actor, t.id, page)).items).toEqual(
      [],
    );
    expect(
      (await teams.projectList(member.actor, other.id, page)).items,
    ).toHaveLength(1);
    await expect(
      teams.reference(owner.actor, t.id, p.id, first.revision, true),
    ).rejects.toHaveProperty('status', 409);
    expect(
      (await teams.reference(owner.actor, t.id, p.id, removed.revision, true))
        .active,
    ).toBe(true);
  });
  it('requires current settings authority in both contexts and preserves unrelated Project references', async () => {
    const t = await team(),
      p = await project(outsider);
    await join(t.id, member, 'ADMIN');
    await expect(
      teams.reference(member.actor, t.id, p.id, undefined, true),
    ).rejects.toThrow();
    await join(p.id, member, 'MANAGER', outsider);
    await expect(
      teams.reference(member.actor, t.id, p.id, undefined, true),
    ).rejects.toHaveProperty('status', 403);
    expect(
      await client.teamProjectReference.count({ where: { teamId: t.id } }),
    ).toBe(0);
    const p2 = await project();
    await join(p2.id, member, 'ADMIN');
    expect(
      (await teams.reference(member.actor, t.id, p2.id, undefined, true))
        .active,
    ).toBe(true);
    await expect(
      teams.reference(owner.actor, randomUUID(), p2.id, undefined, true),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      teams.reference(owner.actor, t.id, t.id, undefined, true),
    ).rejects.toHaveProperty('status', 404);
  });
  it('filters hidden Projects before pagination, binds cursors and invalidates revoked Project access', async () => {
    const t = await team();
    await join(t.id, member);
    const ps = [await project(), await project(), await project()];
    for (const p of ps)
      await teams.reference(owner.actor, t.id, p.id, undefined, true);
    await join(ps[0]!.id, member, 'VIEWER');
    const access = await join(ps[1]!.id, member, 'VIEWER');
    const first = await teams.projectList(member.actor, t.id, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = await teams.projectList(member.actor, t.id, {
      limit: 1,
      after: first.nextCursor!,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(first.items[0]!.project.id).not.toBe(second.items[0]!.project.id);
    await expect(
      teams.projectList(owner.actor, t.id, {
        limit: 1,
        after: first.nextCursor!,
      }),
    ).rejects.toHaveProperty('status', 400);
    await service.changeMembership(
      owner.actor,
      ps[1]!.id,
      access.id,
      access.revision,
      { state: 'REVOKED', memberRole: 'VIEWER' },
    );
    await expect(
      teams.projectList(member.actor, t.id, {
        limit: 1,
        after: first.nextCursor!,
      }),
    ).rejects.toHaveProperty('status', 409);
    expect(
      (await teams.projectList(member.actor, t.id, page)).items,
    ).toHaveLength(1);
  });
  it('revocation invalidates Team invitation replay and old cursors; explicit rejoin advances generation', async () => {
    const t = await team(),
      offer = await invite(t.id, member);
    const accepted = c.TeamInvitationAcceptanceSchema.parse(
      await service.decideInvitation(
        member.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
        'TEAM',
      ),
    );
    const first = await teams.members(member.actor, t.id, { limit: 1 });
    expect(first.nextCursor).toBeTruthy();
    await service.changeMembership(
      owner.actor,
      t.id,
      accepted.membership.id,
      1,
      { state: 'REVOKED', memberRole: 'MEMBER' },
    );
    await expect(
      service.decideInvitation(
        member.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
        'TEAM',
      ),
    ).rejects.toThrow();
    await expect(
      teams.members(member.actor, t.id, { limit: 1, after: first.nextCursor! }),
    ).rejects.toThrow();
    const rejoined = await join(t.id, member);
    expect(rejoined.generation).toBe(2);
    await expect(
      teams.members(member.actor, t.id, { limit: 1, after: first.nextCursor! }),
    ).rejects.toHaveProperty('status', 409);
  });
  it('RACE revoke-first denies queued Team settings mutation with no late effects', async () => {
    const t = await team(),
      m = await join(t.id, member, 'ADMIN'),
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
    const revoke = service.changeMembership(
      owner.actor,
      t.id,
      m.id,
      m.revision,
      { state: 'REVOKED', memberRole: 'ADMIN' },
    );
    await entered.promise;
    const mutation = outcome(
      teams.patch(member.actor, t.id, 1, { title: 'Late' }),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    await revoke;
    expect((await mutation).error).toBeDefined();
    expect(
      (await client.team.findUniqueOrThrow({ where: { id: t.id } })).revision,
    ).toBe(1);
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: t.id, action: 'team.update' },
      }),
    ).toBe(0);
  });
  it('RACE mutation-first commits settings/audit/outbox before a waiting revocation', async () => {
    const t = await team(),
      m = await join(t.id, member, 'ADMIN'),
      entered = barrier(),
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
    const mutation = teams.patch(member.actor, t.id, 1, { title: 'First' });
    await entered.promise;
    const revoke = service.changeMembership(
      owner.actor,
      t.id,
      m.id,
      m.revision,
      { state: 'REVOKED', memberRole: 'ADMIN' },
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await mutation).revision).toBe(2);
    await revoke;
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: t.id, action: 'team.update' },
      }),
    ).toBe(1);
    expect(
      await client.sharedOutboxEvent.count({
        where: { spaceId: t.id, action: 'team.update' },
      }),
    ).toBe(1);
    await expect(
      teams.patch(member.actor, t.id, 2, { title: 'After' }),
    ).rejects.toThrow();
  });
  it('account closure denies Team access immediately and retains independent Project source and Team attribution', async () => {
    const who = await person(),
      t = await team(who),
      p = await project();
    await join(t.id, member, 'MEMBER', who);
    await join(p.id, who);
    const personal = await client.space.findFirstOrThrow({
      where: { ownerUserId: who.actor.userId },
    });
    await client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'personal-access:' + personal.id},0))::text`;
      await tx.space.update({
        where: { id: personal.id },
        data: { accessClosedAt: new Date() },
      });
      await kernel.enqueueExit(tx, who.actor.userId, new Date());
    });
    await expect(teams.read(who.actor, t.id)).rejects.toThrow();
    await expect(teams.read(member.actor, t.id)).rejects.toHaveProperty(
      'status',
      403,
    );
    expect(
      (await client.team.findUniqueOrThrow({ where: { id: t.id } }))
        .createdByActorId,
    ).toBe(t.createdByActorId);
    expect((await projects.read(owner.actor, p.id)).id).toBe(p.id);
    expect(
      await client.sharedExitWork.count({
        where: { userId: who.actor.userId },
      }),
    ).toBe(1);
    expect((await spaces.authorizePersonal(owner.actor)).spaceId).toBeTruthy();
  });
  it('actual HTTP enforces strict Team contracts, Origin, headers, revisions and proof routes', async () => {
    const api = request(app.getHttpServer()),
      body = {
        id: randomUUID(),
        title: 'HTTP Team',
        retentionPolicyVersion: version,
      };
    await api
      .post('/api/v1/teams')
      .set('Origin', origin)
      .send(body)
      .expect(401);
    await api
      .post('/api/v1/teams')
      .set('Cookie', owner.cookie)
      .send(body)
      .expect(403);
    const created = await api
      .post('/api/v1/teams')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(201);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.headers.etag).toBe('"1"');
    await api
      .patch('/api/v1/teams/' + body.id)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({ title: 'No revision' })
      .expect(400);
    await api
      .patch('/api/v1/teams/' + body.id)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({ companyId: randomUUID() })
      .expect(400);
    const offered = await api
      .post('/api/v1/teams/' + body.id + '/invitations')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        kind: 'MEMBERSHIP',
        memberRole: 'LEAD',
        recipient: { userId: member.actor.userId },
      })
      .expect(201);
    await api
      .get('/api/v1/team-invitations/preview')
      .set('X-Invitation-Proof', offered.body.proof)
      .expect(200);
    const accepted = await api
      .post(
        '/api/v1/team-invitations/' + offered.body.invitation.id + '/accept',
      )
      .set('Cookie', member.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .set('X-Invitation-Proof', offered.body.proof)
      .send({})
      .expect(201);
    expect(
      c.TeamInvitationAcceptanceSchema.parse(accepted.body).membership.role,
    ).toBe('LEAD');
    await api
      .get('/api/v1/teams/' + body.id + '/memberships?limit=1')
      .set('Cookie', member.cookie)
      .expect(200);
    await api
      .get('/api/v1/teams/' + body.id + '?unexpected=1')
      .set('Cookie', owner.cookie)
      .expect(400);
  });

  it('self-departure retains sources, ends only its generation and rejects owner abandonment with remaining members', async () => {
    const t = await team(),
      m = await join(t.id, member, 'LEAD');
    await expect(service.leave(owner.actor, t.id, 1)).rejects.toHaveProperty(
      'status',
      409,
    );
    await service.leave(member.actor, t.id, m.revision);
    await expect(teams.read(member.actor, t.id)).rejects.toHaveProperty(
      'status',
      404,
    );
    expect(
      (await teams.members(owner.actor, t.id, page)).items.map((r) => r.role),
    ).toEqual(['OWNER']);
    expect((await join(t.id, member, 'LEAD')).generation).toBe(
      m.generation + 1,
    );
  });
  it('does not admit Project grant-only collaborators to Team directory or Project lists', async () => {
    const t = await team(),
      p = await project(),
      who = await person();
    await teams.reference(owner.actor, t.id, p.id, undefined, true);
    const offer = await projects.grantOffer(
      owner.actor,
      p.id,
      {
        id: randomUUID(),
        recipientUserId: who.actor.userId,
        target: { kind: 'PROJECT', id: p.id },
        capabilities: ['read'],
        grantExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      randomUUID(),
    );
    await grants.decide(
      who.actor,
      offer.offer.id,
      offer.proof!,
      1,
      true,
      projects.validateGrantTarget,
    );
    expect((await projects.read(who.actor, p.id)).id).toBe(p.id);
    await expect(teams.members(who.actor, t.id, page)).rejects.toHaveProperty(
      'status',
      404,
    );
    await join(t.id, who, 'VIEWER');
    expect((await teams.projectList(who.actor, t.id, page)).items).toEqual([]);
  });
  it('demotion invalidates pending Lead offers and preserves signed Team revocation replay without private data', async () => {
    const t = await team(),
      lead = await join(t.id, member, 'LEAD'),
      offer = await invite(t.id, viewer, 'VIEWER', member);
    await service.changeMembership(owner.actor, t.id, lead.id, lead.revision, {
      state: 'ACTIVE',
      memberRole: 'MEMBER',
    });
    await expect(
      service.decideInvitation(
        viewer.actor,
        offer.invitation.id,
        offer.proof!,
        1,
        true,
        'TEAM',
      ),
    ).rejects.toThrow();
    const replay = (await control.replayEvidence()).filter(
      (r) => r.spaceId === t.id && r.action === 'membership.change',
    );
    expect(replay).toHaveLength(1);
    expect(replay[0]!.policy!.roleDefaults).toHaveProperty('LEAD');
    expect(replay[0]!.accesses.find((r) => r.id === lead.id)!.memberRole).toBe(
      'MEMBER',
    );
    const encoded = JSON.stringify(replay);
    for (const value of [
      member.actor.userId,
      member.email,
      offer.proof!,
      password,
    ])
      expect(encoded).not.toContain(value);
  });
  it('RACE Project revocation wins before a cross-custody Team reference and leaves no link or effects', async () => {
    const t = await team(),
      p = await project(),
      m = await join(p.id, member, 'ADMIN');
    await join(t.id, member, 'ADMIN');
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
    const revoke = service.changeMembership(
      owner.actor,
      p.id,
      m.id,
      m.revision,
      { state: 'REVOKED', memberRole: 'ADMIN' },
    );
    await entered.promise;
    const mutation = outcome(
      teams.reference(member.actor, t.id, p.id, undefined, true),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    await revoke;
    expect((await mutation).error).toBeDefined();
    expect(
      await client.teamProjectReference.count({
        where: { teamId: t.id, projectId: p.id },
      }),
    ).toBe(0);
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: t.id, action: 'team.project.reference' },
      }),
    ).toBe(0);
  });

  it('enforces free-mode reference growth in the fenced transaction and accounts one retained reference on retry', async () => {
    const t = await team(),
      p = await project(),
      feature = app.get(SharedFeaturePolicy),
      decide = feature.decide.bind(feature);
    const deny = vi
      .spyOn(feature, 'decide')
      .mockImplementation((input, tx) =>
        input.feature === 'team.project-reference'
          ? Promise.resolve({ allowed: false, mode: 'FREE' })
          : decide(input, tx),
      );
    await expect(
      teams.reference(owner.actor, t.id, p.id, undefined, true),
    ).rejects.toHaveProperty('status', 403);
    deny.mockRestore();
    expect(
      await client.teamProjectReference.count({ where: { teamId: t.id } }),
    ).toBe(0);
    await teams.reference(owner.actor, t.id, p.id, undefined, true);
    await teams.reference(owner.actor, t.id, p.id, undefined, true);
    expect(
      await client.sharedUsageEntry.count({
        where: { spaceId: t.id, feature: 'team.project-reference' },
      }),
    ).toBe(1);
  });

  it('detaches erased Team Lead identity while preserving Team and independently referenced Project', async () => {
    const t = await team(),
      p = await project(),
      who = await person(),
      lead = await join(t.id, who, 'LEAD');
    await teams.reference(owner.actor, t.id, p.id, undefined, true);
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
    await kernel.prepareIdentityErasure(who.actor.userId, closedAt);
    const actor = await client.sharedActor.findUniqueOrThrow({
      where: { id: lead.actorId },
    });
    expect(actor.state).toBe('ERASED');
    expect(actor.userId).toBeNull();
    expect(
      (await teams.members(owner.actor, t.id, page)).items.some(
        (r) => r.id === lead.id,
      ),
    ).toBe(false);
    expect(
      (await teams.projectList(owner.actor, t.id, page)).items[0]!.project.id,
    ).toBe(p.id);
    const replay = (await control.replayEvidence()).filter(
      (r) =>
        r.spaceId === t.id &&
        r.accesses.some((a) => a.id === lead.id && a.erased),
    );
    expect(replay.length).toBeGreaterThan(0);
    for (const value of [who.actor.userId, who.email])
      expect(JSON.stringify(replay)).not.toContain(value);
  });
  it('Team HTTP supports offer read/revoke/decline, role revision and self-departure; rejects Project routes', async () => {
    const t = await team(),
      api = request(app.getHttpServer());
    const offer = await api
      .post('/api/v1/teams/' + t.id + '/invitations')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        kind: 'MEMBERSHIP',
        memberRole: 'LEAD',
        recipient: { userId: member.actor.userId },
      })
      .expect(201);
    await api
      .get('/api/v1/teams/' + t.id + '/invitations/' + offer.body.invitation.id)
      .set('Cookie', owner.cookie)
      .expect(200);
    await api
      .get(
        '/api/v1/spaces/' + t.id + '/invitations/' + offer.body.invitation.id,
      )
      .set('Cookie', owner.cookie)
      .expect(404);
    await api
      .post(
        '/api/v1/teams/' +
          t.id +
          '/invitations/' +
          offer.body.invitation.id +
          '/revoke',
      )
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({})
      .expect(201);
    await api
      .get('/api/v1/team-invitations/preview')
      .set('X-Invitation-Proof', offer.body.proof)
      .expect(404);
    const otherOffer = await invite(t.id, viewer, 'VIEWER');
    await api
      .post('/api/v1/team-invitations/' + otherOffer.invitation.id + '/decline')
      .set('Cookie', viewer.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .set('X-Invitation-Proof', otherOffer.proof!)
      .send({})
      .expect(201);
    const m = await join(t.id, member, 'MEMBER');
    const changed = await api
      .patch('/api/v1/teams/' + t.id + '/memberships/' + m.id)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({ state: 'ACTIVE', memberRole: 'LEAD' })
      .expect(200);
    expect(changed.body.role).toBe('LEAD');
    await api
      .post('/api/v1/teams/' + t.id + '/leave')
      .set('Cookie', member.cookie)
      .set('Origin', origin)
      .set('If-Match', '"2"')
      .send({})
      .expect(201);
    await api
      .get('/api/v1/teams/' + t.id)
      .set('Cookie', member.cookie)
      .expect(404);
  });
});
