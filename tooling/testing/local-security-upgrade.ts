import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import {
  localSecurityMigrationName,
  assertReviewedLocalSecurityMigration,
} from './reviewed-local-security-migration.ts';
export async function verifyLocalSecurityUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input;
  const legacyId = randomUUID();
  await client.query(
    'INSERT INTO "AccountDeletionJob"(id,"identityDigest","spaceDigest","policyVersion","recoveryHash") VALUES($1,$2,$3,\'SYNTHETIC\',$4)',
    [legacyId, 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
  );
  const policy = 'SYNTHETIC-closeout-' + randomUUID(),
    job = randomUUID(),
    custody = randomUUID();
  const rule = {
    retainAfterClosureSeconds: 0,
    audience: [],
    exportAuthority: [],
    disposalAction: 'PURGE',
  };
  await client.query(
    'INSERT INTO "SharedRetentionPolicy"(version,configuration,"approvalReference") VALUES($1,$2,\'SYNTHETIC\')',
    [
      policy,
      {
        policyVersion: policy,
        approvalReference: 'SYNTHETIC',
        accountableOperator: 'SYNTHETIC',
        marketScope: 'SYNTHETIC',
        applicableContexts: ['PROJECT'],
        sharedRecoverySeconds: 2592000,
        classRules: {
          workContent: rule,
          commentsHistory: rule,
          filesDerivatives: rule,
          exports: rule,
          accessAuditLifecycle: rule,
        },
        holds: [],
        obligations: [],
        backupPolicyReference: 'SYNTHETIC',
      },
    ],
  );
  await client.query(
    'INSERT INTO "SharedLifecycleJob"(id,"custodyId",generation,state,"effectiveDepartureAt","recoveryDeadline","retentionPolicyVersion","nextAt",progress) VALUES($1,$2,1,\'DELETED\',CURRENT_TIMESTAMP-interval \'100 days\',CURRENT_TIMESTAMP-interval \'70 days\',$3,CURRENT_TIMESTAMP-interval \'60 days\',\'{"stage":"DELETED"}\')',
    [job, custody, policy],
  );
  await client.query(
    'INSERT INTO "SharedLifecycleEffect"(id,"jobId","custodyId",generation,action,"authorizationVersion","operatorReference") VALUES($1,$2,$3,1,\'lifecycle.advance\',2,\'SYNTHETIC\')',
    [randomUUID(), job, custody],
  );
  const columns = (
    await client.query<{ table_name: string; column_name: string }>(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position",
      [schema],
    )
  ).rows;
  const tables = [...new Set(columns.map((c) => c.table_name))];
  assert.equal(tables.length, 134);
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
    constraints = (
      await client.query(
        'SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=$1::regnamespace ORDER BY conname',
        [schema],
      )
    ).rows,
    ledger = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
  assert.equal(ledger.length, 43);
  const sql = fs.readFileSync(
    'prisma/migrations/' + localSecurityMigrationName + '/migration.sql',
    'utf8',
  );
  assertReviewedLocalSecurityMigration(localSecurityMigrationName, sql);
  await client.query(sql.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=$1::regnamespace ORDER BY conname',
        [schema],
      )
    ).rows,
    constraints,
  );
  input.copy(localSecurityMigrationName);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 43',
      )
    ).rows,
    ledger,
  );
  for (const c of constraints)
    assert.deepEqual(
      (
        await client.query(
          'SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=$1::regnamespace AND conname=$2',
          [schema, c.conname],
        )
      ).rows,
      [c],
    );
  assert.equal(
    (
      await client.query(
        'SELECT "evidenceKeyId" FROM "AccountDeletionJob" WHERE id=$1',
        [legacyId],
      )
    ).rows[0].evidenceKeyId,
    null,
  );
  assert.equal(
    (
      await client.query(
        'SELECT "before" FROM "SharedEvidenceFloor" WHERE id=1',
      )
    ).rows[0].before.toISOString(),
    '1970-01-01T00:00:00.000Z',
  );
  process.stdout.write(
    'PASS: local security closeout preserves 134 prior table data sets, all old constraints, 43 checksums and legacy Personal proof hashes; interrupted rollback, resume and repeat deploy.\n',
  );
}
