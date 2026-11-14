import { z } from 'zod';
import {
  CalendarEventCreateSchema,
  CalendarEventPatchSchema,
} from './calendar.js';
import { TeamCalendarEventSchema } from './team-work.js';
import { FileUploadSchema, FileNameSchema, FileMimeSchema } from './files.js';
import { ConversationPageQuerySchema } from './messaging.js';
const id = z.uuid(),
  revision = z.number().int().positive(),
  text = (max: number) =>
    z
      .string()
      .trim()
      .min(1)
      .max(max)
      .refine((v) => !v.includes('\0'));
export const MeetingPageQuerySchema = ConversationPageQuerySchema;
export const MeetingEmptySchema = z.strictObject({});
export const MeetingLeftSchema = z.strictObject({ left: z.literal(true) });
export const MeetingRemovedSchema = z.strictObject({
  removed: z.literal(true),
});
export const MeetingInvitationRevokedSchema = z.strictObject({
  revoked: z.literal(true),
});
export const MeetingExternalUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password;
    } catch {
      return false;
    }
  });
const create = {
  id,
  event: CalendarEventCreateSchema.omit({ recurrence: true }),
  externalUrl: MeetingExternalUrlSchema.nullable().default(null),
  participants: z
    .array(id)
    .max(199)
    .refine((v) => new Set(v).size === v.length)
    .default([]),
};
export const MeetingCreateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...create,
    kind: z.literal('INDEPENDENT'),
    retentionPolicyVersion: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
  }),
  ...(['PROJECT', 'TEAM', 'COMPANY'] as const).map((kind) =>
    z
      .strictObject({
        ...create,
        kind: z.literal(kind),
        sourceId: id,
        /** Source-roster `actorId`s, resolved only after organizer authorization. */
        participantActorIds: create.participants,
      })
      .refine(
        (v) => v.participants.length + v.participantActorIds.length <= 199,
      ),
  ),
]);
export const MeetingPatchSchema = z
  .strictObject({
    event: CalendarEventPatchSchema.optional(),
    externalUrl: MeetingExternalUrlSchema.nullable().optional(),
    state: z.enum(['ACTIVE', 'CANCELED']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0)
  .refine((v) => !v.state || !v.event?.status || v.state === v.event.status);
export const MeetingSchema = z.strictObject({
  id,
  kind: z.enum(['INDEPENDENT', 'PROJECT', 'TEAM', 'COMPANY']),
  sourceId: id.nullable(),
  legacyTeamMeetingId: id.nullable(),
  event: TeamCalendarEventSchema,
  externalUrl: MeetingExternalUrlSchema.nullable(),
  state: z.enum(['ACTIVE', 'CANCELED']),
  revision,
  createdAt: z.iso.datetime(),
  role: z.enum(['ORGANIZER', 'PARTICIPANT']),
  currentFinalVersionId: id.nullable(),
});
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item).max(100),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });
export const MeetingPageSchema = page(MeetingSchema);
/** Invite by account `userId` or by a roster `actorId` of the meeting's space. */
export const MeetingInviteInputSchema = z.union([
  z.strictObject({ id, userId: id }),
  z.strictObject({ id, actorId: id }),
]);
export const MeetingInvitationSchema = z.strictObject({
  id,
  meetingId: id,
  title: text(300),
  schedule: TeamCalendarEventSchema.shape.schedule,
  state: z.enum([
    'PENDING',
    'ACCEPTED',
    'TENTATIVE',
    'DECLINED',
    'REVOKED',
    'EXPIRED',
    'UNAVAILABLE',
  ]),
  revision,
  expiresAt: z.iso.datetime(),
});
export const MeetingInvitationPageSchema = page(MeetingInvitationSchema);
export const MeetingRsvpSchema = z.strictObject({
  decision: z.enum(['ACCEPTED', 'TENTATIVE', 'DECLINED']),
});
export const MeetingMemberSchema = z.strictObject({
  displayName: z.string().nullable().optional(),
  id,
  actorId: id,
  role: z.enum(['ORGANIZER', 'PARTICIPANT']),
  state: z.enum(['ACTIVE', 'LEFT', 'REVOKED']),
  rsvp: z.enum(['ACCEPTED', 'TENTATIVE', 'DECLINED']),
  generation: revision,
  revision,
});
export const MeetingMemberPageSchema = page(MeetingMemberSchema);
export const MeetingAccessMeSchema = MeetingMemberSchema.omit({
  id: true,
}).extend({
  meetingId: id,
  memberId: id,
  capabilities: z.array(
    z.enum([
      'meeting.read',
      'membership.leave',
      'agenda.propose',
      'minutes.draft',
      'meeting.manage',
    ]),
  ),
});
export const MeetingMemberRoleSchema = z.strictObject({
  role: z.enum(['ORGANIZER', 'PARTICIPANT']),
});
export const MeetingAgendaCreateSchema = z.strictObject({
  id,
  text: text(10000),
});
export const MeetingAgendaSelectSchema = z.strictObject({
  state: z.enum(['ACCEPTED', 'REJECTED']),
});
export const MeetingAgendaSchema = z.strictObject({
  id,
  meetingId: id,
  memberId: id,
  text: text(10000),
  state: z.enum(['PROPOSED', 'ACCEPTED', 'REJECTED']),
  revision,
  createdAt: z.iso.datetime(),
});
export const MeetingAgendaPageSchema = page(MeetingAgendaSchema);
export const MeetingDecisionInputSchema = z.strictObject({
  id,
  text: text(10000),
  /** Current meeting member credited with the decision (informational). */
  proposedByMemberId: id.optional(),
});
export const MeetingActionInputSchema = z.strictObject({
  id,
  title: text(300),
  description: z
    .string()
    .max(10000)
    .refine((v) => !v.includes('\0'))
    .nullable()
    .default(null),
  /** Informational only: release/conversion rights are unchanged. */
  assigneeMemberId: id.optional(),
  dueDate: z.iso
    .date()
    .refine((v) => v >= '0001-01-01')
    .optional(),
});
const MeetingDecisionSchema = MeetingDecisionInputSchema.extend({
  proposedByMemberId: id.nullable(),
});
const MeetingActionSchema = MeetingActionInputSchema.extend({
  assigneeMemberId: id.nullable(),
  dueDate: z.iso.date().nullable(),
});
export const MeetingVersionCreateSchema = z
  .strictObject({
    id,
    parentId: id.optional(),
    minutes: z
      .string()
      .max(50000)
      .refine((v) => !v.includes('\0')),
    decisions: z.array(MeetingDecisionInputSchema).max(50),
    actions: z.array(MeetingActionInputSchema).max(100),
    attachments: z.array(id).max(20).default([]),
    contributors: z.array(id).max(50).default([]),
    reviewerMemberId: id.optional(),
  })
  .refine((v) =>
    [
      v.decisions.map((x) => x.id),
      v.actions.map((x) => x.id),
      v.attachments,
      v.contributors,
    ].every((list) => new Set(list).size === list.length),
  );
export const MeetingReviewerSchema = z.strictObject({ memberId: id });
export const MeetingReviewInputSchema = z.strictObject({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: text(2000),
});
export const MeetingVersionSchema = z.strictObject({
  agenda: z.array(z.strictObject({ id, text: text(10000) })).max(1000),
  id,
  meetingId: id,
  number: revision,
  parentId: id.nullable(),
  authorMemberId: id,
  reviewerMemberId: id.nullable(),
  minutes: z.string().max(50000),
  state: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'FINAL']),
  revision,
  selfFinalized: z.boolean(),
  createdAt: z.iso.datetime(),
  finalizedAt: z.iso.datetime().nullable(),
  decisions: z.array(MeetingDecisionSchema).max(50),
  actions: z.array(MeetingActionSchema).max(100),
  attachments: z.array(id).max(20),
  contributors: z.array(id).max(50),
  review: z
    .strictObject({
      id,
      decision: z.enum(['APPROVE', 'REJECT']),
      reason: text(2000),
    })
    .nullable(),
});
export const MeetingVersionPageSchema = page(MeetingVersionSchema);
export const MeetingActionReleaseSchema = z.strictObject({
  active: z.boolean(),
});
export const MeetingActionReleaseResultSchema = z.strictObject({
  actionId: id,
  active: z.boolean(),
  revision,
});
export const MeetingTaskCommandSchema = z.strictObject({
  taskId: id.optional(),
});
export const MeetingTaskLinkSchema = z.strictObject({
  id,
  actionId: id,
  personal: z.boolean(),
  task: z.strictObject({ id, revision, title: text(300) }).nullable(),
});
export const MeetingTaskLinkPageSchema = page(MeetingTaskLinkSchema);
export const MeetingFileUploadSchema = FileUploadSchema.extend({ id });
export const MeetingFileSchema = z.strictObject({
  id,
  filename: FileNameSchema,
  mimeType: FileMimeSchema,
  status: z.enum(['INITIATED', 'READY', 'REJECTED', 'DELETED']),
  expectedSize: z.number().int().positive(),
  actualSize: z.number().int().positive().nullable(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  revision,
  createdAt: z.iso.datetime(),
  uploadExpiresAt: z.iso.datetime(),
  shared: z.boolean(),
});
export const MeetingFilePageSchema = page(MeetingFileSchema);
export const AnnouncementCreateSchema = z.strictObject({
  id,
  kind: z.enum(['PROJECT', 'TEAM', 'COMPANY']),
  sourceId: id,
});
export const AnnouncementSchema = z.strictObject({
  id,
  kind: z.enum(['PROJECT', 'TEAM', 'COMPANY']),
  sourceId: id,
  revision,
  createdAt: z.iso.datetime(),
});
export const AnnouncementVersionInputSchema = z
  .strictObject({
    id,
    title: text(300),
    text: text(50000),
    acknowledgement: z.boolean().default(false),
    attachments: z.array(id).max(20).default([]),
  })
  .refine((v) => new Set(v.attachments).size === v.attachments.length);
export const AnnouncementPublishSchema = z.discriminatedUnion('audience', [
  z.strictObject({ audience: z.literal('ALL') }),
  z.strictObject({
    audience: z.literal('NAMED'),
    members: z
      .array(z.strictObject({ accessId: id, generation: revision }))
      .min(1)
      .max(1000)
      .refine((v) => new Set(v.map((x) => x.accessId)).size === v.length),
  }),
]);
export const AnnouncementPinSchema = z.strictObject({ pinned: z.boolean() });
export const AnnouncementVersionSchema = z.strictObject({
  /** Display name of the version author; null when no longer resolvable. */
  authorDisplayName: z.string().nullable().optional(),
  id,
  announcementId: id,
  number: revision,
  title: text(300),
  text: text(50000),
  acknowledgement: z.boolean(),
  state: z.enum(['DRAFT', 'PUBLISHED', 'WITHDRAWN']),
  pinned: z.boolean(),
  revision,
  publishedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  attachments: z.array(id).max(20),
  acknowledged: z.boolean(),
});
export const AnnouncementVersionPageSchema = page(AnnouncementVersionSchema);
export const AnnouncementAcknowledgementSchema = z.strictObject({
  versionId: id,
  acknowledged: z.literal(true),
});
export const AnnouncementAcknowledgementSummarySchema = z.strictObject({
  versionId: id,
  eligible: z.number().int().nonnegative(),
  acknowledged: z.number().int().nonnegative(),
});
