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
const key = () => ({ 'Idempotency-Key': randomUUID() }),
  revision = (value: number) => ({ ...key(), 'If-Match': '"' + value + '"' });
export async function beforeMeetingsRestart(
  http: Http,
  db: Client,
  owner: string,
  peer: { id: string; cookie: string },
  policy: string,
) {
  const event = {
    title: 'Meeting smoke private',
    schedule: {
      kind: 'ALL_DAY',
      timezone: 'UTC',
      startDate: '2026-12-01',
      endDate: '2026-12-02',
    },
  };
  const meeting = c.MeetingSchema.parse(
      (
        await http(
          'POST',
          '/api/v1/meetings',
          {
            id: randomUUID(),
            kind: 'INDEPENDENT',
            event,
            participants: [peer.id],
            retentionPolicyVersion: policy,
          },
          owner,
          key(),
        )
      ).body,
    ),
    root = '/api/v1/meetings/' + meeting.id;
  const invitation = c.MeetingInvitationPageSchema.parse(
    (await http('GET', '/api/v1/meetings/invitations', undefined, peer.cookie))
      .body,
  ).items.find((x) => x.meetingId === meeting.id)!;
  await http(
    'POST',
    '/api/v1/meetings/invitations/' + invitation.id + '/respond',
    { decision: 'ACCEPTED' },
    peer.cookie,
    revision(invitation.revision),
  );
  const members = c.MeetingMemberPageSchema.parse(
    (await http('GET', root + '/members', undefined, owner)).body,
  ).items;
  const me = (
    await db.query(
      'SELECT m.id FROM "MeetingMember" m JOIN "SharedActor" a ON a.id=m."actorId" WHERE m."meetingId"=$1 AND a."userId"=$2',
      [meeting.id, peer.id],
    )
  ).rows[0].id;
  assert.ok(members.some((x) => x.id === me));
  async function upload() {
    const bytes = Buffer.from('Private meeting smoke bytes'),
      f = c.MeetingFileSchema.parse(
        (
          await http(
            'POST',
            root + '/attachments',
            {
              id: randomUUID(),
              filename: 'minutes.txt',
              mimeType: 'text/plain',
              expectedSize: bytes.length,
            },
            owner,
            key(),
          )
        ).body,
      );
    return c.MeetingFileSchema.parse(
      (
        await http(
          'POST',
          root + '/attachments/' + f.id + '/complete',
          bytes,
          owner,
          { 'Content-Type': 'application/octet-stream' },
        )
      ).body,
    );
  }
  const file = await upload(),
    orphan = await upload();
  let version = c.MeetingVersionSchema.parse(
    (
      await http(
        'POST',
        root + '/versions',
        {
          id: randomUUID(),
          minutes: 'Exact immutable minutes',
          decisions: [{ id: randomUUID(), text: 'Approved decision' }],
          actions: [{ id: randomUUID(), title: 'Private personal action' }],
          attachments: [file.id],
          reviewerMemberId: me,
        },
        owner,
        key(),
      )
    ).body,
  );
  version = c.MeetingVersionSchema.parse(
    (
      await http(
        'POST',
        root + '/versions/' + version.id + '/submit',
        {},
        owner,
        revision(version.revision),
      )
    ).body,
  );
  version = c.MeetingVersionSchema.parse(
    (
      await http(
        'POST',
        root + '/versions/' + version.id + '/review',
        { decision: 'APPROVE', reason: 'Exact snapshot approved' },
        peer.cookie,
        revision(version.revision),
      )
    ).body,
  );
  version = c.MeetingVersionSchema.parse(
    (
      await http(
        'POST',
        root + '/versions/' + version.id + '/finalize',
        {},
        owner,
        revision(version.revision),
      )
    ).body,
  );
  const action = version.actions[0]!.id,
    taskKey = key(),
    link = c.MeetingTaskLinkSchema.parse(
      (
        await http(
          'POST',
          root + '/actions/' + action + '/tasks',
          {},
          peer.cookie,
          taskKey,
        )
      ).body,
    );
  assert.ok(link.personal && link.task);
  const project = c.ProjectSchema.parse(
    (
      await http(
        'POST',
        '/api/v1/projects',
        {
          id: randomUUID(),
          title: 'Meeting announcement source',
          retentionPolicyVersion: policy,
        },
        owner,
        key(),
      )
    ).body,
  );
  const announcement = c.AnnouncementSchema.parse(
      (
        await http(
          'POST',
          '/api/v1/announcements',
          { id: randomUUID(), kind: 'PROJECT', sourceId: project.id },
          owner,
          key(),
        )
      ).body,
    ),
    annRoot = '/api/v1/announcements/' + announcement.id;
  let notice = c.AnnouncementVersionSchema.parse(
    (
      await http(
        'POST',
        annRoot + '/versions',
        {
          id: randomUUID(),
          title: 'Announcement',
          text: 'Immutable audience text',
          acknowledgement: true,
        },
        owner,
        key(),
      )
    ).body,
  );
  notice = c.AnnouncementVersionSchema.parse(
    (
      await http(
        'POST',
        annRoot + '/versions/' + notice.id + '/publish',
        { audience: 'ALL' },
        owner,
        revision(notice.revision),
      )
    ).body,
  );
  await http(
    'POST',
    annRoot + '/versions/' + notice.id + '/acknowledge',
    {},
    owner,
  );
  // Age only these freshly created fixture rows; linked content must survive worker GC.
  await db.query(
    'UPDATE "StoredFile" SET "createdAt"=clock_timestamp()-interval \'2 days\',"uploadExpiresAt"=clock_timestamp()-interval \'1 day\' WHERE id=ANY($1::uuid[])',
    [[file.id, orphan.id]],
  );
  await db.query(
    'UPDATE "MeetingAttachment" SET "createdAt"=clock_timestamp()-interval \'2 days\' WHERE id=ANY($1::uuid[])',
    [[file.id, orphan.id]],
  );
  return {
    root,
    version: version.id,
    action,
    link: link.id,
    task: link.task!.id,
    taskKey,
    file: file.id,
    orphan: orphan.id,
    annRoot,
    notice: notice.id,
  };
}
type State = Awaited<ReturnType<typeof beforeMeetingsRestart>>;
export async function afterMeetingsRestart(
  http: Http,
  owner: string,
  peer: string,
  state: State,
) {
  const v = c.MeetingVersionSchema.parse(
    (
      await http(
        'GET',
        state.root + '/versions/' + state.version,
        undefined,
        peer,
      )
    ).body,
  );
  assert.equal(v.state, 'FINAL');
  assert.equal(v.minutes, 'Exact immutable minutes');
  const link = c.MeetingTaskLinkSchema.parse(
    (
      await http(
        'POST',
        state.root + '/actions/' + state.action + '/tasks',
        {},
        peer,
        state.taskKey,
      )
    ).body,
  );
  assert.equal(link.id, state.link);
  assert.equal(link.task?.id, state.task);
  const file = await http(
    'GET',
    state.root + '/attachments/' + state.file + '/download',
    undefined,
    peer,
  );
  assert.equal(
    Buffer.from(String(file.body.binary), 'base64').toString(),
    'Private meeting smoke bytes',
  );
  const summary = c.AnnouncementAcknowledgementSummarySchema.parse(
    (
      await http(
        'GET',
        state.annRoot + '/versions/' + state.notice + '/acknowledgements',
        undefined,
        owner,
      )
    ).body,
  );
  assert.equal(summary.eligible, 1);
  assert.equal(summary.acknowledged, 1);
}
export async function meetingsGarbageCollected(db: Client, state: State) {
  const rows = (
    await db.query(
      'SELECT id,status,"purgedAt" FROM "StoredFile" WHERE id=ANY($1::uuid[])',
      [[state.file, state.orphan]],
    )
  ).rows;
  assert.equal(rows.find((r) => r.id === state.file).status, 'READY');
  return !!rows.find((r) => r.id === state.orphan)?.purgedAt;
}
