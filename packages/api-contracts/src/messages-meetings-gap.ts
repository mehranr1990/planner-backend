import { z } from 'zod';
import {
  AnnouncementPublishSchema,
  MeetingPageQuerySchema,
  MeetingInvitationSchema,
} from './meetings.js';
import { CalendarZoneSchema as TimezoneSchema } from './calendar.js';
const id = z.uuid(),
  revision = z.number().int().positive();
export const AgendaDetailPatchSchema = z
  .strictObject({
    plannedMinutes: z
      .number()
      .int()
      .positive()
      .max(2147483647)
      .nullable()
      .optional(),
    completed: z.boolean().optional(),
    notes: z
      .string()
      .max(10000)
      .refine((v) => !v.includes('\0'))
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const AgendaDetailSchema = z.strictObject({
  id,
  meetingId: id,
  revision,
  plannedMinutes: z.number().int().positive().nullable(),
  completed: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  notes: z.string(),
  updatedByMemberId: id.nullable(),
  updatedAt: z.iso.datetime().nullable(),
});
export const AgendaHistorySchema = z.strictObject({
  items: z.array(AgendaDetailSchema.extend({ entryId: id })).max(100),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export const AgendaSummarySchema = z.strictObject({
  totalPlannedMinutes: z.number().int().nonnegative(),
  meetingMinutes: z.number().nonnegative().nullable(),
  exceedsMeetingLength: z.boolean(),
});
export const AnnouncementScheduleInputSchema = z.strictObject({
  scheduledAt: z.iso.datetime(),
  timezone: TimezoneSchema,
  audience: AnnouncementPublishSchema,
});
export const AnnouncementScheduleSchema = z.strictObject({
  versionId: id,
  revision,
  status: z.enum(['SCHEDULED', 'CANCELED', 'PUBLISHED']),
  scheduledAt: z.iso.datetime(),
  timezone: TimezoneSchema,
  publishedAt: z.iso.datetime().nullable(),
  audience: AnnouncementPublishSchema,
});
export const AnnouncementScheduleResultSchema =
  AnnouncementScheduleSchema.nullable();
export const OrganizerInvitationSchema = MeetingInvitationSchema.extend({
  recipientActorId: id,
  acceptedMemberId: id.nullable(),
});
export const OrganizerInvitationPageSchema = z.strictObject({
  items: z.array(OrganizerInvitationSchema).max(100),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export { MeetingPageQuerySchema as MessagesMeetingsPageQuerySchema };
