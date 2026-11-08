import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import { verifyMessagingUpgrade } from './messaging-upgrade.ts';
import {
  companyDomainRepresentationMigrationName as name,
  assertReviewedCompanyDomainRepresentationMigration,
} from './reviewed-company-domain-representation-migration.ts';

/** Verify preserved independent data; never fabricate or execute a transfer. */
export async function verifyCompanyDomainRepresentationUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input;
  const columns = (
    await client.query<{ table: string; column: string }>(
      `SELECT table_name "table",column_name "column" FROM information_schema.columns WHERE table_schema=$1 AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position`,
      [schema],
    )
  ).rows;
  const tables = [...new Set(columns.map((c) => c.table))];
  assert.equal(tables.length, 189);
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const table of tables) {
      const projection = columns
        .filter((c) => c.table === table)
        .map((c) => '"' + c.column + '"')
        .join(',');
      result[table] = (
        await client.query(
          `SELECT to_jsonb(t) row FROM (SELECT ${projection} FROM "${table}") t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    }
    return result;
  };
  const constraints = async () =>
    (
      await client.query<{ table: string; name: string; definition: string }>(
        `SELECT t.relname "table",c.conname name,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace ORDER BY t.relname,c.conname`,
        [schema],
      )
    ).rows;
  const functions = async () =>
    (
      await client.query(
        `SELECT p.proname name,pg_get_functiondef(p.oid) definition FROM pg_proc p WHERE p.pronamespace=$1::regnamespace AND p.prokind='f' ORDER BY p.proname,p.oid`,
        [schema],
      )
    ).rows;
  const before = await snapshot(),
    oldConstraints = await constraints(),
    oldFunctions = await functions();
  const ledger = (
    await client.query(
      'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
    )
  ).rows;
  assert.equal(ledger.length, 62);
  const sql = fs.readFileSync(
    'prisma/migrations/' + name + '/migration.sql',
    'utf8',
  );
  assertReviewedCompanyDomainRepresentationMigration(name, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
    { code: '22012' },
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await constraints(), oldConstraints);
  assert.deepEqual(await functions(), oldFunctions);
  input.copy(name);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 62',
      )
    ).rows,
    ledger,
  );
  const after = await constraints();
  const expanded = new Set([
    'SharedActor|SharedActor_state_check',
    'SharedActor|SharedActor_check',
    'AccessScope|AccessScope_kind_check',
    'AccessScope|AccessScope_check',
  ]);
  const cleanupNullable = new Set([
    'DomainScopeCustody|DomainScopeCustody_primaryOwnerAccessId_not_null',
    'DomainScopeCustody|DomainScopeCustody_transferId_not_null',
  ]);
  for (const old of oldConstraints) {
    const current = after.find(
      (c) => c.table === old.table && c.name === old.name,
    );
    if (cleanupNullable.has(old.table + '|' + old.name)) {
      // M039 explicitly permits clearing these two pointers only under the
      // retained cleanup-state CHECK, purge lease and immutable disposal witness.
      assert.equal(current, undefined);
    } else if (expanded.has(old.table + '|' + old.name)) {
      assert.ok(current);
      for (const literal of old.definition.match(/'[^']+'/g) ?? [])
        assert.ok(current.definition.includes(literal));
    } else assert.deepEqual(current, old);
  }
  assert.deepEqual(
    (
      await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='DomainScopeCustody' AND column_name IN ('primaryOwnerAccessId','transferId') AND is_nullable='YES' ORDER BY column_name`,
        [schema],
      )
    ).rows,
    [{ column_name: 'primaryOwnerAccessId' }, { column_name: 'transferId' }],
  );
  assert.ok(
    after.find(
      (c) =>
        c.table === 'DomainScopeCustody' &&
        c.name === 'DomainScopeCustody_live_provenance',
    ),
  );
  const fks = (
    await client.query(
      `SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype='f' AND c.connamespace=$1::regnamespace`,
      [schema],
    )
  ).rows;
  fks.sort((a, b) =>
    a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1,
  );
  assert.equal(fks.length, 637);
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    'bbf94845b1b140596b78a9de21c5de20dc7b830afd0dc79798089b39992111f1',
  );
  assert.equal(
    (await client.query('SELECT count(*)::int n FROM "DomainScopeCustody"'))
      .rows[0].n,
    0,
  );
  process.stdout.write(
    'PASS: M039 preserves 189 predecessor datasets, 62 checksums and all prior FKs; four additive CHECK branches, interrupted rollback restores all functions, repeat deploy and exact 637-FK catalog. No custody transfer executed.\n',
  );
  await verifyMessagingUpgrade(input);
}
