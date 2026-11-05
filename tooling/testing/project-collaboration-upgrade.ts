import { verifyLocalSecurityUpgrade } from './local-security-upgrade.ts';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import {
  projectCollaborationMigrationHashes,
  assertReviewedProjectCollaborationMigration,
} from './reviewed-project-collaboration-migrations.ts';

type Input = {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
  spaceId: string;
  actorId: string;
  accessId: string;
  recipientAccessId: string;
};
/** Continue the populated M08 fixture, using the actual deploy ledger and rollback/resume path. */
export async function verifyProjectCollaborationUpgrade(input: Input) {
  const { client, schema, spaceId: s, actorId: a, accessId: access } = input;
  const task = (
    await client.query<{ id: string }>(
      'SELECT "taskId" id FROM "ProjectTask" WHERE "projectId"=$1 ORDER BY "taskId" LIMIT 1',
      [s],
    )
  ).rows[0]!.id;
  const risk = randomUUID(),
    template = randomUUID(),
    plan = randomUUID(),
    snapshotId = randomUUID();
  await client.query('BEGIN');
  await client.query(
    'INSERT INTO "ProjectRiskIssue"(id,"spaceId","scopeId","projectId",kind,title,description,severity,probability,mitigation,status,"createdByActorId","creationKey",fingerprint) VALUES($1,$2,$2,$2,\'RISK\',\'Retained risk\',\'Synthetic\',\'MEDIUM\',25,\'Review\',\'OPEN\',$3,$4,$5)',
    [risk, s, a, '1'.repeat(64), '2'.repeat(64)],
  );
  await client.query(
    'INSERT INTO "ProjectRiskIssueEvent"(id,"spaceId","scopeId","projectId","itemId","actorId",revision,"after") VALUES($1,$2,$2,$2,$3,$4,1,\'{"fixture":true}\')',
    [randomUUID(), s, risk, a],
  );
  await client.query(
    'INSERT INTO "ProjectTemplate"(id,"spaceId","scopeId","projectId",name,"createdByActorId","creationKey",fingerprint) VALUES($1,$2,$2,$2,\'Retained template\',$3,$4,$5)',
    [template, s, a, '3'.repeat(64), '4'.repeat(64)],
  );
  await client.query(
    'INSERT INTO "ProjectTemplateVersion"("spaceId","scopeId","projectId","templateId",version,name,definition,"publishedByActorId","creationKey",fingerprint) VALUES($1,$1,$1,$2,1,\'Retained template\',$3::jsonb,$4,$5,$6)',
    [
      s,
      template,
      JSON.stringify({
        schemaVersion: 1,
        phases: [],
        sections: [],
        milestones: [],
        tasks: [{ title: 'Retained source' }],
        dependencies: [],
      }),
      a,
      '5'.repeat(64),
      '6'.repeat(64),
    ],
  );
  await client.query(
    'INSERT INTO "ProjectChangePlan"(id,"spaceId","scopeId","projectId",kind,operations,"creatorAccessId","creatorGeneration","createdByActorId","authorizationVersion","manifestHash","creationKey",fingerprint,"createdAt","expiresAt") VALUES($1,$2,$2,$2,\'BULK\',$3::jsonb,$4,1,$5,1,$6,$7,$8,\'2030-01-01T00:00Z\',\'2030-01-01T00:30Z\')',
    [
      plan,
      s,
      JSON.stringify([
        {
          kind: 'UPDATE_TASK',
          taskId: task,
          sourceRevision: 1,
          patch: { title: 'Retained' },
        },
      ]),
      access,
      a,
      '7'.repeat(64),
      '8'.repeat(64),
      '9'.repeat(64),
    ],
  );
  await client.query(
    'INSERT INTO "ProjectChangeSource"("spaceId","scopeId","projectId","planId","taskId","sourceRevision",kind) VALUES($1,$1,$1,$2,$3,1,\'EXISTING\')',
    [s, plan, task],
  );
  await client.query(
    'INSERT INTO "ProjectCapacityDay"(id,"spaceId","scopeId","projectId","accessId",generation,date,timezone,"availableMinutes") VALUES($1,$2,$2,$2,$3,1,\'2030-01-01\',\'UTC\',480)',
    [randomUUID(), s, access],
  );
  const assignment = (
    await client.query<{
      id: string;
      taskId: string;
      recipientAccessId: string;
      recipientGeneration: number;
    }>(
      'SELECT id,"taskId","recipientAccessId","recipientGeneration" FROM "TaskAssignment" WHERE "spaceId"=$1 LIMIT 1',
      [s],
    )
  ).rows[0]!;
  assert.ok(assignment);
  await client.query(
    'INSERT INTO "ProjectWorkAllocation"(id,"spaceId","scopeId","projectId","taskId","assignmentId","accessId",generation,date,timezone,"plannedMinutes") VALUES($1,$2,$2,$2,$3,$4,$5,$6,\'2030-01-01\',\'UTC\',60)',
    [
      randomUUID(),
      s,
      assignment.taskId,
      assignment.id,
      assignment.recipientAccessId,
      assignment.recipientGeneration,
    ],
  );
  await client.query(
    'INSERT INTO "ProjectReportSnapshot"(id,"spaceId","scopeId","projectId","createdByActorId",report,"creationKey",fingerprint) VALUES($1,$2,$2,$2,$3,\'{"fixture":true}\',$4,$5)',
    [snapshotId, s, a, 'a'.repeat(64), 'b'.repeat(64)],
  );
  await client.query(
    'INSERT INTO "ProjectReportSource"("spaceId","scopeId","projectId","snapshotId","taskId","sourceRevision") VALUES($1,$1,$1,$2,$3,1)',
    [s, snapshotId, task],
  );
  await client.query(
    'INSERT INTO "SharedTaskWorkLog"(id,"spaceId","scopeId","taskId","actorId","accessId",generation,"startedAt","endedAt","creationKey",fingerprint) VALUES($1,$2,$2,$3,$4,$5,1,\'2030-01-01T09:00Z\',\'2030-01-01T10:00Z\',$6,$7)',
    [randomUUID(), s, task, a, access, 'c'.repeat(64), 'd'.repeat(64)],
  );
  await client.query('COMMIT');
  const tables = (
    await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename<>'_prisma_migrations' ORDER BY tablename",
      [schema],
    )
  ).rows.map((r) => r.tablename);
  assert.equal(tables.length, 126);
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const t of tables) {
      const projection =
        t === 'StoredFile'
          ? `to_jsonb(t)-ARRAY['scopeId','createdByActorId']`
          : 'to_jsonb(t)';
      result[t] = (
        await client.query(
          `SELECT ${projection} row FROM "${t}" t ORDER BY ${projection}::text`,
        )
      ).rows;
    }
    return result;
  };
  const before = await snapshot(),
    history = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
  assert.equal(history.length, 38);
  const constraints = (
    await client.query<{
      table_name: string;
      conname: string;
      definition: string;
      contype: string;
    }>(
      'SELECT t.relname table_name,c.conname,pg_get_constraintdef(c.oid) definition,c.contype FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace ORDER BY t.relname,c.conname',
      [schema],
    )
  ).rows;
  const checks = new Set([
    'ResourceGrantOffer.ResourceGrantOffer_capabilities_check',
    'ResourceGrantOffer.ResourceGrantOffer_check5',
    'SharedUsageEntry.SharedUsageEntry_feature_check',
  ]);
  for (const name of Object.keys(projectCollaborationMigrationHashes).sort()) {
    const sql = fs.readFileSync(
      'prisma/migrations/' + name + '/migration.sql',
      'utf8',
    );
    assertReviewedProjectCollaborationMigration(name, sql);
    const catalog = await client.query(
      'SELECT c.relname,p.conname,pg_get_constraintdef(p.oid) definition FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid WHERE p.connamespace=$1::regnamespace ORDER BY c.relname,p.conname',
      [schema],
    );
    await client.query(sql.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
    assert.deepEqual(
      (
        await client.query(
          'SELECT c.relname,p.conname,pg_get_constraintdef(p.oid) definition FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid WHERE p.connamespace=$1::regnamespace ORDER BY c.relname,p.conname',
          [schema],
        )
      ).rows,
      catalog.rows,
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
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 38',
      )
    ).rows,
    history,
  );
  for (const con of constraints) {
    const current = (
      await client.query(
        'SELECT pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace AND t.relname=$2 AND c.conname=$3',
        [schema, con.table_name, con.conname],
      )
    ).rows;
    if (
      con.table_name === 'StoredFile' &&
      con.contype === 'n' &&
      con.definition === 'NOT NULL "ownerUserId"'
    ) {
      assert.deepEqual(current, []);
      continue;
    }
    if (
      [
        'TaskChange_spaceId_taskId_fkey',
        'TaskChange_scope_fk',
        'Goal_spaceId_id_metricId_fkey',
      ].includes(con.conname)
    ) {
      assert.deepEqual(current, [
        { definition: con.definition + ' DEFERRABLE' },
      ]);
      continue;
    }
    if (checks.has(con.table_name + '.' + con.conname)) {
      assert.equal(current.length, 1);
      for (const literal of con.definition.match(/'[^']+'/g) ?? [])
        assert.ok(current[0].definition.includes(literal));
    } else assert.deepEqual(current, [{ definition: con.definition }]);
  }
  const folder = path.resolve('.tools/p2-07-upgrade-' + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'report.json'),
    JSON.stringify(
      {
        status: 'PASS',
        tablesPreserved: 126,
        historicalMigrations: 38,
        constraintsCompared: constraints.length,
        populatedM08: 'PASS',
        interruptions: 5,
        repeatDeploy: 'PASS',
        hashes: projectCollaborationMigrationHashes,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: P2-07 preserves 126 populated prior tables, M08 execution/reporting, 38 checksums and prior constraints with only reviewed additive exceptions; all five interruptions and repeat deploy.\n',
  );
  await verifyLocalSecurityUpgrade(input);
}
