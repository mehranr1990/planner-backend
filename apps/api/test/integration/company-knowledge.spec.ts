import { Readable } from 'node:stream';
import { SharedFiles } from '../../src/platform/storage/public/index.js';
import {
  ProjectsService,
  ProjectFinanceReferences,
} from '../../src/modules/projects/public/index.js';
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
import {
  CompanyAccess,
  SharedKernel,
} from '../../src/modules/spaces/public/index.js';
import {
  CompaniesService,
  CompanyStaffService,
  CompanyEmployeeCasesService,
  CompanyFinanceService,
  CompanyKnowledgeService,
  CompanyKnowledgeFilesService,
  CompanyReportsService,
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
describe('P4-05 Company knowledge, reports and privacy', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    client: PrismaClient,
    observer: Client,
    watcher: Client;
  let knowledge: CompanyKnowledgeService,
    files: CompanyKnowledgeFilesService,
    reports: CompanyReportsService,
    companies: CompaniesService,
    finance: CompanyFinanceService,
    staff: CompanyStaffService,
    cases: CompanyEmployeeCasesService,
    access: CompanyAccess,
    control: SharedControl;
  let owner: Person,
    member: Person,
    viewer: Person,
    admin: Person,
    outsider: Person;
  const version = 'synthetic-p405-' + randomUUID(),
    name = 'p405-' + randomUUID(),
    origin = 'http://localhost:3000',
    password = 'synthetic-p405-only-123!';
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
    const root = fs.mkdtempSync(path.resolve('.tools/p405-fixture-'));
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
    knowledge = app.get(CompanyKnowledgeService);
    files = app.get(CompanyKnowledgeFilesService);
    reports = app.get(CompanyReportsService);
    companies = app.get(CompaniesService);
    finance = app.get(CompanyFinanceService);
    staff = app.get(CompanyStaffService);
    cases = app.get(CompanyEmployeeCasesService);
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
          applicableContexts: ['COMPANY', 'PROJECT'],
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
  const window = {
    fromDate: '2026-11-01',
    toDate: '2026-12-01',
    timezone: 'UTC',
  };
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
  it('keeps drafts and their folder/search metadata invisible to ordinary readers', async () => {
    const f = await kb();
    await expect(
      knowledge.detail(member.actor, f.co.id, f.co.id, f.doc.id),
    ).rejects.toThrow();
    expect(
      (
        await knowledge.documents(viewer.actor, f.co.id, f.co.id, {
          limit: 10,
          search: 'Public',
        })
      ).items,
    ).toEqual([]);
    expect(
      (await knowledge.folders(member.actor, f.co.id, f.co.id, { limit: 10 }))
        .items,
    ).toEqual([]);
    await expect(
      knowledge.folderCreate(
        viewer.actor,
        f.co.id,
        f.co.id,
        { id: randomUUID(), parentId: null, title: 'Denied' },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('serves pinned published knowledge to admitted Viewers and excludes outsiders', async () => {
    const f = await published();
    expect(
      (await knowledge.detail(viewer.actor, f.co.id, f.co.id, f.doc.id)).title,
    ).toBe('Public title');
    expect(
      await collect(
        (await files.download(viewer.actor, f.co.id, f.co.id, f.doc.id, f.v.id))
          .stream,
      ),
    ).toBe('Knowledge bytes');
    await expect(
      files.download(outsider.actor, f.co.id, f.co.id, f.doc.id, f.v.id),
    ).rejects.toThrow();
    expect(
      (
        await knowledge.documents(member.actor, f.co.id, f.co.id, {
          limit: 10,
          search: 'guide.txt',
        })
      ).items,
    ).toHaveLength(1);
  });
  it('does not leak a replacement draft title, revision or timestamp before publication', async () => {
    const f = await published(),
      before = await knowledge.detail(member.actor, f.co.id, f.co.id, f.doc.id);
    const d = await knowledge.documentPatch(
      owner.actor,
      f.co.id,
      f.co.id,
      f.doc.id,
      2,
      { title: 'Secret replacement' },
    );
    const replacement = await upload(f, 'Replacement');
    expect(
      await knowledge.detail(member.actor, f.co.id, f.co.id, f.doc.id),
    ).toEqual(before);
    expect(
      (
        await knowledge.documents(member.actor, f.co.id, f.co.id, {
          limit: 10,
          search: 'Secret',
        })
      ).items,
    ).toEqual([]);
    expect(
      (
        await knowledge.versions(member.actor, f.co.id, f.co.id, f.doc.id, {
          limit: 10,
        })
      ).items,
    ).toHaveLength(1);
    await knowledge.publish(
      admin.actor,
      f.co.id,
      f.co.id,
      f.doc.id,
      replacement.id,
      replacement.revision,
      { documentRevision: d.revision },
    );
    expect(
      (await knowledge.detail(member.actor, f.co.id, f.co.id, f.doc.id)).title,
    ).toBe('Secret replacement');
    expect(
      (
        await knowledge.versions(member.actor, f.co.id, f.co.id, f.doc.id, {
          limit: 10,
        })
      ).items,
    ).toHaveLength(2);
    expect(
      await collect(
        (await files.download(member.actor, f.co.id, f.co.id, f.doc.id, f.v.id))
          .stream,
      ),
    ).toBe('Knowledge bytes');
  });
  it('archives a folder subtree and restores authorized published visibility', async () => {
    const f = await published();
    const a = await knowledge.folderPatch(
      owner.actor,
      f.co.id,
      f.co.id,
      f.folder.id,
      1,
      { archived: true },
    );
    await expect(
      knowledge.detail(member.actor, f.co.id, f.co.id, f.doc.id),
    ).rejects.toThrow();
    await expect(
      files.download(member.actor, f.co.id, f.co.id, f.doc.id, f.v.id),
    ).rejects.toThrow();
    expect(
      (await knowledge.documents(member.actor, f.co.id, f.co.id, { limit: 10 }))
        .items,
    ).toHaveLength(0);
    expect(
      (await knowledge.detail(owner.actor, f.co.id, f.co.id, f.doc.id)).id,
    ).toBe(f.doc.id);
    await knowledge.folderPatch(
      owner.actor,
      f.co.id,
      f.co.id,
      f.folder.id,
      a.revision,
      { archived: false },
    );
    expect(
      (await knowledge.detail(member.actor, f.co.id, f.co.id, f.doc.id)).id,
    ).toBe(f.doc.id);
  });
  it('rejects foreign IDs, missing child admissions and cross-context parent links', async () => {
    const f = await published(),
      other = await company();
    await expect(
      knowledge.documentCreate(
        owner.actor,
        other.id,
        other.id,
        {
          id: randomUUID(),
          folderId: f.folder.id,
          title: 'Foreign',
          description: null,
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const dept = await companies.createContext(
      owner.actor,
      f.co.id,
      null,
      { id: randomUUID(), title: 'Department', description: null },
      randomUUID(),
    );
    await expect(
      knowledge.folderCreate(
        owner.actor,
        f.co.id,
        dept.id,
        { id: randomUUID(), parentId: null, title: 'No seat' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await expect(
      files.download(owner.actor, other.id, other.id, f.doc.id, f.v.id),
    ).rejects.toThrow();
  });
  it('requires the initiating admission for pending upload and invalidates it on revoke/rejoin', async () => {
    const f = await kb(),
      v = await knowledge.initiate(
        admin.actor,
        f.co.id,
        f.co.id,
        f.doc.id,
        {
          id: randomUUID(),
          filename: 'pending.txt',
          mimeType: 'text/plain',
          expectedSize: 3,
        },
        randomUUID(),
      );
    await expect(
      files.complete(
        owner.actor,
        f.co.id,
        f.co.id,
        f.doc.id,
        v.id,
        1,
        Readable.from(['abc']),
        '3',
      ),
    ).rejects.toThrow();
    const seat = await root(f.co.id, admin);
    await companies.changeMember(
      owner.actor,
      f.co.id,
      f.co.id,
      seat.id,
      seat.revision,
      { state: 'REVOKED', memberRole: 'ORG_ADMIN' },
    );
    await admit(f.co.id, admin, 'ORG_ADMIN');
    await expect(
      files.complete(
        admin.actor,
        f.co.id,
        f.co.id,
        f.doc.id,
        v.id,
        1,
        Readable.from(['abc']),
        '3',
      ),
    ).rejects.toThrow();
  });
  it('enforces immutable published bytes, snapshots and historical versions in PostgreSQL', async () => {
    const f = await published();
    await expect(
      client.companyKnowledgeVersion.update({
        where: { id: f.v.id },
        data: { title: 'Tampered' },
      }),
    ).rejects.toThrow();
    await expect(
      client.storedFile.update({
        where: { id: f.v.fileId },
        data: { sha256: 'a'.repeat(64) },
      }),
    ).rejects.toThrow();
    await expect(
      client.companyKnowledgeVersion.delete({ where: { id: f.v.id } }),
    ).rejects.toThrow();
    await expect(
      files.remove(
        owner.actor,
        f.co.id,
        f.co.id,
        f.doc.id,
        f.v.id,
        f.v.revision,
      ),
    ).rejects.toThrow();
  });
  it('rejects stale concurrent publication and leaves exactly one current version', async () => {
    const f = await kb(),
      a = await upload(f, 'One'),
      b = await upload(f, 'Two');
    const result = await Promise.allSettled(
      [a, b].map((v) =>
        knowledge.publish(
          owner.actor,
          f.co.id,
          f.co.id,
          f.doc.id,
          v.id,
          v.revision,
          { documentRevision: 1 },
        ),
      ),
    );
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await client.companyKnowledgeVersion.count({
        where: { documentId: f.doc.id, publishedAt: { not: null } },
      }),
    ).toBe(1);
  });
  it('destroys an opened file stream when membership is revoked before delivery', async () => {
    const f = await published(),
      shared = app.get(SharedFiles),
      open = shared.open.bind(shared);
    let opened: Readable | undefined;
    vi.spyOn(shared, 'open').mockImplementationOnce(async (file) => {
      opened = await open(file);
      const seat = await root(f.co.id, member);
      await companies.changeMember(
        owner.actor,
        f.co.id,
        f.co.id,
        seat.id,
        seat.revision,
        { state: 'REVOKED', memberRole: 'MEMBER' },
      );
      return opened;
    });
    await expect(
      files.download(member.actor, f.co.id, f.co.id, f.doc.id, f.v.id),
    ).rejects.toThrow();
    expect(opened?.destroyed).toBe(true);
  });
  it('rejects spoofed content and cleans failed knowledge files without deleting financial receipts', async () => {
    const f = await kb(),
      v = await knowledge.initiate(
        owner.actor,
        f.co.id,
        f.co.id,
        f.doc.id,
        {
          id: randomUUID(),
          filename: 'fake.png',
          mimeType: 'image/png',
          expectedSize: 3,
        },
        randomUUID(),
      );
    await expect(
      files.complete(
        owner.actor,
        f.co.id,
        f.co.id,
        f.doc.id,
        v.id,
        1,
        Readable.from(['abc']),
        '3',
      ),
    ).rejects.toThrow();
    expect(
      (
        await knowledge.getVersion(
          owner.actor,
          f.co.id,
          f.co.id,
          f.doc.id,
          v.id,
        )
      ).status,
    ).toBe('REJECTED');
    expect((await files.reconcile(owner.actor, f.co.id, f.co.id)).cleaned).toBe(
      0,
    );
    await client.storedFile.update({
      where: { id: v.fileId },
      data: { uploadStartedAt: new Date(Date.now() - 3600000) },
    });
    expect((await files.reconcile(owner.actor, f.co.id, f.co.id)).cleaned).toBe(
      1,
    );
    expect(
      (await client.storedFile.findUniqueOrThrow({ where: { id: v.fileId } }))
        .purgedAt,
    ).not.toBeNull();
  });
  it('reports capacity only from current explicit Company planning with unknown denominator', async () => {
    const f = await fixture();
    await staff.createAvailability(
      owner.actor,
      f.co.id,
      f.co.id,
      {
        id: randomUUID(),
        member: ref(f.subject),
        date: '2026-11-07',
        timezone: 'UTC',
        availableMinutes: 120,
      },
      randomUUID(),
    );
    const r = await reports.operations(owner.actor, f.co.id, f.co.id, window);
    expect(r.availableMinutes).toBe(120);
    expect(r.knownCapacityDays).toBe(1);
    expect(r.unknownCapacityDays).toBe(r.memberCount * 30 - 1);
    await expect(
      reports.operations(viewer.actor, f.co.id, f.co.id, window),
    ).rejects.toThrow();
  });
  it('retains exact separate currency totals, omits pending expense and preserves full budget period', async () => {
    const f = await fixture();
    const category = await finance.categoryCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), title: 'Sensitive category' },
      randomUUID(),
    );
    for (const [currency, value] of [
      ['USD', '0.10'],
      ['JPY', '2'],
    ] as const) {
      const d = await finance.expenseCreate(
        member.actor,
        f.co.id,
        f.co.id,
        {
          id: randomUUID(),
          amount: value,
          currency,
          categoryId: category.id,
          occurredDate: '2026-11-07',
          timezone: 'UTC',
          vendor: 'SECRET_VENDOR',
          payer: null,
          projectReferenceId: null,
          allocations: [],
        },
        randomUUID(),
      );
      const submitted = await finance.submit(
        member.actor,
        f.co.id,
        f.co.id,
        d.id,
        d.revision,
        { reviewer: ref(f.reviewer) },
      );
      await finance.decide(
        admin.actor,
        f.co.id,
        f.co.id,
        d.id,
        submitted.revision,
        { decision: 'APPROVE' },
      );
    }
    await finance.expenseCreate(
      member.actor,
      f.co.id,
      f.co.id,
      {
        id: randomUUID(),
        amount: '999.00',
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
    const r = await reports.financial(owner.actor, f.co.id, f.co.id, window);
    expect(r.currencies.map((v) => [v.currency, v.spent])).toEqual([
      ['JPY', '2'],
      ['USD', '0.10'],
    ]);
    expect(JSON.stringify(r)).not.toContain('SECRET_VENDOR');
    await expect(
      reports.financial(member.actor, f.co.id, f.co.id, window),
    ).rejects.toThrow();
  });
  it('excludes confidential case events and private payloads from managerial audit and exports', async () => {
    const f = await published(),
      reviewer = await admit(f.co.id, await person(), 'ORG_ADMIN');
    const record = await cases.create(
      owner.actor,
      f.co.id,
      f.co.id,
      {
        id: randomUUID(),
        subject: ref(f.subject),
        reviewer: ref(reviewer),
        reason: 'CASE_SENTINEL',
        evidence: 'PRIVATE_EVIDENCE',
      },
      randomUUID(),
    );
    await cases.read(owner.actor, f.co.id, f.co.id, record.id);
    const audit = await reports.audit(admin.actor, f.co.id, f.co.id, {
      limit: 100,
    });
    expect(
      audit.items.some((r) => r.action === 'company.knowledge.version.publish'),
    ).toBe(true);
    const text = JSON.stringify(audit);
    for (const sentinel of [
      record.id,
      'CASE_SENTINEL',
      'PRIVATE_EVIDENCE',
      'guide.txt',
    ])
      expect(text).not.toContain(sentinel);
    await expect(
      reports.audit(member.actor, f.co.id, f.co.id, { limit: 10 }),
    ).rejects.toThrow();
    for (const dataset of [
      'KNOWLEDGE',
      'AUDIT',
      'FINANCE',
      'OPERATIONS',
      'PORTFOLIO',
    ] as const) {
      const out = await reports.export(admin.actor, f.co.id, f.co.id, {
        ...window,
        dataset,
        format: 'JSON',
      });
      expect(out.body).not.toContain(record.id);
      expect(out.body).not.toContain('CASE_SENTINEL');
    }
  });
  it('shows only independently authorized source Projects and never grants access from Company administration', async () => {
    const f = await fixture(),
      projects = app.get(ProjectsService);
    const p = await projects.create(
      owner.actor,
      {
        id: randomUUID(),
        title: 'Independent source',
        description: null,
        retentionPolicyVersion: version,
      },
      randomUUID(),
    );
    await finance.referenceCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), projectId: p.id },
      randomUUID(),
    );
    expect(
      (
        await reports.portfolio(owner.actor, f.co.id, f.co.id, window)
      ).projects.map((x) => x.projectId),
    ).toEqual([p.id]);
    expect(
      (await reports.portfolio(admin.actor, f.co.id, f.co.id, window)).projects,
    ).toEqual([]);
    const exported = await reports.export(admin.actor, f.co.id, f.co.id, {
      ...window,
      dataset: 'PORTFOLIO',
      format: 'JSON',
    });
    expect(exported.body).not.toContain(p.id);
    expect(exported.body).not.toContain('Independent source');
  });
  it('enforces HTTP cookies, Origin, strict query, ETags and private binary/export responses', async () => {
    const f = await published(),
      base = '/api/v1/companies/' + f.co.id + '/contexts/' + f.co.id;
    await request(app.getHttpServer())
      .get(base + '/knowledge/documents/' + f.doc.id)
      .expect(401);
    await request(app.getHttpServer())
      .get(base + '/knowledge/documents')
      .set('Cookie', viewer.cookie)
      .query({ unknown: 'secret' })
      .expect(400);
    const detail = await request(app.getHttpServer())
      .get(base + '/knowledge/documents/' + f.doc.id)
      .set('Cookie', viewer.cookie)
      .expect(200);
    expect(detail.headers.etag).toBeTruthy();
    await request(app.getHttpServer())
      .post(base + '/exports')
      .set('Cookie', owner.cookie)
      .send({ ...window, dataset: 'KNOWLEDGE', format: 'JSON' })
      .expect(403);
    const exported = await request(app.getHttpServer())
      .post(base + '/exports')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({ ...window, dataset: 'KNOWLEDGE', format: 'JSON' })
      .expect(200);
    expect(exported.headers['cache-control']).toContain('no-store');
    await request(app.getHttpServer())
      .get(
        base +
          '/knowledge/documents/' +
          f.doc.id +
          '/versions/' +
          f.v.id +
          '/download',
      )
      .set('Cookie', viewer.cookie)
      .expect(200)
      .expect('X-Content-Type-Options', 'nosniff');
  });

  it('keeps idempotent knowledge creation, usage and opaque audit effects atomic', async () => {
    const f = await kb(),
      key = randomUUID(),
      input = { id: randomUUID(), parentId: f.folder.id, title: 'Idempotent' };
    const results = await Promise.all(
      [1, 2].map(() =>
        knowledge.folderCreate(owner.actor, f.co.id, f.co.id, input, key),
      ),
    );
    expect(results[0]).toEqual(results[1]);
    expect(
      await client.companyKnowledgeFolder.count({ where: { id: input.id } }),
    ).toBe(1);
    expect(
      await client.sharedAuditEvent.count({
        where: {
          spaceId: f.co.id,
          resourceId: input.id,
          action: 'company.knowledge.folder.create',
        },
      }),
    ).toBe(1);
    await expect(
      knowledge.folderCreate(
        owner.actor,
        f.co.id,
        f.co.id,
        { ...input, title: 'Changed' },
        key,
      ),
    ).rejects.toThrow();
  });
  it('grants a Dept Manager only their explicitly admitted child knowledge and report context', async () => {
    const f = await fixture(),
      dept = await companies.createContext(
        owner.actor,
        f.co.id,
        null,
        { id: randomUUID(), title: 'Scoped department', description: null },
        randomUUID(),
      );
    await admit(f.co.id, member, 'DEPT_MANAGER', dept.id);
    const folder = await knowledge.folderCreate(
      member.actor,
      f.co.id,
      dept.id,
      { id: randomUUID(), parentId: null, title: 'Department guide' },
      randomUUID(),
    );
    expect(folder.scopeId).toBe(dept.id);
    expect(
      (await reports.operations(member.actor, f.co.id, dept.id, window))
        .scopeId,
    ).toBe(dept.id);
    await expect(
      reports.financial(member.actor, f.co.id, f.co.id, window),
    ).rejects.toThrow();
    await expect(
      knowledge.folders(owner.actor, f.co.id, dept.id, { limit: 10 }),
    ).rejects.toThrow();
  });
  it('retains published Company knowledge pseudonymously through independent publisher erasure', async () => {
    const f = await kb(),
      who = await person();
    const seat = await admit(f.co.id, who, 'ORG_ADMIN');
    const v = await upload(f, 'Retained shared knowledge', who);
    await knowledge.publish(
      who.actor,
      f.co.id,
      f.co.id,
      f.doc.id,
      v.id,
      v.revision,
      { documentRevision: 1 },
    );
    const closedAt = new Date();
    await client.space.updateMany({
      where: { ownerUserId: who.actor.userId, kind: 'PERSONAL' },
      data: { accessClosedAt: closedAt },
    });
    for (let pass = 0; pass < 3; pass++)
      if (
        await app
          .get(SharedKernel)
          .prepareIdentityErasure(who.actor.userId, closedAt)
      )
        break;
    expect(
      (
        await client.sharedActor.findUniqueOrThrow({
          where: { id: seat.actorId },
        })
      ).userId,
    ).toBeNull();
    expect(
      await collect(
        (await files.download(member.actor, f.co.id, f.co.id, f.doc.id, v.id))
          .stream,
      ),
    ).toBe('Retained shared knowledge');
    expect(
      JSON.stringify(
        await reports.audit(owner.actor, f.co.id, f.co.id, { limit: 100 }),
      ),
    ).not.toContain(who.actor.userId);
  });
  it('denies export when required Company authority is revoked between source discovery and publication', async () => {
    const f = await fixture(),
      p = await app.get(ProjectsService).create(
        owner.actor,
        {
          id: randomUUID(),
          title: 'Source',
          retentionPolicyVersion: version,
        },
        randomUUID(),
      );
    await finance.referenceCreate(
      owner.actor,
      f.co.id,
      f.co.id,
      { id: randomUUID(), projectId: p.id },
      randomUUID(),
    );
    const projects = app.get(ProjectFinanceReferences),
      hints = projects.portfolioHints.bind(projects);
    vi.spyOn(projects, 'portfolioHints').mockImplementationOnce(
      async (id, refs) => {
        const result = await hints(id, refs);
        const seat = await root(f.co.id, admin);
        await companies.changeMember(
          owner.actor,
          f.co.id,
          f.co.id,
          seat.id,
          seat.revision,
          { state: 'REVOKED', memberRole: 'ORG_ADMIN' },
        );
        return result;
      },
    );
    await expect(
      reports.export(admin.actor, f.co.id, f.co.id, {
        ...window,
        dataset: 'PORTFOLIO',
        format: 'JSON',
      }),
    ).rejects.toThrow();
    expect(
      await client.sharedAuditEvent.count({
        where: { spaceId: f.co.id, action: 'company.export.publish' },
      }),
    ).toBe(0);
  });
});
