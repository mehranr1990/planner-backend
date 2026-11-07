import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  companyFoundationMigrationName,
  assertReviewedCompanyFoundationMigration,
} from './reviewed-company-foundation-migration.ts';
import { verifyCompanySnapshotsUpgrade } from './company-snapshots-upgrade.ts';
export async function verifyCompanyFoundationUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input;
  const columns = (
      await client.query<{ table_name: string; column_name: string }>(
        `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position`,
        [schema],
      )
    ).rows,
    tables = [...new Set(columns.map((c) => c.table_name))];
  assert.equal(tables.length, 146);
  const snapshot = async () => {
    const data: Record<string, unknown> = {};
    for (const name of tables) {
      const fields = columns
        .filter((c) => c.table_name === name)
        .map((c) => '"' + c.column_name + '"')
        .join(',');
      data[name] = (
        await client.query(
          'SELECT to_jsonb(t) row FROM (SELECT ' +
            fields +
            ' FROM "' +
            name +
            '") t ORDER BY to_jsonb(t)::text',
        )
      ).rows;
    }
    return data;
  };
  const ledger = (
    await client.query(
      'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
    )
  ).rows;
  assert.equal(ledger.length, 51);
  const before = await snapshot(),
    constraints = (
      await client.query<{
        table_name: string;
        conname: string;
        definition: string;
      }>(
        `SELECT t.relname table_name,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace ORDER BY t.relname,c.conname`,
        [schema],
      )
    ).rows;
  const sql = fs.readFileSync(
    'prisma/migrations/' + companyFoundationMigrationName + '/migration.sql',
    'utf8',
  );
  assertReviewedCompanyFoundationMigration(companyFoundationMigrationName, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.equal(
    (await client.query(`SELECT to_regclass('"Company"') name`)).rows[0].name,
    null,
  );
  input.copy(companyFoundationMigrationName);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 51',
      )
    ).rows,
    ledger,
  );
  const changed = new Set([
    'SharedCustody_kind_check',
    'ContextAccess_memberRole_check',
    'ContextInvitation_memberRole_check',
    'AccessScope_kind_check',
    'AccessScope_check',
    'SharedUsageEntry_feature_check',
  ]);
  for (const c of constraints) {
    const current = (
      await client.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace AND t.relname=$2 AND c.conname=$3`,
        [schema, c.table_name, c.conname],
      )
    ).rows;
    assert.equal(current.length, 1);
    if (changed.has(c.conname)) {
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
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    '00f2826f26bac7cec5a6f2c8bb9cbb5ffb95482d434108e7e7b16cb734004901',
  );
  assert.equal(
    (
      await client.query(
        `SELECT count(*)::int n FROM "ContextInvitation" WHERE "companyScopeId" IS NOT NULL OR "companyIssuerAccessId" IS NOT NULL OR "companyRestoreGeneration" IS NOT NULL`,
      )
    ).rows[0].n,
    0,
  );
  process.stdout.write(
    'PASS: P4-01 preserves all 146 populated predecessor datasets, 51 immutable checksums, existing constraints except six reviewed branch/allowlist expansions, legacy invitation values and exact cleanup FK catalog; interrupted rollback and repeated deployment.\n',
  );
  await verifyCompanySnapshotsUpgrade(input);
}
