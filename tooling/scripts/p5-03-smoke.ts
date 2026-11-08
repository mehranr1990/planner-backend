import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createECDH, createHash, randomBytes } from 'node:crypto';
import type { Client } from 'pg';
import * as c from '../../packages/api-contracts/dist/index.js';
type Http = (
  method: string,
  route: string,
  body?: unknown,
  cookie?: string,
  headers?: Record<string, string>,
) => Promise<{ body: Record<string, unknown> }>;
export async function beforeMediaRestart(
  http: Http,
  db: Client,
  id: string,
  owner: string,
  peer: { id: string; cookie: string },
) {
  const root = '/api/v1/conversations/' + id,
    space = (
      await db.query(
        'SELECT id FROM "Space" WHERE kind=\'PERSONAL\' AND "ownerUserId"=$1',
        [peer.id],
      )
    ).rows[0].id;
  // Synthetic provider subscription; actual transport is the configured private sink.
  await db.query(
    'INSERT INTO "NotificationPreference" (id,"spaceId","ownerUserId","createdByUserId","webPush","updatedAt") VALUES($1,$2,$3,$3,true,clock_timestamp())',
    [randomUUID(), space, peer.id],
  );
  const key = createECDH('prime256v1');
  key.generateKeys();
  const endpoint = 'https://fcm.googleapis.com/fcm/send/' + randomUUID();
  await db.query(
    'INSERT INTO "PushSubscription" (id,"spaceId","ownerUserId","createdByUserId",endpoint,"endpointHash","endpointHost",auth,p256dh,"updatedAt") VALUES($1,$2,$3,$3,$4,$5,\'fcm.googleapis.com\',$6,$7,clock_timestamp())',
    [
      randomUUID(),
      space,
      peer.id,
      endpoint,
      createHash('sha256').update(endpoint).digest('hex'),
      randomBytes(16).toString('base64url'),
      key.getPublicKey().toString('base64url'),
    ],
  );
  const opt = c.MessagingPushSettingsSchema.parse(
    (
      await http(
        'GET',
        '/api/v1/messaging-notifications/settings',
        undefined,
        peer.cookie,
      )
    ).body,
  );
  await http(
    'PATCH',
    '/api/v1/messaging-notifications/settings',
    { enabled: true },
    peer.cookie,
    { 'Idempotency-Key': randomUUID(), 'If-Match': '"' + opt.revision + '"' },
  );
  const data = Buffer.alloc(16044);
  data.write('RIFF');
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(16000, 40);
  const file = c.MessageAttachmentSchema.parse(
    (
      await http(
        'POST',
        root + '/attachments',
        {
          id: randomUUID(),
          kind: 'VOICE',
          filename: 'private-smoke.wav',
          mimeType: 'audio/wav',
          expectedSize: data.length,
        },
        owner,
        { 'Idempotency-Key': randomUUID() },
      )
    ).body,
  );
  await http(
    'POST',
    root + '/attachments/' + file.id + '/complete',
    data,
    owner,
    { 'Content-Type': 'application/octet-stream' },
  );
  const message = c.RichMessageSchema.parse(
    (
      await http(
        'POST',
        root + '/media-messages',
        {
          id: randomUUID(),
          caption: 'Private smoke caption',
          attachments: [file.id],
          mentions: [],
        },
        owner,
        { 'Idempotency-Key': randomUUID() },
      )
    ).body,
  );
  assert.equal(message.attachments[0]!.durationMs, 1000);
  await http(
    'POST',
    root + '/acknowledgements',
    { messageId: message.id, state: 'READ' },
    peer.cookie,
    { 'Idempotency-Key': randomUUID() },
  );
  const cursor = c.RichMessagePageSchema.parse(
    (await http('GET', root + '/media-timeline', undefined, peer.cookie)).body,
  ).changeCursor;
  return {
    id,
    messageId: message.id,
    fileId: file.id,
    cursor,
    sequence: message.sequence,
    bytes: data.toString('base64'),
  };
}
export async function afterMediaRestart(
  http: Http,
  peer: string,
  state: Awaited<ReturnType<typeof beforeMediaRestart>>,
) {
  const root = '/api/v1/conversations/' + state.id;
  assert.equal(
    c.MessageProgressSchema.parse(
      (await http('GET', root + '/progress', undefined, peer)).body,
    ).readThrough,
    state.sequence,
  );
  const msg = c.RichMessageSchema.parse(
    (
      await http(
        'GET',
        root + '/media-messages/' + state.messageId,
        undefined,
        peer,
      )
    ).body,
  );
  assert.equal(msg.attachments[0]!.durationMs, 1000);
  const downloaded = (
    await http(
      'GET',
      root +
        '/media-messages/' +
        state.messageId +
        '/attachments/' +
        state.fileId +
        '/download',
      undefined,
      peer,
    )
  ).body;
  assert.equal(downloaded.binary, state.bytes);
  const changes = c.RichMessageChangesSchema.parse(
    (
      await http(
        'GET',
        root + '/media-changes?cursor=' + encodeURIComponent(state.cursor),
        undefined,
        peer,
      )
    ).body,
  );
  assert.equal(changes.items.length, 0);
}
export async function pushDelivered(
  db: Client,
  state: Awaited<ReturnType<typeof beforeMediaRestart>>,
) {
  return (
    (
      await db.query(
        'SELECT count(*)::int n FROM "MessageNoticeAttempt" a JOIN "MessageNotice" n ON n.id=a."noticeId" JOIN "MessageActivity" e ON e.id=n."activityId" WHERE e."messageId"=$1 AND a.state=\'DELIVERED\'',
        [state.messageId],
      )
    ).rows[0].n === 1
  );
}
export function assertGenericSink(root: string) {
  const files = fs.readdirSync(root);
  assert.ok(files.length > 0);
  for (const file of files) {
    const value = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(value, /Mehran Planner has new activity/);
    assert.doesNotMatch(
      value,
      /private-smoke|Private smoke caption|p256dh|endpoint|auth/,
    );
  }
}
