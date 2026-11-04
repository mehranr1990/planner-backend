import fs from 'node:fs';
import { verifyTaskToolsUpgrade } from './task-tools-upgrade.ts';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import {
  assignmentMigrationName,
  assignmentMigrationHash,
  assertReviewedAssignmentMigration,
} from './reviewed-assignment-migration.ts';
/** Extends the owned populated M05 rehearsal with a populated M05 -> M06 gate. */
export async function verifyAssignmentUpgrade(input: {
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
    recipientActorId: recipient,
    recipientAccessId: recipientAccess,
  } = input;
  const task = randomUUID(),
    goal = randomUUID(),
    phase = randomUUID(),
    section = randomUUID(),
    milestone = randomUUID();
  await client.query('BEGIN');
  await client.query(
    'INSERT INTO "Project" (id,"spaceId","scopeId","createdByActorId",title,"creationKey","creationFingerprint") VALUES ($1,$1,$1,$2,\'Populated prior Project\',$3,$4)',
    [s, a, '1'.repeat(64), '2'.repeat(64)],
  );
  await client.query(
    'INSERT INTO "ProjectPhase" (id,"spaceId","scopeId","projectId",title) VALUES ($1,$2,$2,$2,\'Prior phase\')',
    [phase, s],
  );
  await client.query(
    'INSERT INTO "ProjectSection" (id,"spaceId","scopeId","projectId","phaseId",title) VALUES ($1,$2,$2,$2,$3,\'Prior section\')',
    [section, s, phase],
  );
  await client.query(
    'INSERT INTO "ProjectMilestone" (id,"spaceId","scopeId","projectId","phaseId",title) VALUES ($1,$2,$2,$2,$3,\'Prior milestone\')',
    [milestone, s, phase],
  );
  await client.query(
    'INSERT INTO "Task" (id,"spaceId","scopeId","createdByActorId",title,"updatedAt") VALUES ($1,$2,$2,$3,\'Prior shared Task\',clock_timestamp())',
    [task, s, a],
  );
  await client.query(
    'INSERT INTO "TaskChange" (id,"spaceId","scopeId","taskId","actorId",kind,fields,"previousRevision",revision,"afterStatus","afterPriority") VALUES ($1,$2,$2,$3,$4,\'CREATED\',ARRAY[\'title\'],0,1,\'OPEN\',\'NONE\')',
    [randomUUID(), s, task, a],
  );
  await client.query(
    'INSERT INTO "Goal" (id,"spaceId","scopeId","createdByActorId",title,horizon,timezone,"updatedAt") VALUES ($1,$2,$2,$3,\'Prior shared Goal\',\'SHORT_TERM\',\'UTC\',clock_timestamp())',
    [goal, s, a],
  );
  await client.query(
    'INSERT INTO "ProjectTask" ("taskId","spaceId","scopeId","projectId","sectionId","milestoneId") VALUES ($1,$2,$2,$2,$3,$4)',
    [task, s, section, milestone],
  );
  await client.query(
    'INSERT INTO "ProjectGoal" ("goalId","spaceId","scopeId","projectId","milestoneId") VALUES ($1,$2,$2,$2,$3)',
    [goal, s, milestone],
  );
  await client.query(
    'INSERT INTO "ProjectMemberAssignment" (id,"spaceId","scopeId","projectId","accessId",generation,"phaseId") VALUES ($1,$2,$2,$2,$3,1,$4)',
    [randomUUID(), s, recipientAccess, phase],
  );
  for (const [table, col, target] of [
    ['ProjectGrant', 'projectId', s],
    ['TaskGrant', 'taskId', task],
    ['GoalGrant', 'goalId', goal],
  ]) {
    const id = randomUUID();
    await client.query(
      'INSERT INTO "ResourceGrant" (id,"spaceId","scopeId","granteeAccessId","granteeGeneration","issuerAccessId","issuerGeneration",capabilities,"expiresAt") VALUES ($1,$2,$2,$3,1,$4,1,ARRAY[\'read\'],\'2030-01-01T00:00Z\')',
      [id, s, recipientAccess, access],
    );
    await client.query(
      `INSERT INTO "${table}" ("grantId","spaceId","scopeId","${col}") VALUES ($1,$2,$2,$3)`,
      [id, s, target],
    );
  }
  await client.query(
    'INSERT INTO "ResourceGrantOffer" (id,"spaceId","scopeId","issuerAccessId","issuerGeneration","recipientActorId","recipientAccessId","recipientGeneration","recipientRevision","taskId",capabilities,"proofHash","keyHash",fingerprint,"createdAt","expiresAt","grantExpiresAt") VALUES ($1,$2,$2,$3,1,$4,$5,1,1,$6,ARRAY[\'read\'],$7,$8,$9,\'2026-10-30T00:00Z\',\'2026-11-06T00:00Z\',\'2030-01-01T00:00Z\')',
    [
      randomUUID(),
      s,
      access,
      recipient,
      recipientAccess,
      task,
      '3'.repeat(64),
      '4'.repeat(64),
      '5'.repeat(64),
    ],
  );
  await client.query('COMMIT');
  const tables = (
    await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename<>'_prisma_migrations' ORDER BY tablename",
      [schema],
    )
  ).rows.map((r) => r.tablename);
  assert.equal(tables.length, 95);
  const columns: Record<string, string> = {};
  for (const t of tables)
    columns[t] = (
      await client.query<{ column_name: string }>(
        'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',
        [schema, t],
      )
    ).rows
      .map((r) => '"' + r.column_name + '"')
      .join(',');
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const t of tables)
      result[t] = (
        await client.query(
          `SELECT to_jsonb(t) row FROM (SELECT ${columns[t]} FROM "${t}") t ORDER BY to_jsonb(t)::text`,
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
  assert.equal(history.length, 32);
  const constraints = (
    await client.query(
      'SELECT c.relname table_name,con.conname,pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE con.connamespace=$1::regnamespace ORDER BY c.relname,con.conname',
      [schema],
    )
  ).rows;
  const sql = fs.readFileSync(
    'prisma/migrations/' + assignmentMigrationName + '/migration.sql',
    'utf8',
  );
  assertReviewedAssignmentMigration(assignmentMigrationName, sql);
  await client.query(sql.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
  assert.equal(
    (await client.query('SELECT to_regclass(\'"TaskAssignment"\') relation'))
      .rows[0].relation,
    null,
  );
  assert.deepEqual(await snapshot(), before);
  input.copy(assignmentMigrationName);
  const started = performance.now();
  input.deploy();
  const elapsedMs = Math.round(performance.now() - started);
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 32',
      )
    ).rows,
    history,
  );
  for (const con of constraints) {
    const current = (
      await client.query(
        'SELECT pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE con.connamespace=$1::regnamespace AND c.relname=$2 AND con.conname=$3',
        [schema, con.table_name, con.conname],
      )
    ).rows;
    if (
      con.table_name === 'SharedUsageEntry' &&
      con.conname === 'SharedUsageEntry_feature_check'
    ) {
      assert.equal(current.length, 1);
      assert.ok(current[0].definition.includes("'task.assignment'"));
      for (const f of [
        'shared.custody',
        'shared.membership',
        'task.shared',
        'goal.shared',
        'shared.resource-grant',
      ])
        assert.ok(current[0].definition.includes("'" + f + "'"));
    } else assert.deepEqual(current, [{ definition: con.definition }]);
  }
  const folder = path.resolve('.tools/p2-04-upgrade-' + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'report.json'),
    JSON.stringify(
      {
        tablesPreserved: 95,
        historicalMigrations: 32,
        constraintsCompared: constraints.length,
        intentionalFeatureCheckExtension: 1,
        populatedProjectSourcesAndGrants: 'PASS',
        interruptedRollback: 'PASS',
        repeatDeploy: 'PASS',
        elapsedMs,
        sha256: assignmentMigrationHash,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: P2-04 populated M05 sources/grants and all 95 prior tables, legacy constraints and 32 checksums preserved; only reviewed feature CHECK extension; exact M06 rollback/resume/repeat.\n',
  );
  await verifyTaskToolsUpgrade(input);
}
