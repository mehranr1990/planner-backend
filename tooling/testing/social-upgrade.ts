import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  socialMigrationName as name,
  assertReviewedSocialMigration,
} from './reviewed-social-migration.ts';
export async function verifySocialUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input;
  const tables = (
    await client.query<{ table: string }>(
      'SELECT tablename "table" FROM pg_tables WHERE schemaname=$1 AND tablename<>\'_prisma_migrations\' ORDER BY tablename',
      [schema],
    )
  ).rows;
  assert.equal(tables.length, 238);
  async function snapshot() {
    const rows: Record<string, unknown> = {};
    for (const { table } of tables) {
      assert.match(table, /^[A-Za-z0-9_]+$/);
      rows[table] = (
        await client.query(
          `SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    }
    return rows;
  }
  const before = await snapshot(),
    ledger = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
  assert.equal(ledger.length, 68);
  const constraints = (
    await client.query(
      'SELECT t.relname "table",c.conname name,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace ORDER BY t.relname,c.conname',
      [schema],
    )
  ).rows;
  const functions = (
    await client.query(
      "SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace=$1::regnamespace AND prokind='f' ORDER BY proname,oid",
      [schema],
    )
  ).rows;
  const sql = fs.readFileSync(
    'prisma/migrations/' + name + '/migration.sql',
    'utf8',
  );
  assertReviewedSocialMigration(name, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
    { code: '22012' },
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.equal(
    (await client.query('SELECT to_regclass(\'"SocialGroup"\') value')).rows[0]
      .value,
    null,
  );
  assert.deepEqual(
    (
      await client.query(
        "SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace=$1::regnamespace AND prokind='f' ORDER BY proname,oid",
        [schema],
      )
    ).rows,
    functions,
  );
  input.copy(name);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 68',
      )
    ).rows,
    ledger,
  );
  for (const row of constraints) {
    if (
      ['SharedCustody_kind_check', 'SharedUsageEntry_feature_check'].includes(
        row.name,
      )
    )
      continue;
    assert.deepEqual(
      (
        await client.query(
          'SELECT pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace AND t.relname=$2 AND c.conname=$3',
          [schema, row.table, row.name],
        )
      ).rows,
      [{ definition: row.definition }],
    );
  }
  for (const row of functions) {
    if (
      ['shared_context_role_guard', 'shared_purge_allowed'].includes(
        row.proname,
      )
    )
      continue;
    assert.deepEqual(
      (
        await client.query(
          "SELECT pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace=$1::regnamespace AND proname=$2 AND prokind='f'",
          [schema, row.proname],
        )
      ).rows,
      [{ definition: row.definition }],
    );
  }
  assert.equal(
    (await client.query('SELECT count(*)::int n FROM "SocialPrivacy"')).rows[0]
      .n,
    0,
  );
  assert.equal(
    (await client.query('SELECT count(*)::int n FROM "SocialConnection"'))
      .rows[0].n,
    0,
  );
  const fks = (
    await client.query(
      'SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype=\'f\' AND c.connamespace=$1::regnamespace',
      [schema],
    )
  ).rows;
  fks.sort((a, b) =>
    a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1,
  );
  assert.equal(fks.length, 777);
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    '3554e0a2b9c5afe6be29e29efd0d8c5ff9bf2575c3ad1200775d353ab7d2239e',
  );
  assert.equal(
    (
      await client.query(
        'SELECT count(*)::int n FROM pg_tables WHERE schemaname=$1',
        [schema],
      )
    ).rows[0].n,
    245,
  );
  process.stdout.write(
    'PASS: M045 preserves all 238 predecessor datasets, 68 historical checksums and prior constraints/functions except two reviewed CHECK and two owner-function extensions; interrupted rollback, repeat deploy, no discovery/friendship backfill and exact 777-FK catalog.\n',
  );
}
