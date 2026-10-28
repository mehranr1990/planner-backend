import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import {
  TaskIdSchema,
  CaptureSchema,
  FinanceAccountSchema,
  FinanceCategorySchema,
  FinanceTransactionSchema,
  FinanceTransactionPageSchema,
  FinanceDraftResultSchema,
  FinanceBudgetSchema,
  FinancePeriodSchema,
  FinancePeriodPageSchema,
  FinanceBillSchema,
  FinanceBillOccurrencePageSchema,
  FinanceSavingsSchema,
  FinanceReportSchema,
} from '../../packages/api-contracts/dist/index.js';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';

const databaseUrl = isolatedTestDatabaseUrl(process.env),
  pool = new Pool({ connectionString: databaseUrl });
const root = path.resolve('.tools/p1-09');
await fs.mkdir(root, { recursive: true });
const fixture = await fs.mkdtemp(path.join(root, 'smoke-')),
  mail = path.join(fixture, 'mail'),
  storage = path.join(fixture, 'private');
const listener = net.createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = (listener.address() as AddressInfo).port;
await new Promise<void>((resolve) => listener.close(() => resolve()));
const origin = `http://127.0.0.1:${port}`,
  secret = randomBytes(48).toString('base64url'),
  userIds: string[] = [],
  requestIds: string[] = [];
let child: ChildProcess | undefined;
async function start() {
  child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: secret,
      LOG_LEVEL: 'silent',
      MAIL_MODE: 'sink',
      MAIL_SINK_DIR: mail,
      STORAGE_ROOT: storage,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout?.on('data', (value) => {
    output += String(value);
  });
  child.stderr?.on('data', (value) => {
    output += String(value);
  });
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      if ((await fetch(origin + '/health/ready')).status === 200) return;
    } catch {
      /* Wait for this fixture process to bind. */
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await fs.writeFile(path.join(root, 'smoke-startup.log'), output);
  throw new Error(
    'Compiled API startup failed; inspect ignored local evidence.',
  );
}
async function stop() {
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, 'exit');
  }
}
async function call(
  route: string,
  method = 'GET',
  body?: unknown,
  cookie?: string,
  revision?: number,
  key?: string,
) {
  const id = randomUUID();
  requestIds.push(id);
  return fetch(origin + route, {
    method,
    headers: {
      Origin: origin,
      'X-Request-Id': id,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(revision ? { 'If-Match': `"${revision}"` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function identity() {
  const email = `p109-smoke-${randomUUID()}@example.test`,
    password = 'test-only-compiled-goals-123!';
  const signup = await call('/api/v1/auth/sign-up/email', 'POST', {
    email,
    password,
    name: 'Compiled finance fixture',
  });
  assert.equal(signup.status, 200);
  const parsed = (await signup.json()) as { user: { id: unknown } };
  userIds.push(TaskIdSchema.parse(parsed.user.id));
  let message: { url: string } | undefined;
  for (const name of await fs.readdir(mail)) {
    const value = JSON.parse(
      await fs.readFile(path.join(mail, name), 'utf8'),
    ) as { to: string; url: string };
    if (value.to === email && typeof value.url === 'string') message = value;
  }
  assert(message);
  const url = new URL(message.url);
  url.searchParams.delete('callbackURL');
  assert.equal((await call(url.pathname + url.search)).status, 200);
  const login = await call('/api/v1/auth/sign-in/email', 'POST', {
    email,
    password,
  });
  assert.equal(login.status, 200);
  return login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}
async function parsed<T>(
  response: Response,
  status: number,
  schema: { parse(value: unknown): T },
): Promise<T> {
  assert.equal(response.status, status);
  return schema.parse(await response.json());
}

try {
  await start();
  const a = await identity(),
    b = await identity();
  const post = (route: string, body: unknown, r?: number, k = randomUUID()) =>
      call('/api/v1' + route, 'POST', body, a, r, k),
    get = (route: string, cookie = a) =>
      call('/api/v1' + route, 'GET', undefined, cookie);
  const account = await parsed(
      await post('/finance/accounts', {
        name: 'Compiled private account',
        currency: 'USD',
        opening: {
          amount: '100',
          direction: 'IN',
          occurredAt: '2024-01-01T12:00:00Z',
          timezone: 'UTC',
        },
      }),
      201,
      FinanceAccountSchema,
    ),
    dest = await parsed(
      await post('/finance/accounts', { name: 'Destination', currency: 'EUR' }),
      201,
      FinanceAccountSchema,
    ),
    cat = await parsed(
      await post('/finance/categories', {
        name: 'Private expense category',
        kind: 'EXPENSE',
      }),
      201,
      FinanceCategorySchema,
    );
  const source = await parsed(
      await post('/capture', {
        type: 'EXPENSE',
        text: 'Private retained expense source',
      }),
      201,
      CaptureSchema,
    ),
    key = randomUUID(),
    input = {
      captureId: source.id,
      captureRevision: source.revision,
      expense: {
        type: 'EXPENSE',
        accountId: account.id,
        amount: '3.21',
        categoryId: cat.id,
        occurredAt: '2024-03-10T12:00:00Z',
        timezone: 'UTC',
        note: '=private-finance-narrative',
      },
    };
  const converted = await parsed(
    await post('/finance/transactions/from-capture', input, undefined, key),
    201,
    FinanceDraftResultSchema,
  );
  const fx = await parsed(
    await post('/finance/transfers', {
      type: 'TRANSFER',
      sourceAccountId: account.id,
      destinationAccountId: dest.id,
      sourceAmount: '10',
      destinationAmount: '12.50',
      rate: '1.25',
      conversionDate: '2024-03-10',
      occurredAt: '2024-03-10T12:00:00Z',
      timezone: 'UTC',
      fee: { amount: '0.25', categoryId: cat.id },
    }),
    201,
    FinanceTransactionSchema,
  );
  assert.equal(fx.exchangeRate?.rate, '1.250000000000');
  const expense = await parsed(
      await post('/finance/transactions', {
        type: 'EXPENSE',
        accountId: account.id,
        amount: '5',
        categoryId: cat.id,
        occurredAt: '2024-03-10T12:00:00Z',
        timezone: 'UTC',
      }),
      201,
      FinanceTransactionSchema,
    ),
    replacement = {
      type: 'EXPENSE',
      accountId: account.id,
      amount: '2.50',
      categoryId: cat.id,
      occurredAt: '2024-03-10T12:00:00Z',
      timezone: 'UTC',
    };
  const corrected = await parsed(
    await post(
      '/finance/transactions/' + expense.id + '/correct',
      { replacement },
      expense.revision,
    ),
    200,
    FinanceTransactionSchema,
  );
  assert.equal(corrected.replacesId, expense.id);
  const budget = await parsed(
      await post('/finance/budgets', {
        name: 'Compiled budget',
        currency: 'USD',
        limit: '20',
        categoryId: cat.id,
        period: 'MONTHLY',
        timezone: 'UTC',
        calendar: 'GREGORIAN',
      }),
      201,
      FinanceBudgetSchema,
    ),
    period = await parsed(
      await post(
        '/finance/budgets/' + budget.id + '/periods',
        { date: '2024-03-10' },
        budget.revision,
      ),
      201,
      FinancePeriodSchema,
    );
  const bill = await parsed(
    await post('/finance/bills', {
      name: 'Manual recurring bill',
      accountId: account.id,
      amount: '5',
      categoryId: cat.id,
      dueDate: '2024-01-31',
      timezone: 'UTC',
      schedule: { version: 1, frequency: 'MONTHLY' },
    }),
    201,
    FinanceBillSchema,
  );
  const paid = await parsed(
    await post(
      '/finance/bills/' + bill.id + '/pay',
      { occurrenceKey: '2024-01-31', occurredAt: '2024-03-10T12:00:00Z' },
      bill.revision,
    ),
    200,
    FinanceTransactionSchema,
  );
  assert.equal(paid.billId, bill.id);
  const savings = await parsed(
    await post('/finance/savings-goals', {
      name: 'Reserve',
      currency: 'USD',
      target: '100',
      mode: 'ACCOUNT',
      accountId: account.id,
    }),
    201,
    FinanceSavingsSchema,
  );
  assert.equal(savings.progress, '79.04');
  await stop();
  await start();
  assert.equal(
    (
      await parsed(
        await get('/finance/accounts/' + account.id),
        200,
        FinanceAccountSchema,
      )
    ).balance,
    '79.04',
  );
  assert.equal(
    (
      await parsed(
        await get('/finance/accounts/' + dest.id),
        200,
        FinanceAccountSchema,
      )
    ).balance,
    '12.50',
  );
  assert.deepEqual(
    await parsed(
      await post('/finance/transactions/from-capture', input, undefined, key),
      201,
      FinanceDraftResultSchema,
    ),
    converted,
  );
  const retained = await parsed(
    await get('/capture/' + source.id),
    200,
    CaptureSchema,
  );
  assert.equal(retained.id, source.id);
  assert.equal(retained.text, source.text);
  assert.equal(retained.state, 'TRIAGED');
  const h = await parsed(
    await get('/finance/transactions/' + corrected.id + '/history'),
    200,
    FinanceTransactionPageSchema,
  );
  assert.equal(h.items.length, 3);
  assert(h.items.some((v) => v.effect === 'REVERSAL'));
  assert(h.items.some((v) => v.id === expense.id && v.state === 'REVERSED'));
  const periods = await parsed(
    await get('/finance/budgets/' + budget.id + '/periods'),
    200,
    FinancePeriodPageSchema,
  );
  assert.equal(periods.items[0]?.id, period.id);
  assert.equal(periods.items[0]?.spent, '10.96');
  const occurrences = await parsed(
    await get(
      '/finance/bills/' + bill.id + '/preview?from=2024-01-01&to=2024-05-01',
    ),
    200,
    FinanceBillOccurrencePageSchema,
  );
  assert.deepEqual(
    occurrences.items.map((v) => v.occurrenceKey),
    ['2024-01-31', '2024-03-31'],
  );
  assert.equal(occurrences.items[0]?.state, 'PAID');
  const report = await parsed(
    await get(
      '/finance/reports?from=2024-03-01&to=2024-04-01&timezone=UTC&accountId=' +
        account.id,
    ),
    200,
    FinanceReportSchema,
  );
  assert.equal(report.currencies[0]?.expense, '10.96');
  assert.equal(report.currencies[0]?.fees, '0.25');
  assert.equal(report.currencies[0]?.transferOut, '10.00');
  const csv = await get(
    '/finance/export?from=2024-03-01&to=2024-04-01&timezone=UTC&format=csv&accountId=' +
      account.id,
  );
  assert.equal(csv.status, 200);
  const text = await csv.text();
  assert(text.includes("'="));
  assert(text.includes('"-3.21"'));
  for (const route of [
    '/finance/accounts/' + account.id,
    '/finance/transactions/' + converted.transaction.id,
    '/finance/savings-goals/' + savings.id,
    '/finance/export?from=2024-03-01&to=2024-04-01&accountId=' + account.id,
  ])
    assert.equal((await get(route, b)).status, 404);
  const audit = (
    await pool.query(
      'SELECT * FROM "SecurityAuditEvent" WHERE "actorUserId"=ANY($1::uuid[])',
      [userIds],
    )
  ).rows;
  assert(!JSON.stringify(audit).includes('private-finance-narrative'));
  assert(!JSON.stringify(audit).includes('79.04'));
  const events = (
    await pool.query(
      'SELECT payload FROM "OutboxEvent" WHERE "aggregateId"=$1 AND type=$2',
      [converted.transaction.id, 'finance.transaction_posted'],
    )
  ).rows;
  assert.deepEqual(
    events.map((r) => r.payload),
    [{}],
  );
  await fs.writeFile(
    path.join(root, 'compiled-smoke.json'),
    JSON.stringify(
      {
        status: 'PASS',
        runtime: process.versions.node,
        postgres: (await pool.query('SHOW server_version')).rows[0]
          .server_version,
        restartPersistence: true,
        exactBalances: true,
        fxAndFees: true,
        reversalReplacementHistory: true,
        budgetPeriodPersistence: true,
        billPreviewAndPayment: true,
        savingsSourceExclusive: true,
        expenseSourceIdentity: true,
        receiptReplayAfterRestart: true,
        privateCsv: true,
        crossUserDenial: true,
        safeAuditOutbox: true,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: compiled exact finance balances/FX/fees, correction history, budgets, bills, savings, expense source identity, real restart, receipt replay, private CSV and owner isolation.\n',
  );
} finally {
  await stop();
  await pool.query(
    'DELETE FROM "SecurityAuditEvent" WHERE "requestId"=ANY($1::uuid[]) OR "actorUserId"=ANY($2::uuid[])',
    [requestIds, userIds],
  );
  await pool.query('DELETE FROM "Space" WHERE "ownerUserId"=ANY($1::uuid[])', [
    userIds,
  ]);
  await pool.query('DELETE FROM "User" WHERE id=ANY($1::uuid[])', [userIds]);
  await pool.end();
  if (
    !fixture.startsWith(root + path.sep) ||
    !path.basename(fixture).startsWith('smoke-')
  )
    throw new Error('Refusing unsafe fixture cleanup');
  await fs.rm(fixture, { recursive: true, force: true });
}
