import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  messagesMeetingsGapMigrationName,
  assertReviewedMessagesMeetingsGapMigration,
} from './reviewed-messages-meetings-gap-migration.ts';
// Pinned to the 1,071-FK catalog reviewed through migration 0076; later batches re-pin the live constant.
const SHARED_CLEANUP_FK_SHA256 =
  'e7581b5e95a60c1c55322ab57b541fbf58353cab38dd9c3e76a8b8e33bc9bdec';
export async function verifyMessagesMeetingsGapUpgrade(input: {
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
    const data: Record<string, unknown> = {};
    for (const [t, cols] of tables)
      data[t] = (
        await client.query(
          `SELECT to_jsonb(t) row FROM (SELECT ${cols.map((c) => '"' + c + '"').join(',')} FROM "${t}") t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    return data;
  }
  const before = await snapshot(),
    ledger = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
  assert.equal(ledger.length, 99);
  const sql = fs.readFileSync(
    'prisma/migrations/' + messagesMeetingsGapMigrationName + '/migration.sql',
    'utf8',
  );
  assertReviewedMessagesMeetingsGapMigration(sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
    { code: '22012' },
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.equal(
    (
      await client.query(
        `SELECT to_regclass('"AnnouncementSchedule"') relation`,
      )
    ).rows[0].relation,
    null,
  );
  input.copy(messagesMeetingsGapMigrationName);
  input.deploy();
  const pinSql = fs.readFileSync(
    'prisma/migrations/202611170076_announcement_pin_metadata/migration.sql',
    'utf8',
  );
  await assert.rejects(
    client.query(pinSql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
    { code: '22012' },
  );
  await client.query('ROLLBACK');
  input.copy('202611170076_announcement_pin_metadata');
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 99',
      )
    ).rows,
    ledger,
  );
  assert.equal(
    (
      await client.query(
        `SELECT count(*)::int n FROM "MeetingAgendaEntry" WHERE "plannedMinutes" IS NOT NULL OR "completedAt" IS NOT NULL OR notes<>''`,
      )
    ).rows[0].n,
    0,
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
  assert.equal(fks.length, 1071);
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    SHARED_CLEANUP_FK_SHA256,
  );
  assert.equal(
    (await client.query('SELECT count(*)::int n FROM "_prisma_migrations"'))
      .rows[0].n,
    101,
  );
  process.stdout.write(
    `PASS: Messages/Meetings populated 99→101 upgrade preserves ${tables.size} predecessor datasets and 99 checksums; two interrupted rollbacks, repeat deploy, nullable legacy details and 1,071-FK cleanup catalog.\n`,
  );
}
