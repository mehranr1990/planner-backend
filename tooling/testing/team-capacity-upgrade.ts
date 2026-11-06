import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { teamDefaultPolicy } from '../../apps/api/src/modules/spaces/domain/shared-policy.ts';
import type { Client } from 'pg';
import {
  teamCapacityMigrationName,
  assertReviewedTeamCapacityMigration,
} from './reviewed-team-capacity-migration.ts';
export async function verifyTeamCapacityUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input;
  // Populate the accepted P3-02 Team custody, source, calendar and planning shapes before expansion.
  const user = (
    await client.query<{ ownerUserId: string }>(
      `SELECT "ownerUserId" FROM "Space" WHERE kind='PERSONAL' ORDER BY id LIMIT 1`,
    )
  ).rows[0]!.ownerUserId;
  const retention = (
    await client.query<{
      version: string;
      configuration: Record<string, unknown>;
    }>(
      `SELECT version,configuration FROM "SharedRetentionPolicy" ORDER BY version LIMIT 1`,
    )
  ).rows[0]!;
  const team = randomUUID(),
    actor = randomUUID(),
    access = randomUUID(),
    plan = randomUUID(),
    task = randomUUID();
  const version = 'synthetic-team-upgrade-' + randomUUID();
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO "SharedRetentionPolicy"(version,configuration,"approvalReference") VALUES($1,$2,'SYNTHETIC-ONLY')`,
    [
      version,
      {
        ...retention.configuration,
        policyVersion: version,
        applicableContexts: ['PROJECT', 'TEAM'],
      },
    ],
  );
  await client.query(
    `INSERT INTO "Space"(id,kind,"updatedAt") VALUES($1,'SHARED',now())`,
    [team],
  );
  await client.query(
    `INSERT INTO "SharedCustody"("spaceId",kind,state,"primaryOwnerAccessId","retentionPolicyVersion") VALUES($1,'TEAM','ACTIVE',$2,$3)`,
    [team, access, version],
  );
  await client.query(
    `INSERT INTO "AccessScope"(id,"spaceId",kind) VALUES($1,$1,'ROOT')`,
    [team],
  );
  await client.query(
    `INSERT INTO "SharedActor"(id,"spaceId","userId",state) VALUES($1,$2,$3,'ACTIVE')`,
    [actor, team, user],
  );
  await client.query(
    `INSERT INTO "ContextAccess"(id,"spaceId","scopeId","actorId",state,"memberRole","joinedAt") VALUES($1,$2,$2,$3,'ACTIVE','ADMIN',now())`,
    [access, team, actor],
  );
  await client.query(
    `INSERT INTO "ContextAccessInterval"("accessId",generation,"joinedAt") VALUES($1,1,now())`,
    [access],
  );
  await client.query(
    `INSERT INTO "ContextCapabilityPolicy"("spaceId","scopeId",version,"roleDefaults","exportMaxRecords","exportMaxBytes","publishedByActorId","auditId") VALUES($1,$1,1,$2,10000,10485760,$3,$4)`,
    [team, teamDefaultPolicy, actor, randomUUID()],
  );
  await client.query(
    `INSERT INTO "Team"(id,"spaceId","scopeId","createdByActorId",title,"creationKey","creationFingerprint") VALUES($1,$1,$1,$2,'Preserved Team',$3,$4)`,
    [team, actor, 'c'.repeat(64), 'd'.repeat(64)],
  );
  await client.query(
    `INSERT INTO "Task"(id,"spaceId","scopeId","createdByActorId",title,"updatedAt") VALUES($1,$2,$2,$3,'Preserved Team source',now())`,
    [task, team, actor],
  );
  await client.query(
    `INSERT INTO "TeamPlan"(id,"spaceId",kind,title,"startDate","endDate",timezone,"createdByActorId") VALUES($1,$2,'WEEK','Preserved weekly plan','2030-01-07','2030-01-14','UTC',$3)`,
    [plan, team, actor],
  );
  await client.query(
    `INSERT INTO "TeamWorkItem"(id,"spaceId","planId","sourceSpaceId","taskId","sourceRevision","createdByActorId") VALUES($1,$2,$3,$2,$4,1,$5)`,
    [randomUUID(), team, plan, task, actor],
  );
  await client.query(
    `INSERT INTO "CalendarEvent"(id,"spaceId","scopeId","createdByActorId",title,kind,timezone,"startDate","endDate","updatedAt") VALUES($1,$2,$2,$3,'Preserved Team calendar','ALL_DAY','UTC','2030-01-07','2030-01-08',now())`,
    [randomUUID(), team, actor],
  );
  await client.query(
    `INSERT INTO "TeamProjectReference"("teamId","projectId","spaceId") SELECT $1,id,"spaceId" FROM "Project" ORDER BY id LIMIT 1`,
    [team],
  );
  await client.query('COMMIT');
  const tables = (
    await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename<>'_prisma_migrations' ORDER BY tablename",
      [schema],
    )
  ).rows.map((r) => r.tablename);
  assert.equal(tables.length, 139);
  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(
        tables.map(async (t) => [
          t,
          (
            await client.query(
              `SELECT to_jsonb(t) row FROM "${t}" t ORDER BY to_jsonb(t)::text`,
            )
          ).rows,
        ]),
      ),
    );
  const before = await snapshot(),
    ledger = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
  assert.equal(ledger.length, 48);
  const constraints = (
    await client.query<{
      table_name: string;
      conname: string;
      definition: string;
    }>(
      'SELECT t.relname table_name,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace ORDER BY t.relname,c.conname',
      [schema],
    )
  ).rows;
  const sql = fs.readFileSync(
    'prisma/migrations/' + teamCapacityMigrationName + '/migration.sql',
    'utf8',
  );
  assertReviewedTeamCapacityMigration(teamCapacityMigrationName, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.equal(
    (await client.query(`SELECT to_regclass('"TeamCapacityDay"') name`)).rows[0]
      .name,
    null,
  );
  input.copy(teamCapacityMigrationName);
  input.deploy();
  input.deploy();
  // Usage CHECK is the sole reviewed prior-table metadata change; prior rows and all 48 ledger checksums stay exact.
  const after = await snapshot();
  assert.deepEqual(after, before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 48',
      )
    ).rows,
    ledger,
  );
  for (const c of constraints) {
    const now = (
      await client.query<{ definition: string }>(
        'SELECT pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace AND t.relname=$2 AND c.conname=$3',
        [schema, c.table_name, c.conname],
      )
    ).rows;
    assert.equal(now.length, 1);
    if (c.conname === 'SharedUsageEntry_feature_check') {
      for (const literal of c.definition.match(/'[^']+'/g) ?? [])
        assert.ok(now[0]!.definition.includes(literal));
    } else assert.equal(now[0]!.definition, c.definition);
  }
  const fks = (
    await client.query<{
      table: string;
      name: string;
      target: string;
      definition: string;
    }>(
      `SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype='f' AND c.connamespace=$1::regnamespace`,
      [schema],
    )
  ).rows;
  fks.sort((a, b) =>
    a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1,
  );
  const expected = fs
    .readFileSync(
      'apps/api/src/platform/lifecycle/shared-cleanup-catalog.ts',
      'utf8',
    )
    .match(/'([a-f0-9]{64})'/)![1];
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    expected,
  );
  process.stdout.write(
    'PASS: P3-03 populated 139-table preservation, 48 immutable checksums, original constraints, interrupted rollback, repeat deploy and exact cleanup catalog.\n',
  );
}
