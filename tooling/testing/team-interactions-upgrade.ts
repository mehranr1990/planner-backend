import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import {
  teamInteractionsMigrationName,
  assertReviewedTeamInteractionsMigration,
} from './reviewed-team-interactions-migration.ts';
export async function verifyTeamInteractionsUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input;
  const member = (
    await client.query<{
      spaceId: string;
      accessId: string;
      generation: number;
    }>(
      `SELECT t."spaceId",a.id "accessId",a.generation FROM "Team" t JOIN "ContextAccess" a ON a."spaceId"=t."spaceId" AND a."scopeId"=t."spaceId" ORDER BY t.id,a.id LIMIT 1`,
    )
  ).rows[0]!;
  await client.query(
    `INSERT INTO "TeamCapacityDay"(id,"spaceId","scopeId","accessId",generation,date,timezone,"availableMinutes") VALUES($1,$2,$2,$3,$4,'2030-01-07','UTC',480)`,
    [randomUUID(), member.spaceId, member.accessId, member.generation],
  );
  const columns = (
    await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position`,
      [schema],
    )
  ).rows;
  const tables = [...new Set(columns.map((c) => c.table_name))];
  assert.equal(tables.length, 140);
  const snapshot = async () => {
    const data: Record<string, unknown> = {};
    for (const table of tables) {
      const fields = columns
        .filter((c) => c.table_name === table)
        .map((c) => '"' + c.column_name + '"')
        .join(',');
      data[table] = (
        await client.query(
          `SELECT to_jsonb(t) row FROM (SELECT ${fields} FROM "${table}") t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    }
    return data;
  };
  const before = await snapshot(),
    ledger = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
  assert.equal(ledger.length, 49);
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
    'prisma/migrations/' + teamInteractionsMigrationName + '/migration.sql',
    'utf8',
  );
  assertReviewedTeamInteractionsMigration(teamInteractionsMigrationName, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.equal(
    (await client.query(`SELECT to_regclass('"TeamCase"') name`)).rows[0].name,
    null,
  );
  input.copy(teamInteractionsMigrationName);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 49',
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
    assert.equal(current.length, 1);
    if (c.conname === 'SharedUsageEntry_feature_check') {
      for (const literal of c.definition.match(/'[^']+'/g) ?? [])
        assert.ok(current[0]!.definition.includes(literal));
    } else assert.equal(current[0]!.definition, c.definition);
  }
  assert.equal(
    (
      await client.query(
        `SELECT count(*)::int n FROM "AccessScope" WHERE "restoreGeneration"<>0`,
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
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    fs
      .readFileSync(
        'apps/api/src/platform/lifecycle/shared-cleanup-catalog.ts',
        'utf8',
      )
      .match(/'([a-f0-9]{64})'/)![1],
  );
  process.stdout.write(
    'PASS: P3-04 preserves 140 prior table datasets, populated Team work/Calendar/planning/capacity, 49 immutable checksums and prior constraints except additive usage CHECK; interrupted rollback, zero restore-generation default, repeat deploy and exact cleanup catalog.\n',
  );
}
