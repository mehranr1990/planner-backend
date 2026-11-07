import { verifyCompanySettlementsUpgrade } from './company-settlements-upgrade.ts';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  companyFinanceMigrationName,
  assertReviewedCompanyFinanceMigration,
} from './reviewed-company-finance-migration.ts';
/** Runs after the populated M030 upgrade in the same exclusively owned schema. */
export async function verifyCompanyFinanceUpgrade(input: {
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
  assert.equal(tables.length, 157);
  const snapshot = async (names = tables) => {
    const out: Record<string, unknown> = {};
    for (const name of names)
      out[name] = (
        await client.query(
          'SELECT to_jsonb(t) row FROM "' +
            name +
            '" t ORDER BY to_jsonb(t)::text',
        )
      ).rows;
    return out;
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
  assert.equal(ledger.length, 54);
  const sql = fs.readFileSync(
    'prisma/migrations/' + companyFinanceMigrationName + '/migration.sql',
    'utf8',
  );
  assertReviewedCompanyFinanceMigration(companyFinanceMigrationName, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await constraints(), oldConstraints);
  input.copy(companyFinanceMigrationName);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 54',
      )
    ).rows,
    ledger,
  );
  const afterConstraints = await constraints();
  for (const c of oldConstraints.filter(
    (c) => c.name !== 'SharedUsageEntry_feature_check',
  ))
    assert.deepEqual(
      afterConstraints.find((a) => a.table === c.table && a.name === c.name),
      c,
    );
  const company = (
    await client.query<{ spaceId: string; actorId: string; accessId: string }>(
      `SELECT c."spaceId",a."actorId",a.id "accessId" FROM "Company" c JOIN "SharedCustody" k ON k."spaceId"=c."spaceId" JOIN "ContextAccess" a ON a.id=k."primaryOwnerAccessId" ORDER BY c.id LIMIT 1`,
    )
  ).rows[0]!;
  const members = (
    await client.query<{ id: string; generation: number }>(
      `SELECT id,generation FROM "ContextAccess" WHERE "spaceId"=$1 AND "scopeId"=$1 AND id<>$2 AND "memberRole" IS NOT NULL ORDER BY id`,
      [company.spaceId, company.accessId],
    )
  ).rows;
  assert.ok(members.length >= 2);
  const [
    category,
    anchor,
    budget,
    adjustment,
    commitment,
    expense,
    version,
    allocation,
    effect,
    event,
    receipt,
    file,
  ] = Array.from({ length: 12 }, () => randomUUID());
  const space = company.spaceId,
    actor = company.actorId;
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO "CompanyExpenseCategory"(id,"spaceId","scopeId",title) VALUES($1,$2,$2,'Synthetic finance category')`,
    [category, space],
  );
  await client.query(
    `INSERT INTO "CompanyFinanceProjectReference"(id,"spaceId","scopeId","createdByActorId") VALUES($1,$2,$2,$3)`,
    [anchor, space, actor],
  );
  const project = (
    await client.query<{ id: string; spaceId: string; actorId: string }>(
      `SELECT p.id,p."spaceId",a."actorId" FROM "Project" p JOIN "SharedCustody" c ON c."spaceId"=p."spaceId" JOIN "ContextAccess" a ON a.id=c."primaryOwnerAccessId" ORDER BY p.id LIMIT 1`,
    )
  ).rows[0]!;
  assert.ok(project);
  await client.query(
    `INSERT INTO "CompanyProjectFinanceLink"(id,"spaceId","scopeId","projectId","companySpaceId","companyScopeId","referenceId","createdByActorId") VALUES($1,$2,$2,$3,$4,$4,$5,$6)`,
    [randomUUID(), project.spaceId, project.id, space, anchor, project.actorId],
  );
  await client.query(
    `INSERT INTO "CompanyBudget"(id,"spaceId","scopeId",title,currency,scale,"limit","startDate","endDate",timezone,"projectReferenceId") VALUES($1,$2,$2,'Synthetic budget','USD',2,100,'2026-01-01','2027-01-01','UTC',$3)`,
    [budget, space, anchor],
  );
  await client.query(
    `INSERT INTO "CompanyBudgetAdjustment"(id,"spaceId","scopeId","budgetId",amount,"createdByActorId") VALUES($1,$2,$2,$3,10,$4)`,
    [adjustment, space, budget, actor],
  );
  await client.query(
    `INSERT INTO "CompanyCommitment"(id,"spaceId","scopeId","budgetId",amount,state,"createdByActorId") VALUES($1,$2,$2,$3,30,'ACTIVE',$4)`,
    [commitment, space, budget, actor],
  );
  await client.query(
    `INSERT INTO "CompanyBudgetEffect"(id,"spaceId","scopeId","budgetId","commitmentId",spent,reserved,"createdByActorId") VALUES($1,$2,$2,$3,$4,0,30,$5)`,
    [effect, space, budget, commitment, actor],
  );
  await client.query(
    `INSERT INTO "CompanyExpense"(id,"spaceId","scopeId",state) VALUES($1,$2,$2,'PENDING')`,
    [expense, space],
  );
  await client.query(
    `INSERT INTO "CompanyExpenseVersion"(id,"spaceId","scopeId","expenseId",number,kind,state,"requesterAccessId","requesterGeneration",currency,scale,amount,"categoryId","occurredDate",timezone) VALUES($1,$2,$2,$3,1,'ORIGINAL','DRAFT',$4,$5,'USD',2,20,$6,'2026-11-07','UTC')`,
    [version, space, expense, members[0]!.id, members[0]!.generation, category],
  );
  await client.query(
    `INSERT INTO "CompanyExpenseAllocation"(id,"spaceId","scopeId","versionId","budgetId","commitmentId",amount) VALUES($1,$2,$2,$3,$4,$5,20)`,
    [allocation, space, version, budget, commitment],
  );
  await client.query(
    `INSERT INTO "CompanyExpenseReviewEvent"(id,"spaceId","scopeId","versionId",action,"createdByActorId") VALUES($1,$2,$2,$3,'SUBMIT',$4)`,
    [event, space, version, actor],
  );
  await client.query(
    `INSERT INTO "StoredFile"(id,"spaceId","scopeId","createdByActorId","objectKey",filename,"mimeType","expectedSize","uploadExpiresAt","updatedAt") VALUES($1,$2,$2,$3,$4,'synthetic.pdf','application/pdf',10,now()+interval '1 hour',now())`,
    [file, space, actor, randomUUID()],
  );
  await client.query(
    `INSERT INTO "CompanyExpenseReceipt"(id,"spaceId","scopeId","versionId","fileId") VALUES($1,$2,$2,$3,$4)`,
    [receipt, space, version, file],
  );
  await client.query('COMMIT');
  const allTables = (
    await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name`,
      [schema],
    )
  ).rows.map((r) => r.table_name);
  assert.equal(allTables.length, 170);
  const populated = await snapshot(allTables);
  input.deploy();
  assert.deepEqual(await snapshot(allTables), populated);
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
    '5dc1448ca46c096964314477122c727a85c970da730410b3afea1492ca6b7700',
  );
  process.stdout.write(
    'PASS: P4-03 preserves all 157 populated predecessor datasets, 54 checksums and prior constraints except additive usage CHECK; interrupted rollback, repeat deploy, twelve populated new tables and 510-FK owner cleanup catalog.\n',
  );
  await verifyCompanySettlementsUpgrade(input);
}
