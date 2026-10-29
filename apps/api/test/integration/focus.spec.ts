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
import * as clockModule from '../../src/modules/focus/infrastructure/focus-clock.js';
type Actor = { id: string; spaceId: string; cookie: string };
describe('P1-07 focus timers, time accounting and ownership', () => {
  let app: NestExpressApplication,
    db: DatabaseService,
    a: Actor,
    b: Actor,
    clock: Date | undefined;
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
    const email = `p107-${randomUUID()}@example.test`,
      password = 'test-only-habits-password-123!';
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'Focus fixture' })
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

  const use = (ms: number) => {
    clock = new Date(Date.parse('2024-01-01T00:00:00Z') + ms);
  };
  beforeAll(async () => {
    const real = clockModule.readFocusClock;
    vi.spyOn(clockModule, 'readFocusClock').mockImplementation(async (tx) =>
      clock ? new Date(clock) : real(tx),
    );
    app = await testApplication({ databaseUrl });
    db = app.get(DatabaseService);
    a = await identity();
    b = await identity();
  });
  afterEach(() => {
    clock = undefined;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (db) await cleanupFixtureIdentities(databaseUrl, { ids: users });
    await app?.close();
  });
  const create = async (input: object = {}, actor = a, key = randomUUID()) =>
    c.FocusViewSchema.parse(
      (
        await call(actor, 'post', '/focus/sessions')
          .set('Idempotency-Key', key)
          .send({ title: 'Private focus', ...input })
          .expect(201)
      ).body,
    );
  const read = async (id: string) =>
    c.FocusViewSchema.parse(
      (await call(a, 'get', '/focus/sessions/' + id).expect(200)).body,
    );
  const action = async (s: c.FocusView, op: string, key = randomUUID()) =>
    c.FocusViewSchema.parse(
      (
        await call(a, 'post', '/focus/sessions/' + s.id + '/' + op, s.revision)
          .set('Idempotency-Key', key)
          .send({})
          .expect(200)
      ).body,
    );
  const entries = async (s: c.FocusView) =>
    c.TimePageSchema.parse(
      (
        await call(a, 'get', '/time-entries')
          .query({ sessionId: s.id })
          .expect(200)
      ).body,
    );
  const task = async (actor = a) =>
    c.TaskSchema.parse(
      (
        await call(actor, 'post', '/tasks')
          .send({ title: 'Private source task' })
          .expect(201)
      ).body,
    );
  const manual = async (input: object = {}, actor = a, key = randomUUID()) =>
    c.TimeEntrySchema.parse(
      (
        await call(actor, 'post', '/time-entries')
          .set('Idempotency-Key', key)
          .send({
            startAt: '2024-02-01T10:00:00Z',
            endAt: '2024-02-01T11:00:00Z',
            note: 'Private time note',
            ...input,
          })
          .expect(201)
      ).body,
    );
  const summary = async (
    from = '2024-01-01',
    to = '2024-01-02',
    timezone = 'UTC',
    actor = a,
  ) =>
    c.ProductivitySummarySchema.parse(
      (
        await call(actor, 'get', '/productivity/summary')
          .query({ from, to, timezone })
          .expect(200)
      ).body,
    );
  it('records exact work segments through pause/resume and explicit finish', async () => {
    use(0);
    let s = await create();
    expect(s.state).toBe('IDLE');
    s = await action(s, 'start');
    use(1234);
    s = await action(s, 'pause');
    expect(s.workMs).toBe(1234);
    use(10000);
    expect((await read(s.id)).workMs).toBe(1234);
    s = await action(s, 'resume');
    use(10678);
    s = await action(s, 'finish');
    expect(s.workMs).toBe(1912);
    const rows = await entries(s);
    expect(
      rows.items
        .toSorted((x, y) => (x.segmentOrdinal ?? 0) - (y.segmentOrdinal ?? 0))
        .map((e) => e.durationMs),
    ).toEqual([1234, 678]);
    expect(rows.items.every((e) => e.kind === 'TRACKED')).toBe(true);
    const history = c.FocusHistoryPageSchema.parse(
      (await call(a, 'get', '/focus/sessions/' + s.id + '/history').expect(200))
        .body,
    );
    expect(history.items.map((r) => r.action)).toEqual([
      'CREATE',
      'START',
      'PAUSE',
      'RESUME',
      'FINISH',
    ]);
    await call(a, 'post', '/focus/sessions/' + s.id + '/pause', s.revision)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(409);
  });
  it('prevents conflicting active timers across parallel requests and reserves paused sessions', async () => {
    use(0);
    const x = await create(),
      y = await create();
    const results = await Promise.all([
      call(a, 'post', '/focus/sessions/' + x.id + '/start', x.revision)
        .set('Idempotency-Key', randomUUID())
        .send({}),
      call(a, 'post', '/focus/sessions/' + y.id + '/start', y.revision)
        .set('Idempotency-Key', randomUUID())
        .send({}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    let winner = c.FocusViewSchema.parse(
      results.find((r) => r.status === 200)!.body,
    );
    const loser = winner.id === x.id ? y : x;
    winner = await action(winner, 'pause');
    await call(
      a,
      'post',
      '/focus/sessions/' + loser.id + '/start',
      loser.revision,
    )
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(409);
    await action(winner, 'stop');
    await action(await action(loser, 'start'), 'stop');
  });
  it('replays duplicate start/finish without duplicate TimeEntries', async () => {
    use(0);
    const s = await create(),
      startKey = randomUUID();
    const run = await action(s, 'start', startKey);
    expect(await action(s, 'start', startKey)).toEqual(run);
    use(500);
    const finishKey = randomUUID(),
      done = await action(run, 'finish', finishKey);
    expect(await action(run, 'finish', finishKey)).toEqual(done);
    expect((await entries(done)).items).toHaveLength(1);
    await call(a, 'post', '/focus/sessions/' + s.id + '/finish', done.revision)
      .set('Idempotency-Key', finishKey)
      .send({})
      .expect(409);
  });
  it('derives finite Pomodoro phases across downtime and excludes all breaks', async () => {
    use(0);
    let s = await create({
      mode: 'POMODORO',
      pomodoro: {
        workMinutes: 1,
        shortBreakMinutes: 1,
        longBreakMinutes: 2,
        longBreakEvery: 2,
        workIntervals: 3,
      },
    });
    s = await action(s, 'start');
    use(60000);
    expect((await read(s.id)).phase).toBe('SHORT_BREAK');
    await call(a, 'post', '/focus/sessions/' + s.id + '/finish', s.revision)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(409);
    use(180000);
    expect((await read(s.id)).phase).toBe('LONG_BREAK');
    use(999999);
    const projected = await read(s.id);
    expect(projected).toMatchObject({
      state: 'RUNNING',
      phase: 'READY_TO_FINISH',
      workMs: 180000,
      breakMs: 180000,
    });
    s = await action(s, 'finish');
    expect((await entries(s)).items.reduce((n, e) => n + e.durationMs, 0)).toBe(
      180000,
    );
  });
  it('stops partial or IDLE sessions without fabricating completion', async () => {
    use(0);
    let s = await create({
      mode: 'POMODORO',
      pomodoro: { workMinutes: 1, workIntervals: 1 },
    });
    s = await action(s, 'start');
    use(1000);
    s = await action(s, 'stop');
    expect(s.state).toBe('ABANDONED');
    expect((await entries(s)).items[0]?.durationMs).toBe(1000);
    const idle = await action(await create(), 'stop');
    expect((await entries(idle)).items).toEqual([]);
  });
  it('retains clock regression evidence without negative elapsed values', async () => {
    use(1000);
    let s = await create();
    s = await action(s, 'start');
    use(500);
    s = await action(s, 'pause');
    expect(s).toMatchObject({
      clockAdjusted: true,
      elapsedMs: 0,
      recordedAt: '2024-01-01T00:00:01.000Z',
    });
    s = await action(s, 'stop');
    expect(s.workMs).toBe(0);
  });
  it('retains deleted/completed Task references and never changes Task dates or revisions', async () => {
    use(0);
    let t = await task();
    let s = await create({ taskId: t.id, taskRevision: t.revision });
    s = await action(s, 'start');
    const unchanged = c.TaskSchema.parse(
      (await call(a, 'get', '/tasks/' + t.id).expect(200)).body,
    );
    expect(unchanged).toEqual(t);
    t = c.TaskSchema.parse(
      (
        await call(a, 'post', '/tasks/' + t.id + '/complete', t.revision)
          .send({})
          .expect(200)
      ).body,
    );
    expect((await read(s.id)).taskDisposition).toBe('DONE');
    await call(a, 'delete', '/tasks/' + t.id, t.revision).expect(200);
    expect((await read(s.id)).taskDisposition).toBe('DELETED');
    use(1000);
    s = await action(s, 'finish');
    expect((await entries(s)).items[0]?.taskId).toBe(t.id);
  });
  it('rejects new unavailable or stale source links while allowing IDLE detach', async () => {
    const t = await task(),
      s = await create({ taskId: t.id, taskRevision: t.revision });
    await call(a, 'post', '/focus/sessions')
      .set('Idempotency-Key', randomUUID())
      .send({ title: 'x', taskId: t.id, taskRevision: t.revision + 1 })
      .expect(409);
    const patched = c.FocusViewSchema.parse(
      (
        await call(a, 'patch', '/focus/sessions/' + s.id, s.revision)
          .send({ taskId: null })
          .expect(200)
      ).body,
    );
    expect(patched.taskId).toBeNull();
    expect(patched.mode).toBe('STOPWATCH');
    await action(patched, 'stop');
  });
  it('preserves manual correction and void history with stale revision protection', async () => {
    const e = await manual();
    let changed = c.TimeEntrySchema.parse(
      (
        await call(a, 'patch', '/time-entries/' + e.id, e.revision)
          .send({ endAt: '2024-02-01T11:30:00Z' })
          .expect(200)
      ).body,
    );
    expect(changed.durationMs).toBe(5400000);
    await call(a, 'patch', '/time-entries/' + e.id, e.revision)
      .send({ note: 'stale' })
      .expect(409);
    changed = c.TimeEntrySchema.parse(
      (
        await call(
          a,
          'delete',
          '/time-entries/' + e.id,
          changed.revision,
        ).expect(200)
      ).body,
    );
    expect(changed.state).toBe('VOID');
    const history = c.TimePageSchema.parse(
      (await call(a, 'get', '/time-entries/' + e.id + '/history').expect(200))
        .body,
    );
    expect(history.items.map((r) => r.revision)).toEqual([1, 2, 3]);
    expect(history.items[0]?.endAt).toBe('2024-02-01T11:00:00.000Z');
  });
  it('keeps generated tracked entries immutable', async () => {
    use(0);
    let s = await action(await create(), 'start');
    use(1000);
    s = await action(s, 'finish');
    const entry = (await entries(s)).items[0]!;
    await call(a, 'patch', '/time-entries/' + entry.id, entry.revision)
      .send({ note: 'tamper' })
      .expect(409);
    await call(a, 'delete', '/time-entries/' + entry.id, entry.revision).expect(
      409,
    );
  });
  it('uses interval union and exposes overlap without counting session totals again', async () => {
    await manual({
      startAt: '2024-04-01T10:00:00Z',
      endAt: '2024-04-01T11:00:00Z',
    });
    await manual({
      startAt: '2024-04-01T10:30:00Z',
      endAt: '2024-04-01T11:30:00Z',
    });
    const result = await summary('2024-04-01', '2024-04-02');
    expect(result).toMatchObject({
      recordedMs: 7200000,
      distinctWorkMs: 5400000,
      overlapMs: 1800000,
      manualMs: 7200000,
      trackedMs: 0,
    });
  });
  it('reports live work separately and transfers it to recorded work once', async () => {
    clock = new Date('2024-05-01T10:00:00Z');
    let s = await action(await create(), 'start');
    clock = new Date('2024-05-01T10:01:00Z');
    let result = await summary('2024-05-01', '2024-05-02');
    expect(result).toMatchObject({ recordedMs: 0, uncommittedWorkMs: 60000 });
    s = await action(s, 'finish');
    result = await summary('2024-05-01', '2024-05-02');
    expect(result).toMatchObject({
      recordedMs: 60000,
      trackedMs: 60000,
      uncommittedWorkMs: 0,
    });
    expect((await entries(s)).items).toHaveLength(1);
  });
  it('clips midnight and DST work accurately using requested view timezone', async () => {
    await manual({
      startAt: '2024-03-11T03:59:59.999Z',
      endAt: '2024-03-11T04:00:00.001Z',
      timezone: 'America/New_York',
    });
    const result = await summary(
      '2024-03-10',
      '2024-03-12',
      'America/New_York',
    );
    expect(result.recordedMs).toBe(2);
    expect(result.days.map((d) => d.recordedMs)).toEqual([1, 1]);
    await manual({
      startAt: '2024-11-03T05:30:00Z',
      endAt: '2024-11-03T06:30:00Z',
    });
    expect(
      (await summary('2024-11-03', '2024-11-04', 'America/New_York'))
        .recordedMs,
    ).toBe(3600000);
  });
  it('keeps historical timezone contexts after account timezone changes', async () => {
    const s = await create({ timezone: 'America/New_York' }),
      e = await manual({ timezone: 'America/New_York' });
    const settings = await call(a, 'get', '/me/settings').expect(200);
    await call(a, 'patch', '/me/settings', settings.body.revision)
      .send({ timezone: 'Asia/Tokyo' })
      .expect(200);
    expect((await read(s.id)).timezone).toBe('America/New_York');
    expect(
      c.TimeEntrySchema.parse(
        (await call(a, 'get', '/time-entries/' + e.id).expect(200)).body,
      ).timezone,
    ).toBe('America/New_York');
    const fresh = await create();
    expect(fresh.timezone).toBe('Asia/Tokyo');
    await action(s, 'stop');
    await action(fresh, 'stop');
  });
  it('owns Task estimates/flags in Tasks and preserves old response/history contracts', async () => {
    const t = await task();
    const initial = c.ProductivityTaskSchema.parse(
      (await call(a, 'get', '/tasks/' + t.id + '/productivity').expect(200))
        .body,
    );
    expect(initial).toMatchObject({
      estimatedMinutes: null,
      important: null,
      urgent: null,
      quadrant: 'UNCLASSIFIED',
    });
    let v = c.ProductivityTaskSchema.parse(
      (
        await call(a, 'patch', '/tasks/' + t.id + '/productivity', t.revision)
          .send({ estimatedMinutes: 30, important: true, urgent: false })
          .expect(200)
      ).body,
    );
    expect(v.quadrant).toBe('SCHEDULE');
    await call(a, 'patch', '/tasks/' + t.id + '/productivity', t.revision)
      .send({ urgent: true })
      .expect(409);
    v = c.ProductivityTaskSchema.parse(
      (
        await call(a, 'patch', '/tasks/' + t.id + '/productivity', v.revision)
          .send({ urgent: true })
          .expect(200)
      ).body,
    );
    expect(v).toMatchObject({ quadrant: 'DO', estimatedMinutes: 30 });
    c.TaskSchema.parse(
      (await call(a, 'get', '/tasks/' + t.id).expect(200)).body,
    );
    c.TaskChangePageSchema.parse(
      (await call(a, 'get', '/tasks/' + t.id + '/history').expect(200)).body,
    );
    const result = await summary();
    expect(result.tasks.quadrants.DO).toBeGreaterThanOrEqual(1);
    expect(result.tasks.estimatedMinutes).toBeGreaterThanOrEqual(30);
    const audit = await db.client.securityAuditEvent.findFirstOrThrow({
      where: { resourceId: t.id, action: 'TASK_PRODUCTIVITY_UPDATE' },
      orderBy: { occurredAt: 'asc' },
    });
    expect(audit.productivityFields).toEqual([
      'estimatedMinutes',
      'important',
      'urgent',
    ]);
  });
  it('serializes stale concurrent edits on sessions and manual entries', async () => {
    const s = await create();
    const results = await Promise.all([
      call(a, 'patch', '/focus/sessions/' + s.id, s.revision).send({
        title: 'a',
      }),
      call(a, 'patch', '/focus/sessions/' + s.id, s.revision).send({
        title: 'b',
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    await action(await read(s.id), 'stop');
    const e = await manual();
    const edits = await Promise.all([
      call(a, 'patch', '/time-entries/' + e.id, e.revision).send({ note: 'a' }),
      call(a, 'patch', '/time-entries/' + e.id, e.revision).send({ note: 'b' }),
    ]);
    expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it('deduplicates concurrent creates within actor/space/request scope', async () => {
    const key = randomUUID(),
      [x, y] = await Promise.all([create({}, a, key), create({}, a, key)]);
    expect(x).toEqual(y);
    await action(x, 'stop');
    const other = await create({}, b, key);
    expect(other.id).not.toBe(x.id);
    await call(
      b,
      'post',
      '/focus/sessions/' + other.id + '/stop',
      other.revision,
    )
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(200);
  });
  it('denies all foreign routes, source references, filters and private content', async () => {
    const s = await create({}, b),
      e = await manual({}, b),
      t = await task(b);
    for (const path of [
      '/focus/sessions/' + s.id,
      '/focus/sessions/' + s.id + '/history',
      '/time-entries/' + e.id,
      '/time-entries/' + e.id + '/history',
      '/tasks/' + t.id + '/productivity',
    ]) {
      const r = await call(a, 'get', path).expect(404);
      expect(JSON.stringify(r.body)).not.toMatch(
        /Private focus|Private time note|Private source task/,
      );
    }
    for (const op of ['start', 'pause', 'resume', 'finish', 'stop'])
      await call(a, 'post', '/focus/sessions/' + s.id + '/' + op, s.revision)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(404);
    await call(a, 'patch', '/time-entries/' + e.id, e.revision)
      .send({ note: 'x' })
      .expect(404);
    await call(a, 'delete', '/time-entries/' + e.id, e.revision).expect(404);
    await call(a, 'patch', '/tasks/' + t.id + '/productivity', t.revision)
      .send({ important: true })
      .expect(404);
    await call(a, 'post', '/focus/sessions')
      .set('Idempotency-Key', randomUUID())
      .send({ title: 'x', taskId: t.id, taskRevision: t.revision })
      .expect(404);
    await call(a, 'get', '/time-entries').query({ taskId: t.id }).expect(404);
    await call(a, 'get', '/time-entries')
      .query({ sessionId: s.id })
      .expect(404);
    await call(a, 'get', '/focus/sessions').query({ taskId: t.id }).expect(404);
  });
  it('enforces scoped foreign keys and one reserved current timer at database level', async () => {
    const t = await task(b),
      s = await create();
    const row = await db.client.focusSession.findFirstOrThrow({
      where: { logicalId: s.id, current: true },
    });
    await expect(
      db.client.focusSession.update({
        where: { id: row.id },
        data: { taskId: t.id, selectedTaskRevision: 1 },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const running = await action(s, 'start'),
      other = await create();
    await expect(
      db.client.focusSession.update({
        where: { id: other.revisionId },
        data: { state: 'RUNNING', runningSince: new Date(other.recordedAt) },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await action(running, 'stop');
  });
  it('keeps stable cursor ordering across current-row revision changes', async () => {
    const first = c.FocusPageSchema.parse(
      (
        await call(a, 'get', '/focus/sessions')
          .query({ limit: '1' })
          .expect(200)
      ).body,
    );
    expect(first.nextCursor).not.toBeNull();
    const second = c.FocusPageSchema.parse(
      (
        await call(a, 'get', '/focus/sessions')
          .query({ limit: '1', cursor: first.nextCursor })
          .expect(200)
      ).body,
    );
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    await call(b, 'get', '/focus/sessions')
      .query({ cursor: first.nextCursor })
      .expect(400);
  });
  it('rejects client timing, future entries, missing revision/key and anonymous access', async () => {
    const s = await create();
    await call(a, 'post', '/focus/sessions/' + s.id + '/start', s.revision)
      .set('Idempotency-Key', randomUUID())
      .send({ elapsedMs: 1 })
      .expect(400);
    await call(a, 'post', '/focus/sessions/' + s.id + '/start')
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(400);
    await call(a, 'post', '/focus/sessions/' + s.id + '/start', s.revision)
      .send({})
      .expect(400);
    await call(a, 'post', '/time-entries')
      .set('Idempotency-Key', randomUUID())
      .send({ startAt: '2099-01-01T00:00:00Z', endAt: '2099-01-01T01:00:00Z' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/focus/sessions')
      .expect(401);
    await action(s, 'stop');
  });
  it('keeps audit metadata private and rejects stale terminal mutations atomically', async () => {
    use(0);
    let s = await action(await create(), 'start');
    use(1000);
    s = await action(s, 'finish');
    const before = await db.client.timeEntry.count({
      where: { sessionId: s.id },
    });
    await call(a, 'post', '/focus/sessions/' + s.id + '/finish', s.revision)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(409);
    expect(
      await db.client.timeEntry.count({ where: { sessionId: s.id } }),
    ).toBe(before);
    const rows = await db.client.securityAuditEvent.findMany({
      where: { resourceId: s.id },
    });
    expect(JSON.stringify(rows)).not.toMatch(/Private focus|Private time note/);
  });

  it('reserves the final transition at revision limit so a timer cannot be stranded', async () => {
    use(0);
    const s = await create(),
      row = await db.client.focusSession.findFirstOrThrow({
        where: { id: s.revisionId },
      });
    await db.client.focusSession.update({
      where: { id: row.id },
      data: { current: false },
    });
    const id = randomUUID();
    await db.client.focusSession.create({
      data: {
        ...row,
        id,
        previousId: row.id,
        revision: 999,
        current: true,
        state: 'RUNNING',
        action: 'START',
        runningSince: row.recordedAt,
      },
    });
    const latest = await read(s.id);
    await call(a, 'post', '/focus/sessions/' + s.id + '/pause', latest.revision)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(400);
    use(1000);
    expect((await action(latest, 'stop')).revision).toBe(1000);
  });
  it('covers all explicit quadrants without inferring urgency from due dates', async () => {
    const t = await task();
    let revision = t.revision;
    for (const [important, urgent, quadrant] of [
      [true, true, 'DO'],
      [true, false, 'SCHEDULE'],
      [false, true, 'DELEGATE'],
      [false, false, 'ELIMINATE'],
      [null, false, 'UNCLASSIFIED'],
    ] as const) {
      const r = c.ProductivityTaskSchema.parse(
        (
          await call(a, 'patch', '/tasks/' + t.id + '/productivity', revision)
            .send({ important, urgent })
            .expect(200)
        ).body,
      );
      expect(r.quadrant).toBe(quadrant);
      revision = r.revision;
    }
  });
  it('keeps manual replay idempotent and isolates summary totals between owners', async () => {
    const key = randomUUID(),
      x = await manual(
        { startAt: '2024-07-01T10:00:00Z', endAt: '2024-07-01T11:00:00Z' },
        a,
        key,
      ),
      y = await manual(
        { startAt: '2024-07-01T10:00:00Z', endAt: '2024-07-01T11:00:00Z' },
        a,
        key,
      );
    expect(x).toEqual(y);
    expect(
      (await summary('2024-07-01', '2024-07-02', 'UTC', b)).recordedMs,
    ).toBe(0);
    expect((await summary('2024-07-01', '2024-07-02')).recordedMs).toBe(
      3600000,
    );
  });

  it('allows independent owners to run timers concurrently', async () => {
    const x = await create(),
      y = await create({}, b);
    const [first, second] = await Promise.all([
      call(a, 'post', '/focus/sessions/' + x.id + '/start', x.revision)
        .set('Idempotency-Key', randomUUID())
        .send({}),
      call(b, 'post', '/focus/sessions/' + y.id + '/start', y.revision)
        .set('Idempotency-Key', randomUUID())
        .send({}),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await action(c.FocusViewSchema.parse(first.body), 'stop');
    await call(
      b,
      'post',
      '/focus/sessions/' + y.id + '/stop',
      second.body.revision,
    )
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(200);
  });
  it('keeps list and history cursors stable after changing the current physical row', async () => {
    const t = await task(),
      x = await create({ taskId: t.id, taskRevision: t.revision }),
      y = await create({ taskId: t.id, taskRevision: t.revision });
    const first = c.FocusPageSchema.parse(
      (
        await call(a, 'get', '/focus/sessions')
          .query({ taskId: t.id, limit: '1' })
          .expect(200)
      ).body,
    );
    const current = first.items[0]!;
    const changed = c.FocusViewSchema.parse(
      (
        await call(
          a,
          'patch',
          '/focus/sessions/' + current.id,
          current.revision,
        )
          .send({ title: 'Current replacement' })
          .expect(200)
      ).body,
    );
    expect(changed.revisionId).not.toBe(current.revisionId);
    const second = c.FocusPageSchema.parse(
      (
        await call(a, 'get', '/focus/sessions')
          .query({ taskId: t.id, limit: '1', cursor: first.nextCursor })
          .expect(200)
      ).body,
    );
    expect(second.items[0]?.id).not.toBe(current.id);
    expect([x.id, y.id]).toContain(second.items[0]?.id);
    const history = c.FocusHistoryPageSchema.parse(
      (
        await call(a, 'get', '/focus/sessions/' + current.id + '/history')
          .query({ limit: '1' })
          .expect(200)
      ).body,
    );
    const next = c.FocusHistoryPageSchema.parse(
      (
        await call(a, 'get', '/focus/sessions/' + current.id + '/history')
          .query({ limit: '1', cursor: history.nextCursor })
          .expect(200)
      ).body,
    );
    expect(next.items[0]?.revision).toBe(2);
    await action(await read(x.id), 'stop');
    await action(await read(y.id), 'stop');
  });
});
