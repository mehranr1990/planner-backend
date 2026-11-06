import {
  teamCalendarOrderName,
  assertReviewedTeamCalendarOrder,
} from './reviewed-team-work-migration.ts';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  teamWorkMigrationName,
  assertReviewedTeamWorkMigration,
} from './reviewed-team-work-migration.ts';
export async function verifyTeamWorkUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input;
  const owner = (
    await client.query<{ id: string; ownerUserId: string }>(
      'SELECT id,"ownerUserId" FROM "Space" WHERE kind=\'PERSONAL\' ORDER BY id LIMIT 1',
    )
  ).rows[0]!;
  const event = randomUUID();
  await client.query(
    'INSERT INTO "CalendarEvent"(id,"spaceId","createdByUserId",title,kind,timezone,"startDate","endDate","updatedAt") VALUES($1,$2,$3,\'Preserved Personal event\',\'ALL_DAY\',\'Asia/Tehran\',\'2030-01-07\',\'2030-01-08\',CURRENT_TIMESTAMP)',
    [event, owner.id, owner.ownerUserId],
  );
  await client.query(
    'INSERT INTO "EventRecurrence"(id,"spaceId","createdByUserId",title,kind,timezone,"startDate","endDate","updatedAt","eventId",definition,"identityTime","fromKey") VALUES($1,$2,$3,\'Preserved recurrence\',\'ALL_DAY\',\'Asia/Tehran\',\'2030-01-07\',\'2030-01-08\',CURRENT_TIMESTAMP,$4,$5,\'00:00\',\'2030-01-07T00:00\')',
    [
      randomUUID(),
      owner.id,
      owner.ownerUserId,
      event,
      {
        version: 1,
        startDate: '2030-01-07',
        endDate: null,
        localTime: '00:00',
        timezone: 'Asia/Tehran',
        rule: { kind: 'DAILY', interval: 1 },
        exclusionDates: [],
      },
    ],
  );
  const columns = (
    await client.query<{ table_name: string; column_name: string }>(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position",
      [schema],
    )
  ).rows;
  const tables = [...new Set(columns.map((c) => c.table_name))];
  assert.equal(tables.length, 137);
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const table of tables) {
      const fields = columns
        .filter((c) => c.table_name === table)
        .map((c) => '"' + c.column_name + '"')
        .join(',');
      result[table] = (
        await client.query(
          `SELECT to_jsonb(t) row FROM (SELECT ${fields} FROM "${table}") t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    }
    return result;
  };
  const before = await snapshot(),
    ledger = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
  assert.equal(ledger.length, 46);
  const constraints = (
    await client.query<{
      table_name: string;
      conname: string;
      contype: string;
      definition: string;
    }>(
      'SELECT t.relname table_name,c.conname,c.contype,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace ORDER BY t.relname,c.conname',
      [schema],
    )
  ).rows;
  const sql = fs.readFileSync(
    'prisma/migrations/' + teamWorkMigrationName + '/migration.sql',
    'utf8',
  );
  assertReviewedTeamWorkMigration(teamWorkMigrationName, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  const orderSql = fs.readFileSync(
    'prisma/migrations/' + teamCalendarOrderName + '/migration.sql',
    'utf8',
  );
  assertReviewedTeamCalendarOrder(teamCalendarOrderName, orderSql);
  input.copy(teamWorkMigrationName);
  input.deploy();
  await assert.rejects(
    client.query(orderSql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
  );
  await client.query('ROLLBACK');
  input.copy(teamCalendarOrderName);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 46',
      )
    ).rows,
    ledger,
  );
  for (const c of constraints) {
    const current = (
      await client.query<{ definition: string }>(
        'SELECT pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace AND t.relname=$2 AND c.conname=$3',
        [schema, c.table_name, c.conname],
      )
    ).rows;
    if (
      ['CalendarEvent', 'EventRecurrence'].includes(c.table_name) &&
      c.contype === 'n' &&
      c.definition === 'NOT NULL "createdByUserId"'
    ) {
      assert.deepEqual(current, []);
      continue;
    }
    assert.equal(current.length, 1);
    if (c.conname === 'SharedUsageEntry_feature_check') {
      for (const literal of c.definition.match(/'[^']+'/g) ?? [])
        assert.ok(current[0]!.definition.includes(literal));
    } else assert.equal(current[0]!.definition, c.definition);
  }
  for (const table of ['CalendarEvent', 'EventRecurrence'])
    assert.equal(
      (
        await client.query(
          `SELECT count(*)::int n FROM "${table}" WHERE "createdByUserId" IS NULL OR "scopeId" IS NOT NULL OR "createdByActorId" IS NOT NULL`,
        )
      ).rows[0].n,
      0,
    );
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
  const expected =
    'b2d668e8d8b30b376884bb397039d09cfdd758083b8a335aab48fb89c5d924f5';
  assert.equal(digest, expected);
  await verifyTeamCapacityUpgrade(input);
  process.stdout.write(
    'PASS: P3-02 preserves all 137 prior table data sets, populated Personal Calendar/recurrence, 46 historical checksums and prior constraints except two branch-guarded nullability relaxations and additive usage CHECK; interrupted rollback, resume and repeat deploy.\n',
  );
}

import { verifyTeamCapacityUpgrade } from './team-capacity-upgrade.ts';
