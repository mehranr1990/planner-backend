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
  assert.equal(emptyTables.length, 28); // twenty-seven application/provider tables plus Prisma's ledger
  // Required reset capability is restricted to this disposable, newly-created namespace.
  await sandbox.resetOwnedSchema();
  const folder = path.resolve('.tools/migration-check-' + randomUUID());
  const migrations = path.join(folder, 'migrations');
  fs.mkdirSync(migrations, { recursive: true });
  for (const name of names.slice(
    0,
    names.indexOf('202610280004_p1_04_calendar'),
  ))
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
  const spaceId = randomUUID();
  const eventId = randomUUID();
  const auditId = randomUUID();
  await sandbox.query(
    `INSERT INTO "Space" (id,"ownerUserId","updatedAt") VALUES ($1,$2,now())`,
    [spaceId, id],
  );
  await sandbox.query(
    `INSERT INTO "OutboxEvent" (id,type,version,"aggregateId","spaceId",payload,"correlationId") VALUES ($1,'account.timezone_changed',1,$2,$3,'{}',$4)`,
    [eventId, id, spaceId, randomUUID()],
  );
  await sandbox.query(
    `INSERT INTO "SecurityAuditEvent" (id,action,outcome,"actorUserId","requestId","correlationId") VALUES ($1,'ACCOUNT_SETTINGS_UPDATE','SUCCEEDED',$2,$3,$4)`,
    [auditId, id, randomUUID(), randomUUID()],
  );
  await sandbox.query(
    `INSERT INTO "IdempotencyRecord" (id,"actorUserId","spaceId",operation,"keyHash",fingerprint,"resultId","statusCode","expiresAt",result) VALUES ($1,$2,$3,'migration.fixture',$4,$5,$6,200,now()+interval '1 day','{"fixture":true}')`,
    [randomUUID(), id, spaceId, 'a'.repeat(64), 'b'.repeat(64), eventId],
  );
  await sandbox.query(
    `INSERT INTO "UserSettings" ("userId",locale,timezone,revision,"updatedAt") VALUES ($1,'fa','Asia/Tehran',7,now())`,
    [id],
  );
  const storedFileId = randomUUID();
  await sandbox.query(
    `INSERT INTO "StoredFile" (id,"spaceId","ownerUserId","objectKey",filename,"mimeType","expectedSize","actualSize",sha256,status,revision,"uploadExpiresAt","updatedAt","completedAt") VALUES ($1,$2,$3,$4,'upgrade fixture.txt','text/plain',7,7,$5,'READY',4,now()+interval '1 day',now(),now())`,
    [storedFileId, spaceId, id, randomUUID(), 'c'.repeat(64)],
  );
  const taskId = randomUUID(),
    checklistId = randomUUID();
  await sandbox.query(
    `INSERT INTO "Task" (id,"spaceId","createdByUserId",title,status,revision,"updatedAt") VALUES ($1,$2,$3,'Previous schema Task','OPEN',3,now())`,
    [taskId, spaceId, id],
  );
  await sandbox.query(
    `INSERT INTO "TaskChecklistItem" (id,"spaceId","taskId",title,position,"updatedAt") VALUES ($1,$2,$3,'Preserved checklist',0,now())`,
    [checklistId, spaceId, taskId],
  );
  await sandbox.query(
    `INSERT INTO "TaskAttachment" ("spaceId","taskId","fileId") VALUES ($1,$2,$3)`,
    [spaceId, taskId, storedFileId],
  );
  await sandbox.query(
    `INSERT INTO "TaskChange" (id,"spaceId","taskId","actorUserId",kind,fields,"previousRevision",revision,"beforeStatus","afterStatus","beforePriority","afterPriority") VALUES ($1,$2,$3,$4,'UPDATED',ARRAY['title'],2,3,'OPEN','OPEN','NONE','NONE')`,
    [randomUUID(), spaceId, taskId, id],
  );
  const labelId = randomUUID();
  await sandbox.query(
    `INSERT INTO "Label" (id,"spaceId",name,revision,"updatedAt") VALUES ($1,$2,'Preserved label',2,now())`,
    [labelId, spaceId],
  );
  await sandbox.query(
    `INSERT INTO "TaskLabel" ("spaceId","taskId","labelId") VALUES ($1,$2,$3)`,
    [spaceId, taskId, labelId],
  );
  const masterId = randomUUID(),
    seriesId = randomUUID(),
    occurrenceId = randomUUID(),
    templateId = randomUUID(),
    filterId = randomUUID();
  const definition = {
    version: 1,
    startDate: '2026-10-28',
    endDate: null,
    localTime: '09:00',
    timezone: 'UTC',
    rule: { kind: 'DAILY', interval: 1 },
    exclusionDates: [],
  };
  const template = {
      version: 1,
      task: { title: 'Upgrade template' },
      checklist: [],
    },
    filter = { version: 1, where: { status: 'OPEN' } };
  await sandbox.query(
    `INSERT INTO "Task" (id,"spaceId","createdByUserId",title,"updatedAt") VALUES ($1,$2,$3,'Master fixture',now())`,
    [masterId, spaceId, id],
  );
  await sandbox.query(
    `INSERT INTO "TaskRecurrence" (id,"spaceId","createdByUserId","masterTaskId",definition,"identityTime",revision,"updatedAt") VALUES ($1,$2,$3,$4,$5,'09:00',4,now())`,
    [seriesId, spaceId, id, masterId, JSON.stringify(definition)],
  );
  await sandbox.query(
    `INSERT INTO "TaskOccurrence" (id,"spaceId","seriesId","taskId","recurrenceKey","localDate","localTime",timezone,"scheduledAt",state,revision,"updatedAt") VALUES ($1,$2,$3,$4,'2026-10-28T09:00:00','2026-10-28','09:00','UTC','2026-10-28T09:00:00Z','PENDING',2,now())`,
    [occurrenceId, spaceId, seriesId, taskId],
  );
  await sandbox.query(
    `INSERT INTO "TaskTemplate" (id,"spaceId","createdByUserId",name,"values",revision,"updatedAt") VALUES ($1,$2,$3,'Template fixture',$4,3,now())`,
    [templateId, spaceId, id, JSON.stringify(template)],
  );
  await sandbox.query(
    `INSERT INTO "SavedTaskFilter" (id,"spaceId","createdByUserId",name,query,revision,"updatedAt") VALUES ($1,$2,$3,'Filter fixture',$4,5,now())`,
    [filterId, spaceId, id, JSON.stringify(filter)],
  );
  const dayId = randomUUID(),
    weekId = randomUUID(),
    reviewId = randomUUID(),
    selectionId = randomUUID();
  const availability = {
    version: 1,
    minutesByWeekday: [0, 240, 300, 360, 420, 480, 0],
  };
  await sandbox.query(
    `UPDATE "UserSettings" SET "planningAvailability"=$2 WHERE "userId"=$1`,
    [id, JSON.stringify(availability)],
  );
  await sandbox.query(
    `INSERT INTO "DailyPlan" (id,"spaceId","createdByUserId","localDate",timezone,revision,"updatedAt") VALUES ($1,$2,$3,'2026-10-28','Asia/Tehran',5,now())`,
    [dayId, spaceId, id],
  );
  await sandbox.query(
    `INSERT INTO "DailyPlanItem" (id,"spaceId","planId","localDate","taskId",position,"plannedMinutes","selectedTaskRevision",revision,"updatedAt") VALUES ($1,$2,$3,'2026-10-28',$4,0,45,3,2,now())`,
    [selectionId, spaceId, dayId, taskId],
  );
  await sandbox.query(
    `INSERT INTO "WeeklyPlan" (id,"spaceId","createdByUserId","weekStartDate",timezone,"firstDayOfWeek",revision,"updatedAt") VALUES ($1,$2,$3,'2026-10-26','Asia/Tehran',1,4,now())`,
    [weekId, spaceId, id],
  );
  await sandbox.query(
    `INSERT INTO "PlanningReview" (id,"spaceId","createdByUserId","localDate",kind,timezone,"firstDayOfWeek",reflection,revision,"updatedAt") VALUES ($1,$2,$3,'2026-10-28','EVENING','Asia/Tehran',1,'Preserve private review',3,now())`,
    [reviewId, spaceId, id],
  );
  const preservedTables = [
    'User',
    'AuthAccount',
    'AuthSession',
    'AuthVerification',
    'Space',
    'UserSettings',
    'StoredFile',
    'Task',
    'TaskChecklistItem',
    'TaskAttachment',
    'TaskChange',
    'Label',
    'TaskLabel',
    'TaskRecurrence',
    'TaskOccurrence',
    'TaskTemplate',
    'SavedTaskFilter',
    'DailyPlan',
    'DailyPlanItem',
    'WeeklyPlan',
    'PlanningReview',
    'SecurityAuditEvent',
    'OutboxEvent',
    'IdempotencyRecord',
  ];
  const beforeSnapshots = new Map<string, unknown>();
  for (const table of preservedTables)
    beforeSnapshots.set(
      table,
      (
        await sandbox.query(
          `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
        )
      ).rows,
    );
  migrate(sandbox.url, 'deploy');
  migrate(sandbox.url, 'status');
  migrate(sandbox.url, 'deploy');
  for (const table of preservedTables)
    assert.deepEqual(
      (
        await sandbox.query(
          `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
        )
      ).rows,
      beforeSnapshots.get(table),
      `Preserved ${table} rows`,
    );
  const settings = (
    await sandbox.query(
      `SELECT locale,timezone,revision FROM "UserSettings" WHERE "userId"=$1`,
      [id],
    )
  ).rows;
  assert.deepEqual(settings, [
    { locale: 'fa', timezone: 'Asia/Tehran', revision: 7 },
  ]);
  assert.deepEqual(
    (
      await sandbox.query(
        `SELECT "planningAvailability" FROM "UserSettings" WHERE "userId"=$1`,
        [id],
      )
    ).rows[0].planningAvailability,
    availability,
  );
  assert.deepEqual(
    (
      await sandbox.query(
        `SELECT definition,revision FROM "TaskRecurrence" WHERE id=$1`,
        [seriesId],
      )
    ).rows,
    [{ definition, revision: 4 }],
  );
  assert.deepEqual(
    (
      await sandbox.query(
        `SELECT "taskId",state,revision FROM "TaskOccurrence" WHERE id=$1`,
        [occurrenceId],
      )
    ).rows,
    [{ taskId, state: 'PENDING', revision: 2 }],
  );
  assert.deepEqual(
    (
      await sandbox.query(
        `SELECT "values",revision FROM "TaskTemplate" WHERE id=$1`,
        [templateId],
      )
    ).rows,
    [{ values: template, revision: 3 }],
  );
  assert.deepEqual(
    (
      await sandbox.query(
        `SELECT query,revision FROM "SavedTaskFilter" WHERE id=$1`,
        [filterId],
      )
    ).rows,
    [{ query: filter, revision: 5 }],
  );
  assert.deepEqual(
    (
      await sandbox.query(
        `SELECT result FROM "IdempotencyRecord" WHERE "actorUserId"=$1`,
        [id],
      )
    ).rows,
    [{ result: { fixture: true } }],
  );
  assert.deepEqual(
    (
      await sandbox.query(
        `SELECT title,status,revision FROM "Task" WHERE id=$1`,
        [taskId],
      )
    ).rows,
    [{ title: 'Previous schema Task', status: 'OPEN', revision: 3 }],
  );
  assert.equal(
    (
      await sandbox.query(`SELECT title FROM "TaskChecklistItem" WHERE id=$1`, [
        checklistId,
      ])
    ).rows[0].title,
    'Preserved checklist',
  );
  assert.equal(
    (
      await sandbox.query(
        `SELECT "fileId" FROM "TaskAttachment" WHERE "taskId"=$1`,
        [taskId],
      )
    ).rows[0].fileId,
    storedFileId,
  );
  assert.equal(
    (await sandbox.query(`SELECT id FROM "OutboxEvent" WHERE id=$1`, [eventId]))
      .rows[0].id,
    eventId,
  );
  assert.equal(
    (
      await sandbox.query(
        `SELECT "resourceId" FROM "SecurityAuditEvent" WHERE id=$1`,
        [auditId],
      )
    ).rows[0].resourceId,
    null,
  );
  assert.equal(
    (
      await sandbox.query(
        `SELECT "resultId" FROM "IdempotencyRecord" WHERE "actorUserId"=$1`,
        [id],
      )
    ).rows[0].resultId,
    eventId,
  );
  assert.deepEqual(
    (
      await sandbox.query(
        `SELECT status,revision,"actualSize" FROM "StoredFile" WHERE id=$1`,
        [storedFileId],
      )
    ).rows,
    [{ status: 'READY', revision: 4, actualSize: 7 }],
  );
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
