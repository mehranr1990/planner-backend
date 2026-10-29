import { cleanupFixtureIdentities } from '../support/fixture-cleanup.js';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import {
  HabitSchema,
  HabitEntrySchema,
  HabitEntryPageSchema,
  HabitSchedulePageSchema,
  HabitStatsSchema,
  RoutineSchema,
  WaterSummarySchema,
  HabitPageSchema,
} from '@mehran/api-contracts';
import type { z } from 'zod';
type Actor = { id: string; spaceId: string; cookie: string };
type Habit = z.infer<typeof HabitSchema>;
type Entry = z.infer<typeof HabitEntrySchema>;
const origin = 'http://localhost:3000',
  databaseUrl = isolatedTestDatabaseUrl(process.env);
describe('P1-05 habit histories, routines, water and personal isolation', () => {
  let app: NestExpressApplication, db: DatabaseService, a: Actor, b: Actor;
  const users: string[] = [];
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
    if (revision !== undefined) req.set('If-Match', `"${revision}"`);
    return req;
  };
  async function identity(): Promise<Actor> {
    const email = `p105-${randomUUID()}@example.test`,
      password = 'test-only-habits-password-123!';
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'Habit fixture' })
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

  const definition = (rule: object = { kind: 'DAILY' }) => ({
    version: 1,
    startDate: '2024-01-01',
    rule,
  });
  const checkbox = (patch: object = {}) => ({
    title: 'Private habit title',
    type: 'CHECKBOX',
    unit: 'COUNT',
    target: '1',
    timezone: 'UTC',
    schedule: definition(),
    ...patch,
  });
  const quantity = (patch: object = {}) => ({
    ...checkbox(),
    type: 'QUANTITY',
    unit: 'ML',
    purpose: 'WATER',
    target: '500',
    ...patch,
  });
  const create = async (
    input: object = checkbox(),
    actor = a,
    key = randomUUID(),
  ): Promise<Habit> =>
    HabitSchema.parse(
      (
        await call(actor, 'post', '/habits')
          .set('Idempotency-Key', key)
          .send(input)
          .expect(201)
      ).body,
    );
  const record = async (
    h: Habit,
    date = '2024-01-01',
    value?: string,
    action = 'LOG',
    actor = a,
    key = randomUUID(),
  ): Promise<Entry> =>
    HabitEntrySchema.parse(
      (
        await call(actor, 'post', '/habits/' + h.id + '/entries')
          .set('Idempotency-Key', key)
          .send({
            habitRevision: h.revision,
            localDate: date,
            action,
            ...(value === undefined ? {} : { value }),
          })
          .expect(201)
      ).body,
    );
  const patch = async (h: Habit, input: object): Promise<Habit> =>
    HabitSchema.parse(
      (
        await call(a, 'patch', '/habits/' + h.id, h.revision)
          .send(input)
          .expect(200)
      ).body,
    );
  const statistics = async (
    h: Habit,
    from = '2024-01-01',
    to = '2024-01-05',
    asOfDate = '2024-01-05',
  ) =>
    HabitStatsSchema.parse(
      (
        await call(a, 'get', '/habits/' + h.id + '/stats')
          .query({ from, to, asOfDate })
          .expect(200)
      ).body,
    );
  beforeAll(async () => {
    app = await testApplication({ databaseUrl });
    db = app.get(DatabaseService);
    a = await identity();
    b = await identity();
  });
  afterAll(async () => {
    vi.useRealTimers();
    if (db) await cleanupFixtureIdentities(databaseUrl, { ids: users });
    await app?.close();
  });
  it('creates canonical types and captures account defaults without changing previous modules', async () => {
    const before = await db.client.task.count({
      where: { spaceId: a.spaceId },
    });
    const h = await create();
    expect(h.currentSchedule?.target).toBe('1');
    expect(h.unit).toBe('COUNT');
    const response = await call(a, 'get', '/habits/' + h.id).expect(200);
    expect(response.headers.etag).toBe('"1"');
    const renamed = await patch(h, { title: 'Renamed' });
    expect(renamed.revision).toBe(2);
    expect(renamed.latestSchedule.revision).toBe(1);
    const duration = await create({
      ...checkbox(),
      type: 'DURATION',
      unit: 'SECOND',
      target: '600',
    });
    await record(duration, '2024-01-01', '600');
    expect((await statistics(duration)).completed).toBe(1);
    expect(await db.client.task.count({ where: { spaceId: a.spaceId } })).toBe(
      before,
    );
  });
  it('enforces daily checkbox uniqueness under concurrency and allows multiple exact quantities', async () => {
    const h = await create(),
      input = { habitRevision: 1, localDate: '2024-01-01' };
    const responses = await Promise.all(
      [1, 2].map(() =>
        call(a, 'post', '/habits/' + h.id + '/entries')
          .set('Idempotency-Key', randomUUID())
          .send(input),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const q = await create(quantity({ target: '0.3' }));
    await Promise.all([
      record(q, '2024-01-01', '0.1'),
      record(q, '2024-01-01', '0.2'),
    ]);
    const result = await statistics(q);
    expect(result.days[0]?.total).toBe('0.3');
    expect(result.completed).toBe(1);
  });
  it('returns one stable creation/log receipt through retries and rejects changed fingerprints', async () => {
    const key = randomUUID(),
      input = checkbox(),
      h = await create(input, a, key);
    expect(await create(input, a, key)).toEqual(h);
    await call(a, 'post', '/habits')
      .set('Idempotency-Key', key)
      .send({ ...input, title: 'Changed' })
      .expect(409);
    const entryKey = randomUUID(),
      first = await record(h, '2024-01-01', undefined, 'LOG', a, entryKey);
    expect(
      await record(h, '2024-01-01', undefined, 'LOG', a, entryKey),
    ).toEqual(first);
    expect(await db.client.habitEntry.count({ where: { habitId: h.id } })).toBe(
      1,
    );
    expect(
      await db.client.outboxEvent.count({
        where: {
          spaceId: a.spaceId,
          aggregateId: h.id,
          type: 'habit.entry_recorded',
        },
      }),
    ).toBe(1);
    expect((await create(input, b, key)).id).not.toBe(h.id);
  });
  it('retains typed checkbox correction history and recomputes streaks', async () => {
    const h = await create();
    await record(h, '2024-01-01');
    const e = await record(h, '2024-01-02');
    expect(
      (await statistics(h, '2024-01-01', '2024-01-03', '2024-01-03'))
        .currentStreak,
    ).toBe(2);
    const changed = HabitEntrySchema.parse(
      (
        await call(a, 'patch', '/habits/' + h.id + '/entries/' + e.id, 1)
          .send({ habitRevision: 1, value: '0' })
          .expect(200)
      ).body,
    );
    expect(changed.id).toBe(e.id);
    expect(changed.revisionId).not.toBe(e.revisionId);
    expect(changed.previousRevisionId).toBe(e.revisionId);
    const old = await db.client.habitEntry.findUniqueOrThrow({
      where: { id: e.revisionId },
    });
    expect(old.value?.toString()).toBe('1');
    expect(old.createdAt.toISOString()).toBe(e.recordedAt);
    expect(old.current).toBe(false);
    const history = HabitEntryPageSchema.parse(
      (
        await call(
          a,
          'get',
          '/habits/' + h.id + '/entries/' + e.id + '/history',
        ).expect(200)
      ).body,
    );
    expect(history.items.map((i) => i.value)).toEqual(['1', '0']);
    const result = await statistics(
      h,
      '2024-01-01',
      '2024-01-03',
      '2024-01-03',
    );
    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(1);
    await call(a, 'patch', '/habits/' + h.id + '/entries/' + e.id, 1)
      .send({ habitRevision: 1, value: '1' })
      .expect(409);
  });
  it('serializes corrections and rolls back losing revisions without corrupting the chain', async () => {
    const h = await create(quantity()),
      e = await record(h, '2024-01-01', '100');
    const outcomes = await Promise.all(
      ['200', '300'].map((value) =>
        call(a, 'patch', '/habits/' + h.id + '/entries/' + e.id, 1).send({
          habitRevision: 1,
          value,
        }),
      ),
    );
    expect(outcomes.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await db.client.habitEntry.count({ where: { logicalId: e.id } }),
    ).toBe(2);
    expect(
      await db.client.habitEntry.count({
        where: { logicalId: e.id, current: true },
      }),
    ).toBe(1);
  });
  it('makes approved skips neutral, retains partial logs and requires clearing before logging', async () => {
    const h = await create(quantity());
    await record(h, '2024-01-01', '500');
    const partial = await record(h, '2024-01-02', '200');
    const skip = await record(h, '2024-01-02', undefined, 'SKIP');
    await record(h, '2024-01-03', '500');
    const result = await statistics(
      h,
      '2024-01-01',
      '2024-01-04',
      '2024-01-04',
    );
    expect(result.currentStreak).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.completionRate).toEqual({ numerator: 2, denominator: 2 });
    await call(a, 'post', '/habits/' + h.id + '/entries')
      .set('Idempotency-Key', randomUUID())
      .send({ habitRevision: 1, localDate: '2024-01-02', value: '300' })
      .expect(400);
    await call(a, 'patch', '/habits/' + h.id + '/entries/' + skip.id, 1)
      .send({ habitRevision: 1, void: true })
      .expect(200);
    await record(h, '2024-01-02', '300');
    expect(
      (await statistics(h, '2024-01-01', '2024-01-04', '2024-01-04'))
        .currentStreak,
    ).toBe(3);
    expect(
      (
        await call(
          a,
          'get',
          '/habits/' + h.id + '/entries/' + partial.id,
        ).expect(200)
      ).body.value,
    ).toBe('200');
    await call(a, 'post', '/habits/' + h.id + '/entries')
      .set('Idempotency-Key', randomUUID())
      .send({ habitRevision: 1, localDate: '2024-01-01', action: 'SKIP' })
      .expect(400);
  });
  it('suspends paused expectations and resumes without counting pause/rest days', async () => {
    let h = await create();
    await record(h, '2024-01-01');
    h = await patch(h, {
      status: 'PAUSED',
      effectiveFrom: '2024-01-02',
      confirmHistoricalChange: true,
    });
    h = await patch(h, {
      status: 'ACTIVE',
      effectiveFrom: '2024-01-04',
      confirmHistoricalChange: true,
    });
    await record(h, '2024-01-02');
    await record(h, '2024-01-04');
    const r = await statistics(h, '2024-01-01', '2024-01-05', '2024-01-05');
    expect(r.days.map((d) => d.outcome)).toEqual([
      'COMPLETED',
      'PAUSED',
      'PAUSED',
      'COMPLETED',
    ]);
    expect(r.currentStreak).toBe(2);
  });
  it('supports weekly/weekday/interval dates and rejects skips on rest dates', async () => {
    const weekly = await create(
      checkbox({ schedule: definition({ kind: 'WEEKLY' }) }),
    );
    await record(weekly, '2024-01-01');
    await record(weekly, '2024-01-08');
    expect(
      (await statistics(weekly, '2024-01-01', '2024-01-09', '2024-01-09'))
        .currentStreak,
    ).toBe(2);
    await call(a, 'post', '/habits/' + weekly.id + '/entries')
      .set('Idempotency-Key', randomUUID())
      .send({ habitRevision: 1, localDate: '2024-01-02', action: 'SKIP' })
      .expect(400);
    for (const rule of [
      { kind: 'WEEKDAYS', weekdays: [1, 3] },
      { kind: 'INTERVAL', days: 2 },
    ]) {
      const h = await create(checkbox({ schedule: definition(rule) }));
      const r = await statistics(h, '2024-01-01', '2024-01-05', '2024-01-05');
      expect(r.due).toBe(2);
    }
  });
  it('requires confirmation for past schedule/target edits and preserves old versions and logs', async () => {
    let h = await create(quantity());
    const e = await record(h, '2024-01-01', '500');
    await record(h, '2024-01-02', '500');
    await call(a, 'patch', '/habits/' + h.id, 1)
      .send({ target: '1000', effectiveFrom: '2024-01-02' })
      .expect(400);
    h = await patch(h, {
      target: '1000',
      effectiveFrom: '2024-01-02',
      confirmHistoricalChange: true,
    });
    expect(
      (await statistics(h, '2024-01-01', '2024-01-03', '2024-01-03')).completed,
    ).toBe(1);
    const history = HabitSchedulePageSchema.parse(
      (await call(a, 'get', '/habits/' + h.id + '/schedules').expect(200)).body,
    );
    expect(history.items.map((v) => v.target)).toEqual(['500', '1000']);
    expect(
      (await call(a, 'get', '/habits/' + h.id + '/entries/' + e.id).expect(200))
        .body,
    ).toEqual(e);
    await call(a, 'post', '/habits/' + h.id + '/entries')
      .set('Idempotency-Key', randomUUID())
      .send({ habitRevision: 1, localDate: '2024-01-03', value: '500' })
      .expect(409);
  });
  it('rejects concurrent habit edits and measurement overposting', async () => {
    const h = await create();
    const outcomes = await Promise.all(
      ['A', 'B'].map((title) =>
        call(a, 'patch', '/habits/' + h.id, 1).send({ title }),
      ),
    );
    expect(outcomes.map((r) => r.status).sort()).toEqual([200, 409]);
    await call(a, 'patch', '/habits/' + h.id, 2)
      .send({ type: 'QUANTITY', unit: 'ML' })
      .expect(400);
    await call(a, 'patch', '/habits/' + h.id)
      .send({ title: 'No precondition' })
      .expect(400);
    await call(a, 'post', '/habits')
      .set('Idempotency-Key', randomUUID())
      .send({ ...checkbox(), spaceId: b.spaceId })
      .expect(400);
  });
  it('archives without erasing historical entries and still allows explicit corrections', async () => {
    const h = await create(quantity()),
      e = await record(h, '2024-01-01', '100');
    const archived = HabitSchema.parse(
      (await call(a, 'delete', '/habits/' + h.id, 1).expect(200)).body,
    );
    expect(archived.currentSchedule?.status).toBe('ARCHIVED');
    await call(a, 'post', '/habits/' + h.id + '/entries')
      .set('Idempotency-Key', randomUUID())
      .send({ habitRevision: 2, localDate: '2024-01-02', value: '100' })
      .expect(400);
    await call(a, 'patch', '/habits/' + h.id + '/entries/' + e.id, 1)
      .send({ habitRevision: 2, value: '150' })
      .expect(200);
    const current = await call(
      a,
      'get',
      '/habits/' + h.id + '/entries/' + e.id,
    ).expect(200);
    expect(current.body.value).toBe('150');
    expect(
      (await statistics(archived, '2024-01-01', '2024-01-02', '2024-01-02'))
        .days[0]?.total,
    ).toBe('150');
  });
  it('totals multiple water measures exactly, including rest and archived history, without generic ML habits', async () => {
    const water = await create(
        quantity({ schedule: definition({ kind: 'WEEKLY' }) }),
      ),
      other = await create(quantity({ purpose: 'GENERIC' }));
    const one = await record(water, '2024-01-02', '100.1');
    await record(water, '2024-01-02', '200.2');
    await record(other, '2024-01-02', '999');
    const requestSummary = () =>
      call(a, 'get', '/habits/water-summary')
        .query({ from: '2024-01-02', to: '2024-01-03', habitId: water.id })
        .expect(200);
    const result = WaterSummarySchema.parse((await requestSummary()).body);
    expect(result.totalML).toBe('300.3');
    expect(result.habits[0]?.targets[0]?.target).toBe('500');
    expect(result.days[0]?.totalML).toBe('300.3');
    await call(a, 'delete', '/habits/' + water.id, 1).expect(200);
    expect((await requestSummary()).body.totalML).toBe('300.3');
    await call(a, 'patch', '/habits/' + water.id + '/entries/' + one.id, 1)
      .send({ habitRevision: 2, void: true })
      .expect(200);
    expect((await requestSummary()).body.totalML).toBe('200.2');
  });
  it('enforces owner isolation on every nested resource, stats, water and routine association', async () => {
    const h = await create(),
      e = await record(h),
      foreign = await create(checkbox(), b);
    for (const path of [
      '/habits/' + h.id,
      '/habits/' + h.id + '/entries',
      '/habits/' + h.id + '/entries/' + e.id,
      '/habits/' + h.id + '/entries/' + e.id + '/history',
      '/habits/' + h.id + '/schedules',
    ])
      await call(b, 'get', path).expect(404);
    await call(b, 'get', '/habits/' + h.id + '/stats')
      .query({ from: '2024-01-01', to: '2024-01-02' })
      .expect(404);
    await call(b, 'patch', '/habits/' + h.id, 1)
      .send({ title: 'Forbidden' })
      .expect(404);
    await call(b, 'delete', '/habits/' + h.id, 1).expect(404);
    await call(b, 'post', '/habits/' + h.id + '/entries')
      .set('Idempotency-Key', randomUUID())
      .send({ habitRevision: 1 })
      .expect(404);
    await call(b, 'patch', '/habits/' + h.id + '/entries/' + e.id, 1)
      .send({ habitRevision: 1, value: '0' })
      .expect(404);
    await call(a, 'get', '/habits/' + foreign.id + '/entries/' + e.id).expect(
      404,
    );
    const water = await create(quantity());
    await call(b, 'get', '/habits/water-summary')
      .query({ from: '2024-01-01', to: '2024-01-02', habitId: water.id })
      .expect(404);
    await call(a, 'post', '/routines')
      .set('Idempotency-Key', randomUUID())
      .send({ title: 'Foreign link', habitIds: [foreign.id] })
      .expect(404);
    const mine = HabitPageSchema.parse(
      (await call(a, 'get', '/habits').expect(200)).body,
    );
    expect(mine.items.some((i) => i.id === foreign.id)).toBe(false);
    await call(a, 'get', '/habits').query({ spaceId: b.spaceId }).expect(400);
    await request(app.getHttpServer()).get('/api/v1/habits').expect(401);
  });
  it('creates and atomically reorders unique routine links, keeping paused/archive associations readable', async () => {
    const h1 = await create(),
      h2 = await create(),
      key = randomUUID(),
      input = { title: 'Morning', habitIds: [h1.id, h2.id] };
    const routine = RoutineSchema.parse(
      (
        await call(a, 'post', '/routines')
          .set('Idempotency-Key', key)
          .send(input)
          .expect(201)
      ).body,
    );
    expect(
      (
        await call(a, 'post', '/routines')
          .set('Idempotency-Key', key)
          .send(input)
          .expect(201)
      ).body,
    ).toEqual(routine);
    await patch(h1, { status: 'PAUSED' });
    await call(a, 'delete', '/habits/' + h2.id, 1).expect(200);
    const updated = RoutineSchema.parse(
      (
        await call(a, 'patch', '/routines/' + routine.id, 1)
          .send({ habitIds: [h2.id, h1.id] })
          .expect(200)
      ).body,
    );
    expect(updated.habits.map((i) => i.habitId)).toEqual([h2.id, h1.id]);
    expect(updated.habits.map((i) => i.status)).toEqual(['ARCHIVED', 'PAUSED']);
    await call(a, 'patch', '/routines/' + routine.id, 1)
      .send({ habitIds: [] })
      .expect(409);
    await call(a, 'patch', '/routines/' + routine.id, 2)
      .send({ habitIds: [h1.id, h1.id] })
      .expect(400);
    await call(b, 'get', '/routines/' + routine.id).expect(404);
    await call(b, 'patch', '/routines/' + routine.id, 2)
      .send({ habitIds: [] })
      .expect(404);
    await call(b, 'delete', '/routines/' + routine.id, 2).expect(404);
    const removed = await call(a, 'patch', '/routines/' + routine.id, 2)
      .send({ habitIds: [] })
      .expect(200);
    expect(removed.body.habits).toEqual([]);
    await call(a, 'delete', '/routines/' + routine.id, 3).expect(200);
    expect(
      await db.client.habit.count({ where: { id: { in: [h1.id, h2.id] } } }),
    ).toBe(2);
  });
  it('binds entry/history/schedule/list cursors to user, parent and filters', async () => {
    const h = await create(quantity()),
      e = await record(h, '2024-01-01', '100');
    await record(h, '2024-01-02', '200');
    await call(a, 'patch', '/habits/' + h.id + '/entries/' + e.id, 1)
      .send({ habitRevision: 1, value: '150' })
      .expect(200);
    const page = HabitEntryPageSchema.parse(
      (
        await call(a, 'get', '/habits/' + h.id + '/entries')
          .query({ limit: '1', from: '2024-01-01', to: '2024-01-03' })
          .expect(200)
      ).body,
    );
    expect(page.nextCursor).not.toBeNull();
    await call(b, 'get', '/habits/' + h.id + '/entries')
      .query({ limit: '1', cursor: page.nextCursor! })
      .expect(404);
    await call(a, 'get', '/habits/' + h.id + '/entries')
      .query({ cursor: page.nextCursor!, from: '2024-01-01', to: '2024-01-04' })
      .expect(400);
    const list = await call(a, 'get', '/habits')
      .query({ limit: '1' })
      .expect(200);
    await call(b, 'get', '/habits')
      .query({ cursor: list.body.nextCursor })
      .expect(400);
    const history = HabitEntryPageSchema.parse(
      (
        await call(
          a,
          'get',
          '/habits/' + h.id + '/entries/' + e.id + '/history',
        )
          .query({ limit: '1' })
          .expect(200)
      ).body,
    );
    expect(history.nextCursor).not.toBeNull();
    expect(
      (
        await call(
          a,
          'get',
          '/habits/' + h.id + '/entries/' + e.id + '/history',
        )
          .query({ limit: '1', cursor: history.nextCursor! })
          .expect(200)
      ).body.items[0].revision,
    ).toBe(2);
  });
  it('rejects invalid values, future entries, schedule thresholds and excessive ranges safely', async () => {
    const h = await create(),
      duration = await create({
        ...checkbox(),
        type: 'DURATION',
        unit: 'SECOND',
        target: '60',
      });
    for (const [habit, value] of [
      [h, '2'],
      [duration, '1.5'],
    ] as [Habit, string][])
      await call(a, 'post', '/habits/' + habit.id + '/entries')
        .set('Idempotency-Key', randomUUID())
        .send({ habitRevision: 1, localDate: '2024-01-01', value })
        .expect(400);
    await call(a, 'patch', '/habits/' + h.id, 1)
      .send({ target: '2' })
      .expect(400);
    await call(a, 'post', '/habits/' + h.id + '/entries')
      .set('Idempotency-Key', randomUUID())
      .send({ habitRevision: 1, localDate: '2040-01-01' })
      .expect(400);
    await call(a, 'get', '/habits/' + h.id + '/stats')
      .query({ from: '2024-01-01', to: '2026-01-01' })
      .expect(400);
    await call(a, 'get', '/habits/' + h.id + '/stats')
      .query({ from: '2024-01-01', to: '2024-01-02', asOfDate: '2040-01-01' })
      .expect(400);
    await call(a, 'post', '/habits').send(checkbox()).expect(400);
  });
  it('enforces same-habit ownership FKs, typed measures and current checkbox uniqueness in PostgreSQL', async () => {
    const h = await create(),
      e = await record(h),
      foreign = await create(checkbox(), b);
    const row = await db.client.habitEntry.findUniqueOrThrow({
      where: { id: e.revisionId },
    });
    await expect(
      db.client.habitEntry.create({
        data: {
          ...row,
          id: randomUUID(),
          sourceEventId: null,
          logicalId: e.id,
          habitId: foreign.id,
          current: false,
          previousId: e.revisionId,
          revision: 2,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const newId = randomUUID();
    await expect(
      db.client.habitEntry.create({
        data: { ...row, sourceEventId: null, id: newId, logicalId: newId },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      db.client.habitEntry.update({
        where: { id: e.revisionId },
        data: { value: '-1' },
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.client.habitEntry.findUniqueOrThrow({
          where: { id: e.revisionId },
        })
      ).value?.toString(),
    ).toBe('1');
  });
  it('keeps content and quantities out of transactional audit/outbox', async () => {
    const h = await create(quantity()),
      e = await record(h, '2024-01-01', '123.456');
    await call(a, 'patch', '/habits/' + h.id + '/entries/' + e.id, 1)
      .send({ habitRevision: 1, value: '654.321' })
      .expect(200);
    const events = await db.client.outboxEvent.findMany({
      where: { spaceId: a.spaceId, aggregateId: h.id },
    });
    expect(events.map((e) => e.type).sort()).toEqual([
      'habit.entry_corrected',
      'habit.entry_recorded',
    ]);
    expect(events.every((e) => JSON.stringify(e.payload) === '{}')).toBe(true);
    const audits = await db.client.securityAuditEvent.findMany({
      where: { actorUserId: a.id, resourceId: { in: [h.id, e.id] } },
    });
    expect(JSON.stringify([...events, ...audits])).not.toMatch(
      /Private habit title|123\.456|654\.321/,
    );
  });
  it('preserves saved zones after travel and logs default dates around local midnight', async () => {
    const h = await create(checkbox({ timezone: 'America/Los_Angeles' })),
      settings = await call(a, 'get', '/me/settings').expect(200);
    await call(
      a,
      'patch',
      '/me/settings',
      Number(String(settings.headers.etag).replaceAll('"', '')),
    )
      .send({ timezone: 'Asia/Tokyo' })
      .expect(200);
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-28T00:30:00Z'));
      const e = HabitEntrySchema.parse(
        (
          await call(a, 'post', '/habits/' + h.id + '/entries')
            .set('Idempotency-Key', randomUUID())
            .send({ habitRevision: 1 })
            .expect(201)
        ).body,
      );
      expect(e.localDate).toBe('2026-10-27');
      expect(e.timezone).toBe('America/Los_Angeles');
      expect(e.recordedTimezone).toBe('Asia/Tokyo');
      const saved = HabitSchema.parse(
        (await call(a, 'get', '/habits/' + h.id).expect(200)).body,
      );
      expect(saved.latestSchedule.timezone).toBe('America/Los_Angeles');
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects null/string configuration versions instead of accepting SQL CHECK UNKNOWN', async () => {
    const h = await create();
    for (const version of [null, '1'])
      await expect(
        db.client.habitSchedule.create({
          data: {
            spaceId: a.spaceId,
            habitId: h.id,
            revision: 2,
            effectiveFrom: new Date('2024-01-01'),
            timezone: 'UTC',
            target: '1',
            status: 'ACTIVE',
            definition: { version },
          },
        }),
      ).rejects.toThrow();
    expect(
      await db.client.habitSchedule.count({ where: { habitId: h.id } }),
    ).toBe(1);
  });
  it('keeps routine ordering coherent across concurrent edits and denies foreign list/summary data', async () => {
    const h1 = await create(),
      h2 = await create(),
      r = RoutineSchema.parse(
        (
          await call(a, 'post', '/routines')
            .set('Idempotency-Key', randomUUID())
            .send({ title: 'Race', habitIds: [h1.id, h2.id] })
            .expect(201)
        ).body,
      );
    const results = await Promise.all(
      [[h2.id, h1.id], [h1.id]].map((habitIds) =>
        call(a, 'patch', '/routines/' + r.id, 1).send({ habitIds }),
      ),
    );
    expect(results.map((v) => v.status).sort()).toEqual([200, 409]);
    const saved = RoutineSchema.parse(
      (await call(a, 'get', '/routines/' + r.id).expect(200)).body,
    );
    expect(saved.habits.map((h) => h.position)).toEqual(
      saved.habits.map((_, i) => i),
    );
    const foreignList = await call(b, 'get', '/routines').expect(200);
    expect(foreignList.body.items).toEqual([]);
    const water = WaterSummarySchema.parse(
      (
        await call(b, 'get', '/habits/water-summary')
          .query({ from: '2024-01-01', to: '2024-01-05' })
          .expect(200)
      ).body,
    );
    expect(water.totalML).toBe('0');
    expect(water.habits).toEqual([]);
  });
  it('orders and paginates immutable revisions even when recorded timestamps tie', async () => {
    const h = await create(),
      ids = [randomUUID(), randomUUID()].sort(),
      rootId = ids[1]!,
      nextId = ids[0]!,
      createdAt = new Date('2024-02-01T12:00:00Z');
    const row = {
      spaceId: a.spaceId,
      habitId: h.id,
      scheduleId: h.latestSchedule.id,
      actorUserId: a.id,
      logicalId: rootId,
      kind: 'CHECKBOX',
      state: 'RECORDED',
      localDate: new Date('2024-01-01'),
      timezone: 'UTC',
      recordedTimezone: 'UTC',
      createdAt,
    };
    await db.client.habitEntry.create({
      data: { ...row, id: rootId, current: false, value: '1' },
    });
    await db.client.habitEntry.create({
      data: {
        ...row,
        id: nextId,
        previousId: rootId,
        current: true,
        value: '0',
        revision: 2,
      },
    });
    const first = HabitEntryPageSchema.parse(
      (
        await call(
          a,
          'get',
          '/habits/' + h.id + '/entries/' + rootId + '/history',
        )
          .query({ limit: '1' })
          .expect(200)
      ).body,
    );
    expect(first.items[0]?.revision).toBe(1);
    const second = HabitEntryPageSchema.parse(
      (
        await call(
          a,
          'get',
          '/habits/' + h.id + '/entries/' + rootId + '/history',
        )
          .query({ limit: '1', cursor: first.nextCursor! })
          .expect(200)
      ).body,
    );
    expect(second.items[0]?.revision).toBe(2);
    expect(second.nextCursor).toBeNull();
  });
});
