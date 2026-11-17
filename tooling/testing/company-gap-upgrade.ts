import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  companyGapMigrationName,
  companyGapMigrationHashes,
  assertReviewedCompanyGapMigration,
} from './reviewed-company-gap-migration.ts';
import { verifyMessagesMeetingsGapUpgrade } from './messages-meetings-gap-upgrade.ts';
const SHARED_CLEANUP_FK_SHA256 =
  '958a5063f1f5aee880e8881441134a31b5c1979e00d33bfb51782a4c939cb2c3';
export async function verifyCompanyGapUpgrade(input: {
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
  ).rows;
  const tables = new Map<string, string[]>();
  for (const c of columns) {
    assert.match(c.table_name, /^[A-Za-z][A-Za-z0-9_]*$/);
    assert.match(c.column_name, /^[A-Za-z][A-Za-z0-9_]*$/);
    tables.set(c.table_name, [
      ...(tables.get(c.table_name) ?? []),
      c.column_name,
    ]);
  }
  async function snapshot() {
    const rows: Record<string, unknown> = {};
    for (const [name, cols] of tables)
      rows[name] = (
        await client.query(
          `SELECT to_jsonb(t) row FROM (SELECT ${cols.map((c) => '"' + c + '"').join(',')} FROM "${name}") t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    return rows;
  }
  const before = await snapshot(),
    ledger = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
  assert.equal(ledger.length, 97);
  const catalog = async () =>
    (
      await client.query(
        `SELECT t.relname "table",c.conname name,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace ORDER BY t.relname,c.conname`,
        [schema],
      )
    ).rows;
  const prior = await catalog(),
    sql = fs.readFileSync(
      'prisma/migrations/' + companyGapMigrationName + '/migration.sql',
      'utf8',
    );
  assertReviewedCompanyGapMigration(companyGapMigrationName, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
    { code: '22012' },
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await catalog(), prior);
  input.copy(companyGapMigrationName);
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  for (const name of Object.keys(companyGapMigrationHashes).filter(
    (n) => n !== companyGapMigrationName,
  )) {
    const next = fs.readFileSync(
      'prisma/migrations/' + name + '/migration.sql',
      'utf8',
    );
    assertReviewedCompanyGapMigration(name, next);
    const priorCatalog = await catalog();
    await assert.rejects(
      client.query(next.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
      { code: '22012' },
    );
    await client.query('ROLLBACK');
    assert.deepEqual(await catalog(), priorCatalog);
    input.copy(name);
    input.deploy();
    assert.deepEqual(await snapshot(), before);
  }
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 97',
      )
    ).rows,
    ledger,
  );
  const fks = (
    await client.query(
      `SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype='f' AND c.connamespace=$1::regnamespace`,
      [schema],
    )
  ).rows
    .map((r) => ({
      table: r.table,
      name: r.name,
      target: r.target,
      definition: r.definition,
    }))
    .sort((a, b) => (a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1));
  assert.equal(fks.length, 1067);
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    SHARED_CLEANUP_FK_SHA256,
  );
  // Predecessor constraints remain verbatim except the three explicit approval/notice CHECK extensions.
  const after = await catalog();
  const changedChecks = new Set([
    'CompanyFinancialWorkflow.CompanyFinancialWorkflow_kind',
    'CompanyFinancialApproval.CompanyFinancialApproval_shape',
    'CompanyNotification.CompanyNotification_kind_check',
  ]);
  for (const old of prior.filter(
    (c) => !changedChecks.has(c.table + '.' + c.name),
  ))
    assert.deepEqual(
      after.find((c) => c.table === old.table && c.name === old.name),
      old,
    );
  process.stdout.write(
    `PASS: Company gap populated 97→99 upgrade preserves ${tables.size} predecessor datasets and all historical checksums; interruption rollback, repeat deploy and 1,067-FK cleanup catalog.\n`,
  );
  await verifyMessagesMeetingsGapUpgrade(input);
}
