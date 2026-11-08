import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { verifyScopedLifecycleJobsUpgrade } from './scoped-lifecycle-jobs-upgrade.ts';
import {
  companyScopeCustodyMigrationName,
  assertReviewedCompanyScopeCustodyMigration,
} from './reviewed-company-scope-custody-migration.ts';
import {
  domainScopeKeysMigrationName,
  assertReviewedDomainScopeKeysMigration,
} from './reviewed-domain-scope-keys-migration.ts';

/** Populated predecessor rehearsal. It never fabricates a completed custody transfer. */
export async function verifyCompanyScopeCustodyUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input;
  // Earlier upgrade fixtures predate confidential records. Seed their old schema
  // here so M037 must preserve actual bodies and historical admission pairs.
  const team = (
    await client.query<{ spaceId: string }>(
      'SELECT "spaceId" FROM "Team" ORDER BY id LIMIT 1',
    )
  ).rows[0]!;
  const people = (
    await client.query<{ id: string }>(
      'SELECT id FROM "User" ORDER BY id LIMIT 3',
    )
  ).rows;
  assert.equal(people.length, 3);
  const members: { id: string; generation: number; actorId: string }[] = [];
  await client.query('BEGIN');
  try {
    for (const user of people) {
      let actor = (
        await client.query<{ id: string }>(
          'SELECT id FROM "SharedActor" WHERE "spaceId"=$1 AND "userId"=$2 AND state=\'ACTIVE\'',
          [team.spaceId, user.id],
        )
      ).rows[0];
      if (!actor) {
        actor = { id: randomUUID() };
        await client.query(
          'INSERT INTO "SharedActor"(id,"spaceId","userId",state) VALUES($1,$2,$3,\'ACTIVE\')',
          [actor.id, team.spaceId, user.id],
        );
      }
      let member = (
        await client.query<{ id: string; generation: number; actorId: string }>(
          'SELECT id,generation,"actorId" FROM "ContextAccess" WHERE "spaceId"=$1 AND "scopeId"=$1 AND "actorId"=$2',
          [team.spaceId, actor.id],
        )
      ).rows[0];
      if (!member) {
        member = { id: randomUUID(), generation: 1, actorId: actor.id };
        await client.query(
          'INSERT INTO "ContextAccess"(id,"spaceId","scopeId","actorId",state,"memberRole","joinedAt") VALUES($1,$2,$2,$3,\'ACTIVE\',\'MEMBER\',clock_timestamp())',
          [member.id, team.spaceId, actor.id],
        );
        await client.query(
          'INSERT INTO "ContextAccessInterval"("accessId",generation,"joinedAt") SELECT id,generation,"joinedAt" FROM "ContextAccess" WHERE id=$1',
          [member.id],
        );
      }
      members.push(member);
    }
    const caseId = randomUUID();
    await client.query(
      'INSERT INTO "TeamCase"(id,"spaceId","scopeId",kind,"authorAccessId","authorGeneration","subjectAccessId","subjectGeneration","reviewerAccessId","reviewerGeneration",reason,evidence) VALUES($1,$2,$2,\'CORRECTIVE\',$3,$4,$5,$6,$7,$8,\'Synthetic sealed reason\',\'Synthetic sealed evidence\')',
      [
        caseId,
        team.spaceId,
        members[0]!.id,
        members[0]!.generation,
        members[1]!.id,
        members[1]!.generation,
        members[2]!.id,
        members[2]!.generation,
      ],
    );
    await client.query(
      'INSERT INTO "TeamCaseEntry"(id,"spaceId","caseId",kind,body,"createdByActorId") VALUES($1,$2,$3,\'RESPONSE\',\'Synthetic confidential response\',$4)',
      [randomUUID(), team.spaceId, caseId, members[1]!.actorId],
    );
    await client.query(
      'INSERT INTO "TeamDisclosure"(id,"spaceId","caseId","sourceRevision",audience,summary,"expiresAt","restoreGeneration") VALUES($1,$2,$3,1,\'NAMED\',\'Synthetic restricted summary\',clock_timestamp()+interval \'30 minutes\',0)',
      [randomUUID(), team.spaceId, caseId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  const columns = (
    await client.query<{ table: string; column: string }>(
      `SELECT table_name "table",column_name "column" FROM information_schema.columns WHERE table_schema=$1 AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position`,
      [schema],
    )
  ).rows;
  const tables = [...new Set(columns.map((c) => c.table))];
  assert.equal(tables.length, 184);
  const snapshot = async () => {
    const rows: Record<string, unknown> = {};
    for (const table of tables) {
      const projection = columns
        .filter((c) => c.table === table)
        .map((c) => '"' + c.column + '"')
        .join(',');
      rows[table] = (
        await client.query(
          `SELECT to_jsonb(t) row FROM (SELECT ${projection} FROM "${table}") t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    }
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
    oldConstraints = await constraints();
  const ledger = (
    await client.query(
      'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
    )
  ).rows;
  assert.equal(ledger.length, 59);
  for (const [name, review] of [
    [
      companyScopeCustodyMigrationName,
      assertReviewedCompanyScopeCustodyMigration,
    ],
    [domainScopeKeysMigrationName, assertReviewedDomainScopeKeysMigration],
  ] as const) {
    const sql = fs.readFileSync(
      'prisma/migrations/' + name + '/migration.sql',
      'utf8',
    );
    review(name, sql);
    const preceding = await constraints();
    await assert.rejects(
      client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
    );
    await client.query('ROLLBACK');
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await constraints(), preceding);
    input.copy(name);
    input.deploy();
    input.deploy();
    assert.deepEqual(await snapshot(), before);
  }
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 59',
      )
    ).rows,
    ledger,
  );
  const replaced = new Set([
    'TeamCapacityDay_team',
    'TeamCase_Team',
    'TeamMeeting_Team',
    'TeamPlan_spaceId_fkey',
    'TeamWorkItem_spaceId_fkey',
    'TeamWorkItem_spaceId_planId_fkey',
    'TeamWorkItem_sourceSpaceId_taskId_fkey',
    'TeamWorkItem_sourceSpaceId_goalId_fkey',
    'TeamCaseEntry_Case',
    'TeamDisclosure_Case',
    'TeamDisclosureRecipient_Disclosure',
    'TeamMeeting_Event',
    'TeamMeetingInvitation_Meeting',
  ]);
  const after = await constraints();
  for (const row of oldConstraints) {
    const current = after.find(
      (c) => c.table === row.table && c.name === row.name,
    );
    assert.ok(current, 'No existing constraint may disappear: ' + row.name);
    if (!replaced.has(row.name)) assert.deepEqual(current, row);
    else {
      assert.ok(
        current.definition.includes('"scopeId"') ||
          current.definition.includes('"sourceScopeId"'),
      );
      assert.equal(
        current.definition.includes('ON DELETE CASCADE'),
        row.definition.includes('ON DELETE CASCADE'),
      );
      assert.equal(
        current.definition.includes('ON UPDATE CASCADE'),
        row.definition.includes('ON UPDATE CASCADE'),
      );
    }
  }
  for (const table of [
    'TeamPlan',
    'TeamWorkItem',
    'TeamCaseEntry',
    'TeamDisclosure',
    'TeamMeeting',
  ]) {
    assert.equal(
      (
        await client.query<{ count: number }>(
          `SELECT count(*)::int count FROM "${table}" WHERE "scopeId" IS DISTINCT FROM "spaceId"`,
        )
      ).rows[0]!.count,
      0,
    );
    assert.equal(
      (
        await client.query<{ is_nullable: string }>(
          `SELECT is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name='scopeId'`,
          [schema, table],
        )
      ).rows[0]!.is_nullable,
      'NO',
    );
  }
  assert.equal(
    (
      await client.query<{ count: number }>(
        `SELECT count(*)::int count FROM "TeamWorkItem" WHERE "sourceScopeId" IS DISTINCT FROM "sourceSpaceId"`,
      )
    ).rows[0]!.count,
    0,
  );
  for (const table of [
    'SharedAuditEvent',
    'SharedOutboxEvent',
    'SharedUsageEntry',
  ]) {
    assert.equal(
      (
        await client.query<{ count: number }>(
          `SELECT count(*)::int count FROM "${table}" e JOIN "SharedCustody" c ON c."spaceId"=e."spaceId" WHERE (c.kind IN ('PROJECT','TEAM') AND e."scopeId" IS DISTINCT FROM e."spaceId") OR e."originCustodyId" IS NOT NULL`,
        )
      ).rows[0]!.count,
      0,
    );
  }
  // Final guards must reject arbitrary location edits after the one-time backfill.
  const work = (
    await client.query<{ id: string }>(
      'SELECT id FROM "TeamWorkItem" ORDER BY id LIMIT 1',
    )
  ).rows[0];
  assert.ok(work, 'Populated Team work fixture required');
  await assert.rejects(
    client.query(
      'UPDATE "TeamWorkItem" SET "scopeId"=gen_random_uuid(),revision=revision+1 WHERE id=$1',
      [work.id],
    ),
  );
  const entry = (
    await client.query<{ id: string }>(
      'SELECT id FROM "TeamCaseEntry" ORDER BY id LIMIT 1',
    )
  ).rows[0];
  assert.ok(entry, 'Populated confidential Team history fixture required');
  await assert.rejects(
    client.query(
      'UPDATE "TeamCaseEntry" SET "scopeId"=gen_random_uuid() WHERE id=$1',
      [entry.id],
    ),
  );
  assert.deepEqual(await snapshot(), before);
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
  assert.equal(fks.length, 636);
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    'a928cc446f7f36313cf9a0694ac0a7fe83402cf98e7489491981f096bb0eac9f',
  );
  process.stdout.write(
    'PASS: P4-06 scope foundations preserve 184 populated predecessor datasets and 59 checksums; M036/M037 interrupted rollback, repeat deploy, exact backfills, 13 strengthened FKs, immutable confidential history and exact 636-FK catalog. Actual custody transfer remains unexecuted.\n',
  );
  await verifyScopedLifecycleJobsUpgrade(input);
}
