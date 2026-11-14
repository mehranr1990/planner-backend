import * as c from './meetings.js';
import {
  messagingOperationPaths,
  type Operation,
} from './messaging-openapi.js';
export const meetingOperations: Operation[] = [
  {
    path: '/meetings/{id}/access/me',
    method: 'get',
    output: c.MeetingAccessMeSchema,
  },
  {
    path: '/meetings',
    method: 'get',
    output: c.MeetingPageSchema,
    query: c.MeetingPageQuerySchema,
  },
  {
    path: '/meetings/invitations',
    method: 'get',
    output: c.MeetingInvitationPageSchema,
    query: c.MeetingPageQuerySchema,
  },
  {
    path: '/meetings',
    method: 'post',
    output: c.MeetingSchema,
    input: c.MeetingCreateSchema,
    key: true,
  },
  {
    path: '/meetings/invitations/{invitationId}/respond',
    method: 'post',
    output: c.MeetingInvitationSchema,
    input: c.MeetingRsvpSchema,
    key: true,
    revision: true,
  },
  { path: '/meetings/{id}', method: 'get', output: c.MeetingSchema },
  {
    path: '/meetings/{id}',
    method: 'patch',
    output: c.MeetingSchema,
    input: c.MeetingPatchSchema,
    key: true,
    revision: true,
  },
  {
    path: '/meetings/{id}/invitations',
    method: 'post',
    output: c.MeetingInvitationSchema,
    input: c.MeetingInviteInputSchema,
    key: true,
    revision: true,
  },
  {
    path: '/meetings/{id}/invitations/{invitationId}/revoke',
    method: 'post',
    output: c.MeetingInvitationRevokedSchema,
    input: c.MeetingEmptySchema,
    key: true,
    revision: true,
  },
  {
    path: '/meetings/{id}/members',
    method: 'get',
    output: c.MeetingMemberPageSchema,
    query: c.MeetingPageQuerySchema,
  },
  {
    path: '/meetings/{id}/members/{memberId}',
    method: 'patch',
    output: c.MeetingMemberSchema,
    input: c.MeetingMemberRoleSchema,
    key: true,
    revision: true,
  },
  {
    path: '/meetings/{id}/members/{memberId}/remove',
    method: 'post',
    output: c.MeetingRemovedSchema,
    input: c.MeetingEmptySchema,
    key: true,
    revision: true,
  },
  {
    path: '/meetings/{id}/leave',
    method: 'post',
    output: c.MeetingLeftSchema,
    input: c.MeetingEmptySchema,
    key: true,
    revision: true,
  },
  {
    path: '/meetings/{id}/agenda',
    method: 'get',
    output: c.MeetingAgendaPageSchema,
    query: c.MeetingPageQuerySchema,
  },
  {
    path: '/meetings/{id}/agenda',
    method: 'post',
    output: c.MeetingAgendaSchema,
    input: c.MeetingAgendaCreateSchema,
    key: true,
  },
  {
    path: '/meetings/{id}/agenda/{entryId}',
    method: 'patch',
    output: c.MeetingAgendaSchema,
    input: c.MeetingAgendaSelectSchema,
    key: true,
    revision: true,
  },
  {
    path: '/meetings/{id}/versions',
    method: 'get',
    output: c.MeetingVersionPageSchema,
    query: c.MeetingPageQuerySchema,
  },
  {
    path: '/meetings/{id}/versions',
    method: 'post',
    output: c.MeetingVersionSchema,
    input: c.MeetingVersionCreateSchema,
    key: true,
  },
  {
    path: '/meetings/{id}/versions/{versionId}',
    method: 'get',
    output: c.MeetingVersionSchema,
  },
  {
    path: '/meetings/{id}/versions/{versionId}/reviewer',
    method: 'patch',
    output: c.MeetingVersionSchema,
    input: c.MeetingReviewerSchema,
    key: true,
    revision: true,
  },
  {
    path: '/meetings/{id}/versions/{versionId}/submit',
    method: 'post',
    output: c.MeetingVersionSchema,
    input: c.MeetingEmptySchema,
    key: true,
    revision: true,
  },
  {
    path: '/meetings/{id}/versions/{versionId}/review',
    method: 'post',
    output: c.MeetingVersionSchema,
    input: c.MeetingReviewInputSchema,
    key: true,
    revision: true,
  },
  {
    path: '/meetings/{id}/versions/{versionId}/finalize',
    method: 'post',
    output: c.MeetingVersionSchema,
    input: c.MeetingEmptySchema,
    key: true,
    revision: true,
  },
  {
    path: '/meetings/{id}/versions/{versionId}/withdraw',
    method: 'post',
    output: c.MeetingVersionSchema,
    input: c.MeetingEmptySchema,
    key: true,
    revision: true,
  },
  {
    path: '/meetings/{id}/actions/{actionId}/release',
    method: 'get',
    output: c.MeetingActionReleaseResultSchema,
  },
  {
    path: '/meetings/{id}/actions/{actionId}/release',
    method: 'patch',
    output: c.MeetingActionReleaseResultSchema,
    input: c.MeetingActionReleaseSchema,
    key: true,
    revision: true,
  },
  {
    path: '/meetings/{id}/actions/{actionId}/tasks',
    method: 'post',
    output: c.MeetingTaskLinkSchema,
    input: c.MeetingTaskCommandSchema,
    key: true,
  },
  {
    path: '/meetings/{id}/actions/{actionId}/tasks',
    method: 'get',
    output: c.MeetingTaskLinkPageSchema,
    query: c.MeetingPageQuerySchema,
  },
  {
    path: '/announcements/scopes/{kind}/{scopeId}',
    method: 'get',
    output: c.AnnouncementVersionPageSchema,
    query: c.MeetingPageQuerySchema,
  },
  {
    path: '/announcements',
    method: 'post',
    output: c.AnnouncementSchema,
    input: c.AnnouncementCreateSchema,
    key: true,
  },
  { path: '/announcements/{id}', method: 'get', output: c.AnnouncementSchema },
  {
    path: '/announcements/{id}/versions',
    method: 'get',
    output: c.AnnouncementVersionPageSchema,
    query: c.MeetingPageQuerySchema,
  },
  {
    path: '/announcements/{id}/versions',
    method: 'post',
    output: c.AnnouncementVersionSchema,
    input: c.AnnouncementVersionInputSchema,
    key: true,
  },
  {
    path: '/announcements/{id}/versions/{versionId}',
    method: 'get',
    output: c.AnnouncementVersionSchema,
  },
  {
    path: '/announcements/{id}/versions/{versionId}/publish',
    method: 'post',
    output: c.AnnouncementVersionSchema,
    input: c.AnnouncementPublishSchema,
    key: true,
    revision: true,
  },
  {
    path: '/announcements/{id}/versions/{versionId}/withdraw',
    method: 'post',
    output: c.AnnouncementVersionSchema,
    input: c.MeetingEmptySchema,
    key: true,
    revision: true,
  },
  {
    path: '/announcements/{id}/versions/{versionId}/pin',
    method: 'patch',
    output: c.AnnouncementVersionSchema,
    input: c.AnnouncementPinSchema,
    key: true,
    revision: true,
  },
  {
    path: '/announcements/{id}/versions/{versionId}/acknowledge',
    method: 'post',
    output: c.AnnouncementAcknowledgementSchema,
    input: c.MeetingEmptySchema,
  },
  {
    path: '/announcements/{id}/versions/{versionId}/acknowledgements',
    method: 'get',
    output: c.AnnouncementAcknowledgementSummarySchema,
  },
  {
    path: '/meetings/{id}/attachments',
    method: 'post',
    input: c.MeetingFileUploadSchema,
    output: c.MeetingFileSchema,
    key: true,
  },
  {
    path: '/meetings/{id}/attachments',
    method: 'get',
    query: c.MeetingPageQuerySchema,
    output: c.MeetingFilePageSchema,
  },
  {
    path: '/meetings/{id}/attachments/{attachmentId}',
    method: 'get',
    output: c.MeetingFileSchema,
  },
  {
    path: '/meetings/{id}/attachments/{attachmentId}/complete',
    method: 'post',
    output: c.MeetingFileSchema,
    binary: true,
  },
  {
    path: '/meetings/{id}/attachments/{attachmentId}/cancel',
    method: 'post',
    input: c.MeetingEmptySchema,
    output: c.MeetingFileSchema,
    revision: true,
  },
  {
    path: '/meetings/{id}/attachments/{attachmentId}/download',
    method: 'get',
    output: c.MeetingEmptySchema,
    download: true,
  },
  {
    path: '/meetings/{id}/attachments/{attachmentId}/share',
    method: 'post',
    input: c.MeetingEmptySchema,
    output: c.MeetingFileSchema,
    revision: true,
    key: true,
  },
  {
    path: '/announcements/{id}/attachments',
    method: 'post',
    input: c.MeetingFileUploadSchema,
    output: c.MeetingFileSchema,
    key: true,
  },
  {
    path: '/announcements/{id}/attachments',
    method: 'get',
    query: c.MeetingPageQuerySchema,
    output: c.MeetingFilePageSchema,
  },
  {
    path: '/announcements/{id}/attachments/{attachmentId}',
    method: 'get',
    output: c.MeetingFileSchema,
  },
  {
    path: '/announcements/{id}/attachments/{attachmentId}/complete',
    method: 'post',
    output: c.MeetingFileSchema,
    binary: true,
  },
  {
    path: '/announcements/{id}/attachments/{attachmentId}/cancel',
    method: 'post',
    input: c.MeetingEmptySchema,
    output: c.MeetingFileSchema,
    revision: true,
  },
  {
    path: '/announcements/{id}/attachments/{attachmentId}/download',
    method: 'get',
    output: c.MeetingEmptySchema,
    download: true,
  },
  {
    path: '/teams/{id}/meetings/{meetingId}/extend',
    method: 'post',
    input: c.MeetingEmptySchema,
    output: c.MeetingSchema,
    revision: true,
    key: true,
  },
];
export function meetingPaths() {
  const paths = messagingOperationPaths(meetingOperations);
  for (const methods of Object.values(paths))
    for (const value of Object.values(methods)) {
      const op = value as {
        operationId: string;
        tags: string[];
        parameters: { name: string; schema: unknown }[];
        responses: Record<string, { description: string }>;
      };
      op.operationId = op.operationId.replace(/^messaging/, 'meetings');
      op.tags = ['meetings'];
      for (const p of op.parameters)
        if (p.name === 'kind')
          p.schema = { type: 'string', enum: ['PROJECT', 'TEAM', 'COMPANY'] };
      for (const [code, r] of Object.entries(op.responses))
        if (Number(code) < 300)
          r.description = 'Current authorized meeting or announcement result';
    }
  return paths;
}
