import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import {
  installJobSchema,
  verifyJobSchema,
  constructionPlan,
  jobPlanHash,
  queues,
} from '../../src/platform/jobs/schema.js';
import { createHash } from 'node:crypto';
import { isolatedTestDatabaseUrl } from '../../../../tooling/testing/test-database.js';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
describe('P1-10 reviewed PostgreSQL durable queue', () => {
  const url = isolatedTestDatabaseUrl(process.env),
    schema = 'planner_jobs_test_' + randomUUID().replaceAll('-', '');
  let pool: Pool,
    boss: PgBoss | undefined,
    owned = false;
  const client = () =>
    new PgBoss({
      connectionString: url,
      schema,
      migrate: false,
      createSchema: false,
      openTelemetry: { enabled: false },
      supervise: false,
      schedule: false,
      persistQueueStats: false,
      reindex: false,
    });
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    expect(
      (
        await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [
          schema,
        ])
      ).rowCount,
    ).toBe(0);
    owned = true;
    await installJobSchema(url, schema);
  });
  afterAll(async () => {
    await boss?.stop({ graceful: true });
    if (
      owned &&
      /^planner_jobs_test_[a-f0-9]{32}$/.test(schema) &&
      isolatedTestDatabaseUrl(process.env) === url
    )
      await pool.query('DROP SCHEMA ' + schema + ' CASCADE');
    await pool.end();
  });
  it('matches the exact reviewed plan and rejects unsafe namespaces', async () => {
    expect(
      createHash('sha256')
        .update(constructionPlan(schema).replaceAll(schema, 'planner_jobs'))
        .digest('hex'),
    ).toBe(jobPlanHash);
    expect(() => constructionPlan('public')).toThrow();
    await verifyJobSchema(pool, schema);
  });
  it('one-off setup is repeatable and does not change application migrations', async () => {
    const before = (
      await pool.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name,id',
      )
    ).rows;
    await installJobSchema(url, schema);
    expect(
      (
        await pool.query(
          'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name,id',
        )
      ).rows,
    ).toEqual(before);
  });
  it('rejects schema version/comment drift instead of silently upgrading', async () => {
    await pool.query('COMMENT ON SCHEMA ' + schema + " IS 'invalid'");
    await expect(verifyJobSchema(pool, schema)).rejects.toThrow(
      'reviewed one-off',
    );
    await pool.query('COMMENT ON SCHEMA ' + schema + ' IS NULL');
    await pool.query(
      'COMMENT ON SCHEMA ' +
        schema +
        " IS 'MP-P1-10:pg-boss=12.38.0:version=46:plan-sha256=" +
        jobPlanHash +
        "'",
    );
    await verifyJobSchema(pool, schema);
  });
  it('deduplicates pending work under concurrent upsert', async () => {
    boss = client();
    boss.on('error', () => undefined);
    await boss.start();
    const id = randomUUID();
    await Promise.all(
      Array.from({ length: 12 }, () =>
        boss!.upsert(
          queues.delivery,
          { id },
          { singletonKey: id, startAfter: new Date(Date.now() + 3600000) },
        ),
      ),
    );
    const rows = (
      await pool.query(
        'SELECT data FROM ' +
          schema +
          '.job WHERE name=$1 AND singleton_key=$2 AND state=$3',
        [queues.delivery, id, 'created'],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toEqual({ id });
  });
  it('preserves scheduled work across a real queue client restart', async () => {
    const id = randomUUID();
    await boss!.send(
      queues.delivery,
      { id },
      { startAfter: new Date(Date.now() + 500) },
    );
    await boss!.stop({ graceful: true });
    boss = client();
    boss.on('error', () => undefined);
    await boss.start();
    let received = false;
    await boss.work<{ id: string }>(
      queues.delivery,
      { batchSize: 1, pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        received ||= jobs.some((job) => job.data.id === id);
      },
    );
    for (let n = 0; n < 40 && !received; n++) await pause(100);
    expect(received).toBe(true);
    await boss.offWork(queues.delivery);
  });
  it('bounded queue retries end in a durable privacy-safe dead letter', async () => {
    const id = randomUUID();
    let attempts = 0;
    await boss!.work(
      queues.outbox,
      { batchSize: 1, pollingIntervalSeconds: 0.5 },
      async () => {
        attempts++;
        throw new Error('NOTIFICATION_JOB_FAILED');
      },
    );
    await boss!.send(
      queues.outbox,
      { id },
      { retryLimit: 1, retryDelay: 1, retryBackoff: false },
    );
    let dead: unknown[] = [];
    for (let n = 0; n < 70; n++) {
      dead = (
        await pool.query(
          'SELECT data FROM ' +
            schema +
            ".job WHERE name=$1 AND data->>'id'=$2",
          [queues.dead, id],
        )
      ).rows;
      if (dead.length) break;
      await pause(100);
    }
    expect(attempts).toBe(2);
    expect(dead).toHaveLength(1);
    expect(JSON.stringify(dead)).not.toContain('endpoint');
    await boss!.offWork(queues.outbox);
  });
});
