import {
  teamReferenceUsageName,
  assertReviewedTeamReferenceUsage,
} from './reviewed-teams-migration.ts';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  teamsMigrationName,
  assertReviewedTeamsMigration,
} from './reviewed-teams-migration.ts';
export async function verifyTeamsUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input;
  const tables = (
    await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename<>'_prisma_migrations' ORDER BY tablename",
      [schema],
    )
  ).rows;
  assert.equal(tables.length, 135);
  const snapshot = async () => {
    const rows: Record<string, unknown> = {};
    for (const t of tables)
      rows[t.tablename] = (
        await client.query(
          `SELECT to_jsonb(t) row FROM "${t.tablename}" t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    return rows;
  };
  const before = await snapshot();
  const constraints = (
    await client.query<{ conname: string; definition: string }>(
      'SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=$1::regnamespace ORDER BY conname',
      [schema],
    )
  ).rows;
  const ledger = (
    await client.query(
      'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
    )
  ).rows;
  assert.equal(ledger.length, 44);
  const sql = fs.readFileSync(
    'prisma/migrations/' + teamsMigrationName + '/migration.sql',
    'utf8',
  );
  assertReviewedTeamsMigration(teamsMigrationName, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
  );
  await client.query('ROLLBACK');
  assert.equal(
    (await client.query(`SELECT to_regclass('"Team"') name`)).rows[0].name,
    null,
  );
  assert.deepEqual(await snapshot(), before);
  const usageSql = fs.readFileSync(
    'prisma/migrations/' + teamReferenceUsageName + '/migration.sql',
    'utf8',
  );
  assertReviewedTeamReferenceUsage(teamReferenceUsageName, usageSql);
  await assert.rejects(
    client.query(usageSql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
  );
  await client.query('ROLLBACK');
  input.copy(teamsMigrationName);
  input.copy(teamReferenceUsageName);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 44',
      )
    ).rows,
    ledger,
  );
  for (const c of constraints) {
    const current = (
      await client.query<{ definition: string }>(
        'SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=$1::regnamespace AND conname=$2',
        [schema, c.conname],
      )
    ).rows;
    assert.equal(current.length, 1);
    if (
      [
        'SharedUsageEntry_feature_check',
        'SharedCustody_kind_check',
        'ContextAccess_memberRole_check',
        'ContextInvitation_memberRole_check',
      ].includes(c.conname)
    ) {
      for (const literal of c.definition.match(/'[^']+'/g) ?? [])
        assert.ok(current[0]!.definition.includes(literal));
    } else assert.equal(current[0]!.definition, c.definition);
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
  const digest = createHash('sha256').update(JSON.stringify(fks)).digest('hex');
  const expected = fs
    .readFileSync(
      'apps/api/src/platform/lifecycle/shared-cleanup-catalog.ts',
      'utf8',
    )
    .match(/'([a-f0-9]{64})'/)![1];
  assert.equal(digest, expected);
  process.stdout.write(
    'PASS: P3-01 preserves all 135 prior table data sets, 44 checksums and prior constraints except the four reviewed context/usage CHECK extensions; interrupted rollback, resume/repeat deploy and cleanup FK catalog.\n',
  );
}
