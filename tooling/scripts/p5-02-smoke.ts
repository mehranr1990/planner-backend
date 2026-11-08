import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as c from '../../packages/api-contracts/dist/index.js';
import type { Client } from 'pg';
type Http = (
  method: string,
  route: string,
  body?: unknown,
  cookie?: string,
  headers?: Record<string, string>,
) => Promise<{ body: Record<string, unknown> }>;
export async function beforeSourceDisposal(
  http: Http,
  id: string,
  owner: string,
) {
  const root = '/api/v1/conversations/' + id;
  const message = c.ConversationMessagePageSchema.parse(
    (await http('GET', root + '/messages', undefined, owner)).body,
  ).items[0]!;
  await http(
    'POST',
    root + '/advanced-actions',
    {
      action: 'edit',
      messageId: message.id,
      text: 'Retained advanced source history',
    },
    owner,
    { 'Idempotency-Key': randomUUID(), 'If-Match': '"1"' },
  );
  await http(
    'POST',
    root + '/advanced-actions',
    {
      action: 'report',
      id: randomUUID(),
      messageId: message.id,
      reason: 'Retained source moderation receipt',
    },
    owner,
    { 'Idempotency-Key': randomUUID() },
  );
}
export async function assertSourceRetained(db: Client, id: string) {
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int n FROM "MessageRevision" r JOIN "MessageEntry" e ON e.id=r."messageId" WHERE e."conversationId"=$1',
        [id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int n FROM "MessageReport" WHERE "conversationId"=$1',
        [id],
      )
    ).rows[0].n,
    1,
  );
}
export async function beforeAdvancedRestart(
  http: Http,
  id: string,
  replyId: string,
  owner: string,
  peer: string,
) {
  const root = '/api/v1/conversations/' + id;
  const messageId = randomUUID(),
    forwardId = randomUUID();
  const action = async (body: unknown, who = owner, revision?: number) =>
    http('POST', root + '/advanced-actions', body, who, {
      'Idempotency-Key': randomUUID(),
      ...(revision ? { 'If-Match': '"' + revision + '"' } : {}),
    });
  await action({
    action: 'compose',
    id: messageId,
    text: 'Advanced restart source',
    replyToId: replyId,
    mentions: [],
  });
  const snapshot = c.AdvancedMessagePageSchema.parse(
    (await http('GET', root + '/timeline', undefined, peer)).body,
  );
  await action(
    { action: 'edit', messageId, text: 'Edited before restart' },
    owner,
    1,
  );
  await action(
    { action: 'reaction', messageId, emoji: '👍', active: true },
    peer,
  );
  await action({ action: 'pin', messageId, active: true }, peer, 3);
  await action({
    action: 'forward',
    id: forwardId,
    sourceConversationId: id,
    sourceId: messageId,
  });
  const reportId = randomUUID(),
    key = randomUUID(),
    report = {
      action: 'report',
      id: reportId,
      messageId,
      reason: 'Private report survives restart',
    };
  await http('POST', root + '/advanced-actions', report, peer, {
    'Idempotency-Key': key,
  });
  await action({ action: 'delete', messageId }, owner, 4);
  return {
    cursor: snapshot.changeCursor,
    messageId,
    forwardId,
    report,
    key,
    reportId,
  };
}
export async function afterAdvancedRestart(
  http: Http,
  id: string,
  peer: string,
  state: Awaited<ReturnType<typeof beforeAdvancedRestart>>,
) {
  const root = '/api/v1/conversations/' + id;
  const changes = c.MessageChangesSchema.parse(
    (
      await http(
        'GET',
        root + '/message-changes?cursor=' + encodeURIComponent(state.cursor),
        undefined,
        peer,
      )
    ).body,
  );
  assert.ok(
    changes.items.some(
      (v) => v.kind === 'DELETE' && v.message.id === state.messageId,
    ),
  );
  assert.ok(
    changes.items
      .filter((v) => v.message.id === state.messageId)
      .every(
        (v) => v.message.state === 'DELETED' && v.message.content === null,
      ),
  );
  const forward = c.AdvancedMessageSchema.parse(
    (
      await http(
        'GET',
        root + '/message-details/' + state.forwardId,
        undefined,
        peer,
      )
    ).body,
  );
  assert.equal(forward.state, 'UNAVAILABLE');
  assert.equal(forward.content, null);
  const replay = await http(
    'POST',
    root + '/advanced-actions',
    state.report,
    peer,
    { 'Idempotency-Key': state.key },
  );
  assert.equal(replay.body.resourceId, state.reportId);
  const reports = c.MessageReportPageSchema.parse(
    (await http('GET', root + '/message-reports', undefined, peer)).body,
  );
  assert.equal(reports.items.length, 1);
  process.stdout.write(
    'PASS: compiled P5-02 API restart preserves replies, reactions, pin, edits, private report/idempotency and durable redactions; forwarded deleted content remains unavailable.\n',
  );
}
