import { z } from 'zod';
import { CalendarEventCreateSchema } from './calendar.js';
import { TeamCalendarEventSchema } from './team-work.js';
const id = z.uuid(),
  revision = z.number().int().positive().max(2147483646),
  text = z
    .string()
    .trim()
    .min(1)
    .max(10000)
    .refine((v) => !v.includes('\0'));
export const TeamMemberReferenceSchema = z.strictObject({
  accessId: id,
  generation: revision,
});
export const TeamCaseCreateSchema = z.strictObject({
  id,
  kind: z.enum(['RECOGNITION', 'FEEDBACK', 'CORRECTIVE']),
  subject: TeamMemberReferenceSchema,
  reviewer: TeamMemberReferenceSchema,
  reason: text,
  evidence: text,
});
export const TeamCaseSchema = TeamCaseCreateSchema.safeExtend({
  teamId: id,
  author: TeamMemberReferenceSchema,
  state: z.enum(['OPEN', 'RESOLVED']),
  revision,
  createdAt: z.iso.datetime(),
});
export const TeamCaseEntryInputSchema = z.strictObject({
  id,
  kind: z.enum(['RESPONSE', 'APPEAL']),
  body: text,
});
export const TeamCaseReviewInputSchema = z.strictObject({
  id,
  body: text,
  resolution: z.enum(['OPEN', 'RESOLVED']),
});
export const TeamCaseEntrySchema = z.strictObject({
  id,
  caseId: id,
  kind: z.enum(['RESPONSE', 'APPEAL', 'REVIEW']),
  body: text,
  createdByActorId: id,
  createdAt: z.iso.datetime(),
});
export const TeamDisclosureCreateSchema = z
  .strictObject({
    id,
    sourceRevision: revision,
    audience: z.enum(['NAMED', 'TEAM']),
    recipients: z.array(TeamMemberReferenceSchema).max(100),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine((v) => !v.includes('\0')),
    expiresAt: z.iso.datetime(),
  })
  .refine((v) =>
    v.audience === 'TEAM' ? v.recipients.length === 0 : v.recipients.length > 0,
  )
  .refine(
    (v) =>
      new Set(v.recipients.map((m) => m.accessId)).size === v.recipients.length,
  );
export const TeamDisclosureProposalSchema =
  TeamDisclosureCreateSchema.safeExtend({
    caseId: id,
    state: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'REVOKED']),
    revision,
    reviewNote: text.nullable(),
    reviewedAt: z.iso.datetime().nullable(),
    subjectConsentedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  });
export const TeamDisclosureReviewSchema = z.strictObject({
  approve: z.boolean(),
  reason: text,
});
export const TeamRecognitionConsentSchema = z.strictObject({
  consent: z.boolean(),
});
export const TeamDisclosureSummarySchema = z.strictObject({
  id,
  kind: TeamCaseCreateSchema.shape.kind,
  summary: TeamDisclosureCreateSchema.shape.summary,
  expiresAt: z.iso.datetime(),
});
export const TeamMeetingCreateSchema = z.strictObject({
  id,
  event: CalendarEventCreateSchema.omit({ recurrence: true }),
  agenda: z
    .string()
    .max(10000)
    .refine((v) => !v.includes('\0')),
});
export const TeamMeetingPatchSchema = z.strictObject({
  agenda: TeamMeetingCreateSchema.shape.agenda,
});
export const TeamMeetingSchema = z.strictObject({
  id,
  teamId: id,
  event: TeamCalendarEventSchema,
  agenda: TeamMeetingCreateSchema.shape.agenda,
  revision,
  createdByActorId: id,
});
export const TeamMeetingInvitationCreateSchema = z.strictObject({
  id,
  member: TeamMemberReferenceSchema,
  expiresAt: z.iso.datetime(),
});
export const TeamMeetingInvitationSchema =
  TeamMeetingInvitationCreateSchema.safeExtend({
    meetingId: id,
    state: z.enum([
      'PENDING',
      'ACCEPTED',
      'DECLINED',
      'REVOKED',
      'EXPIRED',
      'UNAVAILABLE',
    ]),
    revision,
  });
export const TeamMeetingInvitationResponseSchema = z.strictObject({
  decision: z.enum(['ACCEPTED', 'DECLINED']),
});
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item).max(100),
    nextCursor: z.string().nullable(),
  });
export const TeamCasePageSchema = page(TeamCaseSchema),
  TeamCaseEntryPageSchema = page(TeamCaseEntrySchema),
  TeamDisclosureProposalPageSchema = page(TeamDisclosureProposalSchema),
  TeamDisclosureSummaryPageSchema = page(TeamDisclosureSummarySchema),
  TeamMeetingPageSchema = page(TeamMeetingSchema),
  TeamMeetingInvitationPageSchema = page(TeamMeetingInvitationSchema);
