import { verifyCompanyKnowledgeUpgrade } from './company-knowledge-upgrade.ts';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  companySettlementsMigrationName,
  assertReviewedCompanySettlementsMigration,
} from './reviewed-company-settlements-migration.ts';
export async function verifyCompanySettlementsUpgrade(input: {
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
  assert.equal(tables.length, 169);
  const snapshot = async (names = tables) => {
    const rows: Record<string, unknown> = {};
    for (const name of names)
      rows[name] = (
        await client.query(
          'SELECT to_jsonb(t) row FROM "' +
            name +
            '" t ORDER BY to_jsonb(t)::text',
        )
      ).rows;
    return rows;
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
  assert.equal(ledger.length, 55);
  const sql = fs.readFileSync(
    'prisma/migrations/' + companySettlementsMigrationName + '/migration.sql',
    'utf8',
  );
  assertReviewedCompanySettlementsMigration(
    companySettlementsMigrationName,
    sql,
  );
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await constraints(), oldConstraints);
  input.copy(companySettlementsMigrationName);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 55',
      )
    ).rows,
    ledger,
  );
  const after = await constraints();
  for (const c of oldConstraints.filter(
    (c) => c.name !== 'SharedUsageEntry_feature_check',
  ))
    assert.deepEqual(
      after.find((a) => a.table === c.table && a.name === c.name),
      c,
    );
  const co = (
    await client.query<{
      spaceId: string;
      actorId: string;
      accessId: string;
      generation: number;
    }>(
      `SELECT c."spaceId",a."actorId",a.id "accessId",a.generation FROM "Company" c JOIN "SharedCustody" k ON k."spaceId"=c."spaceId" JOIN "ContextAccess" a ON a.id=k."primaryOwnerAccessId" ORDER BY c.id LIMIT 1`,
    )
  ).rows[0]!;
  const seats = (
    await client.query<{ id: string; actorId: string; generation: number }>(
      `SELECT id,"actorId",generation FROM "ContextAccess" WHERE "spaceId"=$1 AND "scopeId"=$1 AND id<>$2 AND "memberRole" IS NOT NULL ORDER BY id`,
      [co.spaceId, co.accessId],
    )
  ).rows;
  assert.ok(seats.length >= 2);
  const payer = seats[0]!,
    reviewer = seats[1]!;
  const [
      category,
      expense,
      expenseVersion,
      workflow,
      version,
      step,
      bucket,
      reimbursement,
      approval,
      payment,
      correction,
    ] = Array.from({ length: 11 }, () => randomUUID()),
    space = co.spaceId,
    actor = co.actorId;
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO "CompanyExpenseCategory"(id,"spaceId","scopeId",title) VALUES($1,$2,$2,'M032 synthetic category')`,
    [category, space],
  );
  await client.query(
    `INSERT INTO "CompanyExpense"(id,"spaceId","scopeId",state) VALUES($1,$2,$2,'PENDING')`,
    [expense, space],
  );
  await client.query(
    `INSERT INTO "CompanyExpenseVersion"(id,"spaceId","scopeId","expenseId",number,kind,state,"requesterAccessId","requesterGeneration","payerAccessId","payerGeneration",currency,scale,amount,"categoryId","occurredDate",timezone) VALUES($1,$2,$2,$3,1,'ORIGINAL','DRAFT',$4,$5,$6,$7,'USD',2,100,$8,'2026-11-07','UTC')`,
    [
      expenseVersion,
      space,
      expense,
      co.accessId,
      co.generation,
      payer.id,
      payer.generation,
      category,
    ],
  );
  await client.query(
    `UPDATE "CompanyExpenseVersion" SET state='SUBMITTED',"submittedAt"=now(),"reviewerAccessId"=$2,"reviewerGeneration"=$3,revision=revision+1,"updatedAt"=now() WHERE id=$1`,
    [expenseVersion, reviewer.id, reviewer.generation],
  );
  await client.query(
    `UPDATE "CompanyExpenseVersion" SET state='APPROVED',"decidedAt"=now(),revision=revision+1,"updatedAt"=now() WHERE id=$1`,
    [expenseVersion],
  );
  await client.query(
    `UPDATE "CompanyExpense" SET state='APPROVED',"effectiveVersionId"=$2,revision=revision+1,"updatedAt"=now() WHERE id=$1`,
    [expense, expenseVersion],
  );
  await client.query(
    `INSERT INTO "CompanyFinancialWorkflow"(id,"spaceId","scopeId",kind,title) VALUES($1,$2,$2,'REIMBURSEMENT','M032 synthetic workflow')`,
    [workflow, space],
  );
  await client.query(
    `INSERT INTO "CompanyFinancialWorkflowVersion"(id,"spaceId","scopeId","workflowId",number,title,state,"createdByActorId") VALUES($1,$2,$2,$3,1,'M032 pinned review','DRAFT',$4)`,
    [version, space, workflow, actor],
  );
  await client.query(
    `INSERT INTO "CompanyFinancialWorkflowStep"(id,"spaceId","scopeId","versionId",position,label,"primaryAccessId","primaryGeneration","alternateAccessId","alternateGeneration") VALUES($1,$2,$2,$3,0,'Review',$4,$5,$6,$7)`,
    [
      step,
      space,
      version,
      co.accessId,
      co.generation,
      reviewer.id,
      reviewer.generation,
    ],
  );
  await client.query(
    `UPDATE "CompanyFinancialWorkflowVersion" SET state='PUBLISHED',revision=revision+1,"updatedAt"=now() WHERE id=$1`,
    [version],
  );
  await client.query(
    `INSERT INTO "CompanyReimbursementBucket"(id,"spaceId","scopeId","expenseId","initialVersionId","beneficiaryActorId",currency,scale) VALUES($1,$2,$2,$3,$4,$5,'USD',2)`,
    [bucket, space, expense, expenseVersion, payer.actorId],
  );
  await client.query(
    `INSERT INTO "CompanyReimbursementEffect"(id,"spaceId","scopeId","bucketId","sourceVersionId",kind,entitlement,reserved,acknowledged,pending,"createdByActorId") VALUES($1,$2,$2,$3,$4,'INITIAL',100,0,0,0,$5)`,
    [randomUUID(), space, bucket, expenseVersion, actor],
  );
  await client.query(
    `INSERT INTO "CompanyReimbursementRequest"(id,"spaceId","scopeId","bucketId","expenseVersionId","beneficiaryAccessId","beneficiaryGeneration",amount,state) VALUES($1,$2,$2,$3,$4,$5,$6,100,'DRAFT')`,
    [reimbursement, space, bucket, expenseVersion, payer.id, payer.generation],
  );
  await client.query(
    `UPDATE "CompanyReimbursementRequest" SET state='SUBMITTED',revision=revision+1,"updatedAt"=now() WHERE id=$1`,
    [reimbursement],
  );
  await client.query(
    `INSERT INTO "CompanyFinancialApproval"(id,"spaceId","scopeId","workflowVersionId","reimbursementId","requesterAccessId","requesterGeneration","beneficiaryAccessId","beneficiaryGeneration",attempt,fingerprint,state,"sourceRevision") VALUES($1,$2,$2,$3,$4,$5,$6,$5,$6,1,$7,'ACTIVE',2)`,
    [
      approval,
      space,
      version,
      reimbursement,
      payer.id,
      payer.generation,
      'a'.repeat(64),
    ],
  );
  await client.query(
    `INSERT INTO "CompanyFinancialApprovalEvent"(id,"spaceId","scopeId","approvalId",action,"createdByActorId") VALUES($1,$2,$2,$3,'SUBMIT',$4)`,
    [randomUUID(), space, approval, actor],
  );
  await client.query(
    `INSERT INTO "CompanyFinancialApprovalEvent"(id,"spaceId","scopeId","approvalId","stepId",action,"createdByActorId","reviewerAccessId","reviewerGeneration") VALUES($1,$2,$2,$3,$4,'APPROVE',$5,$6,$7)`,
    [randomUUID(), space, approval, step, actor, co.accessId, co.generation],
  );
  await client.query(
    `UPDATE "CompanyFinancialApproval" SET state='APPROVED',revision=revision+1,"updatedAt"=now() WHERE id=$1`,
    [approval],
  );
  await client.query(
    `UPDATE "CompanyReimbursementRequest" SET state='APPROVED',revision=revision+1,"updatedAt"=now() WHERE id=$1`,
    [reimbursement],
  );
  await client.query(
    `INSERT INTO "CompanyReimbursementEffect"(id,"spaceId","scopeId","bucketId","requestId",kind,entitlement,reserved,acknowledged,pending,"createdByActorId") VALUES($1,$2,$2,$3,$4,'APPROVAL',0,100,0,0,$5)`,
    [randomUUID(), space, bucket, reimbursement, actor],
  );
  await client.query(
    `INSERT INTO "CompanyPaymentAcknowledgement"(id,"spaceId","scopeId","requestId","bucketId","authorAccessId","authorGeneration",amount,state) VALUES($1,$2,$2,$3,$4,$5,$6,10,'PROPOSED')`,
    [payment, space, reimbursement, bucket, co.accessId, co.generation],
  );
  await client.query(
    `INSERT INTO "CompanyReimbursementEffect"(id,"spaceId","scopeId","bucketId","requestId","paymentId",kind,entitlement,reserved,acknowledged,pending,"createdByActorId") VALUES($1,$2,$2,$3,$4,$5,'PROPOSE',0,0,0,10,$6)`,
    [randomUUID(), space, bucket, reimbursement, payment, actor],
  );
  await client.query(
    `INSERT INTO "CompanyReimbursementEffect"(id,"spaceId","scopeId","bucketId","requestId","paymentId",kind,entitlement,reserved,acknowledged,pending,"createdByActorId") VALUES($1,$2,$2,$3,$4,$5,'ACKNOWLEDGE',0,-10,10,-10,$6)`,
    [randomUUID(), space, bucket, reimbursement, payment, actor],
  );
  await client.query(
    `UPDATE "CompanyPaymentAcknowledgement" SET state='ACKNOWLEDGED',revision=revision+1,"updatedAt"=now() WHERE id=$1`,
    [payment],
  );
  await client.query(
    `INSERT INTO "CompanyAcknowledgementCorrection"(id,"spaceId","scopeId","paymentId","requestId","bucketId","authorAccessId","authorGeneration",amount,reason,state) VALUES($1,$2,$2,$3,$4,$5,$6,$7,5,'Synthetic record correction','PROPOSED')`,
    [
      correction,
      space,
      payment,
      reimbursement,
      bucket,
      co.accessId,
      co.generation,
    ],
  );
  await client.query('COMMIT');
  const all = (
    await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name`,
      [schema],
    )
  ).rows.map((r) => r.table_name);
  assert.equal(all.length, 180);
  const populated = await snapshot(all);
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
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    'abdcc24a65fa82a3d09c241101f07a5346108b4e28aab727c3ffa2d4e6c53fd9',
  );
  process.stdout.write(
    'PASS: P4-04 preserves all 169 populated predecessor datasets, 55 checksums and existing constraints except additive usage CHECK; interrupted rollback, repeat deploy, ten populated new tables, independent acknowledgement history and 571-FK cleanup catalog.\n',
  );
  await verifyCompanyKnowledgeUpgrade(input);
}
