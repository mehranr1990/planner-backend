import { z } from 'zod';
import { TaskIdSchema } from './tasks.js';
import { CursorQuerySchema } from './foundation.js';
import { PlanningDateSchema } from './planning.js';
import { CalendarZoneSchema } from './calendar.js';
import { TaskCreateSchema } from './tasks.js';
import { HabitEntryCreateSchema } from './habits.js';
const Id = TaskIdSchema,
  Revision = z.number().int().min(1).max(2147483646);
const clean = (v: string) =>
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]/u.test(v);
export const WritingTitle = z.string().trim().min(1).max(300).refine(clean);
export const WritingText = z
  .string()
  .max(50000)
  .refine(clean)
  .refine((v) => new TextEncoder().encode(v).byteLength <= 100000);
export const WritingContentSchema = z.strictObject({
  format: z.literal('MARKDOWN'),
  version: z.literal(1),
  content: WritingText.refine(
    (v) =>
      !/<\/?[a-z!][^>]*>/i.test(v) &&
      !/(?:javascript|vbscript|data)\s*:/i.test(v),
  ),
});
const root = {
  id: Id,
  revisionId: Id,
  previousRevisionId: Id.nullable(),
  spaceId: Id,
  createdByUserId: Id,
  revision: Revision,
  current: z.boolean(),
  createdAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
};
const patchShape = <T extends z.ZodRawShape>(s: T) =>
  Object.fromEntries(
    Object.entries(s).map(([k, v]) => [
      k,
      v instanceof z.ZodDefault ? v.removeDefault() : v,
    ]),
  ) as { [K in keyof T]: T[K] extends z.ZodDefault<infer U> ? U : T[K] };
const folderFields = {
  title: WritingTitle,
  parentId: Id.nullable().default(null),
  position: z.number().int().min(0).max(9999).default(0),
};
export const NoteFolderCreateSchema = z.strictObject(folderFields);
export const NoteFolderPatchSchema = z
  .strictObject(patchShape(folderFields))
  .partial()
  .extend({ state: z.enum(['ACTIVE', 'ARCHIVED']).optional() })
  .refine((v) => Object.keys(v).length > 0);
export const NoteFolderSchema = z.strictObject({
  id: Id,
  spaceId: Id,
  createdByUserId: Id,
  revision: Revision,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  ...folderFields,
  state: z.enum(['ACTIVE', 'ARCHIVED']),
});
export const NoteFolderPageSchema = z.strictObject({
  items: z.array(NoteFolderSchema).max(100),
  nextCursor: z.string().nullable(),
});
const noteFields = {
  title: WritingTitle,
  content: WritingContentSchema,
  folderId: Id.nullable().default(null),
  taskId: Id.nullable().default(null),
  goalId: Id.nullable().default(null),
};
export const NoteCreateSchema = z.strictObject(noteFields);
export const NotePatchSchema = z
  .strictObject(patchShape(noteFields))
  .partial()
  .extend({ state: z.enum(['ACTIVE', 'ARCHIVED', 'DELETED']).optional() })
  .refine((v) => Object.keys(v).length > 0);
export const NoteSchema = z.strictObject({
  ...root,
  ...noteFields,
  state: z.enum(['ACTIVE', 'ARCHIVED', 'DELETED']),
});
export const NoteQuerySchema = CursorQuerySchema.extend({
  state: z.enum(['ACTIVE', 'ARCHIVED', 'DELETED']).optional(),
  folderId: Id.optional(),
  taskId: Id.optional(),
  goalId: Id.optional(),
});
export const NotePageSchema = z.strictObject({
  items: z.array(NoteSchema).max(100),
  nextCursor: z.string().nullable(),
});
const journalFields = {
  title: WritingTitle.nullable().default(null),
  content: WritingContentSchema,
  localDate: PlanningDateSchema.optional(),
  timezone: CalendarZoneSchema.optional(),
};
export const JournalCreateSchema = z.strictObject(journalFields);
export const JournalPatchSchema = z
  .strictObject({
    title: WritingTitle.nullable().optional(),
    content: WritingContentSchema.optional(),
    deleted: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const JournalEntrySchema = z.strictObject({
  ...root,
  title: WritingTitle.nullable(),
  content: WritingContentSchema,
  localDate: PlanningDateSchema,
  timezone: CalendarZoneSchema,
  kind: z.enum(['FREEFORM', 'CHECK_IN']),
  deleted: z.boolean(),
});
const dates = {
  from: PlanningDateSchema.optional(),
  to: PlanningDateSchema.optional(),
};
const validRange = (v: {
  from?: string | undefined;
  to?: string | undefined;
}) =>
  (v.from === undefined && v.to === undefined) ||
  (v.from !== undefined &&
    v.to !== undefined &&
    v.to > v.from &&
    Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000);
export const JournalQuerySchema = CursorQuerySchema.extend({
  ...dates,
  kind: z.enum(['FREEFORM', 'CHECK_IN']).optional(),
  deleted: z.enum(['true', 'false']).optional(),
}).refine(validRange);
export const JournalPageSchema = z.strictObject({
  items: z.array(JournalEntrySchema).max(100),
  nextCursor: z.string().nullable(),
});
const moodFields = {
  mood: z.number().int().min(1).max(5),
  energy: z.number().int().min(1).max(5).nullable().default(null),
  note: WritingText.nullable().default(null),
};
export const MoodCreateSchema = z.strictObject({
  ...moodFields,
  localDate: PlanningDateSchema.optional(),
  timezone: CalendarZoneSchema.optional(),
  journalEntryId: Id.nullable().default(null),
});
export const MoodPatchSchema = z
  .strictObject(patchShape(moodFields))
  .partial()
  .extend({ void: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0);
export const MoodEntrySchema = z.strictObject({
  ...root,
  ...moodFields,
  localDate: PlanningDateSchema,
  timezone: CalendarZoneSchema,
  journalEntryId: Id.nullable(),
  state: z.enum(['RECORDED', 'VOID']),
});
export const MoodQuerySchema = CursorQuerySchema.extend({
  ...dates,
  journalEntryId: Id.optional(),
  state: z.enum(['RECORDED', 'VOID']).optional(),
  mood: z.enum(['1', '2', '3', '4', '5']).optional(),
  energy: z.enum(['1', '2', '3', '4', '5']).optional(),
}).refine(validRange);
export const MoodPageSchema = z.strictObject({
  items: z.array(MoodEntrySchema).max(100),
  nextCursor: z.string().nullable(),
});
export const DailyCheckinCreateSchema = z.strictObject({
  ...journalFields,
  mood: z.strictObject(moodFields).optional(),
});
export const DailyCheckinSchema = z.strictObject({
  id: Id,
  revision: Revision,
  entry: JournalEntrySchema,
  mood: MoodEntrySchema.nullable(),
});
export const CaptureTypeSchema = z.enum([
  'TASK',
  'NOTE',
  'EXPENSE',
  'HABIT_LOG',
  'JOURNAL',
  'VOICE_MEMO',
  'DRAFT',
]);
export const CaptureCreateSchema = z
  .strictObject({
    type: CaptureTypeSchema,
    text: WritingText.default(''),
    voiceFileId: Id.nullable().default(null),
  })
  .refine((v) =>
    v.type === 'VOICE_MEMO' ? v.voiceFileId !== null : v.text.trim().length > 0,
  );
export const CapturePatchSchema = z
  .strictObject({
    type: CaptureTypeSchema.optional(),
    text: WritingText.optional(),
    voiceFileId: Id.nullable().optional(),
    archive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const CaptureSchema = z.strictObject({
  id: Id,
  spaceId: Id,
  createdByUserId: Id,
  revision: Revision,
  type: CaptureTypeSchema,
  text: WritingText,
  voiceFileId: Id.nullable(),
  state: z.enum(['INBOX', 'TRIAGED', 'ARCHIVED']),
  targetTaskId: Id.nullable(),
  targetNoteId: Id.nullable(),
  targetJournalId: Id.nullable(),
  targetHabitEntryId: Id.nullable(),
  targetHabitId: Id.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const CaptureQuerySchema = CursorQuerySchema.extend({
  state: z.enum(['INBOX', 'TRIAGED', 'ARCHIVED']).optional(),
  type: CaptureTypeSchema.optional(),
});
export const CapturePageSchema = z.strictObject({
  items: z.array(CaptureSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const CaptureTriageSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('CREATE_TASK'), task: TaskCreateSchema }),
  z.strictObject({ action: z.literal('CREATE_NOTE'), note: NoteCreateSchema }),
  z.strictObject({
    action: z.literal('CREATE_JOURNAL'),
    journal: JournalCreateSchema,
  }),
  z.strictObject({
    action: z.literal('RECORD_HABIT'),
    habitId: Id,
    entry: HabitEntryCreateSchema,
  }),
  z.strictObject({ action: z.literal('ARCHIVE') }),
]);
export const CaptureParseSchema = z.strictObject({
  text: WritingText.refine((v) => v.trim().length > 0),
  timezone: CalendarZoneSchema.optional(),
});
export const CaptureParseResultSchema = z.strictObject({
  version: z.literal(1),
  rawText: WritingText,
  title: WritingText,
  scheduledDate: PlanningDateSchema.nullable(),
  timezone: CalendarZoneSchema,
  recognized: z.boolean(),
  serverNow: z.iso.datetime(),
});
export const PersonalSearchKindSchema = z.enum([
  'NOTE',
  'TASK',
  'GOAL',
  'CAPTURE',
  'JOURNAL',
  'MOOD',
]);
export const PersonalSearchQuerySchema = CursorQuerySchema.extend({
  q: z.string().trim().min(1).max(200).refine(clean),
  types: z
    .string()
    .max(60)
    .regex(
      /^(?:NOTE|TASK|GOAL|CAPTURE|JOURNAL|MOOD)(?:,(?:NOTE|TASK|GOAL|CAPTURE|JOURNAL|MOOD))*$/,
    )
    .optional(),
  includeJournal: z.enum(['true', 'false']).optional(),
  includeMood: z.enum(['true', 'false']).optional(),
});
export const PersonalSearchHitSchema = z.strictObject({
  kind: PersonalSearchKindSchema,
  id: Id,
  revision: Revision,
  title: z.string().nullable(),
  snippet: z.string().max(240),
  createdAt: z.iso.datetime(),
});
export const PersonalSearchPageSchema = z.strictObject({
  items: z.array(PersonalSearchHitSchema).max(100),
  nextCursor: z.string().nullable(),
  sources: z.array(PersonalSearchKindSchema).max(6),
});
export type NoteCreate = z.infer<typeof NoteCreateSchema>;
export type NotePatch = z.infer<typeof NotePatchSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type NoteFolder = z.infer<typeof NoteFolderSchema>;
export type NoteFolderCreate = z.infer<typeof NoteFolderCreateSchema>;
export type NoteFolderPatch = z.infer<typeof NoteFolderPatchSchema>;
export type JournalCreate = z.infer<typeof JournalCreateSchema>;
export type JournalPatch = z.infer<typeof JournalPatchSchema>;
export type JournalEntry = z.infer<typeof JournalEntrySchema>;
export type MoodCreate = z.infer<typeof MoodCreateSchema>;
export type MoodPatch = z.infer<typeof MoodPatchSchema>;
export type MoodEntry = z.infer<typeof MoodEntrySchema>;
export type DailyCheckinCreate = z.infer<typeof DailyCheckinCreateSchema>;
export type CaptureCreate = z.infer<typeof CaptureCreateSchema>;
export type CapturePatch = z.infer<typeof CapturePatchSchema>;
export type Capture = z.infer<typeof CaptureSchema>;
export type CaptureTriage = z.infer<typeof CaptureTriageSchema>;
export type CaptureParse = z.infer<typeof CaptureParseSchema>;
export type PersonalSearchQuery = z.infer<typeof PersonalSearchQuerySchema>;
export type PersonalSearchHit = z.infer<typeof PersonalSearchHitSchema>;
export type SearchRequest = {
  q: string;
  limit: number;
  after: {
    createdAt: string;
    id: string;
    kind: PersonalSearchHit['kind'];
  } | null;
};

export const NoteReadQuerySchema = z.strictObject({
  includeDeleted: z.enum(['true', 'false']).optional(),
});
export const CheckinQuerySchema = CursorQuerySchema.extend({
  ...dates,
  deleted: z.enum(['true', 'false']).optional(),
}).refine(validRange);
