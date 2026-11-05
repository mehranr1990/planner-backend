import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { verifyProjectCollaborationUpgrade } from './project-collaboration-upgrade.ts';
import {
  projectExecutionMigrationHashes,
  assertReviewedProjectExecutionMigration,
} from './reviewed-project-execution-migrations.ts';
type Input = {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
  spaceId: string;
  actorId: string;
  accessId: string;
  recipientActorId: string;
  recipientAccessId: string;
};
/** Extend the existing owned M07 fixture; preserve every old data set and checksum. */
export async function verifyProjectExecutionUpgrade(input: Input) {
  const {
      client,
      schema,
      spaceId: s,
      actorId: a,
      accessId: access,
      recipientAccessId: recipient,
    } = input,
    task = (
      await client.query<{ id: string }>(
        'SELECT "taskId" id FROM "ProjectTask" WHERE "projectId"=$1 LIMIT 1',
        [s],
      )
    ).rows[0]!.id;
  const second = randomUUID(),
    workflow = randomUUID(),
    start = randomUUID(),
    end = randomUUID(),
    edge = randomUUID(),
    field = randomUUID(),
    preview = randomUUID();
  await client.query('BEGIN');
  await client.query(
    'INSERT INTO "Task" (id,"spaceId","scopeId","createdByActorId",title,"updatedAt") VALUES ($1,$2,$2,$3,\'M07 Task before M08\',clock_timestamp())',
    [second, s, a],
  );
  await client.query(
    'INSERT INTO "ProjectTask" ("taskId","spaceId","scopeId","projectId") VALUES ($1,$2,$2,$2)',
    [second, s],
  );
  await client.query(
    'INSERT INTO "TaskField" (id,"spaceId","scopeId",name,kind,"createdByActorId","creationKey",fingerprint) VALUES ($1,$2,$2,\'Retained field\',\'TEXT\',$3,$4,$5)',
    [field, s, a, '1'.repeat(64), '2'.repeat(64)],
  );
  await client.query(
    'INSERT INTO "TaskFieldVersion" ("spaceId","scopeId","fieldId",version,kind,name,"publishedByActorId","hasDefault") VALUES ($1,$1,$2,1,\'TEXT\',\'Retained field\',$3,true)',
    [s, field, a],
  );
  await client.query(
    'INSERT INTO "TaskFieldValue" (id,"spaceId","scopeId","taskId","fieldId","fieldVersion",kind,"textValue") VALUES ($1,$2,$2,NULL,$3,1,\'TEXT\',\'Retained immutable default\'),($4,$2,$2,$5,$3,1,\'TEXT\',\'Retained source value\')',
    [randomUUID(), s, field, randomUUID(), task],
  );
  await client.query(
    'INSERT INTO "TaskWorkflow" (id,"spaceId","scopeId",name,"createdByActorId","creationKey",fingerprint) VALUES ($1,$2,$2,\'Retained workflow\',$3,$4,$5)',
    [workflow, s, a, '3'.repeat(64), '4'.repeat(64)],
  );
  await client.query(
    'INSERT INTO "TaskWorkflowVersion" ("spaceId","scopeId","workflowId",version,name,"publishedByActorId") VALUES ($1,$1,$2,1,\'Retained workflow\',$3)',
    [s, workflow, a],
  );
  await client.query(
    'INSERT INTO "TaskWorkflowState" ("spaceId","scopeId","workflowId",version,id,label,status) VALUES ($1,$1,$2,1,$3,\'Open\',\'OPEN\'),($1,$1,$2,1,$4,\'Done\',\'DONE\')',
    [s, workflow, start, end],
  );
  await client.query(
    'INSERT INTO "TaskWorkflowEdge" ("spaceId","scopeId","workflowId",version,id,"fromStateId","toStateId","requiresApproval") VALUES ($1,$1,$2,1,$3,$4,$5,true)',
    [s, workflow, edge, start, end],
  );
  await client.query(
    'INSERT INTO "TaskWorkflowApprover" ("spaceId","scopeId","workflowId",version,"edgeId","accessId",generation) VALUES ($1,$1,$2,1,$3,$4,1)',
    [s, workflow, edge, recipient],
  );
  await client.query(
    'INSERT INTO "TaskWorkflowBinding" ("taskId","spaceId","scopeId","workflowId",version,"stateId") VALUES ($1,$2,$2,$3,1,$4)',
    [task, s, workflow, start],
  );
  await client.query(
    'INSERT INTO "TaskWorkflowApproval" (id,"spaceId","scopeId","taskId","workflowId",version,"edgeId","requesterAccessId","requesterGeneration","requestedByActorId","sourceRevision","createdAt","expiresAt","creationKey",fingerprint) VALUES ($1,$2,$2,$3,$4,1,$5,$6,1,$7,1,\'2030-01-01T00:00Z\',\'2030-01-01T00:30Z\',$8,$9)',
    [
      randomUUID(),
      s,
      task,
      workflow,
      edge,
      access,
      a,
      '5'.repeat(64),
      '6'.repeat(64),
    ],
  );
  await client.query(
    'INSERT INTO "TaskDependency" (id,"spaceId","scopeId","predecessorId","successorId",kind,"lagMinutes","createdByActorId") VALUES ($1,$2,$2,$3,$4,\'FS\',-15,$5)',
    [randomUUID(), s, task, second, a],
  );
  await client.query(
    'INSERT INTO "TaskMetadataEvent" (id,"spaceId","scopeId","taskId","actorId",action,"sourceRevision","afterValue") VALUES ($1,$2,$2,$3,$4,\'BEFORE_M08\',1,\'{"fixture":true}\')',
    [randomUUID(), s, task, a],
  );
  await client.query(
    'INSERT INTO "TaskReschedulePreview" (id,"spaceId","scopeId","createdByActorId","creatorAccessId","creatorGeneration","graphRevision","authorizationVersion","manifestHash","creationKey",fingerprint,"createdAt","expiresAt") VALUES ($1,$2,$2,$3,$4,1,1,1,$5,$6,$7,\'2030-01-01T00:00Z\',\'2030-01-01T00:30Z\')',
    [preview, s, a, access, 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
  );
  await client.query(
    'INSERT INTO "TaskRescheduleItem" ("spaceId","scopeId","previewId","taskId","sourceRevision",changed) VALUES ($1,$1,$2,$3,1,false)',
    [s, preview, task],
  );
  await client.query('COMMIT');
  const tables = (
    await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename<>'_prisma_migrations' ORDER BY tablename",
      [schema],
    )
  ).rows.map((r) => r.tablename);
  assert.equal(tables.length, 115);
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
  assert.equal(history.length, 36);
  const constraints = (
      await client.query<{
        table_name: string;
        conname: string;
        definition: string;
      }>(
        'SELECT c.relname table_name,con.conname,pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE con.connamespace=$1::regnamespace ORDER BY c.relname,con.conname',
        [schema],
      )
    ).rows,
    started = performance.now();
  for (const name of Object.keys(projectExecutionMigrationHashes).sort()) {
    const sql = fs.readFileSync(
      'prisma/migrations/' + name + '/migration.sql',
      'utf8',
    );
    assertReviewedProjectExecutionMigration(name, sql);
    await client.query(sql.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
    const table = name.includes('project_execution')
      ? 'ProjectRiskIssue'
      : 'SharedTaskWorkLog';
    assert.equal(
      (
        await client.query('SELECT to_regclass($1) relation', [
          '"' + table + '"',
        ])
      ).rows[0].relation,
      null,
    );
    assert.deepEqual(await snapshot(), before);
    input.copy(name);
    input.deploy();
  }
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 36',
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
        'project.risk-issue',
        'project.template-version',
        'project.change-plan',
        'task.shared-work-log',
        'project.capacity-day',
        'project.work-allocation',
        'project.report-snapshot',
      ])
        assert.ok(current[0].definition.includes("'" + feature + "'"));
    } else assert.deepEqual(current, [{ definition: con.definition }]);
  }
  const report = {
      tablesPreserved: 115,
      historicalMigrations: 36,
      constraintsCompared: constraints.length,
      populatedM07WorkflowApprovalFieldDependencyAndPreview: 'PASS',
      interruptedBothMigrations: 'PASS',
      repeatDeploy: 'PASS',
      elapsedMs: Math.round(performance.now() - started),
      hashes: projectExecutionMigrationHashes,
    },
    folder = path.resolve('.tools/p2-06-upgrade-' + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  process.stdout.write(
    'PASS: P2-06 preserves all 115 prior tables, populated M07 workflow/approval/field/DAG/preview, all prior constraints except additive usage CHECK and 36 checksums; both M08 interruptions and repeat deploy.\n',
  );
  await verifyProjectCollaborationUpgrade(input);
}
