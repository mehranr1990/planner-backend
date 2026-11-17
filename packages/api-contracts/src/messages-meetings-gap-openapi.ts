import * as c from './messages-meetings-gap.js';
import { MeetingEmptySchema } from './meetings.js';
import {
  messagingOperationPaths,
  type Operation,
} from './messaging-openapi.js';
export const messagesMeetingsGapOperations: Operation[] = [
  {
    path: '/meetings/{id}/invitations',
    method: 'get',
    output: c.OrganizerInvitationPageSchema,
    query: c.MessagesMeetingsPageQuerySchema,
  },
  {
    path: '/meetings/{id}/agenda/{entryId}/details',
    method: 'get',
    etag: true,
    output: c.AgendaDetailSchema,
  },
  {
    path: '/meetings/{id}/agenda/{entryId}/details',
    method: 'patch',
    etag: true,
    input: c.AgendaDetailPatchSchema,
    output: c.AgendaDetailSchema,
    revision: true,
    key: true,
  },
  {
    path: '/meetings/{id}/agenda/{entryId}/history',
    method: 'get',
    output: c.AgendaHistorySchema,
    query: c.MessagesMeetingsPageQuerySchema,
  },
  {
    path: '/meetings/{id}/agenda-summary',
    method: 'get',
    output: c.AgendaSummarySchema,
  },
  {
    path: '/announcements/{id}/versions/{versionId}/schedule',
    method: 'get',
    etag: true,
    output: c.AnnouncementScheduleResultSchema,
  },
  {
    path: '/announcements/{id}/versions/{versionId}/schedule',
    method: 'post',
    etag: true,
    input: c.AnnouncementScheduleInputSchema,
    output: c.AnnouncementScheduleSchema,
    revision: true,
    key: true,
  },
  {
    path: '/announcements/{id}/versions/{versionId}/schedule/cancel',
    method: 'post',
    etag: true,
    input: MeetingEmptySchema,
    output: c.AnnouncementScheduleSchema,
    revision: true,
    key: true,
  },
];
export const messagesMeetingsGapPaths = () =>
  messagingOperationPaths(messagesMeetingsGapOperations);
