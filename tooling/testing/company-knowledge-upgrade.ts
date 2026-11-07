import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  companyKnowledgeMigrationName,
  assertReviewedCompanyKnowledgeMigration,
} from './reviewed-company-knowledge-migration.ts';
export async function verifyCompanyKnowledgeUpgrade(input: {
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
  assert.equal(tables.length, 179);
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
  assert.equal(ledger.length, 56);
  const sql = fs.readFileSync(
    'prisma/migrations/' + companyKnowledgeMigrationName + '/migration.sql',
    'utf8',
  );
  assertReviewedCompanyKnowledgeMigration(companyKnowledgeMigrationName, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await constraints(), oldConstraints);
  input.copy(companyKnowledgeMigrationName);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 56',
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
  const folder = randomUUID(),
    doc = randomUUID(),
    file = randomUUID(),
    hash = 'a'.repeat(64);
  await client.query(
    `INSERT INTO "CompanyKnowledgeFolder"(id,"spaceId","scopeId",title) VALUES($1,$2,$2,'Synthetic knowledge')`,
    [folder, co.spaceId],
  );
  await client.query(
    `INSERT INTO "CompanyKnowledgeDocument"(id,"spaceId","scopeId","folderId",title) VALUES($1,$2,$2,$3,'Synthetic document')`,
    [doc, co.spaceId, folder],
  );
  await client.query(
    `INSERT INTO "StoredFile"(id,"spaceId","scopeId","ownerUserId","createdByActorId","objectKey",filename,"mimeType","expectedSize","actualSize",status,sha256,"uploadExpiresAt","updatedAt","completedAt") VALUES($1,$2,$2,NULL,$3,$4,'guide.txt','text/plain',3,3,'READY',$5,clock_timestamp()+interval '1 hour',clock_timestamp(),clock_timestamp())`,
    [file, co.spaceId, co.actorId, randomUUID(), hash],
  );
  await client.query(
    `INSERT INTO "CompanyKnowledgeVersion"(id,"spaceId","scopeId","documentId","fileId","uploaderAccessId","uploaderGeneration",title) VALUES($1,$2,$2,$3,$1,$4,$5,'Pinned title')`,
    [file, co.spaceId, doc, co.accessId, co.generation],
  );
  await client.query(
    `UPDATE "CompanyKnowledgeVersion" SET "publishedAt"=clock_timestamp(),"pinnedRevision"=1,"pinnedHash"=$2 WHERE id=$1`,
    [file, hash],
  );
  await client.query(
    `UPDATE "CompanyKnowledgeDocument" SET "publishedVersionId"=$2 WHERE id=$1`,
    [doc, file],
  );
  await assert.rejects(
    client.query(
      `UPDATE "CompanyKnowledgeVersion" SET title='tampered' WHERE id=$1`,
      [file],
    ),
  );
  await assert.rejects(
    client.query(`UPDATE "StoredFile" SET sha256=$2 WHERE id=$1`, [
      file,
      'b'.repeat(64),
    ]),
  );
  await assert.rejects(
    client.query(`DELETE FROM "CompanyKnowledgeVersion" WHERE id=$1`, [file]),
  );
  await assert.rejects(
    client.query(
      `UPDATE "CompanyKnowledgeFolder" SET "parentId"=id WHERE id=$1`,
      [folder],
    ),
  );
  const all = [
    ...tables,
    'CompanyKnowledgeFolder',
    'CompanyKnowledgeDocument',
    'CompanyKnowledgeVersion',
  ];
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
  assert.equal(fks.length, 584);
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
    'PASS: P4-05 preserves 179 populated predecessor datasets, 56 checksums and previous constraints; interrupted rollback, repeat deploy, three populated knowledge tables, immutable file/version evidence and 584-FK catalog.\n',
  );
}
