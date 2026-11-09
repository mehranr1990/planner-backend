import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  meetingsMigrationName as name,
  assertReviewedMeetingsMigration,
} from './reviewed-meetings-migration.ts';
export async function verifyMeetingsUpgrade(input: {
  client: Client;
  schema: string;
  copy: (name: string) => void;
  deploy: () => void;
}) {
  const { client, schema } = input;
  const tables = (
    await client.query<{ table: string }>(
      'SELECT tablename "table" FROM pg_tables WHERE schemaname=$1 AND tablename<>\'_prisma_migrations\' ORDER BY tablename',
      [schema],
    )
  ).rows;
  assert.equal(tables.length, 214);
  const e = (
    await client.query(
      'SELECT e.*,c."spaceId",c."scopeId",m."actorId" FROM "MessageEntry" e JOIN "Conversation" c ON c.id=e."conversationId" JOIN "ConversationMember" m ON m.id=e."memberId" WHERE e.kind=\'MEDIA\' ORDER BY e.id LIMIT 1',
    )
  ).rows[0];
  assert.ok(e);
  const file = randomUUID(),
    notice = randomUUID();
  await client.query(
    `INSERT INTO "StoredFile"(id,"spaceId","scopeId","createdByActorId","objectKey",filename,"mimeType","expectedSize","uploadExpiresAt","updatedAt") VALUES($1,$2,$3,$4,$5,'preserved.txt','text/plain',4,clock_timestamp()+interval '1 hour',clock_timestamp())`,
    [file, e.spaceId, e.scopeId, e.actorId, randomUUID()],
  );
  await client.query(
    `INSERT INTO "MessageAttachment"(id,"fileId","spaceId","scopeId","conversationId","memberId",generation,"messageId",kind,"keyHash",fingerprint) VALUES($1,$1,$2,$3,$4,$5,$6,$7,'FILE',repeat('a',64),repeat('b',64))`,
    [
      file,
      e.spaceId,
      e.scopeId,
      e.conversationId,
      e.memberId,
      e.memberGeneration,
      e.id,
    ],
  );
  await client.query(
    `INSERT INTO "MessageProgress"("conversationId","memberId",generation,"deliveredThrough","readThrough") VALUES($1,$2,$3,1,0)`,
    [e.conversationId, e.memberId, e.memberGeneration],
  );
  await client.query(
    `INSERT INTO "MessageNoticePreference"("conversationId","memberId",generation,"effectiveAt") VALUES($1,$2,$3,clock_timestamp())`,
    [e.conversationId, e.memberId, e.memberGeneration],
  );
  await client.query(
    `INSERT INTO "MessagePersonalMutation"("conversationId","memberId",generation,"keyHash",fingerprint) VALUES($1,$2,$3,repeat('c',64),repeat('d',64))`,
    [e.conversationId, e.memberId, e.memberGeneration],
  );
  const activity = (
    await client.query(
      'SELECT id FROM "MessageActivity" WHERE "messageId"=$1',
      [e.id],
    )
  ).rows[0].id;
  await client.query(
    `INSERT INTO "MessageNotice"(id,"spaceId","conversationId","activityId","actorId","memberId",generation) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      notice,
      e.spaceId,
      e.conversationId,
      activity,
      e.actorId,
      e.memberId,
      e.memberGeneration,
    ],
  );
  await client.query(
    `INSERT INTO "MessageNoticeAttempt"(id,"noticeId","subscriptionRevision") VALUES($1,$2,1)`,
    [randomUUID(), notice],
  );
  for (const table of [
    'MessageAttachment',
    'MessageMedia',
    'MessageMediaRevision',
    'MessageProgress',
    'MessageNoticePreference',
    'MessagePersonalMutation',
    'MessageActivity',
    'MessageNotice',
    'MessageNoticeAttempt',
  ])
    assert.ok(
      (await client.query('SELECT count(*)::int n FROM "' + table + '"'))
        .rows[0].n > 0,
      table,
    );
  const snapshot = async () => {
    const rows: Record<string, unknown> = {};
    for (const { table } of tables) {
      assert.match(table, /^[A-Za-z0-9_]+$/);
      rows[table] = (
        await client.query(
          'SELECT to_jsonb(t) row FROM "' +
            table +
            '" t ORDER BY to_jsonb(t)::text',
        )
      ).rows;
    }
    return rows;
  };
  const constraints = async () =>
    (
      await client.query<{ table: string; name: string; definition: string }>(
        'SELECT t.relname "table",c.conname name,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace ORDER BY t.relname,c.conname',
        [schema],
      )
    ).rows;
  const before = await snapshot(),
    old = await constraints(),
    ledger = (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
  assert.equal(ledger.length, 66);
  const sql = fs.readFileSync(
    'prisma/migrations/' + name + '/migration.sql',
    'utf8',
  );
  assertReviewedMeetingsMigration(name, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
    { code: '22012' },
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await constraints(), old);
  assert.equal(
    (await client.query(`SELECT to_regclass('"Meeting"') name`)).rows[0].name,
    null,
  );
  input.copy(name);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 66',
      )
    ).rows,
    ledger,
  );
  const current = await constraints();
  for (const c of old) {
    const now = current.find((v) => v.table === c.table && v.name === c.name);
    assert.ok(now);
    if (
      ['SharedCustody_kind_check', 'SharedUsageEntry_feature_check'].includes(
        c.name,
      )
    ) {
      for (const literal of c.definition.match(/'[^']+'/g) ?? [])
        assert.ok(now.definition.includes(literal));
    } else assert.deepEqual(now, c);
  }
  const fks = (
    await client.query(
      'SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype=\'f\' AND c.connamespace=$1::regnamespace',
      [schema],
    )
  ).rows;
  fks.sort((a, b) =>
    a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1,
  );
  assert.equal(fks.length, 760);
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    'b7a5fdbbc7844bf3f4559191da855ed0a41a31441197af26ba22a5ca3df7f26f',
  );
  assert.equal(
    (
      await client.query(
        'SELECT count(*)::int n FROM pg_tables WHERE schemaname=$1',
        [schema],
      )
    ).rows[0].n,
    236,
  );
  process.stdout.write(
    'PASS: M043 preserves 214 predecessor datasets, all nine populated M042 relations, 66 checksums and every old constraint except two additive CHECK expansions; interrupted rollback/repeat deploy, no Push backfill and exact 760-FK catalog.\n',
  );
}
