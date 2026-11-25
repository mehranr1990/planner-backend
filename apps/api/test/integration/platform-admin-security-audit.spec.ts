import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import path from 'node:path';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import {
  SharedKernel,
  CollaborationService,
} from '../../src/modules/spaces/public/index.js';
import {
  TeamsService,
  TeamLifecycleService,
} from '../../src/modules/teams/public/index.js';
import { CompaniesService } from '../../src/modules/companies/public/index.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import {
  ProjectsService,
  ProjectExportService,
} from '../../src/modules/projects/public/index.js';
import { buffer } from 'node:stream/consumers';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { spawnSync } from 'node:child_process';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { testApplication } from '../support/application.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { AdminSecurityService } from '../../src/platform/admin/security.service.js';
import { AdminAuditQuery } from '../../src/platform/admin/audit-query.service.js';
import { AdminAuditRetention } from '../../src/platform/admin/audit-retention.service.js';
import { UserSecurityService } from '../../src/modules/admin-management/user-security.service.js';
import { PersonalLifecycle } from '../../src/modules/account/public/index.js';
import { AdminPrivacyService } from '../../src/modules/admin-management/privacy.service.js';
import { AdminDeliveryService } from '../../src/modules/admin-management/public/index.js';
import { AdminSecurityAlerts } from '../../src/platform/admin/security-alerts.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { AdminCommand } from '../../src/platform/admin/admin-command.js';
import {
  defaultAdminSecurityPolicy,
  SECURITY_POLICY_ID,
} from '../../src/platform/admin/security-policy.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AdminSecurityPolicySchema,
  AdminAuditQuerySchema,
} from '@mehran/api-contracts';
import type { Prisma } from '../../src/generated/prisma/client.js';
import request from 'supertest';

describe('Platform Admin P2 security approval and audit boundaries', () => {
  const version = 'p2-privacy-test',
    password = 'test-only-p2-privacy-passphrase!';
  async function personalSubject() {
    const user = await db.client.user.create({
      data: {
        email: `privacy-${randomUUID()}@example.test`,
        name: 'Private account fixture',
        emailVerified: true,
        settings: { create: {} },
        spaces: { create: { kind: 'PERSONAL' } },
      },
      include: { spaces: true },
    });
    const session = await db.client.authSession.create({
      data: {
        userId: user.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const noteId = randomUUID(),
      stamp = new Date();
    await db.client.note.create({
      data: {
        id: noteId,
        logicalId: noteId,
        spaceId: user.spaces[0]!.id,
        createdByUserId: user.id,
        title: 'Private title',
        content: 'Private content must remain during recovery',
        createdAt: stamp,
        recordedAt: stamp,
      },
    });
    return {
      userId: user.id,
      spaceId: user.spaces[0]!.id,
      sessionId: session.id,
      noteId,
      email: user.email,
    };
  }
  let box: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    db: DatabaseService,
    security: AdminSecurityService,
    audit: AdminAuditQuery;
  type Operator = { id: string; sessionId: string; role: string };
  let first: Operator, second: Operator, target: Operator, reviewer: Operator;
  async function operator(role = 'SUPER_ADMIN'): Promise<Operator> {
    const u = await db.client.adminUser.create({
      data: {
        email: `security-${randomUUID()}@example.test`,
        name: 'Security fixture',
        role,
        twoFactorEnabled: true,
        mfaEnrolledAt: new Date(0),
      },
    });
    const s = await db.client.adminSession.create({
      data: {
        userId: u.id,
        token: randomUUID(),
        createdAt: new Date(Date.now() - 1000),
        mfaVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    return { id: u.id, sessionId: s.id, role };
  }
  async function cmd(
    actor: Operator,
    permission: string,
    input: Prisma.InputJsonValue,
    key = randomUUID(),
  ) {
    const event = await db.client.adminAuditEvent.create({
      data: {
        action: 'P2_SECURITY_TEST',
        requestId: randomUUID(),
        outcome: 'ATTEMPTED',
        permission,
      },
    });
    return new AdminCommand(
      actor.id,
      actor.sessionId,
      permission,
      event.requestId,
      event.id,
      key,
      input,
    );
  }
  beforeAll(async () => {
    box = await migrationSandbox(process.env);
    const deployed = spawnSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--config',
        'prisma.config.ts',
      ],
      { env: { ...process.env, DATABASE_URL: box.url }, encoding: 'utf8' },
    );
    if (deployed.status !== 0)
      throw new Error('P2 isolated fixture migration failed');
    const schema = new URL(box.url).searchParams.get('schema')!;
    const client = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: isolatedTestDatabaseUrl(process.env),
          options: '-c search_path=' + schema + ' -c timezone=UTC',
        },
        { schema },
      ),
    });
    app = await testApplication({
      databaseUrl: isolatedTestDatabaseUrl(process.env),
      environment: {
        PERSONAL_ERASURE_POLICY_VERSION: 'SYNTHETIC-P2-ONLY',
        SHARED_CONTROL_ROOT: path.resolve(
          '.tools',
          'p2-privacy-control-' + randomUUID(),
        ),
        SHARED_CONTROL_KEYS: JSON.stringify({
          k1: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'k1',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P2-ONLY',
      },
      databaseInstance: {
        client,
        checkConnection: async () => undefined,
        onApplicationShutdown: async () => client.$disconnect(),
      } as unknown as DatabaseService,
    });
    db = app.get(DatabaseService);
    await app.get(SharedControl).initialize();
    const rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER', 'ADMIN'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
    await db.client.sharedRetentionPolicy.create({
      data: {
        version,
        approvalReference: 'SYNTHETIC',
        configuration: {
          policyVersion: version,
          approvalReference: 'SYNTHETIC',
          accountableOperator: 'fixture',
          applicableContexts: ['PROJECT', 'TEAM', 'COMPANY'],
          marketScope: 'test only',
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
          backupPolicyReference: 'independent fixture',
        },
      },
    });
    security = app.get(AdminSecurityService);
    audit = app.get(AdminAuditQuery);
    first = await operator();
    second = await operator();
    target = await operator();
    reviewer = await operator('SECURITY_REVIEWER');
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await box?.close();
  });
  async function userActor() {
    const user = await personalSubject();
    const credential = await (
      await app.get(AuthService).auth.$context
    ).password.hash(password);
    await db.client.authAccount.create({
      data: {
        userId: user.userId,
        accountId: user.userId,
        providerId: 'credential',
        password: credential,
      },
    });
    return {
      userId: user.userId,
      sessionId: user.sessionId,
      requestId: randomUUID(),
      correlationId: randomUUID(),
    };
  }
  async function reviewedDeletion(
    kind: 'TEAM' | 'COMPANY' | 'ACCOUNT',
    targetId: string,
  ) {
    const privacy = app.get(AdminPrivacyService);
    const input = {
      kind,
      targetId,
      revision: 1,
      recoveryDays: 30,
      ...(kind === 'ACCOUNT' ? { retentionAcknowledged: true } : {}),
      reason: 'Reviewed fixture closure',
    };
    const row = (await privacy.mutate(
      await cmd(first, 'admin.privacy.deletions.request', input),
      'request',
      undefined,
      input,
    )) as {
      id: string;
      impactFingerprint: string;
      impact: { members: number | null };
    };
    const approval = {
      targetId,
      recoveryDays: 30,
      impactFingerprint: row.impactFingerprint,
      reason: 'Confirm target, deadline and membership impact',
    };
    await privacy.mutate(
      await cmd(second, 'admin.privacy.deletions.approve', approval),
      'approve',
      row.id,
      approval,
    );
    return row;
  }
  it('requires disposition of owned Team and Company, fences membership changes, and recovers only the custodian', async () => {
    const owner = await userActor(),
      member = await userActor(),
      teams = app.get(TeamsService),
      companies = app.get(CompaniesService),
      privacy = app.get(AdminPrivacyService),
      kernel = app.get(SharedKernel);
    const team = randomUUID(),
      company = randomUUID();
    await teams.create(
      owner,
      { id: team, title: 'Subject Team', retentionPolicyVersion: version },
      randomUUID(),
    );
    await companies.create(
      owner,
      {
        id: company,
        title: 'Subject Company',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    const dependencies = () =>
      db.client.$transaction((tx) =>
        kernel.accountDeletionDependencies(tx, owner.userId),
      );
    expect((await dependencies()).items.map((r) => r.id).sort()).toEqual(
      [team, company].sort(),
    );
    await expect(reviewedDeletion('ACCOUNT', owner.userId)).rejects.toThrow(
      'Conflict',
    );
    const stale = await reviewedDeletion('TEAM', team);
    const collaboration = app.get(CollaborationService);
    const offer = await collaboration.createInvitation(
      owner,
      team,
      {
        kind: 'MEMBERSHIP',
        memberRole: 'MEMBER',
        recipient: { userId: member.userId },
      },
      randomUUID(),
    );
    await collaboration.decideInvitation(
      member,
      offer.invitation.id,
      offer.proof!,
      1,
      true,
      'TEAM',
    );
    const perform = async (id: string) =>
      privacy.mutate(
        await cmd(first, 'admin.privacy.deletions.execute', { id }),
        'execute',
        id,
        {},
      ) as Promise<{ resultJobId: string }>;
    await expect(perform(stale.id)).rejects.toThrow('Conflict');
    const approved = await reviewedDeletion('TEAM', team);
    expect(approved.impact.members).toBe(2);
    const result = await perform(approved.id);
    const job = await db.client.sharedLifecycleJob.findUniqueOrThrow({
      where: { id: result.resultJobId },
    });
    expect(job.state).toBe('CLOSING_GRACE');
    expect(+job.recoveryDeadline - +job.effectiveDepartureAt).toBe(
      30 * 86400000,
    );
    const seats = () =>
      db.client.contextAccess.findMany({
        where: { spaceId: team },
        orderBy: { state: 'asc' },
        select: { state: true },
      });
    expect((await seats()).map((s) => s.state).sort()).toEqual([
      'LEFT',
      'REVOKED',
    ]);
    expect((await dependencies()).items.map((r) => r.id)).toEqual([company]);
    expect(
      (
        await db.client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: company },
        })
      ).state,
    ).toBe('ACTIVE');
    const life = app.get(TeamLifecycleService);
    await expect(
      life.proof(member, team, job.revision, password),
    ).rejects.toThrow();
    const proof = await life.proof(owner, team, job.revision, password);
    await life.recover(
      owner,
      team,
      proof.revision,
      proof.generation,
      proof.proof,
      password,
    );
    expect((await seats()).map((s) => s.state).sort()).toEqual([
      'ACTIVE',
      'REVOKED',
    ]);
    const companyReview = await reviewedDeletion('COMPANY', company);
    expect((await privacy.detail(companyReview.id)).state).toBe('APPROVED');
    await perform(companyReview.id);
    expect((await dependencies()).items.map((r) => r.id)).toEqual([team]);
  }, 30000);
  it('includes an owned Project and excludes other accounts and unapproved Project selection', async () => {
    const owner = await userActor(),
      other = await userActor(),
      projects = app.get(ProjectsService),
      exports = app.get(ProjectExportService);
    const mine = await projects.create(
      owner,
      {
        id: randomUUID(),
        title: 'Owned export fixture',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    const foreign = await projects.create(
      other,
      {
        id: randomUUID(),
        title: 'Foreign fixture',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    await projects.createTask(
      owner,
      mine.id,
      { id: randomUUID(), title: 'Owned export task', priority: 'NONE' },
      randomUUID(),
    );
    const entries = await exports.personalArchiveEntries(owner);
    expect(entries.map((e) => e.name)).toEqual([
      'projects/' + mine.id + '.json',
    ]);
    expect((await buffer(await entries[0]!.open())).toString()).toContain(
      'Owned export task',
    );
    await expect(
      exports.personalArchiveEntries(owner, foreign.id),
    ).rejects.toThrow();
  });
  it('limits user session changes to the selected identity and keeps recovery behind the sign-in restriction', async () => {
    const user = await personalSubject(),
      other = await personalSubject(),
      service = app.get(UserSecurityService);
    const session = await db.client.authSession.create({
      data: {
        userId: user.userId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    const metadata = await service.sessions(user.userId);
    expect(metadata.items.map((r) => r.id).sort()).toEqual(
      [user.sessionId, session.id].sort(),
    );
    expect(JSON.stringify(metadata)).not.toContain(session.token);
    const selected = {
      revision: 1,
      reason: 'End reviewed user sessions',
      sessionIds: [session.id, other.sessionId],
    };
    await service.mutate(
      await cmd(reviewer, 'admin.security.user_sessions.revoke', selected),
      user.userId,
      'revoke-sessions',
      selected,
    );
    expect(
      await db.client.authSession.count({
        where: { id: { in: [other.sessionId, user.sessionId] } },
      }),
    ).toBe(2);
    const block = { revision: 2, reason: 'Restrict sign-in temporarily' };
    await service.mutate(
      await cmd(reviewer, 'admin.security.user_login.restrict', block),
      user.userId,
      'block-login',
      block,
    );
    expect(
      await db.client.authSession.count({ where: { userId: user.userId } }),
    ).toBe(0);
    const recover = { revision: 3, reason: 'Verified recovery requested' };
    await expect(
      service.mutate(
        await cmd(reviewer, 'admin.security.user_recovery.initiate', recover),
        user.userId,
        'recovery',
        recover,
      ),
    ).rejects.toThrow('Forbidden');
    await service.mutate(
      await cmd(reviewer, 'admin.security.user_login.restrict', recover),
      user.userId,
      'unblock-login',
      recover,
    );
    expect(
      await db.client.authSession.count({ where: { userId: user.userId } }),
    ).toBe(0);
  });
  it('applies backup retention prospectively with independent approval and an immutable impact preview', async () => {
    const retention = app.get(AdminAuditRetention),
      input = {
        category: 'BACKUP',
        days: 14,
        revision: 1,
        reason: 'Shorten future signed manifest validity',
      };
    const row = (await retention.mutate(
      await cmd(first, 'admin.privacy.retention.preview', input),
      'preview',
      undefined,
      input,
    )) as { id: string; eligibleRecords: number };
    expect(row.eligibleRecords).toBe(0);
    await expect(
      db.client.adminAuditRetentionChange.update({
        where: { id: row.id },
        data: { days: 1 },
      }),
    ).rejects.toThrow();
    await retention.mutate(
      await cmd(second, 'admin.privacy.retention.approve', {}),
      'approve',
      row.id,
      { eligibleRecords: 0, reason: 'Historical deadlines preserved' },
    );
    await retention.mutate(
      await cmd(first, 'admin.privacy.retention.publish', {}),
      'apply',
      row.id,
      {},
    );
    expect(
      (await retention.policies()).items.find((p) => p.category === 'BACKUP'),
    ).toMatchObject({ days: 14, revision: 2 });
    await expect(
      db.client.adminAuditRetentionPolicy.update({
        where: { category: 'BACKUP' },
        data: { days: 31 },
      }),
    ).rejects.toThrow();
  });
  const recovery = () => ({
    action: 'MFA_RECOVERY',
    targetAdminId: target.id,
    identityVerified: true,
    identityReviewReference: 'review/verified-12345',
    reason: 'Independent operator identity verification completed',
  });
  it('denies anonymous access to the new security and audit routes', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/security/policy')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/audit?category=SECURITY')
      .expect(401);
  });
  it('requires different operators and denies premature execution and target self-approval', async () => {
    const input = recovery();
    const row = (await security.mutate(
      await cmd(first, 'admin.security.critical.request', input),
      'request',
      undefined,
      input,
    )) as { id: string };
    await expect(
      security.mutate(
        await cmd(first, 'admin.security.critical.approve', {}),
        'approve',
        row.id,
        { reason: 'Self approval', identityVerified: true },
      ),
    ).rejects.toThrow('Forbidden');
    await expect(
      security.mutate(
        await cmd(target, 'admin.security.critical.approve', {}),
        'approve',
        row.id,
        { reason: 'Target approval', identityVerified: true },
      ),
    ).rejects.toThrow('Forbidden');
    await expect(
      security.mutate(
        await cmd(first, 'admin.security.critical.request', {}),
        'execute',
        row.id,
        {},
      ),
    ).rejects.toThrow('Forbidden');
    expect((await security.approval(row.id, second.id)).request).toMatchObject({
      identityVerified: true,
      targetAdminId: target.id,
    });
  });
  it('rechecks current approver permission and rejects wrong service capabilities', async () => {
    await expect(
      security.mutate(
        await cmd(reviewer, 'admin.security.critical.approve', {}),
        'request',
        undefined,
        recovery(),
      ),
    ).rejects.toThrow('Forbidden');
    await expect(
      security.mutate(
        await cmd(first, 'admin.session.read', {}),
        'request',
        undefined,
        recovery(),
      ),
    ).rejects.toThrow('Forbidden');
  });
  it('expires requests authoritatively and keeps the stored history unchanged', async () => {
    const input = recovery();
    const row = (await security.mutate(
      await cmd(first, 'admin.security.critical.request', input),
      'request',
      undefined,
      input,
    )) as { id: string };
    const source = await db.client.adminSecurityApproval.findUniqueOrThrow({
      where: { id: row.id },
    });
    const expired = await db.client.adminSecurityApproval.create({
      data: {
        action: source.action,
        requesterAdminId: first.id,
        targetAdminId: target.id,
        targetEnrollmentAt: source.targetEnrollmentAt,
        input: source.input as Prisma.InputJsonValue,
        reason: source.reason,
        createdAt: new Date(Date.now() - 3600000),
        expiresAt: new Date(Date.now() - 1800000),
      },
    });
    expect((await security.approval(expired.id, first.id)).state).toBe(
      'EXPIRED',
    );
    await expect(
      security.mutate(
        await cmd(second, 'admin.security.critical.approve', {}),
        'approve',
        expired.id,
        { reason: 'Expired review', identityVerified: true },
      ),
    ).rejects.toThrow('Conflict');
    expect(
      (
        await db.client.adminSecurityApproval.findUniqueOrThrow({
          where: { id: expired.id },
        })
      ).state,
    ).toBe('PENDING');
  });
  it('executes reviewed MFA recovery exactly once, revokes sessions and preserves audit', async () => {
    const input = recovery();
    const row = (await security.mutate(
      await cmd(first, 'admin.security.critical.request', input),
      'request',
      undefined,
      input,
    )) as { id: string };
    await security.mutate(
      await cmd(second, 'admin.security.critical.approve', {}),
      'approve',
      row.id,
      { reason: 'Independently verified identity', identityVerified: true },
    );
    const execute = await cmd(first, 'admin.security.critical.request', {
      id: row.id,
    });
    const outcomes = await Promise.all([
      security.mutate(execute, 'execute', row.id, {}),
      security.mutate(execute, 'execute', row.id, {}),
    ]);
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[0]).toMatchObject({
      state: 'EXECUTED',
      approverAdminId: second.id,
    });
    expect(
      await db.client.adminSession.count({ where: { userId: target.id } }),
    ).toBe(0);
    expect(
      (
        await db.client.adminUser.findUniqueOrThrow({
          where: { id: target.id },
        })
      ).twoFactorEnabled,
    ).toBe(false);
    expect(
      await db.client.adminAuditEvidence.count({
        where: { eventId: execute.auditId, outcome: 'SUCCEEDED' },
      }),
    ).toBe(1);
  });
  it('uses revision checks for approved policy changes and cannot exceed security floors', async () => {
    const input = {
      action: 'SECURITY_POLICY',
      revision: 1,
      policy: { ...defaultAdminSecurityPolicy, adminLoginMax: 4 },
      reason: 'Tighten login attempt limit',
    };
    const row = (await security.mutate(
      await cmd(first, 'admin.security.critical.request', input),
      'request',
      undefined,
      input,
    )) as { id: string };
    await security.mutate(
      await cmd(second, 'admin.security.critical.approve', {}),
      'approve',
      row.id,
      { reason: 'Reviewed safe policy', identityVerified: true },
    );
    await security.mutate(
      await cmd(first, 'admin.security.critical.request', {}),
      'execute',
      row.id,
      {},
    );
    expect(await security.policy()).toMatchObject({
      revision: 2,
      policy: { adminLoginMax: 4 },
    });
    expect(
      AdminSecurityPolicySchema.safeParse({
        ...defaultAdminSecurityPolicy,
        adminLoginMax: 6,
      }).success,
    ).toBe(false);
    await expect(
      db.client.adminSecurityPolicy.update({
        where: { id: SECURITY_POLICY_ID },
        data: { policy: { ...defaultAdminSecurityPolicy, adminLoginMax: 6 } },
      }),
    ).rejects.toThrow();
  });
  it('revokes only selected target sessions, preserving another admin session', async () => {
    const other = await operator();
    const session = await db.client.adminSession.findUniqueOrThrow({
      where: { id: other.sessionId },
    });
    const result = await security.mutate(
      await cmd(first, 'admin.security.sessions.revoke', { target: other.id }),
      'revoke',
      other.id,
      { sessionIds: [other.sessionId, second.sessionId] },
    );
    expect(result).toEqual({ revoked: 1 });
    expect(
      await db.client.adminSession.findUnique({ where: { id: session.id } }),
    ).toBeNull();
    expect(
      await db.client.adminSession.findUnique({
        where: { id: second.sessionId },
      }),
    ).not.toBeNull();
  });
  it('keeps immutable evidence after source deletion and rejects audit rewrites', async () => {
    const event = await db.client.adminAuditEvent.create({
      data: {
        action: 'POST security/example',
        requestId: randomUUID(),
        outcome: 'SUCCEEDED',
        actorAdminId: first.id,
        reason: 'Internal review reference only',
        internalNote: 'Must never enter evidence or CSV',
        metadata: {
          targetAdminId: target.id,
          before: { revision: 2, privateText: 'private before' },
          after: { revision: 3 },
        },
      },
    });
    const evidence = await db.client.adminAuditEvidence.findUniqueOrThrow({
      where: { source_eventId: { source: 'ADMIN', eventId: event.id } },
    });
    expect(evidence).toMatchObject({
      targetAdminId: target.id,
      beforeRevision: 2,
      afterRevision: 3,
    });
    expect(JSON.stringify(evidence)).not.toContain('private before');
    await expect(
      db.client.adminAuditEvidence.update({
        where: { id: evidence.id },
        data: { reason: 'tampered' },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.adminAuditEvidence.delete({ where: { id: evidence.id } }),
    ).rejects.toThrow();
    await db.client.adminAuditEvent.delete({ where: { id: event.id } });
    const page = await audit.list(
      reviewer,
      AdminAuditQuerySchema.parse({
        category: 'SECURITY',
        requestId: event.requestId,
      }),
    );
    expect(page.items.find((r) => r.id === evidence.id)).toMatchObject({
      reason: null,
      action: 'POST security/example',
    });
    expect(JSON.stringify(page)).not.toContain('Must never enter evidence');
  });
  it('binds audit cursors to actor/filter and prevents category leakage', async () => {
    await db.client.adminAuditEvent.createMany({
      data: [1, 2].map((i) => ({
        action: 'WORKSPACE_METADATA_' + i,
        requestId: randomUUID(),
        outcome: 'SUCCEEDED' as const,
      })),
    });
    await expect(
      audit.list(
        reviewer,
        AdminAuditQuerySchema.parse({ category: 'PRIVACY' }),
      ),
    ).rejects.toThrow('Forbidden');
    const page = await audit.list(
      first,
      AdminAuditQuerySchema.parse({ category: 'CONTROL', limit: 1 }),
    );
    if (!page.nextCursor)
      throw new Error('Expected multiple control audit events');
    await expect(
      audit.list(
        second,
        AdminAuditQuerySchema.parse({
          category: 'CONTROL',
          cursor: page.nextCursor,
        }),
      ),
    ).rejects.toThrow('Bad Request');
    await expect(
      audit.list(
        first,
        AdminAuditQuerySchema.parse({
          category: 'SECURITY',
          cursor: page.nextCursor,
        }),
      ),
    ).rejects.toThrow('Bad Request');
  });
  it('neutralizes spreadsheet formulas in audit CSV without exporting internal metadata', async () => {
    const event = await db.client.adminAuditEvent.create({
      data: {
        action: 'POST security/csv',
        requestId: randomUUID(),
        outcome: 'SUCCEEDED',
        reason: '=HYPERLINK("private")',
        internalNote: 'private note',
      },
    });
    const result = await audit.csv(
      first,
      AdminAuditQuerySchema.parse({
        category: 'SECURITY',
        action: 'POST security/csv',
      }),
    );
    expect(result.csv).toContain("'=HYPERLINK");
    expect(result.csv).not.toContain('private note');
    expect(result.csv).toContain(event.id);
  });
  it('detects threshold alerts once per policy/window and resumes an expired delivery lease', async () => {
    await db.client.adminSecurityPolicy.update({
      where: { id: SECURITY_POLICY_ID },
      data: {
        policy: {
          ...defaultAdminSecurityPolicy,
          alertChannels: ['IN_APP', 'EMAIL'],
        },
      },
    });
    await db.client.securityAuditEvent.createMany({
      data: Array.from({ length: 5 }, () => ({
        action: 'AUTH_SIGN_IN',
        outcome: 'DENIED' as const,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      })),
    });
    const alerts = app.get(AdminSecurityAlerts);
    expect(await alerts.detect()).toBe(true);
    expect(await alerts.detect()).toBe(false);
    const row = await db.client.adminSecurityAlert.findFirstOrThrow();
    expect(row).toMatchObject({
      rule: 'LOGIN_FAILURES',
      threshold: 5,
      severity: 'WARNING',
    });
    const delivery =
      await db.client.adminSecurityAlertDelivery.findFirstOrThrow();
    await db.client.adminSecurityAlertDelivery.update({
      where: { id: delivery.id },
      data: {
        state: 'SENDING',
        attempts: 1,
        leaseUntil: new Date(0),
        nextAt: new Date(0),
      },
    });
    expect(await alerts.consume()).toBe(true);
    expect(
      (
        await db.client.adminSecurityAlertDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        })
      ).state,
    ).toBe('SENT');
    const recipient = await db.client.adminUser.findUniqueOrThrow({
      where: { id: delivery.adminUserId },
    });
    const notice = app
      .get(IdentityMailService)
      .latestForTest(recipient.email, 'administrative');
    expect(notice?.message).toContain('authentication failures');
    expect(JSON.stringify(notice)).not.toMatch(
      /password|token|backupCode|totpURI/,
    );
  });
  it('requires preview confirmation and a second operator before publishing audit retention', async () => {
    const retention = app.get(AdminAuditRetention);
    const input = {
      category: 'CONTROL',
      days: 731,
      revision: 1,
      reason: 'Reviewed retention category policy',
    };
    const row = (await retention.mutate(
      await cmd(first, 'admin.privacy.retention.preview', input),
      'preview',
      undefined,
      input,
    )) as { id: string; eligibleRecords: number };
    await expect(
      retention.mutate(
        await cmd(first, 'admin.privacy.retention.approve', {}),
        'approve',
        row.id,
        { reason: 'Self approval', eligibleRecords: row.eligibleRecords },
      ),
    ).rejects.toThrow('Forbidden');
    await expect(
      retention.mutate(
        await cmd(second, 'admin.privacy.retention.approve', {}),
        'approve',
        row.id,
        {
          reason: 'Wrong impact count',
          eligibleRecords: row.eligibleRecords + 1,
        },
      ),
    ).rejects.toThrow('Conflict');
    await retention.mutate(
      await cmd(second, 'admin.privacy.retention.approve', {}),
      'approve',
      row.id,
      {
        reason: 'Independent retention review',
        eligibleRecords: row.eligibleRecords,
      },
    );
    await retention.mutate(
      await cmd(first, 'admin.privacy.retention.publish', {}),
      'apply',
      row.id,
      {},
    );
    expect(
      (await retention.policies()).items.find((p) => p.category === 'CONTROL'),
    ).toMatchObject({ days: 731, revision: 2 });
    await expect(
      db.client.adminAuditRetentionPolicy.update({
        where: { category: 'CONTROL' },
        data: { days: 729 },
      }),
    ).rejects.toThrow();
  });
  it('bounds controlled expiry and preserves recent audit evidence', async () => {
    const retention = app.get(AdminAuditRetention),
      old = new Date('2010-01-01T00:00:00Z');
    await db.client.adminAuditEvent.createMany({
      data: Array.from({ length: 101 }, () => ({
        action: 'OLD_CONTROL_FIXTURE',
        requestId: randomUUID(),
        outcome: 'SUCCEEDED' as const,
        createdAt: old,
      })),
    });
    expect(
      await db.client
        .$queryRaw`SELECT admin_expire_audit_evidence('CONTROL',NULL::integer) AS deleted`,
    ).toEqual([{ deleted: null }]);
    const input = {
      category: 'CONTROL',
      limit: 100,
      reason: 'Expire only records beyond the approved policy',
    };
    const command = await cmd(first, 'admin.privacy.retention.expire', input);
    expect(await retention.mutate(command, 'expire', undefined, input)).toEqual(
      { deleted: 100 },
    );
    expect(await retention.mutate(command, 'expire', undefined, input)).toEqual(
      { deleted: 100 },
    );
    expect(
      await db.client.adminAuditEvidence.count({
        where: { action: 'OLD_CONTROL_FIXTURE' },
      }),
    ).toBe(1);
    expect(
      await db.client.adminAuditEvent.count({
        where: { action: 'OLD_CONTROL_FIXTURE' },
      }),
    ).toBe(1);
    expect(
      await db.client.adminAuditEvidence.count({
        where: { category: 'CONTROL', createdAt: { gt: old } },
      }),
    ).toBeGreaterThan(0);
  });
  it('rejects applying a retention preview after its impact changes', async () => {
    const retention = app.get(AdminAuditRetention),
      input = {
        category: 'PRIVACY',
        days: 730,
        revision: 1,
        reason: 'Confirm precise retention impact',
      };
    const row = (await retention.mutate(
      await cmd(first, 'admin.privacy.retention.preview', input),
      'preview',
      undefined,
      input,
    )) as { id: string; eligibleRecords: number };
    await retention.mutate(
      await cmd(second, 'admin.privacy.retention.approve', {}),
      'approve',
      row.id,
      {
        reason: 'Reviewed original impact',
        eligibleRecords: row.eligibleRecords,
      },
    );
    await db.client.adminAuditEvent.create({
      data: {
        action: 'ACCOUNT_DELETION_OLD_FIXTURE',
        requestId: randomUUID(),
        outcome: 'SUCCEEDED',
        createdAt: new Date('2010-01-01T00:00:00Z'),
      },
    });
    await expect(
      retention.mutate(
        await cmd(first, 'admin.privacy.retention.publish', {}),
        'apply',
        row.id,
        {},
      ),
    ).rejects.toThrow('Conflict');
    expect(
      (await retention.policies()).items.find((p) => p.category === 'PRIVACY')!
        .revision,
    ).toBe(1);
  });
  it('requires reviewed deletion impact, closes only the target account and preserves recovery data', async () => {
    const subject = await personalSubject(),
      other = await personalSubject(),
      privacy = app.get(AdminPrivacyService);
    const input = {
      kind: 'ACCOUNT',
      targetId: subject.userId,
      revision: 1,
      recoveryDays: 30,
      retentionAcknowledged: true,
      reason: 'Approved account deletion request with recovery',
    };
    const row = (await privacy.mutate(
      await cmd(first, 'admin.privacy.deletions.request', input),
      'request',
      undefined,
      input,
    )) as { id: string; impactFingerprint: string };
    const approval = {
      targetId: subject.userId,
      recoveryDays: 30,
      impactFingerprint: row.impactFingerprint,
      reason: 'Independent confirmation of exact target and recovery',
    };
    await expect(
      privacy.mutate(
        await cmd(first, 'admin.privacy.deletions.approve', {}),
        'approve',
        row.id,
        approval,
      ),
    ).rejects.toThrow('Forbidden');
    await expect(
      privacy.mutate(
        await cmd(second, 'admin.privacy.deletions.approve', {}),
        'approve',
        row.id,
        { ...approval, impactFingerprint: '0'.repeat(64) },
      ),
    ).rejects.toThrow('Conflict');
    await privacy.mutate(
      await cmd(second, 'admin.privacy.deletions.approve', approval),
      'approve',
      row.id,
      approval,
    );
    const execute = await cmd(first, 'admin.privacy.deletions.execute', {
      id: row.id,
    });
    const result = (await privacy.mutate(execute, 'execute', row.id, {})) as {
      resultJobId: string;
    };
    expect(await privacy.mutate(execute, 'execute', row.id, {})).toEqual(
      result,
    );
    const job = await db.client.accountDeletionJob.findUniqueOrThrow({
      where: { id: result.resultJobId },
    });
    expect(job.state).toBe('WAITING');
    expect(job.initiatedByAdminId).toBe(first.id);
    expect(+job.eraseAfter! - +job.confirmedAt!).toBe(30 * 86400000);
    expect(
      await db.client.authSession.findUnique({
        where: { id: subject.sessionId },
      }),
    ).toBeNull();
    expect(
      await db.client.authSession.findUnique({
        where: { id: other.sessionId },
      }),
    ).not.toBeNull();
    expect(
      (
        await db.client.note.findUniqueOrThrow({
          where: { id: subject.noteId },
        })
      ).content,
    ).toContain('must remain');
    expect(
      (
        await db.client.space.findUniqueOrThrow({
          where: { id: subject.spaceId },
        })
      ).accessClosedAt,
    ).not.toBeNull();
    expect(
      (
        await db.client.space.findUniqueOrThrow({
          where: { id: other.spaceId },
        })
      ).accessClosedAt,
    ).toBeNull();
    while (await app.get(AdminDeliveryService).consume()) {
      /* drain this fixture's due deliveries */
    }
    const notice = app
      .get(IdentityMailService)
      .latestForTest(subject.email, 'administrative');
    const proof = new URLSearchParams(new URL(notice!.url).hash.slice(1)).get(
      'recoveryCapability',
    );
    expect(proof).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain(proof!);
    expect((await privacy.detail(row.id)).job?.state).toBe('WAITING');
    const lifecycle = app.get(PersonalLifecycle);
    // Restore an inconsistent earlier deadline in this disposable fixture.
    // Replay must use the independently signed 30-day decision, even when a
    // stale queue entry would otherwise be due.
    await db.client.accountDeletionJob.update({
      where: { id: job.id },
      data: { eraseAfter: new Date(0), nextAt: new Date(0) },
    });
    expect(await lifecycle.verifyControl()).toBe(false);
    expect(await lifecycle.restoreReplay()).toBe(true);
    const restored = await db.client.accountDeletionJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(restored.eraseAfter).toEqual(job.eraseAfter);
    expect(restored.confirmedAt).toEqual(job.confirmedAt);
    expect(restored.nextAt).toEqual(job.eraseAfter);
    await lifecycle.consume();
    expect((await privacy.detail(row.id)).job?.state).toBe('WAITING');
    await expect(
      db.client.adminPrivacyDeletionRequest.update({
        where: { id: row.id },
        data: { recoveryDays: 7 },
      }),
    ).rejects.toThrow();
    await privacy.mutate(
      await cmd(second, 'admin.privacy.accounts.recover', { id: row.id }),
      'recover',
      row.id,
      {
        reason:
          'Verified administrative recovery before irreversible processing',
      },
    );
    expect((await privacy.detail(row.id)).state).toBe('RECOVERED');
    expect(
      await app.get(PersonalLifecycle).deletionNotice(job.id, subject.userId),
    ).toBeNull();
    const sent = await db.client.adminDelivery.findFirstOrThrow({
      where: { targetUserId: subject.userId, kind: 'ACCOUNT_DELETION' },
    });
    expect(sent.payload).toEqual({ jobId: job.id });
    await db.client.adminDelivery.update({
      where: { id: sent.id },
      data: { state: 'PENDING', nextAt: new Date(0) },
    });
    await app.get(AdminDeliveryService).consume();
    expect(
      (
        await db.client.adminDelivery.findUniqueOrThrow({
          where: { id: sent.id },
        })
      ).state,
    ).toBe('CANCELED');
    expect((await privacy.detail(row.id)).job?.state).toBe('CANCELED');
    expect(
      (
        await db.client.space.findUniqueOrThrow({
          where: { id: subject.spaceId },
        })
      ).accessClosedAt,
    ).toBeNull();
    expect(
      await db.client.authSession.findUnique({
        where: { id: subject.sessionId },
      }),
    ).toBeNull();
    expect(
      (await privacy.history(row.id)).items.map((h) => h.actorAdminId),
    ).toEqual([first.id, second.id, first.id, second.id]);
    expect(
      await db.client.adminSession.findUnique({
        where: { id: first.sessionId },
      }),
    ).not.toBeNull();
  });

  it('preserves independent review evidence through Admin account purge and cancels stale mail', async () => {
    const subject = await personalSubject(),
      privacy = app.get(AdminPrivacyService),
      lifecycle = app.get(PersonalLifecycle);
    const request = await reviewedDeletion('ACCOUNT', subject.userId);
    const result = (await privacy.mutate(
      await cmd(first, 'admin.privacy.deletions.execute', { id: request.id }),
      'execute',
      request.id,
      {},
    )) as { resultJobId: string };
    // Advance only the review fixture's persisted schedule, as in the ordinary erasure suite.
    await db.client.accountDeletionJob.update({
      where: { id: result.resultJobId },
      data: { eraseAfter: new Date(Date.now() - 1000), nextAt: new Date(0) },
    });
    await expect(
      privacy.mutate(
        await cmd(second, 'admin.privacy.accounts.recover', { id: request.id }),
        'recover',
        request.id,
        { reason: 'Late recovery' },
      ),
    ).rejects.toThrow('Conflict');
    for (let at = 0; at < 8; at++) {
      await lifecycle.consume();
      if ((await privacy.detail(request.id)).job?.state === 'ERASED') break;
    }
    expect((await privacy.detail(request.id)).job?.state).toBe('ERASED');
    expect(
      await db.client.user.findUnique({ where: { id: subject.userId } }),
    ).toBeNull();
    expect(
      await db.client.note.findUnique({ where: { id: subject.noteId } }),
    ).toBeNull();
    const retained =
      await db.client.adminPrivacyDeletionRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
    expect(retained).toMatchObject({
      targetUserId: null,
      targetId: subject.userId,
      requesterAdminId: first.id,
      approverAdminId: second.id,
    });
    expect(await lifecycle.verifyControl()).toBe(true);
    expect(
      await lifecycle.deletionNotice(result.resultJobId, subject.userId),
    ).toBeNull();
    expect(
      (await privacy.history(request.id)).items.map((h) => h.state),
    ).toEqual(['REQUESTED', 'APPROVED', 'APPLIED']);
  });
});
