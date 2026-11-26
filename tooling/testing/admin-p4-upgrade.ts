import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { migrationSandbox } from './migration-sandbox.ts';
import { reviewMigrations } from './migration-safety.ts';
export async function verifyAdminP4Upgrade() {
  const box = await migrationSandbox(process.env),
    folder = fs.mkdtempSync(path.resolve('.tools/admin-p4-upgrade-')),
    migrations = path.join(folder, 'migrations');
  fs.mkdirSync(migrations);
  const additions = [
      '202611260116_platform_admin_p4',
      '202611260117_p4_delivery_preferences',
      '202611260118_p4_audience_scope',
    ],
    names = reviewMigrations();
  fs.copyFileSync(
    'prisma/migrations/migration_lock.toml',
    path.join(migrations, 'migration_lock.toml'),
  );
  const config = path.join(folder, 'prisma.config.ts');
  fs.writeFileSync(
    config,
    `import{defineConfig}from'prisma/config';export default defineConfig({schema:${JSON.stringify(path.resolve('prisma/schema.prisma').replaceAll('\\', '/'))},migrations:{path:${JSON.stringify(migrations.replaceAll('\\', '/'))}},datasource:{url:process.env.DATABASE_URL!}});`,
  );
  const copy = (name: string) =>
    fs.cpSync(
      path.join('prisma/migrations', name),
      path.join(migrations, name),
      { recursive: true },
    );
  const deploy = () => {
    const r = spawnSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--config',
        config,
      ],
      { env: { ...process.env, DATABASE_URL: box.url }, encoding: 'utf8' },
    );
    assert.equal(
      r.status,
      0,
      'Owned P4 migration rehearsal failed; credentials withheld',
    );
  };
  try {
    names.filter((n) => !additions.includes(n)).forEach(copy);
    deploy();
    const user = randomUUID(),
      space = randomUUID();
    await box.query(
      'INSERT INTO "User"(id,name,email,"emailVerified","updatedAt")VALUES($1,\'P4 predecessor\',$2,true,now())',
      [user, user + '@example.test'],
    );
    await box.query(
      'INSERT INTO "UserSettings"("userId",timezone,"updatedAt")VALUES($1,\'UTC\',now())',
      [user],
    );
    await box.query(
      'INSERT INTO "Space"(id,"ownerUserId","updatedAt")VALUES($1,$2,now())',
      [space, user],
    );
    await box.query(
      'INSERT INTO "Task"(id,"spaceId","createdByUserId",title,"updatedAt")VALUES($1,$2,$3,\'Preserved Client task\',now())',
      [randomUUID(), space, user],
    );
    const tables = (
      await box.query(
        `SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename<>'_prisma_migrations' ORDER BY tablename`,
      )
    ).rows.map((r) => String(r.tablename));
    const snapshot = async () => {
      const rows: Record<string, string> = {};
      for (const name of tables) {
        const quoted = '"' + name.replaceAll('"', '""') + '"';
        rows[name] = JSON.stringify(
          (
            await box.query(
              `SELECT to_jsonb(t) AS row FROM ${quoted} t ORDER BY to_jsonb(t)::text`,
            )
          ).rows,
        );
      }
      return rows;
    };
    const before = await snapshot(),
      ledger = (
        await box.query(
          'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
        )
      ).rows,
      constraints = (
        await box.query(
          `SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=current_schema()::regnamespace ORDER BY conname`,
        )
      ).rows;
    for (const name of additions) {
      const sql = fs.readFileSync(
        path.join('prisma/migrations', name, 'migration.sql'),
        'utf8',
      );
      await box.query(
        `DO $p4rollback$ BEGIN ${sql
          .replace(/^\uFEFF/, '')
          .replace(/^BEGIN;/, '')
          .replace(
            /COMMIT;\s*$/,
            '',
          )} RAISE EXCEPTION 'simulated interruption'; EXCEPTION WHEN raise_exception THEN NULL; END $p4rollback$;`,
      );
      assert.deepEqual(await snapshot(), before);
      copy(name);
      deploy();
    }
    deploy();
    assert.deepEqual(await snapshot(), before);
    const afterLedger = (
      await box.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" WHERE migration_name<>ALL($1::text[]) ORDER BY migration_name',
        [additions],
      )
    ).rows;
    assert.deepEqual(afterLedger, ledger);
    const afterConstraints = (
      await box.query(
        `SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=current_schema()::regnamespace ORDER BY conname`,
      )
    ).rows;
    for (const c of constraints)
      assert(
        afterConstraints.some(
          (x) => x.conname === c.conname && x.definition === c.definition,
        ),
        'Historical constraint changed',
      );
    const fks = (
      await box.query(
        `SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype='f' AND c.connamespace=current_schema()::regnamespace`,
      )
    ).rows;
    fks.sort((a, b) =>
      a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1,
    );
    assert.equal(fks.length, 1249);
    assert.equal(
      createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
      '1c9526945ea43445b056b84a1280f2f8e229129d7ed2068c6fcbc9417240bb7c',
    );
    process.stdout.write(
      `PASS: P4 populated Client upgrade preserves ${tables.length} datasets, ${ledger.length} historical checksums and prior constraints; three interruption rollbacks, resume/repeat and 1,249-FK catalog verified.\n`,
    );
  } finally {
    await box.close();
    const relative = path.relative(path.resolve('.tools'), folder);
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      !path.basename(folder).startsWith('admin-p4-upgrade-')
    )
      throw new Error('Unsafe P4 fixture path');
    fs.rmSync(folder, { recursive: true });
  }
}
