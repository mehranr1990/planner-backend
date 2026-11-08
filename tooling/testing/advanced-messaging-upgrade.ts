import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  advancedMessagingMigrationName as name,
  assertReviewedAdvancedMessagingMigration,
} from './reviewed-advanced-messaging-migration.ts';
export async function verifyAdvancedMessagingUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input;
  const tables = (
    await client.query<{ table: string }>(
      `SELECT tablename "table" FROM pg_tables WHERE schemaname=$1 AND tablename<>'_prisma_migrations' ORDER BY tablename`,
      [schema],
    )
  ).rows;
  assert.equal(tables.length, 194);
  // Populate all five P5-01 tables before taking the predecessor snapshot.
  const seat = (
    await client.query(
      `SELECT a.*,s."restoreGeneration" FROM "ContextAccess" a JOIN "AccessScope" s ON s.id=a."scopeId" JOIN "Project" p ON p.id=a."scopeId" AND p."spaceId"=a."spaceId" JOIN "ContextAccessInterval" i ON i."accessId"=a.id AND i.generation=a.generation ORDER BY a.id LIMIT 1`,
    )
  ).rows[0];
  assert.ok(seat, 'Populated M040 predecessor source required');
  const second = (
    await client.query(
      `SELECT id FROM "SharedActor" WHERE "spaceId"=$1 AND id<>$2 ORDER BY id LIMIT 1`,
      [seat.spaceId, seat.actorId],
    )
  ).rows[0];
  assert.ok(second);
  const conv = randomUUID(),
    member = randomUUID(),
    message = randomUUID(),
    invite = randomUUID();
  await client.query(
    `INSERT INTO "Conversation" (id,"spaceId","scopeId",kind,"projectId","createdByActorId",title,"creationKeyHash","creationFingerprint","lastSequence") VALUES($1,$2,$3,'PROJECT',$3,$4,'M041 preservation fixture',repeat('a',64),repeat('b',64),1)`,
    [conv, seat.spaceId, seat.scopeId, seat.actorId],
  );
  await client.query(
    `INSERT INTO "ConversationMember" (id,"spaceId","scopeId","conversationId","actorId",role,state,"sourceAccessId","sourceGeneration","restoreGeneration","historyAfter","joinedAt") VALUES($1,$2,$3,$4,$5,'ADMIN','ACTIVE',$6,$7,$8,0,clock_timestamp())`,
    [
      member,
      seat.spaceId,
      seat.scopeId,
      conv,
      seat.actorId,
      seat.id,
      seat.generation,
      seat.restoreGeneration,
    ],
  );
  await client.query(
    `INSERT INTO "ConversationAdmission" ("conversationId","memberId",generation,"historyAfter","joinedAt") SELECT "conversationId",id,1,0,"joinedAt" FROM "ConversationMember" WHERE id=$1`,
    [member],
  );
  await client.query(
    `INSERT INTO "ConversationMessage" (id,"spaceId","scopeId","conversationId",sequence,"memberId","memberGeneration",text,"keyHash",fingerprint) VALUES($1,$2,$3,$4,1,$5,1,'M040 body preserved, never copied',repeat('c',64),repeat('d',64))`,
    [message, seat.spaceId, seat.scopeId, conv, member],
  );
  await client.query(
    `INSERT INTO "ConversationInvitation" (id,"spaceId","scopeId","conversationId","recipientActorId","inviterActorId","inviterAccessId","inviterGeneration","inviterMemberId","inviterMemberGeneration","restoreGeneration","keyHash",fingerprint,"expiresAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,repeat('e',64),repeat('f',64),clock_timestamp()+interval '1 day')`,
    [
      invite,
      seat.spaceId,
      seat.scopeId,
      conv,
      second.id,
      seat.actorId,
      seat.id,
      seat.generation,
      member,
      seat.restoreGeneration,
    ],
  );
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const { table } of tables) {
      assert.match(table, /^[A-Za-z0-9_]+$/);
      result[table] = (
        await client.query(
          `SELECT to_jsonb(t)-'lastChangeSequence'-'messagePolicyRevision' row FROM "${table}" t ORDER BY (to_jsonb(t)-'lastChangeSequence'-'messagePolicyRevision')::text`,
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
  const before = await snapshot(),
    oldConstraints = await constraints(),
    ledger = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
  assert.equal(ledger.length, 64);
  const sql = fs.readFileSync(
    'prisma/migrations/' + name + '/migration.sql',
    'utf8',
  );
  assertReviewedAdvancedMessagingMigration(name, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
    { code: '22012' },
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await constraints(), oldConstraints);
  assert.equal(
    (await client.query(`SELECT to_regclass('"MessageEntry"') name`)).rows[0]
      .name,
    null,
  );
  input.copy(name);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 64',
      )
    ).rows,
    ledger,
  );
  const current = await constraints();
  for (const c of oldConstraints)
    assert.deepEqual(
      current.find((v) => v.table === c.table && v.name === c.name),
      c,
    );
  const entry = (
    await client.query(`SELECT * FROM "MessageEntry" WHERE id=$1`, [message])
  ).rows[0];
  assert.equal(entry.textId, message);
  assert.equal(entry.sequence, '1');
  assert.equal(entry.memberId, member);
  assert.equal(entry.kind, 'TEXT');
  assert.equal(
    (
      await client.query(
        `SELECT "lastChangeSequence"::text n FROM "Conversation" WHERE id=$1`,
        [conv],
      )
    ).rows[0].n,
    '1',
  );
  assert.equal(
    (
      await client.query(
        `SELECT kind FROM "MessageChange" WHERE "conversationId"=$1`,
        [conv],
      )
    ).rows[0].kind,
    'CREATE',
  );
  const fks = (
    await client.query(
      `SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype='f' AND c.connamespace=$1::regnamespace`,
      [schema],
    )
  ).rows;
  fks.sort((a, b) =>
    a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1,
  );
  assert.equal(fks.length, 681);
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    '239451f6a5c4b6d0fedebc41b613c174e39bae9e87047925ff5b2a992f44e267',
  );
  process.stdout.write(
    'PASS: M041 preserves all 194 predecessor datasets, populated five-table M040 messaging history, 64 checksums and every old constraint; verified header/change backfill, interrupted rollback and repeat deploy, exact 681-FK catalog.\n',
  );
}
