import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { spawnSync, execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { migrationSandbox } from '../testing/migration-sandbox.ts';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';
import { reviewMigrations } from '../testing/migration-safety.ts';
import { reviewedG0Candidates } from '../testing/g0-candidates.ts';
import { seedG0Personal } from '../testing/g0-personal-fixture.ts';

if (!process.argv.includes('--isolated-only'))
  throw new Error('Explicit --isolated-only required');
const base = isolatedTestDatabaseUrl(process.env);
const candidates = reviewedG0Candidates(),
  names = reviewMigrations().slice(0, 24);
const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
const folder = path.resolve('.tools', 'g0-rehearsal-' + randomUUID());
fs.mkdirSync(folder, { recursive: true });
// Rehearse the frozen P1 baseline, even after P2 artifacts are promoted.
const baselineMigrations = path.join(folder, 'migrations');
fs.mkdirSync(baselineMigrations);
for (const name of names)
  fs.cpSync(
    path.join('prisma/migrations', name),
    path.join(baselineMigrations, name),
    { recursive: true },
  );
fs.copyFileSync(
  'prisma/migrations/migration_lock.toml',
  path.join(baselineMigrations, 'migration_lock.toml'),
);
const baselineConfig = path.join(folder, 'prisma.config.ts');
fs.writeFileSync(
  baselineConfig,
  `import { defineConfig } from 'prisma/config';\nexport default defineConfig({schema:${JSON.stringify(path.resolve('prisma/schema.prisma'))},migrations:{path:${JSON.stringify(baselineMigrations)}},datasource:{url:process.env.DATABASE_URL!}});\n`,
);
let phase = 'preflight';
const tables = async (client: Client, schema: string) =>
  (
    await client.query<{ tablename: string }>(
      'SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename',
      [schema],
    )
  ).rows.map((r) => r.tablename);
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
async function snapshot(
  client: Client,
  schema: string,
  selected?: string[],
  personalOnly = false,
) {
  const result: Record<string, { count: number; hash: string }> = {};
  for (const table of selected ?? (await tables(client, schema))) {
    const row = (
      await client.query<{ count: number; hash: string }>(
        `SELECT count(*)::int AS count,md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM ${quote(schema)}.${quote(table)} t ${personalOnly && table === 'Space' ? "WHERE t.kind='PERSONAL'" : ''}`,
      )
    ).rows[0]!;
    result[table] = row;
  }
  return result;
}
async function protectedSnapshot(url: string) {
  const parsed = new URL(url);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    !['postgres:', 'postgresql:'].includes(parsed.protocol)
  )
    throw new Error('Protected snapshot requires loopback PostgreSQL');
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const rows = await snapshot(client, 'public');
    const definitions = (
      await client.query(
        "SELECT c.relname,con.conname,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,con.conname",
      )
    ).rows;
    const queue = (
      await client.query(
        "SELECT obj_description(oid,'pg_namespace') AS metadata FROM pg_namespace WHERE nspname='planner_jobs'",
      )
    ).rows;
    await client.query('ROLLBACK');
    return { rows, definitions, queue };
  } finally {
    await client.end();
  }
}
const configured = [
  ...new Set([
    base,
    ...(fs.existsSync('.env')
      ? [parseEnv(fs.readFileSync('.env', 'utf8')).DATABASE_URL].filter(
          (v): v is string => !!v,
        )
      : []),
  ]),
];
const before = await Promise.all(configured.map(protectedSnapshot));
const baselineHashes = names.map((name) => {
  const file = 'prisma/migrations/' + name + '/migration.sql';
  assert.equal(
    execFileSync('git', ['hash-object', '--', file], {
      encoding: 'utf8',
    }).trim(),
    execFileSync('git', ['rev-parse', 'HEAD:' + file], {
      encoding: 'utf8',
    }).trim(),
    'Historical migration bytes changed',
  );
  return { name, sha256: hash(fs.readFileSync(file)) };
});
const results: object[] = [];
try {
  for (const populated of [false, true]) {
    phase = populated ? 'populated replay' : 'empty replay';
    const sandbox = await migrationSandbox(process.env);
    const schema = new URL(sandbox.url).searchParams.get('schema')!;
    assert.match(schema, /^p003_[a-f0-9]{32}$/);
    const client = new Client({
      connectionString: base,
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
    });
    try {
      const migrated = spawnSync(
        process.execPath,
        [
          'node_modules/prisma/build/index.js',
          'migrate',
          'deploy',
          '--config',
          baselineConfig,
        ],
        {
          env: { ...process.env, DATABASE_URL: sandbox.url },
          encoding: 'utf8',
          timeout: 60000,
        },
      );
      if (migrated.status !== 0)
        throw new Error('Isolated historical Prisma replay failed');
      await client.connect();
      await client.query(`SET search_path TO ${quote(schema)}`);
      const sourceTables = await tables(client, schema);
      assert.equal(sourceTables.length, 68);
      const fixture = populated ? await seedG0Personal(client) : null;
      const bytesPath = path.join(
        folder,
        populated ? 'populated.blob' : 'empty.blob',
      );
      fs.writeFileSync(
        bytesPath,
        fixture?.bytes ?? Buffer.from('empty fixture'),
      );
      const fileHash = hash(fs.readFileSync(bytesPath));
      const rowsBefore = await snapshot(client, schema, sourceTables);
      const fkBefore = (
        await client.query(
          "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace=$1::regnamespace AND contype='f' ORDER BY conname",
          [schema],
        )
      ).rows;
      const ownerFks = fkBefore.filter((r) =>
        (r.definition as string).includes(
          'REFERENCES "Space"(id, "ownerUserId")',
        ),
      );
      assert.equal(ownerFks.length, 37);
      await client.query(
        'CREATE TABLE "_g0_rehearsal_ledger" (name text PRIMARY KEY,sha256 text NOT NULL)',
      );
      async function applyCandidate(candidate: (typeof candidates)[number]) {
        const prior = (
          await client.query(
            'SELECT sha256 FROM "_g0_rehearsal_ledger" WHERE name=$1',
            [candidate.name],
          )
        ).rows[0];
        if (prior) {
          assert.equal(
            prior.sha256,
            candidate.sha256,
            'Candidate ledger drift',
          );
          return;
        }
        await client.query('BEGIN');
        try {
          await client.query(
            candidate.sql
              .replace(/^([\s\S]*?)BEGIN;/, '$1')
              .replace(/COMMIT;\s*$/, ''),
          );
          await client.query(
            'INSERT INTO "_g0_rehearsal_ledger" VALUES ($1,$2)',
            [candidate.name, candidate.sha256],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
      await applyCandidate(candidates[0]!);
      // A process/statement failure before commit must roll back the complete kernel step.
      await assert.rejects(
        client.query(candidates[1]!.sql.replace(/COMMIT;\s*$/, 'SELECT 1/0;')),
      );
      await client.query('ROLLBACK');
      assert.equal(
        (await client.query('SELECT to_regclass(\'"SharedCustody"\') AS table'))
          .rows[0].table,
        null,
      );
      assert.equal(
        (
          await client.query(
            "SELECT attnotnull FROM pg_attribute WHERE attrelid='\"Space\"'::regclass AND attname='ownerUserId'",
          )
        ).rows[0].attnotnull,
        true,
      );
      assert.deepEqual(
        await snapshot(client, schema, sourceTables),
        rowsBefore,
      );
      await applyCandidate(candidates[1]!);
      assert.deepEqual(
        await snapshot(client, schema, sourceTables),
        rowsBefore,
      );
      const fkAfter = (
        await client.query(
          "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace=$1::regnamespace AND contype='f' ORDER BY conname",
          [schema],
        )
      ).rows;
      for (const old of fkBefore)
        assert.deepEqual(
          fkAfter.find((r) => r.conname === old.conname),
          old,
          'Historical FK definition changed',
        );
      const history = (
        await client.query(
          'SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
        )
      ).rows;
      assert.deepEqual(
        history,
        baselineHashes.map((m) => ({
          migration_name: m.name,
          checksum: m.sha256,
        })),
      );
      // Exact-byte ledger makes repeat deployment a verified no-op, not SQL IF NOT EXISTS drift masking.
      const catalogBeforeRepeat = await tables(client, schema);
      for (const c of candidates) await applyCandidate(c);
      assert.deepEqual(await tables(client, schema), catalogBeforeRepeat);
      assert.deepEqual(
        await snapshot(client, schema, sourceTables),
        rowsBefore,
      );
      let negativeChecks = 0;
      async function rejects(work: () => Promise<unknown>, code = '23514') {
        await client.query('BEGIN');
        try {
          await work();
          await assert.rejects(
            client.query('COMMIT'),
            (error: unknown) =>
              !!error &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === code,
          );
        } catch (error) {
          if (
            !error ||
            typeof error !== 'object' ||
            !('code' in error) ||
            error.code !== code
          )
            throw error;
        } finally {
          await client.query('ROLLBACK');
        }
        negativeChecks++;
      }
      await rejects(() =>
        client.query(
          'INSERT INTO "Space" (id,kind,"updatedAt") VALUES ($1,\'SHARED\',now())',
          [randomUUID()],
        ),
      );
      await rejects(() =>
        client.query(
          'INSERT INTO "Space" (id,kind,"updatedAt") VALUES ($1,\'PERSONAL\',now())',
          [randomUUID()],
        ),
      );
      if (fixture) {
        phase = 'kernel constraints';
        const id = randomUUID(),
          actor = randomUUID(),
          access = randomUUID();
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO "SharedRetentionPolicy" VALUES ($1,$2,$3,clock_timestamp())',
          [
            'SYNTHETIC_REHEARSAL',
            { sharedRecoverySeconds: 2592000 },
            'TEST ONLY: not a deployment retention policy',
          ],
        );
        await client.query(
          'INSERT INTO "Space" (id,kind,"updatedAt") VALUES ($1,\'SHARED\',now())',
          [id],
        );
        await client.query(
          'INSERT INTO "SharedCustody" ("spaceId",kind,state,"primaryOwnerAccessId","retentionPolicyVersion") VALUES ($1,\'PROJECT\',\'ACTIVE\',$2,\'SYNTHETIC_REHEARSAL\')',
          [id, access],
        );
        await client.query(
          'INSERT INTO "AccessScope" (id,"spaceId",kind) VALUES ($1,$1,\'ROOT\')',
          [id],
        );
        await client.query(
          'INSERT INTO "SharedActor" (id,"spaceId","userId",state) VALUES ($1,$2,$3,\'ACTIVE\')',
          [actor, id, fixture.user],
        );
        await client.query(
          'INSERT INTO "ContextAccess" (id,"spaceId","scopeId","actorId",state,"memberRole","joinedAt") VALUES ($1,$2,$2,$3,\'ACTIVE\',\'ADMIN\',\'2026-10-30Z\')',
          [access, id, actor],
        );
        await client.query(
          'INSERT INTO "ContextAccessInterval" VALUES ($1,1,\'2026-10-30Z\',null)',
          [access],
        );
        const policy = {
          OWNER: ['task.read'],
          ADMIN: ['task.read'],
          MANAGER: ['task.read'],
          MEMBER: ['task.read'],
          VIEWER: ['task.read'],
        };
        await client.query(
          'INSERT INTO "ContextCapabilityPolicy" VALUES ($1,$1,1,$2,10000,10485760,$3,clock_timestamp(),$4)',
          [id, policy, actor, randomUUID()],
        );
        await client.query('COMMIT');
        await rejects(() =>
          client.query(
            'UPDATE "Space" SET kind=\'SHARED\',"ownerUserId"=null WHERE id=$1',
            [fixture.space],
          ),
        );
        await rejects(() =>
          client.query('DELETE FROM "SharedCustody" WHERE "spaceId"=$1', [id]),
        );
        await rejects(() =>
          client.query('DELETE FROM "Space" WHERE id=$1', [id]),
        );
        await rejects(() =>
          client.query(
            'UPDATE "SharedActor" SET "userId"=null,state=\'ERASED\',"erasedAt"=now() WHERE id=$1',
            [actor],
          ),
        );
        await rejects(() =>
          client.query(
            'UPDATE "ContextAccess" SET "memberRole"=null WHERE id=$1',
            [access],
          ),
        );
        await rejects(() =>
          client.query(
            'DELETE FROM "ContextAccessInterval" WHERE "accessId"=$1',
            [access],
          ),
        );
        await rejects(() =>
          client.query(
            'UPDATE "SharedCustody" SET state=\'CLOSING_GRACE\',"closureGeneration"=1 WHERE "spaceId"=$1',
            [id],
          ),
        );
        await rejects(() =>
          client.query(
            'INSERT INTO "Task" (id,"spaceId","createdByUserId",title,"updatedAt") VALUES ($1,$2,$3,\'No premature engine activation\',now())',
            [randomUUID(), id, fixture.user],
          ),
        );
        await rejects(() =>
          client.query(
            'INSERT INTO "ContextCapabilityPolicy" VALUES ($1,$1,2,$2,10000,10485760,$3,clock_timestamp(),$4)',
            [id, { ...policy, VIEWER: ['task.update'] }, actor, randomUUID()],
          ),
        );
        await rejects(() =>
          client.query(
            'INSERT INTO "ContextCapabilityPolicy" VALUES ($1,$1,2,$2,10000,10485760,$3,clock_timestamp(),$4)',
            [
              id,
              { ...policy, ADMIN: ['ownership.transfer'] },
              actor,
              randomUUID(),
            ],
          ),
        );
        await rejects(() =>
          client.query(
            'INSERT INTO "ContextCapabilityPolicy" VALUES ($1,$1,2,$2,10001,10485760,$3,clock_timestamp(),$4)',
            [id, policy, actor, randomUUID()],
          ),
        );
        await rejects(() =>
          client.query(
            'UPDATE "ContextCapabilityPolicy" SET "exportMaxRecords"=5 WHERE "spaceId"=$1',
            [id],
          ),
        );
        await rejects(
          () =>
            client.query(
              'INSERT INTO "ContextAccess" (id,"spaceId","scopeId","actorId",state,"joinedAt") VALUES ($1,$2,$3,$4,\'ACTIVE\',now())',
              [randomUUID(), id, fixture.space, actor],
            ),
          '23503',
        );
        await rejects(() =>
          client.query(
            'INSERT INTO "ResourceGrant" (id,"spaceId","scopeId","granteeAccessId","granteeGeneration","issuerAccessId","issuerGeneration",capabilities,"expiresAt") VALUES ($1,$2,$2,$3,1,$3,1,ARRAY[\'read\'],now()+interval \'1 day\')',
            [randomUUID(), id, access],
          ),
        );
        // Authoritative SQL closure shape permits an absent custodian only with matching durable work.
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO "SharedLifecycleJob" (id,"custodyId","spaceId",generation,state,"effectiveDepartureAt","recoveryDeadline","retentionPolicyVersion","nextAt") VALUES ($1,$2,$2,1,\'CLOSING_GRACE\',\'2026-10-30Z\',\'2026-10-30Z\'::timestamptz+interval \'720 hours\',\'SYNTHETIC_REHEARSAL\',now())',
          [randomUUID(), id],
        );
        await client.query(
          'UPDATE "ContextAccessInterval" SET "endedAt"=\'2026-10-30Z\' WHERE "accessId"=$1',
          [access],
        );
        await client.query(
          'UPDATE "ContextAccess" SET state=\'LEFT\',"endedAt"=\'2026-10-30Z\' WHERE id=$1',
          [access],
        );
        await client.query(
          'UPDATE "SharedCustody" SET state=\'CLOSING_GRACE\',"primaryOwnerAccessId"=null,"closureGeneration"=1 WHERE "spaceId"=$1',
          [id],
        );
        await client.query('COMMIT');
        assert.deepEqual(
          await snapshot(client, schema, sourceTables, true),
          rowsBefore,
        );
        // Owner cascade still applies only to a synthetic Personal account; rollback preserves it.
        const isolatedUser = randomUUID(),
          isolatedSpace = randomUUID();
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,\'Cascade fixture\',$2,now())',
          [isolatedUser, isolatedUser + '@example.test'],
        );
        await client.query(
          'INSERT INTO "Space" (id,"ownerUserId","updatedAt") VALUES ($1,$2,now())',
          [isolatedSpace, isolatedUser],
        );
        await client.query('DELETE FROM "User" WHERE id=$1', [isolatedUser]);
        assert.equal(
          (
            await client.query('SELECT 1 FROM "Space" WHERE id=$1', [
              isolatedSpace,
            ])
          ).rowCount,
          0,
        );
        await client.query('ROLLBACK');
      }
      assert.equal(hash(fs.readFileSync(bytesPath)), fileHash);
      results.push({
        populated,
        sourceTables: sourceTables.length,
        nonemptyTables: Object.values(rowsBefore).filter((r) => r.count > 0)
          .length,
        negativeChecks,
        interruptionRollback: 'PASS',
        rowAndFkPreservation: 'PASS',
        repeatLedger: 'PASS',
        fileBytes: 'UNCHANGED',
      });
    } finally {
      await client.end().catch(() => undefined);
      await sandbox.close();
    }
  }
  phase = 'configured database preservation';
  const after = await Promise.all(configured.map(protectedSnapshot));
  assert.deepEqual(
    after,
    before,
    'Configured database changed during rehearsal; inspect concurrent writers',
  );
  for (const m of baselineHashes)
    assert.equal(
      hash(fs.readFileSync('prisma/migrations/' + m.name + '/migration.sql')),
      m.sha256,
    );
  const report = {
    status: 'PASS',
    scope: 'isolated schemas only; no application activation',
    candidates: candidates.map(({ name, sha256 }) => ({ name, sha256 })),
    results,
    protectedDatabases: configured.length,
    configuredRowsConstraintsQueueMetadata: 'UNCHANGED',
    historicalMigrations: baselineHashes,
    applicationConcurrency: 'NOT RUN: belongs to P2-01',
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(folder, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  process.stdout.write(
    JSON.stringify(
      {
        ...report,
        historicalMigrations: baselineHashes.length,
        report: path.relative(process.cwd(), path.join(folder, 'report.json')),
      },
      null,
      2,
    ) + '\n',
  );
} catch (error) {
  const info = error as {
    code?: string;
    constraint?: string;
    message?: string;
    table?: string;
    column?: string;
  };
  process.stderr.write(
    JSON.stringify({
      status: 'FAILED',
      phase,
      code: info.code ?? 'ASSERTION',
      constraint: info.constraint ?? null,
      table: info.table,
      column: info.column,
      diagnostic: info.code ? undefined : info.message,
    }) + '\n',
  );
  process.exitCode = 1;
}
