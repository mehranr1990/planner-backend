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

import * as outbox from '../../src/platform/outbox/outbox.js';
type Actor = { id: string; spaceId: string; cookie: string };
describe('P1-09 private exact finance ledger', () => {
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
    const email = `p109-${randomUUID()}@example.test`,
      password = 'test-only-habits-password-123!';
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email, password, name: 'Finance fixture' })
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
    await app.listen(0, '127.0.0.1');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    if (db) await cleanupFixtureIdentities(databaseUrl, { ids: users });
    await app?.close();
  });

  const post = (
    route: string,
    body: object,
    actor = a,
    revision?: number,
    key = randomUUID(),
  ) =>
    call(actor, 'post', route, revision).set('Idempotency-Key', key).send(body);
  const account = async (currency = 'USD', opening?: string, actor = a) =>
    c.FinanceAccountSchema.parse(
      (
        await post(
          '/finance/accounts',
          {
            name: 'Private cash ' + randomUUID(),
            currency,
            ...(opening
              ? {
                  opening: {
                    amount: opening,
                    direction: 'IN',
                    occurredAt: '2024-01-01T12:00:00Z',
                    timezone: 'UTC',
                  },
                }
              : {}),
          },
          actor,
        ).expect(201)
      ).body,
    );
  const category = async (kind: 'INCOME' | 'EXPENSE' = 'EXPENSE', actor = a) =>
    c.FinanceCategorySchema.parse(
      (
        await post(
          '/finance/categories',
          { name: 'Private category ' + randomUUID(), kind },
          actor,
        ).expect(201)
      ).body,
    );
  const transaction = async (
    accountId: string,
    amount = '1.00',
    extra: Record<string, unknown> = {},
    actor = a,
  ) =>
    c.FinanceTransactionSchema.parse(
      (
        await post(
          '/finance/transactions',
          {
            type: 'EXPENSE',
            accountId,
            amount,
            occurredAt: '2024-03-10T12:00:00Z',
            timezone: 'UTC',
            ...extra,
          },
          actor,
        ).expect(201)
      ).body,
    );
  const balance = async (id: string) =>
    c.FinanceAccountSchema.parse(
      (await call(a, 'get', '/finance/accounts/' + id).expect(200)).body,
    ).balance;
  const budget = async (extra: Record<string, unknown> = {}) =>
    c.FinanceBudgetSchema.parse(
      (
        await post('/finance/budgets', {
          name: 'Budget',
          currency: 'USD',
          limit: '10.00',
          period: 'MONTHLY',
          timezone: 'America/New_York',
          ...extra,
        }).expect(201)
      ).body,
    );
  const period = async (b: c.FinanceBudget, date = '2024-03-10') =>
    c.FinancePeriodSchema.parse(
      (
        await post(
          '/finance/budgets/' + b.id + '/periods',
          { date },
          a,
          b.revision,
        ).expect(201)
      ).body,
    );
  const bill = async (accountId: string, extra: Record<string, unknown> = {}) =>
    c.FinanceBillSchema.parse(
      (
        await post('/finance/bills', {
          name: 'Bill',
          accountId,
          amount: '5.00',
          dueDate: '2024-01-31',
          timezone: 'UTC',
          ...extra,
        }).expect(201)
      ).body,
    );
  const reverse = async (t: c.FinanceTransaction, key = randomUUID()) =>
    c.FinanceTransactionSchema.parse(
      (
        await post(
          '/finance/transactions/' + t.id + '/reverse',
          {},
          a,
          t.revision,
          key,
        ).expect(200)
      ).body,
    );

  it('creates an opening posting and adds cents beyond JS safe integer precision', async () => {
    const x = await account('USD', '999999999999999999.99');
    await transaction(x.id, '0.01', { type: 'INCOME' });
    expect(await balance(x.id)).toBe('1000000000000000000.00');
    const rows = await db.client.transactionPosting.findMany({
      where: { accountId: x.id },
    });
    expect(rows.map((p) => p.role).sort()).toEqual(['ADJUSTMENT', 'INCOME']);
  });
  it('uses exact ISO zero, two, three and four minor units', async () => {
    for (const [currency, v, expected] of [
      ['JPY', '1', '-1'],
      ['IRR', '1.01', '-1.01'],
      ['KWD', '1.001', '-1.001'],
      ['CLF', '1.0001', '-1.0001'],
    ]) {
      const x = await account(currency);
      await transaction(x.id, v);
      expect(await balance(x.id)).toBe(expected);
      await post('/finance/transactions', {
        type: 'EXPENSE',
        accountId: x.id,
        amount: currency === 'JPY' ? '1.1' : v + '1',
        timezone: 'UTC',
        occurredAt: '2024-01-01T00:00:00Z',
      }).expect(400);
    }
  });
  it('allows manual negative balances but never arbitrary balance/currency mutation', async () => {
    const x = await account();
    await transaction(x.id, '12.34');
    expect(await balance(x.id)).toBe('-12.34');
    for (const input of [
      { balance: '100' },
      { currency: 'EUR' },
      { spaceId: b.spaceId },
    ])
      await call(a, 'patch', '/finance/accounts/' + x.id, x.revision)
        .send(input)
        .expect(400);
  });
  it('archives and restores accounts while preserving history and allowing reversal', async () => {
    const x = await account(),
      t = await transaction(x.id);
    const archived = c.FinanceAccountSchema.parse(
      (
        await call(a, 'delete', '/finance/accounts/' + x.id, x.revision).expect(
          200,
        )
      ).body,
    );
    await post('/finance/transactions', {
      type: 'INCOME',
      accountId: x.id,
      amount: '1.00',
    }).expect(409);
    await reverse(t);
    expect(await balance(x.id)).toBe('0.00');
    await call(a, 'patch', '/finance/accounts/' + x.id, archived.revision)
      .send({ archived: false })
      .expect(200);
  });
  it('enforces category kind, archive, order and retained historical reference', async () => {
    const x = await account(),
      cat = await category(),
      wrong = await category('INCOME');
    await post('/finance/transactions', {
      type: 'EXPENSE',
      accountId: x.id,
      amount: '1',
      categoryId: wrong.id,
    }).expect(400);
    const t = await transaction(x.id, '1', { categoryId: cat.id });
    const archived = c.FinanceCategorySchema.parse(
      (
        await call(a, 'patch', '/finance/categories/' + cat.id, cat.revision)
          .send({ archived: true, position: 3 })
          .expect(200)
      ).body,
    );
    expect(archived.position).toBe(3);
    await post('/finance/transactions', {
      type: 'EXPENSE',
      accountId: x.id,
      amount: '1',
      categoryId: cat.id,
    }).expect(400);
    expect(
      c.FinanceTransactionSchema.parse(
        (await call(a, 'get', '/finance/transactions/' + t.id).expect(200))
          .body,
      ).postings[0]?.categoryId,
    ).toBe(cat.id);
  });
  it('atomically transfers equal currency legs, adds explicit fee and replays once', async () => {
    const x = await account('USD', '100'),
      y = await account(),
      cat = await category(),
      k = randomUUID(),
      input = {
        type: 'TRANSFER',
        sourceAccountId: x.id,
        destinationAccountId: y.id,
        sourceAmount: '10.00',
        destinationAmount: '10',
        fee: { amount: '0.25', categoryId: cat.id },
        occurredAt: '2024-03-10T12:00:00Z',
        timezone: 'UTC',
      };
    const [one, two] = await Promise.all([
      post('/finance/transfers', input, a, undefined, k),
      post('/finance/transfers', input, a, undefined, k),
    ]);
    expect([one.status, two.status]).toEqual([201, 201]);
    expect(one.body).toEqual(two.body);
    const t = c.FinanceTransactionSchema.parse(one.body);
    expect(t.postings.map((p) => p.amount).sort()).toEqual([
      '-0.25',
      '-10.00',
      '10.00',
    ]);
    expect(await balance(x.id)).toBe('89.75');
    expect(await balance(y.id)).toBe('10.00');
    await post(
      '/finance/transfers',
      { ...input, sourceAmount: '11' },
      a,
      undefined,
      k,
    ).expect(409);
    await reverse(t);
    expect(await balance(x.id)).toBe('100.00');
    expect(await balance(y.id)).toBe('0.00');
  });
  it('validates same-currency transfer equality and distinct accounts', async () => {
    const x = await account(),
      y = await account();
    const input = {
      type: 'TRANSFER',
      sourceAccountId: x.id,
      destinationAccountId: y.id,
      sourceAmount: '1',
      destinationAmount: '2',
    };
    await post('/finance/transfers', input).expect(400);
    await post('/finance/transfers', {
      ...input,
      destinationAccountId: x.id,
    }).expect(400);
    await post('/finance/transfers', {
      ...input,
      destinationAmount: '1',
      rate: '1',
      conversionDate: '2024-01-01',
    }).expect(400);
    expect(await balance(x.id)).toBe('0.00');
  });
  it('records exact cross-currency HALF_UP rate and fee without an implicit grand total', async () => {
    const x = await account('USD', '100'),
      y = await account('JPY'),
      input = {
        type: 'TRANSFER',
        sourceAccountId: x.id,
        destinationAccountId: y.id,
        sourceAmount: '10.01',
        destinationAmount: '1507',
        rate: '150.5',
        conversionDate: '2024-03-10',
        occurredAt: '2024-03-10T12:00:00Z',
        timezone: 'UTC',
        fee: { amount: '0.02' },
      };
    const t = c.FinanceTransactionSchema.parse(
      (await post('/finance/transfers', input).expect(201)).body,
    );
    expect(t.exchangeRate?.rate).toBe('150.500000000000');
    expect(t.exchangeRate?.rounding).toBe('HALF_UP');
    expect(await balance(x.id)).toBe('89.97');
    expect(await balance(y.id)).toBe('1507');
    await post('/finance/transfers', { ...input, rate: undefined }).expect(400);
    await post('/finance/transfers', {
      ...input,
      destinationAmount: '1506',
    }).expect(400);
    await post('/finance/transfers', {
      ...input,
      conversionDate: '2099-01-01',
    }).expect(400);
  });
  it('rejects sub-minor-unit FX that rounds to zero', async () => {
    const x = await account(),
      y = await account('JPY');
    await post('/finance/transfers', {
      type: 'TRANSFER',
      sourceAccountId: x.id,
      destinationAccountId: y.id,
      sourceAmount: '0.01',
      destinationAmount: '1',
      rate: '0.01',
      conversionDate: '2024-01-01',
      occurredAt: '2024-01-01T12:00:00Z',
    }).expect(400);
  });
  it('serializes concurrent ordinary writes without lost balance updates', async () => {
    const x = await account();
    await Promise.all(
      Array.from({ length: 12 }, () =>
        transaction(x.id, '0.01', { type: 'INCOME' }),
      ),
    );
    expect(await balance(x.id)).toBe('0.12');
  });
  it('permits only one concurrent reversal, retains old postings and replays receipt', async () => {
    const x = await account(),
      t = await transaction(x.id, '3.45'),
      before = await db.client.transactionPosting.findMany({
        where: { transactionId: t.id },
      }),
      k = randomUUID();
    const results = await Promise.all([
      post('/finance/transactions/' + t.id + '/reverse', {}, a, t.revision, k),
      post('/finance/transactions/' + t.id + '/reverse', {}, a, t.revision),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const success = results.find((r) => r.status === 200)!;
    if (results[0]!.status === 200)
      expect(
        (
          await post(
            '/finance/transactions/' + t.id + '/reverse',
            {},
            a,
            t.revision,
            k,
          ).expect(200)
        ).body,
      ).toEqual(success.body);
    expect(await balance(x.id)).toBe('0.00');
    expect(
      await db.client.transactionPosting.findMany({
        where: { transactionId: t.id },
      }),
    ).toEqual(before);
    const h = c.FinanceTransactionPageSchema.parse(
      (
        await call(
          a,
          'get',
          '/finance/transactions/' + t.id + '/history',
        ).expect(200)
      ).body,
    );
    expect(h.items.length).toBe(2);
    expect(h.items.some((v) => v.effect === 'REVERSAL')).toBe(true);
  });
  it('corrects by atomic reversal/replacement and rejects stale repeated correction', async () => {
    const x = await account(),
      t = await transaction(x.id, '10.00');
    const replacement = {
        type: 'EXPENSE',
        accountId: x.id,
        amount: '7.25',
        occurredAt: '2024-03-11T12:00:00Z',
        timezone: 'UTC',
      },
      v = c.FinanceTransactionSchema.parse(
        (
          await post(
            '/finance/transactions/' + t.id + '/correct',
            { replacement },
            a,
            t.revision,
          ).expect(200)
        ).body,
      );
    expect(v.replacesId).toBe(t.id);
    expect(await balance(x.id)).toBe('-7.25');
    const h = c.FinanceTransactionPageSchema.parse(
      (
        await call(
          a,
          'get',
          '/finance/transactions/' + v.id + '/history',
        ).expect(200)
      ).body,
    );
    expect(h.items.length).toBe(3);
    await post(
      '/finance/transactions/' + t.id + '/correct',
      { replacement },
      a,
      t.revision,
    ).expect(409);
  });
  it('rolls back reversal if replacement authorization fails', async () => {
    const x = await account(),
      foreign = await account('USD', undefined, b),
      t = await transaction(x.id, '5');
    await post(
      '/finance/transactions/' + t.id + '/correct',
      { replacement: { type: 'EXPENSE', accountId: foreign.id, amount: '2' } },
      a,
      t.revision,
    ).expect(404);
    expect(await balance(x.id)).toBe('-5.00');
    expect(
      c.FinanceTransactionSchema.parse(
        (await call(a, 'get', '/finance/transactions/' + t.id).expect(200))
          .body,
      ).state,
    ).toBe('POSTED');
    expect(
      await db.client.transaction.count({ where: { originalId: t.id } }),
    ).toBe(0);
  });
  it('bounds and scopes transaction history cursors', async () => {
    const x = await account(),
      t = await transaction(x.id);
    await reverse(t);
    const first = c.FinanceTransactionPageSchema.parse(
      (
        await call(a, 'get', '/finance/transactions/' + t.id + '/history')
          .query({ limit: '1' })
          .expect(200)
      ).body,
    );
    expect(first.nextCursor).not.toBeNull();
    const second = c.FinanceTransactionPageSchema.parse(
      (
        await call(a, 'get', '/finance/transactions/' + t.id + '/history')
          .query({ limit: '1', cursor: first.nextCursor })
          .expect(200)
      ).body,
    );
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    await call(b, 'get', '/finance/transactions/' + t.id + '/history')
      .query({ cursor: first.nextCursor })
      .expect(404);
  });
  it('preserves transaction date/zone after account travel and rejects inconsistent dates/future actuals', async () => {
    const x = await account(),
      t = await transaction(x.id, '1', {
        occurredAt: '2024-01-01T00:15:00Z',
        timezone: 'America/Los_Angeles',
        localDate: '2023-12-31',
      });
    const prefs = await db.client.userSettings.findUniqueOrThrow({
      where: { userId: a.id },
    });
    await db.client.userSettings.update({
      where: { userId: a.id },
      data: { timezone: 'Asia/Tehran' },
    });
    expect(
      c.FinanceTransactionSchema.parse(
        (await call(a, 'get', '/finance/transactions/' + t.id).expect(200))
          .body,
      ).localDate,
    ).toBe('2023-12-31');
    await post('/finance/transactions', {
      type: 'EXPENSE',
      accountId: x.id,
      amount: '1',
      occurredAt: '2024-01-01T00:15:00Z',
      timezone: 'America/Los_Angeles',
      localDate: '2024-01-01',
    }).expect(400);
    await post('/finance/transactions', {
      type: 'EXPENSE',
      accountId: x.id,
      amount: '1',
      occurredAt: '2099-01-01T00:00:00Z',
    }).expect(400);
    await db.client.userSettings.update({
      where: { userId: a.id },
      data: { timezone: prefs.timezone },
    });
  });
  it('saves Gregorian budget periods and reports advisory overspend without blocking', async () => {
    const cat = await category(),
      x = await account(),
      bgt = await budget({ categoryId: cat.id }),
      p = await period(bgt);
    expect([p.startDate, p.endDate]).toEqual(['2024-03-01', '2024-04-01']);
    await transaction(x.id, '12.34', { categoryId: cat.id });
    const view = c.FinancePeriodPageSchema.parse(
      (
        await call(a, 'get', '/finance/budgets/' + bgt.id + '/periods').expect(
          200,
        )
      ).body,
    ).items[0]!;
    expect(view.spent).toBe('12.34');
    expect(view.remaining).toBe('-2.34');
    expect(view.overspent).toBe(true);
  });
  it('freezes period limits/category snapshots and changes limits only explicitly', async () => {
    const cat = await category(),
      bgt = await budget({ categoryId: cat.id }),
      p = await period(bgt);
    const updated = c.FinanceBudgetSchema.parse(
      (
        await call(a, 'patch', '/finance/budgets/' + bgt.id, bgt.revision)
          .send({ limit: '20.00', categoryId: null })
          .expect(200)
      ).body,
    );
    expect(
      c.FinancePeriodPageSchema.parse(
        (
          await call(
            a,
            'get',
            '/finance/budgets/' + bgt.id + '/periods',
          ).expect(200)
        ).body,
      ).items[0]?.limit,
    ).toBe('10.00');
    await post(
      '/finance/budgets/' + bgt.id + '/periods',
      { date: '2024-03-15' },
      a,
      updated.revision,
    ).expect(409);
    const v = c.FinancePeriodSchema.parse(
      (
        await call(
          a,
          'patch',
          '/finance/budgets/' + bgt.id + '/periods/' + p.id,
          p.revision,
        )
          .send({ limit: '15' })
          .expect(200)
      ).body,
    );
    expect(v.limit).toBe('15.00');
    await call(
      a,
      'patch',
      '/finance/budgets/' + bgt.id + '/periods/' + p.id,
      p.revision,
    )
      .send({ limit: '16' })
      .expect(409);
  });
  it('calculates Jalali month and saved week preference without rewriting old periods', async () => {
    const m = await budget({ calendar: 'JALALI' }),
      mp = await period(m, '2024-03-25');
    expect([mp.startDate, mp.endDate]).toEqual(['2024-03-20', '2024-04-20']);
    const w = await budget({ period: 'WEEKLY', firstDayOfWeek: 6 }),
      wp = await period(w, '2024-03-13');
    expect([wp.startDate, wp.endDate]).toEqual(['2024-03-09', '2024-03-16']);
  });
  it('uses view-zone DST midnight boundaries and reversals restate original spending', async () => {
    const x = await account();
    const before = await transaction(x.id, '1', {
        occurredAt: '2024-03-10T04:59:59.999Z',
      }),
      inside = await transaction(x.id, '2', {
        occurredAt: '2024-03-10T05:00:00.000Z',
      });
    await transaction(x.id, '4', { occurredAt: '2024-03-11T03:59:59.999Z' });
    await transaction(x.id, '8', { occurredAt: '2024-03-11T04:00:00.000Z' });
    const q = {
      from: '2024-03-10',
      to: '2024-03-11',
      timezone: 'America/New_York',
      accountId: x.id,
    };
    const report = async () =>
      c.FinanceReportSchema.parse(
        (await call(a, 'get', '/finance/reports').query(q).expect(200)).body,
      );
    expect((await report()).currencies[0]?.expense).toBe('6.00');
    await reverse(inside);
    expect((await report()).currencies[0]?.expense).toBe('4.00');
    expect((await report()).startAt).toBe('2024-03-10T05:00:00.000Z');
    expect(before.localDate).toBe('2024-03-10');
  });
  it('separates transfers, fees, adjustments and income with exact definitions', async () => {
    const cat = await category(),
      x = await account(),
      y = await account();
    await transaction(x.id, '10', { type: 'INCOME' });
    await transaction(x.id, '2', { type: 'ADJUSTMENT', direction: 'IN' });
    await post('/finance/transfers', {
      type: 'TRANSFER',
      sourceAccountId: x.id,
      destinationAccountId: y.id,
      sourceAmount: '3',
      destinationAmount: '3',
      fee: { amount: '0.25', categoryId: cat.id },
      occurredAt: '2024-03-10T12:00:00Z',
      timezone: 'UTC',
    }).expect(201);
    const r = c.FinanceReportSchema.parse(
      (
        await call(a, 'get', '/finance/reports')
          .query({
            from: '2024-03-10',
            to: '2024-03-11',
            timezone: 'UTC',
            accountId: x.id,
          })
          .expect(200)
      ).body,
    ).currencies[0]!;
    expect(r).toMatchObject({
      income: '10.00',
      expense: '0.25',
      fees: '0.25',
      transferOut: '3.00',
      adjustments: '2.00',
      net: '8.75',
    });
  });
  it('previews recurring bills with short-month skips and no automatic ledger effect', async () => {
    const x = await account(),
      bll = await bill(x.id, {
        schedule: { version: 1, frequency: 'MONTHLY' },
      }),
      before = await db.client.transaction.count({
        where: { spaceId: a.spaceId },
      });
    const page = c.FinanceBillOccurrencePageSchema.parse(
      (
        await call(a, 'get', '/finance/bills/' + bll.id + '/preview')
          .query({ from: '2024-01-01', to: '2024-05-01' })
          .expect(200)
      ).body,
    );
    expect(page.items.map((v) => v.occurrenceKey)).toEqual([
      '2024-01-31',
      '2024-03-31',
    ]);
    expect(page.items.every((v) => v.state === 'UNPAID')).toBe(true);
    expect(
      await db.client.transaction.count({ where: { spaceId: a.spaceId } }),
    ).toBe(before);
  });
  it('bounds recurring previews and validates cursor ownership/query', async () => {
    const x = await account(),
      bll = await bill(x.id, {
        dueDate: '2024-01-01',
        schedule: { version: 1, frequency: 'DAILY', count: 3 },
      }),
      q = { from: '2024-01-01', to: '2024-01-10', limit: '1' };
    const p = c.FinanceBillOccurrencePageSchema.parse(
      (
        await call(a, 'get', '/finance/bills/' + bll.id + '/preview')
          .query(q)
          .expect(200)
      ).body,
    );
    expect(p.nextCursor).not.toBeNull();
    const n = c.FinanceBillOccurrencePageSchema.parse(
      (
        await call(a, 'get', '/finance/bills/' + bll.id + '/preview')
          .query({ ...q, cursor: p.nextCursor })
          .expect(200)
      ).body,
    );
    expect(n.items[0]?.occurrenceKey).toBe('2024-01-02');
    await call(a, 'get', '/finance/bills/' + bll.id + '/preview')
      .query({ ...q, to: '2024-01-11', cursor: p.nextCursor })
      .expect(400);
    await call(b, 'get', '/finance/bills/' + bll.id + '/preview')
      .query(q)
      .expect(404);
  });
  it('posts one bill occurrence under concurrent keys and retains reversed payment identity', async () => {
    const x = await account(),
      bll = await bill(x.id),
      body = {
        occurrenceKey: '2024-01-31',
        occurredAt: '2024-02-01T12:00:00Z',
      };
    const res = await Promise.all([
      post('/finance/bills/' + bll.id + '/pay', body, a, bll.revision),
      post('/finance/bills/' + bll.id + '/pay', body, a, bll.revision),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    const t = c.FinanceTransactionSchema.parse(
      res.find((v) => v.status === 200)!.body,
    );
    await reverse(t);
    await post(
      '/finance/bills/' + bll.id + '/pay',
      body,
      a,
      bll.revision,
    ).expect(409);
    const p = c.FinanceBillOccurrencePageSchema.parse(
      (
        await call(a, 'get', '/finance/bills/' + bll.id + '/preview')
          .query({ from: '2024-01-31', to: '2024-02-01' })
          .expect(200)
      ).body,
    );
    expect(p.items[0]?.state).toBe('REVERSED');
  });
  it('links an existing revision-checked payment without a second posting', async () => {
    const x = await account(),
      bll = await bill(x.id),
      t = await transaction(x.id, '5'),
      count = await db.client.transactionPosting.count({
        where: { accountId: x.id },
      });
    const linked = c.FinanceTransactionSchema.parse(
      (
        await post(
          '/finance/bills/' + bll.id + '/pay',
          {
            occurrenceKey: '2024-01-31',
            transactionId: t.id,
            transactionRevision: t.revision,
          },
          a,
          bll.revision,
        ).expect(200)
      ).body,
    );
    expect(linked.id).toBe(t.id);
    expect(
      await db.client.transactionPosting.count({ where: { accountId: x.id } }),
    ).toBe(count);
  });
  it('preserves past bill price/schedule versions after explicit future edit', async () => {
    const x = await account(),
      bll = await bill(x.id, {
        schedule: { version: 1, frequency: 'MONTHLY' },
      }),
      today = new Date().toISOString().slice(0, 10);
    const v = c.FinanceBillSchema.parse(
      (
        await call(a, 'patch', '/finance/bills/' + bll.id, bll.revision)
          .send({ effectiveFrom: today, amount: '8', name: 'Changed' })
          .expect(200)
      ).body,
    );
    expect(v.id).toBe(bll.id);
    const p = c.FinanceBillOccurrencePageSchema.parse(
      (
        await call(a, 'get', '/finance/bills/' + bll.id + '/preview')
          .query({ from: '2024-01-31', to: '2024-02-01' })
          .expect(200)
      ).body,
    );
    expect(p.items[0]?.amount).toBe('5.00');
    const h = c.FinanceBillPageSchema.parse(
      (
        await call(a, 'get', '/finance/bills/' + bll.id + '/history').expect(
          200,
        )
      ).body,
    );
    expect(h.items.map((v) => v.amount)).toEqual(['5.00', '8.00']);
    expect(h.items[0]?.updatedAt).toBe(bll.updatedAt);
  });
  it('tracks account savings once and manual savings with immutable correction history', async () => {
    const x = await account('USD', '25'),
      linked = c.FinanceSavingsSchema.parse(
        (
          await post('/finance/savings-goals', {
            name: 'Reserve',
            currency: 'USD',
            target: '100',
            mode: 'ACCOUNT',
            accountId: x.id,
          }).expect(201)
        ).body,
      );
    expect(linked.progress).toBe('25.00');
    await transaction(x.id, '10', { type: 'INCOME' });
    expect(
      c.FinanceSavingsSchema.parse(
        (
          await call(a, 'get', '/finance/savings-goals/' + linked.id).expect(
            200,
          )
        ).body,
      ).progress,
    ).toBe('35.00');
    await call(
      a,
      'patch',
      '/finance/savings-goals/' + linked.id,
      linked.revision,
    )
      .send({ manualAmount: '2' })
      .expect(400);
    const manual = c.FinanceSavingsSchema.parse(
      (
        await post('/finance/savings-goals', {
          name: 'Manual',
          currency: 'USD',
          target: '10',
          mode: 'MANUAL',
          manualAmount: '0',
        }).expect(201)
      ).body,
    );
    const v = c.FinanceSavingsSchema.parse(
      (
        await call(
          a,
          'patch',
          '/finance/savings-goals/' + manual.id,
          manual.revision,
        )
          .send({ manualAmount: '12.50' })
          .expect(200)
      ).body,
    );
    expect(v).toMatchObject({
      progress: '12.50',
      percent: '125.00',
      exceeded: true,
    });
    const h = c.FinanceSavingsPageSchema.parse(
      (
        await call(
          a,
          'get',
          '/finance/savings-goals/' + manual.id + '/history',
        ).expect(200)
      ).body,
    );
    expect(h.items.map((v) => v.manualAmount)).toEqual(['0.00', '12.50']);
    expect(h.items[0]?.updatedAt).toBe(manual.updatedAt);
  });
  it('atomically converts a retained expense draft and preserves the old Capture contract', async () => {
    const x = await account(),
      source = c.CaptureSchema.parse(
        (
          await post('/capture', {
            type: 'EXPENSE',
            text: 'Original private expense draft',
          }).expect(201)
        ).body,
      ),
      key = randomUUID(),
      body = {
        captureId: source.id,
        captureRevision: source.revision,
        expense: {
          type: 'EXPENSE',
          accountId: x.id,
          amount: '3.21',
          occurredAt: '2024-03-10T12:00:00Z',
          timezone: 'UTC',
        },
      };
    const first = c.FinanceDraftResultSchema.parse(
      (
        await post(
          '/finance/transactions/from-capture',
          body,
          a,
          undefined,
          key,
        ).expect(201)
      ).body,
    );
    expect(
      (
        await post(
          '/finance/transactions/from-capture',
          body,
          a,
          undefined,
          key,
        ).expect(201)
      ).body,
    ).toEqual(first);
    const retained = c.CaptureSchema.parse(
      (await call(a, 'get', '/capture/' + source.id).expect(200)).body,
    );
    expect(retained).toMatchObject({
      id: source.id,
      text: source.text,
      state: 'TRIAGED',
    });
    expect(retained).not.toHaveProperty('targetTransactionId');
    expect(first.transaction.sourceCaptureId).toBe(source.id);
    expect(
      (
        await db.client.captureItem.findUniqueOrThrow({
          where: { id: source.id },
        })
      ).targetTransactionId,
    ).toBe(first.transaction.id);
    await reverse(first.transaction);
    await db.client.idempotencyRecord.deleteMany({
      where: { spaceId: a.spaceId, operation: 'post.finance.from_capture' },
    });
    await post('/finance/transactions/from-capture', body).expect(409);
    expect(
      await db.client.transaction.count({
        where: { sourceCaptureId: source.id },
      }),
    ).toBe(1);
  });
  it('rolls back expense posting/source/receipt/outbox on injected failure and permits retry', async () => {
    const x = await account(),
      source = c.CaptureSchema.parse(
        (
          await post('/capture', {
            type: 'EXPENSE',
            text: 'Rollback expense',
          }).expect(201)
        ).body,
      ),
      key = randomUUID(),
      body = {
        captureId: source.id,
        captureRevision: source.revision,
        expense: { type: 'EXPENSE', accountId: x.id, amount: '1' },
      },
      actual = outbox.appendOutbox;
    vi.spyOn(outbox, 'appendOutbox').mockImplementation(
      async (tx, scope, e) => {
        if (e.type === 'capture.triaged') throw Error('injected');
        return actual(tx, scope, e);
      },
    );
    await post(
      '/finance/transactions/from-capture',
      body,
      a,
      undefined,
      key,
    ).expect(500);
    expect(await balance(x.id)).toBe('0.00');
    expect(
      (
        await db.client.captureItem.findUniqueOrThrow({
          where: { id: source.id },
        })
      ).state,
    ).toBe('INBOX');
    expect(
      await db.client.transaction.count({
        where: { sourceCaptureId: source.id },
      }),
    ).toBe(0);
    vi.restoreAllMocks();
    await post(
      '/finance/transactions/from-capture',
      body,
      a,
      undefined,
      key,
    ).expect(201);
  });
  it('prevents concurrent different-key draft conversion and foreign/nonexpense sources', async () => {
    const x = await account(),
      source = c.CaptureSchema.parse(
        (
          await post('/capture', {
            type: 'EXPENSE',
            text: 'Concurrent draft',
          }).expect(201)
        ).body,
      ),
      body = {
        captureId: source.id,
        captureRevision: source.revision,
        expense: { type: 'EXPENSE', accountId: x.id, amount: '1' },
      };
    const res = await Promise.all([
      post('/finance/transactions/from-capture', body),
      post('/finance/transactions/from-capture', body),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    await post('/finance/transactions/from-capture', body, b).expect(404);
    const note = c.CaptureSchema.parse(
      (
        await post('/capture', {
          type: 'NOTE',
          text: 'No money inference',
        }).expect(201)
      ).body,
    );
    await post('/finance/transactions/from-capture', {
      ...body,
      captureId: note.id,
      captureRevision: note.revision,
    }).expect(400);
  });
  it('streams private JSON/CSV with decimal strings and formula-safe narratives', async () => {
    const x = await account(),
      t = await transaction(x.id, '1.23', { note: '=HYPERLINK("private")' }),
      q = {
        from: '2024-03-10',
        to: '2024-03-11',
        timezone: 'UTC',
        accountId: x.id,
      };
    const json = await call(a, 'get', '/finance/export').query(q).expect(200);
    expect(json.body.transactions[0].id).toBe(t.id);
    expect(json.body.transactions[0].postings[0].amount).toBe('-1.23');
    expect(json.headers['cache-control']).toBe('no-store');
    const csv = await call(a, 'get', '/finance/export')
      .query({ ...q, format: 'csv' })
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain("'=");
    expect(csv.text).toContain('""private""');
    await call(b, 'get', '/finance/export').query(q).expect(404);
  });
  it('denies cross-user nested resources, filters, transfers, summaries and updates', async () => {
    const x = await account(),
      foreign = await account('USD', undefined, b),
      cat = await category('EXPENSE', b),
      bgt = await budget(),
      p = await period(bgt),
      bll = await bill(x.id);
    for (const route of [
      '/finance/accounts/' + x.id,
      '/finance/budgets/' + bgt.id,
      '/finance/budgets/' + bgt.id + '/periods',
      '/finance/bills/' + bll.id + '/history',
    ])
      await call(b, 'get', route).expect(404);
    await call(b, 'patch', '/finance/accounts/' + x.id, x.revision)
      .send({ name: 'stolen' })
      .expect(404);
    await post('/finance/transactions', {
      type: 'EXPENSE',
      accountId: foreign.id,
      amount: '1',
    }).expect(404);
    await post('/finance/transactions', {
      type: 'EXPENSE',
      accountId: x.id,
      amount: '1',
      categoryId: cat.id,
    }).expect(404);
    await post('/finance/transfers', {
      type: 'TRANSFER',
      sourceAccountId: x.id,
      destinationAccountId: foreign.id,
      sourceAmount: '1',
      destinationAmount: '1',
    }).expect(404);
    await call(a, 'get', '/finance/transactions')
      .query({ accountId: foreign.id })
      .expect(404);
    await call(a, 'get', '/finance/reports')
      .query({ from: '2024-01-01', to: '2024-01-02', categoryId: cat.id })
      .expect(404);
    await call(
      b,
      'patch',
      '/finance/budgets/' + bgt.id + '/periods/' + p.id,
      p.revision,
    )
      .send({ limit: '1' })
      .expect(404);
  });
  it('rejects stale concurrent account/budget/savings changes', async () => {
    const x = await account();
    const res = await Promise.all([
      call(a, 'patch', '/finance/accounts/' + x.id, x.revision).send({
        name: 'one',
      }),
      call(a, 'patch', '/finance/accounts/' + x.id, x.revision).send({
        name: 'two',
      }),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    const bgt = await budget();
    await call(a, 'patch', '/finance/budgets/' + bgt.id, bgt.revision)
      .send({ limit: '11' })
      .expect(200);
    await call(a, 'patch', '/finance/budgets/' + bgt.id, bgt.revision)
      .send({ limit: '12' })
      .expect(409);
  });
  it('enforces database scoped FKs and currency/minor-unit constraints', async () => {
    const x = await account(),
      f = await account('USD', undefined, b),
      t = await transaction(x.id);
    await expect(
      db.client.transactionPosting.create({
        data: {
          spaceId: a.spaceId,
          transactionId: t.id,
          accountId: f.id,
          currency: 'USD',
          scale: 2,
          amount: '1',
          role: 'FEE',
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.transactionPosting.create({
        data: {
          spaceId: a.spaceId,
          transactionId: t.id,
          accountId: x.id,
          currency: 'USD',
          scale: 2,
          amount: '0.001',
          role: 'FEE',
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.financialAccount.create({
        data: {
          spaceId: a.spaceId,
          createdByUserId: a.id,
          name: 'Bad precision',
          currency: 'IRR',
          scale: 0,
        },
      }),
    ).rejects.toThrow();
  });
  it('keeps financial values/narratives out of audit, outbox and generic search', async () => {
    const secret = 'finance-private-' + randomUUID(),
      x = await account(),
      t = await transaction(x.id, '123.45', { note: secret });
    const rows = await db.client.securityAuditEvent.findMany({
      where: { actorUserId: a.id, resourceId: t.id },
    });
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(JSON.stringify(rows)).not.toContain('123.45');
    const events = await db.client.outboxEvent.findMany({
      where: { aggregateId: t.id },
    });
    expect(events.map((e) => e.payload)).toEqual([{}]);
    const search = c.PersonalSearchPageSchema.parse(
      (
        await call(a, 'get', '/search/personal')
          .query({ q: secret })
          .expect(200)
      ).body,
    );
    expect(search.items).toEqual([]);
  });

  it('returns exact negative CSV amount strings while neutralizing only text cells', async () => {
    const x = await account();
    await transaction(x.id, '1.23', { note: '  @private_formula' });
    const r = await call(a, 'get', '/finance/export')
      .query({
        from: '2024-03-10',
        to: '2024-03-11',
        timezone: 'UTC',
        accountId: x.id,
        format: 'csv',
      })
      .expect(200);
    expect(r.text).toContain('"-1.23"');
    expect(r.text).not.toContain("'-1.23");
    expect(r.text).toContain("'  @private_formula");
  });
  it('validates existing-payment amount, type and stale transaction revision', async () => {
    const x = await account(),
      bll = await bill(x.id),
      wrong = await transaction(x.id, '4');
    await post(
      '/finance/bills/' + bll.id + '/pay',
      {
        occurrenceKey: '2024-01-31',
        transactionId: wrong.id,
        transactionRevision: wrong.revision,
      },
      a,
      bll.revision,
    ).expect(400);
    const income = await transaction(x.id, '5', { type: 'INCOME' });
    await post(
      '/finance/bills/' + bll.id + '/pay',
      {
        occurrenceKey: '2024-01-31',
        transactionId: income.id,
        transactionRevision: income.revision,
      },
      a,
      bll.revision,
    ).expect(400);
    const valid = await transaction(x.id, '5');
    await post(
      '/finance/bills/' + bll.id + '/pay',
      {
        occurrenceKey: '2024-01-31',
        transactionId: valid.id,
        transactionRevision: valid.revision + 1,
      },
      a,
      bll.revision,
    ).expect(409);
  });
  it('safely denies foreign savings/bill/category links and same-space invalid currency', async () => {
    const foreign = await account('USD', undefined, b),
      euro = await account('EUR');
    await post('/finance/savings-goals', {
      name: 'No leak',
      currency: 'USD',
      target: '1',
      mode: 'ACCOUNT',
      accountId: foreign.id,
    }).expect(404);
    await post('/finance/savings-goals', {
      name: 'Mismatch',
      currency: 'USD',
      target: '1',
      mode: 'ACCOUNT',
      accountId: euro.id,
    }).expect(400);
    await post('/finance/bills', {
      name: 'Foreign bill',
      accountId: foreign.id,
      amount: '1',
      dueDate: '2024-01-01',
    }).expect(404);
    const cat = await category('EXPENSE', b);
    await post('/finance/budgets', {
      name: 'Foreign category',
      currency: 'USD',
      limit: '1',
      period: 'MONTHLY',
      categoryId: cat.id,
    }).expect(404);
  });
  it('enforces scoped Finance target FK and creator ownership at the database boundary', async () => {
    const foreign = await account('USD', undefined, b),
      t = await transaction(foreign.id, '1', {}, b),
      source = c.CaptureSchema.parse(
        (
          await post('/capture', {
            type: 'EXPENSE',
            text: 'Scoped link',
          }).expect(201)
        ).body,
      );
    await expect(
      db.client.captureItem.update({
        where: { id: source.id },
        data: { state: 'TRIAGED', targetTransactionId: t.id },
      }),
    ).rejects.toThrow();
    await expect(
      db.client.financialAccount.create({
        data: {
          name: 'Foreign creator',
          spaceId: a.spaceId,
          createdByUserId: b.id,
          currency: 'USD',
          scale: 2,
        },
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.client.captureItem.findUniqueOrThrow({
          where: { id: source.id },
        })
      ).state,
    ).toBe('INBOX');
  });
  it('returns exact zero-data and currency-separated reports', async () => {
    const empty = await account();
    const q = {
      from: '2024-03-10',
      to: '2024-03-11',
      timezone: 'UTC',
      accountId: empty.id,
    };
    expect(
      c.FinanceReportSchema.parse(
        (await call(a, 'get', '/finance/reports').query(q).expect(200)).body,
      ).currencies,
    ).toEqual([]);
    const usd = await account(),
      eur = await account('EUR'),
      cat = await category();
    await transaction(usd.id, '2', { categoryId: cat.id });
    await transaction(eur.id, '3', { categoryId: cat.id });
    const r = c.FinanceReportSchema.parse(
      (
        await call(a, 'get', '/finance/reports')
          .query({
            from: q.from,
            to: q.to,
            timezone: q.timezone,
            categoryId: cat.id,
          })
          .expect(200)
      ).body,
    );
    expect(r.currencies.map((v) => [v.currency, v.expense])).toEqual([
      ['EUR', '3.00'],
      ['USD', '2.00'],
    ]);
    expect(r).not.toHaveProperty('grandTotal');
  });
  it('orders categories explicitly and scopes cursor pages', async () => {
    const first = await call(a, 'get', '/finance/categories')
        .query({ limit: '100' })
        .expect(200),
      page = c.FinanceCategoryPageSchema.parse(first.body);
    expect(page.items.map((v) => v.position)).toEqual(
      page.items.map((v) => v.position).toSorted((a, b) => a - b),
    );
    const p = c.FinanceCategoryPageSchema.parse(
      (
        await call(a, 'get', '/finance/categories')
          .query({ limit: '1' })
          .expect(200)
      ).body,
    );
    expect(p.nextCursor).not.toBeNull();
    const n = c.FinanceCategoryPageSchema.parse(
      (
        await call(a, 'get', '/finance/categories')
          .query({ limit: '1', cursor: p.nextCursor })
          .expect(200)
      ).body,
    );
    expect(n.items[0]?.id).not.toBe(p.items[0]?.id);
    await call(b, 'get', '/finance/categories')
      .query({ limit: '1', cursor: p.nextCursor })
      .expect(400);
  });
  it('rejects excessive report/export density rather than silently truncating totals', async () => {
    const x = await account(),
      ids = Array.from({ length: 10001 }, () => randomUUID());
    try {
      // The same 10001 owned, constraint-checked rows; avoid repeated ORM fixture
      // serialization consuming the density test's unchanged execution budget.
      for (let i = 0; i < ids.length; i += 200)
        await db.client
          .$executeRaw`INSERT INTO "Transaction" (id,"spaceId","createdByUserId",type,"occurredAt","localDate",timezone,"updatedAt") SELECT id,${a.spaceId}::uuid,${a.id}::uuid,'EXPENSE','2024-05-01T12:00:00Z'::timestamptz,'2024-05-01'::date,'UTC',clock_timestamp() FROM unnest(${ids.slice(i, i + 200)}::uuid[]) AS id`;
      for (let i = 0; i < ids.length; i += 200)
        await db.client
          .$executeRaw`INSERT INTO "TransactionPosting" (id,"spaceId","transactionId","accountId",currency,scale,amount,role) SELECT gen_random_uuid(),${a.spaceId}::uuid,id,${x.id}::uuid,'USD',2,-0.01,'EXPENSE' FROM unnest(${ids.slice(i, i + 200)}::uuid[]) AS id`;
      for (const route of ['/finance/reports', '/finance/export'])
        await call(a, 'get', route)
          .query({
            from: '2024-05-01',
            to: '2024-05-02',
            timezone: 'UTC',
            accountId: x.id,
          })
          .expect(400);
      await db.client.transaction.delete({ where: { id: ids[0]! } });
      const allowed = c.FinanceReportSchema.parse(
        (
          await call(a, 'get', '/finance/reports')
            .query({
              from: '2024-05-01',
              to: '2024-05-02',
              timezone: 'UTC',
              accountId: x.id,
            })
            .expect(200)
        ).body,
      );
      expect(allowed.postingCount).toBe(10000);
      expect(allowed.currencies[0]?.expense).toBe('100.00');
      const exported = await call(a, 'get', '/finance/export')
        .query({
          from: '2024-05-01',
          to: '2024-05-02',
          timezone: 'UTC',
          accountId: x.id,
        })
        .expect(200);
      expect(exported.body.transactions).toHaveLength(10000);
    } finally {
      for (let i = 0; i < ids.length; i += 200)
        await db.client.transaction.deleteMany({
          where: { spaceId: a.spaceId, id: { in: ids.slice(i, i + 200) } },
        });
    }
  });
});
