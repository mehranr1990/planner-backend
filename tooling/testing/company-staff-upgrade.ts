import { verifyCompanyFinanceUpgrade } from './company-finance-upgrade.ts';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  companyStaffMigrationName,
  assertReviewedCompanyStaffMigration,
} from './reviewed-company-staff-migration.ts';
export async function verifyCompanyStaffUpgrade(input: {
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
  const tables = [...new Set(columns.map((c) => c.table_name))];
  assert.equal(tables.length, 151);
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const table of tables) {
      const fields = columns
        .filter((c) => c.table_name === table)
        .map((c) => '"' + c.column_name + '"')
        .join(',');
      result[table] = (
        await client.query(
          'SELECT to_jsonb(t) row FROM (SELECT ' +
            fields +
            ' FROM "' +
            table +
            '") t ORDER BY to_jsonb(t)::text',
        )
      ).rows;
    }
    return result;
  };
  const constraints = async () =>
    (
      await client.query<{ name: string; definition: string; table: string }>(
        `SELECT c.conname name,pg_get_constraintdef(c.oid) definition,t.relname "table" FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace ORDER BY t.relname,c.conname`,
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
  assert.equal(ledger.length, 53);
  const sql = fs.readFileSync(
    'prisma/migrations/' + companyStaffMigrationName + '/migration.sql',
    'utf8',
  );
  assertReviewedCompanyStaffMigration(companyStaffMigrationName, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await constraints(), oldConstraints);
  input.copy(companyStaffMigrationName);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 53',
      )
    ).rows,
    ledger,
  );
  const afterConstraints = await constraints();
  for (const old of oldConstraints.filter(
    (c) => c.name !== 'SharedUsageEntry_feature_check',
  ))
    assert.deepEqual(
      afterConstraints.find(
        (c) => c.table === old.table && c.name === old.name,
      ),
      old,
    );
  assert.equal(
    (
      await client.query(
        `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE'`,
        [schema],
      )
    ).rows[0].n,
    158,
  );
  // Populate each new owner table, including retained case history, without changing predecessor data.
  const company = (
    await client.query<{ spaceId: string; actorId: string; accessId: string }>(
      `SELECT c."spaceId",a."actorId",a.id "accessId" FROM "Company" c JOIN "SharedCustody" k ON k."spaceId"=c."spaceId" JOIN "ContextAccess" a ON a.id=k."primaryOwnerAccessId" ORDER BY c.id LIMIT 1`,
    )
  ).rows[0]!;
  const seats = [];
  await client.query('BEGIN');
  for (const role of ['MEMBER', 'ORG_ADMIN']) {
    const user = randomUUID(),
      actor = randomUUID(),
      seat = randomUUID();
    seats.push({ actor, seat });
    await client.query(
      `INSERT INTO "User"(id,name,email,"emailVerified","updatedAt") VALUES($1,'Synthetic M030 preservation',$2,true,now())`,
      [user, 'm030-' + user + '@example.test'],
    );
    await client.query(
      `INSERT INTO "Space"(id,kind,"ownerUserId","updatedAt") VALUES($1,'PERSONAL',$2,now())`,
      [randomUUID(), user],
    );
    await client.query(
      `INSERT INTO "SharedActor"(id,"spaceId","userId",state) VALUES($1,$2,$3,'ACTIVE')`,
      [actor, company.spaceId, user],
    );
    await client.query(
      `INSERT INTO "ContextAccess"(id,"spaceId","scopeId","actorId",state,"memberRole","joinedAt") VALUES($1,$2,$2,$3,'ACTIVE',$4,clock_timestamp())`,
      [seat, company.spaceId, actor, role],
    );
    await client.query(
      `INSERT INTO "ContextAccessInterval"("accessId",generation,"joinedAt") SELECT id,generation,"joinedAt" FROM "ContextAccess" WHERE id=$1`,
      [seat],
    );
  }
  const subject = seats[0]!,
    reviewer = seats[1]!,
    resource = randomUUID(),
    employeeCase = randomUUID();
  await client.query(
    `INSERT INTO "CompanyStaffProfile"(id,"spaceId","scopeId","memberAccessId","memberGeneration",position,"workStatus") VALUES($1,$2,$2,$3,1,'Preserved work profile','ACTIVE')`,
    [randomUUID(), company.spaceId, subject.seat],
  );
  await client.query(
    `INSERT INTO "CompanyAvailabilityDay"(id,"spaceId","scopeId","memberAccessId","memberGeneration",date,timezone,"availableMinutes") VALUES($1,$2,$2,$3,1,'2026-11-07','UTC',NULL)`,
    [randomUUID(), company.spaceId, subject.seat],
  );
  await client.query(
    `INSERT INTO "CompanyResource"(id,"spaceId","scopeId","createdByActorId",title,state) VALUES($1,$2,$2,$3,'Preserved laptop','ACTIVE')`,
    [resource, company.spaceId, company.actorId],
  );
  await client.query(
    `INSERT INTO "CompanyResourceAllocation"(id,"spaceId","scopeId","resourceId","memberAccessId","memberGeneration","createdByActorId","startAt","endAt",state) VALUES($1,$2,$2,$3,$4,1,$5,'2026-11-07T08:00:00Z','2026-11-07T09:00:00Z','ALLOCATED')`,
    [randomUUID(), company.spaceId, resource, subject.seat, company.actorId],
  );
  await client.query(
    `INSERT INTO "CompanyEmployeeCase"(id,"spaceId","scopeId","authorAccessId","authorGeneration","subjectAccessId","subjectGeneration","reviewerAccessId","reviewerGeneration",reason,evidence,state) VALUES($1,$2,$2,$3,1,$4,1,$5,1,'Preserved confidential reason','Preserved evidence','OPEN')`,
    [
      employeeCase,
      company.spaceId,
      company.accessId,
      subject.seat,
      reviewer.seat,
    ],
  );
  await client.query(
    `INSERT INTO "CompanyEmployeeCaseEntry"(id,"spaceId","scopeId","caseId","createdByActorId",kind,body) VALUES($1,$2,$2,$3,$4,'RESPONSE','Preserved confidential response')`,
    [randomUUID(), company.spaceId, employeeCase, subject.actor],
  );
  await client.query('COMMIT');
  const populated = async () => {
    const result: Record<string, unknown> = {};
    for (const name of (
      await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name`,
        [schema],
      )
    ).rows)
      result[name.table_name] = (
        await client.query(
          'SELECT to_jsonb(t) row FROM "' +
            name.table_name +
            '" t ORDER BY to_jsonb(t)::text',
        )
      ).rows;
    return result;
  };
  const data = await populated();
  input.deploy();
  assert.deepEqual(await populated(), data);
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
    '2cb90db886074953fcea33bba180735a03253b2b5f12aea46c9c6f6961773273',
  );
  process.stdout.write(
    'PASS: P4-02 preserves all 151 populated predecessor datasets, 53 checksums and every prior constraint except additive usage CHECK; interrupted rollback, repeat deploy, all six populated new tables and final cleanup FK catalog.\n',
  );
  await verifyCompanyFinanceUpgrade(input);
}
