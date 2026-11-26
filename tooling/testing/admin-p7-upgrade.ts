import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { migrationSandbox } from './migration-sandbox.ts';
import { reviewMigrations } from './migration-safety.ts';
import {
  adminP7MigrationName,
  adminP7OrderMigrationName,
  adminP7FenceMigrationName,
  adminP7ContextMigrationName,
  adminP7FinancialMigrationName,
} from './reviewed-admin-p7-migration.ts';
export async function verifyAdminP7Upgrade() {
  const box = await migrationSandbox(process.env),
    folder = fs.mkdtempSync(path.resolve('.tools/admin-p7-upgrade-')),
    migrations = path.join(folder, 'migrations');
  fs.mkdirSync(migrations);
  fs.copyFileSync(
    'prisma/migrations/migration_lock.toml',
    path.join(migrations, 'migration_lock.toml'),
  );
  const config = path.join(folder, 'prisma.config.ts');
  fs.writeFileSync(
    config,
    `import{defineConfig}from'prisma/config';export default defineConfig({schema:${JSON.stringify(path.resolve('prisma/schema.prisma').replaceAll('\\', '/'))},migrations:{path:${JSON.stringify(migrations.replaceAll('\\', '/'))}},datasource:{url:process.env.DATABASE_URL!}});`,
  );
  const copy = (n: string) =>
    fs.cpSync(path.join('prisma/migrations', n), path.join(migrations, n), {
      recursive: true,
    });
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
      'Owned P7 migration rehearsal failed; credentials withheld',
    );
  };
  try {
    reviewMigrations()
      .filter((n) => n < adminP7MigrationName)
      .forEach(copy);
    deploy();
    const user = randomUUID(),
      space = randomUUID(),
      admin = randomUUID(),
      definition = randomUUID(),
      customer = randomUUID(),
      invoice = randomUUID();
    await box.query(
      `INSERT INTO "User"(id,name,email,"emailVerified","updatedAt") VALUES($1,'Synthetic P7 predecessor',$2,true,now())`,
      [user, user + '@example.test'],
    );
    await box.query(
      `INSERT INTO "Space"(id,"ownerUserId","updatedAt")VALUES($1,$2,now())`,
      [space, user],
    );
    await box.query(
      `INSERT INTO "Task"(id,"spaceId","createdByUserId",title,"updatedAt")VALUES($1,$2,$3,'Preserved predecessor task',now())`,
      [randomUUID(), space, user],
    );
    await box.query(
      `INSERT INTO "AdminUser"(id,name,email,role,"twoFactorEnabled","mfaEnrolledAt","updatedAt")VALUES($1,'Synthetic P7 operator',$2,'SUPER_ADMIN',true,now(),now())`,
      [admin, admin + '@example.test'],
    );
    await box.query(
      `INSERT INTO "PlatformConfigDefinition"(id,key,category)VALUES($1,'flag.p7-upgrade','FLAG')`,
      [definition],
    );
    await box.query(
      `INSERT INTO "PlatformConfigVersion"("definitionId",version,payload,"actorAdminId",reason,"startsAt")VALUES($1,1,'{"value":true,"rules":[],"startsAt":"2026-01-01T00:00:00Z","expiresAt":null}',$2,'Preserved P6 immutable configuration',now())`,
      [definition, admin],
    );
    await box.query(
      `INSERT INTO "CommerceCustomer"(id,"spaceId",kind)VALUES($1,$2,'PERSONAL')`,
      [customer, space],
    );
    await box.query(
      `INSERT INTO "CommerceInvoice"(id,"customerId",number,currency,state,"issuedAt")VALUES($1,$2,'P7-UPGRADE','USD','ISSUED',now())`,
      [invoice, customer],
    );
    await box.query(
      `INSERT INTO "CommerceInvoiceVersion"("invoiceId",version,subtotal,total,description,calculation)VALUES($1,1,9007199254740993,9007199254740993,'Preserved immutable money','{}')`,
      [invoice],
    );
    const tables = (
      await box.query(
        `SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename<>'_prisma_migrations' ORDER BY tablename`,
      )
    ).rows as { tablename: string }[];
    const snapshot = async () => {
      const output: Record<string, unknown> = {};
      for (const { tablename } of tables)
        output[tablename] = (
          await box.query(
            `SELECT to_jsonb(t) row FROM "${tablename.replaceAll('"', '""')}" t ORDER BY to_jsonb(t)::text`,
          )
        ).rows;
      return output;
    };
    const before = await snapshot(),
      ledger = (
        await box.query(
          'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
        )
      ).rows;
    const constraints = (
      await box.query(
        'SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=current_schema()::regnamespace ORDER BY conname',
      )
    ).rows;
    const sql = fs.readFileSync(
      'prisma/migrations/' + adminP7MigrationName + '/migration.sql',
      'utf8',
    );
    await box.query(
      `DO $p7rollback$ BEGIN ${sql} RAISE EXCEPTION 'synthetic interruption'; EXCEPTION WHEN raise_exception THEN NULL; END $p7rollback$;`,
    );
    assert.equal(
      (await box.query(`SELECT to_regclass('"ProductAnalyticsPolicy"') target`))
        .rows[0]?.target,
      null,
    );
    assert.deepEqual(await snapshot(), before);
    copy(adminP7MigrationName);
    deploy();
    for (const name of [
      adminP7OrderMigrationName,
      adminP7FenceMigrationName,
      adminP7ContextMigrationName,
    ]) {
      const functions = async () =>
        (
          await box.query(
            "SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname LIKE 'product_analytics_%' ORDER BY proname",
          )
        ).rows;
      const beforeConstraints = (
        await box.query(
          'SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=current_schema()::regnamespace ORDER BY conname',
        )
      ).rows;
      const beforeFunctions = await functions(),
        step = fs.readFileSync(
          'prisma/migrations/' + name + '/migration.sql',
          'utf8',
        );
      await box.query(
        'DO $p7step$ BEGIN ' +
          step +
          " RAISE EXCEPTION 'synthetic interruption'; EXCEPTION WHEN raise_exception THEN NULL; END $p7step$;",
      );
      assert.deepEqual(await functions(), beforeFunctions);
      assert.deepEqual(
        (
          await box.query(
            'SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=current_schema()::regnamespace ORDER BY conname',
          )
        ).rows,
        beforeConstraints,
      );
      assert.deepEqual(await snapshot(), before);
      copy(name);
      deploy();
    }
    const legacyReport = randomUUID();
    await box.query(
      `INSERT INTO "ProductAnalyticsReport"(id,"adminId",filter,format,"expiresAt")VALUES($1,$2,'{"from":"2026-01-01T00:00:00Z","to":"2026-01-02T00:00:00Z"}','JSON',now()+interval '7 days')`,
      [legacyReport, admin],
    );
    const columnSql = fs.readFileSync(
      'prisma/migrations/' + adminP7FinancialMigrationName + '/migration.sql',
      'utf8',
    );
    await box.query(
      'DO $p7financial$ BEGIN ' +
        columnSql +
        " RAISE EXCEPTION 'synthetic interruption'; EXCEPTION WHEN raise_exception THEN NULL; END $p7financial$;",
    );
    assert.equal(
      (
        await box.query(
          `SELECT count(*)::int n FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='ProductAnalyticsReport' AND column_name='type'`,
        )
      ).rows[0]?.n,
      0,
    );
    copy(adminP7FinancialMigrationName);
    deploy();
    deploy();
    assert.equal(
      (
        await box.query(
          'SELECT type FROM "ProductAnalyticsReport" WHERE id=$1',
          [legacyReport],
        )
      ).rows[0]?.type,
      'PRODUCT',
    );
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
      (
        await box.query(
          'SELECT migration_name,checksum FROM "_prisma_migrations" WHERE migration_name<>ALL($1::text[]) ORDER BY migration_name',
          [
            [
              adminP7MigrationName,
              adminP7OrderMigrationName,
              adminP7FenceMigrationName,
              adminP7ContextMigrationName,
              adminP7FinancialMigrationName,
            ],
          ],
        )
      ).rows,
      ledger,
    );
    const afterConstraints = (
      await box.query(
        'SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=current_schema()::regnamespace ORDER BY conname',
      )
    ).rows;
    for (const old of constraints)
      assert.ok(
        afterConstraints.some(
          (row) =>
            row.conname === old.conname && row.definition === old.definition,
        ),
      );
    const fks = (
      await box.query(
        `SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype='f' AND c.connamespace=current_schema()::regnamespace`,
      )
    ).rows;
    fks.sort((a, b) =>
      a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1,
    );
    assert.equal(fks.length, 1329);
    assert.equal(
      createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
      '2a50bd949621a3ed30c7fac0e96333a78160a2b1fade7b7938dce6cfa37f3915',
    );
    await box.query(
      `INSERT INTO "ProductAnalyticsEvent"(id,"userId","spaceId","workspaceType",name,version,feature,meaningful)VALUES($1,$2,$3,'PERSONAL','task.created',1,'tasks',true)`,
      [randomUUID(), user, space],
    );
    await box.query(
      `INSERT INTO "ProductAnalyticsAggregate"(day,"workspaceType",feature,users,events)VALUES(current_date,'PERSONAL','tasks',5,5)`,
    );
    await box.query(`DELETE FROM "ProductAnalyticsEvent" WHERE "userId"=$1`, [
      user,
    ]);
    assert.equal(
      (
        await box.query(
          'SELECT count(*)::int n FROM "ProductAnalyticsAggregate"',
        )
      ).rows[0]?.n,
      0,
    );
    process.stdout.write(
      `PASS: P7 populated P6 upgrade preserves ${tables.length} predecessor datasets, ${ledger.length} checksums, P5 money, immutable P6 versions and every prior constraint; rollback/resume/repeat and 1,329 FKs verified.\n`,
    );
  } finally {
    await box.close();
    const relative = path.relative(path.resolve('.tools'), folder);
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      !path.basename(folder).startsWith('admin-p7-upgrade-')
    )
      throw Error('Unsafe P7 fixture path');
    fs.rmSync(folder, { recursive: true });
  }
}
