import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import * as c from '../../packages/api-contracts/dist/index.js';
type Http = (
  method: string,
  route: string,
  body?: unknown,
  cookie?: string,
  headers?: Record<string, string>,
) => Promise<{ body: Record<string, unknown> }>;
export async function beforeSocialRestart(
  http: Http,
  db: Client,
  owner: { id: string; cookie: string },
  peer: { id: string; cookie: string },
  version: string,
) {
  const key = () => ({ 'Idempotency-Key': randomUUID() }),
    revision = (n: number) => ({ ...key(), 'If-Match': `"${n}"` });
  const email = (
    await db.query('SELECT email FROM "User" WHERE id=$1', [peer.id])
  ).rows[0].email as string;
  c.SocialPrivacySchema.parse(
    (
      await http(
        'PATCH',
        '/api/v1/social/privacy',
        { discoverable: true },
        peer.cookie,
        revision(1),
      )
    ).body,
  );
  const discovered = c.SocialDiscoveryResultSchema.parse(
    (await http('POST', '/api/v1/social/discovery', { email }, owner.cookie))
      .body,
  );
  assert.equal(discovered.items[0]?.id, peer.id);
  const connection = c.SocialConnectionSchema.parse(
    (
      await http(
        'POST',
        '/api/v1/social/connections',
        { id: randomUUID(), recipientUserId: peer.id },
        owner.cookie,
        key(),
      )
    ).body,
  );
  const accepted = c.SocialConnectionSchema.parse(
    (
      await http(
        'POST',
        `/api/v1/social/connections/${connection.id}/accept`,
        {},
        peer.cookie,
        revision(1),
      )
    ).body,
  );
  assert.equal(accepted.state, 'ACCEPTED');
  const circle = c.SocialCircleSchema.parse(
    (
      await http(
        'POST',
        '/api/v1/social/circles',
        { id: randomUUID(), name: 'Private restart Circle' },
        owner.cookie,
        key(),
      )
    ).body,
  );
  await http(
    'PUT',
    `/api/v1/social/circles/${circle.id}/members/${connection.id}`,
    {},
    owner.cookie,
    revision(1),
  );
  let group = c.SocialGroupSchema.parse(
    (
      await http(
        'POST',
        '/api/v1/social-groups',
        {
          id: randomUUID(),
          name: 'Restart Social Group',
          description: 'Private group description',
          publicSummary: 'Explicit public summary',
          discoverable: true,
          retentionPolicyVersion: version,
        },
        owner.cookie,
        key(),
      )
    ).body,
  );
  const renamed = c.SocialGroupSchema.parse(
    (
      await http(
        'PATCH',
        `/api/v1/social-groups/${group.id}`,
        { name: 'Renamed restart Group' },
        owner.cookie,
        { 'If-Match': '"1"' },
      )
    ).body,
  );
  assert.equal(renamed.discoverable, true);
  assert.equal(renamed.publicSummary, group.publicSummary);
  group = renamed;
  const invite = c.SocialGroupInvitationDeliverySchema.parse(
    (
      await http(
        'POST',
        `/api/v1/social-groups/${group.id}/invitations`,
        {
          kind: 'MEMBERSHIP',
          memberRole: 'MEMBER',
          recipient: { userId: peer.id },
        },
        owner.cookie,
        key(),
      )
    ).body,
  );
  const admission = c.SocialGroupInvitationAcceptanceSchema.parse(
    (
      await http(
        'POST',
        `/api/v1/social-group-invitations/${invite.invitation.id}/accept`,
        {},
        peer.cookie,
        { 'X-Invitation-Proof': invite.proof!, 'If-Match': '"1"' },
      )
    ).body,
  );
  const block = c.DmContactBlockSchema.parse(
    (
      await http(
        'POST',
        '/api/v1/social/blocks',
        { targetUserId: peer.id },
        owner.cookie,
        revision(1),
      )
    ).body,
  );
  return { connection, circle, group, admission, block };
}
export async function afterSocialRestart(
  http: Http,
  owner: { id: string; cookie: string },
  peer: { id: string; cookie: string },
  state: Awaited<ReturnType<typeof beforeSocialRestart>>,
) {
  await assert.rejects(http('GET', '/api/v1/openapi.json'), /returned 404/);
  await assert.rejects(http('GET', '/api/v1/docs'), /returned 404/);
  const connections = c.SocialConnectionPageSchema.parse(
    (await http('GET', '/api/v1/social/connections', undefined, owner.cookie))
      .body,
  );
  assert.equal(
    connections.items.find((r) => r.id === state.connection.id)?.state,
    'REMOVED',
  );
  const labels = c.SocialCircleMemberPageSchema.parse(
    (
      await http(
        'GET',
        `/api/v1/social/circles/${state.circle.id}/members`,
        undefined,
        owner.cookie,
      )
    ).body,
  );
  assert.deepEqual(labels.items, []);
  const group = c.SocialGroupSchema.parse(
    (
      await http(
        'GET',
        `/api/v1/social-groups/${state.group.id}`,
        undefined,
        peer.cookie,
      )
    ).body,
  );
  assert.equal(group.description, state.group.description);
  const members = c.SocialMembershipPageSchema.parse(
    (
      await http(
        'GET',
        `/api/v1/social-groups/${state.group.id}/memberships`,
        undefined,
        peer.cookie,
      )
    ).body,
  );
  assert.equal(members.items.length, 2);
  const previews = c.SocialGroupDiscoveryPageSchema.parse(
    (
      await http(
        'GET',
        '/api/v1/social-groups/discover',
        undefined,
        peer.cookie,
      )
    ).body,
  );
  assert.deepEqual(
    previews.items.find((g) => g.id === group.id),
    { id: group.id, name: group.name, publicSummary: group.publicSummary },
  );
  const blocks = c.DmContactPageSchema.parse(
    (await http('GET', '/api/v1/social/blocks', undefined, owner.cookie)).body,
  );
  assert.equal(blocks.items.find((b) => b.id === state.block.id)?.active, true);
  process.stdout.write(
    'PASS: P6-01 compiled API restart preserves opt-in discovery, mutually accepted then blocked/removed friendship, private Circle cleanup, approved Group admission, private content and minimal discoverable previews; existing compiled worker runs against fresh isolated data only.\n',
  );
}
