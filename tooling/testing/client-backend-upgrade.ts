import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { migrationSandbox } from './migration-sandbox.ts';
import { reviewMigrations } from './migration-safety.ts';
import {
  clientBackendMigrationName,
  clientMaterializationMigrationName,
} from './reviewed-client-backend-migration.ts';

/** Populated P3→Client upgrade, confined to one newly owned test namespace. */
export async function verifyClientBackendUpgrade() {
  const box = await migrationSandbox(process.env);
  const folder = fs.mkdtempSync(path.resolve('.tools/client-upgrade-'));
  const migrations = path.join(folder, 'migrations');
  fs.mkdirSync(migrations);
  const names = reviewMigrations();
  const additions = [
    clientBackendMigrationName,
    clientMaterializationMigrationName,
    '202611250115_client_invitation_push_consent',
  ];
  const copy = (name: string) =>
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
    `import {defineConfig} from 'prisma/config'; export default defineConfig({schema:${JSON.stringify(path.resolve('prisma/schema.prisma').replaceAll('\\', '/'))},migrations:{path:${JSON.stringify(migrations.replaceAll('\\', '/'))}},datasource:{url:process.env.DATABASE_URL!}});`,
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
        'Owned Client migration rehearsal failed; credentials withheld',
      );
  };
  try {
    names.filter((name) => !additions.includes(name)).forEach(copy);
    deploy();
    const user = randomUUID(),
      space = randomUUID(),
      habit = randomUUID();
    await box.query(
      'INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,\'Client fixture\',$2,true,now())',
      [user, user + '@example.test'],
    );
    await box.query(
      'INSERT INTO "UserSettings" ("userId",timezone,"updatedAt") VALUES ($1,\'UTC\',now())',
      [user],
    );
    await box.query(
      'INSERT INTO "Space" (id,"ownerUserId","updatedAt") VALUES ($1,$2,now())',
      [space, user],
    );
    await box.query(
      'INSERT INTO "Habit" (id,"spaceId","createdByUserId",title,type,unit,purpose,"updatedAt") VALUES ($1,$2,$3,\'Original habit\',\'QUANTITY\',\'ML\',\'WATER\',now())',
      [habit, space, user],
    );
    const before = (
      await box.query(
        'SELECT id,"spaceId",title,type,unit,purpose,revision FROM "Habit" ORDER BY id',
      )
    ).rows;
    const ledger = (
      await box.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name',
      )
    ).rows;
    await box.query('BEGIN');
    try {
      for (const name of additions)
        await box.query(
          fs.readFileSync(
            path.join('prisma/migrations', name, 'migration.sql'),
            'utf8',
          ),
        );
    } finally {
      await box.query('ROLLBACK');
    }
    assert.equal(
      (
        await box.query(
          "SELECT count(*)::int n FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Habit' AND column_name='unitLabel'",
        )
      ).rows[0].n,
      0,
    );
    additions.forEach(copy);
    deploy();
    deploy();
    assert.deepEqual(
      (
        await box.query(
          'SELECT id,"spaceId",title,type,unit,purpose,revision FROM "Habit" ORDER BY id',
        )
      ).rows,
      before,
    );
    assert.equal(
      (
        await box.query(
          'SELECT timezone FROM "UserSettings" WHERE "userId"=$1',
          [user],
        )
      ).rows[0].timezone,
      'UTC',
    );
    assert.deepEqual(
      (
        await box.query(
          'SELECT category,"unitLabel","timeOfDay","preferredTime",icon,reminder FROM "Habit" WHERE id=$1',
          [habit],
        )
      ).rows[0],
      {
        category: null,
        unitLabel: null,
        timeOfDay: 'ANYTIME',
        preferredTime: null,
        icon: 'DEFAULT',
        reminder: null,
      },
    );
    assert.deepEqual(
      (
        await box.query(
          'SELECT migration_name,checksum FROM "_prisma_migrations" WHERE migration_name<>ALL($1::text[]) AND finished_at IS NOT NULL ORDER BY migration_name',
          [additions],
        )
      ).rows,
      ledger,
    );
    for (const [field, value] of [
      ['preferredTime', '25:00'],
      ['icon', 'arbitrary'],
      ['timeOfDay', 'NIGHT'],
    ])
      await assert.rejects(
        box.query(`UPDATE "Habit" SET "${field}"=$1 WHERE id=$2`, [
          value,
          habit,
        ]),
      );
    await assert.rejects(
      box.query('UPDATE "Habit" SET reminder=$1::jsonb WHERE id=$2', [
        JSON.stringify({ time: '09:00', ifNotDone: 'true' }),
        habit,
      ]),
    );
    const otherUser = randomUUID(),
      otherSpace = randomUUID();
    await box.query(
      'INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,\'Other fixture\',$2,now())',
      [otherUser, otherUser + '@example.test'],
    );
    await box.query(
      'INSERT INTO "Space" (id,"ownerUserId","updatedAt") VALUES ($1,$2,now())',
      [otherSpace, otherUser],
    );
    await assert.rejects(
      box.query(
        'INSERT INTO "Reminder" (id,"spaceId","ownerUserId","createdByUserId",title,rule,"timezoneMode",timezone,channels,"updatedAt","habitId") VALUES ($1,$2,$3,$3,\'Reminder\',\'{"version":1,"kind":"ABSOLUTE","at":"2026-11-25T12:00:00Z"}\',\'FIXED\',\'UTC\',ARRAY[\'IN_APP\'],now(),$4)',
        [randomUUID(), otherSpace, otherUser, habit],
      ),
      (error: unknown) =>
        (error as { constraint?: string }).constraint ===
        'Reminder_spaceId_habitId_fkey',
    );
    const fks = (
      await box.query(
        'SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype=\'f\' AND c.connamespace=(SELECT relnamespace FROM pg_class WHERE oid=to_regclass(\'"Space"\'))',
      )
    ).rows;
    fks.sort((a, b) =>
      a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1,
    );
    assert.equal(fks.length, 1206);
    assert.equal(
      createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
      '706787266edfd0e24cdc15f47ad8a3e060c663af4ccc390f42c39e0ad4d80266',
    );
    process.stdout.write(
      'PASS: Client populated P3 upgrade, rollback/resume/repeat, canonical units/legacy timezones, constraints and 1,206 reviewed FKs.\n',
    );
  } finally {
    await box.close();
    const relative = path.relative(path.resolve('.tools'), folder);
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      !path.basename(folder).startsWith('client-upgrade-')
    )
      throw new Error('Refusing unrelated fixture removal');
    fs.rmSync(folder, { recursive: true });
  }
}
