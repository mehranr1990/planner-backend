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
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { DatabaseService } from '../../src/platform/database/database.service.js';
import type { RequestActor } from '../../src/platform/auth/request-actor.js';
import { AuthService } from '../../src/platform/auth/auth.service.js';
import { PersonalLifecycle } from '../../src/modules/account/public/index.js';
import { PersonalTaskTransfer } from '../../src/modules/tasks/public/personal-transfer.js';
import { SharedControl } from '../../src/platform/storage/shared-control.js';
import {
  SharedKernel,
  CollaborationService,
} from '../../src/modules/spaces/public/index.js';
import { ProjectsService } from '../../src/modules/projects/public/index.js';
import { TeamsService } from '../../src/modules/teams/public/index.js';
import { TeamMeetingsService } from '../../src/modules/teams/application/team-meetings.service.js';
import { TeamWorkService } from '../../src/modules/teams/application/team-work.service.js';
import { CompaniesService } from '../../src/modules/companies/public/index.js';
import { testApplication } from '../support/application.js';
import { migrationSandbox } from '../../../../tooling/testing/migration-sandbox.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import * as c from '@mehran/api-contracts';
import { Readable } from 'node:stream';
import {
  MeetingsService,
  MeetingDocuments,
  MeetingFiles,
  AnnouncementsService,
} from '../../src/modules/meetings/public/index.js';
type Person = { actor: RequestActor; email: string };
describe('P5-05 meetings decisions and announcements', () => {
  let sandbox: Awaited<ReturnType<typeof migrationSandbox>>,
    app: NestExpressApplication,
    db: PrismaClient,
    meetings: MeetingsService,
    documents: MeetingDocuments,
    files: MeetingFiles,
    announcements: AnnouncementsService,
    kernel: SharedKernel,
    collaboration: CollaborationService,
    auth: AuthService,
    control: SharedControl,
    projects: ProjectsService,
    teams: TeamsService,
    companies: CompaniesService,
    watcher: Client,
    passwordHash: string;
  let owner: Person,
    alice: Person,
    bob: Person,
    viewer: Person,
    outsider: Person;
  const version = 'synthetic-p501-' + randomUUID(),
    password = 'Synthetic-messaging-test-only-123!',
    origin = 'http://localhost:3000',
    applicationName = 'p501-' + randomUUID(),
    page = { limit: 50 };
  async function person(verified = true): Promise<Person> {
    const userId = randomUUID(),
      sessionId = randomUUID(),
      email = randomUUID() + '@example.test';
    await db.user.create({
      data: {
        id: userId,
        name: 'Synthetic messaging participant',
        email,
        emailVerified: verified,
      },
    });
    await db.space.create({
      data: { id: randomUUID(), kind: 'PERSONAL', ownerUserId: userId },
    });
    await db.userSettings.create({ data: { userId } });
    await db.authAccount.create({
      data: {
        id: randomUUID(),
        userId,
        accountId: userId,
        providerId: 'credential',
        password: passwordHash,
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
    return {
      email,
      actor: {
        userId,
        sessionId,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
    };
  }
  async function cookie(who: Person) {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email: who.email, password })
      .expect(200);
    return (login.headers['set-cookie'] as unknown as string[])
      .map((v) => v.split(';')[0])
      .join('; ');
  }
  async function work(kind: 'PROJECT' | 'TEAM' | 'COMPANY' = 'PROJECT') {
    const input = {
      id: randomUUID(),
      title: 'Authorized source',
      retentionPolicyVersion: version,
    };
    return kind === 'PROJECT'
      ? projects.create(owner.actor, input, randomUUID())
      : kind === 'TEAM'
        ? teams.create(owner.actor, input, randomUUID())
        : companies.create(owner.actor, input, randomUUID());
  }
  async function join(
    id: string,
    who = alice,
    role: 'MEMBER' | 'VIEWER' | 'ADMIN' = 'MEMBER',
    kind: 'PROJECT' | 'TEAM' = 'PROJECT',
  ) {
    const offer = await collaboration.createInvitation(
      owner.actor,
      id,
      {
        kind: 'MEMBERSHIP',
        memberRole: role,
        recipient: { userId: who.actor.userId },
      },
      randomUUID(),
    );
    const result = await collaboration.decideInvitation(
      who.actor,
      offer.invitation.id,
      offer.proof!,
      1,
      true,
      kind,
    );
    if (!('membership' in result)) throw Error('Missing source membership');
    return result.membership;
  }
  beforeAll(async () => {
    sandbox = await migrationSandbox(process.env);
    const deployed = spawnSync(
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
    if (deployed.status !== 0)
      throw Error('Owned messaging schema deploy failed; credentials withheld');
  });
  // Keep the synchronous owned-schema deployment separate from asynchronous
  // application bootstrap; both retain Vitest's existing hook timeout.
  beforeAll(async () => {
    const schema = new URL(sandbox.url).searchParams.get('schema')!,
      base = isolatedTestDatabaseUrl(process.env);
    db = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: base,
          options: '-c search_path=' + schema + ' -c timezone=UTC',
          application_name: applicationName,
          max: 8,
        },
        { schema },
      ),
    });
    const database: DatabaseService = {
      client: db,
      checkConnection: async () => {
        await db.$queryRaw`SELECT 1`;
      },
      onApplicationShutdown: () => db.$disconnect(),
    };
    const root = fs.mkdtempSync(path.resolve('.tools/messaging-test-'));
    app = await testApplication({
      databaseUrl: base,
      databaseInstance: database,
      environment: {
        STORAGE_ROOT: path.join(root, 'files'),
        PUSH_MODE: 'sink',
        NOTIFICATION_SINK_DIR: path.join(root, 'notifications'),
        PERSONAL_ERASURE_POLICY_VERSION: 'synthetic-p503-erasure',
        SHARED_CONTROL_ROOT: path.join(root, 'control'),
        SHARED_CONTROL_KEYS: JSON.stringify({
          k1: randomBytes(48).toString('base64url'),
        }),
        SHARED_CONTROL_ACTIVE_KEY_ID: 'k1',
        SHARED_SECURITY_ACCEPTANCE_REFERENCE: 'SYNTHETIC-P501-ONLY',
      },
    });
    control = app.get(SharedControl);
    await control.initialize();
    meetings = app.get(MeetingsService);
    documents = app.get(MeetingDocuments);
    files = app.get(MeetingFiles);
    announcements = app.get(AnnouncementsService);
    kernel = app.get(SharedKernel);
    collaboration = app.get(CollaborationService);
    auth = app.get(AuthService);
    projects = app.get(ProjectsService);
    teams = app.get(TeamsService);
    companies = app.get(CompaniesService);
    passwordHash = await (await auth.auth.$context).password.hash(password);
    watcher = new Client({ connectionString: base });
    await watcher.connect();
    const rule = {
      retainAfterClosureSeconds: 0,
      audience: ['OWNER', 'ADMIN'],
      exportAuthority: ['OWNER'],
      disposalAction: 'PURGE',
    };
    await db.sharedRetentionPolicy.create({
      data: {
        version,
        approvalReference: 'SYNTHETIC-P501-ONLY',
        configuration: {
          policyVersion: version,
          approvalReference: 'SYNTHETIC-P501-ONLY',
          accountableOperator: 'synthetic operator',
          applicableContexts: [
            'PROJECT',
            'TEAM',
            'COMPANY',
            'CONVERSATION',
            'MEETING',
          ],
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
          backupPolicyReference: 'synthetic independent controls',
        },
      },
    });
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    owner = await person();
    alice = await person();
    bob = await person();
    viewer = await person();
    outsider = await person();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await watcher?.end();
    await db?.$disconnect();
    await sandbox?.close();
  });

  const event = {
    title: 'Confidential meeting',
    schedule: {
      kind: 'ALL_DAY' as const,
      timezone: 'UTC',
      startDate: '2026-12-01',
      endDate: '2026-12-02',
    },
  };
  async function meeting(
    participants: Person[] = [alice],
    source?: { id: string; kind: 'PROJECT' | 'TEAM' | 'COMPANY' },
  ) {
    return meetings.create(
      owner.actor,
      c.MeetingCreateSchema.parse({
        id: randomUUID(),
        event,
        externalUrl: 'https://example.test/private',
        participants: participants.map((p) => p.actor.userId),
        ...(source
          ? { kind: source.kind, sourceId: source.id }
          : { kind: 'INDEPENDENT', retentionPolicyVersion: version }),
      }),
      randomUUID(),
    );
  }
  async function admit(
    id: string,
    who = alice,
    decision: 'ACCEPTED' | 'TENTATIVE' = 'ACCEPTED',
  ) {
    const offer = (await meetings.invitations(who.actor, page)).items.find(
      (x) => x.meetingId === id,
    )!;
    expect(offer).toBeDefined();
    return meetings.rsvp(
      who.actor,
      offer.id,
      offer.revision,
      decision,
      randomUUID(),
    );
  }
  async function memberId(id: string, who = alice) {
    const actor = await db.sharedActor.findFirstOrThrow({
      where: {
        spaceId: (await db.meeting.findUniqueOrThrow({ where: { id } }))
          .spaceId,
        userId: who.actor.userId,
      },
    });
    return (
      await db.meetingMember.findUniqueOrThrow({
        where: { meetingId_actorId: { meetingId: id, actorId: actor.id } },
      })
    ).id;
  }
  async function draft(id: string, reviewer?: string) {
    return documents.create(
      owner.actor,
      id,
      {
        id: randomUUID(),
        minutes: 'Private minutes',
        decisions: [{ id: randomUUID(), text: 'Decision' }],
        actions: [
          {
            id: randomUUID(),
            title: 'Approved action',
            description: 'Restricted detail',
          },
        ],
        attachments: [],
        contributors: [],
        ...(reviewer ? { reviewerMemberId: reviewer } : {}),
      },
      randomUUID(),
    );
  }
  async function approved(id: string) {
    await admit(id);
    let v = await draft(id, await memberId(id));
    v = await documents.submit(owner.actor, id, v.id, v.revision, randomUUID());
    v = await documents.review(
      alice.actor,
      id,
      v.id,
      { decision: 'APPROVE', reason: 'Reviewed exact snapshot' },
      v.revision,
      randomUUID(),
    );
    return documents.finalize(owner.actor, id, v.id, v.revision, randomUUID());
  }
  it('creates one authoritative calendar event and exposes only safe invitation metadata until explicit acceptance', async () => {
    const m = await meeting();
    expect(m.event.title).toBe(event.title);
    await expect(meetings.get(alice.actor, m.id)).rejects.toThrow();
    const offer = (await meetings.invitations(alice.actor, page)).items[0]!;
    expect(Object.keys(offer).sort()).toEqual([
      'expiresAt',
      'id',
      'meetingId',
      'revision',
      'schedule',
      'state',
      'title',
    ]);
    await expect(
      meetings.rsvp(
        outsider.actor,
        offer.id,
        offer.revision,
        'ACCEPTED',
        randomUUID(),
      ),
    ).rejects.toThrow();
    await admit(m.id, alice, 'TENTATIVE');
    expect((await meetings.get(alice.actor, m.id)).externalUrl).toContain(
      '/private',
    );
    expect(await db.calendarEvent.count({ where: { id: m.event.id } })).toBe(1);
  });
  it('rolls back custody and calendar on invalid invitee and makes creation retries payload-bound', async () => {
    const id = randomUUID(),
      input = c.MeetingCreateSchema.parse({
        id,
        kind: 'INDEPENDENT',
        event,
        retentionPolicyVersion: version,
        participants: [randomUUID()],
      });
    await expect(
      meetings.create(owner.actor, input, randomUUID()),
    ).rejects.toThrow();
    expect(await db.meeting.findUnique({ where: { id } })).toBeNull();
    expect(
      await db.sharedCustody.findUnique({ where: { spaceId: id } }),
    ).toBeNull();
    const good = c.MeetingCreateSchema.parse({ ...input, participants: [] }),
      key = randomUUID();
    const a = await meetings.create(owner.actor, good, key),
      b = await meetings.create(owner.actor, good, key);
    expect(a.event.id).toBe(b.event.id);
    await expect(
      meetings.create(
        owner.actor,
        { ...good, event: { ...event, title: 'Changed' } },
        key,
      ),
    ).rejects.toThrow();
  });
  it('keeps drafts private, separates reviewer from author and publishes only the approved immutable version', async () => {
    const m = await meeting([alice, bob]);
    await admit(m.id);
    await admit(m.id, bob);
    let v = await draft(m.id, await memberId(m.id));
    await expect(documents.get(bob.actor, m.id, v.id)).rejects.toThrow();
    expect((await documents.list(bob.actor, m.id, page)).items).toEqual([]);
    await expect(
      documents.finalize(owner.actor, m.id, v.id, v.revision, randomUUID()),
    ).rejects.toThrow();
    v = await documents.submit(
      owner.actor,
      m.id,
      v.id,
      v.revision,
      randomUUID(),
    );
    await expect(
      documents.review(
        owner.actor,
        m.id,
        v.id,
        { decision: 'APPROVE', reason: 'Self' },
        v.revision,
        randomUUID(),
      ),
    ).rejects.toThrow();
    v = await documents.review(
      alice.actor,
      m.id,
      v.id,
      { decision: 'APPROVE', reason: 'Private review' },
      v.revision,
      randomUUID(),
    );
    v = await documents.finalize(
      owner.actor,
      m.id,
      v.id,
      v.revision,
      randomUUID(),
    );
    const publicVersion = await documents.get(bob.actor, m.id, v.id);
    expect(publicVersion.state).toBe('FINAL');
    expect(publicVersion.review).toBeNull();
    expect(publicVersion.contributors).toEqual([]);
    await expect(
      db.meetingVersion.update({
        where: { id: v.id },
        data: { minutes: 'Tamper' },
      }),
    ).rejects.toThrow();
    await expect(
      db.meetingAction.update({
        where: { id: v.actions[0]!.id },
        data: { title: 'Tamper' },
      }),
    ).rejects.toThrow();
  });
  it('allows sole independent owner finalization but never restores that exception after another admission', async () => {
    const solo = await meeting([]),
      v = await draft(solo.id);
    expect(
      (
        await documents.finalize(
          owner.actor,
          solo.id,
          v.id,
          v.revision,
          randomUUID(),
        )
      ).selfFinalized,
    ).toBe(true);
    const m = await meeting();
    await admit(m.id);
    await meetings.leave(alice.actor, m.id, 1, randomUUID());
    const next = await draft(m.id);
    await expect(
      documents.finalize(
        owner.actor,
        m.id,
        next.id,
        next.revision,
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('creates private personal action tasks idempotently without exposing another participant task', async () => {
    const m = await meeting(),
      v = await approved(m.id),
      action = v.actions[0]!.id,
      key = randomUUID();
    const a = await documents.convert(owner.actor, m.id, action, {}, key),
      b = await documents.convert(owner.actor, m.id, action, {}, key);
    expect(a.id).toBe(b.id);
    expect(a.personal).toBe(true);
    expect(a.task?.title).toBe('Approved action');
    const scope = await meetings.op.spaces.authorizePersonal(owner.actor),
      transfer = await db.$transaction((tx) =>
        app
          .get(PersonalTaskTransfer)
          .preview(
            tx,
            scope,
            [{ id: a.task!.id, revision: a.task!.revision }],
            {
              includeTaskHistory: true,
              includeGoalReviews: false,
              privateReferences: 'REJECT',
              files: 'REJECT',
            },
          ),
      );
    expect(transfer[0]!.blockers).toContain('REFERENCE:meetingAction');
    expect(transfer[0]!.blockers).not.toContain('UNKNOWN_INCOMING_FK');
    expect(
      (await documents.links(alice.actor, m.id, action, page)).items,
    ).toEqual([]);
    const own = await documents.convert(
      alice.actor,
      m.id,
      action,
      {},
      randomUUID(),
    );
    expect(own.task?.id).not.toBe(a.task?.id);
    await expect(
      documents.convert(
        alice.actor,
        m.id,
        action,
        { taskId: a.task!.id },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it.each(['PROJECT', 'TEAM', 'COMPANY'] as const)(
    'creates %s meetings in their exact source without implicit member admission',
    async (kind) => {
      const source = await work(kind),
        m = await meeting([], { id: source.id, kind });
      expect(m.sourceId).toBe(source.id);
      expect(m.kind).toBe(kind);
      expect(m.event.id).toBeTruthy();
      await expect(meetings.get(outsider.actor, m.id)).rejects.toThrow();
    },
  );
  it('requires source membership and explicit work action release before one authoritative task is created', async () => {
    const source = await work();
    await join(source.id);
    const m = await meeting([alice], { id: source.id, kind: 'PROJECT' }),
      v = await approved(m.id),
      action = v.actions[0]!.id;
    await expect(
      documents.convert(alice.actor, m.id, action, {}, randomUUID()),
    ).rejects.toThrow();
    await documents.release(owner.actor, m.id, action, true, 1, randomUUID());
    const [a, b] = await Promise.all([
      documents.convert(owner.actor, m.id, action, {}, randomUUID()),
      documents.convert(alice.actor, m.id, action, {}, randomUUID()),
    ]);
    expect(a.task?.id).toBe(b.task?.id);
    expect(
      await db.meetingTaskLink.count({ where: { actionId: action } }),
    ).toBe(1);
  });
  it('snapshots announcement member generations, keeps acknowledgement private and excludes later members', async () => {
    const source = await work();
    await join(source.id);
    await join(source.id, viewer, 'VIEWER');
    const a = await announcements.create(
      owner.actor,
      { id: randomUUID(), kind: 'PROJECT', sourceId: source.id },
      randomUUID(),
    );
    let v = await announcements.createVersion(
      owner.actor,
      a.id,
      {
        id: randomUUID(),
        title: 'Notice',
        text: 'Restricted announcement',
        acknowledgement: true,
        attachments: [],
      },
      randomUUID(),
    );
    await expect(
      announcements.getVersion(alice.actor, a.id, v.id),
    ).rejects.toThrow();
    v = await announcements.publish(
      owner.actor,
      a.id,
      v.id,
      { audience: 'ALL' },
      v.revision,
      randomUUID(),
    );
    await join(source.id, bob);
    await expect(
      announcements.getVersion(bob.actor, a.id, v.id),
    ).rejects.toThrow();
    expect(
      (await announcements.getVersion(viewer.actor, a.id, v.id)).acknowledged,
    ).toBe(false);
    expect(await announcements.summary(owner.actor, a.id, v.id)).toEqual({
      versionId: v.id,
      eligible: 3,
      acknowledged: 0,
    });
    await announcements.acknowledge(viewer.actor, a.id, v.id);
    await announcements.acknowledge(viewer.actor, a.id, v.id);
    expect(await announcements.summary(owner.actor, a.id, v.id)).toEqual({
      versionId: v.id,
      eligible: 3,
      acknowledged: 1,
    });
    await expect(
      announcements.summary(alice.actor, a.id, v.id),
    ).rejects.toThrow();
    expect(
      (await announcements.getVersion(alice.actor, a.id, v.id)).acknowledged,
    ).toBe(false);
    await expect(
      db.announcementVersion.update({
        where: { id: v.id },
        data: { text: 'Edited publication' },
      }),
    ).rejects.toThrow();
    await announcements.withdraw(
      owner.actor,
      a.id,
      v.id,
      v.revision,
      randomUUID(),
    );
    await expect(
      announcements.getVersion(alice.actor, a.id, v.id),
    ).rejects.toThrow();
  });
  async function uploadFile(
    parent: { kind: 'MEETING' | 'ANNOUNCEMENT'; id: string },
    who = owner,
  ) {
    const bytes = Buffer.from('Private meeting attachment');
    const f = await files.initiate(
      who.actor,
      parent,
      {
        id: randomUUID(),
        filename: 'minutes.txt',
        mimeType: 'text/plain',
        expectedSize: bytes.length,
      },
      randomUUID(),
    );
    return files.complete(
      who.actor,
      parent,
      f.id,
      Readable.from([bytes]),
      String(bytes.length),
    );
  }
  it('keeps attachment bytes private until explicit agenda sharing and prevents foreign parent references', async () => {
    const m = await meeting(),
      other = await meeting([]),
      parent = { kind: 'MEETING' as const, id: m.id };
    await admit(m.id);
    const file = await uploadFile(parent);
    await expect(files.status(alice.actor, parent, file.id)).rejects.toThrow();
    expect((await files.list(alice.actor, parent, page)).items).toEqual([]);
    await expect(
      files.status(owner.actor, { kind: 'MEETING', id: other.id }, file.id),
    ).rejects.toThrow();
    const shared = await files.share(
      owner.actor,
      m.id,
      file.id,
      file.revision,
      randomUUID(),
    );
    expect(shared.shared).toBe(true);
    const content = await files.download(alice.actor, parent, file.id),
      chunks = [];
    for await (const chunk of content.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('Private meeting attachment');
    await expect(
      files.cancel(owner.actor, parent, file.id, shared.revision),
    ).rejects.toThrow();
  });
  it('rechecks admission after streamed upload and before opening downloaded bytes', async () => {
    const m = await meeting(),
      parent = { kind: 'MEETING' as const, id: m.id };
    await admit(m.id);
    const file = await files.initiate(
      alice.actor,
      parent,
      {
        id: randomUUID(),
        filename: 'private.txt',
        mimeType: 'text/plain',
        expectedSize: 4,
      },
      randomUUID(),
    );
    async function* revoked() {
      yield Buffer.from('data');
      const mid = await memberId(m.id);
      await meetings.remove(owner.actor, m.id, mid, 1, randomUUID());
    }
    await expect(
      files.complete(
        alice.actor,
        parent,
        file.id,
        Readable.from(revoked()),
        '4',
      ),
    ).rejects.toThrow();
    expect(
      (await db.storedFile.findUniqueOrThrow({ where: { id: file.id } }))
        .status,
    ).not.toBe('READY');
  });
  it('prevents Viewers from contributing, reviewing, converting, or uploading while preserving own RSVP and published reading', async () => {
    const source = await work();
    await join(source.id, viewer, 'VIEWER');
    const m = await meeting([viewer], { id: source.id, kind: 'PROJECT' });
    await admit(m.id, viewer);
    expect((await meetings.get(viewer.actor, m.id)).role).toBe('PARTICIPANT');
    await expect(
      documents.create(
        viewer.actor,
        m.id,
        {
          id: randomUUID(),
          minutes: 'x',
          decisions: [],
          actions: [],
          attachments: [],
          contributors: [],
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await expect(
      uploadFile({ kind: 'MEETING', id: m.id }, viewer),
    ).rejects.toThrow();
    await expect(
      meetings.propose(
        viewer.actor,
        m.id,
        { id: randomUUID(), text: 'x' },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });
  it('invalidates meeting admission and announcement audience after source revocation and rejoining', async () => {
    const source = await work(),
      access = await join(source.id),
      m = await meeting([alice], { id: source.id, kind: 'PROJECT' });
    await admit(m.id);
    const a = await announcements.create(
      owner.actor,
      { id: randomUUID(), kind: 'PROJECT', sourceId: source.id },
      randomUUID(),
    );
    let v = await announcements.createVersion(
      owner.actor,
      a.id,
      {
        id: randomUUID(),
        title: 'Old',
        text: 'Old audience',
        acknowledgement: true,
        attachments: [],
      },
      randomUUID(),
    );
    v = await announcements.publish(
      owner.actor,
      a.id,
      v.id,
      { audience: 'ALL' },
      v.revision,
      randomUUID(),
    );
    await kernel.changeAccess(owner.actor, {
      spaceId: source.id,
      scopeId: source.id,
      accessId: access.id,
      revision: access.revision,
      state: 'REVOKED',
      memberRole: 'MEMBER',
    });
    await join(source.id);
    await expect(meetings.get(alice.actor, m.id)).rejects.toThrow();
    await expect(
      announcements.getVersion(alice.actor, a.id, v.id),
    ).rejects.toThrow();
    await expect(
      announcements.acknowledge(alice.actor, a.id, v.id),
    ).rejects.toThrow();
  });
  it('invalidates all older admissions and targets after a restored scope generation', async () => {
    const m = await meeting();
    await admit(m.id);
    await db.accessScope.update({
      where: { id: m.id },
      data: { restoreGeneration: { increment: 1 } },
    });
    await expect(meetings.get(owner.actor, m.id)).rejects.toThrow();
    await expect(meetings.get(alice.actor, m.id)).rejects.toThrow();
  });
  it('rejects stale revisions and conflicting idempotency payloads without changing authoritative state', async () => {
    const m = await meeting([]),
      key = randomUUID();
    const first = await meetings.patch(
      owner.actor,
      m.id,
      m.revision,
      { externalUrl: null },
      key,
    );
    expect(
      (
        await meetings.patch(
          owner.actor,
          m.id,
          m.revision,
          { externalUrl: null },
          key,
        )
      ).revision,
    ).toBe(first.revision);
    await expect(
      meetings.patch(
        owner.actor,
        m.id,
        m.revision,
        { externalUrl: 'https://example.test/new' },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await expect(
      meetings.patch(
        owner.actor,
        m.id,
        m.revision,
        { externalUrl: 'https://example.test/new' },
        key,
      ),
    ).rejects.toThrow();
  });
  it('extends the legacy Team meeting with the same calendar event while preserving its source-readable agenda', async () => {
    const source = await work('TEAM');
    await join(source.id, alice, 'MEMBER', 'TEAM');
    const legacy = app.get(TeamMeetingsService),
      old = await legacy.create(
        owner.actor,
        source.id,
        { id: randomUUID(), event, agenda: 'Legacy agenda' },
        randomUUID(),
      );
    const extended = await legacy.extend(
      owner.actor,
      source.id,
      old.id,
      old.revision,
      randomUUID(),
    );
    expect(extended.event.id).toBe(old.event.id);
    expect((await legacy.read(alice.actor, source.id, old.id)).agenda).toBe(
      'Legacy agenda',
    );
    await expect(meetings.get(alice.actor, extended.id)).rejects.toThrow();
    expect(
      (await meetings.agenda(owner.actor, extended.id, page)).items[0]!.text,
    ).toBe('Legacy agenda');
  });
  it('filters new confidential Team meeting events before calendar pagination and denies schedule writes by unadmitted administrators', async () => {
    const source = await work('TEAM');
    await join(source.id, alice, 'ADMIN', 'TEAM');
    const m = await meeting([alice], { id: source.id, kind: 'TEAM' }),
      workApi = app.get(TeamWorkService);
    await expect(
      workApi.calendarCommand(alice.actor, source.id, {
        kind: 'READ',
        id: m.event.id,
      }),
    ).rejects.toThrow();
    expect(
      c.TeamCalendarPageSchema.parse(
        await workApi.calendarCommand(alice.actor, source.id, {
          kind: 'LIST',
          query: { limit: '1' },
        }),
      ).items,
    ).toEqual([]);
    await expect(
      workApi.calendarCommand(alice.actor, source.id, {
        kind: 'PATCH',
        id: m.event.id,
        revision: m.event.revision,
        input: { description: 'Changed' },
      }),
    ).rejects.toThrow();
    await admit(m.id);
    expect(
      c.TeamCalendarPageSchema.parse(
        await workApi.calendarCommand(alice.actor, source.id, {
          kind: 'LIST',
          query: { limit: '1' },
        }),
      ).items[0]!.id,
    ).toBe(m.event.id);
    await expect(
      workApi.calendarCommand(alice.actor, source.id, {
        kind: 'PATCH',
        id: m.event.id,
        revision: m.event.revision,
        input: { description: 'Changed' },
      }),
    ).rejects.toThrow();
  });
  it('requires fresh reviewer eligibility at finalization and fresh approval after withdrawal', async () => {
    const m = await meeting();
    await admit(m.id);
    let v = await draft(m.id, await memberId(m.id));
    v = await documents.submit(
      owner.actor,
      m.id,
      v.id,
      v.revision,
      randomUUID(),
    );
    v = await documents.review(
      alice.actor,
      m.id,
      v.id,
      { decision: 'APPROVE', reason: 'Approved' },
      v.revision,
      randomUUID(),
    );
    v = await documents.withdraw(
      owner.actor,
      m.id,
      v.id,
      v.revision,
      randomUUID(),
    );
    await expect(
      documents.finalize(owner.actor, m.id, v.id, v.revision, randomUUID()),
    ).rejects.toThrow();
    v = await documents.submit(
      owner.actor,
      m.id,
      v.id,
      v.revision,
      randomUUID(),
    );
    v = await documents.review(
      alice.actor,
      m.id,
      v.id,
      { decision: 'APPROVE', reason: 'Fresh approval' },
      v.revision,
      randomUUID(),
    );
    await meetings.leave(alice.actor, m.id, 1, randomUUID());
    await expect(
      documents.finalize(owner.actor, m.id, v.id, v.revision, randomUUID()),
    ).rejects.toThrow();
  });
  it('freezes selected agenda with the minutes and retains a nullable private Task link after its Task is erased', async () => {
    const m = await meeting([]);
    const entry = await meetings.propose(
      owner.actor,
      m.id,
      { id: randomUUID(), text: 'Selected immutable agenda' },
      randomUUID(),
    );
    await meetings.selectAgenda(
      owner.actor,
      m.id,
      entry.id,
      'ACCEPTED',
      entry.revision,
      randomUUID(),
    );
    let v = await draft(m.id);
    expect(v.agenda).toEqual([{ id: entry.id, text: entry.text }]);
    await meetings.selectAgenda(
      owner.actor,
      m.id,
      entry.id,
      'REJECTED',
      2,
      randomUUID(),
    );
    expect((await documents.get(owner.actor, m.id, v.id)).agenda).toEqual(
      v.agenda,
    );
    v = await documents.finalize(
      owner.actor,
      m.id,
      v.id,
      v.revision,
      randomUUID(),
    );
    await expect(
      db.meetingVersion.update({ where: { id: v.id }, data: { agenda: [] } }),
    ).rejects.toThrow();
    const action = v.actions[0]!.id,
      link = await documents.convert(
        owner.actor,
        m.id,
        action,
        {},
        randomUUID(),
      );
    await db.task.delete({ where: { id: link.task!.id } });
    const rows = await documents.links(owner.actor, m.id, action, page);
    expect(rows.items[0]!.task).toBeNull();
    expect(await db.meetingTaskLink.count({ where: { id: link.id } })).toBe(1);
  });
  it('does not add meeting or announcement discovery to chat Push activity', async () => {
    const before = await db.messageActivity.count();
    const m = await meeting();
    await admit(m.id);
    const source = await work(),
      a = await announcements.create(
        owner.actor,
        { id: randomUUID(), kind: 'PROJECT', sourceId: source.id },
        randomUUID(),
      );
    const v = await announcements.createVersion(
      owner.actor,
      a.id,
      {
        id: randomUUID(),
        title: 'No Push',
        text: 'REST discovery only',
        acknowledgement: false,
        attachments: [],
      },
      randomUUID(),
    );
    await announcements.publish(
      owner.actor,
      a.id,
      v.id,
      { audience: 'ALL' },
      v.revision,
      randomUUID(),
    );
    expect(await db.messageActivity.count()).toBe(before);
    await expect(
      announcements.acknowledge(owner.actor, a.id, v.id),
    ).rejects.toThrow();
  });
  it('erases private acknowledgement and Task state through actual account closure/purge while retaining final shared content', async () => {
    const m = await meeting(),
      v = await approved(m.id),
      link = await documents.convert(
        alice.actor,
        m.id,
        v.actions[0]!.id,
        {},
        randomUUID(),
      ),
      source = await work();
    await join(source.id);
    const a = await announcements.create(
      owner.actor,
      { id: randomUUID(), kind: 'PROJECT', sourceId: source.id },
      randomUUID(),
    );
    let notice = await announcements.createVersion(
      owner.actor,
      a.id,
      {
        id: randomUUID(),
        title: 'Retained',
        text: 'Shared content',
        acknowledgement: true,
        attachments: [],
      },
      randomUUID(),
    );
    notice = await announcements.publish(
      owner.actor,
      a.id,
      notice.id,
      { audience: 'ALL' },
      notice.revision,
      randomUUID(),
    );
    await announcements.acknowledge(alice.actor, a.id, notice.id);
    const session = await cookie(alice),
      challenge = c.DeletionChallengeSchema.parse(
        (
          await request(app.getHttpServer())
            .post('/api/v1/me/deletion-request')
            .set('Cookie', session)
            .set('Origin', origin)
            .set('Idempotency-Key', randomUUID())
            .send({
              password,
              accountRevision: 1,
              retentionAcknowledged: true,
              policyVersion: 'synthetic-p503-erasure',
            })
            .expect(201)
        ).body,
      );
    await request(app.getHttpServer())
      .post('/api/v1/me/deletion-request/confirm')
      .set('Cookie', session)
      .set('Origin', origin)
      .set('X-Deletion-Proof', challenge.confirmationProof)
      .send({ jobId: challenge.job.id, revision: 1 })
      .expect(201);
    expect(
      await db.announcementAcknowledgement.count({
        where: { versionId: notice.id },
      }),
    ).toBe(0);
    await expect(documents.get(alice.actor, m.id, v.id)).rejects.toThrow();
    await db.accountDeletionJob.update({
      where: { id: challenge.job.id },
      data: { eraseAfter: new Date(0), nextAt: new Date(0) },
    });
    const lifecycle = app.get(PersonalLifecycle);
    for (
      let i = 0;
      i < 8 && (await db.user.count({ where: { id: alice.actor.userId } }));
      i++
    )
      await lifecycle.consume();
    expect(await db.user.count({ where: { id: alice.actor.userId } })).toBe(0);
    expect(
      (await db.meetingTaskLink.findUniqueOrThrow({ where: { id: link.id } }))
        .taskId,
    ).toBeNull();
    expect((await documents.get(owner.actor, m.id, v.id)).state).toBe('FINAL');
    expect(
      (await announcements.getVersion(owner.actor, a.id, notice.id)).text,
    ).toBe('Shared content');
  });
  it('serializes concurrent work creation retries to one Calendar event and keeps accepted RSVP discoverable', async () => {
    const source = await work(),
      input = c.MeetingCreateSchema.parse({
        id: randomUUID(),
        kind: 'PROJECT',
        sourceId: source.id,
        event,
        participants: [],
      }),
      key = randomUUID();
    const [a, b] = await Promise.all([
      meetings.create(owner.actor, input, key),
      meetings.create(owner.actor, input, key),
    ]);
    expect(a.event.id).toBe(b.event.id);
    const m = await meeting();
    await admit(m.id, alice, 'TENTATIVE');
    let offer = (await meetings.invitations(alice.actor, page)).items.find(
      (x) => x.meetingId === m.id,
    )!;
    expect(offer.state).toBe('TENTATIVE');
    await meetings.rsvp(
      alice.actor,
      offer.id,
      offer.revision,
      'ACCEPTED',
      randomUUID(),
    );
    offer = (await meetings.invitations(alice.actor, page)).items.find(
      (x) => x.meetingId === m.id,
    )!;
    expect(offer.state).toBe('ACCEPTED');
  });
  it('delegates independent organization through real Calendar authority and never silently promotes the last participant', async () => {
    const m = await meeting([alice, bob]);
    await admit(m.id);
    await admit(m.id, bob);
    const members = await meetings.members(owner.actor, m.id, page);
    expect(members.items).toHaveLength(3);
    const aliceId = await memberId(m.id),
      role = await meetings.memberRole(
        owner.actor,
        m.id,
        aliceId,
        'ORGANIZER',
        1,
        randomUUID(),
      );
    expect(role.role).toBe('ORGANIZER');
    await meetings.leave(owner.actor, m.id, 1, randomUUID());
    const current = await meetings.get(alice.actor, m.id);
    expect(
      (
        await meetings.patch(
          alice.actor,
          m.id,
          current.revision,
          { event: { title: 'Delegated calendar authority' } },
          randomUUID(),
        )
      ).event.title,
    ).toBe('Delegated calendar authority');
    await meetings.leave(alice.actor, m.id, role.revision, randomUUID());
    expect((await meetings.get(bob.actor, m.id)).role).toBe('PARTICIPANT');
    await expect(
      meetings.patch(bob.actor, m.id, 1, { state: 'CANCELED' }, randomUUID()),
    ).rejects.toThrow();
  });
  it('requires current announcement management for private draft files, then authorizes bytes only through the published snapshot', async () => {
    const source = await work(),
      access = await join(source.id, alice, 'ADMIN'),
      a = await announcements.create(
        alice.actor,
        { id: randomUUID(), kind: 'PROJECT', sourceId: source.id },
        randomUUID(),
      ),
      parent = { kind: 'ANNOUNCEMENT' as const, id: a.id },
      f = await uploadFile(parent, alice);
    let v = await announcements.createVersion(
      alice.actor,
      a.id,
      {
        id: randomUUID(),
        title: 'File publication',
        text: 'Document',
        acknowledgement: false,
        attachments: [f.id],
      },
      randomUUID(),
    );
    await expect(
      files.status(owner.actor, parent, f.id),
    ).resolves.toBeDefined();
    await kernel.changeAccess(owner.actor, {
      spaceId: source.id,
      scopeId: source.id,
      accessId: access.id,
      revision: access.revision,
      state: 'ACTIVE',
      memberRole: 'MEMBER',
    });
    await expect(
      announcements.getVersion(alice.actor, a.id, v.id),
    ).rejects.toThrow();
    await expect(files.status(alice.actor, parent, f.id)).rejects.toThrow();
    expect((await files.list(alice.actor, parent, page)).items).toEqual([]);
    v = await announcements.publish(
      owner.actor,
      a.id,
      v.id,
      { audience: 'ALL' },
      v.revision,
      randomUUID(),
    );
    expect((await files.status(alice.actor, parent, f.id)).status).toBe(
      'READY',
    );
    await announcements.withdraw(
      owner.actor,
      a.id,
      v.id,
      v.revision,
      randomUUID(),
    );
    await expect(files.download(alice.actor, parent, f.id)).rejects.toThrow();
  });
  it('keeps cancellation in the authoritative Calendar and rolls back action conversion when that event is canceled', async () => {
    let m = await meeting([]);
    const v = await draft(m.id),
      final = await documents.finalize(
        owner.actor,
        m.id,
        v.id,
        v.revision,
        randomUUID(),
      );
    m = await meetings.patch(
      owner.actor,
      m.id,
      m.revision,
      { state: 'CANCELED' },
      randomUUID(),
    );
    expect(m.event.status).toBe('CANCELED');
    await expect(
      documents.convert(
        owner.actor,
        m.id,
        final.actions[0]!.id,
        {},
        randomUUID(),
      ),
    ).rejects.toThrow();
    m = await meetings.patch(
      owner.actor,
      m.id,
      m.revision,
      { event: { status: 'ACTIVE' } },
      randomUUID(),
    );
    expect(m.state).toBe('ACTIVE');
    expect(m.event.status).toBe('ACTIVE');
    const shared = await meeting();
    await admit(shared.id);
    await meetings.patch(
      owner.actor,
      shared.id,
      shared.revision,
      { state: 'CANCELED' },
      randomUUID(),
    );
    await meetings.remove(
      owner.actor,
      shared.id,
      await memberId(shared.id),
      1,
      randomUUID(),
    );
    await expect(meetings.get(alice.actor, shared.id)).rejects.toThrow();
  });
  it('enforces verified HTTP sessions, strict request boundaries, required headers and private response caching', async () => {
    const m = await meeting([]),
      session = await cookie(owner),
      server = app.getHttpServer();
    await request(server)
      .get('/api/v1/meetings/' + m.id)
      .expect(401);
    const result = await request(server)
      .get('/api/v1/meetings/' + m.id)
      .set('Cookie', session)
      .expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(c.MeetingSchema.parse(result.body).id).toBe(m.id);
    await request(server)
      .get('/api/v1/meetings/' + m.id + '?userId=' + outsider.actor.userId)
      .set('Cookie', session)
      .expect(400);
    await request(server)
      .patch('/api/v1/meetings/' + m.id)
      .set('Cookie', session)
      .set('Origin', origin)
      .send({ state: 'CANCELED' })
      .expect(400);
    await request(server)
      .post('/api/v1/meetings/' + m.id + '/versions')
      .set('Cookie', session)
      .set('Origin', origin)
      .set('Idempotency-Key', randomUUID())
      .send({
        id: randomUUID(),
        minutes: 'Text',
        decisions: [],
        actions: [],
        authorMemberId: randomUUID(),
      })
      .expect(400);
  });
});
