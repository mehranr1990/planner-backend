import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { verifyCompanyDomainRepresentationUpgrade } from './company-domain-representation-upgrade.ts';
import {
  scopedLifecycleJobsMigrationName,
  assertReviewedScopedLifecycleJobsMigration,
} from './reviewed-scoped-lifecycle-jobs-migration.ts';

export async function verifyScopedLifecycleJobsUpgrade(input: {
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
  assert.equal(ledger.length, 61);
  const sql = fs.readFileSync(
    'prisma/migrations/' + scopedLifecycleJobsMigrationName + '/migration.sql',
    'utf8',
  );
  assertReviewedScopedLifecycleJobsMigration(
    scopedLifecycleJobsMigrationName,
    sql,
  );
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await constraints(), oldConstraints);
  assert.deepEqual(await functions(), oldFunctions);
  input.copy(scopedLifecycleJobsMigrationName);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 61',
      )
    ).rows,
    ledger,
  );
  assert.equal(
    (
      await client.query<{ count: number }>(
        'SELECT count(*)::int count FROM "SharedLifecycleJob" WHERE "scopeId" IS NOT NULL',
      )
    ).rows[0]!.count,
    0,
  );
  const after = await constraints();
  for (const old of oldConstraints) {
    if (
      old.table === 'SharedLifecycleJob' &&
      old.name === 'SharedLifecycleJob_check'
    ) {
      assert.ok(
        after
          .find(
            (c) =>
              c.table === old.table &&
              c.name === 'SharedLifecycleJob_location_shape',
          )
          ?.definition.includes('"scopeId"'),
      );
    } else if (
      old.table === 'DomainScopeCustody' &&
      old.name === 'DomainScopeCustody_state_check'
    ) {
      const current = after.find(
        (c) => c.table === old.table && c.name === old.name,
      )!;
      for (const literal of old.definition.match(/'[^']+'/g) ?? [])
        assert.ok(current.definition.includes(literal));
    } else
      assert.deepEqual(
        after.find((c) => c.table === old.table && c.name === old.name),
        old,
      );
  }
  const company = (
    await client.query<{ spaceId: string; retentionPolicyVersion: string }>(
      `SELECT c."spaceId",c."retentionPolicyVersion" FROM "SharedCustody" c WHERE c.kind='COMPANY' ORDER BY c."spaceId" LIMIT 1`,
    )
  ).rows[0]!;
  const source = (
    await client.query<{ spaceId: string }>(
      `SELECT "spaceId" FROM "SharedCustody" WHERE kind='PROJECT' ORDER BY "spaceId" LIMIT 1`,
    )
  ).rows[0]!;
  await assert.rejects(
    client.query(
      `WITH instant AS (SELECT clock_timestamp() now) INSERT INTO "SharedLifecycleJob"(id,"custodyId","spaceId","scopeId",generation,state,"effectiveDepartureAt","recoveryDeadline","retentionPolicyVersion","nextAt") SELECT $1,$2,$3,$2,(SELECT coalesce(max(generation),0)+1 FROM "SharedLifecycleJob" WHERE "custodyId"=$2),'CLOSING_GRACE',now,now+interval '720 hours',$4,now FROM instant`,
      [
        randomUUID(),
        source.spaceId,
        company.spaceId,
        company.retentionPolicyVersion,
      ],
    ),
    {
      code: '23514',
      message:
        'Domain lifecycle requires its applied custody and captured policy',
    },
  );
  const job = (
    await client.query<{ id: string }>(
      'SELECT id FROM "SharedLifecycleJob" ORDER BY id LIMIT 1',
    )
  ).rows[0]!;
  assert.ok(job, 'Populated lifecycle evidence required');
  await assert.rejects(
    client.query(
      'UPDATE "SharedLifecycleJob" SET "scopeId"=$2,"custodyId"=$2 WHERE id=$1',
      [job.id, randomUUID()],
    ),
    { code: '23514', message: 'Immutable lifecycle scope identity' },
  );
  assert.deepEqual(await snapshot(), before);
  assert.equal(
    (
      await client.query<{ ok: boolean }>(
        'SELECT shared_domain_purge_allowed($1,$2) ok',
        [company.spaceId, source.spaceId],
      )
    ).rows[0]!.ok,
    false,
  );
  process.stdout.write(
    'PASS: M038 preserves 189 predecessor datasets, 61 checksums and existing constraints except the two reviewed lifecycle branches; interrupted rollback restores all functions, repeat deploy preserves historical jobs; forged domain jobs and scope retyping denied.\n',
  );
  await verifyCompanyDomainRepresentationUpgrade(input);
}
