import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import { verifyAdvancedMessagingUpgrade } from './advanced-messaging-upgrade.ts';
import { verifyMessagingMediaUpgrade } from './messaging-media-upgrade.ts';
import {
  messagingMigrationName as name,
  assertReviewedMessagingMigration,
} from './reviewed-messaging-migration.ts';
export async function verifyMessagingUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input;
  const tables = (
    await client.query<{ table: string }>(
      `SELECT tablename "table" FROM pg_tables WHERE schemaname=$1 AND tablename<>'_prisma_migrations' ORDER BY tablename`,
      [schema],
    )
  ).rows;
  assert.equal(tables.length, 189);
  const snapshot = async () => {
    const data: Record<string, unknown> = {};
    for (const { table } of tables) {
      assert.match(table, /^[A-Za-z0-9_]+$/);
      data[table] = (
        await client.query(
          `SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    }
    return data;
  };
  const constraints = async () =>
    (
      await client.query<{ table: string; name: string; definition: string }>(
        `SELECT t.relname "table",c.conname name,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace ORDER BY t.relname,c.conname`,
        [schema],
      )
    ).rows;
  const before = await snapshot(),
    oldConstraints = await constraints(),
    ledger = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
  assert.equal(ledger.length, 63);
  const sql = fs.readFileSync(
    'prisma/migrations/' + name + '/migration.sql',
    'utf8',
  );
  assertReviewedMessagingMigration(name, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
    { code: '22012' },
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await constraints(), oldConstraints);
  assert.equal(
    (await client.query(`SELECT to_regclass('"Conversation"') name`)).rows[0]
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
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 63',
      )
    ).rows,
    ledger,
  );
  const current = await constraints();
  const expanded = new Set([
    'SharedCustody_kind_check',
    'SharedUsageEntry_feature_check',
  ]);
  for (const old of oldConstraints) {
    const row = current.find(
      (c) => c.table === old.table && c.name === old.name,
    );
    assert.ok(row);
    if (expanded.has(old.name))
      for (const literal of old.definition.match(/'[^']+'/g) ?? [])
        assert.ok(row.definition.includes(literal));
    else assert.deepEqual(row, old);
  }
  const fks = (
    await client.query(
      `SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype='f' AND c.connamespace=$1::regnamespace`,
      [schema],
    )
  ).rows;
  fks.sort((a, b) =>
    a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1,
  );
  assert.equal(fks.length, 655);
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    '7bebd8a898d2756304e4c828764949aea2d3c8ec73c1078c6b21882fdb684b3a',
  );
  assert.equal(
    (
      await client.query(
        `SELECT count(*)::int n FROM pg_tables WHERE schemaname=$1`,
        [schema],
      )
    ).rows[0].n,
    195,
  );
  process.stdout.write(
    'PASS: M040 preserves 189 predecessor datasets, 63 checksums and all prior FKs; two additive CHECK expansions, 18 new FKs, interrupted rollback and repeat deploy, exact 655-FK catalog.\n',
  );
  await verifyAdvancedMessagingUpgrade(input);
  await verifyMessagingMediaUpgrade(input);
}
