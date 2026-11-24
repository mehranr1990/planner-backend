import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { createHash } from 'node:crypto';
import { setImmediate as tick } from 'node:timers/promises';
import { FilesRepository } from '../../src/platform/storage/files.repository.js';
import { vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  type Prisma,
} from '../../src/generated/prisma/client.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import type { DatabaseService } from '../../src/platform/database/database.service.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import {
  SharedKernel,
  CollaborationService,
  SpacesService,
  CompanyAccess,
} from '../../src/modules/spaces/public/index.js';
import { TeamsService } from '../../src/modules/teams/public/index.js';
import { TeamLifecycleService } from '../../src/modules/teams/public/index.js';
import { TeamCleanupService } from '../../src/modules/teams/public/index.js';
import { TeamWorkService } from '../../src/modules/teams/public/index.js';
import { CompaniesService } from '../../src/modules/companies/public/index.js';
import { AdminDeliveryService } from '../../src/modules/admin-management/public/index.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';

function totp(secret: string) {
  const bits = [...secret]
    .map((c) =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
        .indexOf(c)
        .toString(2)
        .padStart(5, '0'),
    )
    .join('');
  const bytes = Buffer.from(
      (bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)),
    ),
    time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', bytes).update(time).digest();
  return String(
    (hash.readUInt32BE(hash[19]! & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, '0');
}
describe('Platform Admin shared Workspace and membership boundaries', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    db: PrismaClient,
    app: NestExpressApplication,
    adminId: string,
    hash: string;
  let owner: RequestActor,
    member: RequestActor,
    other: RequestActor,
    teamId: string,
    companyId: string,
    memberAccess: string;
  const password = 'synthetic-admin-shared-password!',
    version = 'admin-p1-' + randomUUID(),
    origin = 'http://localhost:3000',
    jar = new Map<string, string>();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const remember = (r: { headers: Record<string, unknown> }) => {
    for (const raw of (r.headers['set-cookie'] as string[]) ?? []) {
      const pair = raw.split(';')[0]!,
        at = pair.indexOf('=');
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const post = (route: string, body: object, key = randomUUID()) =>
    request(app.getHttpServer())
      .post('/api/v1/admin/' + route)
      .set('Origin', origin)
      .set('Cookie', cookie())
      .set('Idempotency-Key', key)
      .send(body);
  const patch = (route: string, body: object) =>
    request(app.getHttpServer())
      .patch('/api/v1/admin/' + route)
      .set('Origin', origin)
      .set('Cookie', cookie())
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const get = (route: string) =>
    request(app.getHttpServer())
      .get('/api/v1/admin/' + route)
      .set('Cookie', cookie());
  async function person() {
    const id = randomUUID(),
      sessionId = randomUUID();
    await db.user.create({
      data: {
        id,
        name: 'Shared fixture',
        email: id + '@example.test',
        emailVerified: true,
        settings: { create: {} },
        spaces: { create: { kind: 'PERSONAL' } },
        authaccounts: {
          create: { accountId: id, providerId: 'credential', password: hash },
        },
        authsessions: {
          create: {
            id: sessionId,
            token: randomUUID(),
            expiresAt: new Date(Date.now() + 3600000),
          },
        },
      },
    });
    return {
      userId: id,
      sessionId,
      requestId: randomUUID(),
      correlationId: randomUUID(),
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
      throw new Error('Isolated Admin P1 schema migration failed');
    const schema = new URL(sandbox.url).searchParams.get('schema')!;
    db = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: isolatedTestDatabaseUrl(process.env),
          options: '-c search_path=' + schema + ' -c timezone=UTC',
          max: 8,
        },
        { schema },
      ),
    });
    const root = fs.mkdtempSync(path.resolve('.tools/admin-shared-'));
    app = await testApplication({
      databaseUrl: isolatedTestDatabaseUrl(process.env),
      databaseInstance: {
        client: db,
        checkConnection: async () => ({ status: 'up', latencyMs: 0 }),
      } as unknown as DatabaseService,
      environment: {
        STORAGE_ROOT: path.join(root, 'files'),
        SHARED_CONTROL_ROOT: path.join(root, 'control'),
        SHARED_CONTROL_KEYS: JSON.stringify({
          k1: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'k1',
        TRUSTED_PROXY_ADDRESSES: '127.0.0.1',
        INVITATION_ACCEPT_URL: 'http://localhost:3000/invitations',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-ADMIN-P1-ONLY',
      },
    });
    await app.get(SharedControl).initialize();
    hash = await (
      await app.get(AuthService).auth.$context
    ).password.hash(password);
    const admin = await db.adminUser.create({
      data: {
        name: 'Admin fixture',
        email: randomUUID() + '@example.test',
        role: 'SUPER_ADMIN',
      },
    });
    adminId = admin.id;
    await db.adminAccount.create({
      data: {
        userId: adminId,
        accountId: adminId,
        providerId: 'credential',
        password: hash,
      },
    });
    remember(
      await post('auth/sign-in/email', { email: admin.email, password }).expect(
        200,
      ),
    );
    const enrollment = await post('auth/two-factor/enable', {
      password,
    }).expect(200);
    remember(enrollment);
    const secret = new URL(enrollment.body.totpURI as string).searchParams.get(
      'secret',
    )!;
    remember(
      await post('auth/two-factor/verify-totp', { code: totp(secret) }).expect(
        200,
      ),
    );
    jar.clear();
    remember(
      await post('auth/sign-in/email', { email: admin.email, password }).expect(
        200,
      ),
    );
    remember(
      await post('auth/two-factor/verify-totp', { code: totp(secret) }).expect(
        200,
      ),
    );
    const rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER', 'ADMIN'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
    await db.sharedRetentionPolicy.create({
      data: {
        version,
        approvalReference: 'SYNTHETIC-ADMIN-P1-ONLY',
        configuration: {
          policyVersion: version,
          approvalReference: 'SYNTHETIC-ADMIN-P1-ONLY',
          accountableOperator: 'synthetic operator',
          applicableContexts: ['PROJECT', 'TEAM', 'COMPANY'],
          marketScope: 'isolated fixture',
          sharedRecoverySeconds: 604800,
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
    owner = await person();
    member = await person();
    other = await person();
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    await sandbox?.close();
  });
  it('creates Team and Company atomically, attributes Admin, never enrolls the Admin as a member, and retries safely', async () => {
    teamId = randomUUID();
    companyId = randomUUID();
    const body = {
        id: teamId,
        type: 'TEAM',
        ownerUserId: owner.userId,
        title: 'Admin-created Team',
        description: 'Preserved display description',
        retentionPolicyVersion: version,
        reason: 'Owner request',
      },
      key = randomUUID();
    const first = await post('workspaces', body, key).expect(200);
    expect(first.body).toMatchObject({
      id: teamId,
      ownerUserId: owner.userId,
      type: 'TEAM',
      profile: { title: 'Admin-created Team' },
    });
    expect((await post('workspaces', body, key).expect(200)).body).toEqual(
      first.body,
    );
    await post(
      'workspaces',
      { ...body, title: 'Changed fingerprint' },
      key,
    ).expect(409);
    await post('workspaces', {
      ...body,
      id: companyId,
      type: 'COMPANY',
      title: 'Admin-created Company',
    }).expect(200);
    const team = await db.team.findUniqueOrThrow({ where: { id: teamId } }),
      creator = await db.sharedActor.findUniqueOrThrow({
        where: { id: team.createdByActorId },
      });
    expect(creator).toMatchObject({
      state: 'ADMIN',
      adminUserId: adminId,
      userId: null,
    });
    expect(
      await db.contextAccess.count({ where: { actorId: creator.id } }),
    ).toBe(0);
    await expect(
      db.contextAccess.create({
        data: {
          id: randomUUID(),
          spaceId: teamId,
          scopeId: teamId,
          actorId: creator.id,
          state: 'ACTIVE',
          memberRole: 'ADMIN',
          joinedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });
  it('edits only display metadata with revisions and queues owner notification', async () => {
    const detail = (await get('workspaces/' + teamId).expect(200)).body;
    const result = await patch('workspaces/' + teamId, {
      revision: detail.profile.revision,
      title: 'Reviewed title',
      reason: 'Display correction',
    }).expect(200);
    expect(result.body.after.title).toBe('Reviewed title');
    expect(result.body.after.description).toBe('Preserved display description');
    await patch('workspaces/' + teamId, {
      revision: detail.profile.revision,
      title: 'Stale',
      reason: 'Stale request',
    }).expect(409);
    expect(
      await db.adminDelivery.count({
        where: { targetUserId: owner.userId, kind: 'WORKSPACE_CHANGED' },
      }),
    ).toBe(1);
  });
  it('adds by invitation, preserves recipient acceptance, and reports OWNER separately from assignable role', async () => {
    const offered = await post(`workspaces/${teamId}/memberships`, {
      userId: member.userId,
      role: 'MEMBER',
      reason: 'Requested access',
    }).expect(200);
    expect(
      await db.contextAccess.count({
        where: { spaceId: teamId, SharedActor: { userId: member.userId } },
      }),
    ).toBe(0);
    const collaboration = app.get(CollaborationService),
      proof = await collaboration.issueRecipientProof(
        member,
        'TEAM',
        offered.body.id,
        1,
      );
    const accepted = await collaboration.decideInvitation(
      member,
      offered.body.id,
      proof.proof!,
      proof.revision,
      true,
      'TEAM',
    );
    expect(accepted).toHaveProperty('membership');
    memberAccess = (accepted as { membership: { id: string } }).membership.id;
    const members = await get(
      `workspaces/${teamId}/memberships?role=OWNER`,
    ).expect(200);
    expect(members.body.items).toHaveLength(1);
    expect(members.body.items[0].userId).toBe(owner.userId);
  });
  it('changes and removes non-owner membership with atomic revision and generation protection', async () => {
    const input = {
      membershipId: memberAccess,
      revision: 1,
      role: 'VIEWER',
      reason: 'Role review',
    };
    const results = await Promise.all([
      patch(`workspaces/${teamId}/memberships/role`, input),
      patch(`workspaces/${teamId}/memberships/role`, input),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const ownerAccess = (
      await db.sharedCustody.findUniqueOrThrow({ where: { spaceId: teamId } })
    ).primaryOwnerAccessId!;
    await post(`workspaces/${teamId}/memberships/remove`, {
      membershipId: ownerAccess,
      revision: 1,
      reason: 'Unsafe removal',
    }).expect(409);
    await post(`workspaces/${teamId}/memberships/remove`, {
      membershipId: memberAccess,
      revision: 2,
      reason: 'Access ended',
    }).expect(200);
    expect(
      (
        await db.contextAccessInterval.findUniqueOrThrow({
          where: {
            accessId_generation: { accessId: memberAccess, generation: 1 },
          },
        })
      ).endedAt,
    ).not.toBeNull();
  });
  it('resends by rotating recipient proof and cancels only pending invitations with current revisions', async () => {
    const offer = await post(`workspaces/${teamId}/memberships`, {
      userId: other.userId,
      role: 'MEMBER',
      reason: 'Invite',
    }).expect(200);
    const prior = await db.contextInvitation.findUniqueOrThrow({
      where: { id: offer.body.id },
    });
    await post(`workspaces/${teamId}/invitations/resend`, {
      invitationId: offer.body.id,
      revision: 1,
      reason: 'Resend',
    }).expect(200);
    expect(
      (
        await db.contextInvitation.findUniqueOrThrow({
          where: { id: offer.body.id },
        })
      ).proofHash,
    ).not.toBe(prior.proofHash);
    await post(`workspaces/${teamId}/invitations/cancel`, {
      invitationId: offer.body.id,
      revision: 1,
      reason: 'Stale cancel',
    }).expect(409);
    await post(`workspaces/${teamId}/invitations/cancel`, {
      invitationId: offer.body.id,
      revision: 2,
      reason: 'Cancel',
    }).expect(200);
    expect(
      (
        await get(`workspaces/${teamId}/invitations?status=REVOKED`).expect(200)
      ).body.items.some((row: { id: string }) => row.id === offer.body.id),
    ).toBe(true);
  });
  it('initiates transfer without changing ownership; successor password verification is mandatory and acceptance is atomic', async () => {
    const offered = await post(`workspaces/${companyId}/memberships`, {
        userId: member.userId,
        role: 'MEMBER',
        reason: 'Company admission',
      }).expect(200),
      access = app.get(CompanyAccess),
      proof = await access.issueProof(member, offered.body.id, 1);
    const accepted = await access.decide(
      member,
      offered.body.id,
      proof.proof!,
      proof.revision,
      true,
    );
    const seat = (accepted as { membership: { id: string } }).membership.id,
      custody = await db.sharedCustody.findUniqueOrThrow({
        where: { spaceId: companyId },
      });
    const transfer = await post(`workspaces/${companyId}/owner-transfers`, {
      successorAccessId: seat,
      revision: custody.revision,
      reason: 'Consented succession',
    }).expect(200);
    expect(
      (
        await db.sharedCustody.findUniqueOrThrow({
          where: { spaceId: companyId },
        })
      ).primaryOwnerAccessId,
    ).toBe(custody.primaryOwnerAccessId);
    await expect(
      app
        .get(CollaborationService)
        .decideHandover(
          member,
          companyId,
          transfer.body.id,
          1,
          'accept',
          'wrong-password',
        ),
    ).rejects.toThrow();
    await app
      .get(CollaborationService)
      .decideHandover(
        member,
        companyId,
        transfer.body.id,
        1,
        'accept',
        password,
      );
    expect(
      (
        await db.sharedCustody.findUniqueOrThrow({
          where: { spaceId: companyId },
        })
      ).primaryOwnerAccessId,
    ).toBe(seat);
    expect(
      (
        await db.ownerHandover.findUniqueOrThrow({
          where: { id: transfer.body.id },
        })
      ).reauthenticatedAt,
    ).not.toBeNull();
    const completion = await db.adminAuditEvent.findFirstOrThrow({
      where: { action: 'ADMIN_HANDOVER_ACCEPTED', targetSpaceId: companyId },
    });
    expect(completion.actorAdminId).toBeNull();
    expect(completion.metadata).toMatchObject({
      initiatedByAdminId: adminId,
      acceptedByUserId: member.userId,
    });
    const identity = await db.user.findUniqueOrThrow({
        where: { id: owner.userId },
      }),
      login = await app
        .get(AuthService)
        .auth.api.signInEmail({ body: { email: identity.email, password } });
    owner = {
      ...owner,
      sessionId: (
        await db.authSession.findUniqueOrThrow({
          where: { token: login.token! },
        })
      ).id,
    };
  });
  it('keeps member reads available while Workspace mutations deny; expires suspension without a worker', async () => {
    const detail = (await get('workspaces/' + teamId).expect(200)).body;
    await post(`workspaces/${teamId}/suspend`, {
      revision: detail.revision,
      reason: 'Read only',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    }).expect(200);
    expect(await app.get(TeamsService).read(owner, teamId)).toHaveProperty(
      'id',
      teamId,
    );
    await expect(
      app.get(TeamsService).patch(owner, teamId, 2, { title: 'Denied' }),
    ).rejects.toThrow();
    await db.space.update({
      where: { id: teamId },
      data: {
        suspendedAt: new Date(Date.now() - 120000),
        suspensionExpiresAt: new Date(Date.now() - 1),
      },
    });
    await app
      .get(TeamsService)
      .patch(owner, teamId, 2, { title: 'After expiry' });
    await post(`workspaces/${teamId}/reactivate`, {
      revision: 2,
      reason: 'Clear expired state',
    }).expect(200);
  });
  it('suspends the owner account without freezing the Team for other admitted members', async () => {
    const offer = await post(`workspaces/${teamId}/memberships`, {
      userId: other.userId,
      role: 'ADMIN',
      reason: 'Administrative collaborator',
    }).expect(200);
    const collaboration = app.get(CollaborationService),
      proof = await collaboration.issueRecipientProof(
        other,
        'TEAM',
        offer.body.id,
        1,
      );
    await collaboration.decideInvitation(
      other,
      offer.body.id,
      proof.proof!,
      proof.revision,
      true,
      'TEAM',
    );
    const state = (await get('users/' + owner.userId).expect(200)).body;
    await post(`users/${owner.userId}/suspend`, {
      revision: state.revision,
      reason: 'Account restricted',
      internalNote: 'Never disclose this note',
    }).expect(200);
    expect(
      await db.authSession.count({ where: { userId: owner.userId } }),
    ).toBe(0);
    await expect(app.get(SpacesService).admit(owner.userId)).rejects.toThrow();
    const identity = await db.user.findUniqueOrThrow({
      where: { id: owner.userId },
    });
    const denial = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .set('X-Forwarded-For', '198.51.100.72')
      .send({ email: identity.email, password })
      .expect(403);
    expect(
      decodeURIComponent(
        denial.headers['x-account-suspension-reason'] as string,
      ),
    ).toBe('Account restricted');
    expect(JSON.stringify(denial.body)).not.toContain(
      'Never disclose this note',
    );
    const wrong = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .set('X-Forwarded-For', '198.51.100.72')
      .send({ email: identity.email, password: 'wrong-password' })
      .expect(401);
    expect(wrong.headers['x-account-suspension-reason']).toBeUndefined();
    expect((await get('workspaces/' + teamId).expect(200)).body.status).toBe(
      'ACTIVE',
    );
    expect(await app.get(TeamsService).read(other, teamId)).toHaveProperty(
      'id',
      teamId,
    );
    await app.get(TeamsService).patch(other, teamId, 3, {
      title: 'Member update while owner suspended',
    });
    await post(`users/${owner.userId}/reactivate`, {
      revision: state.revision + 1,
      reason: 'Account restored',
    }).expect(200);
    expect(
      await db.authSession.count({ where: { userId: owner.userId } }),
    ).toBe(0);
  });
  it('serializes in-flight Personal mutation with suspension and rejects stale authority afterward', async () => {
    const space = app.get(SpacesService),
      scope = await space.authorizePersonal(owner);
    let release!: () => void, entered!: () => void;
    const wait = new Promise<void>((r) => (release = r)),
      inside = new Promise<void>((r) => (entered = r));
    const mutation = db.$transaction(async (tx) => {
      await scope.fence(tx);
      entered();
      await wait;
      await tx.user.update({
        where: { id: owner.userId },
        data: { name: 'Committed before suspension' },
      });
    });
    await inside;
    const state = (await get('users/' + owner.userId).expect(200)).body;
    const pending = post(`users/${owner.userId}/suspend`, {
      revision: state.revision,
      reason: 'After in-flight write',
    }).then((r) => r);
    try {
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (Date.now() < deadline) {
        const [probe] = await db.$queryRaw<
          { n: number }[]
        >`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0`;
        if (probe!.n > 0) {
          blocked = true;
          break;
        }
        await tick();
      }
      expect(blocked).toBe(true);
    } finally {
      release();
    }
    await mutation;
    expect((await pending).status).toBe(200);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).name,
    ).toBe('Committed before suspension');
    await expect(db.$transaction((tx) => scope.fence(tx))).rejects.toThrow();
    await post(`users/${owner.userId}/reactivate`, {
      revision: state.revision + 1,
      reason: 'Restore account',
    }).expect(200);
  });
  it('denies file publication and background authority after suspension wins', async () => {
    const spaces = app.get(SpacesService),
      scope = await spaces.authorizePersonal(owner),
      files = app.get(FilesRepository);
    const receipt = await files.initiate(
        scope,
        { filename: 'synthetic.txt', mimeType: 'text/plain', expectedSize: 1 },
        new Date(Date.now() + 60000),
      ),
      attempt = randomUUID();
    const claim = await files.claim(scope, receipt.id, attempt);
    const state = (await get('users/' + owner.userId).expect(200)).body;
    await post(`users/${owner.userId}/suspend`, {
      revision: state.revision,
      reason: 'Deny publication',
    }).expect(200);
    await expect(
      files.ready(
        scope,
        receipt.id,
        attempt,
        { size: 1, sha256: '0'.repeat(64) },
        claim.auditId,
      ),
    ).rejects.toThrow();
    expect(
      (
        await db.storedFile.findUniqueOrThrow({
          where: { id: receipt.id },
        })
      ).status,
    ).toBe('INITIATED');
    expect(
      await db.$transaction((tx) =>
        spaces.background(tx, scope.spaceId, randomUUID(), randomUUID()),
      ),
    ).toBeNull();
    await post(`users/${owner.userId}/reactivate`, {
      revision: state.revision + 1,
      reason: 'Restore account',
    }).expect(200);
  });
  it('resends an existing email invitation without requiring an account or disclosing the new proof to Admin', async () => {
    const email = randomUUID() + '@example.test';
    const offer = await app
      .get(CollaborationService)
      .createInvitation(
        other,
        teamId,
        { kind: 'MEMBERSHIP', recipient: { email }, memberRole: 'MEMBER' },
        randomUUID(),
      );
    const response = await post(`workspaces/${teamId}/invitations/resend`, {
      invitationId: offer.invitation.id,
      revision: 1,
      reason: 'Recipient requested resend',
    }).expect(200);
    expect(response.body).not.toHaveProperty('proof');
    const queued = await db.adminDelivery.findFirstOrThrow({
      where: { recipientEmail: email },
    });
    expect(queued.targetUserId).toBeNull();
    expect(JSON.stringify(queued.payload)).not.toContain(offer.proof!);
    const worker = app.get(AdminDeliveryService);
    let n = 0;
    while (await worker.consume()) {
      if (++n > 50) throw new Error('Unexpected queue size');
    }
    const message = app
      .get(IdentityMailService)
      .latestForTest(email, 'invitation')!;
    const received = new URLSearchParams(
      new URL(message.url).hash.slice(1),
    ).get('proof')!;
    const stored = await db.contextInvitation.findUniqueOrThrow({
      where: { id: offer.invitation.id },
    });
    expect(createHash('sha256').update(received).digest('hex')).toBe(
      stored.proofHash,
    );
  });
  it('delivers the persisted notifications through the existing mail adapter after worker takeover', async () => {
    const state = (await get('users/' + owner.userId).expect(200)).body;
    await post(`users/${owner.userId}/revoke-sessions`, {
      revision: state.revision,
      reason: 'Delivery takeover fixture',
    }).expect(200);
    const first = await db.adminDelivery.findFirstOrThrow({
      where: { state: 'PENDING' },
      orderBy: { nextAt: 'asc' },
    });
    await db.adminDelivery.update({
      where: { id: first.id },
      data: {
        state: 'SENDING',
        attempts: 1,
        leaseUntil: new Date(Date.now() - 1),
      },
    });
    const worker = app.get(AdminDeliveryService);
    let attempts = 0;
    while (await worker.consume()) {
      if (++attempts > 50) throw new Error('Unexpected unbounded queue');
    }
    expect(
      await db.adminDelivery.count({ where: { state: 'SENT' } }),
    ).toBeGreaterThan(0);
    const user = await db.user.findUniqueOrThrow({
      where: { id: owner.userId },
    });
    expect(
      app.get(IdentityMailService).latestForTest(user.email, 'administrative'),
    ).toBeDefined();
    expect(
      (await db.adminDelivery.findUniqueOrThrow({ where: { id: first.id } }))
        .attempts,
    ).toBe(2);
  });
  it('persists recovery intent, retries a failed delivery and never returns a reset link to Admin', async () => {
    const state = (await get('users/' + owner.userId).expect(200)).body;
    const response = await post(`users/${owner.userId}/recovery`, {
      revision: state.revision,
      reason: 'Verified recovery request',
    }).expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(
      /reset-password|recoveryToken|resetLink/,
    );
    const delivery = await db.adminDelivery.findFirstOrThrow({
        where: { targetUserId: owner.userId, kind: 'PASSWORD_RECOVERY' },
      }),
      worker = app.get(AdminDeliveryService),
      mail = app.get(IdentityMailService);
    const send = vi
      .spyOn(mail, 'send')
      .mockRejectedValueOnce(new Error('Synthetic SMTP interruption'));
    try {
      await worker.consume();
    } finally {
      send.mockRestore();
    }
    expect(
      (await db.adminDelivery.findUniqueOrThrow({ where: { id: delivery.id } }))
        .state,
    ).toBe('PENDING');
    await db.adminDelivery.update({
      where: { id: delivery.id },
      data: { nextAt: new Date(Date.now() - 1) },
    });
    await worker.consume();
    expect(
      (await db.adminDelivery.findUniqueOrThrow({ where: { id: delivery.id } }))
        .state,
    ).toBe('SENT');
    const identity = await db.user.findUniqueOrThrow({
      where: { id: owner.userId },
    });
    expect(mail.latestForTest(identity.email, 'reset-password')).toBeDefined();
  });
  it('replays administrative read-only state before a restored Workspace can serve writes', async () => {
    const id = randomUUID();
    await post('workspaces', {
      id,
      type: 'TEAM',
      ownerUserId: owner.userId,
      title: 'Replay fixture',
      retentionPolicyVersion: version,
      reason: 'Replay test',
    }).expect(200);
    await post(`workspaces/${id}/suspend`, {
      revision: 1,
      reason: 'Preserve restriction',
    }).expect(200);
    const suspended = await db.sharedCustody.findUniqueOrThrow({
      where: { spaceId: id },
    });
    await db.$transaction(async (tx) => {
      await tx.space.update({
        where: { id },
        data: {
          adminRevision: 1,
          suspendedAt: null,
          suspensionExpiresAt: null,
          suspensionReason: null,
        },
      });
      await tx.sharedCustody.update({
        where: { spaceId: id },
        data: { authorizationVersion: 1n, revision: 1 },
      });
    });
    await expect(
      app
        .get(SharedKernel)
        .run(
          other,
          { userIds: [], spaceIds: [id] },
          [{ spaceId: id, scopeId: id, capability: 'task.update' }],
          async () => true,
        ),
    ).rejects.toThrow();
    const restored = await app
      .get(SharedKernel)
      .restoreRestrictions(id, async () => undefined);
    expect(restored).toHaveProperty('complete', true);
    expect(
      (await db.sharedCustody.findUniqueOrThrow({ where: { spaceId: id } }))
        .authorizationVersion,
    ).toBe(suspended.authorizationVersion);
    expect((await get('workspaces/' + id).expect(200)).body.status).toBe(
      'SUSPENDED',
    );
  });
  it('blocks Company member removal while a resource allocation depends on the admission', async () => {
    const offer = await post(`workspaces/${companyId}/memberships`, {
        userId: other.userId,
        role: 'MEMBER',
        reason: 'Dependency fixture',
      }).expect(200),
      access = app.get(CompanyAccess),
      proof = await access.issueProof(other, offer.body.id, 1);
    const accepted = await access.decide(
        other,
        offer.body.id,
        proof.proof!,
        proof.revision,
        true,
      ),
      seat = (accepted as { membership: { id: string } }).membership.id;
    const ownerAccess = (
        await db.sharedCustody.findUniqueOrThrow({
          where: { spaceId: companyId },
        })
      ).primaryOwnerAccessId!,
      creator = (
        await db.contextAccess.findUniqueOrThrow({ where: { id: ownerAccess } })
      ).actorId,
      resourceId = randomUUID();
    await db.companyResource.create({
      data: {
        id: resourceId,
        spaceId: companyId,
        scopeId: companyId,
        createdByActorId: creator,
        title: 'Synthetic resource',
        state: 'ACTIVE',
      },
    });
    await db.companyResourceAllocation.create({
      data: {
        id: randomUUID(),
        spaceId: companyId,
        scopeId: companyId,
        resourceId,
        memberAccessId: seat,
        memberGeneration: 1,
        createdByActorId: creator,
        startAt: new Date(Date.now() - 1000),
        endAt: new Date(Date.now() + 3600000),
        state: 'ALLOCATED',
      },
    });
    expect(
      await db.companyResourceAllocation.count({
        where: {
          spaceId: companyId,
          memberAccessId: seat,
          state: 'ALLOCATED',
          endAt: { gt: new Date() },
        },
      }),
    ).toBe(1);
    await post(`workspaces/${companyId}/memberships/remove`, {
      membershipId: seat,
      revision: 1,
      reason: 'Blocked dependency',
    }).expect(409);
    expect(
      (await db.contextAccess.findUniqueOrThrow({ where: { id: seat } })).state,
    ).toBe('ACTIVE');
  });
  it('preserves Company reads and denies profile mutation while the Company is suspended', async () => {
    const detail = (await get('workspaces/' + companyId).expect(200)).body;
    await post(`workspaces/${companyId}/suspend`, {
      revision: detail.revision,
      reason: 'Company read only',
    }).expect(200);
    expect(
      await app.get(CompaniesService).read(member, companyId),
    ).toHaveProperty('id', companyId);
    await expect(
      app
        .get(CompaniesService)
        .patch(member, companyId, detail.profile.revision, {
          title: 'Denied edit',
        }),
    ).rejects.toThrow();
    await post(`workspaces/${companyId}/reactivate`, {
      revision: detail.revision + 1,
      reason: 'Company restored',
    }).expect(200);
  });
  it('serializes successor acceptance against removal without creating an ownerless Team', async () => {
    const custody = await db.sharedCustody.findUniqueOrThrow({
        where: { spaceId: teamId },
      }),
      seat = await db.contextAccess.findFirstOrThrow({
        where: {
          spaceId: teamId,
          scopeId: teamId,
          SharedActor: { userId: other.userId },
          state: 'ACTIVE',
        },
      });
    const transfer = await post(`workspaces/${teamId}/owner-transfers`, {
      successorAccessId: seat.id,
      revision: custody.revision,
      reason: 'Concurrent succession',
    }).expect(200);
    let release!: () => void, entered!: () => void;
    const wait = new Promise<void>((r) => (release = r)),
      inside = new Promise<void>((r) => (entered = r));
    const lock = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "spaceId" FROM "SharedCustody" WHERE "spaceId"=${teamId}::uuid FOR UPDATE`;
      entered();
      await wait;
    });
    await inside;
    const acceptance = app
        .get(CollaborationService)
        .decideHandover(other, teamId, transfer.body.id, 1, 'accept', password)
        .then(
          () => true,
          () => false,
        ),
      removal = post(`workspaces/${teamId}/memberships/remove`, {
        membershipId: seat.id,
        revision: seat.revision,
        reason: 'Concurrent removal',
      }).then((r) => r.status);
    try {
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (Date.now() < deadline) {
        const [row] = await db.$queryRaw<
          { n: number }[]
        >`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0`;
        if (row!.n >= 2) {
          blocked = true;
          break;
        }
        await tick();
      }
      expect(blocked).toBe(true);
    } finally {
      release();
    }
    await lock;
    const [accepted, removed] = await Promise.all([acceptance, removal]);
    expect([200, 409]).toContain(removed);
    expect(Number(accepted) + Number(removed === 200)).toBe(1);
    const current = await db.sharedCustody.findUniqueOrThrow({
        where: { spaceId: teamId },
      }),
      ownerSeat = await db.contextAccess.findUniqueOrThrow({
        where: { id: current.primaryOwnerAccessId! },
      });
    expect(ownerSeat.state).toBe('ACTIVE');
    expect(ownerSeat.memberRole).not.toBeNull();
  });
  describe('owner-approved one-way Company Team custody', () => {
    let custodyPlan: Awaited<ReturnType<TeamsService['custodyPreview']>>;
    let disposalTeam: string,
      disposalJob: string,
      disposalTask: string,
      survivorTeam: string,
      survivorTask: string;
    let sourceCookie: string;
    let sourceOwner: RequestActor,
      companyOwner: RequestActor,
      outsider: RequestActor,
      childId: string,
      destinationId: string,
      parentId: string;
    const teams = () => app.get(TeamsService),
      companies = () => app.get(CompaniesService);
    async function admit(
      who: RequestActor,
      by: RequestActor,
      scope: string,
      role: 'ORG_ADMIN' | 'MEMBER' = 'MEMBER',
      company = destinationId,
    ) {
      const offer = await companies().invite(
        by,
        company,
        scope,
        { memberRole: role, recipient: { userId: who.userId } },
        randomUUID(),
      );
      const result = await app
        .get(CompanyAccess)
        .decide(who, offer.invitation.id, offer.proof!, 1, true);
      return result.membership!;
    }
    async function createSource(retentionPolicyVersion = version) {
      const id = randomUUID();
      await teams().create(
        sourceOwner,
        {
          id,
          title: 'Preserved Team identity',
          description: 'Preserved source metadata',
          retentionPolicyVersion,
        },
        randomUUID(),
      );
      return id;
    }
    async function prepare(
      id: string,
      company = destinationId,
      parent = parentId,
    ) {
      const p = await teams().custodyPreview(
        sourceOwner,
        id,
        { companyId: company, parentScopeId: parent },
        randomUUID(),
      );
      const proof = {
        manifestHash: p.manifestHash,
        revision: p.revision,
        password,
      };
      await teams().custodyConsent(sourceOwner, id, p.id, {
        ...proof,
        purpose: 'SOURCE_OWNER',
      });
      await teams().custodyConsent(sourceOwner, id, p.id, {
        ...proof,
        purpose: 'PARTICIPANT',
      });
      await teams().custodyConsent(companyOwner, id, p.id, {
        ...proof,
        purpose: 'COMPANY_OWNER',
      });
      return { p, proof };
    }
    beforeAll(async () => {
      sourceOwner = await person();
      companyOwner = await person();
      outsider = await person();
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', origin)
        .set('X-Forwarded-For', '198.51.100.84')
        .send({
          email: (
            await db.user.findUniqueOrThrow({
              where: { id: sourceOwner.userId },
            })
          ).email,
          password,
        })
        .expect(200);
      sourceCookie = (login.headers['set-cookie'] as unknown as string[])
        .map((c) => c.split(';')[0])
        .join('; ');
      destinationId = randomUUID();
      parentId = randomUUID();
      await companies().create(
        companyOwner,
        {
          id: destinationId,
          title: 'Consenting Company',
          retentionPolicyVersion: version,
        },
        randomUUID(),
      );
      await companies().createContext(
        companyOwner,
        destinationId,
        null,
        { id: parentId, title: 'Consenting parent' },
        randomUUID(),
      );
      await admit(sourceOwner, companyOwner, destinationId, 'ORG_ADMIN');
      await admit(sourceOwner, companyOwner, parentId);
      await admit(companyOwner, sourceOwner, parentId);
      childId = await createSource();
    });
    it('requires both owners, participant consent, provider proof and a bound immutable preview', async () => {
      const key = randomUUID(),
        input = { companyId: destinationId, parentScopeId: parentId };
      await request(app.getHttpServer())
        .post(`/api/v1/teams/${childId}/company-custody/preview`)
        .set('Origin', origin)
        .set('Cookie', cookie())
        .set('Idempotency-Key', randomUUID())
        .send(input)
        .expect(401);
      const p = (
          await request(app.getHttpServer())
            .post(`/api/v1/teams/${childId}/company-custody/preview`)
            .set('Origin', origin)
            .set('Cookie', sourceCookie)
            .set('Idempotency-Key', key)
            .send(input)
            .expect(200)
        ).body as Awaited<ReturnType<TeamsService['custodyPreview']>>,
        proof = {
          manifestHash: p.manifestHash,
          revision: p.revision,
          password,
        };
      expect(
        await teams().custodyPreview(sourceOwner, childId, input, key),
      ).toEqual(p);
      await expect(
        teams().custodyPreview(
          sourceOwner,
          childId,
          { ...input, parentScopeId: randomUUID() },
          key,
        ),
      ).rejects.toHaveProperty('status', 409);
      await expect(
        teams().custodyApply(sourceOwner, childId, p.id, proof),
      ).rejects.toMatchObject({
        response: { code: 'TEAM_CUSTODY_CONSENT_REQUIRED' },
      });
      await expect(
        teams().custodyConsent(outsider, childId, p.id, {
          ...proof,
          purpose: 'COMPANY_OWNER',
        }),
      ).rejects.toHaveProperty('status', 403);
      await expect(
        teams().custodyConsent(companyOwner, childId, p.id, {
          ...proof,
          password: 'wrong',
          purpose: 'COMPANY_OWNER',
        }),
      ).rejects.toThrow();
      custodyPlan = p;
    });
    it('rolls back partially moved rows and applies the complete original graph with a safe retry', async () => {
      const p = custodyPlan,
        proof = {
          manifestHash: p.manifestHash,
          revision: p.revision,
          password,
        };
      for (const purpose of ['SOURCE_OWNER', 'PARTICIPANT'] as const)
        await request(app.getHttpServer())
          .post(`/api/v1/teams/${childId}/company-custody/${p.id}/consent`)
          .set('Origin', origin)
          .set('Cookie', sourceCookie)
          .send({ ...proof, purpose })
          .expect(200);
      await teams().custodyConsent(companyOwner, childId, p.id, {
        ...proof,
        purpose: 'COMPANY_OWNER',
      });
      const before = await db.team.findUniqueOrThrow({
        where: { id: childId },
      });
      const facade = teams() as unknown as {
        custodySource(id: string): {
          snapshot(
            tx: Prisma.TransactionClient,
          ): Promise<Prisma.InputJsonValue>;
          move(tx: Prisma.TransactionClient, companyId: string): Promise<void>;
        };
      };
      const original = facade.custodySource.bind(facade);
      const failure = vi
        .spyOn(facade, 'custodySource')
        .mockImplementationOnce((id) => ({
          ...original(id),
          move: async () => {
            throw new ConflictException({ code: 'SYNTHETIC_ROLLBACK' });
          },
        }));
      await expect(
        teams().custodyApply(sourceOwner, childId, p.id, proof),
      ).rejects.toMatchObject({ response: { code: 'SYNTHETIC_ROLLBACK' } });
      failure.mockRestore();
      expect(
        await db.team.findUniqueOrThrow({ where: { id: childId } }),
      ).toEqual(before);
      expect(
        await db.domainScopeCustody.findUnique({ where: { scopeId: childId } }),
      ).toBeNull();
      expect(
        (
          await db.companyCustodyTransfer.findUniqueOrThrow({
            where: { id: p.id },
          })
        ).state,
      ).toBe('PREVIEWED');
      const applied = await teams().custodyApply(
        sourceOwner,
        childId,
        p.id,
        proof,
      );
      expect(applied.state).toBe('APPLIED');
      await request(app.getHttpServer())
        .post(`/api/v1/teams/${childId}/company-custody/${p.id}/apply`)
        .set('Origin', origin)
        .set('Cookie', sourceCookie)
        .send(proof)
        .expect(200);
      expect(
        await teams().custodyApply(sourceOwner, childId, p.id, proof),
      ).toEqual(applied);
      const moved = await db.team.findUniqueOrThrow({ where: { id: childId } });
      expect({ ...moved, spaceId: childId }).toEqual(before);
      expect(await db.space.findUnique({ where: { id: childId } })).toBeNull();
      expect(
        await db.sharedCustody.findUnique({ where: { spaceId: childId } }),
      ).toBeNull();
      expect((await teams().read(sourceOwner, childId)).association).toEqual({
        kind: 'COMPANY',
        companyId: destinationId,
        parentScopeId: parentId,
      });
      await expect(teams().read(companyOwner, childId)).rejects.toHaveProperty(
        'status',
        404,
      );
      const detail = (await get('workspaces/' + childId).expect(200)).body;
      expect(detail).toMatchObject({
        id: childId,
        spaceId: destinationId,
        companyId: destinationId,
        parentScopeId: parentId,
        type: 'TEAM',
        ownerUserId: sourceOwner.userId,
      });
      expect(
        (await get('workspaces?type=TEAM&search=' + childId).expect(200)).body
          .items,
      ).toHaveLength(1);
      expect(
        await db.adminAuditEvent.count({
          where: {
            action: 'TEAM_COMPANY_CUSTODY_APPLIED',
            targetSpaceId: destinationId,
          },
        }),
      ).toBe(1);
      expect(
        await db.adminDelivery.count({
          where: {
            auditId: (
              await db.adminAuditEvent.findFirstOrThrow({
                where: {
                  action: 'TEAM_COMPANY_CUSTODY_APPLIED',
                  targetSpaceId: destinationId,
                },
              })
            ).id,
          },
        }),
      ).toBe(2);
      const oldActor = await db.sharedActor.findUniqueOrThrow({
        where: { id: before.createdByActorId },
      });
      expect(oldActor).toMatchObject({
        state: 'HISTORICAL',
        userId: null,
        originCustodyId: childId,
        spaceId: destinationId,
      });
      const replay = (await app.get(SharedControl).replayEvidence()).find(
        (r) => r.retiredToCompany?.transferId === p.id,
      );
      expect(replay?.retiredToCompany).toMatchObject({
        companyId: destinationId,
        transferId: p.id,
      });
    });
    it('discovers multiple child Teams and keeps profile, suspension, parent and sibling boundaries independent', async () => {
      const sibling = await createSource(),
        { p, proof } = await prepare(sibling);
      await teams().custodyApply(sourceOwner, sibling, p.id, proof);
      expect(await db.team.count({ where: { spaceId: destinationId } })).toBe(
        2,
      );
      const before = (await get('workspaces/' + childId).expect(200)).body;
      await patch('workspaces/' + childId, {
        revision: before.profile.revision,
        title: 'Child profile edit',
        reason: 'Authorized child metadata',
      }).expect(200);
      expect((await teams().read(sourceOwner, childId)).title).toBe(
        'Child profile edit',
      );
      await post(`workspaces/${childId}/suspend`, {
        revision: before.revision,
        reason: 'Only this Team',
      }).expect(200);
      await expect(
        teams().patch(sourceOwner, childId, before.profile.revision + 1, {
          title: 'Denied',
        }),
      ).rejects.toThrow();
      expect(await teams().read(sourceOwner, childId)).toHaveProperty(
        'id',
        childId,
      );
      expect(await teams().read(sourceOwner, sibling)).toHaveProperty(
        'id',
        sibling,
      );
      expect(
        await companies().read(companyOwner, destinationId),
      ).toHaveProperty('id', destinationId);
      await teams().patch(sourceOwner, sibling, 1, {
        title: 'Sibling remains writable',
      });
      await post(`workspaces/${childId}/reactivate`, {
        revision: before.revision + 1,
        reason: 'Resume only this Team',
      }).expect(200);
      const task = await app
        .get(TeamWorkService)
        .createTask(
          sourceOwner,
          childId,
          { id: randomUUID(), title: 'Child-owned work', priority: 'NONE' },
          randomUUID(),
        );
      expect(task).toMatchObject({ spaceId: destinationId, scopeId: childId });
      const lifecycle = app.get(TeamLifecycleService);
      const current = await teams().read(sourceOwner, childId);
      const archived = await lifecycle.change(
        sourceOwner,
        childId,
        current.revision,
        'archive',
      );
      expect((await teams().read(sourceOwner, childId)).state).toBe('ARCHIVED');
      expect((await teams().read(sourceOwner, sibling)).state).toBe('ACTIVE');
      await lifecycle.change(
        sourceOwner,
        childId,
        archived.revision,
        'restore',
      );
    });
    it('keeps Company-root admission, recipient acceptance, invitation generations and scoped ownership mandatory', async () => {
      await expect(
        post(`workspaces/${childId}/memberships`, {
          userId: outsider.userId,
          role: 'MEMBER',
          reason: 'Missing Company root',
        }),
      ).resolves.toHaveProperty('status', 409);
      await admit(outsider, companyOwner, destinationId);
      const offer = (
        await post(`workspaces/${childId}/memberships`, {
          userId: outsider.userId,
          role: 'MEMBER',
          reason: 'Explicit child invitation',
        }).expect(200)
      ).body;
      const proof = await app
        .get(CollaborationService)
        .issueRecipientProof(outsider, 'TEAM', offer.id, 1);
      const result = await app
        .get(CollaborationService)
        .decideInvitation(
          outsider,
          offer.id,
          proof.proof!,
          proof.revision,
          true,
          'TEAM',
        );
      const seat = await db.contextAccess.findFirstOrThrow({
        where: {
          spaceId: destinationId,
          scopeId: childId,
          SharedActor: { userId: outsider.userId },
          state: 'ACTIVE',
        },
      });
      expect(result).toBeDefined();
      expect(
        await db.companyContextAdmission.findUnique({
          where: {
            accessId_generation: {
              accessId: seat.id,
              generation: seat.generation,
            },
          },
        }),
      ).not.toBeNull();
      await patch(`workspaces/${childId}/memberships/role`, {
        membershipId: seat.id,
        revision: seat.revision,
        role: 'LEAD',
        reason: 'Scoped Team role',
      }).expect(200);
      const custody = await db.domainScopeCustody.findUniqueOrThrow({
        where: { scopeId: childId },
      });
      const transfer = (
        await post(`workspaces/${childId}/owner-transfers`, {
          successorAccessId: seat.id,
          revision: custody.revision,
          reason: 'Consented scoped succession',
        }).expect(200)
      ).body;
      await expect(
        app
          .get(CollaborationService)
          .decideHandover(outsider, childId, transfer.id, 1, 'accept', 'wrong'),
      ).rejects.toThrow();
      await app
        .get(CollaborationService)
        .decideHandover(outsider, childId, transfer.id, 1, 'accept', password);
      expect(
        (
          await db.domainScopeCustody.findUniqueOrThrow({
            where: { scopeId: childId },
          })
        ).primaryOwnerAccessId,
      ).toBe(seat.id);
      const updated = await db.contextAccess.findUniqueOrThrow({
        where: { id: seat.id },
      });
      await post(`workspaces/${childId}/memberships/remove`, {
        membershipId: seat.id,
        revision: updated.revision,
        reason: 'Cannot remove Owner',
      }).expect(409);
      const former = await db.contextAccess.findFirstOrThrow({
        where: {
          spaceId: destinationId,
          scopeId: childId,
          SharedActor: { userId: sourceOwner.userId },
          state: 'ACTIVE',
        },
      });
      await post(`workspaces/${childId}/memberships/remove`, {
        membershipId: former.id,
        revision: former.revision,
        reason: 'Remove former scoped Owner',
      }).expect(200);
      expect(
        (await db.contextAccess.findUniqueOrThrow({ where: { id: former.id } }))
          .state,
      ).toBe('REVOKED');
      const invitee = await person();
      await admit(invitee, companyOwner, destinationId);
      const pending = (
        await post(`workspaces/${childId}/memberships`, {
          userId: invitee.userId,
          role: 'MEMBER',
          reason: 'Scoped recipient offer',
        }).expect(200)
      ).body;
      const original = await db.contextInvitation.findUniqueOrThrow({
        where: { id: pending.id },
      });
      await post(`workspaces/${childId}/invitations/resend`, {
        invitationId: pending.id,
        revision: 1,
        reason: 'Rotate scoped offer',
      }).expect(200);
      expect(
        (
          await db.contextInvitation.findUniqueOrThrow({
            where: { id: pending.id },
          })
        ).proofHash,
      ).not.toBe(original.proofHash);
      await post(`workspaces/${childId}/invitations/cancel`, {
        invitationId: pending.id,
        revision: 2,
        reason: 'Cancel scoped offer',
      }).expect(200);
      expect(
        (
          await db.contextInvitation.findUniqueOrThrow({
            where: { id: pending.id },
          })
        ).proofHash,
      ).toBeNull();
    });
    it('denies reparenting, detachment, arbitrary sources, unauthorized callers and unsupported dependency graphs without changing data', async () => {
      const input = { companyId: destinationId, parentScopeId: parentId };
      const another = randomUUID();
      await companies().create(
        companyOwner,
        {
          id: another,
          title: 'Another Company',
          retentionPolicyVersion: version,
        },
        randomUUID(),
      );
      await expect(
        teams().custodyPreview(
          sourceOwner,
          childId,
          { ...input, companyId: another },
          randomUUID(),
        ),
      ).rejects.toHaveProperty('status', 409);
      await expect(
        db.team.update({ where: { id: childId }, data: { spaceId: another } }),
      ).rejects.toThrow();
      await expect(
        db.team.update({ where: { id: childId }, data: { spaceId: childId } }),
      ).rejects.toThrow();
      await request(app.getHttpServer())
        .delete(`/api/v1/teams/${childId}/company-custody`)
        .set('Origin', origin)
        .set('Cookie', sourceCookie)
        .expect(404);
      expect(
        (await db.team.findUniqueOrThrow({ where: { id: childId } })).spaceId,
      ).toBe(destinationId);
      await expect(
        teams().custodyPreview(sourceOwner, childId, input, randomUUID()),
      ).rejects.toHaveProperty('status', 409);
      await expect(
        teams().custodyPreview(
          companyOwner,
          destinationId,
          input,
          randomUUID(),
        ),
      ).rejects.toHaveProperty('status', 409);
      const fresh = await createSource();
      await expect(
        teams().custodyPreview(outsider, fresh, input, randomUUID()),
      ).rejects.toHaveProperty('status', 403);
      await expect(
        teams().custodyPreview(
          sourceOwner,
          fresh,
          { ...input, companyId: fresh },
          randomUUID(),
        ),
      ).rejects.toHaveProperty('status', 409);
      const row = await teams().read(sourceOwner, fresh);
      await teams().collaboration.createInvitation(
        sourceOwner,
        fresh,
        {
          kind: 'MEMBERSHIP',
          recipient: { userId: outsider.userId },
          memberRole: 'MEMBER',
        },
        randomUUID(),
      );
      await expect(
        teams().custodyPreview(sourceOwner, fresh, input, randomUUID()),
      ).rejects.toMatchObject({
        response: { code: 'TEAM_CUSTODY_DEPENDENCIES_UNSUPPORTED' },
      });
      expect(await teams().read(sourceOwner, fresh)).toEqual(row);
      expect(
        await db.domainScopeCustody.findUnique({ where: { scopeId: fresh } }),
      ).toBeNull();
    });
    it('rejects a changed preview and suspended source without publishing a partial transfer', async () => {
      const id = await createSource(),
        { p, proof } = await prepare(id);
      await teams().patch(sourceOwner, id, 1, {
        title: 'Changed after consent',
      });
      await expect(
        teams().custodyApply(sourceOwner, id, p.id, proof),
      ).rejects.toMatchObject({
        response: { code: 'TEAM_CUSTODY_PREVIEW_CHANGED' },
      });
      expect(
        await db.domainScopeCustody.findUnique({ where: { scopeId: id } }),
      ).toBeNull();
      const detail = (await get('workspaces/' + id).expect(200)).body;
      await post(`workspaces/${id}/suspend`, {
        revision: detail.revision,
        reason: 'Suspended before apply',
      }).expect(200);
      await expect(
        teams().custodyApply(sourceOwner, id, p.id, proof),
      ).rejects.toThrow();
      expect((await db.team.findUniqueOrThrow({ where: { id } })).spaceId).toBe(
        id,
      );
    });
    it('returns one applied receipt for concurrent applies after the independent root has retired', async () => {
      const id = await createSource(),
        { p, proof } = await prepare(id);
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((r) => (release = r)),
        inside = new Promise<void>((r) => (entered = r));
      const held = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "spaceId" FROM "SharedCustody" WHERE "spaceId"=${id}::uuid FOR UPDATE`;
        entered();
        await gate;
      });
      await inside;
      const attempts = [
        teams().custodyApply(sourceOwner, id, p.id, proof),
        teams().custodyApply(sourceOwner, id, p.id, proof),
      ];
      try {
        const deadline = Date.now() + 5000;
        let blocked = false;
        while (Date.now() < deadline) {
          const [row] = await db.$queryRaw<
            { n: number }[]
          >`SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0`;
          if (row!.n >= 2) {
            blocked = true;
            break;
          }
          await tick();
        }
        expect(blocked).toBe(true);
      } finally {
        release();
      }
      await held;
      const receipts = await Promise.all(attempts);
      expect(receipts[0]).toEqual(receipts[1]);
      expect(receipts[0]!.state).toBe('APPLIED');
      expect(
        await db.domainScopeCustody.count({ where: { scopeId: id } }),
      ).toBe(1);
      const audits = await db.adminAuditEvent.findMany({
        where: {
          action: 'TEAM_COMPANY_CUSTODY_APPLIED',
          metadata: { path: ['transferId'], equals: p.id },
        },
      });
      expect(audits).toHaveLength(1);
      expect(
        await db.adminDelivery.count({ where: { auditId: audits[0]!.id } }),
      ).toBe(2);
    });
    it('recovers a committed transfer after a worker/process misses its signed terminal append', async () => {
      const id = await createSource(),
        { p, proof } = await prepare(id),
        control = app.get(SharedControl),
        append = control.append.bind(control);
      let missed = false;
      const failure = vi
        .spyOn(control, 'append')
        .mockImplementation(async (record) => {
          if (
            !missed &&
            record.spaceId === id &&
            record.outcome === 'COMMITTED'
          ) {
            missed = true;
            throw new Error('Synthetic post-commit interruption');
          }
          return append(record);
        });
      await expect(
        teams().custodyApply(sourceOwner, id, p.id, proof),
      ).rejects.toThrow('Synthetic post-commit interruption');
      failure.mockRestore();
      expect(
        (
          await db.companyCustodyTransfer.findUniqueOrThrow({
            where: { id: p.id },
          })
        ).state,
      ).toBe('APPLIED');
      expect(
        (await teams().custodyApply(sourceOwner, id, p.id, proof)).state,
      ).toBe('APPLIED');
      const records = await control.records();
      expect(
        records.some(
          (r) =>
            r.spaceId === id &&
            r.action === 'company.custody.transfer.retire' &&
            r.outcome === 'COMMITTED',
        ),
      ).toBe(true);
      await expect(
        teams().create(
          sourceOwner,
          {
            id,
            title: 'Retired identity reuse',
            retentionPolicyVersion: version,
          },
          randomUUID(),
        ),
      ).rejects.toThrow();
      expect(await db.space.findUnique({ where: { id } })).toBeNull();
    });
    it('closes and recovers only the transferred child with the existing seven-day window and fresh owner proof', async () => {
      const id = await createSource(),
        { p, proof } = await prepare(id),
        life = app.get(TeamLifecycleService);
      await teams().custodyApply(sourceOwner, id, p.id, proof);
      await life.change(sourceOwner, id, 1, 'delete', password);
      const job = await life.job(sourceOwner, id);
      expect((await life.status(sourceOwner, id)).state).toBe('CLOSING_GRACE');
      expect(
        await db.sharedLifecycleJob.findUniqueOrThrow({
          where: { id: job.jobId },
        }),
      ).toMatchObject({ spaceId: destinationId, scopeId: id, custodyId: id });
      expect(
        (
          await db.sharedCustody.findUniqueOrThrow({
            where: { spaceId: destinationId },
          })
        ).state,
      ).toBe('ACTIVE');
      const recovery = await life.proof(
        sourceOwner,
        id,
        job.revision,
        password,
      );
      await life.recover(
        sourceOwner,
        id,
        recovery.revision,
        recovery.generation,
        recovery.proof,
        password,
      );
      expect((await teams().read(sourceOwner, id)).state).toBe('ACTIVE');
      expect(
        (
          await db.sharedCustody.findUniqueOrThrow({
            where: { spaceId: destinationId },
          })
        ).state,
      ).toBe('ACTIVE');
      expect((await companies().read(companyOwner, destinationId)).state).toBe(
        'ACTIVE',
      );
    });
    it('honors Unit ancestry without changing a child Team archive state or granting Company content access', async () => {
      const unitId = randomUUID();
      await companies().createContext(
        companyOwner,
        destinationId,
        parentId,
        { id: unitId, title: 'Typed Unit parent' },
        randomUUID(),
      );
      await admit(sourceOwner, companyOwner, unitId);
      await admit(companyOwner, sourceOwner, unitId);
      const id = await createSource();
      const p = await teams().custodyPreview(
        sourceOwner,
        id,
        { companyId: destinationId, parentScopeId: unitId },
        randomUUID(),
      );
      const proof = {
        manifestHash: p.manifestHash,
        revision: p.revision,
        password,
      };
      for (const purpose of ['SOURCE_OWNER', 'PARTICIPANT'] as const)
        await teams().custodyConsent(sourceOwner, id, p.id, {
          ...proof,
          purpose,
        });
      await teams().custodyConsent(companyOwner, id, p.id, {
        ...proof,
        purpose: 'COMPANY_OWNER',
      });
      await teams().custodyApply(sourceOwner, id, p.id, proof);
      expect((await teams().read(sourceOwner, id)).association).toMatchObject({
        parentScopeId: unitId,
      });
      await db.accessScope.update({
        where: { id: parentId },
        data: { state: 'ARCHIVED' },
      });
      try {
        await expect(
          teams().patch(sourceOwner, id, 1, {
            title: 'Archived ancestor must block',
          }),
        ).rejects.toThrow();
        expect(
          (
            await db.domainScopeCustody.findUniqueOrThrow({
              where: { scopeId: id },
            })
          ).state,
        ).toBe('ACTIVE');
        await expect(teams().read(companyOwner, id)).rejects.toHaveProperty(
          'status',
          404,
        );
      } finally {
        await db.accessScope.update({
          where: { id: parentId },
          data: { state: 'ACTIVE' },
        });
      }
      expect((await teams().read(sourceOwner, id)).title).toBe(
        'Preserved Team identity',
      );
    });
    it('queues a transferred Team with real work without disposing it during recovery', async () => {
      disposalTeam = await createSource();
      const { p, proof } = await prepare(disposalTeam);
      await teams().custodyApply(sourceOwner, disposalTeam, p.id, proof);
      disposalTask = randomUUID();
      await app.get(TeamWorkService).createTask(
        sourceOwner,
        disposalTeam,
        {
          id: disposalTask,
          title: 'Disposable child work',
          priority: 'NONE',
        },
        randomUUID(),
      );
      survivorTeam = await createSource();
      const sibling = await prepare(survivorTeam);
      await teams().custodyApply(
        sourceOwner,
        survivorTeam,
        sibling.p.id,
        sibling.proof,
      );
      survivorTask = randomUUID();
      await app.get(TeamWorkService).createTask(
        sourceOwner,
        survivorTeam,
        {
          id: survivorTask,
          title: 'Preserved sibling work',
          priority: 'NONE',
        },
        randomUUID(),
      );
      await app
        .get(TeamLifecycleService)
        .change(sourceOwner, disposalTeam, 1, 'delete', password);
      disposalJob = (
        await app.get(TeamLifecycleService).job(sourceOwner, disposalTeam)
      ).jobId;
      expect(await app.get(TeamCleanupService).consume()).toBe(false);
      expect(
        await db.task.findUnique({ where: { id: disposalTask } }),
      ).not.toBeNull();
    });
    it('disposes only the leased child after recovery and retains its custody witness and sibling data', async () => {
      const siblingBefore = await db.task.findUniqueOrThrow({
        where: { id: survivorTask },
      });
      const control = app.get(SharedControl),
        append = control.append.bind(control);
      let missedTerminal = false;
      const appendSpy = vi
        .spyOn(control, 'append')
        .mockImplementation(async (record) => {
          if (
            !missedTerminal &&
            record.outcome === 'COMMITTED' &&
            record.resourceId === disposalJob &&
            (
              await db.sharedLifecycleJob.findUnique({
                where: { id: disposalJob },
              })
            )?.state === 'DELETED'
          ) {
            missedTerminal = true;
            throw new Error('Synthetic lost terminal append');
          }
          return append(record);
        });
      // Owned sandbox only: exercise the real deadline without changing immutable job evidence.
      await sandbox.query(
        "CREATE OR REPLACE FUNCTION p1_team_lifecycle_now() RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path FROM CURRENT AS $$ SELECT pg_catalog.clock_timestamp()+interval '8 days' $$",
      );
      try {
        const companyBefore = (
          await get('workspaces/' + destinationId).expect(200)
        ).body;
        await post(`workspaces/${destinationId}/suspend`, {
          revision: companyBefore.revision,
          reason: 'Pause background child disposal',
        }).expect(200);
        const paused = await db.sharedLifecycleJob.findUniqueOrThrow({
          where: { id: disposalJob },
        });
        expect(await app.get(TeamCleanupService).consume()).toBe(false);
        expect(
          await db.sharedLifecycleJob.findUniqueOrThrow({
            where: { id: disposalJob },
          }),
        ).toEqual(paused);
        expect(
          await db.task.findUnique({ where: { id: disposalTask } }),
        ).not.toBeNull();
        await post(`workspaces/${destinationId}/reactivate`, {
          revision: companyBefore.revision + 1,
          reason: 'Resume approved child disposal',
        }).expect(200);
        for (let pass = 0; pass < 80; pass++) {
          const job = await db.sharedLifecycleJob.findUniqueOrThrow({
            where: { id: disposalJob },
          });
          if (job.state === 'DELETED') break;
          expect(job.progress).not.toHaveProperty(
            'failureCode',
            'CLEANUP_RETRY_REQUIRED',
          );
          try {
            expect(await app.get(TeamCleanupService).consume()).toBe(true);
          } catch (error) {
            if (!missedTerminal) throw error;
            await app.get(SharedKernel).reconcileControl(destinationId);
          }
        }
        expect(missedTerminal).toBe(true);
        const records = (await control.records()).filter(
          (r) => r.resourceId === disposalJob,
        );
        expect(
          records
            .filter((r) => r.outcome === 'INTENT')
            .every((r) =>
              records.some(
                (outcome) =>
                  outcome.id === r.id && outcome.outcome === 'COMMITTED',
              ),
            ),
        ).toBe(true);
        expect(
          await db.sharedLifecycleJob.findUniqueOrThrow({
            where: { id: disposalJob },
          }),
        ).toMatchObject({
          state: 'DELETED',
          spaceId: null,
          scopeId: disposalTeam,
          custodyId: disposalTeam,
          progress: {
            stage: 'DELETED',
            p1DisposalProtocol: 'P1_INDEPENDENT_TEAM_V1',
            custodyWitness: { companyId: destinationId, sourceKind: 'TEAM' },
          },
        });
        expect(
          await db.team.findUnique({ where: { id: disposalTeam } }),
        ).toBeNull();
        expect(
          await db.domainScopeCustody.findUnique({
            where: { scopeId: disposalTeam },
          }),
        ).toBeNull();
        expect(
          await db.accessScope.findUnique({ where: { id: disposalTeam } }),
        ).toBeNull();
        expect(
          await db.task.findUnique({ where: { id: disposalTask } }),
        ).toBeNull();
        expect(
          await db.task.findUniqueOrThrow({ where: { id: survivorTask } }),
        ).toEqual(siblingBefore);
        expect(await teams().read(sourceOwner, survivorTeam)).toHaveProperty(
          'state',
          'ACTIVE',
        );
        expect(
          await companies().read(companyOwner, destinationId),
        ).toHaveProperty('state', 'ACTIVE');
      } finally {
        appendSpy.mockRestore();
        await sandbox.query(
          'CREATE OR REPLACE FUNCTION p1_team_lifecycle_now() RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path FROM CURRENT AS $$ SELECT pg_catalog.clock_timestamp() $$',
        );
      }
    });
    it('keeps a closed child and its work intact while its captured retention hold is active', async () => {
      const captured = await db.sharedRetentionPolicy.findUniqueOrThrow({
        where: { version },
      });
      const heldVersion = 'held-' + randomUUID();
      await db.sharedRetentionPolicy.create({
        data: {
          version: heldVersion,
          approvalReference: captured.approvalReference,
          configuration: {
            ...(captured.configuration as Prisma.JsonObject),
            policyVersion: heldVersion,
            holds: [
              {
                id: randomUUID(),
                basis: 'Synthetic retention obligation',
                authority: 'Fixture operator',
                scope: 'All child history',
                state: 'ACTIVE',
                nextReviewAt: new Date().toISOString(),
                releaseEvidence: null,
              },
            ],
          },
        },
      });
      const heldCompany = randomUUID(),
        heldParent = randomUUID();
      await companies().create(
        companyOwner,
        {
          id: heldCompany,
          title: 'Held Company',
          retentionPolicyVersion: heldVersion,
        },
        randomUUID(),
      );
      await companies().createContext(
        companyOwner,
        heldCompany,
        null,
        { id: heldParent, title: 'Held parent' },
        randomUUID(),
      );
      await admit(
        sourceOwner,
        companyOwner,
        heldCompany,
        'ORG_ADMIN',
        heldCompany,
      );
      await admit(sourceOwner, companyOwner, heldParent, 'MEMBER', heldCompany);
      await admit(companyOwner, sourceOwner, heldParent, 'MEMBER', heldCompany);
      const id = await createSource(heldVersion),
        prepared = await prepare(id, heldCompany, heldParent);
      await teams().custodyApply(
        sourceOwner,
        id,
        prepared.p.id,
        prepared.proof,
      );
      const taskId = randomUUID();
      await app
        .get(TeamWorkService)
        .createTask(
          sourceOwner,
          id,
          { id: taskId, title: 'Held work', priority: 'NONE' },
          randomUUID(),
        );
      await app
        .get(TeamLifecycleService)
        .change(sourceOwner, id, 1, 'delete', password);
      const jobId = (await app.get(TeamLifecycleService).job(sourceOwner, id))
        .jobId;
      await sandbox.query(
        "CREATE OR REPLACE FUNCTION p1_team_lifecycle_now() RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path FROM CURRENT AS $$ SELECT pg_catalog.clock_timestamp()+interval '8 days' $$",
      );
      try {
        expect(await app.get(TeamCleanupService).consume()).toBe(true);
        expect(await app.get(TeamCleanupService).consume()).toBe(true);
        expect(
          await db.sharedLifecycleJob.findUniqueOrThrow({
            where: { id: jobId },
          }),
        ).toMatchObject({
          state: 'WAITING_OBLIGATIONS',
          progress: { failureCode: 'RETENTION_OBLIGATION' },
        });
        expect(
          await db.task.findUnique({ where: { id: taskId } }),
        ).not.toBeNull();
        expect(await db.team.findUnique({ where: { id } })).not.toBeNull();
        expect(
          await companies().read(companyOwner, heldCompany),
        ).toHaveProperty('state', 'ACTIVE');
      } finally {
        await sandbox.query(
          'CREATE OR REPLACE FUNCTION p1_team_lifecycle_now() RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path FROM CURRENT AS $$ SELECT pg_catalog.clock_timestamp() $$',
        );
      }
    });
    it('replays child suspension on a compatible Company snapshot and preserves the existing restore quarantine', async () => {
      const before = (await get('workspaces/' + childId).expect(200)).body;
      const root = await db.sharedCustody.findUniqueOrThrow({
        where: { spaceId: destinationId },
      });
      await post(`workspaces/${childId}/suspend`, {
        revision: before.revision,
        reason: 'Child replay restriction',
      }).expect(200);
      await db.$transaction(async (tx) => {
        await tx.accessScope.update({
          where: { id: childId },
          data: {
            adminRevision: before.revision,
            suspendedAt: null,
            suspensionExpiresAt: null,
            suspensionReason: null,
          },
        });
        await tx.sharedCustody.update({
          where: { spaceId: destinationId },
          data: { authorizationVersion: root.authorizationVersion },
        });
      });
      await expect(
        teams().patch(outsider, childId, before.profile.revision, {
          title: 'Premature restored write',
        }),
      ).rejects.toThrow();
      expect(
        await app
          .get(SharedKernel)
          .restoreRestrictions(destinationId, async () => undefined),
      ).toHaveProperty('complete', true);
      expect((await get('workspaces/' + childId).expect(200)).body.status).toBe(
        'SUSPENDED',
      );
      await expect(
        teams().patch(outsider, childId, before.profile.revision, {
          title: 'Denied after replay',
        }),
      ).rejects.toThrow();
      expect(
        (
          await db.sharedCustody.findUniqueOrThrow({
            where: { spaceId: destinationId },
          })
        ).state,
      ).toBe('ACTIVE');
      // Existing Company restore contract quarantines scopes until separate policy reconciliation.
      expect(
        (
          await db.accessScope.findUniqueOrThrow({
            where: { id: destinationId },
          })
        ).state,
      ).toBe('CLOSED');
    });
  });
});
