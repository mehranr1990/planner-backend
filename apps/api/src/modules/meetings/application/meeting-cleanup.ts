import type { Prisma } from '../../../generated/prisma/client.js';
import {
  sharedChildDeleteBatch,
  sharedDeleteBatch,
  type SharedCleanupScope,
} from '../../../platform/lifecycle/shared-cleanup.js';
export async function purgeMeetings(
  tx: Prisma.TransactionClient,
  s: SharedCleanupScope,
) {
  s.verify(tx);
  const meeting = [{ table: 'Meeting', foreignKey: 'meetingId' }],
    announcement = [{ table: 'Announcement', foreignKey: 'announcementId' }];
  if (!(await sharedDeleteBatch(tx, s, ['AnnouncementReminder']))) return false;
  if (
    !(await sharedChildDeleteBatch(tx, s, 'AnnouncementAcknowledgement', [
      { table: 'AnnouncementVersion', foreignKey: 'versionId' },
      ...announcement,
    ]))
  )
    return false;
  if (
    !(await sharedChildDeleteBatch(tx, s, 'AnnouncementTarget', [
      { table: 'AnnouncementVersion', foreignKey: 'versionId' },
      ...announcement,
    ]))
  )
    return false;
  for (const table of [
    'AnnouncementVersionAttachment',
    'AnnouncementVersion',
    'AnnouncementMutation',
  ])
    if (!(await sharedChildDeleteBatch(tx, s, table, announcement)))
      return false;
  // FINAL versions and approval-review cycles are mutable only under M044's
  // actual lifecycle claim. Ordinary final content retains SQL immutability.
  const reset = await tx.$executeRawUnsafe(
    `UPDATE "MeetingVersion" SET state='DRAFT',"approvedReviewId"=NULL,"finalizedAt"=NULL,"selfFinalized"=false WHERE id IN(SELECT v.id FROM "MeetingVersion" v JOIN "Meeting" m ON m.id=v."meetingId" WHERE m."spaceId"=$1::uuid ${s.scopeId ? 'AND m."scopeId"=$2::uuid' : ''} AND (v.state<>'DRAFT' OR v."approvedReviewId" IS NOT NULL OR v."selfFinalized") LIMIT 200)`,
    s.spaceId,
    ...(s.scopeId ? [s.scopeId] : []),
  );
  if (reset) return false;
  for (const table of [
    'MeetingTaskLink',
    'MeetingActionRelease',
    'MeetingAction',
    'MeetingDecision',
    'MeetingReview',
    'MeetingDraftContributor',
    'MeetingVersionAttachment',
  ])
    if (!(await sharedChildDeleteBatch(tx, s, table, meeting))) return false;
  if (
    !(await sharedChildDeleteBatch(
      tx,
      s,
      'MeetingVersion',
      meeting,
      'AND NOT EXISTS(SELECT 1 FROM "MeetingVersion" child WHERE child."parentId"=t.id)',
    ))
  )
    return false;
  if (
    await tx.meetingVersion.count({
      where: {
        meeting: {
          spaceId: s.spaceId,
          ...(s.scopeId ? { scopeId: s.scopeId } : {}),
        },
      },
    })
  )
    return false;
  if (!(await sharedDeleteBatch(tx, s, ['MeetingAttachment']))) return false;
  for (const table of [
    'MeetingBusySetting',
    'MeetingAgendaEntry',
    'MeetingInvitation',
    'MeetingMutation',
    'MeetingAdmission',
    'MeetingMember',
  ])
    if (!(await sharedChildDeleteBatch(tx, s, table, meeting))) return false;
  // Task links are removed above. Tasks in other custody, including Personal
  // tasks created by explicit conversion, are never deleted here.
  return sharedDeleteBatch(tx, s, ['Meeting', 'Announcement']);
}
