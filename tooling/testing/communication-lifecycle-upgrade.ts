import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  communicationLifecycleMigrationName as name,
  assertReviewedCommunicationLifecycleMigration,
} from './reviewed-communication-lifecycle-migration.ts';
export async function verifyCommunicationLifecycleUpgrade(input: {
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
  assert.equal(tables.length, 235);
  const snapshot = async () => {
    const rows: Record<string, unknown> = {};
    for (const { table } of tables) {
      assert.match(table, /^[A-Za-z0-9_]+$/);
      rows[table] = (
        await client.query(
          `SELECT to_jsonb(t)${table === 'MessageProgress' ? "-'receiptConsentAt'" : ''} row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    }
    return rows;
  };
  const constraints = async () =>
    (
      await client.query(
        'SELECT t.relname "table",c.conname name,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace ORDER BY t.relname,c.conname',
        [schema],
      )
    ).rows;
  const functions = async () =>
    (
      await client.query(
        'SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace=$1::regnamespace ORDER BY proname,oid',
        [schema],
      )
    ).rows;
  const before = await snapshot(),
    old = await constraints(),
    oldFunctions = await functions(),
    ledger = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
  assert.equal(ledger.length, 67);
  const sql = fs.readFileSync(
    'prisma/migrations/' + name + '/migration.sql',
    'utf8',
  );
  assertReviewedCommunicationLifecycleMigration(name, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
    { code: '22012' },
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await constraints(), old);
  assert.deepEqual(await functions(), oldFunctions);
  assert.equal(
    (await client.query(`SELECT to_regclass('"DmContactBlock"') name`)).rows[0]
      .name,
    null,
  );
  input.copy(name);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 67',
      )
    ).rows,
    ledger,
  );
  const current = await constraints();
  for (const c of old)
    assert.deepEqual(
      current.find((v) => v.table === c.table && v.name === c.name),
      c,
    );
  for (const table of ['DmContactState', 'DmContactBlock', 'DmContactMutation'])
    assert.equal(
      (await client.query(`SELECT count(*)::int n FROM "${table}"`)).rows[0].n,
      0,
    );
  assert.equal(
    (
      await client.query(
        'SELECT count(*)::int n FROM "MessageProgress" WHERE "receiptConsentAt" IS NOT NULL',
      )
    ).rows[0].n,
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
  assert.equal(fks.length, 766);
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    '5a1b650b7cca7dec58699c9aff14e8354e58f73b9983f7ad55ce53e0a578792a',
  );
  assert.equal(
    (
      await client.query(
        'SELECT count(*)::int n FROM pg_tables WHERE schemaname=$1',
        [schema],
      )
    ).rows[0].n,
    239,
  );
  process.stdout.write(
    'PASS: M044 preserves all 235 predecessor datasets, all previous constraints and 67 migration checksums; interrupted rollback/repeat deploy, no block/receipt consent backfill and exact 766-FK catalog.\n',
  );
}
