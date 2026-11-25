import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { migrationSandbox } from './migration-sandbox.ts';
import { reviewMigrations } from './migration-safety.ts';
import {
  adminP3MigrationName,
  assertReviewedAdminP3Migration,
} from './reviewed-admin-p3-migration.ts';

/** Fresh owned schema only: populated P2 preservation and exact P3 rollback/resume. */
export async function verifyAdminP3Upgrade() {
  const box = await migrationSandbox(process.env),
    folder = path.resolve('.tools/admin-p3-upgrade-' + randomUUID()),
    migrations = path.join(folder, 'migrations');
  const names = reviewMigrations();
  assert.equal(names.at(-1), adminP3MigrationName);
  fs.mkdirSync(migrations, { recursive: true });
  const config = path.join(folder, 'prisma.config.ts');
  fs.writeFileSync(
    config,
    `import {defineConfig} from 'prisma/config'; export default defineConfig({schema:${JSON.stringify(path.resolve('prisma/schema.prisma').replaceAll('\\', '/'))},migrations:{path:${JSON.stringify(migrations.replaceAll('\\', '/'))}},datasource:{url:process.env.DATABASE_URL!}});`,
  );
  fs.copyFileSync(
    'prisma/migrations/migration_lock.toml',
    path.join(migrations, 'migration_lock.toml'),
  );
  const copy = (name: string) =>
    fs.cpSync(
      path.join('prisma/migrations', name),
      path.join(migrations, name),
      { recursive: true },
    );
  const deploy = () => {
    const result = spawnSync(
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
    if (result.status !== 0)
      throw new Error(
        'P3 owned-schema rehearsal deployment failed (credentials withheld)',
      );
  };
  try {
    names.filter((n) => n !== adminP3MigrationName).forEach(copy);
    deploy();
    const user = randomUUID(),
      space = randomUUID(),
      file = randomUUID(),
      admin = randomUUID(),
      audit = randomUUID();
    await box.query(
      'INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,\'P3 upgrade fixture\',$2,true,now())',
      [user, 'upgrade-' + user + '@example.test'],
    );
    await box.query(
      'INSERT INTO "UserSettings" ("userId","updatedAt") VALUES ($1,now())',
      [user],
    );
    await box.query(
      'INSERT INTO "Space" (id,"ownerUserId","updatedAt") VALUES ($1,$2,now())',
      [space, user],
    );
    await box.query(
      'INSERT INTO "StoredFile" (id,"spaceId","ownerUserId","objectKey",filename,"mimeType","expectedSize","actualSize",sha256,status,revision,"uploadExpiresAt","completedAt","updatedAt") VALUES ($1,$2,$3,$4,\'fixture.txt\',\'text/plain\',7,7,$5,\'READY\',4,now()+interval \'1 hour\',now(),now())',
      [file, space, user, randomUUID(), 'a'.repeat(64)],
    );
    await box.query(
      'INSERT INTO "StoredFileScan" ("fileId",sha256,engine,"scannedAt") VALUES ($1,$2,\'synthetic\',now())',
      [file, 'a'.repeat(64)],
    );
    await box.query(
      'INSERT INTO "AdminUser" (id,name,email,"updatedAt") VALUES ($1,\'P3 upgrade Admin\',$2,now())',
      [admin, 'upgrade-admin-' + admin + '@example.test'],
    );
    await box.query(
      'INSERT INTO "AdminAuditEvent" (id,action,outcome,"actorAdminId","requestId") VALUES ($1,\'P2_UPGRADE_FIXTURE\',\'SUCCEEDED\',$2,$3)',
      [audit, admin, randomUUID()],
    );
    const columns = (
      await box.query(
        "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position",
      )
    ).rows;
    const tables = new Map<string, string[]>();
    for (const c of columns) {
      assert.match(c.table_name, /^[A-Za-z][A-Za-z0-9_]*$/);
      assert.match(c.column_name, /^[A-Za-z][A-Za-z0-9_]*$/);
      tables.set(c.table_name, [
        ...(tables.get(c.table_name) ?? []),
        c.column_name,
      ]);
    }
    const snapshot = async () => {
      const digests: Record<string, string> = {};
      for (const [table, fields] of tables) {
        const result = await box.query(
          `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) rows FROM (SELECT ${fields.map((c) => '"' + c + '"').join(',')} FROM "${table}") t`,
        );
        digests[table] = createHash('sha256')
          .update(JSON.stringify(result.rows[0].rows))
          .digest('hex');
      }
      return digests;
    };
    const before = await snapshot(),
      ledger = (
        await box.query(
          'SELECT * FROM "_prisma_migrations" ORDER BY migration_name',
        )
      ).rows;
    const sql = fs.readFileSync(
      `prisma/migrations/${adminP3MigrationName}/migration.sql`,
      'utf8',
    );
    assertReviewedAdminP3Migration(sql);
    await box.query('BEGIN');
    try {
      await box.query(
        sql.slice(sql.indexOf('BEGIN;') + 6, sql.lastIndexOf('COMMIT;')),
      );
    } finally {
      await box.query('ROLLBACK');
    }
    assert.equal(
      (await box.query('SELECT to_regclass(\'"AdminOperationalPolicy"\') name'))
        .rows[0].name,
      null,
    );
    assert.deepEqual(await snapshot(), before);
    copy(adminP3MigrationName);
    deploy();
    deploy();
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
      (
        await box.query(
          'SELECT * FROM "_prisma_migrations" WHERE migration_name<>$1 ORDER BY migration_name',
          [adminP3MigrationName],
        )
      ).rows,
      ledger,
    );
    assert.equal(
      (
        await box.query(
          'SELECT "targetFileId" FROM "AdminAuditEvidence" WHERE "eventId"=$1',
          [audit],
        )
      ).rows[0].targetFileId,
      null,
    );
    const fks = (
      await box.query(
        'SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype=\'f\' AND c.connamespace=(SELECT relnamespace FROM pg_class WHERE oid=to_regclass(\'"Space"\'))',
      )
    ).rows;
    fks.sort((a, b) =>
      a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1,
    );
    assert.equal(fks.length, 1198);
    assert.equal(
      createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
      '9077bb4de8abcd51704d71cabee07adfa375e46bf6087f3e6b79953b155755f5',
    );
    process.stdout.write(
      `PASS: P3 rollback/resume/repeat; ${tables.size} P2 table data sets, ${ledger.length} historical ledger rows and 1,198 reviewed FKs preserved.\n`,
    );
  } finally {
    await box.close();
    if (
      !folder.startsWith(path.resolve('.tools') + path.sep) ||
      !path.basename(folder).startsWith('admin-p3-upgrade-')
    )
      throw new Error('Unsafe fixture path');
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
