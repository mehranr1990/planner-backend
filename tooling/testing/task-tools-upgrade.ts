import fs from 'node:fs';
import { verifyProjectExecutionUpgrade } from './project-execution-upgrade.ts';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import {
  taskToolsMigrationHashes,
  assertReviewedTaskToolsMigration,
} from './reviewed-task-tools-migrations.ts';
/** Continues the same owned populated M06 rehearsal; never touches development/production schemas. */
export async function verifyTaskToolsUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
  spaceId: string;
  actorId: string;
  accessId: string;
  recipientActorId: string;
  recipientAccessId: string;
}) {
  const {
    client,
    schema,
    spaceId: s,
    actorId: a,
    accessId: access,
    recipientAccessId: recipient,
    recipientActorId: recipientActor,
  } = input;
  const task = (
      await client.query<{ id: string }>(
        'SELECT "taskId" id FROM "ProjectTask" WHERE "projectId"=$1 LIMIT 1',
        [s],
      )
    ).rows[0]!.id,
    assignment = randomUUID();
  await client.query(
    'INSERT INTO "TaskAssignment" (id,"spaceId","scopeId","projectId","taskId",kind,"recipientAccessId","recipientGeneration","createdByActorId","issuerAccessId","issuerGeneration","selectedTaskRevision","creationKey",fingerprint) VALUES ($1,$2,$2,$2,$3,\'PRIMARY\',$4,1,$5,$6,1,1,$7,$8)',
    [assignment, s, task, recipient, a, access, '7'.repeat(64), '8'.repeat(64)],
  );
  await client.query(
    'INSERT INTO "SharedAssignmentNotification" (id,"spaceId","scopeId","assignmentId","recipientActorId",kind,"assignmentRevision") VALUES ($1,$2,$2,$3,$4,\'ASSIGNED\',1)',
    [randomUUID(), s, assignment, recipientActor],
  );
  const tables = (
    await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename<>'_prisma_migrations' ORDER BY tablename",
      [schema],
    )
  ).rows.map((r) => r.tablename);
  assert.equal(tables.length, 98);
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const t of tables)
      result[t] = (
        await client.query(
          `SELECT to_jsonb(t) row FROM "${t.replaceAll('"', '""')}" t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    return result;
  };
  const before = await snapshot(),
    history = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
  assert.equal(history.length, 33);
  const constraints = (
    await client.query<{
      table_name: string;
      conname: string;
      definition: string;
    }>(
      'SELECT c.relname table_name,con.conname,pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE con.connamespace=$1::regnamespace ORDER BY c.relname,con.conname',
      [schema],
    )
  ).rows;
  const names = Object.keys(taskToolsMigrationHashes).sort(),
    first = fs.readFileSync(
      'prisma/migrations/' + names[0] + '/migration.sql',
      'utf8',
    ),
    second = fs.readFileSync(
      'prisma/migrations/' + names[1] + '/migration.sql',
      'utf8',
    );
  assertReviewedTaskToolsMigration(names[0]!, first);
  assertReviewedTaskToolsMigration(names[1]!, second);
  await client.query(first.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
  assert.equal(
    (await client.query('SELECT to_regclass(\'"TaskField"\') relation')).rows[0]
      .relation,
    null,
  );
  assert.deepEqual(await snapshot(), before);
  input.copy(names[0]!);
  input.deploy();
  await client.query(second.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
  assert.equal(
    (await client.query('SELECT to_regclass(\'"TaskWorkflow"\') relation'))
      .rows[0].relation,
    null,
  );
  assert.deepEqual(await snapshot(), before);
  input.copy(names[1]!);
  const started = performance.now();
  input.deploy();
  const hardening = fs.readFileSync(
    'prisma/migrations/' + names[2] + '/migration.sql',
    'utf8',
  );
  assertReviewedTaskToolsMigration(names[2]!, hardening);
  await client.query(hardening.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int n FROM pg_trigger WHERE tgname='TaskFieldValue_no_update' AND tgrelid='\"TaskFieldValue\"'::regclass",
      )
    ).rows[0].n,
    0,
  );
  input.copy(names[2]!);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 33',
      )
    ).rows,
    history,
  );
  for (const con of constraints) {
    const rows = (
      await client.query(
        'SELECT pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE con.connamespace=$1::regnamespace AND c.relname=$2 AND con.conname=$3',
        [schema, con.table_name, con.conname],
      )
    ).rows;
    if (
      con.table_name === 'SharedUsageEntry' &&
      con.conname === 'SharedUsageEntry_feature_check'
    ) {
      assert.equal(rows.length, 1);
      for (const feature of [
        'shared.custody',
        'shared.membership',
        'task.shared',
        'goal.shared',
        'shared.resource-grant',
        'task.assignment',
        'task.field-version',
        'task.dependency',
        'task.reschedule-preview',
        'task.workflow-version',
      ])
        assert.ok(rows[0].definition.includes("'" + feature + "'"));
    } else assert.deepEqual(rows, [{ definition: con.definition }]);
  }
  const folder = path.resolve('.tools/p2-05-upgrade-' + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'report.json'),
    JSON.stringify(
      {
        tablesPreserved: 98,
        historicalMigrations: 33,
        constraintsCompared: constraints.length,
        populatedAssignmentsAndNotifications: 'PASS',
        interruptedBothMigrations: 'PASS',
        repeatDeploy: 'PASS',
        elapsedMs: Math.round(performance.now() - started),
        hashes: taskToolsMigrationHashes,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: P2-05 preserves 98 prior tables, populated assignments/notifications, all prior constraints except additive usage CHECK and 33 checksums; both M07 interruptions and repeat deploy.\n',
  );
  await verifyProjectExecutionUpgrade(input);
}
