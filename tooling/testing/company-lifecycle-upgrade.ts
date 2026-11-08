import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { verifyCompanyScopeCustodyUpgrade } from './company-scope-custody-upgrade.ts';
import {
  companyLifecycleMigrationName,
  assertReviewedCompanyLifecycleMigration,
} from './reviewed-company-lifecycle-migration.ts';
import {
  companyAssociationsMigrationName,
  assertReviewedCompanyAssociationsMigration,
} from './reviewed-company-associations-migration.ts';

export async function verifyCompanyLifecycleUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input;
  const tables = (
    await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' AND table_name<>'_prisma_migrations' ORDER BY table_name`,
      [schema],
    )
  ).rows.map((r) => r.table_name);
  assert.equal(tables.length, 182);
  const snapshot = async (names = tables) => {
    const result: Record<string, unknown> = {};
    for (const name of names)
      result[name] = (
        await client.query(
          'SELECT to_jsonb(t) row FROM "' +
            name +
            '" t ORDER BY to_jsonb(t)::text',
        )
      ).rows;
    return result;
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
  assert.equal(ledger.length, 57);
  for (const [name, review] of [
    [companyLifecycleMigrationName, assertReviewedCompanyLifecycleMigration],
    [
      companyAssociationsMigrationName,
      assertReviewedCompanyAssociationsMigration,
    ],
  ] as const) {
    const sql = fs.readFileSync(
      'prisma/migrations/' + name + '/migration.sql',
      'utf8',
    );
    review(name, sql);
    const constraintsBefore = await constraints();
    await assert.rejects(
      client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
    );
    await client.query('ROLLBACK');
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await constraints(), constraintsBefore);
    input.copy(name);
    input.deploy();
    input.deploy();
    assert.deepEqual(await snapshot(), before);
  }
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 57',
      )
    ).rows,
    ledger,
  );
  const after = await constraints();
  for (const row of oldConstraints.filter(
    (r) => r.name !== 'SharedUsageEntry_feature_check',
  ))
    assert.deepEqual(
      after.find((r) => r.table === row.table && r.name === row.name),
      row,
    );
  const usage = after.find((r) => r.name === 'SharedUsageEntry_feature_check')!;
  for (const feature of oldConstraints
    .find((r) => r.name === 'SharedUsageEntry_feature_check')!
    .definition.matchAll(/'([^']+)'/g))
    assert.ok(usage.definition.includes("'" + feature[1] + "'"));
  assert.ok(usage.definition.includes("'company.association'"));
  const co = (
    await client.query<{
      spaceId: string;
      scopeId: string;
      childId: string;
      childGeneration: number;
      ownerId: string;
      ownerGeneration: number;
    }>(
      `SELECT c."spaceId",a."scopeId",a.id "childId",a.generation "childGeneration",o.id "ownerId",o.generation "ownerGeneration" FROM "Company" c JOIN "SharedCustody" k ON k."spaceId"=c."spaceId" JOIN "ContextAccess" o ON o.id=k."primaryOwnerAccessId" JOIN "ContextAccess" a ON a."spaceId"=c."spaceId" AND a."scopeId"<>c."spaceId" ORDER BY c.id,a.id LIMIT 1`,
    )
  ).rows[0];
  assert.ok(co, 'Populated Company child admission fixture required');
  for (const kind of ['Project', 'Team']) {
    const root = (
      await client.query<{
        id: string;
        spaceId: string;
        scopeId: string;
        accessId: string;
        generation: number;
      }>(
        `SELECT r.id,r."spaceId",r."scopeId",a.id "accessId",a.generation FROM "${kind}" r JOIN "SharedCustody" c ON c."spaceId"=r."spaceId" JOIN "ContextAccess" a ON a.id=c."primaryOwnerAccessId" ORDER BY r.id LIMIT 1`,
      )
    ).rows[0];
    assert.ok(root, 'Populated ' + kind + ' fixture required');
    const id = randomUUID();
    const values = [
      id,
      root.spaceId,
      root.scopeId,
      root.id,
      co.spaceId,
      co.scopeId,
      root.accessId,
      root.generation,
      co.ownerId,
      co.ownerGeneration,
      co.childId,
      co.childGeneration,
    ];
    await client.query(
      `INSERT INTO "${kind}CompanyAssociation"(id,"spaceId","scopeId","sourceId","companySpaceId","companyScopeId","sourceAccessId","sourceGeneration","companyAccessId","companyGeneration","sourceCompanyAccessId","sourceCompanyGeneration","destinationAccessId","destinationGeneration","sourceEpoch","companyEpoch","expiresAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11,$12,0,0,clock_timestamp()+interval '30 minutes')`,
      values,
    );
    await assert.rejects(
      client.query(
        `UPDATE "${kind}CompanyAssociation" SET "companyScopeId"=$2,revision=revision+1 WHERE id=$1`,
        [id, root.scopeId],
      ),
    );
    await assert.rejects(
      client.query(
        `INSERT INTO "${kind}CompanyAssociation" SELECT $2::uuid,"spaceId","scopeId","sourceId","companySpaceId","companyScopeId","sourceAccessId","sourceGeneration","companyAccessId","companyGeneration","sourceCompanyAccessId","sourceCompanyGeneration","destinationAccessId","destinationGeneration","sourceEpoch","companyEpoch",state,revision,"expiresAt","createdAt","updatedAt" FROM "${kind}CompanyAssociation" WHERE id=$1`,
        [id, randomUUID()],
      ),
    );
  }
  const all = [
      ...tables,
      'ProjectCompanyAssociation',
      'TeamCompanyAssociation',
    ],
    populated = await snapshot(all);
  input.deploy();
  assert.deepEqual(await snapshot(all), populated);
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
  assert.equal(fks.length, 608);
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    '847beea93efc609bbd80d88422b3861784b1a6324466a1abd2f2f1f24cf22322',
  );
  process.stdout.write(
    'PASS: P4-06 lifecycle/association migrations preserve 182 predecessor datasets, 57 published checksums and all previous constraints except additive usage CHECK; interrupted rollback, repeat deploy, two populated association tables and exact 608-FK catalog.\n',
  );
  await verifyCompanyScopeCustodyUpgrade(input);
}
