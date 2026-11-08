import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import type { Client } from 'pg';
import {
  messagingMediaMigrationName as name,
  assertReviewedMessagingMediaMigration,
} from './reviewed-messaging-media-migration.ts';
export async function verifyMessagingMediaUpgrade(input: {
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
  assert.equal(tables.length, 205);
  const e = (
    await client.query('SELECT * FROM "MessageEntry" ORDER BY id LIMIT 1')
  ).rows[0];
  assert.ok(e);
  // Populate every M041 relation before preserving all predecessor datasets.
  const values = [e.conversationId, e.id, e.memberId, e.memberGeneration];
  await client.query(
    'INSERT INTO "MessageRevision" ("messageId",revision,text,"editedAt") VALUES($1,1,\'Historical original\',clock_timestamp())',
    [e.id],
  );
  await client.query(
    'INSERT INTO "MessageHidden" ("conversationId","messageId","memberId") VALUES($1,$2,$3)',
    values.slice(0, 3),
  );
  await client.query(
    'INSERT INTO "MessageReaction" ("conversationId","messageId","memberId",emoji,active,"updatedAt") VALUES($1,$2,$3,\'ok\',true,clock_timestamp())',
    values.slice(0, 3),
  );
  await client.query(
    'INSERT INTO "MessageMention" ("conversationId","messageId","memberId",generation) VALUES($1,$2,$3,$4)',
    values,
  );
  await client.query(
    'INSERT INTO "MessagePin" ("conversationId","messageId","memberId",active,"updatedAt") VALUES($1,$2,$3,true,clock_timestamp())',
    values.slice(0, 3),
  );
  await client.query(
    'INSERT INTO "MessageReport" (id,"conversationId","messageId","memberId",generation,reason) VALUES($5,$1,$2,$3,$4,\'Preserved report\')',
    [...values, randomUUID()],
  );
  await client.query(
    'INSERT INTO "MessageModeration" (id,"conversationId","messageId","memberId",reason) VALUES($4,$1,$2,$3,\'Preserved moderation\')',
    [...values.slice(0, 3), randomUUID()],
  );
  await client.query(
    'INSERT INTO "MessagePolicy" ("conversationId",revision,"memberId","authorDelete",reason) VALUES($1,2,$2,true,\'Preserved policy\')',
    [e.conversationId, e.memberId],
  );
  await client.query(
    'INSERT INTO "MessageMutation" ("conversationId","memberId",generation,"keyHash",fingerprint,"resourceId",action) VALUES($1,$2,$3,repeat(\'a\',64),repeat(\'b\',64),$4,\'preservation\')',
    [e.conversationId, e.memberId, e.memberGeneration, e.id],
  );
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const { table } of tables) {
      assert.match(table, /^[A-Za-z0-9_]+$/);
      result[table] = (
        await client.query(
          "SELECT to_jsonb(t)-'messagingWebPush'-'messagingEnabledAt' row FROM \"" +
            table +
            "\" t ORDER BY (to_jsonb(t)-'messagingWebPush'-'messagingEnabledAt')::text",
        )
      ).rows;
    }
    return result;
  };
  const constraints = async () =>
    (
      await client.query<{ table: string; name: string; definition: string }>(
        'SELECT t.relname "table",c.conname name,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace=$1::regnamespace ORDER BY t.relname,c.conname',
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
  assert.equal(ledger.length, 65);
  const sql = fs.readFileSync(
    'prisma/migrations/' + name + '/migration.sql',
    'utf8',
  );
  assertReviewedMessagingMediaMigration(name, sql);
  await assert.rejects(
    client.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')),
    { code: '22012' },
  );
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await constraints(), oldConstraints);
  assert.equal(
    (await client.query('SELECT to_regclass(\'"MessageActivity"\') name'))
      .rows[0].name,
    null,
  );
  input.copy(name);
  input.deploy();
  input.deploy();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (
      await client.query(
        'SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 65',
      )
    ).rows,
    ledger,
  );
  const current = await constraints();
  for (const c of oldConstraints) {
    if (c.name === 'MessageEntry_shape') continue;
    assert.deepEqual(
      current.find((v) => v.table === c.table && v.name === c.name),
      c,
    );
  }
  assert.equal(
    (await client.query('SELECT count(*)::int n FROM "MessageActivity"'))
      .rows[0].n,
    0,
    'No historical push backfill',
  );
  assert.equal(
    (
      await client.query(
        'SELECT count(*)::int n FROM "NotificationPreference" WHERE "messagingWebPush" OR "messagingEnabledAt" IS NOT NULL',
      )
    ).rows[0].n,
    0,
  );
  const shape = current.find(
    (v) => v.name === 'MessageEntry_shape',
  )!.definition;
  assert.match(shape, /'MEDIA'/);
  assert.match(shape, /'TEXT'/);
  assert.match(shape, /'FORWARD'/);
  const text = randomUUID();
  await client.query(
    'INSERT INTO "ConversationMessage" (id,"spaceId","scopeId","conversationId",sequence,"memberId","memberGeneration",text,"keyHash",fingerprint) SELECT $1,c."spaceId",c."scopeId",c.id,2,$2,$3,\'New trigger fixture\',repeat(\'1\',64),repeat(\'2\',64) FROM "Conversation" c WHERE c.id=$4',
    [text, e.memberId, e.memberGeneration, e.conversationId],
  );
  assert.equal(
    (
      await client.query(
        'SELECT count(*)::int n FROM "MessageActivity" WHERE "messageId"=$1 AND kind=\'MESSAGE\'',
        [text],
      )
    ).rows[0].n,
    1,
  );
  const media = randomUUID();
  await client.query(
    'INSERT INTO "MessageEntry" (id,"conversationId",sequence,"memberId","memberGeneration",kind) VALUES($1,$2,3,$3,$4,\'MEDIA\')',
    [media, e.conversationId, e.memberId, e.memberGeneration],
  );
  await client.query(
    'INSERT INTO "MessageMedia" ("messageId",caption) VALUES($1,NULL)',
    [media],
  );
  await client.query(
    'INSERT INTO "MessageMediaRevision" ("messageId",revision,caption,"editedAt") VALUES($1,1,NULL,clock_timestamp())',
    [media],
  );
  await assert.rejects(
    client.query(
      'UPDATE "MessageMediaRevision" SET caption=\'tamper\' WHERE "messageId"=$1',
      [media],
    ),
    { code: '23514' },
  );
  await assert.rejects(
    client.query(
      'INSERT INTO "MessageProgress" ("conversationId","memberId",generation,"deliveredThrough","readThrough") VALUES($1,$2,$3,0,1)',
      [e.conversationId, e.memberId, e.memberGeneration],
    ),
    { code: '23514' },
  );
  const fks = (
    await client.query(
      'SELECT t.relname "table",c.conname name,r.relname target,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid WHERE c.contype=\'f\' AND c.connamespace=$1::regnamespace',
      [schema],
    )
  ).rows;
  fks.sort((a, b) =>
    a.table + '|' + a.name < b.table + '|' + b.name ? -1 : 1,
  );
  assert.equal(fks.length, 698);
  assert.equal(
    createHash('sha256').update(JSON.stringify(fks)).digest('hex'),
    'd436234ba7935d306ccbb32ee1d78eeb7a980d52b21e1ed332cb3e8ab73014e7',
  );
  assert.equal(
    (
      await client.query(
        'SELECT count(*)::int n FROM pg_tables WHERE schemaname=$1',
        [schema],
      )
    ).rows[0].n,
    215,
  );
  process.stdout.write(
    'PASS: M042 preserves 205 predecessor datasets, populated eleven-table M041 history, 65 checksums and every constraint except the reviewed additive media branch; interrupted rollback/repeat deploy, no historical notice backfill, immutable media revisions, progress CHECK and exact 698-FK catalog.\n',
  );
}
