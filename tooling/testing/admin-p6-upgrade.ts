import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { migrationSandbox } from './migration-sandbox.ts';
import { reviewMigrations } from './migration-safety.ts';
import {
  adminP6MigrationName,
  adminP6ScheduleMigrationName,
} from './reviewed-admin-p6-migration.ts';
export async function verifyAdminP6Upgrade() {
  const box = await migrationSandbox(process.env),
    folder = fs.mkdtempSync(path.resolve('.tools/admin-p6-upgrade-')),
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
      'Owned P6 migration rehearsal failed; connection configuration withheld',
    );
  };
  try {
    reviewMigrations()
      .filter((n) => n < adminP6MigrationName)
      .forEach(copy);
    deploy();
    const user = randomUUID(),
      space = randomUUID(),
      customer = randomUUID(),
      invoice = randomUUID(),
      admin = randomUUID();
    await box.query(
      'INSERT INTO "User"(id,name,email,"emailVerified","updatedAt")VALUES($1,\'P6 predecessor\',$2,true,now())',
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
      'INSERT INTO "Task"(id,"spaceId","createdByUserId",title,"updatedAt")VALUES($1,$2,$3,\'Preserved P5 task\',now())',
      [randomUUID(), space, user],
    );
    await box.query(
      'INSERT INTO "CommerceCustomer"(id,"spaceId",kind)VALUES($1,$2,\'PERSONAL\')',
      [customer, space],
    );
    await box.query(
      'INSERT INTO "CommerceInvoice"(id,"customerId",number,currency,state,"issuedAt")VALUES($1,$2,\'P6-UPGRADE-ISSUED\',\'USD\',\'ISSUED\',now())',
      [invoice, customer],
    );
    await box.query(
      'INSERT INTO "CommerceInvoiceVersion"("invoiceId",version,subtotal,total,description,calculation)VALUES($1,1,9007199254740993,9007199254740993,\'Preserved immutable financial history\',\'{}\')',
      [invoice],
    );
    await box.query(
      'INSERT INTO "AdminUser"(id,name,email,role,"twoFactorEnabled","mfaEnrolledAt","updatedAt")VALUES($1,\'P6 predecessor operator\',$2,\'SUPER_ADMIN\',true,now(),now())',
      [admin, admin + '@example.test'],
    );
    await box.query(
      'INSERT INTO "AdminSecurityApproval"(action,"requesterAdminId",input,reason,"expiresAt")VALUES(\'SECURITY_POLICY\',$1,\'{"action":"SECURITY_POLICY"}\',\'Preserved pending security request\',now()+interval \'15 minutes\')',
      [admin],
    );
    const tables = (
      await box.query(
        "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename<>'_prisma_migrations' ORDER BY tablename",
      )
    ).rows as { tablename: string }[];
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const { tablename } of tables)
        result[tablename] = (
          await box.query(
            `SELECT to_jsonb(t) row FROM "${tablename.replaceAll('"', '""')}" t ORDER BY to_jsonb(t)::text`,
          )
        ).rows;
      return result;
    };
    const before = await snapshot(),
      ledger = (
        await box.query(
          'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
        )
      ).rows;
    const constraints = async () =>
      (
        await box.query(
          'SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=current_schema()::regnamespace ORDER BY conname',
        )
      ).rows;
    const oldConstraints = await constraints(),
      sql = fs.readFileSync(
        'prisma/migrations/' + adminP6MigrationName + '/migration.sql',
        'utf8',
      );
    await box.query(
      `DO $p6rollback$ BEGIN ${sql.replace(/^BEGIN;/, '').replace(/COMMIT;\s*$/, '')} RAISE EXCEPTION 'simulated interruption'; EXCEPTION WHEN raise_exception THEN NULL; END $p6rollback$;`,
    );
    assert.equal(
      (
        await box.query(
          'SELECT to_regclass(\'"PlatformConfigDefinition"\') target',
        )
      ).rows[0]?.target,
      null,
    );
    assert.deepEqual(await snapshot(), before);
    copy(adminP6MigrationName);
    deploy();
    const definition = randomUUID(),
      version = randomUUID();
    await box.query(
      "INSERT INTO \"PlatformConfigDefinition\"(id,key,category)VALUES($1,'flag.upgrade.retained','FLAG')",
      [definition],
    );
    await box.query(
      'INSERT INTO "PlatformConfigVersion"(id,"definitionId",version,payload,"actorAdminId",reason,"startsAt")VALUES($1,$2,1,\'{"value":false,"rules":[]}\',$3,\'Preserved published configuration\',now())',
      [version, definition, admin],
    );
    const configBefore = (
      await box.query('SELECT to_jsonb(v) row FROM "PlatformConfigVersion" v')
    ).rows;
    const scheduleSql = fs.readFileSync(
      'prisma/migrations/' + adminP6ScheduleMigrationName + '/migration.sql',
      'utf8',
    );
    await box.query(
      `DO $p6schedule$ BEGIN ${scheduleSql.replace(/^BEGIN;/, '').replace(/COMMIT;\s*$/, '')} RAISE EXCEPTION 'simulated interruption'; EXCEPTION WHEN raise_exception THEN NULL; END $p6schedule$;`,
    );
    assert.equal(
      (
        await box.query(
          'SELECT to_regclass(\'"PlatformMaintenanceSchedule"\') target',
        )
      ).rows[0]?.target,
      null,
    );
    copy(adminP6ScheduleMigrationName);
    deploy();
    deploy();
    assert.deepEqual(
      (await box.query('SELECT to_jsonb(v) row FROM "PlatformConfigVersion" v'))
        .rows,
      configBefore,
    );
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
      (
        await box.query(
          'SELECT migration_name,checksum FROM "_prisma_migrations" WHERE migration_name<>ALL($1::text[]) ORDER BY migration_name',
          [[adminP6MigrationName, adminP6ScheduleMigrationName]],
        )
      ).rows,
      ledger,
    );
    const afterConstraints = await constraints(),
      expansions = [
        'AdminSecurityApproval_action_check',
        'AdminSecurityApproval_check2',
      ];
    for (const c of oldConstraints)
      if (!expansions.includes(c.conname))
        assert(
          afterConstraints.some(
            (a) => a.conname === c.conname && a.definition === c.definition,
          ),
          'Unreviewed prior constraint change',
        );
    for (const name of expansions) {
      const a = afterConstraints.find((c) => c.conname === name);
      assert(a?.definition.includes('CONFIG_PUBLICATION'));
      assert(a?.definition.includes('MFA_RECOVERY'));
      assert(a?.definition.includes('SECURITY_POLICY'));
    }
    await assert.rejects(
      box.query(
        'UPDATE "CommerceInvoiceVersion" SET description=\'rewrite denied\'',
      ),
    );
    await assert.rejects(
      box.query(
        "INSERT INTO \"AdminSecurityApproval\"(action,\"requesterAdminId\",\"approverAdminId\",state,input,reason,\"expiresAt\")VALUES('CONFIG_PUBLICATION',$1,$1,'APPROVED','{}','Must not self approve',now()+interval '15 minutes')",
        [admin],
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
    assert.equal(fks.length, 1325);
    assert.equal(
      createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
      'bfd87eee40804a75865e0a2c88a9edaca6e1bde241ca34bae153172c2a56c9eb',
    );
    process.stdout.write(
      `PASS: P6 populated P5 upgrade preserves ${tables.length} datasets, ${ledger.length} historical checksums, immutable money and all prior constraints except two reviewed approval expansions; both interruption rollback/resume/repeat, retained P6 versions and exact 1,325-FK catalog verified.\n`,
    );
  } finally {
    await box.close();
    const relative = path.relative(path.resolve('.tools'), folder);
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      !path.basename(folder).startsWith('admin-p6-upgrade-')
    )
      throw Error('Unsafe P6 fixture path');
    fs.rmSync(folder, { recursive: true });
  }
}
