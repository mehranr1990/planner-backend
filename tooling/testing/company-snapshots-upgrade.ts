import { verifyCompanyStaffUpgrade } from './company-staff-upgrade.ts';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  companySnapshotsName,
  assertReviewedCompanySnapshots,
} from './reviewed-company-invitation-snapshots.ts';
export async function verifyCompanySnapshotsUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input,
    space = randomUUID(),
    actor = randomUUID(),
    seat = randomUUID(),
    department = randomUUID(),
    unit = randomUUID(),
    child = randomUUID(),
    offer = randomUUID(),
    retention = 'migration-company-' + randomUUID();
  const user = (
    await client.query<{ id: string }>(
      'SELECT id FROM "User" ORDER BY id LIMIT 1',
    )
  ).rows[0]!.id;
  const roles = Object.fromEntries(
    ['OWNER', 'ORG_ADMIN', 'DEPT_MANAGER', 'TEAM_LEAD', 'MEMBER', 'VIEWER'].map(
      (r) => [r, ['task.read']],
    ),
  );
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO "SharedRetentionPolicy"(version,"approvalReference",configuration) SELECT $1::text,"approvalReference",configuration||jsonb_build_object('policyVersion',$1::text,'applicableContexts',jsonb_build_array('COMPANY')) FROM "SharedRetentionPolicy" ORDER BY version LIMIT 1`,
    [retention],
  );
  await client.query(
    `INSERT INTO "Space"(id,kind,"ownerUserId","updatedAt") VALUES($1,'SHARED',NULL,now())`,
    [space],
  );
  await client.query(
    `INSERT INTO "SharedCustody"("spaceId",kind,state,"primaryOwnerAccessId","retentionPolicyVersion") VALUES($1,'COMPANY','ACTIVE',$2,$3)`,
    [space, seat, retention],
  );
  await client.query(
    `INSERT INTO "SharedActor"(id,"spaceId","userId",state) VALUES($1,$2,$3,'ACTIVE')`,
    [actor, space, user],
  );
  for (const [id, kind] of [
    [space, 'ROOT'],
    [department, 'DEPARTMENT'],
    [unit, 'UNIT'],
  ]) {
    await client.query(
      `INSERT INTO "AccessScope"(id,"spaceId",kind) VALUES($1,$2,$3)`,
      [id, space, kind],
    );
    await client.query(
      `INSERT INTO "ContextCapabilityPolicy"("spaceId","scopeId",version,"roleDefaults","exportMaxRecords","exportMaxBytes","publishedByActorId","auditId") VALUES($1,$2,1,$3,10000,10485760,$4,$5)`,
      [space, id, JSON.stringify(roles), actor, randomUUID()],
    );
    await client.query(
      `INSERT INTO "CompanyScopePolicy"("spaceId","scopeId",version,rules,"createdByActorId","auditId") VALUES($1,$2,1,'[]',$3,$4)`,
      [space, id, actor, randomUUID()],
    );
  }
  await client.query(
    `INSERT INTO "ContextAccess"(id,"spaceId","scopeId","actorId",state,"memberRole","joinedAt") VALUES($1,$2,$2,$3,'ACTIVE','ORG_ADMIN',now()),($4,$2,$5,$3,'ACTIVE','DEPT_MANAGER',now())`,
    [seat, space, actor, child, department],
  );
  await client.query(
    `INSERT INTO "ContextAccessInterval"("accessId",generation,"joinedAt") SELECT id,generation,"joinedAt" FROM "ContextAccess" WHERE "spaceId"=$1`,
    [space],
  );
  await client.query(
    `INSERT INTO "CompanyContextAdmission"("spaceId","scopeId","accessId",generation,"actorId","rootScopeId","rootAccessId","rootGeneration") VALUES($1,$2,$3,1,$4,$1,$5,1)`,
    [space, department, child, actor, seat],
  );
  const common = `(id,"spaceId","scopeId","createdByActorId",title,"creationKey","creationFingerprint")`;
  await client.query(
    `INSERT INTO "Company"${common} VALUES($1,$1,$1,$2,'Preserved Company',$3,$3)`,
    [space, actor, 'a'.repeat(64)],
  );
  await client.query(
    `INSERT INTO "CompanyDepartment"${common} VALUES($1,$2,$1,$3,'Preserved Department',$4,$4)`,
    [department, space, actor, 'b'.repeat(64)],
  );
  await client.query(
    `INSERT INTO "CompanyUnit"(id,"spaceId","scopeId","createdByActorId",title,"creationKey","creationFingerprint","departmentId") VALUES($1,$2,$1,$3,'Preserved Unit',$4,$4,$5)`,
    [unit, space, actor, 'c'.repeat(64), department],
  );
  await client.query(
    `INSERT INTO "ContextInvitation"(id,"spaceId","scopeId","inviterAccessId","inviterGeneration","recipientUserId","memberRole","proofHash","keyHash",fingerprint,"createdAt","expiresAt","companyScopeId","companyIssuerAccessId","companyIssuerGeneration","companyRestoreGeneration") VALUES($1,$2,$2,$3,1,$4,'MEMBER',$5,$6,$6,now(),now()+interval '168 hours',$2,$3,1,0)`,
    [offer, space, seat, user, 'd'.repeat(64), 'e'.repeat(64)],
  );
  await client.query('COMMIT');
  const columns = (
      await client.query<{ table_name: string; column_name: string }>(
        `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position`,
        [schema],
      )
    ).rows,
    tables = [...new Set(columns.map((c) => c.table_name))];
  assert.equal(tables.length, 151);
  const snapshot = async () => {
    const data: Record<string, unknown> = {};
    for (const name of tables) {
      const fields = columns
        .filter((c) => c.table_name === name)
        .map((c) => '"' + c.column_name + '"')
        .join(',');
      data[name] = (
        await client.query(
          'SELECT to_jsonb(t) row FROM (SELECT ' +
            fields +
            ' FROM "' +
            name +
            '") t ORDER BY to_jsonb(t)::text',
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
  assert.equal(ledger.length, 52);
  const sql = fs.readFileSync(
    'prisma/migrations/' + companySnapshotsName + '/migration.sql',
    'utf8',
  );
  assertReviewedCompanySnapshots(companySnapshotsName, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  input.copy(companySnapshotsName);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 52',
      )
    ).rows,
    ledger,
  );
  const saved = (
    await client.query(
      `SELECT state,"proofHash","recipientUserId","companyAdmissionVersion" FROM "ContextInvitation" WHERE id=$1`,
      [offer],
    )
  ).rows[0];
  assert.equal(saved.state, 'PENDING');
  assert.equal(saved.proofHash, 'd'.repeat(64));
  assert.equal(saved.recipientUserId, user);
  assert.equal(saved.companyAdmissionVersion, null);
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
    'd1ac2453d5ebdd6b82f3ba6021d549a8e77f31f75055492a3bc2b33bdab3ad5b',
  );
  process.stdout.write(
    'PASS: P4-01 companion preserves all 151 populated datasets, 52 checksums, Company hierarchy/admission and legacy pending offer state/recipient/proof bytes; rollback/repeat deploy and final FK catalog. Unsupported old Company offers remain denied by application validation.\n',
  );
  await verifyCompanyStaffUpgrade(input);
}
