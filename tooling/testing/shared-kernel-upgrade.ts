import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { migrationSandbox } from './migration-sandbox.ts';
import { isolatedTestDatabaseUrl } from './test-database.ts';
import { seedG0Personal } from './g0-personal-fixture.ts';

/** Actual promoted artifacts, populated P1-12, rollback of interrupted kernel, repeat deployment. */
export async function verifySharedKernelUpgrade(names: string[]) {
  const sandbox = await migrationSandbox(process.env),
    schema = new URL(sandbox.url).searchParams.get('schema')!;
  const folder = path.resolve('.tools/p2-upgrade-' + randomUUID()),
    migrations = path.join(folder, 'migrations'),
    config = path.join(folder, 'prisma.config.ts');
  fs.mkdirSync(migrations, { recursive: true });
  fs.copyFileSync(
    'prisma/migrations/migration_lock.toml',
    path.join(migrations, 'migration_lock.toml'),
  );
  fs.writeFileSync(
    config,
    `import {defineConfig} from 'prisma/config';\nexport default defineConfig({schema:${JSON.stringify(path.resolve('prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:process.env.DATABASE_URL!}});\n`,
  );
  const copy = (name: string) =>
    fs.cpSync(
      path.join('prisma/migrations', name),
      path.join(migrations, name),
      { recursive: true },
    );
  function deploy() {
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--config',
        config,
      ],
      { env: { ...process.env, DATABASE_URL: sandbox.url }, encoding: 'utf8' },
    );
    if (result.status !== 0)
      throw new Error(
        'Populated shared kernel upgrade failed (credentials withheld)',
      );
  }
  const client = new Client({
    connectionString: isolatedTestDatabaseUrl(process.env),
  });
  try {
    assert.equal(names.indexOf('202611040001_shared_space_kind'), 24);
    names.slice(0, 24).forEach(copy);
    deploy();
    await client.connect();
    await client.query(`SET search_path TO "${schema}"`);
    await seedG0Personal(client);
    const tables = (
      await client.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename<>'_prisma_migrations' ORDER BY tablename",
        [schema],
      )
    ).rows.map((t) => t.tablename);
    assert.equal(tables.length, 67);
    // Compare every pre-upgrade column; later additive columns are checked by
    // their own migration acceptance rather than mistaken for changed old data.
    const columns: Record<string, string> = {};
    for (const table of tables)
      columns[table] = (
        await client.query<{ column_name: string }>(
          'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',
          [schema, table],
        )
      ).rows
        .map((r) => '"' + r.column_name + '"')
        .join(',');
    async function snapshot() {
      const result: Record<string, unknown> = {};
      for (const table of tables)
        result[table] = (
          await client.query(
            `SELECT to_jsonb(t) AS row FROM (SELECT ${columns[table]} FROM "${table}") t ORDER BY to_jsonb(t)::text`,
          )
        ).rows;
      return result;
    }
    const rows = await snapshot(),
      fks = (
        await client.query(
          `SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE contype='f' AND connamespace=$1::regnamespace ORDER BY conname`,
          [schema],
        )
      ).rows;
    assert.equal(fks.length, 139);
    const checksums = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
    copy(names[24]!);
    deploy();
    const kernel = fs.readFileSync(
      'prisma/migrations/' + names[25] + '/migration.sql',
      'utf8',
    );
    await client.query(kernel.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
    assert.equal(
      (
        await client.query(
          'SELECT to_regclass(\'"SharedCustody"\') AS relation',
        )
      ).rows[0].relation,
      null,
    );
    names.slice(25).forEach(copy);
    deploy();
    deploy();
    assert.deepEqual(await snapshot(), rows);
    for (const fk of fks) {
      const current = (
        await client.query(
          'SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=$1::regnamespace AND conname=$2',
          [schema, fk.conname],
        )
      ).rows;
      // This rehearsal deploys the entire current history. M09 changes only
      // these three FK timings; retain exact targets, columns and actions.
      const transferTiming =
        names.includes('202611050018_personal_project_transfer') &&
        [
          'TaskChange_spaceId_taskId_fkey',
          'TaskChange_scope_fk',
          'Goal_spaceId_id_metricId_fkey',
        ].includes(fk.conname);
      assert.deepEqual(current, [
        { definition: fk.definition + (transferTiming ? ' DEFERRABLE' : '') },
      ]);
    }
    assert.deepEqual(
      (
        await client.query(
          'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 24',
        )
      ).rows,
      checksums,
    );
    const functions = (
      await client.query<{ proconfig: string[] }>(
        "SELECT proconfig FROM pg_proc WHERE pronamespace=$1::regnamespace AND proname LIKE 'shared_%'",
        [schema],
      )
    ).rows;
    assert.ok(
      functions.length > 0 &&
        functions.every((f) => f.proconfig.includes('search_path=' + schema)),
    );
    const manifest = names.slice(24).map((name) => ({
      name,
      sha256: createHash('sha256')
        .update(fs.readFileSync('prisma/migrations/' + name + '/migration.sql'))
        .digest('hex'),
    }));
    fs.writeFileSync(
      path.join(folder, 'report.json'),
      JSON.stringify(
        {
          tables: tables.length,
          foreignKeys: fks.length,
          historicalMigrations: checksums.length,
          populatedUpgrade: 'PASS',
          interruptedKernelRollback: 'PASS',
          repeatDeploy: 'PASS',
          pinnedFunctionPaths: 'PASS',
          manifest,
        },
        null,
        2,
      ) + '\n',
    );
    process.stdout.write(
      'PASS: promoted P2 artifacts preserve all 67 P1-12 tables from a populated fixture, 139 foreign keys and 24 migration checksums; interrupted kernel rollback, resume and repeat deployment.\n',
    );
  } finally {
    await client.end();
    await sandbox.close();
  }
}
