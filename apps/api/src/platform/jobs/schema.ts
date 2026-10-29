import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { PgBoss, getConstructionPlans } from 'pg-boss';
export const jobSchemaVersion = 46,
  jobPlanHash =
    '33395ea7aaf8d17f4eceec23c45fcb6672a278f11d3c1a255d8589491278e238',
  jobLibraryVersion = '12.38.0';
export const queues = {
  outbox: 'planner.outbox',
  delivery: 'planner.delivery',
  sweep: 'planner.sweep',
  dead: 'planner.dead',
} as const;
export const jobSchemaStamp =
  'MP-P1-10:pg-boss=' +
  jobLibraryVersion +
  ':version=' +
  jobSchemaVersion +
  ':plan-sha256=' +
  jobPlanHash;
export function validJobSchema(schema: string) {
  if (!/^planner_jobs(?:_test_[a-f0-9]{32})?$/.test(schema))
    throw new Error('Invalid owned job schema');
}
export function constructionPlan(schema: string) {
  validJobSchema(schema);
  const canonical = fs.readFileSync(
    fileURLToPath(
      new URL(
        '../../../../../tooling/compatibility/pgboss-12.38.0-schema.sql',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  if (createHash('sha256').update(canonical).digest('hex') !== jobPlanHash)
    throw new Error('Reviewed queue SQL snapshot changed');
  const sql = getConstructionPlans(schema);
  if (
    createHash('sha256')
      .update(sql.replaceAll(schema, 'planner_jobs'))
      .digest('hex') !== jobPlanHash
  )
    throw new Error('Pinned pg-boss construction plan drift');
  return sql;
}
export async function verifyJobSchema(pool: Pool, schema: string) {
  validJobSchema(schema);
  const exists = await pool.query(
    'SELECT obj_description(oid,$2) AS stamp FROM pg_namespace WHERE nspname=$1',
    [schema, 'pg_namespace'],
  );
  if (exists.rows[0]?.stamp !== jobSchemaStamp)
    throw new Error('Queue schema requires reviewed one-off setup');
  const version = await pool.query(
    'SELECT version FROM ' + schema + '.version',
  );
  if (version.rows.length !== 1 || version.rows[0].version !== jobSchemaVersion)
    throw new Error('Queue schema version mismatch');
}
export async function installJobSchema(databaseUrl: string, schema: string) {
  validJobSchema(schema);
  const sql = constructionPlan(schema),
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const exists = (
      await pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])
    ).rowCount;
    if (exists) await verifyJobSchema(pool, schema);
    else {
      const end = sql.lastIndexOf('COMMIT;');
      if (end < 0) throw new Error('Queue installation transaction absent');
      const stamped =
        sql.slice(0, end) +
        'COMMENT ON SCHEMA ' +
        schema +
        " IS '" +
        jobSchemaStamp +
        "';\n" +
        sql.slice(end);
      try {
        await pool.query(stamped);
      } catch {
        await pool.query('ROLLBACK').catch(() => undefined);
        throw new Error(
          'Reviewed queue schema installation failed; no configuration exposed',
        );
      }
      await verifyJobSchema(pool, schema);
    }
  } finally {
    await pool.end();
  }
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema,
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    openTelemetry: { enabled: false },
    persistQueueStats: false,
    reindex: false,
  });
  boss.on('error', () => undefined);
  try {
    await boss.start();
    for (const name of [
      queues.dead,
      queues.outbox,
      queues.delivery,
      queues.sweep,
    ]) {
      const existing = await boss.getQueue(name);
      if (!existing)
        await boss.createQueue(name, {
          partition: false,
          retryLimit: 3,
          retryDelay: 5,
          retryBackoff: true,
          expireInSeconds: 60,
          retentionSeconds: 7 * 86400,
          deleteAfterSeconds: 7 * 86400,
          ...(name === queues.dead ? {} : { deadLetter: queues.dead }),
        });
    }
  } finally {
    await boss.stop({ graceful: true });
  }
}
