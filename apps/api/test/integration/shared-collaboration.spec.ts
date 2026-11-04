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
import { ForbiddenException } from '@nestjs/common';
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
} from '../../src/modules/spaces/public/index.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
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
describe('P2-02 verified invitations and accepted custody succession', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    client: PrismaClient,
    observer: Client,
    watcher: Client,
    service: CollaborationService,
    kernel: SharedKernel,
    spaces: SpacesService,
    control: SharedControl,
    auth: AuthService;
  let owner: Person,
    member: Person,
    viewer: Person,
    outsider: Person,
    passwordHash: string;
  const password = 'synthetic-p202-password-123!',
    origin = 'http://localhost:3000',
    name = 'p202-' + randomUUID(),
    version = 'synthetic-p202-' + randomUUID();
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
  async function boundary(who = owner) {
    return kernel.provision(who.actor, randomUUID(), version);
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
  async function ageInvitation(id: string) {
    await client.$executeRaw`UPDATE "ContextInvitation" SET "createdAt"=statement_timestamp()-interval '8 days',"expiresAt"=statement_timestamp()-interval '8 days'+interval '7 days' WHERE id=${id}::uuid`;
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P202-ONLY',
      },
    });
    control = app.get(SharedControl);
    await control.initialize();
    service = app.get(CollaborationService);
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
  it('stores only hashed one-time delivery, durable create replay, no pending admission, safe public preview', async () => {
    const b = await boundary(),
      key = randomUUID(),
      offered = await invite(b.spaceId, member, 'MEMBER', owner, key);
    expect(offered.proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await client.contextInvitation.findUniqueOrThrow({
      where: { id: offered.invitation.id },
    });
    expect(row.proofHash).toBe(
      createHash('sha256').update(offered.proof!).digest('hex'),
    );
    expect(JSON.stringify(row)).not.toContain(offered.proof!);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(604800000);
    expect(
      await client.contextAccess.count({ where: { spaceId: b.spaceId } }),
    ).toBe(1);
    expect(
      (await invite(b.spaceId, member, 'MEMBER', owner, key)).proof,
    ).toBeNull();
    await expect(
      invite(b.spaceId, member, 'VIEWER', owner, key),
    ).rejects.toThrow();
    expect(await service.preview(offered.proof!)).toEqual({
      contextLabel: 'Project',
      offerCategory: 'MEMBERSHIP',
      expiresAt: offered.invitation.expiresAt,
    });
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: b.spaceId, action: 'invitation.create' },
      }),
    ).toBe(1);
  });
  it('binds recipient identity and reauthorizes durable acceptance after receipt expiry and inviter departure', async () => {
    const b = await boundary(),
      manager = await join(b.spaceId, member, 'MANAGER'),
      offered = await invite(b.spaceId, viewer, 'VIEWER', member);
    await expect(
      service.decideInvitation(
        outsider.actor,
        offered.invitation.id,
        offered.proof!,
        1,
        true,
      ),
    ).rejects.toHaveProperty('status', 404);
    const accepted = await service.decideInvitation(
      viewer.actor,
      offered.invitation.id,
      offered.proof!,
      1,
      true,
    );
    expect('membership' in accepted).toBe(true);
    await client.sharedMutationReceipt.deleteMany({
      where: { spaceId: b.spaceId, operation: 'invitation.accept' },
    });
    await kernel.depart(member.actor, {
      spaceId: b.spaceId,
      scopeId: b.spaceId,
      revision: manager.revision,
    });
    const replay = await service.decideInvitation(
      viewer.actor,
      offered.invitation.id,
      offered.proof!,
      1,
      true,
    );
    expect(replay).toEqual(accepted);
    expect(
      await client.sharedAuditEvent.count({
        where: {
          spaceId: b.spaceId,
          action: 'invitation.accept',
          actorId:
            'membership' in accepted
              ? accepted.membership.actorId
              : randomUUID(),
        },
      }),
    ).toBe(1);
    if ('membership' in accepted)
      await kernel.changeAccess(owner.actor, {
        spaceId: b.spaceId,
        scopeId: b.spaceId,
        accessId: accepted.membership.id,
        revision: accepted.membership.revision,
        state: 'REVOKED',
        memberRole: 'VIEWER',
      });
    await expect(
      service.decideInvitation(
        viewer.actor,
        offered.invitation.id,
        offered.proof!,
        1,
        true,
      ),
    ).rejects.toThrow();
  });
  it('requires verified current sessions and denies pending-email forwarding or offered-role substitution', async () => {
    const b = await boundary(),
      unknown = randomUUID() + '@example.test';
    const offered = await service.createInvitation(
      owner.actor,
      b.spaceId,
      {
        kind: 'MEMBERSHIP',
        memberRole: 'MEMBER',
        recipient: { email: unknown },
      },
      randomUUID(),
    );
    await expect(
      service.decideInvitation(
        outsider.actor,
        offered.invitation.id,
        offered.proof!,
        1,
        true,
      ),
    ).rejects.toHaveProperty('status', 404);
    const intended = await person(unknown, false);
    await expect(
      service.decideInvitation(
        intended.actor,
        offered.invitation.id,
        offered.proof!,
        1,
        true,
      ),
    ).rejects.toThrow();
    await client.user.update({
      where: { id: intended.actor.userId },
      data: { emailVerified: true },
    });
    const result = await service.decideInvitation(
      intended.actor,
      offered.invitation.id,
      offered.proof!,
      1,
      true,
    );
    expect('membership' in result && result.membership.memberRole).toBe(
      'MEMBER',
    );
    await client.authSession.delete({
      where: { id: intended.actor.sessionId! },
    });
    await expect(
      service.decideInvitation(
        intended.actor,
        offered.invitation.id,
        offered.proof!,
        1,
        true,
      ),
    ).rejects.toThrow();
  });
  it('rechecks inviter demotion, revocation, generations and independent context roles', async () => {
    const b = await boundary(),
      m = await join(b.spaceId, member, 'MANAGER'),
      offered = await invite(b.spaceId, viewer, 'MEMBER', member);
    await kernel.changeAccess(owner.actor, {
      spaceId: b.spaceId,
      scopeId: b.spaceId,
      accessId: m.id,
      revision: m.revision,
      state: 'ACTIVE',
      memberRole: 'MEMBER',
    });
    await expect(
      service.decideInvitation(
        viewer.actor,
        offered.invitation.id,
        offered.proof!,
        1,
        true,
      ),
    ).rejects.toThrow();
    const other = await boundary(member);
    await expect(
      service.invitation(member.actor, other.spaceId, offered.invitation.id),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      service.createInvitation(
        member.actor,
        b.spaceId,
        {
          kind: 'MEMBERSHIP',
          memberRole: 'MANAGER',
          recipient: { userId: viewer.actor.userId },
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('requires a fresh explicit readmission and never revives an old accepted invitation or suspended membership', async () => {
    const b = await boundary(),
      first = await invite(b.spaceId),
      accepted = await service.decideInvitation(
        member.actor,
        first.invitation.id,
        first.proof!,
        1,
        true,
      );
    if (!('membership' in accepted)) throw new Error('Expected membership');
    const stale = await invite(b.spaceId, member, 'MEMBER');
    await kernel.depart(member.actor, {
      spaceId: b.spaceId,
      scopeId: b.spaceId,
      revision: accepted.membership.revision,
    });
    await expect(
      service.decideInvitation(
        member.actor,
        stale.invitation.id,
        stale.proof!,
        1,
        true,
      ),
    ).rejects.toThrow();
    const fresh = await invite(b.spaceId),
      joined = await service.decideInvitation(
        member.actor,
        fresh.invitation.id,
        fresh.proof!,
        1,
        true,
      );
    expect('membership' in joined && joined.membership.generation).toBe(2);
    await expect(
      service.decideInvitation(
        member.actor,
        first.invitation.id,
        first.proof!,
        1,
        true,
      ),
    ).rejects.toThrow();
    if ('membership' in joined)
      await kernel.changeAccess(owner.actor, {
        spaceId: b.spaceId,
        scopeId: b.spaceId,
        accessId: joined.membership.id,
        revision: joined.membership.revision,
        state: 'SUSPENDED',
        memberRole: 'MEMBER',
      });
    const suspended = await invite(b.spaceId);
    await expect(
      service.decideInvitation(
        member.actor,
        suspended.invitation.id,
        suspended.proof!,
        1,
        true,
      ),
    ).rejects.toThrow();
    expect(
      await client.contextAccessInterval.count({
        where: { accessId: accepted.membership.id },
      }),
    ).toBe(2);
  });
  it('enforces DB-time expiry, decline/revocation and uniform invalid preview; worker scrubs target PII', async () => {
    const b = await boundary(),
      offered = await invite(b.spaceId);
    await ageInvitation(offered.invitation.id);
    await expect(service.preview(offered.proof!)).rejects.toHaveProperty(
      'status',
      404,
    );
    await expect(
      service.preview(randomBytes(32).toString('base64url')),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      service.decideInvitation(
        member.actor,
        offered.invitation.id,
        offered.proof!,
        1,
        true,
      ),
    ).rejects.toHaveProperty('status', 404);
    expect(await service.maintain()).toBe(true);
    const expired = await client.contextInvitation.findUniqueOrThrow({
      where: { id: offered.invitation.id },
    });
    expect(expired.state).toBe('EXPIRED');
    expect(expired.proofHash).toBeNull();
    expect(expired.recipientUserId).toBeNull();
    expect(await service.maintain()).toBe(false);
    const declined = await invite(b.spaceId, viewer);
    await service.decideInvitation(
      viewer.actor,
      declined.invitation.id,
      declined.proof!,
      1,
      false,
    );
    expect(
      await client.contextAccess.count({ where: { spaceId: b.spaceId } }),
    ).toBe(1);
    const revoked = await invite(b.spaceId);
    await service.revokeInvitation(
      owner.actor,
      b.spaceId,
      revoked.invitation.id,
      1,
    );
    await expect(service.preview(revoked.proof!)).rejects.toHaveProperty(
      'status',
      404,
    );
  });
  it('hides preview for archived scopes and fresh custodian closure before fanout', async () => {
    const closingOwner = await person();
    const b = await boundary(closingOwner);
    await join(b.spaceId, member, 'MANAGER', closingOwner);
    const offered = await invite(b.spaceId, viewer, 'MEMBER', member);
    await client.accessScope.update({
      where: { id: b.scopeId },
      data: { state: 'ARCHIVED' },
    });
    await expect(service.preview(offered.proof!)).rejects.toHaveProperty(
      'status',
      404,
    );
    await client.accessScope.update({
      where: { id: b.scopeId },
      data: { state: 'ACTIVE' },
    });
    await client.space.updateMany({
      where: { kind: 'PERSONAL', ownerUserId: closingOwner.actor.userId },
      data: { accessClosedAt: new Date() },
    });
    await expect(service.preview(offered.proof!)).rejects.toHaveProperty(
      'status',
      404,
    );
  });
  it('performs accepted succession with provider password, exact generations/revision, no source movement, then permits old owner departure', async () => {
    const b = await boundary(),
      m = await join(b.spaceId),
      offer = await service.createHandover(
        owner.actor,
        b.spaceId,
        { successorAccessId: m.id },
        randomUUID(),
      );
    await expect(
      service.decideHandover(
        viewer.actor,
        b.spaceId,
        offer.id,
        1,
        'accept',
        password,
      ),
    ).rejects.toThrow();
    await expect(
      service.decideHandover(
        member.actor,
        b.spaceId,
        offer.id,
        1,
        'accept',
        'wrong-password',
      ),
    ).rejects.toThrow();
    const result = await service.decideHandover(
      member.actor,
      b.spaceId,
      offer.id,
      1,
      'accept',
      password,
    );
    expect(result.state).toBe('ACCEPTED');
    expect(
      await service.decideHandover(
        member.actor,
        b.spaceId,
        offer.id,
        1,
        'accept',
        password,
      ),
    ).toEqual(result);
    const row = await client.ownerHandover.findUniqueOrThrow({
      where: { id: offer.id },
    });
    expect(row.reauthenticatedAt).not.toBeNull();
    expect(
      row.endedAt!.getTime() - row.reauthenticatedAt!.getTime(),
    ).toBeLessThanOrEqual(300000);
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: b.spaceId },
        })
      ).primaryOwnerAccessId,
    ).toBe(m.id);
    await expect(
      service.createHandover(
        owner.actor,
        b.spaceId,
        { successorAccessId: m.id },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await kernel.depart(owner.actor, {
      spaceId: b.spaceId,
      scopeId: b.spaceId,
      revision: 1,
    });
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: b.spaceId },
        })
      ).state,
    ).toBe('ACTIVE');
    expect(
      await client.sharedActor.count({ where: { spaceId: b.spaceId } }),
    ).toBe(2);
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: b.spaceId, action: 'handover.accept' },
      }),
    ).toBe(1);
    expect(
      (
        await client.sharedUsageEntry.aggregate({
          where: {
            spaceId: b.spaceId,
            feature: 'shared.custody',
            subjectActorId: b.actorId,
          },
          _sum: { delta: true },
        })
      )._sum.delta,
    ).toBe(0);
    expect(
      (
        await client.sharedUsageEntry.aggregate({
          where: {
            spaceId: b.spaceId,
            feature: 'shared.custody',
            subjectActorId: m.actorId,
          },
          _sum: { delta: true },
        })
      )._sum.delta,
    ).toBe(1);
  });
  it('rejects stale custody offers, grant-only/suspended successors and preserves the primary seat', async () => {
    const b = await boundary(),
      m = await join(b.spaceId),
      offer = await service.createHandover(
        owner.actor,
        b.spaceId,
        { successorAccessId: m.id },
        randomUUID(),
      );
    await invite(b.spaceId, viewer, 'VIEWER');
    await expect(
      service.decideHandover(
        member.actor,
        b.spaceId,
        offer.id,
        1,
        'accept',
        password,
      ),
    ).rejects.toHaveProperty('status', 409);
    await service.decideHandover(owner.actor, b.spaceId, offer.id, 1, 'revoke');
    await kernel.changeAccess(owner.actor, {
      spaceId: b.spaceId,
      scopeId: b.spaceId,
      accessId: m.id,
      revision: m.revision,
      state: 'SUSPENDED',
      memberRole: 'MEMBER',
    });
    await expect(
      service.createHandover(
        owner.actor,
        b.spaceId,
        { successorAccessId: m.id },
        randomUUID(),
      ),
    ).rejects.toThrow();
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: b.spaceId },
        })
      ).primaryOwnerAccessId,
    ).toBe(b.accessId);
  });
  it('HTTP schemas, origin, ETags and proof headers match actual operations; resource grants remain gated', async () => {
    const b = await boundary();
    const post = (who: Person, route: string) =>
      request(app.getHttpServer())
        .post('/api/v1' + route)
        .set('Origin', origin)
        .set('Cookie', who.cookie);
    await post(owner, `/spaces/${b.spaceId}/invitations`)
      .set('Idempotency-Key', randomUUID())
      .send({
        kind: 'RESOURCE_GRANT',
        memberRole: 'VIEWER',
        recipient: { userId: member.actor.userId },
        targetId: randomUUID(),
      })
      .expect(400);
    const offered = await post(owner, `/spaces/${b.spaceId}/invitations`)
      .set('Idempotency-Key', randomUUID())
      .send({
        kind: 'MEMBERSHIP',
        memberRole: 'MEMBER',
        recipient: { userId: member.actor.userId },
      })
      .expect(201);
    expect(offered.headers['cache-control']).toBe('no-store');
    expect(offered.headers.etag).toBe('"1"');
    const preview = await request(app.getHttpServer())
      .get('/api/v1/invitations/preview')
      .set('X-Invitation-Proof', offered.body.proof as string)
      .expect(200);
    expect(Object.keys(preview.body).sort()).toEqual([
      'contextLabel',
      'expiresAt',
      'offerCategory',
    ]);
    await request(app.getHttpServer())
      .get('/api/v1/invitations/preview')
      .query({ proof: offered.body.proof })
      .expect(400);
    const accept = () =>
      post(member, `/invitations/${offered.body.invitation.id}/accept`)
        .set('X-Invitation-Proof', offered.body.proof as string)
        .set('If-Match', '"1"');
    await accept().send({ memberRole: 'ADMIN' }).expect(400);
    const accepted = await accept().send({}).expect(201);
    expect(accepted.body.membership.role).toBe('MEMBER');
    await post(member, `/spaces/${b.spaceId}/invitations`)
      .set('Idempotency-Key', randomUUID())
      .send({
        kind: 'MEMBERSHIP',
        memberRole: 'VIEWER',
        recipient: { userId: viewer.actor.userId },
      })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/invitations/${offered.body.invitation.id}/accept`)
      .set('Origin', 'https://invalid.example')
      .set('Cookie', member.cookie)
      .set('X-Invitation-Proof', offered.body.proof as string)
      .set('If-Match', '"1"')
      .send({})
      .expect(403);
  });
  it('persists bounded hashed abuse counters, counts failed attempts and resets by DB window', async () => {
    for (let i = 0; i < 30; i++)
      await service.request('synthetic-preview-ip', undefined, true);
    await expect(
      service.request('synthetic-preview-ip', undefined, true),
    ).rejects.toHaveProperty('status', 429);
    const records = await client.sharedRateLimit.findMany();
    expect(JSON.stringify(records)).not.toContain('synthetic-preview-ip');
    expect(records.every((r) => /^[a-f0-9]{64}$/.test(r.keyHash))).toBe(true);
    await client.$executeRaw`UPDATE "SharedRateLimit" SET "windowAt"=clock_timestamp()-interval '3 minutes'`;
    await expect(
      service.request('synthetic-preview-ip', undefined, true),
    ).resolves.toBeUndefined();
    for (let i = 0; i < 20; i++)
      await service.request('synthetic-actor-ip', owner.actor);
    await expect(
      service.request('synthetic-actor-ip', owner.actor),
    ).rejects.toHaveProperty('status', 429);
  });
  it('clears pending recipient identity/email without retaining a User or deleting another custodian boundary', async () => {
    const target = await person(),
      b = await boundary(),
      offered = await invite(b.spaceId, target);
    const personal = await spaces.authorizePersonal(target.actor);
    await client.$transaction((tx) => spaces.setClosed(tx, personal, true));
    expect(
      await kernel.prepareIdentityErasure(target.actor.userId, new Date()),
    ).toBe(false);
    expect(
      await kernel.prepareIdentityErasure(target.actor.userId, new Date()),
    ).toBe(true);
    const row = await client.contextInvitation.findUniqueOrThrow({
      where: { id: offered.invitation.id },
    });
    expect(row.state).toBe('REVOKED');
    expect(row.recipientUserId).toBeNull();
    expect(row.recipientEmail).toBeNull();
    await client.$transaction(async (tx) => {
      await spaces.erase(tx, personal);
      await auth.eraseIdentityInside(tx, target.actor.userId);
    });
    expect(
      await client.user.count({ where: { id: target.actor.userId } }),
    ).toBe(0);
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: b.spaceId },
        })
      ).state,
    ).toBe('ACTIVE');
  });
  it.each(['revoke', 'accept'] as const)(
    'RACE accept/revoke: %s wins with one atomic outcome',
    async (winner) => {
      const b = await boundary(),
        offered = await invite(b.spaceId),
        entered = barrier(),
        release = barrier(),
        append = control.append.bind(control);
      const spy = vi.spyOn(control, 'append').mockImplementation(async (r) => {
        await append(r);
        if (
          r.spaceId === b.spaceId &&
          r.action === 'invitation.' + winner &&
          r.outcome === 'INTENT'
        ) {
          entered.release();
          await release.promise;
        }
      });
      const accept = () =>
          service.decideInvitation(
            member.actor,
            offered.invitation.id,
            offered.proof!,
            1,
            true,
          ),
        revoke = () =>
          service.revokeInvitation(
            owner.actor,
            b.spaceId,
            offered.invitation.id,
            1,
          );
      const first = outcome(winner === 'accept' ? accept() : revoke());
      await entered.promise;
      const second = outcome(winner === 'accept' ? revoke() : accept());
      try {
        await blocked();
      } finally {
        release.release();
      }
      expect((await first).error).toBeUndefined();
      expect((await second).error).toBeDefined();
      spy.mockRestore();
      const row = await client.contextInvitation.findUniqueOrThrow({
        where: { id: offered.invitation.id },
      });
      expect(row.state).toBe(winner === 'accept' ? 'ACCEPTED' : 'REVOKED');
      expect(
        await client.sharedAuditEvent.count({
          where: { spaceId: b.spaceId, action: 'invitation.' + winner },
        }),
      ).toBe(1);
      expect(
        await client.sharedOutboxEvent.count({
          where: { spaceId: b.spaceId, action: 'invitation.' + winner },
        }),
      ).toBe(1);
      expect(
        await client.contextAccess.count({ where: { spaceId: b.spaceId } }),
      ).toBe(winner === 'accept' ? 2 : 1);
    },
  );
  it('RACE pending-email change wins before acceptance and cannot substitute a stale recipient', async () => {
    const b = await boundary(),
      email = randomUUID() + '@example.test',
      offered = await service.createInvitation(
        owner.actor,
        b.spaceId,
        { kind: 'MEMBERSHIP', memberRole: 'MEMBER', recipient: { email } },
        randomUUID(),
      ),
      target = await person(email);
    await observer.query('BEGIN');
    await observer.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE', [
      target.actor.userId,
    ]);
    const pending = outcome(
      service.decideInvitation(
        target.actor,
        offered.invitation.id,
        offered.proof!,
        1,
        true,
      ),
    );
    try {
      await blocked();
      await observer.query('UPDATE "User" SET email=$2 WHERE id=$1', [
        target.actor.userId,
        randomUUID() + '@example.test',
      ]);
    } finally {
      await observer.query('COMMIT');
    }
    expect((await pending).error).toBeDefined();
    expect(
      await client.contextAccess.count({ where: { spaceId: b.spaceId } }),
    ).toBe(1);
  });
  it.each(['close', 'accept'] as const)(
    'RACE last departure/invitation: %s wins without orphaning custody',
    async (winner) => {
      const b = await boundary(),
        offered = await invite(b.spaceId),
        entered = barrier(),
        release = barrier(),
        append = control.append.bind(control),
        action = winner === 'close' ? 'membership.leave' : 'invitation.accept';
      const spy = vi.spyOn(control, 'append').mockImplementation(async (r) => {
        await append(r);
        if (
          r.spaceId === b.spaceId &&
          r.action === action &&
          r.outcome === 'INTENT'
        ) {
          entered.release();
          await release.promise;
        }
      });
      const accept = () =>
          service.decideInvitation(
            member.actor,
            offered.invitation.id,
            offered.proof!,
            1,
            true,
          ),
        close = () =>
          kernel.depart(owner.actor, {
            spaceId: b.spaceId,
            scopeId: b.spaceId,
            revision: 1,
          });
      const first = outcome(winner === 'close' ? close() : accept());
      await entered.promise;
      const second = outcome(winner === 'close' ? accept() : close());
      try {
        await blocked();
      } finally {
        release.release();
      }
      expect((await first).error).toBeUndefined();
      expect((await second).error).toBeDefined();
      spy.mockRestore();
      expect(
        (
          await client.sharedCustody.findUniqueOrThrow({
            where: { spaceId: b.spaceId },
          })
        ).state,
      ).toBe(winner === 'close' ? 'CLOSING_GRACE' : 'ACTIVE');
      if (winner === 'close')
        expect(
          (
            await client.contextInvitation.findUniqueOrThrow({
              where: { id: offered.invitation.id },
            })
          ).state,
        ).toBe('REVOKED');
    },
  );
  it('RACE competing handover proposals leave exactly one pending offer', async () => {
    const b = await boundary(),
      m = await join(b.spaceId, member),
      v = await join(b.spaceId, viewer, 'VIEWER'),
      entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    const spy = vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (
        r.spaceId === b.spaceId &&
        r.action === 'handover.propose' &&
        r.outcome === 'INTENT'
      ) {
        entered.release();
        await release.promise;
      }
    });
    const first = outcome(
      service.createHandover(
        owner.actor,
        b.spaceId,
        { successorAccessId: m.id },
        randomUUID(),
      ),
    );
    await entered.promise;
    const second = outcome(
      service.createHandover(
        owner.actor,
        b.spaceId,
        { successorAccessId: v.id },
        randomUUID(),
      ),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await first).error).toBeUndefined();
    expect((await second).error).toBeDefined();
    spy.mockRestore();
    expect(
      await client.ownerHandover.count({
        where: { spaceId: b.spaceId, state: 'PENDING' },
      }),
    ).toBe(1);
  });
  it('RACE successor closure wins before handover acceptance; the original custodian stays eligible', async () => {
    const target = await person(),
      b = await boundary(),
      m = await join(b.spaceId, target),
      offered = await service.createHandover(
        owner.actor,
        b.spaceId,
        { successorAccessId: m.id },
        randomUUID(),
      ),
      personal = await spaces.authorizePersonal(target.actor),
      entered = barrier(),
      release = barrier();
    const close = outcome(
      client.$transaction(async (tx) => {
        await spaces.setClosed(tx, personal, true);
        entered.release();
        await release.promise;
      }),
    );
    await entered.promise;
    const accept = outcome(
      service.decideHandover(
        target.actor,
        b.spaceId,
        offered.id,
        1,
        'accept',
        password,
      ),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await close).error).toBeUndefined();
    expect((await accept).error).toBeDefined();
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: b.spaceId },
        })
      ).primaryOwnerAccessId,
    ).toBe(b.accessId);
  });
  it('rolls back admission, terminal offer, receipt, audit and outbox together on a DB effect failure', async () => {
    const b = await boundary(),
      offered = await invite(b.spaceId),
      effect = vi
        .spyOn(kernel, 'offerEffect')
        .mockRejectedValueOnce(new Error('synthetic effect failure'));
    await expect(
      service.decideInvitation(
        member.actor,
        offered.invitation.id,
        offered.proof!,
        1,
        true,
      ),
    ).rejects.toThrow();
    effect.mockRestore();
    expect(
      (
        await client.contextInvitation.findUniqueOrThrow({
          where: { id: offered.invitation.id },
        })
      ).state,
    ).toBe('PENDING');
    expect(
      await client.contextAccess.count({ where: { spaceId: b.spaceId } }),
    ).toBe(1);
    expect(
      await client.sharedMutationReceipt.count({
        where: { spaceId: b.spaceId, operation: 'invitation.accept' },
      }),
    ).toBe(0);
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: b.spaceId, action: 'invitation.accept' },
      }),
    ).toBe(0);
    await kernel.reconcileControl(b.spaceId);
    expect(
      'membership' in
        (await service.decideInvitation(
          member.actor,
          offered.invitation.id,
          offered.proof!,
          1,
          true,
        )),
    ).toBe(true);
  });
  it('completes a lost postcommit control outcome only from atomic DB evidence and returns authorized replay', async () => {
    const b = await boundary(),
      offered = await invite(b.spaceId),
      append = control.append.bind(control);
    let failed = false;
    const spy = vi
      .spyOn(control, 'append')
      .mockImplementation(async (record) => {
        if (
          !failed &&
          record.spaceId === b.spaceId &&
          record.action === 'invitation.accept' &&
          record.outcome === 'COMMITTED'
        ) {
          failed = true;
          throw new ForbiddenException('synthetic postcommit failure');
        }
        await append(record);
      });
    await expect(
      service.decideInvitation(
        member.actor,
        offered.invitation.id,
        offered.proof!,
        1,
        true,
      ),
    ).rejects.toThrow();
    spy.mockRestore();
    expect(
      (
        await client.contextInvitation.findUniqueOrThrow({
          where: { id: offered.invitation.id },
        })
      ).state,
    ).toBe('ACCEPTED');
    const replay = await service.decideInvitation(
      member.actor,
      offered.invitation.id,
      offered.proof!,
      1,
      true,
    );
    expect('membership' in replay).toBe(true);
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: b.spaceId, action: 'invitation.accept' },
      }),
    ).toBe(1);
    const outcomes = (await control.records())
      .filter(
        (r) => r.spaceId === b.spaceId && r.action === 'invitation.accept',
      )
      .map((r) => r.outcome);
    expect(outcomes).toContain('COMMITTED');
    expect(outcomes).not.toContain('ABORTED');
  });
  it('RACE duplicate same-identity acceptance returns one membership and one durable outcome', async () => {
    const b = await boundary(),
      offered = await invite(b.spaceId),
      entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    const spy = vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (
        r.spaceId === b.spaceId &&
        r.action === 'invitation.accept' &&
        r.outcome === 'INTENT'
      ) {
        entered.release();
        await release.promise;
      }
    });
    const accept = () =>
      service.decideInvitation(
        member.actor,
        offered.invitation.id,
        offered.proof!,
        1,
        true,
      );
    const first = outcome(accept());
    await entered.promise;
    const second = outcome(accept());
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await first).error).toBeUndefined();
    expect((await second).error).toBeUndefined();
    expect((await first).value).toEqual((await second).value);
    spy.mockRestore();
    expect(
      await client.sharedMutationReceipt.count({
        where: { spaceId: b.spaceId, operation: 'invitation.accept' },
      }),
    ).toBe(1);
  });
  it('RACE acceptance-first binds stable identity while the waiting email change commits afterward', async () => {
    const b = await boundary(),
      email = randomUUID() + '@example.test',
      offered = await service.createInvitation(
        owner.actor,
        b.spaceId,
        { kind: 'MEMBERSHIP', memberRole: 'MEMBER', recipient: { email } },
        randomUUID(),
      ),
      target = await person(email),
      entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    const spy = vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (
        r.spaceId === b.spaceId &&
        r.action === 'invitation.accept' &&
        r.outcome === 'INTENT'
      ) {
        entered.release();
        await release.promise;
      }
    });
    const accepted = outcome(
      service.decideInvitation(
        target.actor,
        offered.invitation.id,
        offered.proof!,
        1,
        true,
      ),
    );
    await entered.promise;
    await observer.query('BEGIN');
    const change = observer.query('UPDATE "User" SET email=$2 WHERE id=$1', [
      target.actor.userId,
      randomUUID() + '@example.test',
    ]);
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await accepted).error).toBeUndefined();
    await change;
    await observer.query('COMMIT');
    spy.mockRestore();
    expect(
      'membership' in
        (await service.decideInvitation(
          target.actor,
          offered.invitation.id,
          offered.proof!,
          1,
          true,
        )),
    ).toBe(true);
  });
  it('RACE inviter demotion wins and invalidates pending acceptance under current delegation', async () => {
    const b = await boundary(),
      m = await join(b.spaceId, member, 'MANAGER'),
      offered = await invite(b.spaceId, viewer, 'MEMBER', member),
      entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    const spy = vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (
        r.spaceId === b.spaceId &&
        r.action === 'membership.change' &&
        r.outcome === 'INTENT'
      ) {
        entered.release();
        await release.promise;
      }
    });
    const demote = outcome(
      kernel.changeAccess(owner.actor, {
        spaceId: b.spaceId,
        scopeId: b.spaceId,
        accessId: m.id,
        revision: m.revision,
        state: 'ACTIVE',
        memberRole: 'MEMBER',
      }),
    );
    await entered.promise;
    const accept = outcome(
      service.decideInvitation(
        viewer.actor,
        offered.invitation.id,
        offered.proof!,
        1,
        true,
      ),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await demote).error).toBeUndefined();
    expect((await accept).error).toBeDefined();
    spy.mockRestore();
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: b.spaceId, action: 'invitation.accept' },
      }),
    ).toBe(1); // only the earlier Manager admission
  });
  it('RACE expiry while acceptance waits is checked against fresh DB time', async () => {
    const b = await boundary(),
      offered = await invite(b.spaceId);
    await observer.query('BEGIN');
    await observer.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE', [
      member.actor.userId,
    ]);
    const accept = outcome(
      service.decideInvitation(
        member.actor,
        offered.invitation.id,
        offered.proof!,
        1,
        true,
      ),
    );
    try {
      await blocked();
      await observer.query(
        'UPDATE "ContextInvitation" SET "createdAt"=statement_timestamp()-interval \'7 days\',"expiresAt"=statement_timestamp() WHERE id=$1',
        [offered.invitation.id],
      );
    } finally {
      await observer.query('COMMIT');
    }
    expect((await accept).error).toBeDefined();
    expect(
      await client.contextAccess.count({ where: { spaceId: b.spaceId } }),
    ).toBe(1);
  });
  it('enforces higher-role invitation ceilings and excludes grant-only actors from succession', async () => {
    const b = await boundary(),
      admin = await join(b.spaceId, member, 'ADMIN'),
      manager = await join(b.spaceId, viewer, 'MANAGER', member);
    await expect(
      invite(b.spaceId, outsider, 'ADMIN', member),
    ).rejects.toThrow();
    await expect(
      invite(b.spaceId, outsider, 'MANAGER', viewer),
    ).rejects.toThrow();
    expect(
      (await invite(b.spaceId, outsider, 'MEMBER', viewer)).invitation
        .memberRole,
    ).toBe('MEMBER');
    const guest = await person(),
      actorId = randomUUID(),
      accessId = randomUUID();
    await client.$transaction(async (tx) => {
      const now = (
        await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      )[0]!.now;
      await tx.sharedActor.create({
        data: {
          id: actorId,
          spaceId: b.spaceId,
          userId: guest.actor.userId,
          state: 'ACTIVE',
        },
      });
      await tx.contextAccess.create({
        data: {
          id: accessId,
          spaceId: b.spaceId,
          scopeId: b.spaceId,
          actorId,
          state: 'ACTIVE',
          memberRole: null,
          joinedAt: now,
        },
      });
      await tx.contextAccessInterval.create({
        data: { accessId, generation: 1, joinedAt: now },
      });
    });
    await expect(
      service.createHandover(
        owner.actor,
        b.spaceId,
        { successorAccessId: accessId },
        randomUUID(),
      ),
    ).rejects.toThrow();
    expect(admin.memberRole).toBe('ADMIN');
    expect(manager.memberRole).toBe('MANAGER');
  });
  it('DB rejects foreign scope/actor offers, duplicate pending handovers and stale reauthentication evidence', async () => {
    const b = await boundary(),
      foreign = await boundary(member),
      offered = await invite(b.spaceId),
      row = await client.contextInvitation.findUniqueOrThrow({
        where: { id: offered.invitation.id },
      });
    await expect(
      client.contextInvitation.create({
        data: {
          ...row,
          id: randomUUID(),
          keyHash: 'a'.repeat(64),
          proofHash: 'b'.repeat(64),
          recipientAccessId: foreign.accessId,
          recipientGeneration: 1,
          recipientRevision: 1,
        },
      }),
    ).rejects.toThrow();
    await expect(
      client.contextInvitation.create({
        data: {
          ...row,
          id: randomUUID(),
          keyHash: 'c'.repeat(64),
          proofHash: 'd'.repeat(64),
          state: 'ACCEPTED',
          recipientUserId: null,
          recipientEmail: null,
          endedAt: new Date(),
          acceptedAccessId: b.accessId,
          acceptedActorId: foreign.actorId,
          acceptedGeneration: 1,
        },
      }),
    ).rejects.toThrow();
    const joined = await service.decideInvitation(
      member.actor,
      row.id,
      offered.proof!,
      1,
      true,
    );
    if (!('membership' in joined)) throw new Error('Expected membership');
    const offer = await service.createHandover(
        owner.actor,
        b.spaceId,
        { successorAccessId: joined.membership.id },
        randomUUID(),
      ),
      handover = await client.ownerHandover.findUniqueOrThrow({
        where: { id: offer.id },
      });
    await expect(
      client.ownerHandover.create({
        data: { ...handover, id: randomUUID(), keyHash: 'e'.repeat(64) },
      }),
    ).rejects.toThrow();
    const now = new Date();
    await expect(
      client.ownerHandover.create({
        data: {
          ...handover,
          id: randomUUID(),
          keyHash: 'f'.repeat(64),
          state: 'ACCEPTED',
          endedAt: now,
          acceptedByActorId: joined.membership.actorId,
          reauthenticatedAt: new Date(now.getTime() - 360000),
        },
      }),
    ).rejects.toThrow();
  });
  it('HTTP membership and all handover decisions enforce revisions, CORS proof allowance and explicit departure', async () => {
    const b = await boundary(),
      m = await join(b.spaceId);
    const call = (who: Person, route: string) =>
      request(app.getHttpServer())
        .post('/api/v1' + route)
        .set('Cookie', who.cookie)
        .set('Origin', origin);
    const changed = await request(app.getHttpServer())
      .patch(`/api/v1/spaces/${b.spaceId}/memberships/${m.id}`)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({ memberRole: 'VIEWER', state: 'ACTIVE' })
      .expect(200);
    expect(changed.body.revision).toBe(2);
    const inviteRow = await client.contextInvitation.findFirstOrThrow({
      where: { spaceId: b.spaceId },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/spaces/${b.spaceId}/invitations/${inviteRow.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    const propose = async () =>
      call(owner, `/spaces/${b.spaceId}/ownership-handovers`)
        .set('Idempotency-Key', randomUUID())
        .send({ successorAccessId: m.id })
        .expect(201);
    const first = await propose();
    await call(
      owner,
      `/spaces/${b.spaceId}/ownership-handovers/${first.body.id}/revoke`,
    )
      .set('If-Match', '"1"')
      .send({})
      .expect(201);
    const second = await propose();
    await call(
      member,
      `/spaces/${b.spaceId}/ownership-handovers/${second.body.id}/decline`,
    )
      .set('If-Match', '"1"')
      .send({})
      .expect(201);
    const third = await propose();
    await request(app.getHttpServer())
      .get(`/api/v1/spaces/${b.spaceId}/ownership-handovers/${third.body.id}`)
      .set('Cookie', member.cookie)
      .expect(200);
    const accepted = await call(
      member,
      `/spaces/${b.spaceId}/ownership-handovers/${third.body.id}/accept`,
    )
      .set('If-Match', '"1"')
      .send({ password })
      .expect(201);
    expect(accepted.body.state).toBe('ACCEPTED');
    await call(owner, `/spaces/${b.spaceId}/leave`)
      .set('If-Match', '"1"')
      .send({})
      .expect(201);
    const cors = await request(app.getHttpServer())
      .options('/api/v1/invitations/preview')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'X-Invitation-Proof')
      .expect(204);
    expect(
      String(cors.headers['access-control-allow-headers']).toLowerCase(),
    ).toContain('x-invitation-proof');
  });
  it('scopes creation receipts to explicit readmission generations without reviving old offers', async () => {
    const b = await boundary(),
      m = await join(b.spaceId, member, 'MANAGER'),
      key = randomUUID(),
      old = await invite(b.spaceId, viewer, 'MEMBER', member, key);
    await kernel.depart(member.actor, {
      spaceId: b.spaceId,
      scopeId: b.spaceId,
      revision: m.revision,
    });
    expect((await join(b.spaceId, member, 'MANAGER')).generation).toBe(2);
    const fresh = await invite(b.spaceId, viewer, 'MEMBER', member, key);
    expect(fresh.invitation.id).not.toBe(old.invitation.id);
    expect(fresh.proof).not.toBeNull();
    await expect(
      service.decideInvitation(
        viewer.actor,
        old.invitation.id,
        old.proof!,
        1,
        true,
      ),
    ).rejects.toThrow();
    expect(
      'membership' in
        (await service.decideInvitation(
          viewer.actor,
          fresh.invitation.id,
          fresh.proof!,
          1,
          true,
        )),
    ).toBe(true);
  });
  it('expires a handover reservation once and permits a fresh proposal without replaying its password/evidence', async () => {
    const b = await boundary(),
      m = await join(b.spaceId),
      key = randomUUID(),
      offered = await service.createHandover(
        owner.actor,
        b.spaceId,
        { successorAccessId: m.id },
        key,
      );
    await client.$executeRaw`UPDATE "OwnerHandover" SET "createdAt"=statement_timestamp()-interval '8 days',"expiresAt"=statement_timestamp()-interval '1 day' WHERE id=${offered.id}::uuid`;
    await expect(
      service.decideHandover(
        member.actor,
        b.spaceId,
        offered.id,
        1,
        'accept',
        password,
      ),
    ).rejects.toHaveProperty('status', 409);
    expect(await service.maintain()).toBe(true);
    expect(await service.maintain()).toBe(false);
    expect(
      (
        await service.createHandover(
          owner.actor,
          b.spaceId,
          { successorAccessId: m.id },
          key,
        )
      ).state,
    ).toBe('EXPIRED');
    const fresh = await service.createHandover(
      owner.actor,
      b.spaceId,
      { successorAccessId: m.id },
      randomUUID(),
    );
    expect(fresh.id).not.toBe(offered.id);
    expect(
      (
        await service.decideHandover(
          member.actor,
          b.spaceId,
          fresh.id,
          1,
          'accept',
          password,
        )
      ).state,
    ).toBe('ACCEPTED');
  });
  it('RACE handover acceptance wins before successor closure; later closure immediately denies access and freezes stored custody', async () => {
    const target = await person(),
      b = await boundary(),
      m = await join(b.spaceId, target),
      offer = await service.createHandover(
        owner.actor,
        b.spaceId,
        { successorAccessId: m.id },
        randomUUID(),
      ),
      personal = await spaces.authorizePersonal(target.actor),
      entered = barrier(),
      release = barrier(),
      append = control.append.bind(control);
    const spy = vi.spyOn(control, 'append').mockImplementation(async (r) => {
      await append(r);
      if (
        r.spaceId === b.spaceId &&
        r.action === 'handover.accept' &&
        r.outcome === 'INTENT'
      ) {
        entered.release();
        await release.promise;
      }
    });
    const accept = outcome(
      service.decideHandover(
        target.actor,
        b.spaceId,
        offer.id,
        1,
        'accept',
        password,
      ),
    );
    await entered.promise;
    const close = outcome(
      client.$transaction((tx) => spaces.setClosed(tx, personal, true)),
    );
    try {
      await blocked();
    } finally {
      release.release();
    }
    expect((await accept).error).toBeUndefined();
    expect((await close).error).toBeUndefined();
    spy.mockRestore();
    await expect(
      kernel.run(
        owner.actor,
        { userIds: [], spaceIds: [b.spaceId] },
        [{ spaceId: b.spaceId, scopeId: b.spaceId, capability: 'task.read' }],
        async () => true,
      ),
    ).rejects.toThrow();
    while (await kernel.consumeExit()) {
      /* bounded persisted fixture exits */
    }
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: b.spaceId },
        })
      ).state,
    ).toBe('OWNER_EXIT_FROZEN');
  });
  it('permits only self-departure from owner-exit freeze and cancels the superseded frozen generation', async () => {
    const departing = await person(),
      b = await boundary(departing),
      m = await join(b.spaceId, member, 'MEMBER', departing),
      personal = await spaces.authorizePersonal(departing.actor);
    await client.$transaction((tx) => spaces.setClosed(tx, personal, true));
    while (await kernel.consumeExit()) {
      /* persisted bounded fixture exits */
    }
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: b.spaceId },
        })
      ).state,
    ).toBe('OWNER_EXIT_FROZEN');
    await kernel.prepareIdentityErasure(departing.actor.userId, new Date());
    await expect(
      kernel.run(
        member.actor,
        { userIds: [], spaceIds: [b.spaceId] },
        [{ spaceId: b.spaceId, scopeId: b.spaceId, capability: 'task.read' }],
        async () => true,
      ),
    ).rejects.toThrow();
    await service.leave(member.actor, b.spaceId, m.revision);
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: b.spaceId },
        })
      ).state,
    ).toBe('CLOSING_GRACE');
    const jobs = await client.sharedLifecycleJob.findMany({
      where: { spaceId: b.spaceId },
      orderBy: { generation: 'asc' },
    });
    expect(jobs.map((j) => j.state)).toEqual(['CANCELED', 'CLOSING_GRACE']);
    expect(
      jobs[1]!.recoveryDeadline.getTime() -
        jobs[1]!.effectiveDepartureAt.getTime(),
    ).toBe(2592000000);
  });
  it('preserves the narrow last-member departure from archived custody', async () => {
    const a = await person(),
      b = await boundary(a);
    await client.$transaction(async (tx) => {
      await tx.sharedCustody.update({
        where: { spaceId: b.spaceId },
        data: { state: 'ARCHIVED' },
      });
      await tx.accessScope.update({
        where: { id: b.spaceId },
        data: { state: 'ARCHIVED' },
      });
    });
    await service.leave(a.actor, b.spaceId, 1);
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: b.spaceId },
        })
      ).state,
    ).toBe('CLOSING_GRACE');
  });
});
