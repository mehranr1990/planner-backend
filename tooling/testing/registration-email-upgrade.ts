import {
  emailSubjectMigrationName,
  emailSubjectMigrationSha256,
} from './reviewed-registration-email-migration.ts';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { migrationSandbox } from './migration-sandbox.ts';
import { reviewMigrations } from './migration-safety.ts';
import {
  registrationEmailMigrationName as migration,
  registrationEmailMigrationSha256,
} from './reviewed-registration-email-migration.ts';

export async function verifyRegistrationEmailUpgrade() {
  const box = await migrationSandbox(process.env);
  const root = fs.mkdtempSync(
    path.resolve('.tools/registration-email-upgrade-'),
  );
  const migrations = path.join(root, 'migrations');
  fs.mkdirSync(migrations);
  fs.copyFileSync(
    'prisma/migrations/migration_lock.toml',
    path.join(migrations, 'migration_lock.toml'),
  );
  const config = path.join(root, 'prisma.config.ts');
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
      'Owned diagnostics migration rehearsal failed; credentials withheld',
    );
  };
  try {
    reviewMigrations()
      .filter((n) => n < migration)
      .forEach(copy);
    deploy();
    const registered = randomUUID(),
      legacy = randomUUID(),
      audit = randomUUID();
    for (const id of [registered, legacy]) {
      await box.query(
        `INSERT INTO "User"(id,name,email,"emailVerified","updatedAt") VALUES($1,'Synthetic predecessor',$2,true,now())`,
        [id, id + '@example.test'],
      );
      await box.query(
        `INSERT INTO "UserSettings"("userId","updatedAt") VALUES($1,now())`,
        [id],
      );
    }
    await box.query(
      `INSERT INTO "SecurityAuditEvent"(id,action,outcome,"actorUserId","requestId","correlationId") VALUES($1,'AUTH_SIGN_IN','SUCCEEDED',$2,$3,$4)`,
      [audit, registered, randomUUID(), randomUUID()],
    );
    await box.query(
      `INSERT INTO "AuthSession"(id,token,"userId","expiresAt","updatedAt") VALUES($1,$2,$3,now()+interval '1 day',now())`,
      [randomUUID(), randomUUID(), legacy],
    );
    const auditId = randomUUID(),
      deliveryId = randomUUID();
    await box.query(
      `INSERT INTO "AdminAuditEvent"(id,action,outcome,"requestId") VALUES($1,'DIAGNOSTIC_PREDECESSOR','SUCCEEDED',$2)`,
      [auditId, randomUUID()],
    );
    await box.query(
      `INSERT INTO "AdminDelivery"(id,"auditId","targetUserId",kind,payload,state,attempts) VALUES($1,$2,$3,'ACCOUNT_CHANGED','{}','SENT',2)`,
      [deliveryId, auditId, registered],
    );
    const tables = (
      await box.query(
        `SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename<>'_prisma_migrations' ORDER BY tablename`,
      )
    ).rows as { tablename: string }[];
    const stripped = new Map<string, string[]>([
      [
        'UserSettings',
        [
          'firstRecordedLoginAt',
          'lastRecordedLoginAt',
          'signInHistoryComplete',
          'signInEvidence',
          'emailVerifiedAt',
        ],
      ],
      ...[
        'ConversationEmailInvitation',
        'MeetingEmailInvitation',
        'AdminSecurityAlertDelivery',
        'AdminOperationalDelivery',
      ].map((n) => [n, ['createdAt']] as [string, string[]]),
    ]);
    const snapshot = async () => {
      const data: Record<string, string[]> = {};
      for (const { tablename } of tables) {
        const minus = (stripped.get(tablename) ?? [])
          .map((c) => ` - '${c}'`)
          .join('');
        data[tablename] = (
          await box.query(
            `SELECT (to_jsonb(t)${minus})::text data FROM "${tablename.replaceAll('"', '""')}" t ORDER BY 1`,
          )
        ).rows.map((r: { data: string }) => r.data);
      }
      return data;
    };
    const before = await snapshot();
    const history = (
      await box.query(
        `SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name`,
      )
    ).rows;
    const sql = fs.readFileSync(
      path.join('prisma/migrations', migration, 'migration.sql'),
      'utf8',
    );
    await assert.rejects(() =>
      box.query(
        sql.replace(
          'COMMIT;',
          "DO $$ BEGIN RAISE EXCEPTION 'synthetic interruption'; END $$; COMMIT;",
        ),
      ),
    );
    await box.query('ROLLBACK');
    assert.equal(
      (await box.query(`SELECT to_regclass('"SystemEmailObservation"') target`))
        .rows[0]?.target,
      null,
    );
    assert.deepEqual(await snapshot(), before);
    copy(migration);
    deploy();
    assert.deepEqual(await snapshot(), before);
    const diag = (
      await box.query(
        `SELECT "userId","firstRecordedLoginAt","lastRecordedLoginAt","signInHistoryComplete","signInEvidence","emailVerifiedAt" FROM "UserSettings" WHERE "userId" IN ($1,$2)`,
        [registered, legacy],
      )
    ).rows;
    const signed = diag.find((r) => r.userId === registered)!;
    assert.ok(signed.firstRecordedLoginAt && signed.lastRecordedLoginAt);
    assert.equal(signed.signInHistoryComplete, false);
    assert.equal(signed.signInEvidence, 'RETAINED_AUDIT');
    assert.equal(signed.emailVerifiedAt, null);
    const unknown = diag.find((r) => r.userId === legacy)!;
    assert.equal(unknown.lastRecordedLoginAt, null);
    assert.equal(unknown.signInEvidence, 'UNKNOWN');
    assert.equal(unknown.signInHistoryComplete, false);
    const afterHistory = (
      await box.query(
        `SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name`,
      )
    ).rows;
    assert.deepEqual(
      afterHistory.filter((r) => r.migration_name !== migration),
      history,
    );
    assert.equal(
      afterHistory.find((r) => r.migration_name === migration)?.checksum,
      registrationEmailMigrationSha256,
    );
    const observation = randomUUID();
    await box.query(
      `INSERT INTO "SystemEmailObservation"(id,"sourceKind","sourceId",category,recipient,"userId",state,code) VALUES($1,'DIRECT',$2,'SYSTEM_NOTICE',$3,$4,'SINK_ACCEPTED','SINK_ACCEPTED')`,
      [observation, randomUUID(), registered + '@example.test', registered],
    );
    copy(emailSubjectMigrationName);
    deploy();
    assert.equal(
      (
        await box.query(
          `SELECT "subjectUserId" FROM "SystemEmailObservation" WHERE id=$1`,
          [observation],
        )
      ).rows[0]?.subjectUserId,
      registered,
    );
    assert.equal(
      (
        await box.query(
          `SELECT checksum FROM "_prisma_migrations" WHERE migration_name=$1`,
          [emailSubjectMigrationName],
        )
      ).rows[0]?.checksum,
      emailSubjectMigrationSha256,
    );
    const transient = randomUUID(),
      detached = randomUUID();
    await box.query(
      `INSERT INTO "User"(id,name,email,"emailVerified","updatedAt")VALUES($1,'Synthetic erasure',$2,false,now())`,
      [transient, transient + '@example.test'],
    );
    await box.query(
      `INSERT INTO "SystemEmailObservation"(id,"sourceKind","sourceId",category,recipient,"subjectUserId",state)VALUES($1,'DIRECT',$2,'REGISTRATION_VERIFICATION',$3,$4,'PROCESSING')`,
      [detached, randomUUID(), 'old-' + transient + '@example.test', transient],
    );
    await box.query(`DELETE FROM "User" WHERE id=$1`, [transient]);
    assert.equal(
      (
        await box.query(
          `SELECT count(*)::int n FROM "SystemEmailObservation" WHERE id=$1`,
          [detached],
        )
      ).rows[0]?.n,
      0,
    );
    const fks = (
      await box.query(
        `SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype='f' AND c.connamespace=current_schema()::regnamespace`,
      )
    ).rows;
    fks.sort((a, b) =>
      a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1,
    );
    assert.equal(fks.length, 1331);
    assert.equal(
      createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
      'fd9bab48ca1951a86b8fd2a9b2d7d79d5219996cfe27f91edc2180e5284f987c',
    );
    deploy();
    assert.deepEqual(await snapshot(), before);
    process.stdout.write(
      `PASS: M129/M130 preserve ${tables.length} predecessor datasets and ${history.length} migration checksums; historical login/date UNKNOWN, retained audit evidence, interruption/resume/repeat, pre-commit subject/old-address erasure and exact 1331-FK catalog.\n`,
    );
  } finally {
    await box.close();
  }
}
