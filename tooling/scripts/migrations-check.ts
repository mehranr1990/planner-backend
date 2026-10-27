import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isolatedTestDatabaseUrl } from '../testing/test-database.ts';
import { migrationSandbox } from '../testing/migration-sandbox.ts';
import { reviewMigrations } from '../testing/migration-safety.ts';

const names = reviewMigrations();
const url = isolatedTestDatabaseUrl(process.env);
function migrate(
  databaseUrl: string,
  command: string,
  config = 'prisma.config.ts',
) {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      command,
      '--config',
      config,
    ],
    { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' },
  );
  if (result.status !== 0)
    throw new Error(
      `Isolated migration ${command} failed; credentials withheld.`,
    );
}
// Never reset the configured database. Validate deployed history and replay safety.
for (const command of ['deploy', 'status']) migrate(url, command);

const sandbox = await migrationSandbox(process.env);
try {
  migrate(sandbox.url, 'deploy');
  const emptyTables = (
    await sandbox.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename`,
    )
  ).rows;
  assert.equal(emptyTables.length, 10); // nine application/provider tables plus Prisma's ledger
  // Required reset capability is restricted to this disposable, newly-created namespace.
  await sandbox.resetOwnedSchema();
  const folder = path.resolve('.tools/migration-check-' + randomUUID());
  const migrations = path.join(folder, 'migrations');
  fs.mkdirSync(migrations, { recursive: true });
  for (const name of names.slice(0, -1))
    fs.cpSync(
      path.join('prisma/migrations', name),
      path.join(migrations, name),
      { recursive: true },
    );
  fs.copyFileSync(
    'prisma/migrations/migration_lock.toml',
    path.join(migrations, 'migration_lock.toml'),
  );
  const config = path.join(folder, 'prisma.config.ts');
  fs.writeFileSync(
    config,
    `import { defineConfig } from 'prisma/config';\nexport default defineConfig({schema:${JSON.stringify(path.resolve('prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:process.env.DATABASE_URL!}});\n`,
  );
  migrate(sandbox.url, 'deploy', config);
  const id = randomUUID();
  await sandbox.query(
    `INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,'Migration fixture','migration@example.test',true,now());`,
    [id],
  );
  await sandbox.query(
    `INSERT INTO "UserSettings" ("userId",locale,timezone,"updatedAt") VALUES ($1,'fa','Asia/Tehran',now())`,
    [id],
  );
  migrate(sandbox.url, 'deploy');
  migrate(sandbox.url, 'status');
  migrate(sandbox.url, 'deploy');
  const settings = (
    await sandbox.query(
      `SELECT locale,timezone,revision FROM "UserSettings" WHERE "userId"=$1`,
      [id],
    )
  ).rows;
  assert.deepEqual(settings, [
    { locale: 'fa', timezone: 'Asia/Tehran', revision: 1 },
  ]);
  assert.deepEqual(
    (
      await sandbox.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename`,
      )
    ).rows,
    emptyTables,
  );
  const history = await sandbox.query(
    `SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  );
  assert.equal(history.rows[0].count, names.length);
  process.stdout.write(
    'PASS: additive review, existing history/status, empty schema, disposable-schema reset, prior-schema upgrade with preserved data, repeat deploy. Configured databases never reset.\n',
  );
} finally {
  await sandbox.close();
}
