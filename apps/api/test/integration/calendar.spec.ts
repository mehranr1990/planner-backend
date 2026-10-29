import { cleanupFixtureIdentities } from '../support/fixture-cleanup.js';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import {
  CalendarEventSchema,
  TimeBlockSchema,
  CalendarViewSchema,
  CalendarConflictsSchema,
  CalendarSeriesResultSchema,
} from '@mehran/api-contracts';
import type { z } from 'zod';
type Actor = { id: string; spaceId: string; cookie: string };
type Event = z.infer<typeof CalendarEventSchema>;
const origin = 'http://localhost:3000',
  databaseUrl = isolatedTestDatabaseUrl(process.env);
describe('P1-04 calendar ownership, history, recurrence and scheduling', () => {
  let app: NestExpressApplication,
    db: DatabaseService,
    a: Actor,
    b: Actor,
    isolated: Actor;
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
    const email = `p104-${randomUUID()}@example.test`,
      password = 'test-only-calendar-password-123!';
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'Calendar fixture' })
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
  const timed = (
    date = '2030-01-01',
    start = '09:00',
    end = '10:00',
    timezone = 'UTC',
  ) => ({
    kind: 'TIMED' as const,
    timezone,
    localStart: date + 'T' + start,
    localEnd: date + 'T' + end,
  });
  const body = (schedule: object = timed()) => ({
    title: 'Private calendar title',
    description: 'private calendar description',
    schedule,
  });
  async function create(
    input: object = body(),
    actor = a,
    key = randomUUID(),
  ): Promise<Event> {
    return CalendarEventSchema.parse(
      (
        await call(actor, 'post', '/calendar/events')
          .set('Idempotency-Key', key)
          .send(input)
          .expect(201)
      ).body,
    );
  }
  const recurring = (
    date = '2030-01-01',
    timezone = 'UTC',
    time = '09:00',
  ) => ({
    ...body(timed(date, time, time === '02:30' ? '03:30' : '10:00', timezone)),
    recurrence: {
      version: 1,
      startDate: date,
      endDate: null,
      localTime: time,
      timezone,
      rule: { kind: 'DAILY', interval: 1 },
      exclusionDates: [],
    },
  });
  async function view(from: string, to: string, actor = a, timezone = 'UTC') {
    const items: z.infer<typeof CalendarViewSchema>['items'] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const result = CalendarViewSchema.parse(
        (
          await call(actor, 'get', '/calendar/views')
            .query({
              from,
              to,
              timezone,
              limit: '100',
              ...(cursor ? { cursor } : {}),
            })
            .expect(200)
        ).body,
      );
      items.push(...result.items);
      cursor = result.nextCursor;
      if (!cursor) return items;
    }
    throw new Error('Calendar pagination did not terminate');
  }
  async function edit(event: Event, input: object, status = 200) {
    return call(
      a,
      'post',
      `/calendar/events/${event.id}/series`,
      event.revision,
    )
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(status);
  }
  beforeAll(async () => {
    app = await testApplication({ databaseUrl });
    db = app.get(DatabaseService);
    a = await identity();
    b = await identity();
    isolated = await identity();
  });
  afterAll(async () => {
    if (db) await cleanupFixtureIdentities(databaseUrl, { ids: users });
    await app?.close();
  });
  it('creates, reads, revises, cancels and retains a deleted event tombstone', async () => {
    const event = await create();
    expect(event.schedule.startAt).toBe('2030-01-01T09:00:00.000Z');
    expect(event.foldPolicy).toBe('EARLIER');
    await call(a, 'get', `/calendar/events/${event.id}`)
      .expect('ETag', '"1"')
      .expect(200);
    const updated = CalendarEventSchema.parse(
      (
        await call(a, 'patch', `/calendar/events/${event.id}`, 1)
          .send({ title: 'Updated', status: 'CANCELED' })
          .expect(200)
      ).body,
    );
    expect(updated.revision).toBe(2);
    await call(a, 'delete', `/calendar/events/${event.id}`, 1).expect(409);
    await call(a, 'delete', `/calendar/events/${event.id}`, 2).expect(204);
    const deleted = CalendarEventSchema.parse(
      (await call(a, 'get', `/calendar/events/${event.id}`).expect(200)).body,
    );
    expect(deleted.deletedAt).not.toBeNull();
    expect(
      (await view('2030-01-01', '2030-01-02')).some(
        (i) => i.resourceId === event.id,
      ),
    ).toBe(false);
  });
  it('includes all-day spans through the last included date, never the exclusive end', async () => {
    const e = await create(
      body({
        kind: 'ALL_DAY',
        timezone: 'Asia/Tehran',
        startDate: '2032-02-29',
        endDate: '2032-03-02',
      }),
    );
    expect(
      (await view('2032-03-01', '2032-03-02', a, 'Pacific/Auckland')).some(
        (i) => i.resourceId === e.id,
      ),
    ).toBe(true);
    expect(
      (await view('2032-03-02', '2032-03-03')).some(
        (i) => i.resourceId === e.id,
      ),
    ).toBe(false);
    expect(e.schedule.startAt).toBeNull();
  });
  it('rejects explicit DST gaps with a safe actionable reason and chooses the earlier fold', async () => {
    const gap = await call(a, 'post', '/calendar/events')
      .set('Idempotency-Key', randomUUID())
      .send(body(timed('2030-03-10', '02:30', '03:30', 'America/New_York')))
      .expect(400);
    expect(gap.body.error.details).toContainEqual({
      path: 'schedule',
      code: 'DST_GAP',
    });
    const fold = await create(
      body(timed('2030-11-03', '01:30', '02:30', 'America/New_York')),
    );
    expect(fold.schedule.startAt).toBe('2030-11-03T05:30:00.000Z');
  });
  it('returns recurring DST gaps once without an actionable instant', async () => {
    const e = await create(
      recurring('2030-03-09', 'America/New_York', '02:30'),
    );
    const rows = (await view('2030-03-09', '2030-03-12')).filter(
      (i) => i.seriesId === e.id,
    );
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      status: 'SKIPPED',
      reason: 'DST_GAP',
      schedule: { startAt: null },
    });
    await edit(
      e,
      {
        scope: 'THIS_OCCURRENCE',
        recurrenceKey: '2030-03-10T02:30',
        exceptionRevision: 0,
        patch: { title: 'Cannot revive gap' },
      },
      409,
    );
  });
  it('supports recurring all-day spans and selected weekday/month/leap rules', async () => {
    const input = {
      ...body({
        kind: 'ALL_DAY',
        timezone: 'UTC',
        startDate: '2032-02-29',
        endDate: '2032-03-01',
      }),
      recurrence: {
        version: 1,
        startDate: '2032-02-29',
        endDate: null,
        localTime: '00:00',
        timezone: 'UTC',
        rule: { kind: 'YEARLY', interval: 1, month: 2, day: 29 },
        exclusionDates: [],
      },
    };
    const e = await create(input);
    expect(
      (await view('2033-02-01', '2033-03-02')).filter(
        (i) => i.seriesId === e.id,
      ),
    ).toHaveLength(0);
    expect(
      (await view('2036-02-28', '2036-03-02')).filter(
        (i) => i.seriesId === e.id,
      ),
    ).toHaveLength(1);
  });
  it('makes creation/retry concurrent and idempotent with exactly one outbox consequence', async () => {
    const key = randomUUID(),
      input = body(timed('2031-01-01'));
    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        call(a, 'post', '/calendar/events')
          .set('Idempotency-Key', key)
          .send(input)
          .expect(201),
      ),
    );
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(
      await db.client.outboxEvent.count({
        where: {
          spaceId: a.spaceId,
          aggregateId: responses[0]!.body.id,
          type: 'calendar_event.changed',
        },
      }),
    ).toBe(1);
    await call(a, 'post', '/calendar/events')
      .set('Idempotency-Key', key)
      .send({ ...input, title: 'different' })
      .expect(409);
    const other = await create(input, b, key);
    expect(other.id).not.toBe(responses[0]!.body.id);
  });
  it('isolates every event, block, nested edit, list, view and conflict query', async () => {
    const e = await create(),
      block = (
        await call(a, 'post', '/calendar/time-blocks')
          .set('Idempotency-Key', randomUUID())
          .send({ title: 'Private block', schedule: timed() })
          .expect(201)
      ).body;
    for (const [path, id] of [
      ['events', e.id],
      ['time-blocks', block.id],
    ]) {
      await call(b, 'get', `/calendar/${path}/${id}`).expect(404);
      await call(b, 'patch', `/calendar/${path}/${id}`, 1)
        .send({ title: 'forbidden' })
        .expect(404);
      await call(b, 'delete', `/calendar/${path}/${id}`, 1).expect(404);
    }
    await call(b, 'post', `/calendar/events/${e.id}/series`, 1)
      .send({
        scope: 'THIS_OCCURRENCE',
        recurrenceKey: '2030-01-01T09:00',
        exceptionRevision: 0,
        patch: { status: 'CANCELED' },
      })
      .expect(404);
    expect(
      (await view('2030-01-01', '2030-01-02', b)).some(
        (i) => i.resourceId === e.id || i.resourceId === block.id,
      ),
    ).toBe(false);
    const conflicts = await call(b, 'get', '/calendar/conflicts')
      .query({ from: '2030-01-01', to: '2030-01-02', timezone: 'UTC' })
      .expect(200);
    expect(JSON.stringify(conflicts.body)).not.toContain(e.id);
    await call(a, 'get', '/calendar/events')
      .query({ spaceId: b.spaceId })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/calendar/events')
      .expect(401);
  });
  it('rejects stale/concurrent event revisions without losing the winning edit', async () => {
    const e = await create();
    const outcomes = await Promise.all(
      ['A', 'B'].map((title) =>
        call(a, 'patch', `/calendar/events/${e.id}`, 1).send({ title }),
      ),
    );
    expect(outcomes.map((r) => r.status).sort()).toEqual([200, 409]);
    await call(a, 'patch', `/calendar/events/${e.id}`)
      .send({ title: 'missing' })
      .expect(400);
    const saved = CalendarEventSchema.parse(
      (await call(a, 'get', `/calendar/events/${e.id}`).expect(200)).body,
    );
    expect(saved.revision).toBe(2);
  });
  it('links the same Task without changing it or its My Day selection', async () => {
    const task = (
      await call(a, 'post', '/tasks')
        .send({ title: 'Same Task', dueAt: '2030-08-01T12:00:00Z' })
        .expect(201)
    ).body;
    await call(a, 'post', '/planning/days/2030-08-01').send({}).expect(201);
    await request(app.getHttpServer())
      .put(`/api/v1/planning/days/2030-08-01/items/${task.id}`)
      .set('Cookie', a.cookie)
      .set('Origin', origin)
      .set('If-Match', '"1"')
      .send({ taskRevision: 1, plannedMinutes: 60 })
      .expect(200);
    const before = await db.client.task.findUniqueOrThrow({
        where: { id: task.id },
      }),
      history = await db.client.taskChange.count({
        where: { taskId: task.id },
      });
    const block = TimeBlockSchema.parse(
      (
        await call(a, 'post', '/calendar/time-blocks')
          .set('Idempotency-Key', randomUUID())
          .send({
            title: 'Work',
            schedule: timed('2030-08-01'),
            taskId: task.id,
            taskRevision: 1,
          })
          .expect(201)
      ).body,
    );
    expect(block.taskId).toBe(task.id);
    expect(block.taskDisposition).toBe('READY');
    await call(a, 'patch', `/calendar/time-blocks/${block.id}`, 1)
      .send({ schedule: timed('2030-08-02') })
      .expect(200);
    expect(await db.client.task.findUnique({ where: { id: task.id } })).toEqual(
      before,
    );
    expect(
      await db.client.taskChange.count({ where: { taskId: task.id } }),
    ).toBe(history);
    const day = await call(a, 'get', '/planning/days/2030-08-01').expect(200);
    expect(day.body.items[0].taskId).toBe(task.id);
    await call(a, 'post', `/tasks/${task.id}/complete`, 1).send({}).expect(200);
    expect(
      (await call(a, 'get', `/calendar/time-blocks/${block.id}`).expect(200))
        .body.taskDisposition,
    ).toBe('COMPLETED');
    await call(a, 'delete', `/tasks/${task.id}`, 2).expect(200);
    expect(
      (await call(a, 'get', `/calendar/time-blocks/${block.id}`).expect(200))
        .body.taskDisposition,
    ).toBe('DELETED');
    const detached = await call(
      a,
      'patch',
      `/calendar/time-blocks/${block.id}`,
      2,
    )
      .send({ taskId: null })
      .expect(200);
    expect(detached.body.taskId).toBeNull();
    await call(a, 'delete', `/calendar/time-blocks/${block.id}`, 3).expect(204);
  });
  it('rejects foreign, stale, terminal and recurrence master links', async () => {
    const foreign = (
      await call(b, 'post', '/tasks').send({ title: 'Foreign' }).expect(201)
    ).body;
    const post = (taskId: string, taskRevision: number) =>
      call(a, 'post', '/calendar/time-blocks')
        .set('Idempotency-Key', randomUUID())
        .send({ title: 'Work', schedule: timed(), taskId, taskRevision });
    await post(foreign.id, 1).expect(404);
    const task = (
      await call(a, 'post', '/tasks').send({ title: 'Task' }).expect(201)
    ).body;
    await post(task.id, 2).expect(409);
    await call(a, 'post', `/tasks/${task.id}/complete`, 1).send({}).expect(200);
    await post(task.id, 2).expect(400);
    const master = (
      await call(a, 'post', '/tasks').send({ title: 'Master' }).expect(201)
    ).body;
    await call(a, 'post', '/task-recurrences')
      .send({
        taskId: master.id,
        taskRevision: 1,
        definition: recurring().recurrence,
      })
      .expect(201);
    const saved = await db.client.task.findUniqueOrThrow({
      where: { id: master.id },
    });
    await post(master.id, saved.revision).expect(400);
  });
  it('keeps canceled/edited occurrence identity stable and suppresses its original position', async () => {
    const e = await create(recurring('2030-04-01'));
    const result = CalendarSeriesResultSchema.parse(
      (
        await edit(e, {
          scope: 'THIS_OCCURRENCE',
          recurrenceKey: '2030-04-02T09:00',
          exceptionRevision: 0,
          patch: { title: 'Moved', schedule: timed('2030-05-01') },
        })
      ).body,
    );
    expect(result.exception?.recurrenceKey).toBe('2030-04-02T09:00');
    expect(
      (await view('2030-04-02', '2030-04-03')).filter(
        (i) => i.seriesId === e.id,
      ),
    ).toHaveLength(0);
    const moved = (await view('2030-05-01', '2030-05-02')).find(
      (i) => i.resourceId === result.exception!.id,
    )!;
    expect(moved.identity).toBe(e.id + '/2030-04-02T09:00');
    const canceled = CalendarSeriesResultSchema.parse(
      (
        await edit(result.event, {
          scope: 'THIS_OCCURRENCE',
          recurrenceKey: '2030-04-02T09:00',
          exceptionRevision: 1,
          patch: { status: 'CANCELED' },
        })
      ).body,
    );
    await edit(
      canceled.event,
      {
        scope: 'THIS_OCCURRENCE',
        recurrenceKey: '2030-04-02T09:00',
        exceptionRevision: 2,
        patch: { title: 'Rewrite canceled' },
      },
      409,
    );
  });
  it('serializes concurrent exception creation with database uniqueness', async () => {
    const e = await create(recurring('2031-06-01')),
      input = {
        scope: 'THIS_OCCURRENCE',
        recurrenceKey: '2031-06-02T09:00',
        exceptionRevision: 0,
        patch: { title: 'One exception' },
      };
    const results = await Promise.all(
      [1, 2].map(() =>
        call(a, 'post', `/calendar/events/${e.id}/series`, e.revision).send(
          input,
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await db.client.calendarEvent.count({
        where: { seriesId: e.id, recurrenceKey: '2031-06-02T09:00' },
      }),
    ).toBe(1);
  });
  it('versions entire-series edits while preserving elapsed content and explicit exceptions', async () => {
    const input = recurring('2024-01-01'),
      e = await create(input);
    const exception = CalendarSeriesResultSchema.parse(
      (
        await edit(e, {
          scope: 'THIS_OCCURRENCE',
          recurrenceKey: '2030-01-02T09:00',
          exceptionRevision: 0,
          patch: { title: 'Keep exception' },
        })
      ).body,
    );
    const updatedInput = {
      ...input,
      title: 'New future title',
      schedule: timed('2024-01-01', '11:00', '12:00'),
      recurrence: { ...input.recurrence, localTime: '11:00' },
    };
    const result = CalendarSeriesResultSchema.parse(
      (
        await edit(exception.event, {
          scope: 'ENTIRE_SERIES',
          event: updatedInput,
        })
      ).body,
    );
    const past = (await view('2024-01-01', '2024-01-02')).find(
      (i) => i.seriesId === e.id,
    )!;
    expect(past.title).toBe(input.title);
    expect(past.schedule.startAt).toBe('2024-01-01T09:00:00.000Z');
    const future = (await view('2030-01-01', '2030-01-03')).filter(
      (i) => i.seriesId === e.id,
    );
    expect(future.map((i) => i.title)).toEqual([
      'New future title',
      'Keep exception',
    ]);
    expect(future[0]?.recurrenceKey).toBe('2030-01-01T09:00');
    expect(
      await db.client.eventRecurrence.count({ where: { eventId: e.id } }),
    ).toBe(2);
    await edit(
      result.event,
      {
        scope: 'THIS_OCCURRENCE',
        recurrenceKey: '2024-01-01T09:00',
        exceptionRevision: 0,
        patch: { title: 'Rewrite past' },
      },
      409,
    );
  });
  it('splits future series with lineage, preserved exceptions and retry receipts', async () => {
    const e = await create(recurring('2030-07-01'));
    const ex = CalendarSeriesResultSchema.parse(
      (
        await edit(e, {
          scope: 'THIS_OCCURRENCE',
          recurrenceKey: '2030-07-05T09:00',
          exceptionRevision: 0,
          patch: { status: 'CANCELED' },
        })
      ).body,
    );
    const key = randomUUID(),
      input = {
        scope: 'THIS_AND_FUTURE',
        recurrenceKey: '2030-07-03T09:00',
        event: { ...recurring('2030-07-03'), title: 'Successor' },
      };
    const send = () =>
      call(a, 'post', `/calendar/events/${e.id}/series`, ex.event.revision)
        .set('Idempotency-Key', key)
        .send(input)
        .expect(200);
    const first = CalendarSeriesResultSchema.parse((await send()).body),
      second = CalendarSeriesResultSchema.parse((await send()).body);
    expect(second).toEqual(first);
    expect(first.successor?.previousSeriesId).toBe(e.id);
    const rows = (await view('2030-07-01', '2030-07-07')).filter(
      (i) => i.seriesId === e.id || i.seriesId === first.successor!.id,
    );
    expect(rows).toHaveLength(6);
    expect(
      rows.filter((i) => i.recurrenceKey?.startsWith('2030-07-05')),
    ).toHaveLength(1);
    expect(
      rows.find((i) => i.recurrenceKey?.startsWith('2030-07-05'))?.status,
    ).toBe('CANCELED');
    expect(
      await db.client.calendarEvent.count({
        where: { previousSeriesId: e.id },
      }),
    ).toBe(1);
  });
  it('bounds expansion and rejects cross-scope/query and stale held-resource cursors', async () => {
    const c = isolated;
    const e = await create(recurring('2035-01-01'), c);
    const query = {
      from: '2035-01-01',
      to: '2035-04-01',
      timezone: 'UTC',
      limit: '1',
    };
    let result = CalendarViewSchema.parse(
      (await call(c, 'get', '/calendar/views').query(query).expect(200)).body,
    );
    for (
      let i = 0;
      i < 50 && !result.items.some((o) => o.seriesId === e.id);
      i++
    )
      result = CalendarViewSchema.parse(
        (
          await call(c, 'get', '/calendar/views')
            .query({ ...query, cursor: result.nextCursor! })
            .expect(200)
        ).body,
      );
    expect(result.items[0]?.seriesId).toBe(e.id);
    expect(result.nextCursor).not.toBeNull();
    await call(b, 'get', '/calendar/views')
      .query({ ...query, cursor: result.nextCursor! })
      .expect(400);
    await call(c, 'get', '/calendar/views')
      .query({ ...query, to: '2035-03-01', cursor: result.nextCursor! })
      .expect(400);
    await call(c, 'post', `/calendar/events/${e.id}/series`, e.revision)
      .send({
        scope: 'THIS_OCCURRENCE',
        recurrenceKey: '2035-01-02T09:00',
        exceptionRevision: 0,
        patch: { title: 'Cursor stale' },
      })
      .expect(200);
    await call(c, 'get', '/calendar/views')
      .query({ ...query, cursor: result.nextCursor! })
      .expect(409);
    await call(c, 'get', '/calendar/views')
      .query({ ...query, to: '2036-01-01' })
      .expect(400);
  });
  it('detects overlaps advisory, including blocks and all-day events but not touching endpoints', async () => {
    const first = await create(body(timed('2034-08-01', '09:00', '10:00'))),
      touching = await create(body(timed('2034-08-01', '10:00', '11:00')));
    const block = TimeBlockSchema.parse(
      (
        await call(a, 'post', '/calendar/time-blocks')
          .set('Idempotency-Key', randomUUID())
          .send({
            title: 'Overlap',
            schedule: timed('2034-08-01', '09:30', '10:30'),
          })
          .expect(201)
      ).body,
    );
    const allDay = await create(
      body({
        kind: 'ALL_DAY',
        timezone: 'UTC',
        startDate: '2034-08-01',
        endDate: '2034-08-02',
      }),
    );
    const result = CalendarConflictsSchema.parse(
      (
        await call(a, 'get', '/calendar/conflicts')
          .query({
            from: '2034-08-01',
            to: '2034-08-02',
            timezone: 'UTC',
            limit: '100',
          })
          .expect(200)
      ).body,
    );
    const pair = (a: string, b: string) =>
      result.items.some(
        (p) => [p.left, p.right].includes(a) && [p.left, p.right].includes(b),
      );
    expect(result.advisory).toBe(true);
    expect(pair(first.id, block.id)).toBe(true);
    expect(pair(touching.id, block.id)).toBe(true);
    expect(pair(first.id, touching.id)).toBe(false);
    expect(pair(first.id, allDay.id)).toBe(true);
  });
  it('preserves saved event zones after account timezone/week/calendar preferences change', async () => {
    const e = await create(
        body(timed('2033-01-01', '23:30', '23:59', 'America/Los_Angeles')),
      ),
      before = e.schedule;
    const settings = await call(a, 'get', '/me/settings').expect(200);
    await call(
      a,
      'patch',
      '/me/settings',
      Number(String(settings.headers.etag).replaceAll('"', '')),
    )
      .send({
        timezone: 'Asia/Tokyo',
        preferredCalendar: 'JALALI',
        firstDayOfWeek: 6,
      })
      .expect(200);
    expect(
      (await call(a, 'get', `/calendar/events/${e.id}`).expect(200)).body
        .schedule,
    ).toEqual(before);
    const row = (await view('2033-01-02', '2033-01-03', a, 'Asia/Tokyo')).find(
      (i) => i.resourceId === e.id,
    )!;
    expect(row.displayStart).toBe('2033-01-02T16:30:00');
  });
  it('enforces scoped database FKs, unique exceptions and schedule constraints', async () => {
    const foreign = await create(body(), b),
      owned = await create(recurring('2037-01-01'));
    const data = {
      spaceId: a.spaceId,
      createdByUserId: a.id,
      title: 'constraint',
      status: 'ACTIVE',
      kind: 'ALL_DAY',
      timezone: 'UTC',
      startDate: new Date('2037-01-01'),
      endDate: new Date('2037-01-02'),
      seriesId: foreign.id,
      recurrenceKey: '2037-01-01T09:00',
    };
    await expect(
      db.client.calendarEvent.create({ data }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.client.calendarEvent.create({
        data: { ...data, seriesId: owned.id, endDate: new Date('2036-01-01') },
      }),
    ).rejects.toThrow();
    await edit(owned, {
      scope: 'THIS_OCCURRENCE',
      recurrenceKey: '2037-01-01T09:00',
      exceptionRevision: 0,
      patch: { status: 'CANCELED' },
    });
    await expect(
      db.client.calendarEvent.create({ data: { ...data, seriesId: owned.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('keeps block retries idempotent and terminal or newly-master Task links traceable', async () => {
    const t = (
      await call(a, 'post', '/tasks')
        .send({ title: 'Initially actionable' })
        .expect(201)
    ).body;
    const key = randomUUID(),
      input = {
        title: 'Reference',
        schedule: timed('2038-01-01'),
        taskId: t.id,
        taskRevision: 1,
      };
    const send = () =>
      call(a, 'post', '/calendar/time-blocks')
        .set('Idempotency-Key', key)
        .send(input)
        .expect(201);
    const first = TimeBlockSchema.parse((await send()).body);
    expect((await send()).body).toEqual(first);
    await call(a, 'post', '/task-recurrences')
      .send({
        taskId: t.id,
        taskRevision: 1,
        definition: recurring('2038-01-01').recurrence,
      })
      .expect(201);
    expect(
      (await call(a, 'get', '/calendar/time-blocks/' + first.id).expect(200))
        .body.taskDisposition,
    ).toBe('BLOCKED');
    const results = await Promise.all(
      ['A', 'B'].map((title) =>
        call(a, 'patch', '/calendar/time-blocks/' + first.id, 1).send({
          title,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await db.client.task.count({ where: { spaceId: a.spaceId, id: t.id } }),
    ).toBe(1);
    expect(
      await db.client.outboxEvent.count({
        where: { aggregateId: first.id, type: 'time_block.changed' },
      }),
    ).toBe(2);
    const occurrenceResult = await call(
      a,
      'post',
      '/task-recurrences/' +
        (
          await db.client.taskRecurrence.findUniqueOrThrow({
            where: { masterTaskId: t.id },
          })
        ).id +
        '/catch-up',
    )
      .set('Idempotency-Key', randomUUID())
      .send({ through: '2038-01-01', limit: 1 })
      .expect(200);
    const occurrence = occurrenceResult.body.items[0];
    const child = await db.client.task.findUniqueOrThrow({
      where: { id: occurrence.taskId },
    });
    const linked = TimeBlockSchema.parse(
      (
        await call(a, 'post', '/calendar/time-blocks')
          .set('Idempotency-Key', randomUUID())
          .send({
            title: 'Occurrence reference',
            schedule: timed('2038-01-01'),
            taskId: child.id,
            taskRevision: child.revision,
          })
          .expect(201)
      ).body,
    );
    await call(
      a,
      'post',
      '/task-occurrences/' + occurrence.id + '/skip',
      occurrence.revision,
    )
      .send({ taskRevision: child.revision })
      .expect(200);
    expect(
      (await call(a, 'get', '/calendar/time-blocks/' + linked.id).expect(200))
        .body.taskDisposition,
    ).toBe('SKIPPED');
  });
  it('keeps cancellation versions historical and refuses repeat terminal series edits', async () => {
    const input = recurring('2024-02-01'),
      e = await create(input);
    const changed = CalendarSeriesResultSchema.parse(
      (
        await edit(e, {
          scope: 'ENTIRE_SERIES',
          event: input,
          status: 'CANCELED',
        })
      ).body,
    );
    const history = (await view('2024-02-01', '2024-02-02')).find(
      (o) => o.seriesId === e.id,
    )!;
    expect(history.status).toBe('ACTIVE');
    const upcoming = (await view('2039-02-01', '2039-02-02')).find(
      (o) => o.seriesId === e.id,
    )!;
    expect(upcoming.status).toBe('CANCELED');
    await edit(changed.event, { scope: 'ENTIRE_SERIES', event: input }, 409);
  });
  it('emits only safe metadata in transactional audit/outbox', async () => {
    const e = await create();
    const events = await db.client.outboxEvent.findMany({
      where: { spaceId: a.spaceId, aggregateId: e.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({});
    const audits = await db.client.securityAuditEvent.findMany({
      where: { actorUserId: a.id, resourceId: e.id },
    });
    expect(audits.some((v) => v.action === 'CALENDAR_EVENT_CHANGE')).toBe(true);
    expect(JSON.stringify([...audits, ...events])).not.toMatch(
      /Private calendar title|private calendar description/,
    );
  });
  it('paginates collections without leaking other owners or accepting mismatched cursors', async () => {
    const c = isolated;
    const first = await create(body(), c);
    await create(body(), c);
    const page = await call(c, 'get', '/calendar/events')
      .query({ limit: '1' })
      .expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.items[0].spaceId).toBe(c.spaceId);
    expect(page.body.nextCursor).toBeTypeOf('string');
    await call(a, 'get', '/calendar/events')
      .query({ limit: '1', cursor: page.body.nextCursor })
      .expect(400);
    await call(c, 'get', '/calendar/time-blocks')
      .query({ cursor: page.body.nextCursor })
      .expect(400);
    const second = await call(c, 'get', '/calendar/events')
      .query({ limit: '1', cursor: page.body.nextCursor })
      .expect(200);
    expect(second.body.items[0].id).not.toBe(page.body.items[0].id);
    const third = await call(c, 'get', '/calendar/events')
      .query({ limit: '1', cursor: second.body.nextCursor })
      .expect(200);
    expect(third.body.nextCursor).toBeNull();
    expect([
      page.body.items[0].id,
      second.body.items[0].id,
      third.body.items[0].id,
    ]).toContain(first.id);
    await call(c, 'post', '/calendar/events').send(body()).expect(400);
  });
  it('binds advisory conflict pages to a current snapshot and rejects dense expansion', async () => {
    const c = isolated,
      q = { from: '2040-01-01', to: '2040-01-02', timezone: 'UTC', limit: '1' };
    const events = await Promise.all(
      [1, 2, 3].map(() => create(body(timed('2040-01-01')), c)),
    );
    const first = CalendarConflictsSchema.parse(
      (await call(c, 'get', '/calendar/conflicts').query(q).expect(200)).body,
    );
    expect(first.nextCursor).not.toBeNull();
    const second = CalendarConflictsSchema.parse(
      (
        await call(c, 'get', '/calendar/conflicts')
          .query({ ...q, cursor: first.nextCursor! })
          .expect(200)
      ).body,
    );
    expect(second.items).not.toEqual(first.items);
    await call(c, 'patch', '/calendar/events/' + events[0]!.id, 1)
      .send({ status: 'CANCELED' })
      .expect(200);
    await call(c, 'get', '/calendar/conflicts')
      .query({ ...q, cursor: first.nextCursor! })
      .expect(409);
    const dense = isolated;
    for (let i = 0; i < 12; i++) await create(recurring('2041-01-01'), dense);
    const rejected = await call(dense, 'get', '/calendar/conflicts')
      .query({ from: '2041-01-01', to: '2041-04-01', timezone: 'UTC' })
      .expect(400);
    expect(rejected.body.error.details).toContainEqual({
      path: 'schedule',
      code: 'RANGE_TOO_DENSE',
    });
  });
  it('requires linked revisions even when a raw database writer supplies SQL NULL', async () => {
    const t = (
      await call(a, 'post', '/tasks')
        .send({ title: 'Integrity target' })
        .expect(201)
    ).body;
    await expect(
      db.client.timeBlock.create({
        data: {
          spaceId: a.spaceId,
          createdByUserId: a.id,
          title: 'Invalid link',
          kind: 'TIMED',
          timezone: 'UTC',
          localStart: '2042-01-01T09:00',
          localEnd: '2042-01-01T10:00',
          startAt: new Date('2042-01-01T09:00:00Z'),
          endAt: new Date('2042-01-01T10:00:00Z'),
          taskId: t.id,
          selectedTaskRevision: null,
        },
      }),
    ).rejects.toThrow();
    expect(
      await db.client.timeBlock.count({
        where: { spaceId: a.spaceId, taskId: t.id },
      }),
    ).toBe(0);
  });
});
