import { cleanupFixtureIdentities } from '../support/fixture-cleanup.js';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as c from '@mehran/api-contracts';
import { testApplication } from '../support/application.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
type Actor = { id: string; spaceId: string; cookie: string };
describe('P1-06 goals, source consistency, history and isolation', () => {
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
    const email = `p106-${randomUUID()}@example.test`,
      password = 'test-only-habits-password-123!';
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'Goal fixture' })
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
  afterAll(async () => {
    if (db) await cleanupFixtureIdentities(databaseUrl, { ids: users });
    await app?.close();
  });
  const create = async (input: object = {}, actor = a, key = randomUUID()) =>
    c.GoalSchema.parse(
      (
        await call(actor, 'post', '/goals')
          .set('Idempotency-Key', key)
          .send({ title: 'Private goal', horizon: 'SHORT_TERM', ...input })
          .expect(201)
      ).body,
    );
  const get = async (id: string) =>
    c.GoalSchema.parse((await call(a, 'get', '/goals/' + id).expect(200)).body);
  const patch = async (g: c.Goal, input: object) =>
    c.GoalSchema.parse(
      (
        await call(a, 'patch', '/goals/' + g.id, g.revision)
          .send(input)
          .expect(200)
      ).body,
    );
  const progress = async (g: c.Goal) =>
    c.GoalProgressSchema.parse(
      (await call(a, 'get', '/goals/' + g.id + '/progress').expect(200)).body,
    );
  const nested = async (g: c.Goal, path: string, input: object) => {
    const r = await call(a, 'post', '/goals/' + g.id + '/' + path, g.revision)
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(201);
    return {
      body: r.body as {
        id: string;
        revision: number;
        item: Record<string, unknown>;
      },
      goal: await get(g.id),
    };
  };
  const task = async (actor = a) =>
    c.TaskSchema.parse(
      (
        await call(actor, 'post', '/tasks')
          .send({ title: 'Private linked task' })
          .expect(201)
      ).body,
    );
  const habit = async (actor = a) =>
    c.HabitSchema.parse(
      (
        await call(actor, 'post', '/habits')
          .set('Idempotency-Key', randomUUID())
          .send({
            title: 'Private linked habit',
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
  it('creates life areas and organizes short/long-term goals without changing identity', async () => {
    const area = c.LifeAreaSchema.parse(
      (
        await call(a, 'post', '/life-areas')
          .set('Idempotency-Key', randomUUID())
          .send({ title: ' Health ', position: 7 })
          .expect(201)
      ).body,
    );
    let g = await create({
      horizon: 'LONG_TERM',
      lifeAreaId: area.id,
      startDate: '2024-02-29',
      targetDate: '2028-02-29',
    });
    expect(g.lifeAreaId).toBe(area.id);
    g = await patch(g, { title: 'Updated goal' });
    expect(g.lifeAreaId).toBe(area.id);
    expect(g.horizon).toBe('LONG_TERM');
    const updated = c.LifeAreaSchema.parse(
      (
        await call(a, 'patch', '/life-areas/' + area.id, area.revision)
          .send({ title: 'Wellbeing' })
          .expect(200)
      ).body,
    );
    expect(updated.position).toBe(7);
    await call(a, 'delete', '/life-areas/' + area.id, updated.revision).expect(
      200,
    );
    expect((await get(g.id)).lifeAreaId).toBe(area.id);
    await call(a, 'post', '/goals')
      .set('Idempotency-Key', randomUUID())
      .send({ title: 'x', horizon: 'SHORT_TERM', lifeAreaId: area.id })
      .expect(400);
  });
  it('keeps progress separate from explicit status transitions', async () => {
    let g = await create({ manualProgress: '150' });
    expect(await progress(g)).toMatchObject({
      rawPercentage: '150',
      percentage: '100',
    });
    expect((await get(g.id)).status).toBe('PLANNED');
    for (const status of [
      'ACTIVE',
      'PAUSED',
      'COMPLETED',
      'ABANDONED',
      'PLANNED',
    ] as const) {
      g = await patch(g, { status });
      expect(g.status).toBe(status);
    }
  });
  it('rejects self/indirect cycles and excessive descendant depth', async () => {
    let root = await create(),
      previous = root;
    for (let i = 0; i < 4; i++)
      previous = await create({ parentGoalId: previous.id });
    await call(a, 'post', '/goals')
      .set('Idempotency-Key', randomUUID())
      .send({
        title: 'too deep',
        horizon: 'SHORT_TERM',
        parentGoalId: previous.id,
      })
      .expect(400);
    await call(a, 'patch', '/goals/' + root.id, root.revision)
      .send({ parentGoalId: previous.id })
      .expect(400);
    await call(a, 'patch', '/goals/' + root.id, root.revision)
      .send({ parentGoalId: root.id })
      .expect(400);
    root = await patch(root, { status: 'ACTIVE' });
    expect(root.parentGoalId).toBeNull();
  });
  it('normalizes exact weighted milestones and preserves completion timestamps', async () => {
    let g = await create({ progressMode: 'WEIGHTED' });
    const m = await nested(g, 'milestones', {
      title: 'First',
      status: 'COMPLETED',
      contributes: true,
      weight: '2',
    });
    g = m.goal;
    g = (
      await nested(g, 'milestones', {
        title: 'Second',
        contributes: true,
        weight: '1',
      })
    ).goal;
    expect(await progress(g)).toMatchObject({
      percentage: '66.666667',
      weightSum: '3',
    });
    const r = await call(
      a,
      'patch',
      '/goals/' + g.id + '/milestones/' + m.body.id,
      g.revision,
    )
      .send({ title: 'Renamed' })
      .expect(200);
    expect(r.body.item.completedAt).toBe(m.body.item.completedAt);
    expect(r.body.item.status).toBe('COMPLETED');
  });
  it('selects descending metrics and refuses zero denominators/selected removal', async () => {
    let g = await create();
    const m = await nested(g, 'metrics', {
      title: 'Reduce',
      unit: 'COUNT',
      baseline: '100',
      target: '0',
      current: '75',
    });
    g = m.goal;
    g = await patch(g, { progressMode: 'METRIC', metricId: m.body.id });
    expect(await progress(g)).toMatchObject({
      percentage: '25',
      sources: [
        expect.objectContaining({
          metric: {
            baseline: '100',
            target: '0',
            current: '75',
            unit: 'COUNT',
          },
        }),
      ],
    });
    await call(
      a,
      'patch',
      '/goals/' + g.id + '/metrics/' + m.body.id,
      g.revision,
    )
      .send({ target: '100' })
      .expect(400);
    await call(
      a,
      'delete',
      '/goals/' + g.id + '/metrics/' + m.body.id,
      g.revision,
    ).expect(400);
    g = await patch(g, { progressMode: 'MANUAL', metricId: null });
    await call(
      a,
      'delete',
      '/goals/' + g.id + '/metrics/' + m.body.id,
      g.revision,
    ).expect(200);
  });
  it('isolates same-space metric selection from other goals', async () => {
    const g = await create(),
      other = await create(),
      m = await nested(other, 'metrics', {
        title: 'm',
        unit: 'COUNT',
        baseline: '0',
        target: '10',
        current: '5',
      });
    await call(a, 'patch', '/goals/' + g.id, g.revision)
      .send({ progressMode: 'METRIC', metricId: m.body.id })
      .expect(404);
  });
  it('recomputes Task completion/reopen/delete while preserving source identity', async () => {
    let g = await create({ progressMode: 'WEIGHTED' });
    let t = await task();
    const initialCount = await db.client.task.count({
      where: { spaceId: a.spaceId },
    });
    const link = await nested(g, 'links/tasks', {
      taskId: t.id,
      sourceRevision: t.revision,
      contributes: true,
    });
    g = link.goal;
    expect((await progress(g)).percentage).toBe('0');
    t = c.TaskSchema.parse(
      (
        await call(a, 'post', '/tasks/' + t.id + '/complete', t.revision)
          .send({})
          .expect(200)
      ).body,
    );
    expect((await progress(g)).percentage).toBe('100');
    expect(await db.client.task.count({ where: { spaceId: a.spaceId } })).toBe(
      initialCount,
    );
    t = c.TaskSchema.parse(
      (
        await call(a, 'post', '/tasks/' + t.id + '/reopen', t.revision)
          .send({})
          .expect(200)
      ).body,
    );
    expect((await progress(g)).percentage).toBe('0');
    await call(a, 'delete', '/tasks/' + t.id, t.revision).expect(200);
    expect((await progress(g)).sources[0]?.disposition).toBe('DELETED');
    await call(
      a,
      'delete',
      '/goals/' + g.id + '/links/tasks/' + link.body.id,
      g.revision,
    ).expect(200);
    expect((await progress(g)).reason).toBe('NO_SOURCES');
  });
  it('requires explicit source contribution and supports shared task references', async () => {
    let g = await create({ progressMode: 'WEIGHTED' }),
      other = await create({ progressMode: 'WEIGHTED' }),
      t = await task();
    const l = await nested(g, 'links/tasks', {
      taskId: t.id,
      sourceRevision: t.revision,
    });
    g = l.goal;
    other = (
      await nested(other, 'links/tasks', {
        taskId: t.id,
        sourceRevision: t.revision,
        contributes: true,
      })
    ).goal;
    expect((await progress(g)).sources).toEqual([]);
    t = c.TaskSchema.parse(
      (
        await call(a, 'post', '/tasks/' + t.id + '/complete', t.revision)
          .send({})
          .expect(200)
      ).body,
    );
    expect((await progress(other)).percentage).toBe('100');
    expect((await progress(g)).percentage).toBe('0');
    await call(
      a,
      'patch',
      '/goals/' + g.id + '/links/tasks/' + l.body.id,
      g.revision,
    )
      .send({ contributes: true })
      .expect(200);
    expect((await progress(g)).percentage).toBe('100');
  });
  it('recomputes Habit corrections/skips/pauses with canonical denominator', async () => {
    const h = await habit();
    let g = await create({ progressMode: 'WEIGHTED' });
    g = (
      await nested(g, 'links/habits', {
        habitId: h.id,
        sourceRevision: h.revision,
        from: '2024-01-01',
        to: '2024-01-03',
        contributes: true,
      })
    ).goal;
    const e = c.HabitEntrySchema.parse(
      (
        await call(a, 'post', '/habits/' + h.id + '/entries')
          .set('Idempotency-Key', randomUUID())
          .send({ habitRevision: h.revision, localDate: '2024-01-01' })
          .expect(201)
      ).body,
    );
    expect((await progress(g)).percentage).toBe('50');
    await call(a, 'post', '/habits/' + h.id + '/entries')
      .set('Idempotency-Key', randomUUID())
      .send({
        habitRevision: h.revision,
        localDate: '2024-01-02',
        action: 'SKIP',
      })
      .expect(201);
    expect((await progress(g)).percentage).toBe('100');
    c.HabitEntrySchema.parse(
      (
        await call(
          a,
          'patch',
          '/habits/' + h.id + '/entries/' + e.id,
          e.revision,
        )
          .send({ habitRevision: h.revision, value: '0' })
          .expect(200)
      ).body,
    );
    expect((await progress(g)).percentage).toBe('0');
    await call(a, 'patch', '/habits/' + h.id, h.revision)
      .send({
        status: 'PAUSED',
        effectiveFrom: '2024-01-01',
        confirmHistoricalChange: true,
      })
      .expect(200);
    expect((await progress(g)).sources[0]?.disposition).toBe('NO_DUE_DAYS');
  });
  it('keeps snapshots immutable through source changes and unlinking', async () => {
    let g = await create({ progressMode: 'WEIGHTED' });
    const t = await task(),
      l = await nested(g, 'links/tasks', {
        taskId: t.id,
        sourceRevision: t.revision,
        contributes: true,
      });
    g = l.goal;
    const review = c.GoalReviewMutationSchema.parse(
      (
        await call(a, 'post', '/goals/' + g.id + '/reviews', g.revision)
          .set('Idempotency-Key', randomUUID())
          .send({ reflection: 'Private review' })
          .expect(201)
      ).body,
    );
    g = await get(g.id);
    await call(a, 'post', '/tasks/' + t.id + '/complete', t.revision)
      .send({})
      .expect(200);
    expect((await progress(g)).percentage).toBe('100');
    await call(
      a,
      'delete',
      '/goals/' + g.id + '/links/tasks/' + l.body.id,
      g.revision,
    ).expect(200);
    const page = c.GoalReviewPageSchema.parse(
      (await call(a, 'get', '/goals/' + g.id + '/reviews').expect(200)).body,
    );
    expect(page.items[0]?.snapshot).toEqual(review.snapshot);
    expect(review.snapshot.percentage).toBe('0');
    expect(review.snapshot.ruleVersion).toBe(1);
  });
  it('deduplicates concurrent creates and snapshot replay with changed state', async () => {
    const key = randomUUID(),
      [x, y] = await Promise.all([create({}, a, key), create({}, a, key)]);
    expect(x).toEqual(y);
    const receiptKey = randomUUID(),
      response = await call(
        a,
        'post',
        '/goals/' + x.id + '/progress',
        x.revision,
      )
        .set('Idempotency-Key', receiptKey)
        .send({})
        .expect(201);
    const g = await get(x.id);
    await patch(g, { manualProgress: '50' });
    const replay = await call(
      a,
      'post',
      '/goals/' + x.id + '/progress',
      x.revision,
    )
      .set('Idempotency-Key', receiptKey)
      .send({})
      .expect(201);
    expect(replay.body).toEqual(response.body);
    await call(a, 'post', '/goals/' + x.id + '/progress', g.revision)
      .set('Idempotency-Key', receiptKey)
      .send({})
      .expect(409);
  });
  it('rejects stale source and concurrent goal revisions atomically', async () => {
    const g = await create(),
      t = await task();
    await call(a, 'post', '/goals/' + g.id + '/links/tasks', g.revision)
      .set('Idempotency-Key', randomUUID())
      .send({ taskId: t.id, sourceRevision: t.revision + 1 })
      .expect(409);
    const results = await Promise.all([
      call(a, 'patch', '/goals/' + g.id, g.revision).send({ title: 'a' }),
      call(a, 'patch', '/goals/' + g.id, g.revision).send({ title: 'b' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await get(g.id)).revision).toBe(g.revision + 1);
  });
  it('prevents concurrent reciprocal hierarchy edits creating a cycle', async () => {
    const x = await create(),
      y = await create(),
      results = await Promise.all([
        call(a, 'patch', '/goals/' + x.id, x.revision).send({
          parentGoalId: y.id,
        }),
        call(a, 'patch', '/goals/' + y.id, y.revision).send({
          parentGoalId: x.id,
        }),
      ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });
  it('denies every foreign aggregate/nested route and authorized filters safely', async () => {
    const g = await create({}, b),
      own = await create(),
      area = c.LifeAreaSchema.parse(
        (
          await call(b, 'post', '/life-areas')
            .set('Idempotency-Key', randomUUID())
            .send({ title: 'private' })
            .expect(201)
        ).body,
      );
    for (const path of [
      '/goals/' + g.id,
      '/goals/' + g.id + '/progress',
      '/goals/' + g.id + '/reviews',
      '/goals/' + g.id + '/milestones',
      '/goals/' + g.id + '/metrics',
      '/goals/' + g.id + '/links/tasks',
      '/goals/' + g.id + '/links/habits',
      '/life-areas/' + area.id,
    ]) {
      const r = await call(a, 'get', path).expect(404);
      expect(JSON.stringify(r.body)).not.toMatch(
        /Private goal|private linked|reflection/,
      );
    }
    await call(a, 'patch', '/goals/' + g.id, g.revision)
      .send({ title: 'x' })
      .expect(404);
    await call(a, 'get', '/goals').query({ lifeAreaId: area.id }).expect(404);
    await call(a, 'get', '/goals').query({ parentGoalId: g.id }).expect(404);
    await call(a, 'patch', '/goals/' + own.id, own.revision)
      .send({ parentGoalId: g.id })
      .expect(404);
  });
  it('rejects foreign Task/Habit links and nested ID swaps', async () => {
    const g = await create(),
      t = await task(b),
      h = await habit(b),
      other = await create(),
      m = await nested(other, 'milestones', { title: 'private child' });
    for (const [path, body] of [
      ['links/tasks', { taskId: t.id, sourceRevision: t.revision }],
      [
        'links/habits',
        {
          habitId: h.id,
          sourceRevision: h.revision,
          from: '2024-01-01',
          to: '2024-01-02',
        },
      ],
    ] as const)
      await call(a, 'post', '/goals/' + g.id + '/' + path, g.revision)
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .expect(404);
    await call(
      a,
      'patch',
      '/goals/' + g.id + '/milestones/' + m.body.id,
      g.revision,
    )
      .send({ title: 'stolen' })
      .expect(404);
  });
  it('enforces ownership and metric denominator in database constraints', async () => {
    const g = await create(),
      foreign = await create({}, b),
      t = await task(b);
    await expect(
      db.client.goalTaskLink.create({
        data: {
          spaceId: g.spaceId,
          goalId: g.id,
          taskId: t.id,
          selectedSourceRevision: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.client.goal.update({
        where: { id: g.id },
        data: { parentGoalId: foreign.id },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.client.goalMetric.create({
        data: {
          spaceId: g.spaceId,
          goalId: g.id,
          title: 'invalid',
          unit: 'COUNT',
          baseline: '1',
          target: '1',
          current: '1',
        },
      }),
    ).rejects.toThrow();
  });
  it('keeps saved goal timezone and historical dates after account travel', async () => {
    let g = await create({
      timezone: 'America/New_York',
      startDate: '2024-03-10',
      targetDate: '2024-11-03',
    });
    const r = await call(a, 'get', '/me/settings').expect(200);
    await call(a, 'patch', '/me/settings', r.body.revision)
      .send({ timezone: 'Asia/Tokyo' })
      .expect(200);
    g = await get(g.id);
    expect(g.timezone).toBe('America/New_York');
    expect(g.startDate).toBe('2024-03-10');
    expect((await progress(g)).timezone).toBe(g.timezone);
    expect((await create()).timezone).toBe('Asia/Tokyo');
  });
  it('paginates scoped lists and history without leaking cross-user cursors', async () => {
    const first = c.GoalPageSchema.parse(
      (await call(a, 'get', '/goals').query({ limit: '1' }).expect(200)).body,
    );
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = c.GoalPageSchema.parse(
      (
        await call(a, 'get', '/goals')
          .query({ limit: '1', cursor: first.nextCursor })
          .expect(200)
      ).body,
    );
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    await call(b, 'get', '/goals')
      .query({ cursor: first.nextCursor })
      .expect(400);
  });
  it('stores only metadata audit and outbox with atomic failure rollback', async () => {
    const g = await create();
    await call(a, 'post', '/goals/' + g.id + '/reviews', g.revision)
      .set('Idempotency-Key', randomUUID())
      .send({ reflection: 'Secret goal reflection' })
      .expect(201);
    const rows = await db.client.outboxEvent.findMany({
      where: { aggregateId: g.id, type: 'goal.progress_changed' },
    });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => JSON.stringify(r.payload) === '{}')).toBe(true);
    const events = await db.client.securityAuditEvent.findMany({
      where: { resourceId: g.id },
    });
    expect(JSON.stringify(events)).not.toMatch(
      /Secret goal reflection|Private goal/,
    );
    const stale = await call(
      a,
      'post',
      '/goals/' + g.id + '/progress',
      g.revision,
    )
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(409);
    expect(stale.body.error.code).toBe('CONFLICT');
    expect(
      await db.client.outboxEvent.count({ where: { aggregateId: g.id } }),
    ).toBe(2);
  });

  it('handles recurring Task skips/cancellation and master conversion without counting them', async () => {
    let g = await create({ progressMode: 'WEIGHTED' });
    const master = await task();
    const existing = await nested(g, 'links/tasks', {
      taskId: master.id,
      sourceRevision: master.revision,
      contributes: true,
    });
    g = existing.goal;
    const series = c.TaskRecurrenceSchema.parse(
      (
        await call(a, 'post', '/task-recurrences')
          .send({
            taskId: master.id,
            taskRevision: master.revision,
            definition: {
              startDate: '2024-01-01',
              endDate: '2024-01-02',
              localTime: '09:00',
              timezone: 'UTC',
              rule: { kind: 'DAILY', interval: 1 },
              exclusionDates: [],
            },
          })
          .expect(201)
      ).body,
    );
    expect((await progress(g)).sources[0]?.disposition).toBe('MASTER');
    const fresh = await create();
    await call(a, 'post', '/goals/' + fresh.id + '/links/tasks', fresh.revision)
      .set('Idempotency-Key', randomUUID())
      .send({ taskId: master.id, sourceRevision: master.revision })
      .expect(400);
    const result = await call(
      a,
      'post',
      '/task-recurrences/' + series.id + '/catch-up',
    )
      .send({ through: '2024-01-02', limit: 10 })
      .expect(200);
    const items = c.TaskOccurrenceSchema.array().parse(result.body.items);
    for (const [i, op] of ['skip', 'cancel'].entries()) {
      const occurrence = items[i]!,
        t = c.TaskSchema.parse(
          (await call(a, 'get', '/tasks/' + occurrence.taskId).expect(200))
            .body,
        );
      g = (
        await nested(g, 'links/tasks', {
          taskId: t.id,
          sourceRevision: t.revision,
          contributes: true,
        })
      ).goal;
      await call(
        a,
        'post',
        '/task-occurrences/' + occurrence.id + '/' + op,
        occurrence.revision,
      )
        .send({ taskRevision: t.revision })
        .expect(200);
    }
    const resultProgress = await progress(g);
    expect(resultProgress.percentage).toBe('0');
    expect(resultProgress.sources.map((s) => s.disposition).sort()).toEqual([
      'CANCELED',
      'MASTER',
      'SKIPPED',
    ]);
  });
  it('bounds nested collections and prevents duplicate links under concurrent retries', async () => {
    let g = await create();
    const t = await task(),
      key = randomUUID();
    const send = () =>
      call(a, 'post', '/goals/' + g.id + '/links/tasks', g.revision)
        .set('Idempotency-Key', key)
        .send({ taskId: t.id, sourceRevision: t.revision });
    const [first, second] = await Promise.all([send(), send()]);
    expect(first.status).toBe(201);
    expect(second.body).toEqual(first.body);
    g = await get(g.id);
    await call(a, 'post', '/goals/' + g.id + '/links/tasks', g.revision)
      .set('Idempotency-Key', randomUUID())
      .send({ taskId: t.id, sourceRevision: t.revision })
      .expect(409);
    await db.client.goalMilestone.createMany({
      data: Array.from({ length: 100 }, (_, position) => ({
        spaceId: g.spaceId,
        goalId: g.id,
        title: 'bounded',
        position,
      })),
    });
    await call(a, 'post', '/goals/' + g.id + '/milestones', g.revision)
      .set('Idempotency-Key', randomUUID())
      .send({ title: 'over limit' })
      .expect(400);
    expect(
      (await call(a, 'get', '/goals/' + g.id + '/milestones').expect(200)).body
        .items,
    ).toHaveLength(100);
  });
  it('uses saved Habit local dates across DST midnight and account travel', async () => {
    const h = await habit();
    const updated = c.HabitSchema.parse(
      (
        await call(a, 'patch', '/habits/' + h.id, h.revision)
          .send({
            timezone: 'America/New_York',
            effectiveFrom: '2024-01-01',
            confirmHistoricalChange: true,
          })
          .expect(200)
      ).body,
    );
    let g = await create({ progressMode: 'WEIGHTED' });
    const link = await nested(g, 'links/habits', {
      habitId: h.id,
      sourceRevision: updated.revision,
      from: '2024-03-10',
      to: '2024-03-12',
      contributes: true,
    });
    g = link.goal;
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2024-03-11T03:59:59Z'));
      let p = await progress(g);
      expect(p.sources[0]).toMatchObject({
        asOfDate: '2024-03-10',
        timezone: 'America/New_York',
        denominator: '1',
      });
      vi.setSystemTime(new Date('2024-03-11T04:00:00Z'));
      p = await progress(g);
      expect(p.sources[0]).toMatchObject({
        asOfDate: '2024-03-11',
        denominator: '2',
      });
      vi.setSystemTime(new Date('2024-11-03T05:30:00Z'));
      await call(
        a,
        'patch',
        '/goals/' + g.id + '/links/habits/' + link.body.id,
        g.revision,
      )
        .send({ from: '2024-11-03', to: '2024-11-04' })
        .expect(200);
      expect((await progress(g)).sources[0]?.asOfDate).toBe('2024-11-03');
      vi.setSystemTime(new Date('2024-11-03T06:30:00Z'));
      expect((await progress(g)).sources[0]?.asOfDate).toBe('2024-11-03');
    } finally {
      vi.useRealTimers();
    }
  });
  it('authorizes mutation routes and rejects malformed payloads without writes', async () => {
    const own = await create(),
      foreign = await create({}, b),
      h = await habit(b),
      t = await task(b);
    for (const [path, body] of [
      ['milestones', { title: 'x' }],
      [
        'metrics',
        { title: 'm', unit: 'COUNT', baseline: '0', target: '1', current: '0' },
      ],
      ['links/tasks', { taskId: t.id, sourceRevision: t.revision }],
      [
        'links/habits',
        {
          habitId: h.id,
          sourceRevision: h.revision,
          from: '2024-01-01',
          to: '2024-01-02',
        },
      ],
      ['progress', {}],
      ['reviews', { reflection: 'x' }],
    ] as const) {
      await call(
        a,
        'post',
        '/goals/' + foreign.id + '/' + path,
        foreign.revision,
      )
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .expect(404);
    }
    await call(a, 'patch', '/goals/' + own.id, own.revision)
      .send({ spaceId: b.spaceId })
      .expect(400);
    await call(a, 'patch', '/goals/' + own.id)
      .send({ title: 'missing revision' })
      .expect(400);
    await call(a, 'post', '/goals')
      .send({ title: 'missing key', horizon: 'SHORT_TERM' })
      .expect(400);
    await request(app.getHttpServer()).get('/api/v1/goals').expect(401);
  });

  it('paginates immutable reviews and binds cursors to Goal and kind', async () => {
    let g = await create();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = c.GoalReviewMutationSchema.parse(
        (
          await call(a, 'post', '/goals/' + g.id + '/progress', g.revision)
            .set('Idempotency-Key', randomUUID())
            .send({})
            .expect(201)
        ).body,
      );
      ids.push(r.id);
      g = await get(g.id);
    }
    const first = c.GoalReviewPageSchema.parse(
      (
        await call(a, 'get', '/goals/' + g.id + '/reviews')
          .query({ limit: '1', kind: 'SNAPSHOT' })
          .expect(200)
      ).body,
    );
    const second = c.GoalReviewPageSchema.parse(
      (
        await call(a, 'get', '/goals/' + g.id + '/reviews')
          .query({ limit: '1', kind: 'SNAPSHOT', cursor: first.nextCursor })
          .expect(200)
      ).body,
    );
    expect(first.items[0]?.id).toBe(ids[0]);
    expect(second.items[0]?.id).toBe(ids[1]);
    const other = await create();
    await call(a, 'get', '/goals/' + other.id + '/reviews')
      .query({ cursor: first.nextCursor, kind: 'SNAPSHOT' })
      .expect(400);
    await call(a, 'get', '/goals/' + g.id + '/reviews')
      .query({ cursor: first.nextCursor, kind: 'REVIEW' })
      .expect(400);
  });
  it('serializes source completion against snapshot capture coherently', async () => {
    let g = await create({ progressMode: 'WEIGHTED' });
    const t = await task();
    g = (
      await nested(g, 'links/tasks', {
        taskId: t.id,
        sourceRevision: t.revision,
        contributes: true,
      })
    ).goal;
    const [completion, snapshot] = await Promise.all([
      call(a, 'post', '/tasks/' + t.id + '/complete', t.revision).send({}),
      call(a, 'post', '/goals/' + g.id + '/progress', g.revision)
        .set('Idempotency-Key', randomUUID())
        .send({}),
    ]);
    expect(completion.status).toBe(200);
    expect(snapshot.status).toBe(201);
    const captured = c.GoalReviewMutationSchema.parse(snapshot.body).snapshot;
    const source = captured.sources[0]!;
    expect(captured.percentage).toBe(
      source.revision === t.revision ? '0' : '100',
    );
    expect((await progress(g)).percentage).toBe('100');
  });
});
