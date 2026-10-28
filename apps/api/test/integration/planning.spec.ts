import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { PlanningTasks } from '../../src/modules/tasks/public/index.js';
import { PlanningPreferences } from '../../src/modules/account/public/index.js';
import {
  DailyPlanSchema,
  WeeklyPlanSchema,
  PlanningReviewSchema,
  RolloverPreviewSchema,
  RolloverResultSchema,
  CapacitySchema,
  AvailabilitySchema,
} from '@mehran/api-contracts';
import type { z } from 'zod';
type Day = z.infer<typeof DailyPlanSchema>;
type Actor = { id: string; spaceId: string; cookie: string };
type Task = { id: string; revision: number; status: string };
const databaseUrl = isolatedTestDatabaseUrl(process.env),
  origin = 'http://localhost:3000';
describe('P1-03 personal planning, isolation, rollover and capacity', () => {
  let app: NestExpressApplication,
    db: DatabaseService,
    a: Actor,
    b: Actor,
    dateCounter = 0;
  const users: string[] = [];
  const nextDate = () =>
    new Date(Date.UTC(2027, 0, 1 + dateCounter++)).toISOString().slice(0, 10);
  const call = (
    actor: Actor,
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    revision?: number,
  ) => {
    const result = request(app.getHttpServer())
      [method]('/api/v1' + path)
      .set('Cookie', actor.cookie)
      .set('Origin', origin);
    if (revision !== undefined) result.set('If-Match', `"${revision}"`);
    return result;
  };
  async function identity(): Promise<Actor> {
    const email = `p103-${randomUUID()}@example.test`,
      password = 'test-only-planning-password-123!';
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'Planning fixture' })
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
        .map((value) => value.split(';')[0])
        .join('; '),
      space = await db.client.space.findFirstOrThrow({
        where: { ownerUserId: id },
      });
    return { id, cookie, spaceId: space.id };
  }
  const task = async (
    actor = a,
    body: object = {
      title: 'Planning task',
      dueAt: '2026-10-30T09:00:00Z',
      scheduledDate: '2026-10-29',
    },
  ): Promise<Task> =>
    (await call(actor, 'post', '/tasks').send(body).expect(201)).body as Task;
  const createDay = async (date = nextDate(), actor = a): Promise<Day> =>
    DailyPlanSchema.parse(
      (await call(actor, 'post', `/planning/days/${date}`).send({}).expect(201))
        .body,
    );
  const readDay = async (date: string, actor = a) =>
    DailyPlanSchema.parse(
      (await call(actor, 'get', `/planning/days/${date}`).expect(200)).body,
    );
  const select = async (
    day: Day,
    t: Task,
    minutes: number | null = 30,
    position?: number,
  ) =>
    DailyPlanSchema.parse(
      (
        await call(
          a,
          'put',
          `/planning/days/${day.localDate}/items/${t.id}`,
          day.revision,
        )
          .send({
            taskRevision: t.revision,
            plannedMinutes: minutes,
            ...(position !== undefined ? { position } : {}),
          })
          .expect(200)
      ).body,
    );
  async function preferences(patch: object) {
    const settings = await call(a, 'get', '/me/settings').expect(200);
    await call(
      a,
      'patch',
      '/me/settings',
      Number(String(settings.headers.etag).replaceAll('"', '')),
    )
      .send(patch)
      .expect(200);
  }
  const preview = async (source: Day, targetDate: string) =>
    RolloverPreviewSchema.parse(
      (
        await call(a, 'post', '/planning/rollover/preview')
          .send({ fromDate: source.localDate, toDate: targetDate })
          .expect(200)
      ).body,
    );
  const commitBody = (
    p: z.infer<typeof RolloverPreviewSchema>,
    mode: 'COPY' | 'MOVE' = 'MOVE',
  ) => ({
    fromDate: p.fromDate,
    toDate: p.toDate,
    sourceRevision: p.sourceRevision,
    targetRevision: p.targetRevision,
    settingsRevision: p.settingsRevision,
    mode,
    items: p.items.map((item) => ({
      taskId: item.taskId,
      taskRevision: item.taskRevision ?? 1,
      itemRevision: item.itemRevision,
    })),
  });
  beforeAll(async () => {
    app = await testApplication({ databaseUrl });
    db = app.get(DatabaseService);
    a = await identity();
    b = await identity();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (db) {
      await db.client.securityAuditEvent.deleteMany({
        where: { actorUserId: { in: users } },
      });
      await db.client.space.deleteMany({
        where: { ownerUserId: { in: users } },
      });
      await db.client.user.deleteMany({ where: { id: { in: users } } });
    }
    await app?.close();
  });
  it('creates unique scoped days, keeps read-only GETs read-only and protects ownership fields', async () => {
    const date = nextDate();
    await call(a, 'get', `/planning/days/${date}`).expect(404);
    expect(
      await db.client.dailyPlan.count({
        where: { spaceId: a.spaceId, localDate: new Date(date) },
      }),
    ).toBe(0);
    const day = await createDay(date);
    expect(day).toMatchObject({ revision: 1, timezone: 'UTC', items: [] });
    await call(a, 'post', `/planning/days/${date}`).send({}).expect(409);
    expect((await createDay(date, b)).id).not.toBe(day.id);
    await call(a, 'post', `/planning/days/${nextDate()}`)
      .send({ spaceId: b.spaceId })
      .expect(400);
    await call(a, 'get', '/planning/days/2025-02-29').expect(400);
  });
  it('selects, inserts, reorders and removes references without changing Task identity, dates, history or outbox', async () => {
    const t1 = await task(),
      t2 = await task(),
      before = await db.client.task.findMany({
        where: { id: { in: [t1.id, t2.id] } },
      }),
      events = await db.client.outboxEvent.count({
        where: { aggregateId: { in: [t1.id, t2.id] } },
      });
    let day = await select(await createDay(), t1),
      next = await select(day, t2, 45, 0);
    expect(next.items.map((item) => item.taskId)).toEqual([t2.id, t1.id]);
    day = next;
    const itemIds = day.items.map((item) => item.id).sort();
    next = DailyPlanSchema.parse(
      (
        await call(a, 'patch', `/planning/days/${day.localDate}`, day.revision)
          .send({ taskIds: [t1.id, t2.id] })
          .expect(200)
      ).body,
    );
    expect(next.items.map((item) => item.position)).toEqual([0, 1]);
    expect(next.items.map((item) => item.id).sort()).toEqual(itemIds);
    day = next;
    next = DailyPlanSchema.parse(
      (
        await call(
          a,
          'delete',
          `/planning/days/${day.localDate}/items/${t2.id}`,
          day.revision,
        ).expect(200)
      ).body,
    );
    expect(next.items.map((item) => item.taskId)).toEqual([t1.id]);
    expect(
      await db.client.task.findMany({ where: { id: { in: [t1.id, t2.id] } } }),
    ).toEqual(before);
    expect(
      await db.client.outboxEvent.count({
        where: { aggregateId: { in: [t1.id, t2.id] } },
      }),
    ).toBe(events);
    expect(
      await db.client.taskChange.count({
        where: { taskId: { in: [t1.id, t2.id] } },
      }),
    ).toBe(2);
  });
  it('supports one Task in multiple dates and idempotent refresh within a date', async () => {
    const t = await task(),
      first = await select(await createDay(), t),
      second = await select(await createDay(), t);
    expect(first.items[0]!.taskId).toBe(second.items[0]!.taskId);
    expect(
      await db.client.dailyPlanItem.count({
        where: { spaceId: a.spaceId, taskId: t.id },
      }),
    ).toBe(2);
    const replay = await select(first, t);
    expect(replay).toEqual(first);
    expect(replay.items).toHaveLength(1);
  });
  it('requires strong plan revisions and rejects stale concurrent edits without lost selections', async () => {
    const day = await createDay(),
      t1 = await task(),
      t2 = await task();
    await call(a, 'put', `/planning/days/${day.localDate}/items/${t1.id}`)
      .send({ taskRevision: 1, plannedMinutes: 1 })
      .expect(400);
    const send = (t: Task) =>
      call(
        a,
        'put',
        `/planning/days/${day.localDate}/items/${t.id}`,
        day.revision,
      ).send({ taskRevision: 1, plannedMinutes: 1 });
    const results = await Promise.all([send(t1), send(t2)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect((await readDay(day.localDate)).items).toHaveLength(1);
  });
  it('moves only a selection and validates both plan and Task revisions', async () => {
    const t = await task(),
      day = await select(await createDay(), t, 90),
      target = await createDay(),
      before = await db.client.task.findUniqueOrThrow({ where: { id: t.id } });
    await call(
      a,
      'post',
      `/planning/days/${day.localDate}/items/${t.id}/move`,
      day.revision,
    )
      .send({
        targetDate: target.localDate,
        targetRevision: 9,
        taskRevision: 1,
      })
      .expect(409);
    const result = await call(
      a,
      'post',
      `/planning/days/${day.localDate}/items/${t.id}/move`,
      day.revision,
    )
      .send({
        targetDate: target.localDate,
        targetRevision: target.revision,
        taskRevision: 1,
      })
      .expect(200);
    expect(result.body.source.items).toEqual([]);
    expect(result.body.target.items[0]).toMatchObject({
      taskId: t.id,
      plannedMinutes: 90,
    });
    expect(
      await db.client.task.findUniqueOrThrow({ where: { id: t.id } }),
    ).toEqual(before);
  });
  it('creates missing move destinations only on explicit successful intent and denies duplicates', async () => {
    const t = await task(),
      source = await select(await createDay(), t),
      targetDate = nextDate();
    const result = await call(
      a,
      'post',
      `/planning/days/${source.localDate}/items/${t.id}/move`,
      source.revision,
    )
      .send({ targetDate, targetRevision: 0, taskRevision: 1 })
      .expect(200);
    expect(result.body.target.revision).toBe(1);
    const other = await select(await createDay(), t);
    await call(
      a,
      'post',
      `/planning/days/${other.localDate}/items/${t.id}/move`,
      other.revision,
    )
      .send({ targetDate, targetRevision: 1, taskRevision: 1 })
      .expect(409);
  });
  it('composes weekly plans from seven daily plans and tracks their revisions', async () => {
    await preferences({ timezone: 'UTC', firstDayOfWeek: 1 });
    const date = '2028-01-03',
      week = WeeklyPlanSchema.parse(
        (await call(a, 'post', `/planning/weeks/${date}`).send({}).expect(201))
          .body,
      );
    expect(week.days).toHaveLength(7);
    expect(week.days[6]!.localDate).toBe('2028-01-09');
    const day = await select(await createDay('2028-01-04'), await task());
    const updated = WeeklyPlanSchema.parse(
      (await call(a, 'get', `/planning/weeks/${date}`).expect(200)).body,
    );
    expect(updated.revision).toBeGreaterThan(week.revision);
    expect(updated.days[1]).toMatchObject({
      planId: day.id,
      revision: day.revision,
      selectionCount: 1,
    });
    await call(a, 'post', `/planning/weeks/${date}`).send({}).expect(409);
    await call(a, 'post', '/planning/weeks/2028-01-04').send({}).expect(400);
  });
  it('preserves historical timezone and week-start context across account preference changes', async () => {
    await preferences({ timezone: 'America/New_York', firstDayOfWeek: 1 });
    const day = await createDay('2028-02-07');
    const week = WeeklyPlanSchema.parse(
      (await call(a, 'post', '/planning/weeks/2028-02-07').send({}).expect(201))
        .body,
    );
    await preferences({ timezone: 'Asia/Tehran', firstDayOfWeek: 0 });
    expect((await readDay(day.localDate)).timezone).toBe('America/New_York');
    const old = WeeklyPlanSchema.parse(
      (await call(a, 'get', '/planning/weeks/2028-02-07').expect(200)).body,
    );
    expect(old.timezone).toBe(week.timezone);
    expect(old.firstDayOfWeek).toBe(1);
    expect((await createDay('2028-02-08')).timezone).toBe('Asia/Tehran');
    await call(a, 'post', '/planning/weeks/2028-02-14').send({}).expect(400);
    const newWeek = WeeklyPlanSchema.parse(
      (await call(a, 'post', '/planning/weeks/2028-02-06').send({}).expect(201))
        .body,
    );
    expect(newWeek.firstDayOfWeek).toBe(0);
    const review = PlanningReviewSchema.parse(
      (
        await call(a, 'post', '/planning/reviews')
          .send({
            kind: 'WEEKLY',
            localDate: old.weekStartDate,
            reflection: 'Original week',
          })
          .expect(201)
      ).body,
    );
    expect(review.timezone).toBe(old.timezone);
    expect(review.firstDayOfWeek).toBe(1);
  });
  it('creates one plan under a duplicate race while preserving both users same-date plans', async () => {
    const date = nextDate(),
      send = () => call(a, 'post', `/planning/days/${date}`).send({});
    const results = await Promise.all([send(), send()]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(
      await db.client.dailyPlan.count({
        where: { spaceId: a.spaceId, localDate: new Date(date) },
      }),
    ).toBe(1);
  });
  it('previews rollover without creating destinations, moving references or changing Tasks', async () => {
    const t = await task(),
      source = await select(await createDay(), t),
      targetDate = nextDate(),
      before = await db.client.task.findUniqueOrThrow({ where: { id: t.id } }),
      p = await preview(source, targetDate);
    expect(p.items[0]!.disposition).toBe('READY');
    expect(p.targetRevision).toBe(0);
    expect(
      await db.client.dailyPlan.count({
        where: { spaceId: a.spaceId, localDate: new Date(targetDate) },
      }),
    ).toBe(0);
    expect(await readDay(source.localDate)).toEqual(source);
    expect(
      await db.client.task.findUniqueOrThrow({ where: { id: t.id } }),
    ).toEqual(before);
  });
  it('commits explicit COPY/MOVE rollover atomically and replays exactly without duplicate effects', async () => {
    const t = await task(),
      source = await select(await createDay(), t),
      targetDate = nextDate(),
      before = await db.client.task.findUniqueOrThrow({ where: { id: t.id } }),
      p = await preview(source, targetDate),
      body = commitBody(p, 'COPY');
    const send = () =>
      call(a, 'post', '/planning/rollover/commit')
        .set('Idempotency-Key', 'copy-once')
        .send(body);
    const first = RolloverResultSchema.parse((await send().expect(200)).body),
      replay = (await send().expect(200)).body;
    expect(replay).toEqual(first);
    expect(first.succeeded).toBe(1);
    expect(first.source.items).toHaveLength(1);
    expect(first.target!.items).toHaveLength(1);
    expect(
      await db.client.task.findUniqueOrThrow({ where: { id: t.id } }),
    ).toEqual(before);
    const secondTarget = nextDate(),
      p2 = await preview(source, secondTarget),
      moved = RolloverResultSchema.parse(
        (
          await call(a, 'post', '/planning/rollover/commit')
            .set('Idempotency-Key', 'move-once')
            .send(commitBody(p2))
            .expect(200)
        ).body,
      );
    expect(moved.source.items).toHaveLength(0);
    expect(moved.target!.items[0]!.taskId).toBe(t.id);
    expect(
      await db.client.securityAuditEvent.count({
        where: { resourceId: source.id, action: 'PLANNING_ROLLOVER' },
      }),
    ).toBe(2);
  });
  it('deduplicates concurrent rollover, binds full requests and requires idempotency keys', async () => {
    const source = await select(await createDay(), await task()),
      p = await preview(source, nextDate()),
      body = commitBody(p),
      send = () =>
        call(a, 'post', '/planning/rollover/commit')
          .set('Idempotency-Key', 'concurrent-rollover')
          .send(body);
    const results = await Promise.all([send(), send()]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(results[0]!.body).toEqual(results[1]!.body);
    await call(a, 'post', '/planning/rollover/commit')
      .set('Idempotency-Key', 'concurrent-rollover')
      .send({ ...body, mode: 'COPY' })
      .expect(409);
    await call(a, 'post', '/planning/rollover/commit').send(body).expect(400);
  });
  it('rejects stale plan/settings snapshots and destination creation races without partial mutation', async () => {
    const source = await select(await createDay(), await task()),
      targetDate = nextDate(),
      p = await preview(source, targetDate);
    await createDay(targetDate);
    await call(a, 'post', '/planning/rollover/commit')
      .set('Idempotency-Key', 'target-race')
      .send(commitBody(p))
      .expect(409);
    expect((await readDay(source.localDate)).items).toHaveLength(1);
    const p2 = await preview(source, targetDate);
    await preferences({ timezone: 'UTC' });
    await call(a, 'post', '/planning/rollover/commit')
      .set('Idempotency-Key', 'settings-race')
      .send(commitBody(p2))
      .expect(409);
    const p3 = await preview(source, targetDate);
    await select(source, await task());
    await call(a, 'post', '/planning/rollover/commit')
      .set('Idempotency-Key', 'source-race')
      .send(commitBody(p3))
      .expect(409);
  });
  it('reports changed and completed Tasks per item while moving only successful selections', async () => {
    const t1 = await task(),
      t2 = await task(),
      t3 = await task();
    let day = await select(await createDay(), t1);
    day = await select(day, t2);
    day = await select(day, t3);
    const p = await preview(day, nextDate());
    await call(a, 'patch', `/tasks/${t2.id}`, 1)
      .send({ title: 'Changed after preview' })
      .expect(200);
    await call(a, 'post', `/tasks/${t3.id}/complete`, 1).send({}).expect(200);
    const result = RolloverResultSchema.parse(
      (
        await call(a, 'post', '/planning/rollover/commit')
          .set('Idempotency-Key', 'partial-rollover')
          .send(commitBody(p))
          .expect(200)
      ).body,
    );
    expect(result.succeeded).toBe(1);
    expect(result.items.map((item) => item.reason)).toEqual([
      null,
      'STALE',
      'COMPLETED',
    ]);
    expect(result.source.items.map((item) => item.taskId)).toEqual([
      t2.id,
      t3.id,
    ]);
    expect(result.target!.items.map((item) => item.taskId)).toEqual([t1.id]);
  });
  it('exposes stale selected revisions and allows explicit refresh without changing the Task', async () => {
    const t = await task(),
      day = await select(await createDay(), t);
    await call(a, 'patch', `/tasks/${t.id}`, 1)
      .send({ priority: 'HIGH' })
      .expect(200);
    expect((await readDay(day.localDate)).items[0]!.disposition).toBe('STALE');
    expect((await preview(day, nextDate())).items[0]!.disposition).toBe(
      'STALE',
    );
    const refreshed = await select(day, { ...t, revision: 2 });
    expect(refreshed.items[0]!.disposition).toBe('READY');
    expect(
      (await db.client.task.findUniqueOrThrow({ where: { id: t.id } }))
        .revision,
    ).toBe(2);
  });
  it('blocks masters and terminal Tasks and preserves completed/deleted selections until removed', async () => {
    const t = await task(),
      day = await select(await createDay(), t);
    await call(a, 'post', `/tasks/${t.id}/complete`, 1).send({}).expect(200);
    expect((await preview(day, nextDate())).items[0]!.disposition).toBe(
      'COMPLETED',
    );
    await call(
      a,
      'put',
      `/planning/days/${day.localDate}/items/${t.id}`,
      day.revision,
    )
      .send({ taskRevision: 2, plannedMinutes: 30 })
      .expect(409);
    await call(a, 'delete', `/tasks/${t.id}`, 2).expect(200);
    const read = await readDay(day.localDate);
    expect(read.items[0]).toMatchObject({
      disposition: 'DELETED',
      task: { title: null },
    });
    await call(
      a,
      'delete',
      `/planning/days/${day.localDate}/items/${t.id}`,
      day.revision,
    ).expect(200);
    const master = await task();
    await call(a, 'post', '/task-recurrences')
      .send({
        taskId: master.id,
        taskRevision: 1,
        definition: {
          startDate: '2026-10-28',
          endDate: '2026-10-29',
          localTime: '09:00',
          timezone: 'UTC',
          rule: { kind: 'DAILY', interval: 1 },
          exclusionDates: [],
        },
      })
      .expect(201);
    const target = await createDay();
    await call(
      a,
      'put',
      `/planning/days/${target.localDate}/items/${master.id}`,
      1,
    )
      .send({ taskRevision: 1, plannedMinutes: 10 })
      .expect(409);
  });
  it('references recurring occurrence Tasks, reports skipped/canceled states and never generates a duplicate', async () => {
    const master = await task(),
      series = (
        await call(a, 'post', '/task-recurrences')
          .send({
            taskId: master.id,
            taskRevision: 1,
            definition: {
              startDate: '2026-10-28',
              endDate: '2026-10-29',
              localTime: '09:00',
              timezone: 'UTC',
              rule: { kind: 'DAILY', interval: 1 },
              exclusionDates: [],
            },
          })
          .expect(201)
      ).body as { id: string };
    const generated = (
      await call(a, 'post', `/task-recurrences/${series.id}/catch-up`)
        .send({ through: '2026-10-29' })
        .expect(200)
    ).body as {
      items: Array<{ id: string; taskId: string; revision: number }>;
    };
    const first = generated.items[0]!,
      second = generated.items[1]!;
    const t1 = { id: first.taskId, revision: 1, status: 'OPEN' },
      t2 = { id: second.taskId, revision: 1, status: 'OPEN' };
    let day = await select(await createDay(), t1);
    day = await select(day, t2);
    await call(a, 'post', `/task-occurrences/${first.id}/skip`, 1)
      .send({ taskRevision: 1 })
      .expect(200);
    await call(a, 'post', `/task-occurrences/${second.id}/cancel`, 1)
      .send({ taskRevision: 1 })
      .expect(200);
    expect(
      (await preview(day, nextDate())).items.map((item) => item.disposition),
    ).toEqual(['SKIPPED', 'CANCELED']);
    expect(
      await db.client.taskOccurrence.count({ where: { seriesId: series.id } }),
    ).toBe(2);
  });
  it('reports already-selected and malicious unselected rollover IDs without leaking other users data', async () => {
    const t = await task(),
      foreign = await task(b),
      source = await select(await createDay(), t),
      target = await select(await createDay(), t),
      p = await preview(source, target.localDate);
    expect(p.items[0]!.disposition).toBe('ALREADY_SELECTED');
    const body = commitBody(p);
    body.items.push({ taskId: foreign.id, taskRevision: 1, itemRevision: 1 });
    const result = RolloverResultSchema.parse(
      (
        await call(a, 'post', '/planning/rollover/commit')
          .set('Idempotency-Key', 'not-selected')
          .send(body)
          .expect(200)
      ).body,
    );
    expect(result.succeeded).toBe(0);
    expect(result.items.map((item) => item.reason)).toEqual([
      'ALREADY_SELECTED',
      'BLOCKED',
    ]);
    expect(result.source.items).toHaveLength(1);
  });
  it('keeps availability unknown until configured and validates exact configured durations', async () => {
    const settings = AvailabilitySchema.parse(
      (await call(a, 'get', '/planning/capacity/availability').expect(200))
        .body,
    );
    expect(settings.availability).toBeNull();
    const day = await createDay();
    let capacity = CapacitySchema.parse(
      (
        await call(a, 'get', `/planning/capacity?date=${day.localDate}`).expect(
          200,
        )
      ).body,
    );
    expect(capacity.availableMinutes).toBeNull();
    expect(capacity.remainingMinutes).toBeNull();
    await call(a, 'put', '/planning/capacity/availability', settings.revision)
      .send({
        availability: {
          version: 1,
          minutesByWeekday: [60, 60, 60, 60, 60, 60, 60],
        },
      })
      .expect(200);
    await call(a, 'put', '/planning/capacity/availability', settings.revision)
      .send({ availability: null })
      .expect(409);
    capacity = CapacitySchema.parse(
      (
        await call(a, 'get', `/planning/capacity?date=${day.localDate}`).expect(
          200,
        )
      ).body,
    );
    expect(capacity).toMatchObject({
      availableMinutes: 60,
      knownPlannedMinutes: 0,
      remainingMinutes: 60,
    });
    const read = await call(a, 'get', '/me/settings').expect(200);
    expect(Object.keys(read.body).sort()).toEqual([
      'firstDayOfWeek',
      'locale',
      'preferredCalendar',
      'timezone',
    ]);
  });
  it('calculates explicit capacity with unknown allocations, advisory excess and no Task estimates', async () => {
    let day = await select(await createDay(), await task(), 90);
    day = await select(day, await task(), null);
    let cap = CapacitySchema.parse(
      (
        await call(a, 'get', `/planning/capacity?date=${day.localDate}`).expect(
          200,
        )
      ).body,
    );
    expect(cap).toMatchObject({
      availableMinutes: 60,
      knownPlannedMinutes: 90,
      unknownAllocations: 1,
      remainingMinutes: null,
      overCapacity: true,
    });
    const unknown = day.items[1]!,
      taskValue = {
        id: unknown.taskId,
        revision: unknown.task!.revision,
        status: 'OPEN',
      };
    day = await select(day, taskValue, 0);
    cap = CapacitySchema.parse(
      (
        await call(a, 'get', `/planning/capacity?date=${day.localDate}`).expect(
          200,
        )
      ).body,
    );
    expect(cap.remainingMinutes).toBe(-30);
    await call(
      a,
      'get',
      `/planning/capacity?date=${day.localDate}&weekStartDate=2027-01-04`,
    ).expect(400);
  });
  it('keeps configured durations stable over DST and composes week totals across a year boundary', async () => {
    await preferences({ timezone: 'America/New_York', firstDayOfWeek: 1 });
    const prefs = AvailabilitySchema.parse(
      (await call(a, 'get', '/planning/capacity/availability').expect(200))
        .body,
    );
    await call(a, 'put', '/planning/capacity/availability', prefs.revision)
      .send({
        availability: {
          version: 1,
          minutesByWeekday: [60, 60, 60, 60, 60, 60, 60],
        },
      })
      .expect(200);
    for (const date of ['2024-03-10', '2024-11-03']) {
      const cap = CapacitySchema.parse(
        (await call(a, 'get', `/planning/capacity?date=${date}`).expect(200))
          .body,
      );
      expect(cap.availableMinutes).toBe(60);
    }
    const cap = CapacitySchema.parse(
      (
        await call(
          a,
          'get',
          '/planning/capacity?weekStartDate=2024-12-30',
        ).expect(200)
      ).body,
    );
    expect(cap.days[6]!.localDate).toBe('2025-01-05');
    expect(cap.availableMinutes).toBe(420);
    await call(a, 'get', '/planning/capacity?weekStartDate=2024-12-31').expect(
      400,
    );
    await call(a, 'get', '/planning/capacity?weekStartDate=9998-12-31').expect(
      400,
    );
  });
  it('rejects invalid availability, field overposting and malformed allocation values', async () => {
    const prefs = AvailabilitySchema.parse(
      (await call(a, 'get', '/planning/capacity/availability').expect(200))
        .body,
    );
    for (const values of [
      [1],
      [1441, 0, 0, 0, 0, 0, 0],
      [-1, 0, 0, 0, 0, 0, 0],
      [0.5, 0, 0, 0, 0, 0, 0],
    ])
      await call(a, 'put', '/planning/capacity/availability', prefs.revision)
        .send({ availability: { version: 1, minutesByWeekday: values } })
        .expect(400);
    const day = await createDay(),
      t = await task();
    await call(a, 'put', `/planning/days/${day.localDate}/items/${t.id}`, 1)
      .send({
        taskRevision: 1,
        plannedMinutes: 30,
        dueAt: '2026-10-30T00:00:00Z',
      })
      .expect(400);
    await call(a, 'put', `/planning/days/${day.localDate}/items/${t.id}`, 1)
      .send({ taskRevision: 1, plannedMinutes: -1 })
      .expect(400);
  });
  it('creates private daily/weekly reviews, enforces uniqueness/revisions and audits metadata only', async () => {
    const date = nextDate(),
      text = 'PRIVATE reflection not for audit';
    const review = PlanningReviewSchema.parse(
      (
        await call(a, 'post', '/planning/reviews')
          .send({ kind: 'MORNING', localDate: date, reflection: text })
          .expect(201)
      ).body,
    );
    await call(a, 'post', '/planning/reviews')
      .send({ kind: 'MORNING', localDate: date, reflection: 'Duplicate' })
      .expect(409);
    await call(a, 'post', '/planning/reviews')
      .send({ kind: 'EVENING', localDate: date, reflection: 'Evening' })
      .expect(201);
    await call(a, 'patch', `/planning/reviews/${review.id}`, 1)
      .send({ reflection: 'Revised private' })
      .expect(200);
    await call(a, 'patch', `/planning/reviews/${review.id}`, 1)
      .send({ reflection: 'Stale' })
      .expect(409);
    const audit = await db.client.securityAuditEvent.findMany({
      where: { resourceId: review.id },
    });
    expect(audit.map((row) => row.action)).toEqual([
      'PLANNING_REVIEW_CREATE',
      'PLANNING_REVIEW_UPDATE',
    ]);
    expect(JSON.stringify(audit)).not.toContain('private');
    expect(JSON.stringify(audit)).not.toContain('PRIVATE');
    expect(
      await db.client.outboxEvent.count({ where: { aggregateId: review.id } }),
    ).toBe(0);
    await call(a, 'delete', `/planning/reviews/${review.id}`, 2).expect(204);
    await call(a, 'get', `/planning/reviews/${review.id}`).expect(404);
  });
  it('paginates reviews with scoped and query-bound cursors and denies private reads/edits/deletion', async () => {
    const date = nextDate(),
      own = PlanningReviewSchema.parse(
        (
          await call(a, 'post', '/planning/reviews')
            .send({
              kind: 'MORNING',
              localDate: date,
              reflection: 'Scoped review',
            })
            .expect(201)
        ).body,
      );
    const page = await call(a, 'get', '/planning/reviews?limit=1').expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.nextCursor).toBeTruthy();
    await call(
      b,
      'get',
      '/planning/reviews?limit=1&cursor=' + page.body.nextCursor,
    ).expect(400);
    await call(
      a,
      'get',
      '/planning/reviews?kind=MORNING&cursor=' + page.body.nextCursor,
    ).expect(400);
    for (const method of ['get', 'patch', 'delete'] as const) {
      const req = call(b, method, `/planning/reviews/${own.id}`, 1);
      if (method === 'patch') req.send({ reflection: 'Cannot read' });
      await req.expect(404);
    }
    const foreignList = await call(b, 'get', '/planning/reviews').expect(200);
    expect(JSON.stringify(foreignList.body)).not.toContain('Scoped review');
  });
  it('denies foreign Tasks, nested operations, plans and rollover receipts across scopes', async () => {
    const t = await task(),
      foreign = await task(b),
      source = await select(await createDay(), t),
      target = await createDay();
    await call(
      a,
      'put',
      `/planning/days/${target.localDate}/items/${foreign.id}`,
      1,
    )
      .send({ taskRevision: 1, plannedMinutes: 30 })
      .expect(404);
    await call(b, 'get', `/planning/days/${source.localDate}`).expect(404);
    await call(
      b,
      'delete',
      `/planning/days/${source.localDate}/items/${t.id}`,
      source.revision,
    ).expect(404);
    await call(
      a,
      'patch',
      `/planning/days/${source.localDate}`,
      source.revision,
    )
      .send({ taskIds: [foreign.id] })
      .expect(404);
    const p = await preview(source, target.localDate),
      body = commitBody(p);
    await call(a, 'post', '/planning/rollover/commit')
      .set('Idempotency-Key', 'scoped-rollover')
      .send(body)
      .expect(200);
    await call(b, 'post', '/planning/rollover/commit')
      .set('Idempotency-Key', 'scoped-rollover')
      .send(body)
      .expect(404);
    const otherSettings = AvailabilitySchema.parse(
      (await call(b, 'get', '/planning/capacity/availability').expect(200))
        .body,
    );
    expect(otherSettings.availability).toBeNull();
    const weekDate = '2029-01-01';
    await call(a, 'post', `/planning/weeks/${weekDate}`).send({}).expect(201);
    await call(b, 'get', `/planning/weeks/${weekDate}`).expect(404);
  });
  it('bounds plans to 100 items and keeps large reorders atomic with unique positions', async () => {
    const day = await createDay(),
      ids = Array.from({ length: 100 }, () => randomUUID());
    await db.client.task.createMany({
      data: ids.map((id) => ({
        id,
        spaceId: a.spaceId,
        createdByUserId: a.id,
        title: 'Bounded fixture',
      })),
    });
    await db.client.dailyPlanItem.createMany({
      data: ids.map((taskId, position) => ({
        spaceId: a.spaceId,
        planId: day.id,
        localDate: new Date(day.localDate),
        taskId,
        position,
        selectedTaskRevision: 1,
        plannedMinutes: 1,
      })),
    });
    const t = await task();
    await call(a, 'put', `/planning/days/${day.localDate}/items/${t.id}`, 1)
      .send({ taskRevision: 1, plannedMinutes: 1 })
      .expect(409);
    const reordered = DailyPlanSchema.parse(
      (
        await call(a, 'patch', `/planning/days/${day.localDate}`, 1)
          .send({ taskIds: [...ids].reverse() })
          .expect(200)
      ).body,
    );
    expect(reordered.items.map((item) => item.taskId)).toEqual(
      [...ids].reverse(),
    );
    expect(new Set(reordered.items.map((item) => item.position)).size).toBe(
      100,
    );
  });
  it('enforces scoped foreign keys, date/Task uniqueness and availability/review constraints in PostgreSQL', async () => {
    const day = await select(await createDay(), await task()),
      item = day.items[0]!,
      foreign = await task(b);
    const row = await db.client.dailyPlanItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    await expect(
      db.client.dailyPlanItem.create({
        data: { ...row, id: randomUUID(), position: 1 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      db.client.dailyPlanItem.create({
        data: { ...row, id: randomUUID(), taskId: foreign.id, position: 1 },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const otherDay = await createDay(),
      otherTask = await task();
    await expect(
      db.client.dailyPlanItem.create({
        data: {
          ...row,
          id: randomUUID(),
          taskId: otherTask.id,
          planId: otherDay.id,
          position: 0,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.client.userSettings.update({
        where: { userId: a.id },
        data: {
          planningAvailability: {
            version: 1,
            minutesByWeekday: [-1, 0, 0, 0, 0, 0, 0],
          },
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.planningReview.create({
        data: {
          spaceId: a.spaceId,
          createdByUserId: b.id,
          localDate: new Date(nextDate()),
          kind: 'MORNING',
          timezone: 'UTC',
          firstDayOfWeek: 1,
          reflection: 'Foreign creator',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
  it('rolls back source, destination, audit and receipt when response shaping fails after rollover writes', async () => {
    const source = await select(await createDay(), await task()),
      targetDate = nextDate(),
      p = await preview(source, targetDate),
      body = commitBody(p);
    const reader = app.get(PlanningTasks),
      original = reader.describe.bind(reader);
    let reads = 0;
    const spy = vi
      .spyOn(reader, 'describe')
      .mockImplementation(async (...args) => {
        reads++;
        if (reads === 2) throw new Error('simulated interruption after writes');
        return original(...args);
      });
    try {
      await call(a, 'post', '/planning/rollover/commit')
        .set('Idempotency-Key', 'retry-after-failure')
        .send(body)
        .expect(500);
    } finally {
      spy.mockRestore();
    }
    expect((await readDay(source.localDate)).items).toHaveLength(1);
    expect(
      await db.client.dailyPlan.count({
        where: { spaceId: a.spaceId, localDate: new Date(targetDate) },
      }),
    ).toBe(0);
    expect(
      await db.client.securityAuditEvent.count({
        where: { resourceId: source.id, action: 'PLANNING_ROLLOVER' },
      }),
    ).toBe(0);
    expect(
      await db.client.idempotencyRecord.count({
        where: {
          actorUserId: a.id,
          operation: 'post.planning.rollover.commit',
          keyHash: createHash('sha256')
            .update('retry-after-failure')
            .digest('hex'),
        },
      }),
    ).toBe(0);
    const result = await call(a, 'post', '/planning/rollover/commit')
      .set('Idempotency-Key', 'retry-after-failure')
      .send(body)
      .expect(200);
    expect(result.body.succeeded).toBe(1);
  });
  it('serializes availability updates and protects settings revision across the account contract', async () => {
    const current = AvailabilitySchema.parse(
        (await call(a, 'get', '/planning/capacity/availability').expect(200))
          .body,
      ),
      send = (minutes: number) =>
        call(
          a,
          'put',
          '/planning/capacity/availability',
          current.revision,
        ).send({
          availability: {
            version: 1,
            minutesByWeekday: Array(7).fill(minutes),
          },
        });
    const results = await Promise.all([send(15), send(20)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(app.get(PlanningPreferences)).toBeDefined();
  });
  it('arbitrates account preference and availability writers with one revision and no lock upgrade race', async () => {
    const current = AvailabilitySchema.parse(
      (await call(a, 'get', '/planning/capacity/availability').expect(200))
        .body,
    );
    const results = await Promise.all([
      call(a, 'put', '/planning/capacity/availability', current.revision).send({
        availability: { version: 1, minutesByWeekday: Array(7).fill(35) },
      }),
      call(a, 'patch', '/me/settings', current.revision).send({
        timezone: 'UTC',
        firstDayOfWeek: 6,
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const after = AvailabilitySchema.parse(
      (await call(a, 'get', '/planning/capacity/availability').expect(200))
        .body,
    );
    expect(after.revision).toBe(current.revision + 1);
  });
  it('excludes a Task converted into a master from My Day and capacity while retaining removable blocked metadata', async () => {
    await preferences({ firstDayOfWeek: 1 });
    const date = '2030-01-07',
      week = WeeklyPlanSchema.parse(
        (await call(a, 'post', `/planning/weeks/${date}`).send({}).expect(201))
          .body,
      ),
      t = await task(),
      day = await select(await createDay(date), t, 120);
    await call(a, 'post', '/task-recurrences')
      .send({
        taskId: t.id,
        taskRevision: 1,
        definition: {
          startDate: date,
          endDate: date,
          localTime: '09:00',
          timezone: 'UTC',
          rule: { kind: 'DAILY', interval: 1 },
          exclusionDates: [],
        },
      })
      .expect(201);
    const read = await readDay(date);
    expect(read.items).toEqual([]);
    expect(read.blockedItems).toHaveLength(1);
    expect(read.blockedItems[0]).toMatchObject({
      taskId: t.id,
      task: null,
      disposition: 'BLOCKED',
    });
    const weekly = WeeklyPlanSchema.parse(
      (await call(a, 'get', `/planning/weeks/${date}`).expect(200)).body,
    );
    expect(weekly.days[0]).toMatchObject({
      selectionCount: 0,
      blockedCount: 1,
    });
    expect(weekly.id).toBe(week.id);
    const cap = CapacitySchema.parse(
      (await call(a, 'get', `/planning/capacity?date=${date}`).expect(200))
        .body,
    );
    expect(cap).toMatchObject({
      knownPlannedMinutes: 0,
      blockedAllocations: 1,
      remainingMinutes: null,
    });
    expect((await preview(day, '2030-01-08')).items[0]!.disposition).toBe(
      'BLOCKED',
    );
    await call(
      a,
      'delete',
      `/planning/days/${date}/items/${t.id}`,
      day.revision,
    ).expect(200);
  });
});
