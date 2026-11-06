import {
  TeamCareService,
  TeamMeetingsService,
} from '../../src/modules/teams/public/index.js';
import { SharedFeaturePolicy } from '../../src/modules/spaces/public/index.js';
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
describe('P3-04 confidential Team records, disclosure and light meetings', () => {
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
    name = 'p304-' + randomUUID(),
    version = 'synthetic-p304-' + randomUUID();
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P304-ONLY',
      },
    });
    control = app.get(SharedControl);
    await control.initialize();
    service = app.get(CollaborationService);
    teams = app.get(TeamsService);
    work = app.get(TeamWorkService);
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

  const page = { limit: 25 };
  const memberRef = (m: { id: string; generation: number }) => ({
    accessId: m.id,
    generation: m.generation,
  });
  async function fixture(
    kind: 'RECOGNITION' | 'FEEDBACK' | 'CORRECTIVE' = 'CORRECTIVE',
    by = owner,
    subject = member,
  ) {
    const t = await team(),
      m = await join(t.id, subject, subject === viewer ? 'VIEWER' : 'MEMBER'),
      r = await join(t.id, reviewer, 'ADMIN');
    if (by !== owner) await join(t.id, by, 'LEAD');
    const input = {
      id: randomUUID(),
      kind,
      subject: memberRef(m),
      reviewer: memberRef(r),
      reason: 'CONFIDENTIAL reason sentinel',
      evidence: 'CONFIDENTIAL evidence sentinel',
    };
    const record = await care.create(by.actor, t.id, input, randomUUID());
    return { t, m, r, record, input, by, subject };
  }
  async function propose(
    f: Awaited<ReturnType<typeof fixture>>,
    audience: 'NAMED' | 'TEAM' = 'NAMED',
  ) {
    let recipients: { accessId: string; generation: number }[] = [];
    if (audience === 'NAMED') {
      const v = await join(f.t.id, viewer, 'VIEWER');
      recipients = [memberRef(v)];
    }
    return care.propose(
      f.by.actor,
      f.t.id,
      f.record.id,
      {
        id: randomUUID(),
        sourceRevision: f.record.revision,
        audience,
        recipients,
        summary: 'Approved bounded summary only',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      randomUUID(),
    );
  }
  const summaries = async (id: string, who = viewer, q = page) =>
    c.TeamDisclosureSummaryPageSchema.parse(
      await care.summaries(who.actor, id, q),
    );
  async function approve(
    f: Awaited<ReturnType<typeof fixture>>,
    p: zDisclosure,
  ) {
    return care.decide(reviewer.actor, f.t.id, p.id, p.revision, {
      kind: 'REVIEW',
      approve: true,
      reason: 'CONFIDENTIAL reviewer decision',
    });
  }
  type zDisclosure = { id: string; revision: number };
  const eventInput = {
    title: 'Ordinary Team meeting',
    schedule: {
      kind: 'TIMED' as const,
      timezone: 'Asia/Tehran',
      localStart: '2030-01-07T09:00',
      localEnd: '2030-01-07T10:00',
    },
  };
  async function meeting(tid: string) {
    return meetings.create(
      owner.actor,
      tid,
      { id: randomUUID(), event: eventInput, agenda: 'Bounded Team agenda' },
      randomUUID(),
    );
  }
  it('confines case bodies to three designated readers and denies even an unrelated Owner/Admin and Lead', async () => {
    const f = await fixture('CORRECTIVE', member, viewer);
    expect(
      (await care.read(member.actor, f.t.id, f.record.id)).evidence,
    ).toContain('CONFIDENTIAL');
    expect((await care.read(viewer.actor, f.t.id, f.record.id)).id).toBe(
      f.record.id,
    );
    expect((await care.read(reviewer.actor, f.t.id, f.record.id)).id).toBe(
      f.record.id,
    );
    await expect(
      care.read(owner.actor, f.t.id, f.record.id),
    ).rejects.toHaveProperty('status', 404);
    await join(f.t.id, outsider, 'ADMIN');
    expect((await care.list(outsider.actor, f.t.id, page)).items).toEqual([]);
    await expect(
      care.read(outsider.actor, f.t.id, f.record.id),
    ).rejects.toHaveProperty('status', 404);
    const audits = await client.sharedAuditEvent.findMany({
      where: { spaceId: f.t.id },
    });
    expect(audits.some((a) => a.action === 'team.case.read')).toBe(true);
    expect(JSON.stringify(audits)).not.toContain('CONFIDENTIAL');
    expect(
      JSON.stringify(
        await client.sharedOutboxEvent.findMany({ where: { spaceId: f.t.id } }),
        (_key, value) => (typeof value === 'bigint' ? String(value) : value),
      ),
    ).not.toContain('CONFIDENTIAL');
  });
  it('enforces reviewer separation, current Owner/Admin authority, scoped participants and corrective creation ceiling', async () => {
    const f = await fixture(),
      other = await team(),
      foreign = await join(other.id, outsider);
    await expect(
      care.create(
        owner.actor,
        f.t.id,
        { ...f.input, id: randomUUID(), reviewer: f.record.author },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      care.create(
        owner.actor,
        f.t.id,
        { ...f.input, id: randomUUID(), subject: memberRef(foreign) },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      care.create(
        owner.actor,
        f.t.id,
        { ...f.input, id: randomUUID(), reviewer: memberRef(f.m) },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      care.create(
        member.actor,
        f.t.id,
        { ...f.input, id: randomUUID(), subject: f.record.author },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      care.read(owner.actor, other.id, f.record.id),
    ).rejects.toHaveProperty('status', 404);
    const p = await project();
    await expect(
      care.read(owner.actor, p.id, f.record.id),
    ).rejects.toHaveProperty('status', 404);
  });
  it('allows ordinary member recognition/feedback while keeping them confidential by default', async () => {
    const f = await fixture('FEEDBACK'),
      input = {
        ...f.input,
        id: randomUUID(),
        kind: 'RECOGNITION' as const,
        subject: f.record.author,
      };
    const record = await care.create(member.actor, f.t.id, input, randomUUID());
    expect(record.author).toEqual(memberRef(f.m));
    await join(f.t.id, viewer, 'VIEWER');
    expect((await care.list(viewer.actor, f.t.id, page)).items).toEqual([]);
    expect((await summaries(f.t.id)).items).toEqual([]);
  });
  it('records immutable subject response/appeal and designated review without granting general Viewer editing', async () => {
    const f = await fixture('CORRECTIVE', member, viewer),
      input = {
        id: randomUUID(),
        kind: 'APPEAL' as const,
        body: 'Subject challenges the evidence',
      },
      key = randomUUID();
    const appealed = await care.entry(
      viewer.actor,
      f.t.id,
      f.record.id,
      1,
      input,
      key,
    );
    expect(appealed.revision).toBe(2);
    expect(
      await care.entry(viewer.actor, f.t.id, f.record.id, 1, input, key),
    ).toEqual(appealed);
    await expect(
      care.entry(
        member.actor,
        f.t.id,
        f.record.id,
        2,
        { id: randomUUID(), kind: 'RESPONSE', body: 'Impersonation' },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      care.entry(
        member.actor,
        f.t.id,
        f.record.id,
        2,
        { id: randomUUID(), body: 'Self review', resolution: 'RESOLVED' },
        randomUUID(),
        true,
      ),
    ).rejects.toHaveProperty('status', 403);
    const reviewed = await care.entry(
      reviewer.actor,
      f.t.id,
      f.record.id,
      2,
      {
        id: randomUUID(),
        body: 'Reviewed subject evidence',
        resolution: 'RESOLVED',
      },
      randomUUID(),
      true,
    );
    expect(reviewed).toMatchObject({ revision: 3, state: 'RESOLVED' });
    expect(
      (await care.entries(viewer.actor, f.t.id, f.record.id, page)).items
        .map((r) => r.kind)
        .sort(),
    ).toEqual(['APPEAL', 'REVIEW']);
    await expect(
      client.teamCaseEntry.update({
        where: { id: input.id },
        data: { body: 'Rewrite' },
      }),
    ).rejects.toThrow();
    expect(
      (await client.teamCase.findUniqueOrThrow({ where: { id: f.record.id } }))
        .reason,
    ).toBe(f.input.reason);
  });
  it('publishes only an exact independently reviewed summary to named generations and supports revocation', async () => {
    const f = await fixture(),
      p = await propose(f);
    expect((await summaries(f.t.id)).items).toEqual([]);
    await expect(
      care.decide(owner.actor, f.t.id, p.id, 1, {
        kind: 'REVIEW',
        approve: true,
        reason: 'Self approval',
      }),
    ).rejects.toHaveProperty('status', 403);
    const reviewed = await approve(f, p);
    const disclosed = (await summaries(f.t.id)).items;
    expect(disclosed).toEqual([
      {
        id: p.id,
        kind: 'CORRECTIVE',
        summary: p.summary,
        expiresAt: p.expiresAt,
      },
    ]);
    expect(JSON.stringify(disclosed)).not.toMatch(
      /CONFIDENTIAL|caseId|reason|evidence|reviewNote/,
    );
    expect(JSON.stringify(disclosed)).not.toContain(f.record.id);
    await expect(
      care.read(viewer.actor, f.t.id, f.record.id),
    ).rejects.toHaveProperty('status', 404);
    await care.decide(member.actor, f.t.id, p.id, reviewed.revision, {
      kind: 'REVOKE',
    });
    expect((await summaries(f.t.id)).items).toEqual([]);
    await expect(
      care.summaries(viewer.actor, f.t.id, page, p.id),
    ).rejects.toHaveProperty('status', 404);
  });
  it('requires subject consent for Team-visible recognition and honors consent withdrawal', async () => {
    const f = await fixture('RECOGNITION');
    await join(f.t.id, viewer, 'VIEWER');
    const p = await propose(f, 'TEAM'),
      reviewed = await approve(f, p);
    expect((await summaries(f.t.id)).items).toEqual([]);
    await expect(
      care.decide(owner.actor, f.t.id, p.id, reviewed.revision, {
        kind: 'CONSENT',
        consent: true,
      }),
    ).rejects.toHaveProperty('status', 403);
    const consent = await care.decide(
      member.actor,
      f.t.id,
      p.id,
      reviewed.revision,
      { kind: 'CONSENT', consent: true },
    );
    expect((await summaries(f.t.id)).items).toHaveLength(1);
    await care.decide(member.actor, f.t.id, p.id, consent.revision, {
      kind: 'CONSENT',
      consent: false,
    });
    expect((await summaries(f.t.id)).items).toEqual([]);
    const confidential = await fixture();
    await expect(
      care.propose(
        owner.actor,
        confidential.t.id,
        confidential.record.id,
        {
          id: randomUUID(),
          sourceRevision: 1,
          audience: 'TEAM',
          recipients: [],
          summary: 'Forbidden broad discipline',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
  });
  it('invalidates reviewed summaries on new responses/appeals and rejects stale or expired proposals', async () => {
    const f = await fixture(),
      p = await propose(f);
    await approve(f, p);
    await care.entry(
      member.actor,
      f.t.id,
      f.record.id,
      1,
      { id: randomUUID(), kind: 'APPEAL', body: 'New relevant evidence' },
      randomUUID(),
    );
    expect((await summaries(f.t.id)).items).toEqual([]);
    await expect(
      care.propose(
        owner.actor,
        f.t.id,
        f.record.id,
        {
          id: randomUUID(),
          sourceRevision: 1,
          audience: 'NAMED',
          recipients: p.recipients,
          summary: 'Stale summary',
          expiresAt: p.expiresAt,
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      care.propose(
        owner.actor,
        f.t.id,
        f.record.id,
        {
          id: randomUUID(),
          sourceRevision: 2,
          audience: 'NAMED',
          recipients: p.recipients,
          summary: 'Too long',
          expiresAt: new Date(Date.now() + 31 * 86400000).toISOString(),
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 409);
  });
  it('expires disclosures by database time and preserves their confidential source records', async () => {
    const f = await fixture(),
      p = await propose(f),
      approved = await approve(f, p),
      stored = await client.teamDisclosure.findUniqueOrThrow({
        where: { id: p.id },
      }),
      expiredId = randomUUID();
    await client.teamDisclosure.create({
      data: {
        ...stored,
        id: expiredId,
        createdAt: new Date(Date.now() - 2 * 86400000),
        expiresAt: new Date(Date.now() - 86400000),
      },
    });
    await client.teamDisclosureRecipient.createMany({
      data: p.recipients.map((m) => ({
        spaceId: f.t.id,
        scopeId: f.t.id,
        disclosureId: expiredId,
        ...m,
      })),
    });
    await care.decide(owner.actor, f.t.id, p.id, approved.revision, {
      kind: 'REVOKE',
    });
    expect((await summaries(f.t.id)).items).toEqual([]);
    await expect(
      care.summaries(viewer.actor, f.t.id, page, expiredId),
    ).rejects.toHaveProperty('status', 404);
    expect((await care.read(member.actor, f.t.id, f.record.id)).id).toBe(
      f.record.id,
    );
  });
  it('removes reviewer authority on demotion and denies old private readers or disclosure recipients after rejoin', async () => {
    const f = await fixture(),
      p = await propose(f);
    await approve(f, p);
    await service.changeMembership(owner.actor, f.t.id, f.r.id, 1, {
      state: 'ACTIVE',
      memberRole: 'MEMBER',
    });
    await expect(
      care.read(reviewer.actor, f.t.id, f.record.id),
    ).rejects.toHaveProperty('status', 404);
    expect((await summaries(f.t.id)).items).toEqual([]);
    await service.changeMembership(owner.actor, f.t.id, f.r.id, 2, {
      state: 'ACTIVE',
      memberRole: 'ADMIN',
    });
    const v = await client.contextAccess.findFirstOrThrow({
      where: { spaceId: f.t.id, SharedActor: { userId: viewer.actor.userId } },
    });
    await service.changeMembership(owner.actor, f.t.id, v.id, 1, {
      state: 'REVOKED',
      memberRole: 'VIEWER',
    });
    await join(f.t.id, viewer, 'VIEWER');
    expect((await summaries(f.t.id)).items).toEqual([]);
    await service.changeMembership(owner.actor, f.t.id, f.m.id, 1, {
      state: 'REVOKED',
      memberRole: 'MEMBER',
    });
    await join(f.t.id, member);
    await expect(
      care.read(member.actor, f.t.id, f.record.id),
    ).rejects.toHaveProperty('status', 404);
  });
  it('filters confidential cases and publications before pagination; cursors bind actor, query and authority', async () => {
    const f = await fixture(),
      p = await propose(f);
    await approve(f, p);
    await care.create(
      owner.actor,
      f.t.id,
      { ...f.input, id: randomUUID() },
      randomUUID(),
    );
    const first = await care.list(owner.actor, f.t.id, { limit: 1 });
    expect(first.nextCursor).toBeTruthy();
    expect(
      (
        await care.list(owner.actor, f.t.id, {
          limit: 1,
          after: first.nextCursor!,
        })
      ).items,
    ).toHaveLength(1);
    await expect(
      care.list(member.actor, f.t.id, { limit: 1, after: first.nextCursor! }),
    ).rejects.toHaveProperty('status', 400);
    expect((await care.list(viewer.actor, f.t.id, { limit: 1 })).items).toEqual(
      [],
    );
    expect((await summaries(f.t.id, viewer, { limit: 1 })).items).toHaveLength(
      1,
    );
    await join(f.t.id, outsider);
    await expect(
      care.list(owner.actor, f.t.id, { limit: 1, after: first.nextCursor! }),
    ).rejects.toHaveProperty('status', 409);
  });
  it('rolls back private records, receipts, usage and effects and reconciles a restrictive failure intent', async () => {
    const f = await fixture(),
      input = { ...f.input, id: randomUUID() },
      key = randomUUID();
    vi.spyOn(kernel, 'offerEffect').mockRejectedValueOnce(
      new Error('synthetic effect failure'),
    );
    await expect(care.create(owner.actor, f.t.id, input, key)).rejects.toThrow(
      'synthetic effect failure',
    );
    vi.restoreAllMocks();
    expect(await client.teamCase.count({ where: { id: input.id } })).toBe(0);
    expect(
      await client.sharedMutationReceipt.count({
        where: { spaceId: f.t.id, resultId: input.id },
      }),
    ).toBe(0);
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: f.t.id, resourceId: input.id },
      }),
    ).toBe(0);
    expect(
      (
        await client.sharedUsageEntry.aggregate({
          where: { spaceId: f.t.id, feature: 'team.case' },
          _sum: { delta: true },
        })
      )._sum.delta,
    ).toBe(1);
    await kernel.reconcileControl(f.t.id);
    const result = await care.create(owner.actor, f.t.id, input, key);
    expect(await care.create(owner.actor, f.t.id, input, key)).toEqual(result);
  });
  it('RACE winning membership revocation prevents a confidential write or old creation receipt replay', async () => {
    const f = await fixture('CORRECTIVE', member, viewer),
      m = await client.contextAccess.findFirstOrThrow({
        where: {
          spaceId: f.t.id,
          SharedActor: { userId: member.actor.userId },
        },
      });
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
    const revoke = service.changeMembership(owner.actor, f.t.id, m.id, 1, {
      state: 'REVOKED',
      memberRole: 'LEAD',
    });
    await entered.promise;
    const write = outcome(
      care.create(
        member.actor,
        f.t.id,
        { ...f.input, id: randomUUID() },
        randomUUID(),
      ),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    await revoke;
    expect((await write).error).toBeDefined();
    expect(await client.teamCase.count({ where: { spaceId: f.t.id } })).toBe(1);
    await expect(
      care.read(member.actor, f.t.id, f.record.id),
    ).rejects.toHaveProperty('status', 404);
  });
  it('RACE a confidential write commits before waiting membership revocation', async () => {
    const f = await fixture('CORRECTIVE', member, viewer),
      m = await client.contextAccess.findFirstOrThrow({
        where: {
          spaceId: f.t.id,
          SharedActor: { userId: member.actor.userId },
        },
      }),
      entered = barrier(),
      release = barrier(),
      effect = kernel.offerEffect.bind(kernel),
      input = { ...f.input, id: randomUUID() };
    vi.spyOn(kernel, 'offerEffect').mockImplementationOnce(async (...args) => {
      const result = await effect(...args);
      entered.release();
      await release.promise;
      return result;
    });
    const write = care.create(member.actor, f.t.id, input, randomUUID());
    await entered.promise;
    const revoke = service.changeMembership(owner.actor, f.t.id, m.id, 1, {
      state: 'REVOKED',
      memberRole: 'LEAD',
    });
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await write).id).toBe(input.id);
    await revoke;
    expect(
      await client.sharedAuditEvent.count({
        where: {
          spaceId: f.t.id,
          resourceId: input.id,
          action: 'team.case.create',
        },
      }),
    ).toBe(1);
  });
  it('rejects unverified and invalidated sessions and keeps confidential data out of existing source APIs', async () => {
    const f = await fixture(),
      stale = await person();
    await join(f.t.id, stale);
    await client.authSession.delete({ where: { id: stale.actor.sessionId! } });
    await expect(care.list(stale.actor, f.t.id, page)).rejects.toHaveProperty(
      'status',
      403,
    );
    await client.user.update({
      where: { id: member.actor.userId },
      data: { emailVerified: false },
    });
    await expect(
      care.read(member.actor, f.t.id, f.record.id),
    ).rejects.toHaveProperty('status', 403);
    await client.user.update({
      where: { id: member.actor.userId },
      data: { emailVerified: true },
    });
    await request(app.getHttpServer())
      .get('/api/v1/teams/' + f.t.id + '/cases/' + f.record.id)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/teams/' + f.t.id + '/cases')
      .set('Cookie', owner.cookie)
      .query({ search: 'evidence' })
      .expect(400);
    const tasks = await work.sourceList(owner.actor, f.t.id, 'TASK', page);
    expect(tasks.items).toEqual([]);
    expect(
      JSON.stringify(
        await client.sharedAuditEvent.findMany({ where: { spaceId: f.t.id } }),
      ),
    ).not.toContain('CONFIDENTIAL');
  });
  it('uses the free growth seam with authoritative confidential record and entry usage', async () => {
    const f = await fixture(),
      policy = app.get(SharedFeaturePolicy),
      decide = policy.decide.bind(policy),
      calls: unknown[] = [];
    vi.spyOn(policy, 'decide').mockImplementation(async (input, tx) => {
      calls.push(input);
      return decide(input, tx);
    });
    await care.create(
      owner.actor,
      f.t.id,
      { ...f.input, id: randomUUID() },
      randomUUID(),
    );
    await care.entry(
      member.actor,
      f.t.id,
      f.record.id,
      1,
      { id: randomUUID(), kind: 'RESPONSE', body: 'Owner-visible response' },
      randomUUID(),
    );
    expect(calls).toContainEqual({
      feature: 'team.case',
      usageOwner: { kind: 'SHARED_CUSTODY', spaceId: f.t.id },
      growth: 1,
      currentUsage: 1,
    });
    expect(calls).toContainEqual({
      feature: 'team.case-entry',
      usageOwner: { kind: 'SHARED_CUSTODY', spaceId: f.t.id },
      growth: 1,
      currentUsage: 0,
    });
  });
  it('keeps meetings in the existing Calendar engine with bounded agenda edits and stable event identity', async () => {
    const t = await team(),
      m = await meeting(t.id);
    await join(t.id, viewer, 'VIEWER');
    const event = await work.calendarCommand(owner.actor, t.id, {
      kind: 'READ',
      id: m.event.id,
    });
    expect(c.TeamCalendarEventSchema.parse(event).id).toBe(m.event.id);
    expect((await meetings.read(viewer.actor, t.id, m.id)).agenda).toBe(
      'Bounded Team agenda',
    );
    expect(
      (
        await meetings.patch(owner.actor, t.id, m.id, 1, {
          agenda: 'Updated agenda',
        })
      ).revision,
    ).toBe(2);
    await expect(
      meetings.patch(owner.actor, t.id, m.id, 1, { agenda: 'Stale' }),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      meetings.patch(viewer.actor, t.id, m.id, 2, { agenda: 'Denied' }),
    ).rejects.toHaveProperty('status', 403);
    expect(
      await client.calendarEvent.count({ where: { id: m.event.id } }),
    ).toBe(1);
    expect(await client.timeBlock.count({ where: { spaceId: t.id } })).toBe(0);
    await expect(
      meetings.read(outsider.actor, t.id, m.id),
    ).rejects.toHaveProperty('status', 404);
  });
  it('creates current-member invitations with scoped receipts and permits only the named recipient to respond', async () => {
    const t = await team(),
      m = await meeting(t.id),
      v = await join(t.id, viewer, 'VIEWER');
    await join(t.id, member);
    const input = {
        id: randomUUID(),
        member: memberRef(v),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      key = randomUUID();
    const first = await meetings.invite(owner.actor, t.id, m.id, 1, input, key);
    expect(
      await meetings.invite(owner.actor, t.id, m.id, 1, input, key),
    ).toEqual(first);
    expect(
      (await meetings.invitations(member.actor, t.id, m.id, page)).items,
    ).toEqual([]);
    await expect(
      meetings.respond(member.actor, t.id, m.id, first.id, 1, 'ACCEPTED'),
    ).rejects.toHaveProperty('status', 403);
    expect(
      (
        await meetings.respond(
          viewer.actor,
          t.id,
          m.id,
          first.id,
          1,
          'ACCEPTED',
        )
      ).state,
    ).toBe('ACCEPTED');
    await expect(
      meetings.respond(viewer.actor, t.id, m.id, first.id, 1, 'DECLINED'),
    ).rejects.toHaveProperty('status', 409);
    expect(
      (await meetings.respond(owner.actor, t.id, m.id, first.id, 2, 'REVOKED'))
        .state,
    ).toBe('REVOKED');
    expect(
      (
        await client.sharedUsageEntry.aggregate({
          where: { spaceId: t.id, feature: 'team.meeting-invitation' },
          _sum: { delta: true },
        })
      )._sum.delta,
    ).toBe(1);
  });
  it('rejects foreign members, long expiry and closed Calendar sources; retains source compatibility', async () => {
    const t = await team(),
      m = await meeting(t.id),
      other = await team(),
      foreign = await join(other.id, member),
      v = await join(t.id, viewer, 'VIEWER');
    const input = {
      id: randomUUID(),
      member: memberRef(v),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    await expect(
      meetings.invite(
        owner.actor,
        t.id,
        m.id,
        1,
        { ...input, member: memberRef(foreign) },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      meetings.invite(
        owner.actor,
        t.id,
        m.id,
        1,
        {
          ...input,
          expiresAt: new Date(Date.now() + 8 * 86400000).toISOString(),
        },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 409);
    const invite = await meetings.invite(
      owner.actor,
      t.id,
      m.id,
      1,
      input,
      randomUUID(),
    );
    await work.calendarCommand(owner.actor, t.id, {
      kind: 'PATCH',
      id: m.event.id,
      revision: 1,
      input: { status: 'CANCELED' },
    });
    await expect(
      meetings.respond(viewer.actor, t.id, m.id, invite.id, 1, 'ACCEPTED'),
    ).rejects.toHaveProperty('status', 404);
    expect((await meetings.read(viewer.actor, t.id, m.id)).event.status).toBe(
      'CANCELED',
    );
  });
  it('expires meeting invitations by database time and invalidates their admission generation', async () => {
    const t = await team(),
      m = await meeting(t.id),
      v = await join(t.id, viewer, 'VIEWER');
    const invite = await meetings.invite(
      owner.actor,
      t.id,
      m.id,
      1,
      {
        id: randomUUID(),
        member: memberRef(v),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      randomUUID(),
    );
    const stored = await client.teamMeetingInvitation.findUniqueOrThrow({
        where: { id: invite.id },
      }),
      expiredId = randomUUID();
    await client.teamMeetingInvitation.create({
      data: {
        ...stored,
        id: expiredId,
        createdAt: new Date(Date.now() - 2 * 86400000),
        expiresAt: new Date(Date.now() - 86400000),
      },
    });
    expect(
      (await meetings.invitations(viewer.actor, t.id, m.id, page)).items.find(
        (r) => r.id === expiredId,
      )!.state,
    ).toBe('EXPIRED');
    await expect(
      meetings.respond(viewer.actor, t.id, m.id, expiredId, 1, 'ACCEPTED'),
    ).rejects.toHaveProperty('status', 409);
    await service.changeMembership(owner.actor, t.id, v.id, 1, {
      state: 'REVOKED',
      memberRole: 'VIEWER',
    });
    await join(t.id, viewer, 'VIEWER');
    expect(
      (await meetings.invitations(viewer.actor, t.id, m.id, page)).items,
    ).toEqual([]);
    await expect(
      meetings.respond(viewer.actor, t.id, m.id, invite.id, 1, 'ACCEPTED'),
    ).rejects.toHaveProperty('status', 403);
  });
  it('invalidates restored disclosure and meeting-invitation authorities before allowing ordinary access', async () => {
    const f = await fixture(),
      p = await propose(f),
      approved = await approve(f, p),
      meetingRecord = await meeting(f.t.id),
      v = await client.contextAccess.findFirstOrThrow({
        where: {
          spaceId: f.t.id,
          SharedActor: { userId: viewer.actor.userId },
        },
      });
    const invitation = await meetings.invite(
      owner.actor,
      f.t.id,
      meetingRecord.id,
      1,
      {
        id: randomUUID(),
        member: memberRef(v),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      randomUUID(),
    );
    const old = await client.teamDisclosure.findUniqueOrThrow({
        where: { id: p.id },
      }),
      snapshot = await client.sharedCustody.findUniqueOrThrow({
        where: { spaceId: f.t.id },
      });
    await care.decide(member.actor, f.t.id, p.id, approved.revision, {
      kind: 'REVOKE',
    });
    // Reconstruct only this synthetic older snapshot, keeping independent signed evidence newer.
    await client.$transaction(async (tx) => {
      await tx.teamDisclosureRecipient.deleteMany({
        where: { disclosureId: p.id },
      });
      await tx.teamDisclosure.delete({ where: { id: p.id } });
      await tx.teamDisclosure.create({ data: old });
      await tx.teamDisclosureRecipient.createMany({
        data: p.recipients.map((m) => ({
          spaceId: f.t.id,
          scopeId: f.t.id,
          disclosureId: p.id,
          ...m,
        })),
      });
      await tx.sharedCustody.update({
        where: { spaceId: f.t.id },
        data: { authorizationVersion: snapshot.authorizationVersion },
      });
    });
    await expect(summaries(f.t.id)).rejects.toHaveProperty('status', 403);
    const restored = await kernel.restoreRestrictions(
      f.t.id,
      async (_tx, _scope, fileId) => {
        expect(fileId).toBeNull();
      },
    );
    expect(restored).toBeDefined();
    expect(
      (await client.accessScope.findUniqueOrThrow({ where: { id: f.t.id } }))
        .restoreGeneration,
    ).toBeGreaterThan(0);
    expect((await summaries(f.t.id)).items).toEqual([]);
    await expect(
      meetings.respond(
        viewer.actor,
        f.t.id,
        meetingRecord.id,
        invitation.id,
        1,
        'ACCEPTED',
      ),
    ).rejects.toHaveProperty('status', 409);
  });
  it('RACE winning disclosure revocation removes a waiting reader without exposing the private source', async () => {
    const f = await fixture(),
      p = await propose(f),
      approved = await approve(f, p),
      entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (r.action === 'team.disclosure.revoke' && r.outcome === 'INTENT') {
        entered.release();
        await release.promise;
      }
    });
    const revoke = care.decide(member.actor, f.t.id, p.id, approved.revision, {
      kind: 'REVOKE',
    });
    await entered.promise;
    const read = outcome(summaries(f.t.id));
    try {
      await blocked();
    } finally {
      release.release();
    }
    await revoke;
    const result = await read;
    if (result.error) expect(result.error).toHaveProperty('status', 403);
    else
      expect(
        c.TeamDisclosureSummaryPageSchema.parse(result.value).items,
      ).toEqual([]);
    expect((await summaries(f.t.id)).items).toEqual([]);
  });
  it('RACE a disclosed summary read commits before waiting revocation and cannot be replayed afterward', async () => {
    const f = await fixture(),
      p = await propose(f),
      approved = await approve(f, p),
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
    const read = summaries(f.t.id);
    await entered.promise;
    const revoke = care.decide(member.actor, f.t.id, p.id, approved.revision, {
      kind: 'REVOKE',
    });
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await read).items).toHaveLength(1);
    await revoke;
    expect((await summaries(f.t.id)).items).toEqual([]);
  });
  it('aligns signed meeting creation evidence with its final effect despite the Calendar creation effect', async () => {
    const t = await team(),
      m = await meeting(t.id),
      record = (await control.records()).find(
        (r) =>
          r.spaceId === t.id &&
          r.resourceId === m.id &&
          r.action === 'team.meeting.create' &&
          r.outcome === 'COMMITTED',
      )!;
    expect(record).toBeDefined();
    const effect = await client.sharedOutboxEvent.findUniqueOrThrow({
      where: { auditId: record.id },
    });
    expect(String(effect.authorizationVersion)).toBe(record.version);
    const evidence = (await control.replayEvidence()).find(
      (r) => r.id === record.id,
    )!;
    expect(evidence.version).toBe(record.version);
    expect(JSON.stringify(evidence)).not.toContain('Bounded Team agenda');
  });
  it('rolls back Calendar source, meeting, receipts and both usage/effect sets as one transaction', async () => {
    const t = await team(),
      id = randomUUID(),
      effect = kernel.offerEffect.bind(kernel);
    vi.spyOn(kernel, 'offerEffect').mockImplementation(async (...args) => {
      if (args[4] === 'team.meeting.create')
        throw new Error('synthetic meeting effect failure');
      return effect(...args);
    });
    await expect(
      meetings.create(
        owner.actor,
        t.id,
        { id, event: eventInput, agenda: 'Atomic agenda' },
        randomUUID(),
      ),
    ).rejects.toThrow('synthetic meeting effect failure');
    vi.restoreAllMocks();
    expect(await client.teamMeeting.count({ where: { spaceId: t.id } })).toBe(
      0,
    );
    expect(await client.calendarEvent.count({ where: { spaceId: t.id } })).toBe(
      0,
    );
    expect(
      await client.sharedMutationReceipt.count({
        where: { spaceId: t.id, operation: 'team.meeting.create' },
      }),
    ).toBe(0);
    expect(
      await client.sharedUsageEntry.count({
        where: {
          spaceId: t.id,
          feature: { in: ['team.meeting', 'calendar.shared-event'] },
        },
      }),
    ).toBe(0);
    expect(
      await client.sharedOutboxEvent.count({
        where: {
          spaceId: t.id,
          action: { in: ['team.meeting.create', 'calendar.event.create'] },
        },
      }),
    ).toBe(0);
    await kernel.reconcileControl(t.id);
    expect((await meetings.list(owner.actor, t.id, page)).items).toEqual([]);
  });
  it('fences the subject account before a wider read and observes winning identity restriction without disclosure', async () => {
    const f = await fixture(),
      p = await propose(f);
    await approve(f, p);
    const personal = await client.space.findFirstOrThrow({
      where: { kind: 'PERSONAL', ownerUserId: member.actor.userId },
    });
    await observer.query('BEGIN');
    await observer.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      ['personal-access:' + personal.id],
    );
    const read = outcome(summaries(f.t.id));
    try {
      await blocked();
      await observer.query(
        'UPDATE "User" SET "emailVerified"=false WHERE id=$1',
        [member.actor.userId],
      );
      await observer.query('COMMIT');
    } catch (error) {
      await observer.query('ROLLBACK');
      throw error;
    }
    try {
      expect((await read).error).toBeUndefined();
      expect(
        c.TeamDisclosureSummaryPageSchema.parse((await read).value).items,
      ).toEqual([]);
    } finally {
      await client.user.update({
        where: { id: member.actor.userId },
        data: { emailVerified: true },
      });
    }
  });
  it('enforces migration constraints and never accepts direct evidence/body or participant rewrites', async () => {
    const f = await fixture(),
      row = await client.teamCase.findUniqueOrThrow({
        where: { id: f.record.id },
      });
    await expect(
      client.teamCase.update({
        where: { id: row.id },
        data: { evidence: 'Rewrite', revision: { increment: 1 } },
      }),
    ).rejects.toThrow();
    await expect(
      client.teamCase.create({
        data: {
          ...row,
          id: randomUUID(),
          reviewerAccessId: row.authorAccessId,
          reviewerGeneration: row.authorGeneration,
        },
      }),
    ).rejects.toThrow();
    const p = await propose(f);
    await approve(f, p);
    await expect(
      client.teamDisclosure.update({
        where: { id: p.id },
        data: { summary: 'Unreviewed rewrite', revision: { increment: 1 } },
      }),
    ).rejects.toThrow();
    expect(
      (await client.teamCase.findUniqueOrThrow({ where: { id: row.id } }))
        .evidence,
    ).toBe(f.input.evidence);
  });
});
