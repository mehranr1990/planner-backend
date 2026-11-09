import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as c from '../../packages/api-contracts/dist/index.js';
type Http = (
  method: string,
  route: string,
  body?: unknown,
  cookie?: string,
  headers?: Record<string, string>,
) => Promise<{ body: Record<string, unknown> }>;
export async function beforePrivacyRestart(
  http: Http,
  id: string,
  owner: string,
  peer: string,
) {
  const root = '/api/v1/conversations/' + id;
  const snapshot = c.MessageRecoveryPageSchema.parse(
    (await http('GET', root + '/recovery?limit=1', undefined, owner)).body,
  );
  const progress = c.MessageProgressSchema.parse(
    (await http('GET', root + '/progress', undefined, peer)).body,
  );
  const block = c.DmContactBlockSchema.parse(
    (
      await http(
        'POST',
        '/api/v1/messaging/blocks',
        { conversationId: id, active: true },
        peer,
        { 'If-Match': '"1"', 'Idempotency-Key': randomUUID() },
      )
    ).body,
  );
  assert.equal(block.active, true);
  await assert.rejects(
    http(
      'POST',
      root + '/messages',
      { id: randomUUID(), text: 'Must remain blocked' },
      owner,
      { 'Idempotency-Key': randomUUID() },
    ),
    /returned 403/,
  );
  return { snapshot, progress, block };
}
export async function afterPrivacyRestart(
  http: Http,
  id: string,
  owner: string,
  peer: string,
  state: Awaited<ReturnType<typeof beforePrivacyRestart>>,
) {
  const root = '/api/v1/conversations/' + id;
  assert.deepEqual(
    c.DmContactBlockSchema.parse(
      (await http('GET', root + '/contact-block', undefined, peer)).body,
    ),
    state.block,
  );
  assert.equal(
    c.DmContactBlockSchema.parse(
      (await http('GET', root + '/contact-block', undefined, owner)).body,
    ).active,
    false,
  );
  assert.deepEqual(
    c.MessageProgressSchema.parse(
      (await http('GET', root + '/progress', undefined, peer)).body,
    ),
    state.progress,
  );
  if (state.snapshot.nextCursor) {
    const page = c.MessageRecoveryPageSchema.parse(
      (
        await http(
          'GET',
          root +
            '/recovery?limit=1&cursor=' +
            encodeURIComponent(state.snapshot.nextCursor),
          undefined,
          owner,
        )
      ).body,
    );
    assert.equal(page.throughSequence, state.snapshot.throughSequence);
    assert.equal(page.changeCursor, state.snapshot.changeCursor);
  }
  await assert.rejects(
    http(
      'POST',
      root + '/messages',
      { id: randomUUID(), text: 'Still blocked after restart' },
      owner,
      { 'Idempotency-Key': randomUUID() },
    ),
    /returned 403/,
  );
  const unblocked = c.DmContactBlockSchema.parse(
    (
      await http(
        'POST',
        '/api/v1/messaging/blocks',
        { blockId: state.block.id, active: false },
        peer,
        {
          'If-Match': '"' + state.block.revision + '"',
          'Idempotency-Key': randomUUID(),
        },
      )
    ).body,
  );
  assert.equal(unblocked.active, false);
  process.stdout.write(
    'PASS: P5-06 compiled API restart preserves a finite REST recovery cursor, private progress and pair blocking; both denied sends remain denied, the counterpart block list stays private and explicit owner unblock succeeds.\n',
  );
}
