import { SharedFiles } from '../../src/platform/storage/public/index.js';
import { setImmediate as tick } from 'node:timers/promises';
import { CompanyAssociationsService } from '../../src/modules/companies/public/index.js';
import { TeamsService } from '../../src/modules/teams/public/index.js';
import {
  CompanyLifecycleService,
  CompanyCleanupService,
} from '../../src/modules/companies/public/index.js';
import {
  SharedLifecycleService,
  CollaborationService,
} from '../../src/modules/spaces/public/index.js';
import { Readable } from 'node:stream';
import { ProjectsService } from '../../src/modules/projects/public/index.js';
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

import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { DatabaseService } from '../../src/platform/database/database.service.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import { CompanyAccess } from '../../src/modules/spaces/public/index.js';
import {
  CompaniesService,
  CompanyFinanceService,
  CompanyKnowledgeService,
  CompanyKnowledgeFilesService,
} from '../../src/modules/companies/public/index.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
type Person = { actor: RequestActor; email: string; cookie: string };
const ref = (m: { id: string; generation: number }) => ({
  accessId: m.id,
  generation: m.generation,
});
describe('P4-06 Company lifecycle and preservation', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    client: PrismaClient,
    observer: Client,
    watcher: Client;
  let life: CompanyLifecycleService, cleanup: CompanyCleanupService;
  let knowledge: CompanyKnowledgeService,
    files: CompanyKnowledgeFilesService,
    companies: CompaniesService,
    finance: CompanyFinanceService,
    access: CompanyAccess,
    control: SharedControl;
  let owner: Person,
    member: Person,
    viewer: Person,
    admin: Person,
    outsider: Person;
  const version = 'synthetic-p406-' + randomUUID(),
    name = 'p406-' + randomUUID(),
    origin = 'http://localhost:3000',
    password = 'synthetic-p406-only-123!';
  let passwordHash: string;
  async function person(cookie = false): Promise<Person> {
    const userId = randomUUID(),
      sessionId = randomUUID(),
      email = randomUUID() + '@example.test';
    await client.user.create({
      data: {
        id: userId,
        name: 'Synthetic staff fixture',
        email,
        emailVerified: true,
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
    let actual: string = sessionId,
      token = '';
    if (cookie) {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', origin)
        .send({ email, password })
        .expect(200);
      token = (login.headers['set-cookie'] as unknown as string[])
        .map((v) => v.split(';')[0])
        .join('; ');
      actual = (
        await client.authSession.findFirstOrThrow({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        })
      ).id;
    }
    return {
      email,
      cookie: token,
      actor: {
        userId,
        sessionId: actual,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
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
      throw new Error(
        'Owned staff schema migration failed (credentials withheld)',
      );
    const schema = new URL(sandbox.url).searchParams.get('schema')!,
      base = isolatedTestDatabaseUrl(process.env);
    client = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: base,
          options: '-c timezone=UTC -c search_path=' + schema,
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
    const root = fs.mkdtempSync(path.resolve('.tools/p406-fixture-'));
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
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P402-ONLY',
      },
    });
    control = app.get(SharedControl);
    await control.initialize();
    life = app.get(CompanyLifecycleService);
    cleanup = app.get(CompanyCleanupService);
    knowledge = app.get(CompanyKnowledgeService);
    files = app.get(CompanyKnowledgeFilesService);
    companies = app.get(CompaniesService);
    finance = app.get(CompanyFinanceService);
    access = app.get(CompanyAccess);
    passwordHash = await (
      await app.get(AuthService).auth.$context
    ).password.hash(password);
    observer = new Client({
      connectionString: base,
      options: '-c timezone=UTC -c search_path=' + schema,
      application_name: name + '-observer',
    });
    await observer.connect();
    watcher = new Client({ connectionString: base });
    await watcher.connect();
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
          applicableContexts: ['COMPANY', 'PROJECT', 'TEAM'],
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
    member = await person(true);
    viewer = await person(true);
    admin = await person();
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
  async function company() {
    return companies.create(
      owner.actor,
      {
        id: randomUUID(),
        title: 'Company staff fixture',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
  }
  async function admit(
    id: string,
    who = member,
    role: z.infer<typeof c.CompanyMemberRoleSchema> = 'MEMBER',
    scope = id,
    by = owner,
  ) {
    const offer = await companies.invite(
      by.actor,
      id,
      scope,
      { memberRole: role, recipient: { userId: who.actor.userId } },
      randomUUID(),
    );
    const result = await access.decide(
      who.actor,
      offer.invitation.id,
      offer.proof!,
      1,
      true,
    );
    if (!result.membership) throw new Error('Missing membership');
    return result.membership;
  }
  async function root(id: string, who = owner) {
    return client.contextAccess.findFirstOrThrow({
      where: {
        spaceId: id,
        scopeId: id,
        SharedActor: { userId: who.actor.userId },
      },
    });
  }
  async function fixture() {
    const co = await company(),
      subject = await admit(co.id),
      reviewer = await admit(co.id, admin, 'ORG_ADMIN');
    await admit(co.id, viewer, 'VIEWER');
    return { co, subject, reviewer };
  }
  async function kb() {
    const f = await fixture();
    const folder = await knowledge.folderCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), parentId: null, title: 'Published folder' },
      randomUUID(),
    );
    const doc = await knowledge.documentCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      {
        id: randomUUID(),
        folderId: folder.id,
        title: 'Public title',
        description: null,
      },
      randomUUID(),
    );
    return { ...f, folder, doc };
  }
  async function upload(
    f: Awaited<ReturnType<typeof kb>>,
    text = 'Knowledge bytes',
    by = owner,
  ) {
    const v = await knowledge.initiate(
      by.actor,
      f.co.id,
      f.co.id,
      f.doc.id,
      {
        id: randomUUID(),
        filename: 'guide.txt',
        mimeType: 'text/plain',
        expectedSize: Buffer.byteLength(text),
      },
      randomUUID(),
    );
    return files.complete(
      by.actor,
      f.co.id,
      f.co.id,
      f.doc.id,
      v.id,
      v.revision,
      Readable.from([Buffer.from(text)]),
      String(Buffer.byteLength(text)),
    );
  }
  async function published() {
    const f = await kb(),
      v = await upload(f);
    await knowledge.publish(
      owner.actor,
      f.co.id,
      f.co.id,
      f.doc.id,
      v.id,
      v.revision,
      { documentRevision: f.doc.revision },
    );
    return { ...f, v };
  }
  async function collect(stream: Readable) {
    let text = '';
    for await (const part of stream) text += String(part);
    return text;
  }

  it('allows Owner and eligible Org Admin archive/restore, preserves reads and rejects writes and stale revisions', async () => {
    const f = await published();
    const before = await client.companyKnowledgeVersion.findUniqueOrThrow({
      where: { id: f.v.id },
    });
    await life.change(admin.actor, f.co.id, 1, 'archive');
    expect((await companies.read(owner.actor, f.co.id)).state).toBe('ARCHIVED');
    expect(
      await collect(
        (await files.download(viewer.actor, f.co.id, f.co.id, f.doc.id, f.v.id))
          .stream,
      ),
    ).toBe('Knowledge bytes');
    await expect(
      knowledge.documentPatch(owner.actor, f.co.id, f.co.id, f.doc.id, 2, {
        title: 'denied',
      }),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      life.change(admin.actor, f.co.id, 1, 'restore'),
    ).rejects.toHaveProperty('status', 409);
    await life.change(admin.actor, f.co.id, 2, 'restore');
    expect(
      await client.companyKnowledgeVersion.findUniqueOrThrow({
        where: { id: f.v.id },
      }),
    ).toEqual(before);
    await expect(
      life.change(outsider.actor, f.co.id, 3, 'archive'),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      life.change(member.actor, f.co.id, 3, 'archive'),
    ).rejects.toHaveProperty('status', 403);
  });
  it('keeps lifecycle powers at the Company root and forbids Org Admin handover or dissolution', async () => {
    const f = await fixture();
    await expect(
      life.handover(
        admin.actor,
        f.co.id,
        { successorAccessId: f.subject.id },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      life.change(admin.actor, f.co.id, 1, 'delete', password),
    ).rejects.toHaveProperty('status', 403);
    await expect(
      life.change(owner.actor, f.co.id, 1, 'delete', password),
    ).rejects.toHaveProperty('status', 409);
    const wrong = await app.get(ProjectsService).create(
      owner.actor,
      {
        id: randomUUID(),
        title: 'Independent',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    await expect(
      life.change(owner.actor, wrong.id, 1, 'archive'),
    ).rejects.toHaveProperty('status', 404);
  });
  it('requires named successor acceptance and fresh provider password without granting child or confidential audiences', async () => {
    const f = await fixture();
    const dept = await companies.createContext(
      owner.actor,
      f.co.id,
      null,
      { id: randomUUID(), title: 'Private department' },
      randomUUID(),
    );
    const offer = await life.handover(
      owner.actor,
      f.co.id,
      { successorAccessId: f.subject.id },
      randomUUID(),
    );
    await expect(
      life.decide(
        viewer.actor,
        f.co.id,
        offer.id,
        offer.revision,
        'accept',
        password,
      ),
    ).rejects.toHaveProperty('status', 404);
    await life.decide(
      member.actor,
      f.co.id,
      offer.id,
      offer.revision,
      'accept',
      password,
    );
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: f.co.id },
        })
      ).primaryOwnerAccessId,
    ).toBe(f.subject.id);
    await expect(
      knowledge.folders(member.actor, f.co.id, dept.id, { limit: 10 }),
    ).rejects.toHaveProperty('status', 404);
    expect(
      await client.companyKnowledgeDocument.count({
        where: { spaceId: f.co.id },
      }),
    ).toBe(0);
  });
  it('recovers only within the original generation and does not revive old child admissions, invitations or proofs', async () => {
    const co = await company();
    const dept = await companies.createContext(
      owner.actor,
      co.id,
      null,
      { id: randomUUID(), title: 'Child' },
      randomUUID(),
    );
    const helper = await admit(co.id, admin, 'ORG_ADMIN');
    await admit(co.id, owner, 'MEMBER', dept.id, admin);
    await companies.leave(admin.actor, co.id, co.id, helper.revision);
    const pending = await companies.invite(
      owner.actor,
      co.id,
      co.id,
      { memberRole: 'MEMBER', recipient: { userId: member.actor.userId } },
      randomUUID(),
    );
    await life.change(owner.actor, co.id, 1, 'delete', password);
    const job = await life.job(owner.actor, co.id);
    expect(
      Date.parse(job.recoveryDeadline) -
        (
          await client.sharedLifecycleJob.findUniqueOrThrow({
            where: { id: job.jobId },
          })
        ).effectiveDepartureAt.getTime(),
    ).toBe(2592000000);
    await expect(
      life.proof(outsider.actor, co.id, job.revision, password),
    ).rejects.toHaveProperty('status', 404);
    const proof = await life.proof(owner.actor, co.id, job.revision, password);
    await life.recover(
      owner.actor,
      co.id,
      proof.revision,
      proof.generation,
      proof.proof,
      password,
    );
    expect((await root(co.id)).generation).toBe(2);
    await expect(
      knowledge.folders(owner.actor, co.id, dept.id, { limit: 10 }),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      access.decide(
        member.actor,
        pending.invitation.id,
        pending.proof!,
        1,
        true,
      ),
    ).rejects.toHaveProperty('status', 404);
    await expect(
      life.recover(
        owner.actor,
        co.id,
        proof.revision,
        proof.generation,
        proof.proof,
        password,
      ),
    ).rejects.toHaveProperty('status', 409);
  });
  async function expireClosure(id: string) {
    await client.sharedLifecycleJob.updateMany({
      where: { spaceId: id },
      data: {
        effectiveDepartureAt: new Date(Date.now() - 31 * 86400000),
        recoveryDeadline: new Date(Date.now() - 86400000),
        nextAt: new Date(0),
      },
    });
  }
  it('disposes only Company-owned knowledge and financial history after the deadline, retaining independent Project and Personal records', async () => {
    const co = await company();
    const folder = await knowledge.folderCreate(
      owner.actor,
      co.id,
      co.id,
      { id: randomUUID(), parentId: null, title: 'Root knowledge' },
      randomUUID(),
    );
    const doc = await knowledge.documentCreate(
      owner.actor,
      co.id,
      co.id,
      {
        id: randomUUID(),
        folderId: folder.id,
        title: 'Retained until disposal',
        description: null,
      },
      randomUUID(),
    );
    const f = { co, folder, doc } as Awaited<ReturnType<typeof kb>>;
    const v = await upload(f);
    await knowledge.publish(
      owner.actor,
      co.id,
      co.id,
      doc.id,
      v.id,
      v.revision,
      { documentRevision: doc.revision },
    );

    const reviewer = await admit(co.id, admin, 'ORG_ADMIN');
    const category = await finance.categoryCreate(
      owner.actor,
      co.id,
      co.id,
      { id: randomUUID(), title: 'Retained finance' },
      randomUUID(),
    );
    const expense = await finance.expenseCreate(
      owner.actor,
      co.id,
      co.id,
      {
        id: randomUUID(),
        amount: '0.10',
        currency: 'USD',
        categoryId: category.id,
        occurredDate: '2026-11-07',
        timezone: 'UTC',
        vendor: null,
        payer: null,
        projectReferenceId: null,
        allocations: [],
      },
      randomUUID(),
    );
    const submitted = await finance.submit(
      owner.actor,
      co.id,
      co.id,
      expense.id,
      expense.revision,
      { reviewer: ref(reviewer) },
    );
    await finance.decide(
      admin.actor,
      co.id,
      co.id,
      expense.id,
      submitted.revision,
      { decision: 'APPROVE' },
    );
    await companies.leave(admin.actor, co.id, co.id, reviewer.revision);
    const project = await app.get(ProjectsService).create(
      owner.actor,
      {
        id: randomUUID(),
        title: 'Independent preserved',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    const personal = await client.space.findFirstOrThrow({
      where: { ownerUserId: owner.actor.userId, kind: 'PERSONAL' },
    });
    await life.change(owner.actor, co.id, 1, 'delete', password);
    expect(await cleanup.consume()).toBe(false);
    await expect(
      client.companyKnowledgeVersion.delete({ where: { id: v.id } }),
    ).rejects.toThrow();
    await expireClosure(co.id);
    for (
      let i = 0;
      i < 80 &&
      (await client.sharedCustody.findUnique({ where: { spaceId: co.id } }));
      i++
    )
      await cleanup.consume();
    const job = await client.sharedLifecycleJob.findFirstOrThrow({
      where: { custodyId: co.id },
      orderBy: { generation: 'desc' },
    });
    expect(job.progress).toMatchObject({ stage: 'DELETED' });
    expect(
      await client.company.findUnique({ where: { id: co.id } }),
    ).toBeNull();
    expect(
      (await app.get(ProjectsService).read(owner.actor, project.id)).id,
    ).toBe(project.id);
    expect(
      await client.space.findUnique({ where: { id: personal.id } }),
    ).not.toBeNull();
  });
  it('rejects stale concurrent archive requests and preserves the authoritative winner', async () => {
    const co = await company();
    const results = await Promise.allSettled([
      life.change(owner.actor, co.id, 1, 'archive'),
      life.change(owner.actor, co.id, 1, 'archive'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await companies.read(owner.actor, co.id)).revision).toBe(2);
  });

  async function affiliation(kind: 'PROJECT' | 'TEAM' = 'PROJECT') {
    const co = await company();
    const dept = await companies.createContext(
      owner.actor,
      co.id,
      null,
      { id: randomUUID(), title: 'Explicit destination' },
      randomUUID(),
    );
    await admit(co.id, admin, 'ORG_ADMIN');
    await admit(co.id, owner, 'MEMBER', dept.id, admin);
    await admit(co.id, member, 'MEMBER');
    await admit(co.id, member, 'MEMBER', dept.id);
    const source =
      kind === 'PROJECT'
        ? await app.get(ProjectsService).create(
            member.actor,
            {
              id: randomUUID(),
              title: 'Independent source',
              retentionPolicyVersion: version,
            },
            randomUUID(),
          )
        : await app.get(TeamsService).create(
            member.actor,
            {
              id: randomUUID(),
              title: 'Independent source',
              retentionPolicyVersion: version,
            },
            randomUUID(),
          );
    const input = { id: randomUUID(), kind, sourceId: source.id },
      key = randomUUID(),
      service = app.get(CompanyAssociationsService);
    const proposal = await service.create(
      member.actor,
      co.id,
      dept.id,
      input,
      key,
    );
    return { co, dept, source, input, key, service, proposal };
  }
  it('requires bilateral association and separate bilateral attachment without custody, membership or historical access inheritance', async () => {
    const f = await affiliation();
    expect(
      (await f.service.create(member.actor, f.co.id, f.dept.id, f.input, f.key))
        .id,
    ).toBe(f.proposal.id);
    await expect(
      f.service.change(
        member.actor,
        f.co.id,
        f.dept.id,
        'PROJECT',
        f.proposal.id,
        1,
        'accept',
      ),
    ).rejects.toHaveProperty('status', 403);
    const accepted = await f.service.change(
      owner.actor,
      f.co.id,
      f.dept.id,
      'PROJECT',
      f.proposal.id,
      1,
      'accept',
    );
    expect(accepted.state).toBe('ASSOCIATED');
    expect(
      (
        await f.service.list(
          member.actor,
          f.co.id,
          f.dept.id,
          { limit: 25 },
          true,
        )
      ).items,
    ).toHaveLength(0);
    const pending = await f.service.change(
      member.actor,
      f.co.id,
      f.dept.id,
      'PROJECT',
      f.proposal.id,
      accepted.revision,
      'request-attachment',
    );
    const attached = await f.service.change(
      owner.actor,
      f.co.id,
      f.dept.id,
      'PROJECT',
      f.proposal.id,
      pending.revision,
      'accept-attachment',
    );
    expect(attached.state).toBe('ATTACHED');
    expect(
      (
        await f.service.list(
          owner.actor,
          f.co.id,
          f.dept.id,
          { limit: 25 },
          true,
        )
      ).items,
    ).toEqual([]);
    expect(
      (
        await f.service.list(
          member.actor,
          f.co.id,
          f.dept.id,
          { limit: 25 },
          true,
        )
      ).items.map((r) => r.sourceId),
    ).toEqual([f.source.id]);
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: f.source.id },
        })
      ).kind,
    ).toBe('PROJECT');
    await expect(
      app.get(ProjectsService).read(owner.actor, f.source.id),
    ).rejects.toHaveProperty('status', 404);
    expect(
      await client.contextAccess.count({ where: { spaceId: f.source.id } }),
    ).toBe(1);
    const detached = await f.service.change(
      owner.actor,
      f.co.id,
      f.dept.id,
      'PROJECT',
      f.proposal.id,
      attached.revision,
      'detach',
      'COMPANY',
    );
    expect(detached.state).toBe('ASSOCIATED');
    expect(
      (
        await f.service.list(
          member.actor,
          f.co.id,
          f.dept.id,
          { limit: 25 },
          true,
        )
      ).items,
    ).toEqual([]);
    expect(
      (await f.service.list(member.actor, f.co.id, f.dept.id, { limit: 25 }))
        .items,
    ).toHaveLength(1);
  });
  it.each(['PROJECT', 'TEAM'] as const)(
    'preserves %s members outside Company through attachment and exposes no executable custody transfer',
    async (kind) => {
      const f = await affiliation(kind),
        collaboration = app.get(CollaborationService);
      const invitation = await collaboration.createInvitation(
        member.actor,
        f.source.id,
        {
          kind: 'MEMBERSHIP',
          memberRole: 'VIEWER',
          recipient: { userId: outsider.actor.userId },
        },
        randomUUID(),
      );
      await collaboration.decideInvitation(
        outsider.actor,
        invitation.invitation.id,
        invitation.proof!,
        1,
        true,
        kind,
      );
      const memberships = () =>
        client.contextAccess.findMany({
          where: { spaceId: f.source.id },
          orderBy: { id: 'asc' },
        });
      const before = await memberships();
      await f.service.change(
        owner.actor,
        f.co.id,
        f.dept.id,
        kind,
        f.proposal.id,
        1,
        'accept',
      );
      await f.service.change(
        member.actor,
        f.co.id,
        f.dept.id,
        kind,
        f.proposal.id,
        2,
        'request-attachment',
      );
      await f.service.change(
        owner.actor,
        f.co.id,
        f.dept.id,
        kind,
        f.proposal.id,
        3,
        'accept-attachment',
      );
      expect(await memberships()).toEqual(before);
      expect(
        await client.contextAccess.count({
          where: {
            spaceId: f.co.id,
            SharedActor: { userId: outsider.actor.userId },
          },
        }),
      ).toBe(0);
      const source =
        kind === 'PROJECT' ? app.get(ProjectsService) : app.get(TeamsService);
      expect(
        (await source.read(outsider.actor, f.source.id)).association,
      ).toEqual({ kind: 'INDEPENDENT' });
      await expect(
        source.read(owner.actor, f.source.id),
      ).rejects.toHaveProperty('status', 404);
      for (const suffix of [
        'custody-transfers',
        'custody-transfers/preview',
        'custody-transfers/consents',
        'custody-transfers/apply',
      ]) {
        await request(app.getHttpServer())
          .post('/api/v1/companies/' + f.co.id + '/' + suffix)
          .set('Cookie', owner.cookie)
          .set('Origin', origin)
          .send({ sourceId: f.source.id, kind })
          .expect(404);
      }
      await expect(
        observer.query(
          'UPDATE "' +
            (kind === 'PROJECT' ? 'Project' : 'Team') +
            '" SET "spaceId"=$2 WHERE id=$1',
          [f.source.id, f.co.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      expect(
        await client.domainScopeCustody.count({
          where: { scopeId: f.source.id },
        }),
      ).toBe(0);
      expect(
        await client.companyCustodyTransfer.count({
          where: { sourceCustodyId: f.source.id },
        }),
      ).toBe(0);
      expect(await memberships()).toEqual(before);
      expect((await source.read(outsider.actor, f.source.id)).spaceId).toBe(
        f.source.id,
      );
    },
  );
  it('enforces one active Company association in both application and PostgreSQL and rejects wrong contexts', async () => {
    const f = await affiliation();
    await expect(
      f.service.create(
        member.actor,
        f.co.id,
        f.dept.id,
        { ...f.input, id: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 409);
    await expect(
      f.service.create(
        member.actor,
        f.co.id,
        f.co.id,
        { ...f.input, id: randomUUID() },
        randomUUID(),
      ),
    ).rejects.toHaveProperty('status', 404);
    const row = await client.projectCompanyAssociation.findUniqueOrThrow({
      where: { id: f.proposal.id },
    });
    await expect(
      client.projectCompanyAssociation.create({
        data: { ...row, id: randomUUID() },
      }),
    ).rejects.toThrow();
    await expect(
      client.projectCompanyAssociation.update({
        where: { id: row.id },
        data: { companySpaceId: randomUUID(), revision: 2 },
      }),
    ).rejects.toThrow();
  });
  it('permits independent source revocation after Company departure and never revives the old receipt', async () => {
    const f = await affiliation('TEAM');
    await f.service.change(
      owner.actor,
      f.co.id,
      f.dept.id,
      'TEAM',
      f.proposal.id,
      1,
      'accept',
    );
    const seat = await root(f.co.id, member);
    await companies.leave(member.actor, f.co.id, f.co.id, seat.revision);
    expect(
      (await f.service.list(owner.actor, f.co.id, f.dept.id, { limit: 25 }))
        .items,
    ).toEqual([]);
    await expect(
      f.service.create(member.actor, f.co.id, f.dept.id, f.input, f.key),
    ).rejects.toHaveProperty('status', 404);
    expect(
      (
        await f.service.change(
          member.actor,
          f.co.id,
          f.dept.id,
          'TEAM',
          f.proposal.id,
          2,
          'revoke',
          'SOURCE',
        )
      ).state,
    ).toBe('REVOKED');
    expect(
      await client.team.findUnique({ where: { id: f.source.id } }),
    ).not.toBeNull();
  });
  it('invalidates association approvals across archive/restore and requires fresh bilateral approval', async () => {
    const f = await affiliation();
    await f.service.change(
      owner.actor,
      f.co.id,
      f.dept.id,
      'PROJECT',
      f.proposal.id,
      1,
      'accept',
    );
    await life.change(owner.actor, f.co.id, 1, 'archive');
    await life.change(owner.actor, f.co.id, 2, 'restore');
    expect(
      (await f.service.list(owner.actor, f.co.id, f.dept.id, { limit: 25 }))
        .items,
    ).toEqual([]);
    await expect(
      f.service.change(
        member.actor,
        f.co.id,
        f.dept.id,
        'PROJECT',
        f.proposal.id,
        2,
        'request-attachment',
      ),
    ).rejects.toHaveProperty('status', 409);
    await f.service.change(
      owner.actor,
      f.co.id,
      f.dept.id,
      'PROJECT',
      f.proposal.id,
      2,
      'revoke',
      'COMPANY',
    );
    const fresh = await f.service.create(
      member.actor,
      f.co.id,
      f.dept.id,
      { ...f.input, id: randomUUID() },
      randomUUID(),
    );
    expect(fresh.state).toBe('PENDING');
  });
  it('serializes competing Company association acceptances with one revision winner', async () => {
    const f = await affiliation();
    const results = await Promise.allSettled([
      f.service.change(
        owner.actor,
        f.co.id,
        f.dept.id,
        'PROJECT',
        f.proposal.id,
        1,
        'accept',
      ),
      f.service.change(
        owner.actor,
        f.co.id,
        f.dept.id,
        'PROJECT',
        f.proposal.id,
        1,
        'accept',
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (
        await client.projectCompanyAssociation.findUniqueOrThrow({
          where: { id: f.proposal.id },
        })
      ).revision,
    ).toBe(2);
  });

  it('keeps Company disposal waiting on captured holds and resumes only after an audited operator release', async () => {
    const original = await client.sharedRetentionPolicy.findUniqueOrThrow({
        where: { version },
      }),
      held = 'held-' + randomUUID(),
      holdId = randomUUID();
    await client.sharedRetentionPolicy.create({
      data: {
        version: held,
        approvalReference: original.approvalReference,
        configuration: {
          ...(original.configuration as Record<string, unknown>),
          policyVersion: held,
          holds: [
            {
              id: holdId,
              state: 'ACTIVE',
              nextReviewAt: new Date(Date.now() + 86400000).toISOString(),
              basis: 'synthetic',
              authority: 'synthetic operator',
              scope: 'Company fixture',
              releaseEvidence: null,
            },
          ],
        },
      },
    });
    const co = await companies.create(
      owner.actor,
      { id: randomUUID(), title: 'Held Company', retentionPolicyVersion: held },
      randomUUID(),
    );
    await life.change(owner.actor, co.id, 1, 'delete', password);
    await expireClosure(co.id);
    await cleanup.consume();
    await cleanup.consume();
    const job = await life.job(owner.actor, co.id);
    expect(job.state).toBe('WAITING_OBLIGATIONS');
    await expect(companies.read(owner.actor, co.id)).rejects.toHaveProperty(
      'status',
      404,
    );
    expect(
      await client.company.findUnique({ where: { id: co.id } }),
    ).not.toBeNull();
    await app
      .get(SharedLifecycleService)
      .release(
        co.id,
        job.jobId,
        job.revision,
        holdId,
        'SYNTHETIC-OPERATOR-RELEASE',
      );
    for (
      let i = 0;
      i < 50 &&
      (await client.sharedCustody.findUnique({ where: { spaceId: co.id } }));
      i++
    )
      await cleanup.consume();
    expect(
      await client.company.findUnique({ where: { id: co.id } }),
    ).toBeNull();
  });
  it('blocks unknown Company cleanup references before disposal effects', async () => {
    const co = await company();
    await life.change(owner.actor, co.id, 1, 'delete', password);
    await expireClosure(co.id);
    await observer.query(
      'CREATE TABLE "SyntheticUnknownCompanyReference" (id uuid PRIMARY KEY,"companyId" uuid NOT NULL REFERENCES "Company"(id))',
    );
    try {
      await cleanup.consume();
      await cleanup.consume();
      const job = await life.job(owner.actor, co.id);
      expect(job.failureCode).toBe('CLEANUP_RETRY_REQUIRED');
      expect(
        await client.company.findUnique({ where: { id: co.id } }),
      ).not.toBeNull();
    } finally {
      await observer.query('DROP TABLE "SyntheticUnknownCompanyReference"');
    }
    await client.sharedLifecycleJob.updateMany({
      where: { spaceId: co.id },
      data: { nextAt: new Date(0) },
    });
    for (
      let i = 0;
      i < 50 &&
      (await client.sharedCustody.findUnique({ where: { spaceId: co.id } }));
      i++
    )
      await cleanup.consume();
    expect(
      await client.company.findUnique({ where: { id: co.id } }),
    ).toBeNull();
  });
  async function waiters(minimum: number) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const r = await watcher.query<{ n: number }>(
        'SELECT count(DISTINCT a.pid)::int n FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name=$1 AND cardinality(pg_blocking_pids(a.pid))>0 AND NOT l.granted',
        [name],
      );
      if (r.rows[0]!.n >= minimum) return;
      await tick();
    }
    throw new Error('Expected independent PostgreSQL lock waiters');
  }
  it('observes winning membership revocation before a waiting Company association approval, with no late approval effect', async () => {
    const f = await affiliation(),
      seat = await root(f.co.id, member);
    await observer.query('BEGIN');
    await observer.query(
      'SELECT 1 FROM "SharedCustody" WHERE "spaceId"=$1 FOR UPDATE',
      [f.co.id],
    );
    const revoke = companies.changeMember(
      owner.actor,
      f.co.id,
      f.co.id,
      seat.id,
      seat.revision,
      { state: 'REVOKED', memberRole: 'MEMBER' },
    );
    const handledRevoke = revoke.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    let approval: Promise<{ ok: boolean; error?: unknown }> | undefined;
    try {
      await waiters(1);
      approval = f.service
        .change(
          owner.actor,
          f.co.id,
          f.dept.id,
          'PROJECT',
          f.proposal.id,
          1,
          'accept',
        )
        .then(
          () => ({ ok: true }),
          (error) => ({ ok: false, error }),
        );
      await waiters(2);
    } finally {
      await observer.query('COMMIT');
    }
    expect(await handledRevoke).toHaveProperty('value');
    expect(await approval!).toMatchObject({ ok: false });
    expect(
      (
        await client.projectCompanyAssociation.findUniqueOrThrow({
          where: { id: f.proposal.id },
        })
      ).state,
    ).toBe('PENDING');
    expect(
      await client.sharedAuditEvent.count({
        where: {
          spaceId: f.co.id,
          action: 'company.association.accept',
          resourceId: f.proposal.id,
        },
      }),
    ).toBe(0);
  });
  it('preserves independent Team/Project and cross-Team references when the associated Company is disposed', async () => {
    const f = await affiliation('TEAM');
    const project = await app.get(ProjectsService).create(
      member.actor,
      {
        id: randomUUID(),
        title: 'Referenced independent Project',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    await app
      .get(TeamsService)
      .reference(member.actor, f.source.id, project.id, undefined, true);
    await f.service.change(
      owner.actor,
      f.co.id,
      f.dept.id,
      'TEAM',
      f.proposal.id,
      1,
      'accept',
    );
    for (const who of [member, admin]) {
      const seat = await root(f.co.id, who);
      await companies.leave(who.actor, f.co.id, f.co.id, seat.revision);
    }
    await life.change(owner.actor, f.co.id, 1, 'delete', password);
    await expireClosure(f.co.id);
    for (
      let i = 0;
      i < 80 &&
      (await client.sharedCustody.findUnique({ where: { spaceId: f.co.id } }));
      i++
    )
      await cleanup.consume();
    expect(
      await client.company.findUnique({ where: { id: f.co.id } }),
    ).toBeNull();
    expect(
      (await app.get(ProjectsService).read(member.actor, project.id)).id,
    ).toBe(project.id);
    expect(
      (await app.get(TeamsService).read(member.actor, f.source.id)).id,
    ).toBe(f.source.id);
    expect(
      await client.teamProjectReference.count({
        where: { teamId: f.source.id, projectId: project.id },
      }),
    ).toBe(1);
  });
  it('rejects historical actor forgeries without typed applied provenance', async () => {
    const co = await company();
    const id = randomUUID();
    await expect(
      observer.query(
        'INSERT INTO "SharedActor"(id,"spaceId",state,"originCustodyId") VALUES($1,$2,\'HISTORICAL\',$3)',
        [id, co.id, randomUUID()],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      message:
        'Historical attribution requires typed non-authorizing provenance',
    });
    expect(await client.sharedActor.findUnique({ where: { id } })).toBeNull();
    expect(
      (
        await client.sharedCustody.findUniqueOrThrow({
          where: { spaceId: co.id },
        })
      ).state,
    ).toBe('ACTIVE');
  });
  it('rejects forged domain cleanup jobs and prevents retyping a Company-root lifecycle job', async () => {
    const co = await company();
    const source = await app.get(ProjectsService).create(
      owner.actor,
      {
        id: randomUUID(),
        title: 'Independent source for lifecycle fencing',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    await expect(
      observer.query(
        `WITH instant AS (SELECT clock_timestamp() now) INSERT INTO "SharedLifecycleJob"(id,"custodyId","spaceId","scopeId",generation,state,"effectiveDepartureAt","recoveryDeadline","retentionPolicyVersion","nextAt") SELECT $1,$2,$3,$2,1,'CLOSING_GRACE',now,now+interval '720 hours',$4,now FROM instant`,
        [randomUUID(), source.id, co.id, version],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      message:
        'Domain lifecycle requires its applied custody and captured policy',
    });
    expect(
      await client.sharedLifecycleJob.count({ where: { spaceId: co.id } }),
    ).toBe(0);
    await life.change(owner.actor, co.id, 1, 'delete', password);
    const job = await client.sharedLifecycleJob.findFirstOrThrow({
      where: { spaceId: co.id },
    });
    expect(job.scopeId).toBeNull();
    await expect(
      observer.query(
        'UPDATE "SharedLifecycleJob" SET "scopeId"=$2,"custodyId"=$2 WHERE id=$1',
        [job.id, source.id],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      message: 'Immutable lifecycle scope identity',
    });
    expect(
      (
        await client.sharedLifecycleJob.findUniqueOrThrow({
          where: { id: job.id },
        })
      ).custodyId,
    ).toBe(co.id);
    expect(
      (await app.get(ProjectsService).read(owner.actor, source.id)).spaceId,
    ).toBe(source.id);
  });
  it('keeps unresolved custody evidence behind a disposal fence before any file pass', async () => {
    const co = await company();
    const dept = await companies.createContext(
      owner.actor,
      co.id,
      null,
      { id: randomUUID(), title: 'Custody destination' },
      randomUUID(),
    );
    const source = await app.get(ProjectsService).create(
      owner.actor,
      {
        id: randomUUID(),
        title: 'Preserved source',
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    const sourceOwner = await root(source.id),
      companyOwner = await root(co.id);
    const sourceCustody = await client.sharedCustody.findUniqueOrThrow({
      where: { spaceId: source.id },
    });
    const companyCustody = await client.sharedCustody.findUniqueOrThrow({
      where: { spaceId: co.id },
    });
    const id = randomUUID(),
      now = new Date();
    const manifest = { synthetic: 'sealed pending evidence' };
    const manifestHash = (
      await client.$queryRaw<
        { digest: string }[]
      >`SELECT encode(sha256(convert_to(${JSON.stringify(manifest)}::jsonb::text,'UTF8')),'hex') digest`
    )[0]!.digest;
    await client.companyCustodyTransfer.create({
      data: {
        id,
        sourceCustodyId: source.id,
        sourceProjectId: source.id,
        sourceTeamId: null,
        companyId: co.id,
        parentScopeId: dept.id,
        sourceOwnerAccessId: sourceOwner.id,
        sourceOwnerGeneration: sourceOwner.generation,
        companyOwnerAccessId: companyOwner.id,
        companyOwnerGeneration: companyOwner.generation,
        sourceVersion: sourceCustody.authorizationVersion,
        companyVersion: companyCustody.authorizationVersion,
        retentionPolicyVersion: version,
        manifest,
        manifestHash,
        creationKey: randomUUID().replaceAll('-', '').padEnd(64, '0'),
        fingerprint: 'b'.repeat(64),
        state: 'PREVIEWED',
        revision: 1,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 1800000),
      },
    });
    await expect(
      observer.query(
        'UPDATE "CompanyCustodyTransfer" SET state=\'APPLYING\',revision=revision+1 WHERE id=$1',
        [id],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      message: 'Both current owners must approve custody',
    });
    expect(
      (await client.companyCustodyTransfer.findUniqueOrThrow({ where: { id } }))
        .state,
    ).toBe('PREVIEWED');
    expect(
      await client.domainScopeCustody.count({ where: { scopeId: source.id } }),
    ).toBe(0);
    await life.change(owner.actor, co.id, 1, 'delete', password);
    await expireClosure(co.id);
    const filesPass = vi.spyOn(app.get(SharedFiles), 'purgePlan');
    await cleanup.consume();
    expect(filesPass).not.toHaveBeenCalled();
    expect(
      await client.company.findUnique({ where: { id: co.id } }),
    ).not.toBeNull();
    expect(
      (await app.get(ProjectsService).read(owner.actor, source.id)).spaceId,
    ).toBe(source.id);
  });
});
