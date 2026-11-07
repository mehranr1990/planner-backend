import fs from 'node:fs';
import assert from 'node:assert/strict';
import type { Client } from 'pg';
import { verifyCompanyFoundationUpgrade } from './company-foundation-upgrade.ts';
import {
  teamLifecycleMigrationName,
  assertReviewedTeamLifecycleMigration,
} from './reviewed-team-lifecycle-migration.ts';
export async function verifyTeamLifecycleUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input;
  const tables = (
    await client.query<{ name: string }>(
      `SELECT tablename name FROM pg_tables WHERE schemaname=$1 AND tablename<>'_prisma_migrations' ORDER BY tablename`,
      [schema],
    )
  ).rows;
  assert.equal(tables.length, 146);
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const { name } of tables)
      result[name] = (
        await client.query(
          `SELECT to_jsonb(t) row FROM "${name}" t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    return result;
  };
  const constraints = async () =>
    (
      await client.query(
        `SELECT t.relname,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace ORDER BY t.relname,c.conname`,
        [schema],
      )
    ).rows;
  const fn = async () =>
    (
      await client.query<{ body: string }>(
        `SELECT prosrc body FROM pg_proc WHERE pronamespace=$1::regnamespace AND proname='shared_purge_allowed'`,
        [schema],
      )
    ).rows[0]!.body;
  const before = await snapshot(),
    priorConstraints = await constraints(),
    priorFunction = await fn(),
    ledger = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
  assert.equal(ledger.length, 50);
  const sql = fs.readFileSync(
    'prisma/migrations/' + teamLifecycleMigrationName + '/migration.sql',
    'utf8',
  );
  assertReviewedTeamLifecycleMigration(teamLifecycleMigrationName, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
  );
  await client.query('ROLLBACK');
  assert.equal(await fn(), priorFunction);
  assert.deepEqual(await snapshot(), before);
  input.copy(teamLifecycleMigrationName);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await constraints(), priorConstraints);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 50',
      )
    ).rows,
    ledger,
  );
  assert.equal(
    await fn(),
    priorFunction.replace("c.kind='PROJECT'", "c.kind IN ('PROJECT','TEAM')"),
  );
  process.stdout.write(
    'PASS: P3-05 preserves all 146 populated predecessor datasets, 50 checksums and every constraint; rollback and repeat deploy; purge function changes only the accepted custody-kind predicate.\n',
  );
  await verifyCompanyFoundationUpgrade(input);
}
