import { cleanupFixtureIdentities } from '../support/fixture-cleanup.js';
import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as c from '@mehran/api-contracts';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { PersonalJournal } from '../../src/modules/journal/public/index.js';
import * as outbox from '../../src/platform/outbox/outbox.js';
type Actor = { id: string; spaceId: string; cookie: string };
describe('P1-08 private writing, capture and personal search', () => {
  let app: NestExpressApplication, db: DatabaseService, a: Actor, b: Actor;
  const users: string[] = [],
    origin = 'http://localhost:3000',
    databaseUrl = isolatedTestDatabaseUrl(process.env);
  const call = (
    actor: Actor,
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    revision?: number,
  ) => {
    const req = request(app.getHttpServer())
      [method]('/api/v1' + path)
      .set('Cookie', actor.cookie)
      .set('Origin', origin);
    if (revision !== undefined) req.set('If-Match', '"' + revision + '"');
    return req;
  };
  async function identity(): Promise<Actor> {
    const email = `p108-${randomUUID()}@example.test`,
      password = 'test-only-habits-password-123!';
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'Writing fixture' })
      .expect(200);
    const id = signup.body.user.id as string;
    users.push(id);
    const link = new URL(
      app.get(IdentityMailService).latestForTest(email, 'verify-email')!.url,
    );
    link.searchParams.delete('callbackURL');
    await request(app.getHttpServer())
      .get(link.pathname + link.search)
      .expect(200);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email, password })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])
        .map((v) => v.split(';')[0])
        .join('; '),
      space = await db.client.space.findFirstOrThrow({
        where: { ownerUserId: id },
      });
    return { id, spaceId: space.id, cookie };
  }

  beforeAll(async () => {
    app = await testApplication({ databaseUrl });
    db = app.get(DatabaseService);
    a = await identity();
    b = await identity();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    if (db) await cleanupFixtureIdentities(databaseUrl, { ids: users });
    await app?.close();
  });
  const content = (text = 'Private reflection') => ({
    format: 'MARKDOWN',
    version: 1,
    content: text,
  });
  const note = async (input: object = {}, actor = a, key = randomUUID()) =>
    c.NoteSchema.parse(
      (
        await call(actor, 'post', '/notes')
          .set('Idempotency-Key', key)
          .send({ title: 'Private note', content: content(), ...input })
          .expect(201)
      ).body,
    );
  const folder = async (input: object = {}, actor = a) =>
    c.NoteFolderSchema.parse(
      (
        await call(actor, 'post', '/notes/folders')
          .set('Idempotency-Key', randomUUID())
          .send({ title: 'Folder', ...input })
          .expect(201)
      ).body,
    );
  const journal = async (input: object = {}, actor = a, key = randomUUID()) =>
    c.JournalEntrySchema.parse(
      (
        await call(actor, 'post', '/journal/entries')
          .set('Idempotency-Key', key)
          .send({
            content: content(),
            localDate: '2024-01-01',
            timezone: 'UTC',
            ...input,
          })
          .expect(201)
      ).body,
    );
  const mood = async (input: object = {}, actor = a) =>
    c.MoodEntrySchema.parse(
      (
        await call(actor, 'post', '/moods')
          .set('Idempotency-Key', randomUUID())
          .send({
            mood: 3,
            energy: 2,
            note: 'Private mood note',
            localDate: '2024-01-01',
            timezone: 'UTC',
            ...input,
          })
          .expect(201)
      ).body,
    );
  const capture = async (input: object = {}, actor = a, key = randomUUID()) =>
    c.CaptureSchema.parse(
      (
        await call(actor, 'post', '/capture')
          .set('Idempotency-Key', key)
          .send({ type: 'DRAFT', text: 'Private raw capture', ...input })
          .expect(201)
      ).body,
    );
  const triage = async (
    item: c.Capture,
    input: object,
    key = randomUUID(),
    actor = a,
  ) =>
    c.CaptureSchema.parse(
      (
        await call(
          actor,
          'post',
          '/capture/' + item.id + '/triage',
          item.revision,
        )
          .set('Idempotency-Key', key)
          .send(input)
          .expect(200)
      ).body,
    );
  const search = async (q: object, actor = a) =>
    c.PersonalSearchPageSchema.parse(
      (await call(actor, 'get', '/search/personal').query(q).expect(200)).body,
    );
  const task = async (actor = a) =>
    c.TaskSchema.parse(
      (
        await call(actor, 'post', '/tasks')
          .send({ title: 'Existing linked Task' })
          .expect(201)
      ).body,
    );
  function wav() {
    const bytes = Buffer.alloc(48);
    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(40, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(8000, 24);
    bytes.writeUInt32LE(16000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(4, 40);
    return bytes;
  }
  const uploadVoice = async (actor = a, bytes = wav()) => {
    const initiated = c.VoiceStoredFileSchema.parse(
      (
        await call(actor, 'post', '/files/voice/uploads')
          .set('Idempotency-Key', randomUUID())
          .send({
            filename: 'memo.wav',
            mimeType: 'audio/wav',
            expectedSize: bytes.length,
          })
          .expect(201)
      ).body,
    );
    return c.VoiceStoredFileSchema.parse(
      (
        await call(actor, 'post', '/files/voice/' + initiated.id + '/complete')
          .set('Content-Type', 'application/octet-stream')
          .send(bytes)
          .expect(200)
      ).body,
    );
  };
  it('creates organized Notes and preserves content through folder moves/archive/restore', async () => {
    const f = await folder({ position: 2 }),
      g = await folder({ position: 1 });
    let n = await note({ folderId: f.id });
    n = c.NoteSchema.parse(
      (
        await call(a, 'patch', '/notes/' + n.id, n.revision)
          .send({ folderId: g.id, state: 'ARCHIVED' })
          .expect(200)
      ).body,
    );
    expect(n.content).toEqual(content());
    n = c.NoteSchema.parse(
      (
        await call(a, 'patch', '/notes/' + n.id, n.revision)
          .send({ state: 'ACTIVE' })
          .expect(200)
      ).body,
    );
    expect(n.folderId).toBe(g.id);
    await call(a, 'delete', '/notes/folders/' + g.id, g.revision).expect(200);
    expect(
      c.NoteSchema.parse(
        (await call(a, 'get', '/notes/' + n.id).expect(200)).body,
      ).content,
    ).toEqual(content());
    await call(a, 'post', '/notes')
      .set('Idempotency-Key', randomUUID())
      .send({ title: 'x', content: content(), folderId: g.id })
      .expect(400);
  });
  it('prevents folder cycles including subtree depth and concurrent reciprocal edits', async () => {
    const root = await folder();
    let parent = root;
    for (let i = 0; i < 4; i++) parent = await folder({ parentId: parent.id });
    await call(a, 'post', '/notes/folders')
      .set('Idempotency-Key', randomUUID())
      .send({ title: 'deep', parentId: parent.id })
      .expect(400);
    await call(a, 'patch', '/notes/folders/' + root.id, root.revision)
      .send({ parentId: parent.id })
      .expect(400);
    const x = await folder(),
      y = await folder(),
      r = await Promise.all([
        call(a, 'patch', '/notes/folders/' + x.id, x.revision).send({
          parentId: y.id,
        }),
        call(a, 'patch', '/notes/folders/' + y.id, y.revision).send({
          parentId: x.id,
        }),
      ]);
    expect(r.map((v) => v.status).sort()).toEqual([200, 400]);
  });
  it('retains immutable Note values and authorized deleted history', async () => {
    let n = await note();
    const id = n.id;
    n = c.NoteSchema.parse(
      (
        await call(a, 'patch', '/notes/' + id, n.revision)
          .send({ content: content('Corrected reflection') })
          .expect(200)
      ).body,
    );
    n = c.NoteSchema.parse(
      (await call(a, 'delete', '/notes/' + id, n.revision).expect(200)).body,
    );
    await call(a, 'get', '/notes/' + id).expect(404);
    expect(
      c.NoteSchema.parse(
        (
          await call(a, 'get', '/notes/' + id)
            .query({ includeDeleted: 'true' })
            .expect(200)
        ).body,
      ).state,
    ).toBe('DELETED');
    const history = c.NotePageSchema.parse(
      (await call(a, 'get', '/notes/' + id + '/history').expect(200)).body,
    );
    expect(history.items.map((v) => v.revision)).toEqual([1, 2, 3]);
    expect(history.items[0]?.content).toEqual(content());
    await call(a, 'patch', '/notes/' + id, n.revision)
      .send({ state: 'ACTIVE' })
      .expect(200);
  });
  it('accepts large bounded Notes and safely rejects executable Markdown and excess input', async () => {
    const n = await note({ content: content('x'.repeat(50000)) });
    expect(n.content.content.length).toBe(50000);
    for (const value of [
      '<script>private()</script>',
      '[link](javascript:private())',
      'x'.repeat(50001),
    ])
      await call(a, 'post', '/notes')
        .set('Idempotency-Key', randomUUID())
        .send({ title: 'x', content: content(value) })
        .expect(400);
  });
  it('annotates existing Task/Goal identities and denies foreign references', async () => {
    const t = await task(),
      goal = c.GoalSchema.parse(
        (
          await call(a, 'post', '/goals')
            .set('Idempotency-Key', randomUUID())
            .send({ title: 'Existing Goal', horizon: 'SHORT_TERM' })
            .expect(201)
        ).body,
      ),
      n = await note({ taskId: t.id, goalId: goal.id });
    expect(n.taskId).toBe(t.id);
    expect(
      c.TaskSchema.parse(
        (await call(a, 'get', '/tasks/' + t.id).expect(200)).body,
      ).revision,
    ).toBe(t.revision);
    await call(a, 'delete', '/tasks/' + t.id, t.revision).expect(200);
    expect(
      c.NotePageSchema.parse(
        (await call(a, 'get', '/notes').query({ taskId: t.id }).expect(200))
          .body,
      ).items.map((v) => v.id),
    ).toContain(n.id);
    const foreign = await task(b);
    await call(a, 'post', '/notes')
      .set('Idempotency-Key', randomUUID())
      .send({ title: 'x', content: content(), taskId: foreign.id })
      .expect(404);
  });
  it('stores multiple freeform journal entries on one day with private correction history', async () => {
    let e = await journal();
    const second = await journal();
    expect(second.id).not.toBe(e.id);
    e = c.JournalEntrySchema.parse(
      (
        await call(a, 'patch', '/journal/entries/' + e.id, e.revision)
          .send({ content: content('Changed private journal') })
          .expect(200)
      ).body,
    );
    const history = c.JournalPageSchema.parse(
      (
        await call(a, 'get', '/journal/entries/' + e.id + '/history').expect(
          200,
        )
      ).body,
    );
    expect(history.items[0]?.content).toEqual(content());
    expect(history.items[0]?.localDate).toBe('2024-01-01');
    await call(a, 'patch', '/journal/entries/' + e.id, e.revision)
      .send({ localDate: '2024-01-02' })
      .expect(400);
  });
  it('creates at most one daily check-in under concurrency with atomic mood association', async () => {
    const input = {
        content: content('Daily private checkin'),
        localDate: '2024-02-29',
        timezone: 'UTC',
        mood: { mood: 4, energy: 3 },
      },
      r = await Promise.all([
        call(a, 'post', '/journal/daily-checkins')
          .set('Idempotency-Key', randomUUID())
          .send(input),
        call(a, 'post', '/journal/daily-checkins')
          .set('Idempotency-Key', randomUUID())
          .send(input),
      ]);
    expect(r.map((v) => v.status).sort()).toEqual([201, 409]);
    const result = c.DailyCheckinSchema.parse(
      r.find((v) => v.status === 201)!.body,
    );
    expect(result.mood?.journalEntryId).toBe(result.entry.id);
    const read = c.DailyCheckinSchema.parse(
      (await call(a, 'get', '/journal/daily-checkins/2024-02-29').expect(200))
        .body,
    );
    expect(read.entry.kind).toBe('CHECK_IN');
    expect(read.mood?.energy).toBe(3);
    expect(
      await db.client.moodEntry.count({
        where: {
          spaceId: a.spaceId,
          journalEntryId: result.entry.id,
          current: true,
        },
      }),
    ).toBe(1);
  });
  it('preserves Mood/energy corrections and VOID history without rewriting attributed dates', async () => {
    let e = await mood();
    e = c.MoodEntrySchema.parse(
      (
        await call(a, 'patch', '/moods/' + e.id, e.revision)
          .send({ mood: 5, energy: null, note: 'Changed mood' })
          .expect(200)
      ).body,
    );
    e = c.MoodEntrySchema.parse(
      (await call(a, 'delete', '/moods/' + e.id, e.revision).expect(200)).body,
    );
    const history = c.MoodPageSchema.parse(
      (await call(a, 'get', '/moods/' + e.id + '/history').expect(200)).body,
    );
    expect(history.items.map((v) => v.state)).toEqual([
      'RECORDED',
      'RECORDED',
      'VOID',
    ]);
    expect(history.items[0]).toMatchObject({
      mood: 3,
      energy: 2,
      localDate: '2024-01-01',
      timezone: 'UTC',
    });
    await call(a, 'patch', '/moods/' + e.id, e.revision)
      .send({ void: false })
      .expect(200);
  });
  it('uses saved local dates across midnight, DST and account travel', async () => {
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2024-03-11T03:59:59Z'));
      const first = c.JournalEntrySchema.parse(
        (
          await call(a, 'post', '/journal/entries')
            .set('Idempotency-Key', randomUUID())
            .send({ content: content(), timezone: 'America/New_York' })
            .expect(201)
        ).body,
      );
      expect(first.localDate).toBe('2024-03-10');
      vi.setSystemTime(new Date('2024-03-11T04:00:00Z'));
      const second = c.JournalEntrySchema.parse(
        (
          await call(a, 'post', '/journal/entries')
            .set('Idempotency-Key', randomUUID())
            .send({ content: content(), timezone: 'America/New_York' })
            .expect(201)
        ).body,
      );
      expect(second.localDate).toBe('2024-03-11');
      const settings = await call(a, 'get', '/me/settings').expect(200);
      await call(a, 'patch', '/me/settings', settings.body.revision)
        .send({ timezone: 'Asia/Tokyo' })
        .expect(200);
      expect(
        c.JournalEntrySchema.parse(
          (await call(a, 'get', '/journal/entries/' + first.id).expect(200))
            .body,
        ),
      ).toMatchObject({
        localDate: '2024-03-10',
        timezone: 'America/New_York',
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects future attribution and mismatched journal/mood contexts', async () => {
    await call(a, 'post', '/journal/entries')
      .set('Idempotency-Key', randomUUID())
      .send({ content: content(), localDate: '9998-01-01', timezone: 'UTC' })
      .expect(400);
    const e = await journal();
    await call(a, 'post', '/moods')
      .set('Idempotency-Key', randomUUID())
      .send({
        mood: 3,
        journalEntryId: e.id,
        localDate: '2024-01-02',
        timezone: 'UTC',
      })
      .expect(400);
  });
  it('never scans or reveals Journal/Mood in default search but honors per-request owner opt-in', async () => {
    const token = 'sensitive-' + randomUUID(),
      e = await journal({ content: content(token) }),
      m = await mood({ note: token }),
      provider = app.get(PersonalJournal),
      spy = vi.spyOn(provider, 'search');
    const before = await search({ q: token });
    expect(before.items).toEqual([]);
    expect(before.sources).not.toContain('JOURNAL');
    expect(before.sources).not.toContain('MOOD');
    expect(spy).not.toHaveBeenCalled();
    const explicit = await search({
      q: token,
      includeJournal: 'true',
      includeMood: 'true',
    });
    expect(explicit.items.map((v) => v.id).sort()).toEqual([e.id, m.id].sort());
    expect((await search({ q: token })).items).toEqual([]);
    expect(
      (
        await search(
          { q: token, includeJournal: 'true', includeMood: 'true' },
          b,
        )
      ).items,
    ).toEqual([]);
    await call(a, 'get', '/search/personal')
      .query({ q: token, types: 'JOURNAL' })
      .expect(400);
    await call(a, 'get', '/insights/overview').expect(404);
  });
  it('searches literal wildcard text with scoped stable cursors and excludes retained deletions', async () => {
    const token = 'literal%_' + randomUUID(),
      x = await note({ title: token, content: content(token) }),
      y = await note({ title: token, content: content(token) });
    await note({
      title: 'literal other',
      content: content('not a wildcard match'),
    });
    const first = await search({ q: token, types: 'NOTE', limit: '1' });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const next = await search({
      q: token,
      types: 'NOTE',
      limit: '1',
      cursor: first.nextCursor,
    });
    expect(next.items[0]?.id).not.toBe(first.items[0]?.id);
    expect([x.id, y.id]).toContain(next.items[0]?.id);
    await call(b, 'get', '/search/personal')
      .query({ q: token, types: 'NOTE', cursor: first.nextCursor })
      .expect(400);
    await call(a, 'get', '/search/personal')
      .query({ q: 'different', types: 'NOTE', cursor: first.nextCursor })
      .expect(400);
    await call(a, 'delete', '/notes/' + x.id, x.revision).expect(200);
    expect(
      (await search({ q: token, types: 'NOTE' })).items.map((v) => v.id),
    ).not.toContain(x.id);
  });
  it('converts capture to one Task atomically and replays without duplicating it', async () => {
    const item = await capture({ type: 'TASK' }),
      key = randomUUID(),
      input = { action: 'CREATE_TASK', task: { title: 'Captured Task' } },
      before = await db.client.task.count({ where: { spaceId: a.spaceId } });
    const first = await triage(item, input, key);
    expect(first.state).toBe('TRIAGED');
    expect(first.targetTaskId).not.toBeNull();
    expect(first.id).toBe(item.id);
    expect(first.text).toBe(item.text);
    expect(await triage(item, input, key)).toEqual(first);
    expect(await db.client.task.count({ where: { spaceId: a.spaceId } })).toBe(
      before + 1,
    );
    await call(a, 'post', '/capture/' + item.id + '/triage', first.revision)
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(409);
    await call(a, 'post', '/capture/' + item.id + '/triage', item.revision)
      .set('Idempotency-Key', key)
      .send({ action: 'CREATE_TASK', task: { title: 'Changed' } })
      .expect(409);
  });
  it('prevents duplicate targets under concurrent different-key triage', async () => {
    const item = await capture(),
      input = {
        action: 'CREATE_NOTE',
        note: { title: 'Captured Note', content: content() },
      },
      before = await db.client.note.count({ where: { spaceId: a.spaceId } });
    const r = await Promise.all([
      call(a, 'post', '/capture/' + item.id + '/triage', item.revision)
        .set('Idempotency-Key', randomUUID())
        .send(input),
      call(a, 'post', '/capture/' + item.id + '/triage', item.revision)
        .set('Idempotency-Key', randomUUID())
        .send(input),
    ]);
    expect(r.map((v) => v.status).sort()).toEqual([200, 409]);
    expect(await db.client.note.count({ where: { spaceId: a.spaceId } })).toBe(
      before + 1,
    );
  });
  it('rolls back target/source/outbox/receipt when failure occurs after target creation', async () => {
    const item = await capture(),
      key = randomUUID(),
      input = { action: 'CREATE_TASK', task: { title: 'Rollback Task' } },
      before = await db.client.task.count({ where: { spaceId: a.spaceId } }),
      real = outbox.appendOutbox;
    const spy = vi
      .spyOn(outbox, 'appendOutbox')
      .mockImplementation(async (tx, scope, event) => {
        if (event.type === 'capture.triaged')
          throw new Error('Injected failure after target creation');
        return real(tx, scope, event);
      });
    await call(a, 'post', '/capture/' + item.id + '/triage', item.revision)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(500);
    spy.mockRestore();
    expect(
      c.CaptureSchema.parse(
        (await call(a, 'get', '/capture/' + item.id).expect(200)).body,
      ),
    ).toMatchObject({
      state: 'INBOX',
      revision: item.revision,
      targetTaskId: null,
    });
    expect(await db.client.task.count({ where: { spaceId: a.spaceId } })).toBe(
      before,
    );
    expect(
      await db.client.outboxEvent.count({
        where: { aggregateId: item.id, type: 'capture.triaged' },
      }),
    ).toBe(0);
    expect((await triage(item, input, key)).targetTaskId).not.toBeNull();
    expect(await db.client.task.count({ where: { spaceId: a.spaceId } })).toBe(
      before + 1,
    );
  });
  it('supports explicit Note/Journal/Habit conversions with source-owned state and effects', async () => {
    const n = await triage(await capture({ type: 'NOTE' }), {
      action: 'CREATE_NOTE',
      note: { title: 'From inbox', content: content() },
    });
    expect(
      c.NoteSchema.parse(
        (await call(a, 'get', '/notes/' + n.targetNoteId).expect(200)).body,
      ).title,
    ).toBe('From inbox');
    const j = await triage(await capture({ type: 'JOURNAL' }), {
      action: 'CREATE_JOURNAL',
      journal: {
        content: content('Private captured journal'),
        localDate: '2024-01-01',
        timezone: 'UTC',
      },
    });
    expect(
      c.JournalEntrySchema.parse(
        (
          await call(a, 'get', '/journal/entries/' + j.targetJournalId).expect(
            200,
          )
        ).body,
      ).content.content,
    ).toBe('Private captured journal');
    const h = c.HabitSchema.parse(
      (
        await call(a, 'post', '/habits')
          .set('Idempotency-Key', randomUUID())
          .send({
            title: 'Existing Habit',
            type: 'CHECKBOX',
            unit: 'COUNT',
            target: '1',
            timezone: 'UTC',
            schedule: {
              version: 1,
              startDate: '2024-01-01',
              rule: { kind: 'DAILY' },
            },
          })
          .expect(201)
      ).body,
    );
    const source = await capture({ type: 'HABIT_LOG' }),
      converted = await triage(source, {
        action: 'RECORD_HABIT',
        habitId: h.id,
        entry: { habitRevision: h.revision, localDate: '2024-01-01' },
      });
    expect(
      c.HabitEntrySchema.parse(
        (
          await call(
            a,
            'get',
            '/habits/' + h.id + '/entries/' + converted.targetHabitEntryId,
          ).expect(200)
        ).body,
      ).value,
    ).toBe('1');
  });
  it('keeps expense drafts in Inbox without implicit posting and archives explicitly', async () => {
    const item = await capture({ type: 'EXPENSE' });
    await call(a, 'post', '/capture/' + item.id + '/triage', item.revision)
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'POST_EXPENSE', amount: '20' })
      .expect(400);
    expect(
      (await call(a, 'get', '/capture/' + item.id).expect(200)).body.state,
    ).toBe('INBOX');
    const archived = await triage(item, { action: 'ARCHIVE' });
    expect(archived).toMatchObject({
      state: 'ARCHIVED',
      targetTaskId: null,
      targetNoteId: null,
    });
    expect(
      c.FinanceAccountPageSchema.parse(
        (await call(a, 'get', '/finance/accounts').expect(200)).body,
      ).items,
    ).toEqual([]);
    expect(
      await db.client.transaction.count({ where: { spaceId: a.spaceId } }),
    ).toBe(0);
  });
  it('previews bounded parsing without writes, classification or due-date side effects', async () => {
    const count = await db.client.captureItem.count({
      where: { spaceId: a.spaceId },
    });
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2024-03-11T03:59:59Z'));
      const parsed = c.CaptureParseResultSchema.parse(
        (
          await call(a, 'post', '/capture/parse')
            .send({ text: 'Read tomorrow', timezone: 'America/New_York' })
            .expect(200)
        ).body,
      );
      expect(parsed).toMatchObject({
        rawText: 'Read tomorrow',
        title: 'Read',
        scheduledDate: '2024-03-11',
        recognized: true,
      });
      const unknown = c.CaptureParseResultSchema.parse(
        (
          await call(a, 'post', '/capture/parse')
            .send({ text: 'Read next Tuesday', timezone: 'UTC' })
            .expect(200)
        ).body,
      );
      expect(unknown.recognized).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    expect(
      await db.client.captureItem.count({ where: { spaceId: a.spaceId } }),
    ).toBe(count);
  });
  it('streams private WAV and keeps earlier file routes/contracts unchanged', async () => {
    const f = await uploadVoice();
    expect(f.mimeType).toBe('audio/wav');
    expect(f.download?.url).toContain('/files/voice/');
    const response = await request(app.getHttpServer())
      .get(f.download!.url)
      .set('Cookie', a.cookie)
      .set('Origin', origin)
      .expect(200);
    expect(response.body).toEqual(wav());
    expect(response.headers['content-disposition']).toContain('attachment');
    await call(a, 'post', '/files/' + f.id + '/complete')
      .send({})
      .expect(404);
    await call(a, 'delete', '/files/' + f.id).expect(404);
    await request(app.getHttpServer())
      .get(f.download!.url.replace('/files/voice/', '/files/'))
      .set('Cookie', a.cookie)
      .set('Origin', origin)
      .expect(404);
    await request(app.getHttpServer())
      .get(f.download!.url)
      .set('Cookie', b.cookie)
      .set('Origin', origin)
      .expect(404);
    const item = await capture({
        type: 'VOICE_MEMO',
        text: '',
        voiceFileId: f.id,
      }),
      converted = await triage(item, {
        action: 'CREATE_NOTE',
        note: {
          title: 'Voice summary',
          content: content('Explicit user text'),
        },
      });
    expect(converted.voiceFileId).toBe(f.id);
    expect(converted.text).toBe('');
    await call(a, 'delete', '/files/voice/' + f.id).expect(204);
    await request(app.getHttpServer())
      .get(f.download!.url)
      .set('Cookie', a.cookie)
      .set('Origin', origin)
      .expect(404);
  });
  it('denies foreign/not-ready/nonvoice files and rejects mismatched WAV bytes', async () => {
    const f = await uploadVoice(b);
    await call(a, 'post', '/capture')
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'VOICE_MEMO', voiceFileId: f.id })
      .expect(404);
    const initiated = c.VoiceStoredFileSchema.parse(
      (
        await call(a, 'post', '/files/voice/uploads')
          .set('Idempotency-Key', randomUUID())
          .send({
            filename: 'bad.wav',
            mimeType: 'audio/wav',
            expectedSize: 48,
          })
          .expect(201)
      ).body,
    );
    await call(a, 'post', '/capture')
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'VOICE_MEMO', voiceFileId: initiated.id })
      .expect(404);
    await call(a, 'post', '/files/voice/' + initiated.id + '/complete')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(48))
      .expect(400);
    expect(
      (
        await db.client.storedFile.findUniqueOrThrow({
          where: { id: initiated.id },
        })
      ).status,
    ).toBe('REJECTED');
    await call(a, 'post', '/files/uploads')
      .send({ filename: 'memo.wav', mimeType: 'audio/wav', expectedSize: 48 })
      .expect(400);
  });
  it('isolates every private resource/history/filter and source reference', async () => {
    const n = await note({}, b),
      f = await folder({}, b),
      j = await journal({}, b),
      m = await mood({}, b),
      cap = await capture({}, b);
    for (const path of [
      '/notes/' + n.id,
      '/notes/' + n.id + '/history',
      '/notes/folders/' + f.id,
      '/journal/entries/' + j.id,
      '/journal/entries/' + j.id + '/history',
      '/moods/' + m.id,
      '/moods/' + m.id + '/history',
      '/capture/' + cap.id,
    ]) {
      const response = await call(a, 'get', path).expect(404);
      expect(JSON.stringify(response.body)).not.toMatch(
        /Private note|Private reflection|Private mood|Private raw/,
      );
    }
    await call(a, 'get', '/notes').query({ folderId: f.id }).expect(404);
    await call(a, 'get', '/moods').query({ journalEntryId: j.id }).expect(404);
    await call(a, 'patch', '/journal/entries/' + j.id, j.revision)
      .send({ title: 'stolen' })
      .expect(404);
    await call(a, 'patch', '/moods/' + m.id, m.revision)
      .send({ mood: 5 })
      .expect(404);
    await call(a, 'post', '/capture/' + cap.id + '/triage', cap.revision)
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'CREATE_TASK', task: { title: 'stolen' } })
      .expect(404);
  });
  it('rejects stale/concurrent private writes and scopes idempotency to actor/body', async () => {
    const n = await note(),
      results = await Promise.all([
        call(a, 'patch', '/notes/' + n.id, n.revision).send({ title: 'first' }),
        call(a, 'patch', '/notes/' + n.id, n.revision).send({
          title: 'second',
        }),
      ]);
    expect(results.map((v) => v.status).sort()).toEqual([200, 409]);
    const key = randomUUID(),
      [x, y] = await Promise.all([capture({}, a, key), capture({}, a, key)]);
    expect(x).toEqual(y);
    expect((await capture({}, b, key)).id).not.toBe(x.id);
    await call(a, 'post', '/capture')
      .set('Idempotency-Key', key)
      .send({ type: 'DRAFT', text: 'Changed' })
      .expect(409);
  });
  it('enforces cross-space references and check-in identity in database constraints', async () => {
    const f = await folder({}, b),
      n = await note();
    await expect(
      db.client.note.update({
        where: { id: n.revisionId },
        data: { folderId: f.id },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const j = await journal({}, b),
      m = await mood();
    await expect(
      db.client.moodEntry.update({
        where: { id: m.revisionId },
        data: { journalEntryId: j.id },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
  it('records only metadata audit and empty version1 triage events', async () => {
    const item = await capture({ text: 'secret-capture-body-' + randomUUID() }),
      done = await triage(item, {
        action: 'CREATE_JOURNAL',
        journal: {
          content: content('secret-journal-body'),
          localDate: '2024-01-01',
          timezone: 'UTC',
        },
      });
    const event = await db.client.outboxEvent.findFirstOrThrow({
      where: { type: 'capture.triaged', aggregateId: done.id },
    });
    expect(event.version).toBe(1);
    expect(event.payload).toEqual({});
    const audit = await db.client.securityAuditEvent.findMany({
      where: { resourceId: { in: [done.id, done.targetJournalId!] } },
    });
    expect(JSON.stringify(audit)).not.toContain(item.text);
    expect(JSON.stringify(audit)).not.toContain('secret-journal-body');
    await request(app.getHttpServer())
      .get('/api/v1/journal/entries')
      .expect(401);
  });

  it('paginates mixed source kinds even if valid cross-table UUIDs and instants coincide', async () => {
    const token = 'mixed-' + randomUUID(),
      t = c.TaskSchema.parse(
        (await call(a, 'post', '/tasks').send({ title: token }).expect(201))
          .body,
      ),
      n = await note({ title: token });
    await db.client.note.update({
      where: { id: n.revisionId },
      data: { id: t.id, logicalId: t.id, createdAt: new Date(t.createdAt) },
    });
    const first = await search({ q: token, types: 'NOTE,TASK', limit: '1' });
    expect(first.items[0]).toMatchObject({ kind: 'NOTE', id: t.id });
    const second = await search({
      q: token,
      types: 'NOTE,TASK',
      limit: '1',
      cursor: first.nextCursor,
    });
    expect(second.items[0]).toMatchObject({ kind: 'TASK', id: t.id });
    expect(second.nextCursor).toBeNull();
  });
  it('rejects cursor reuse with changed private opt-in and enforces all day-scope isolation', async () => {
    const token = 'cursor-private-' + randomUUID();
    await note({ title: token });
    await note({ title: token });
    const first = await search({ q: token, types: 'NOTE', limit: '1' });
    await call(a, 'get', '/search/personal')
      .query({
        q: token,
        types: 'NOTE,JOURNAL',
        includeJournal: 'true',
        cursor: first.nextCursor,
      })
      .expect(400);
    await call(b, 'get', '/journal/daily-checkins/2024-02-29').expect(404);
    expect(
      c.JournalPageSchema.parse(
        (await call(b, 'get', '/journal/daily-checkins').expect(200)).body,
      ).items,
    ).toEqual([]);
  });
  it('rejects foreign Goal/folder links and foreign nested Habit conversion without side effects', async () => {
    const goal = c.GoalSchema.parse(
        (
          await call(b, 'post', '/goals')
            .set('Idempotency-Key', randomUUID())
            .send({ title: 'Foreign Goal', horizon: 'SHORT_TERM' })
            .expect(201)
        ).body,
      ),
      f = await folder({}, b);
    await call(a, 'post', '/notes')
      .set('Idempotency-Key', randomUUID())
      .send({ title: 'x', content: content(), goalId: goal.id })
      .expect(404);
    await call(a, 'post', '/notes/folders')
      .set('Idempotency-Key', randomUUID())
      .send({ title: 'x', parentId: f.id })
      .expect(404);
    await call(a, 'get', '/notes').query({ goalId: goal.id }).expect(404);
    const h = c.HabitSchema.parse(
        (
          await call(b, 'post', '/habits')
            .set('Idempotency-Key', randomUUID())
            .send({
              title: 'Foreign Habit',
              type: 'CHECKBOX',
              unit: 'COUNT',
              target: '1',
              timezone: 'UTC',
              schedule: {
                version: 1,
                startDate: '2024-01-01',
                rule: { kind: 'DAILY' },
              },
            })
            .expect(201)
        ).body,
      ),
      item = await capture();
    await call(a, 'post', '/capture/' + item.id + '/triage', item.revision)
      .set('Idempotency-Key', randomUUID())
      .send({
        action: 'RECORD_HABIT',
        habitId: h.id,
        entry: { habitRevision: h.revision, localDate: '2024-01-01' },
      })
      .expect(404);
    expect(
      (await call(a, 'get', '/capture/' + item.id).expect(200)).body.state,
    ).toBe('INBOX');
    expect(await db.client.habitEntry.count({ where: { habitId: h.id } })).toBe(
      0,
    );
  });
  it('denies unauthenticated voice access and nonvoice IDs on voice routes', async () => {
    const f = await uploadVoice();
    await request(app.getHttpServer()).get(f.download!.url).expect(401);
    const text = Buffer.from('safe text'),
      start = c.StoredFileSchema.parse(
        (
          await call(a, 'post', '/files/uploads')
            .set('Idempotency-Key', randomUUID())
            .send({
              filename: 'safe.txt',
              mimeType: 'text/plain',
              expectedSize: text.length,
            })
            .expect(201)
        ).body,
      );
    const ready = c.StoredFileSchema.parse(
      (
        await call(a, 'post', '/files/' + start.id + '/complete')
          .set('Content-Type', 'application/octet-stream')
          .send(text)
          .expect(200)
      ).body,
    );
    await request(app.getHttpServer())
      .get(ready.download!.url.replace('/files/', '/files/voice/'))
      .set('Cookie', a.cookie)
      .set('Origin', origin)
      .expect(404);
    await call(a, 'post', '/capture')
      .set('Idempotency-Key', randomUUID())
      .send({ type: 'VOICE_MEMO', voiceFileId: ready.id })
      .expect(400);
    await call(a, 'delete', '/files/voice/' + ready.id).expect(404);
  });
  it('preserves revision-ordered histories and current-list cursors through physical replacements', async () => {
    const n = await note(),
      first = c.NotePageSchema.parse(
        (
          await call(a, 'get', '/notes/' + n.id + '/history')
            .query({ limit: '1' })
            .expect(200)
        ).body,
      );
    expect(first.items[0]?.revision).toBe(1);
    const changed = c.NoteSchema.parse(
      (
        await call(a, 'patch', '/notes/' + n.id, n.revision)
          .send({ title: 'New title' })
          .expect(200)
      ).body,
    );
    expect(changed.revisionId).not.toBe(n.revisionId);
    const history = c.NotePageSchema.parse(
      (
        await call(a, 'get', '/notes/' + n.id + '/history')
          .query({ limit: '1' })
          .expect(200)
      ).body,
    );
    const next = c.NotePageSchema.parse(
      (
        await call(a, 'get', '/notes/' + n.id + '/history')
          .query({ limit: '1', cursor: history.nextCursor })
          .expect(200)
      ).body,
    );
    expect(next.items[0]?.revision).toBe(2);
    await call(b, 'get', '/notes/' + n.id + '/history')
      .query({ cursor: history.nextCursor })
      .expect(404);
  });
  it('does not alter PlanningReview reflections while creating private Journal records', async () => {
    const existing = await db.client.planningReview.findMany({
      where: { spaceId: a.spaceId },
    });
    await journal({ content: content('Independent Journal reflection') });
    expect(
      await db.client.planningReview.findMany({
        where: { spaceId: a.spaceId },
      }),
    ).toEqual(existing);
  });
});
