import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { vi } from 'vitest';
import { ReminderTasks } from '../../src/modules/tasks/public/index.js';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as c from '@mehran/api-contracts';
import { testApplication } from '../support/application.js';
import { cleanupFixtureIdentities } from '../support/fixture-cleanup.js';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { IdentityMailService } from '../../src/platform/auth/mail.service.js';
import { RewardsPort } from '../../src/modules/rewards/public/index.js';
type Actor = { id: string; spaceId: string; cookie: string };
describe('P1-11 owner-scoped analytics and optional durable rewards', () => {
  let app: NestExpressApplication,
    db: DatabaseService,
    rewards: RewardsPort,
    a: Actor,
    b: Actor;
  const ids: string[] = [],
    origin = 'http://localhost:3000',
    databaseUrl = isolatedTestDatabaseUrl(process.env);
  const call = (
    actor: Actor,
    method: 'get' | 'post' | 'patch' | 'put',
    path: string,
    revision?: number,
    key = randomUUID(),
  ) => {
    const r = request(app.getHttpServer())
      [method]('/api/v1' + path)
      .set('Cookie', actor.cookie)
      .set('Origin', origin);
    if (method !== 'get') r.set('Idempotency-Key', key);
    if (revision !== undefined) r.set('If-Match', '"' + revision + '"');
    return r;
  };
  async function identity() {
    const email = 'p111-' + randomUUID() + '@example.test',
      password = 'test-only-analytics-password-123!';
    const s = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'Analytics fixture' })
      .expect(200);
    ids.push(s.body.user.id as string);
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
    const space = await db.client.space.findFirstOrThrow({
      where: { ownerUserId: s.body.user.id as string },
    });
    return {
      id: s.body.user.id as string,
      spaceId: space.id,
      cookie: (login.headers['set-cookie'] as unknown as string[])
        .map((v) => v.split(';')[0])
        .join('; '),
    };
  }
  const query = '?from=2024-03-09&to=2024-03-12&timezone=America%2FNew_York';
  const metric = (result: c.InsightMetric[], id: string) =>
    result.find((m) => m.id === id)!;
  async function insight(family = 'tasks', actor = a, tail = '') {
    return c.InsightResponseSchema.parse(
      (
        await call(actor, 'get', '/insights/' + family + query + tail).expect(
          200,
        )
      ).body,
    );
  }
  async function task(actor = a, body: object = {}) {
    return (
      await call(actor, 'post', '/tasks')
        .send({
          title: 'Private source title',
          dueAt: '2024-03-10T15:00:00Z',
          scheduledDate: '2024-03-10',
          ...body,
        })
        .expect(201)
    ).body as { id: string; revision: number };
  }
  async function complete(t: { id: string; revision: number }, actor = a) {
    return (
      await call(actor, 'post', '/tasks/' + t.id + '/complete', t.revision)
        .send({})
        .expect(200)
    ).body as { id: string; revision: number };
  }
  async function enable(actor = a, enabled = true) {
    const p = c.RewardPreferencesSchema.parse(
      (await call(actor, 'get', '/rewards/preferences').expect(200)).body,
    );
    return c.RewardPreferencesSchema.parse(
      (
        await call(actor, 'patch', '/rewards/preferences', p.revision)
          .send({ enabled, displayAchievements: true })
          .expect(200)
      ).body,
    );
  }
  async function settle() {
    for (let pass = 0; pass < 2000; pass++) {
      const count = await db.client.outboxEvent.count({
        where: {
          spaceId: { in: [a.spaceId, b.spaceId] },
          type: {
            in: [
              'task.completed',
              'habit.entry_recorded',
              'habit.entry_corrected',
            ],
          },
          rewardHandledAt: null,
        },
      });
      if (!count) return;
      await rewards.consume();
    }
    throw new Error('Owned reward events did not settle');
  }
  beforeAll(async () => {
    app = await testApplication({ databaseUrl });
    await app.init();
    db = app.get(DatabaseService);
    rewards = app.get(RewardsPort);
    a = await identity();
    b = await identity();
  });
  afterAll(async () => {
    try {
      if (db) await cleanupFixtureIdentities(databaseUrl, { ids });
    } finally {
      if (app) await app.close();
    }
  });
  it('returns honest empty metrics and independent owner scopes', async () => {
    const r = await insight();
    expect(metric(r.current.metrics, 'tasks.completion_rate')).toMatchObject({
      value: null,
      numerator: 0,
      denominator: 0,
      reason: 'NO_DENOMINATOR',
    });
    expect(r.explanations).toEqual([]);
    expect(r.freshness).toBe('CURRENT_SOURCE_STATE_CONSISTENT_SNAPSHOT');
  });
  it('requires authentication and rejects scope/private opt-in overposting', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/insights/tasks' + query)
      .expect(401);
    for (const extra of [
      '&includeMood=true',
      '&includeJournal=true',
      '&spaceId=' + b.spaceId,
    ])
      await call(a, 'get', '/insights/overview' + query + extra).expect(400);
  });
  it('computes explicit task cohorts and observes moved dates without a stale cache', async () => {
    const t = await task();
    const done = await complete(t);
    let r = await insight();
    expect(metric(r.current.metrics, 'tasks.completion_rate')).toMatchObject({
      numerator: 1,
      denominator: 1,
      value: '100.000000',
    });
    await call(a, 'patch', '/tasks/' + t.id, done.revision)
      .send({ dueAt: '2024-04-01T00:00:00Z' })
      .expect(200);
    r = await insight();
    expect(metric(r.current.metrics, 'tasks.completion_rate').denominator).toBe(
      0,
    );
    expect(
      metric(
        (await insight('tasks', a, '&cohort=SCHEDULED_DATE')).current.metrics,
        'tasks.completion_rate',
      ).denominator,
    ).toBe(1);
    expect(
      metric((await insight('tasks', b)).current.metrics, 'tasks.completed')
        .value,
    ).toBe('0');
  });
  it('counts historical completion once after reopen and recompletion', async () => {
    let t = await complete(await task(a, { dueAt: null, scheduledDate: null }));
    t = (
      await call(a, 'post', '/tasks/' + t.id + '/reopen', t.revision)
        .send({})
        .expect(200)
    ).body as typeof t;
    await complete(t);
    const today = new Date().toISOString().slice(0, 10),
      to = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
    const r = c.InsightResponseSchema.parse(
      (
        await call(
          a,
          'get',
          `/insights/tasks?from=${today}&to=${to}&timezone=UTC&cohort=COMPLETED_AT`,
        ).expect(200)
      ).body,
    );
    expect(metric(r.current.metrics, 'tasks.completed').value).toBe('2');
    expect(
      r.current.metrics.some((m) => m.id === 'tasks.completion_rate'),
    ).toBe(false);
  });
  it('handles timezone travel and weekly/monthly grouping without changing source dates', async () => {
    const before = await db.client.task.findMany({
      where: { spaceId: a.spaceId },
      select: { id: true, dueAt: true, scheduledDate: true },
    });
    const settings = (await call(a, 'get', '/me/settings').expect(200))
      .body as { revision: number };
    await call(a, 'patch', '/me/settings', settings.revision)
      .send({ timezone: 'Pacific/Auckland', firstDayOfWeek: 0 })
      .expect(200);
    const r = await insight('tasks', a, '&grouping=WEEK');
    expect(r.timezone).toBe('America/New_York');
    expect(r.firstDayOfWeek).toBe(0);
    expect(r.current.buckets).toHaveLength(2);
    expect(
      (await insight('tasks', a, '&grouping=MONTH')).current.buckets,
    ).toHaveLength(1);
    expect(
      await db.client.task.findMany({
        where: { spaceId: a.spaceId },
        select: { id: true, dueAt: true, scheduledDate: true },
      }),
    ).toEqual(before);
  });
  it('defaults rewards off and never awards events preceding opt-in', async () => {
    expect((await call(a, 'get', '/rewards/preferences')).body.enabled).toBe(
      false,
    );
    await settle();
    await enable();
    expect((await call(a, 'get', '/rewards/progress')).body.totalXp).toBe('0');
  });
  it('serializes stale/concurrent preference changes and replays the original receipt', async () => {
    const p = c.RewardPreferencesSchema.parse(
        (await call(a, 'get', '/rewards/preferences')).body,
      ),
      key = randomUUID(),
      body = { enabled: true, displayAchievements: false };
    const r = await call(a, 'patch', '/rewards/preferences', p.revision, key)
      .send(body)
      .expect(200);
    await call(a, 'patch', '/rewards/preferences', p.revision, key)
      .send(body)
      .expect(200)
      .then((x) => expect(x.body).toEqual(r.body));
    await call(a, 'patch', '/rewards/preferences', p.revision)
      .send({ enabled: false, displayAchievements: false })
      .expect(409);
    const revision = (r.body as c.RewardPreferences).revision;
    const results = await Promise.all([
      call(a, 'patch', '/rewards/preferences', revision).send({
        enabled: false,
        displayAchievements: true,
      }),
      call(a, 'patch', '/rewards/preferences', revision).send({
        enabled: true,
        displayAchievements: true,
      }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    await enable();
  });
  it('awards one positive Task source under concurrent consumers and duplicate completion requests', async () => {
    const t = await task(),
      key = randomUUID();
    const results = await Promise.all([
      call(a, 'post', '/tasks/' + t.id + '/complete', t.revision, key).send({}),
      call(a, 'post', '/tasks/' + t.id + '/complete', t.revision, key).send({}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    await Promise.all([settle(), settle()]);
    expect((await call(a, 'get', '/rewards/progress')).body.totalXp).toBe('10');
    const unlock = (await call(a, 'get', '/rewards/achievements')).body as {
      items: Array<{ code: string; unlockedAt: string | null }>;
    };
    expect(
      unlock.items.find((x) => x.code === 'FIRST_TASK')?.unlockedAt,
    ).not.toBeNull();
  });
  it('does not reward reopening/recompletion twice or subtract earned XP', async () => {
    let t = await complete(await task());
    await settle();
    const total = (await call(a, 'get', '/rewards/progress')).body.totalXp;
    t = (
      await call(a, 'post', '/tasks/' + t.id + '/reopen', t.revision)
        .send({})
        .expect(200)
    ).body as typeof t;
    await complete(t);
    await settle();
    expect((await call(a, 'get', '/rewards/progress')).body.totalXp).toBe(
      total,
    );
  });
  it('recalculates badges idempotently without changing XP or unlock timestamps', async () => {
    const p = await enable(),
      key = randomUUID(),
      before = (await call(a, 'get', '/rewards/achievements')).body,
      total = (await call(a, 'get', '/rewards/progress')).body.totalXp;
    const first = await call(
      a,
      'post',
      '/rewards/achievements/recalculate',
      p.revision,
      key,
    )
      .send({ limit: 1 })
      .expect(200);
    expect(first.body).toMatchObject({
      processed: 1,
      nextCursor: 'FIRST_TASK',
    });
    await call(a, 'post', '/rewards/achievements/recalculate', p.revision, key)
      .send({ limit: 1 })
      .expect(200)
      .then((x) => expect(x.body).toEqual(first.body));
    expect((await call(a, 'get', '/rewards/achievements')).body).toEqual(
      before,
    );
    expect((await call(a, 'get', '/rewards/progress')).body.totalXp).toBe(
      total,
    );
  });
  it('keeps reward progress and cursors private across users', async () => {
    const page = c.RewardProgressSchema.parse(
      (await call(a, 'get', '/rewards/progress?limit=1').expect(200)).body,
    );
    expect(page.nextCursor).not.toBeNull();
    await call(b, 'get', '/rewards/progress?cursor=' + page.nextCursor).expect(
      400,
    );
    expect((await call(b, 'get', '/rewards/progress')).body).toMatchObject({
      enabled: false,
      totalXp: '0',
      items: [],
    });
  });
  it('disables accrual while retaining earned history across re-enable', async () => {
    const total = (await call(a, 'get', '/rewards/progress')).body.totalXp;
    await enable(a, false);
    await complete(await task());
    await settle();
    expect((await call(a, 'get', '/rewards/progress')).body).toMatchObject({
      enabled: false,
      totalXp: '0',
      items: [],
    });
    expect((await call(a, 'get', '/rewards/achievements')).body.items).toEqual(
      [],
    );
    await enable();
    await settle();
    expect((await call(a, 'get', '/rewards/progress')).body.totalXp).toBe(
      total,
    );
  });
  it('reuses canonical Habit due-day outcomes and awards one achieved quantity date', async () => {
    const h = (
      await call(a, 'post', '/habits')
        .send({
          title: 'Private water',
          type: 'QUANTITY',
          unit: 'ML',
          purpose: 'WATER',
          target: '500',
          timezone: 'UTC',
          schedule: {
            version: 1,
            startDate: '2024-03-09',
            rule: { kind: 'DAILY' },
          },
        })
        .expect(201)
    ).body as { id: string; revision: number };
    for (const value of ['200', '300', '100'])
      await call(a, 'post', '/habits/' + h.id + '/entries')
        .send({
          habitRevision: h.revision,
          localDate: '2024-03-10',
          action: 'LOG',
          value,
        })
        .expect(201);
    const before = BigInt(
      (await call(a, 'get', '/rewards/progress')).body.totalXp as string,
    );
    await settle();
    expect(
      BigInt(
        (await call(a, 'get', '/rewards/progress')).body.totalXp as string,
      ),
    ).toBe(before + 5n);
    const r = await insight('habits');
    expect(metric(r.current.metrics, 'habits.consistency')).toMatchObject({
      numerator: 1,
      denominator: 3,
      value: '33.333333',
    });
    expect(
      metric((await insight('habits', b)).current.metrics, 'habits.completed')
        .value,
    ).toBe('0');
  });
  it('excludes rest/skip dates from consistency and preserves missed-day evidence', async () => {
    const h = (
      await call(a, 'post', '/habits')
        .send({
          title: 'Neutral days',
          type: 'CHECKBOX',
          unit: 'COUNT',
          target: '1',
          timezone: 'UTC',
          schedule: {
            version: 1,
            startDate: '2024-03-09',
            rule: { kind: 'WEEKLY' },
          },
        })
        .expect(201)
    ).body as { id: string; revision: number };
    await call(a, 'post', '/habits/' + h.id + '/entries')
      .send({
        habitRevision: h.revision,
        localDate: '2024-03-09',
        action: 'SKIP',
      })
      .expect(201);
    const r = await insight('habits');
    expect(metric(r.current.metrics, 'habits.skipped').value).toBe('1');
    expect(metric(r.current.metrics, 'habits.consistency').denominator).toBe(3);
  });
  it('does not mix Finance, Journal or Mood into ordinary overview', async () => {
    const r = await insight('overview');
    expect(
      r.current.metrics.some((m) => m.sourceType === 'TRANSACTION_POSTING'),
    ).toBe(false);
    expect(JSON.stringify(r)).not.toContain('Private source title');
    expect((await insight('finance')).current.metrics).toEqual([]);
  });
  it('rejects broad/dense request abuse and unknown reward fields', async () => {
    await call(
      a,
      'get',
      '/insights/tasks?from=2020-01-01&to=2026-01-01',
    ).expect(400);
    const p = c.RewardPreferencesSchema.parse(
      (await call(a, 'get', '/rewards/preferences')).body,
    );
    await call(a, 'patch', '/rewards/preferences', p.revision)
      .send({ enabled: true, displayAchievements: true, points: 500 })
      .expect(400);
  });
  it('keeps exact currency groups, fees and retrospective reversals out of transfer principal', async () => {
    const account = async (currency: string) =>
      c.FinanceAccountSchema.parse(
        (
          await call(a, 'post', '/finance/accounts')
            .send({ name: 'Private account', currency })
            .expect(201)
        ).body,
      );
    const usd = await account('USD'),
      other = await account('USD'),
      eur = await account('EUR');
    const expense = async (accountId: string, amount: string) =>
      c.FinanceTransactionSchema.parse(
        (
          await call(a, 'post', '/finance/transactions')
            .send({
              type: 'EXPENSE',
              accountId,
              amount,
              occurredAt: '2024-03-10T12:00:00Z',
              timezone: 'UTC',
            })
            .expect(201)
        ).body,
      );
    const original = await expense(usd.id, '0.30');
    await expense(eur.id, '2.25');
    await call(a, 'post', '/finance/transfers')
      .send({
        type: 'TRANSFER',
        sourceAccountId: usd.id,
        destinationAccountId: other.id,
        sourceAmount: '10.00',
        destinationAmount: '10.00',
        fee: { amount: '0.05' },
        occurredAt: '2024-03-10T12:00:00Z',
        timezone: 'UTC',
      })
      .expect(201);
    let r = await insight('finance');
    const money = (id: string, currency: string) =>
      r.current.metrics.find((m) => m.id === id && m.currency === currency)!
        .value;
    expect(money('finance.expense', 'USD')).toBe('0.35');
    expect(money('finance.expense', 'EUR')).toBe('2.25');
    await call(
      a,
      'post',
      '/finance/transactions/' + original.id + '/reverse',
      original.revision,
    )
      .send({})
      .expect(200);
    r = await insight('finance');
    expect(money('finance.expense', 'USD')).toBe('0.05');
    expect(
      (await insight('overview')).current.metrics.some(
        (m) => m.currency !== null,
      ),
    ).toBe(false);
    expect(
      (
        await insight('overview', a, '&includeFinance=true')
      ).current.metrics.some((m) => m.currency === 'EUR'),
    ).toBe(true);
    expect((await insight('finance', b)).current.metrics).toEqual([]);
    expect(JSON.stringify(r)).not.toContain('Private account');
  });
  it('clips work across DST gaps/folds and unions overlaps without counting sessions twice', async () => {
    const manual = async (startAt: string, endAt: string) =>
      call(a, 'post', '/time-entries')
        .send({ startAt, endAt, timezone: 'America/New_York' })
        .expect(201);
    await manual('2024-03-10T06:30:00Z', '2024-03-10T07:30:00Z');
    await manual('2024-03-10T07:00:00Z', '2024-03-10T08:00:00Z');
    const r = await insight('time');
    expect(metric(r.current.metrics, 'time.recorded_ms').value).toBe('7200000');
    expect(metric(r.current.metrics, 'time.distinct_work_ms').value).toBe(
      '5400000',
    );
    expect(metric(r.current.metrics, 'time.overlap_ms').value).toBe('1800000');
    await manual('2024-11-03T05:30:00Z', '2024-11-03T06:30:00Z');
    const fold = c.InsightResponseSchema.parse(
      (
        await call(
          a,
          'get',
          '/insights/time?from=2024-11-03&to=2024-11-04&timezone=America%2FNew_York',
        ).expect(200)
      ).body,
    );
    expect(metric(fold.current.metrics, 'time.distinct_work_ms').value).toBe(
      '3600000',
    );
    expect(
      metric(
        (await insight('time', b)).current.metrics,
        'time.distinct_work_ms',
      ).value,
    ).toBe('0');
  });
  it('keeps current Goal progress distinct from immutable historical observations', async () => {
    let g = c.GoalSchema.parse(
      (
        await call(a, 'post', '/goals')
          .send({
            title: 'Private goal',
            horizon: 'SHORT_TERM',
            progressMode: 'MANUAL',
            manualProgress: '25',
          })
          .expect(201)
      ).body,
    );
    const historical = await insight('goals');
    expect(
      historical.current.metrics.find(
        (m) => m.id === 'goals.observed_progress' && m.sourceId === g.id,
      ),
    ).toMatchObject({ value: null, reason: 'NO_OBSERVATION' });
    const snapshot = await call(
      a,
      'post',
      '/goals/' + g.id + '/progress',
      g.revision,
    )
      .send({})
      .expect(201);
    g = c.GoalSchema.parse(
      (await call(a, 'get', '/goals/' + g.id).expect(200)).body,
    );
    await call(a, 'patch', '/goals/' + g.id, g.revision)
      .send({ manualProgress: '75' })
      .expect(200);
    const today = new Date().toISOString().slice(0, 10),
      to = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
    const r = c.InsightResponseSchema.parse(
      (
        await call(
          a,
          'get',
          `/insights/goals?from=${today}&to=${to}&timezone=UTC`,
        ).expect(200)
      ).body,
    );
    expect(
      r.current.metrics.find(
        (m) => m.id === 'goals.current_progress' && m.sourceId === g.id,
      )?.value,
    ).toBe('75');
    expect(
      r.current.metrics.find(
        (m) => m.id === 'goals.observed_progress' && m.sourceId === g.id,
      )?.value,
    ).toBe('25');
    expect(snapshot.body.snapshot.percentage).toBe('25');
    expect(
      (await insight('goals', b)).current.metrics.some(
        (m) => m.sourceId === g.id,
      ),
    ).toBe(false);
  });
  it('distinguishes repeated daily selections from distinct Tasks and planned minutes', async () => {
    const t = await task(a, { dueAt: null });
    for (const date of ['2024-03-09', '2024-03-10']) {
      const day = c.DailyPlanSchema.parse(
        (
          await call(a, 'post', '/planning/days/' + date)
            .send({})
            .expect(201)
        ).body,
      );
      await call(
        a,
        'put',
        '/planning/days/' + date + '/items/' + t.id,
        day.revision,
      )
        .send({ taskRevision: t.revision, plannedMinutes: 30 })
        .expect(200);
    }
    await complete(t);
    const r = await insight('tasks');
    expect(metric(r.current.metrics, 'planning.selections').value).toBe('2');
    expect(metric(r.current.metrics, 'planning.distinct_tasks').value).toBe(
      '1',
    );
    expect(metric(r.current.metrics, 'planning.planned_minutes').value).toBe(
      '60',
    );
    expect(metric(r.current.metrics, 'planning.completion_rate').value).toBe(
      '100.000000',
    );
  });
  it('retries failed reward effects without rolling back the completed source', async () => {
    await settle();
    const total = (await call(a, 'get', '/rewards/progress')).body
      .totalXp as string;
    const t = await complete(await task());
    const event = await db.client.outboxEvent.findFirstOrThrow({
      where: { spaceId: a.spaceId, aggregateId: t.id, type: 'task.completed' },
    });
    const failure = vi
      .spyOn(app.get(ReminderTasks), 'read')
      .mockRejectedValueOnce(new Error('private-failure-not-for-storage'));
    try {
      await rewards.consume();
    } finally {
      failure.mockRestore();
    }
    const retried = await db.client.outboxEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(retried.rewardAttempts).toBe(1);
    expect(retried.rewardHandledAt).toBeNull();
    expect(retried.rewardFailureCode).toBe('REWARD_RECONCILIATION_FAILED');
    expect((await call(a, 'get', '/tasks/' + t.id)).body.status).toBe('DONE');
    expect((await call(a, 'get', '/rewards/progress')).body.totalXp).toBe(
      total,
    );
    await db.client.outboxEvent.update({
      where: { id: event.id },
      data: { rewardRetryAt: new Date(0) },
    });
    await settle();
    expect((await call(a, 'get', '/rewards/progress')).body.totalXp).toBe(
      String(BigInt(total) + 10n),
    );
  });
  it('denies cross-space event source references and database ledger forgeries', async () => {
    await settle();
    const foreign = await task(b),
      total = (await call(a, 'get', '/rewards/progress')).body.totalXp;
    const event = await db.client.outboxEvent.create({
      data: {
        spaceId: a.spaceId,
        aggregateId: foreign.id,
        type: 'task.completed',
        version: 1,
        payload: {},
        correlationId: randomUUID(),
      },
    });
    await settle();
    expect((await call(a, 'get', '/rewards/progress')).body.totalXp).toBe(
      total,
    );
    await expect(
      db.client.xpLedger.create({
        data: {
          spaceId: b.spaceId,
          sourceEventId: event.id,
          rewardKey: 'task:' + foreign.id,
          kind: 'TASK',
          points: 10,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.xpLedger.create({
        data: {
          spaceId: a.spaceId,
          sourceEventId: event.id,
          rewardKey: 'task:' + foreign.id,
          kind: 'TASK',
          points: -1,
        },
      }),
    ).rejects.toThrow();
  });
  it('recomputes corrected Habit metrics without subtracting earned XP', async () => {
    const h = c.HabitSchema.parse(
      (
        await call(a, 'post', '/habits')
          .send({
            title: 'Historical correction',
            type: 'CHECKBOX',
            unit: 'COUNT',
            target: '1',
            timezone: 'UTC',
            schedule: {
              version: 1,
              startDate: '2024-03-09',
              rule: { kind: 'DAILY' },
            },
          })
          .expect(201)
      ).body,
    );
    const entry = c.HabitEntrySchema.parse(
      (
        await call(a, 'post', '/habits/' + h.id + '/entries')
          .send({
            habitRevision: h.revision,
            localDate: '2024-03-10',
            action: 'LOG',
          })
          .expect(201)
      ).body,
    );
    await settle();
    const before = (await insight('habits')).current.metrics,
      total = (await call(a, 'get', '/rewards/progress')).body.totalXp;
    await call(
      a,
      'patch',
      '/habits/' + h.id + '/entries/' + entry.id,
      entry.revision,
    )
      .send({ habitRevision: h.revision, value: '0' })
      .expect(200);
    await settle();
    expect(
      Number(
        metric((await insight('habits')).current.metrics, 'habits.completed')
          .value,
      ),
    ).toBe(Number(metric(before, 'habits.completed').value) - 1);
    expect((await call(a, 'get', '/rewards/progress')).body.totalXp).toBe(
      total,
    );
    const versions = await db.client.habitEntry.findMany({
      where: { spaceId: a.spaceId, habitId: h.id },
      orderBy: { revision: 'asc' },
      select: { sourceEventId: true, value: true },
    });
    expect(versions).toHaveLength(2);
    expect(versions.every((v) => v.sourceEventId !== null)).toBe(true);
    expect(versions[0]!.value?.toString()).toBe('1');
  });
  it('unlocks only the three approved participation badges at exact ledger thresholds', async () => {
    await settle();
    let count = await db.client.xpLedger.count({
      where: { spaceId: a.spaceId, kind: 'TASK' },
    });
    for (; count < 10; count++) await complete(await task());
    const h = c.HabitSchema.parse(
      (
        await call(a, 'post', '/habits')
          .send({
            title: 'Participation dates',
            type: 'CHECKBOX',
            unit: 'COUNT',
            target: '1',
            timezone: 'UTC',
            schedule: {
              version: 1,
              startDate: '2024-03-01',
              rule: { kind: 'DAILY' },
            },
          })
          .expect(201)
      ).body,
    );
    for (let day = 1; day <= 7; day++)
      await call(a, 'post', '/habits/' + h.id + '/entries')
        .send({
          habitRevision: h.revision,
          localDate: '2024-03-0' + day,
          action: 'LOG',
        })
        .expect(201);
    await settle();
    const badges = c.AchievementsSchema.parse(
      (await call(a, 'get', '/rewards/achievements')).body,
    );
    expect(badges.items.map((x) => x.code).sort()).toEqual([
      'FIRST_TASK',
      'SEVEN_HABIT_DAYS',
      'TEN_TASKS',
    ]);
    expect(badges.items.every((x) => x.unlockedAt !== null)).toBe(true);
  });
  it('rejects excessive density and computes a full ten-thousand-Task cohort without truncation', async () => {
    const fixtureIds = Array.from({ length: 10001 }, () => randomUUID());
    // Administrative fixture writes use a separate guarded connection. HTTP assertions
    // keep the unchanged 300ms API query limit and the unchanged 15s test deadline.
    const admin = new Pool({
      connectionString: databaseUrl,
      max: 1,
      statement_timeout: 5000,
      query_timeout: 5500,
    });
    try {
      await admin.query('BEGIN');
      for (let at = 0; at < fixtureIds.length; at += 200) {
        const batch = fixtureIds.slice(at, at + 200);
        await admin.query(
          'INSERT INTO "Task" (id,"spaceId","createdByUserId",title,"dueAt","updatedAt") SELECT id,$1::uuid,$2::uuid,\'Density fixture\',\'2000-01-01T12:00:00Z\'::timestamptz,now() FROM unnest($3::uuid[]) ids(id)',
          [b.spaceId, b.id, batch],
        );
      }
      await admin.query('COMMIT');
      // Bulk fixture loading bypasses normal autovacuum timing. Refresh statistics
      // before measuring reads and exercising FK-safe fixture deletion.
      await admin.query('ANALYZE "Task"');
      const path = '/insights/tasks?from=2000-01-01&to=2000-01-02&timezone=UTC';
      await call(b, 'get', path).expect(400);

      await db.client.task.delete({ where: { id: fixtureIds.at(-1)! } });
      const result = c.InsightResponseSchema.parse(
        (await call(b, 'get', path).expect(200)).body,
      );
      expect(
        metric(result.current.metrics, 'tasks.completion_rate'),
      ).toMatchObject({ numerator: 0, denominator: 10000, value: '0.000000' });
    } finally {
      try {
        await admin.query('BEGIN');
        for (let at = 0; at < fixtureIds.length; at += 100)
          await admin.query('DELETE FROM "Task" WHERE id=ANY($1::uuid[])', [
            fixtureIds.slice(at, at + 100),
          ]);
        await admin.query('COMMIT');
      } finally {
        await admin.end();
      }
    }
  });
  it('attributes summer midnight consistently for IANA timezone aliases', async () => {
    const t = await task(a, {
      dueAt: '2024-07-01T22:30:00Z',
      scheduledDate: null,
    });
    const response = c.InsightResponseSchema.parse(
      (
        await call(
          a,
          'get',
          '/insights/tasks?from=2024-07-02&to=2024-07-03&timezone=CET',
        ).expect(200)
      ).body,
    );
    expect(
      metric(response.current.metrics, 'tasks.completion_rate').denominator,
    ).toBe(1);
    expect((await call(a, 'get', '/tasks/' + t.id)).body.dueAt).toBe(
      '2024-07-01T22:30:00.000Z',
    );
  });
});
