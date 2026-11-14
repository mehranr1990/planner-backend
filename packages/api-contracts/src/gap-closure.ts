import { z } from 'zod';
import { AdvancedMessageSchema } from './advanced-messaging.js';
import { CalendarEventSchema } from './calendar.js';
import { TaskCategorySchema } from './final-closure.js';
const id = z.uuid(),
  revision = z.number().int().positive().max(2147483646),
  datetime = z.iso.datetime(),
  day = z.iso.date(),
  text = (max: number) =>
    z
      .string()
      .trim()
      .min(1)
      .max(max)
      .refine((v) => !v.includes('\0'));

// OD-10 channel settings and conversation reports ----------------------------
/** null = not set on this conversation (current default behaviour applies). */
export const ConversationSettingsSchema = z.strictObject({
  conversationId: id,
  linkPreviews: z.boolean().nullable(),
  /** FROM_JOIN (default) or FULL history for members admitted afterwards. */
  newcomerHistory: z.enum(['FROM_JOIN', 'FULL']).nullable(),
  /** false = only conversation managers may pin. */
  membersCanPin: z.boolean().nullable(),
  revision,
  canManage: z.boolean(),
  me: z.strictObject({
    linkPreviews: z.boolean().nullable(),
    collapseBlocked: z.boolean(),
    revision,
  }),
});
export const ConversationSettingsPatchSchema = z
  .strictObject({
    linkPreviews: z.boolean().optional(),
    newcomerHistory: z.enum(['FROM_JOIN', 'FULL']).optional(),
    membersCanPin: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const ConversationPreferencesPatchSchema = z
  .strictObject({
    linkPreviews: z.boolean().nullable().optional(),
    collapseBlocked: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const ConversationReportSchema = z.strictObject({
  id,
  conversationId: id,
  memberId: id,
  reason: z.string().nullable(),
  state: z.enum(['OPEN', 'RESOLVED']),
  resolution: z.string().nullable(),
  revision,
  createdAt: datetime,
  resolvedAt: datetime.nullable(),
});
export const ConversationReportListSchema = z.strictObject({
  items: z.array(ConversationReportSchema).max(200),
});
export const ConversationReportCreateSchema = z.strictObject({
  id,
  reason: text(2000).nullable().default(null),
});
export const ConversationReportResolveSchema = z.strictObject({
  resolution: text(2000).nullable().default(null),
});

// OD-11 global message search -------------------------------------------------
export const GlobalMessageSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  /** Restrict to one conversation the caller belongs to. */
  conversationId: id.optional(),
  /** Author member id within the matched conversation. */
  fromMemberId: id.optional(),
  /** Only `link` is searchable today; media messages are not text-indexed. */
  has: z.literal('link').optional(),
  /** Inclusive UTC days. */
  after: day.optional(),
  before: day.optional(),
});
export const GlobalMessageSearchHitSchema = z.strictObject({
  conversationId: id,
  conversationTitle: z.string().nullable(),
  kind: z.string(),
  message: AdvancedMessageSchema,
});
export const GlobalMessageSearchPageSchema = z.strictObject({
  items: z.array(GlobalMessageSearchHitSchema).max(50),
  nextCursor: z.string().nullable(),
});

// OD-12 busy-only meetings ----------------------------------------------------
export const MeetingBusyVisibilityInputSchema = z.strictObject({
  visibility: z.enum(['NONE', 'SOURCE']),
});
export const MeetingBusyVisibilitySchema = z.strictObject({
  meetingId: id,
  visibility: z.enum(['NONE', 'SOURCE']),
  revision,
});
export const MeetingBusyQuerySchema = z.strictObject({
  sourceKind: z.enum(['PROJECT', 'TEAM', 'COMPANY']),
  sourceId: id,
});
export const MeetingBusyListSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        schedule: CalendarEventSchema.shape.schedule,
        recurrence: CalendarEventSchema.shape.recurrence,
      }),
    )
    .max(500),
});

// OD-13 announcement reminders ------------------------------------------------
export const AnnouncementRemindResultSchema = z.strictObject({
  delivered: z.number().int().nonnegative(),
});
export const AnnouncementReminderSchema = z.strictObject({
  id,
  announcementId: id,
  versionId: id,
  createdAt: datetime,
  readAt: datetime.nullable(),
});
export const AnnouncementReminderListSchema = z.strictObject({
  items: z.array(AnnouncementReminderSchema).max(200),
});

// OD-2 Company goals over the shared Goal engine ------------------------------
const decimal = z.string().regex(/^-?(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,4})?$/);
const basisPoints = z.number().int().min(0).max(10000);
const member = z.strictObject({
  accessId: id,
  generation: z.number().int().positive(),
  displayName: z.string().nullable().optional(),
});
export const CompanyKeyResultSchema = z.strictObject({
  id,
  title: z.string(),
  unit: z.string().nullable(),
  startValue: decimal,
  targetValue: decimal,
  /** Latest recorded check-in; null until one exists. */
  currentValue: decimal.nullable(),
  /** clamp((current − start) ÷ (target − start)) in basis points; null without a check-in. */
  progress: basisPoints.nullable(),
  archived: z.boolean(),
  revision,
  updatedAt: datetime,
});
export const CompanyGoalSchema = z.strictObject({
  id,
  scopeId: id,
  parentId: id.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED']),
  startDate: day,
  targetDate: day,
  owner: member,
  /** Mean of active key results; null when any is unmeasured or none exist. */
  progress: basisPoints.nullable(),
  /** Elapsed share of the inclusive period in the goal time zone. */
  expectedProgress: basisPoints,
  pace: z.enum(['ON_TRACK', 'BEHIND']).nullable(),
  keyResults: z.array(CompanyKeyResultSchema).max(50),
  revision,
  createdAt: datetime,
});
export const CompanyGoalPageSchema = z.strictObject({
  items: z.array(CompanyGoalSchema).max(100),
  nextCursor: z.string().nullable(),
});
const krInput = {
  title: text(300),
  unit: text(30).nullable().default(null),
  startValue: decimal,
  targetValue: decimal,
};
export const CompanyGoalCreateSchema = z
  .strictObject({
    id,
    title: text(300),
    description: text(10000).nullable().default(null),
    parentId: id.nullable().default(null),
    startDate: day,
    targetDate: day,
    timezone: z.string().min(1).max(100),
    /** Defaults to the caller; must be a current member of the context. */
    owner: member.omit({ displayName: true }).optional(),
    keyResult: z.strictObject({ id, ...krInput }).optional(),
  })
  .refine((v) => v.targetDate >= v.startDate);
export const CompanyGoalPatchSchema = z
  .strictObject({
    title: text(300).optional(),
    description: text(10000).nullable().optional(),
    status: CompanyGoalSchema.shape.status.optional(),
    startDate: day.optional(),
    targetDate: day.optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const CompanyKeyResultCreateSchema = z
  .strictObject({ id, ...krInput })
  .refine((v) => Number(v.startValue) !== Number(v.targetValue));
export const CompanyKeyResultPatchSchema = z
  .strictObject({
    title: text(300).optional(),
    unit: text(30).nullable().optional(),
    targetValue: decimal.optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const CompanyKeyResultCheckinCreateSchema = z.strictObject({
  id,
  value: decimal,
  note: text(500).nullable().default(null),
});
export const CompanyKeyResultCheckinSchema = z.strictObject({
  id,
  keyResultId: id,
  value: decimal,
  note: z.string().nullable(),
  createdAt: datetime,
});
export const CompanyKeyResultCheckinPageSchema = z.strictObject({
  items: z.array(CompanyKeyResultCheckinSchema).max(100),
  nextCursor: z.string().nullable(),
});

// OD-3 rooms and resource utilization heat -------------------------------------
export const CompanyRoomProfileInputSchema = z.strictObject({
  /** null = unknown; never inferred. */
  seats: z.number().int().min(1).max(100000).nullable(),
  floor: text(60).nullable(),
});
export const CompanyRoomSchema = z.strictObject({
  id,
  name: z.string(),
  seats: z.number().int().nullable(),
  floor: z.string().nullable(),
  revision,
  /** Active allocations overlapping the requested local day. */
  bookings: z
    .array(
      z.strictObject({
        id,
        from: datetime,
        to: datetime,
        mine: z.boolean(),
        /** The booker's optional title: shown to the booker, or to everyone only when shared; else null. */
        title: z.string().nullable(),
      }),
    )
    .max(500),
});
export const CompanyRoomListSchema = z.strictObject({
  day,
  timezone: z.string(),
  items: z.array(CompanyRoomSchema).max(500),
});
export const CompanyRoomQuerySchema = z.strictObject({
  day,
  timezone: z.string().min(1).max(100),
});
export const CompanyUtilizationQuerySchema = z.strictObject({
  /** Up to 12 comma-separated inclusive ranges "YYYY-MM-DD/YYYY-MM-DD" (e.g. Jalali months converted by the client). */
  periods: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}(,\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}){0,11}$/,
    ),
  timezone: z.string().min(1).max(100),
});
export const CompanyUtilizationSchema = z.strictObject({
  periods: z.array(z.strictObject({ from: day, to: day })),
  /** allocated resource time ÷ (active resources × period time), basis points; null without resources. */
  rows: z.array(
    z.strictObject({
      scopeId: id,
      name: z.string(),
      resources: z.number().int().nonnegative(),
      values: z.array(z.number().int().nonnegative().nullable()),
    }),
  ),
});

// OD-6 knowledge rich text (Markdown), acknowledgements and reminders --------
/** Markdown stored verbatim (same rule as Task/Note descriptions); clients must render without raw HTML. */
const markdown = z
  .string()
  .max(100000)
  .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v));
export const KnowledgePageSchema = z.strictObject({
  documentId: id,
  title: z.string(),
  /** Number served: the published one for readers, the newest for managers. */
  number: z.number().int().positive().nullable(),
  body: z.string().nullable(),
  note: z.string().nullable(),
  publishedNumber: z.number().int().positive().nullable(),
  versions: z
    .array(
      z.strictObject({
        number: z.number().int().positive(),
        at: datetime,
        author: member,
        note: z.string().nullable(),
      }),
    )
    .max(500),
  ackRequired: z.boolean(),
  acknowledged: z.boolean(),
  remindedNumber: z.number().int().positive().nullable(),
  canEdit: z.boolean(),
  revision,
});
export const KnowledgePageSaveSchema = z.strictObject({
  body: markdown,
  note: text(300).nullable().default(null),
});
export const KnowledgePagePublishSchema = z.strictObject({
  number: z.number().int().positive(),
  ackRequired: z.boolean(),
});
export const KnowledgeAcknowledgementReportSchema = z.strictObject({
  documentId: id,
  number: z.number().int().positive(),
  audience: z.number().int().nonnegative(),
  acknowledged: z.number().int().nonnegative(),
  members: z
    .array(
      z.strictObject({
        member,
        acknowledgedAt: datetime.nullable(),
      }),
    )
    .max(1000),
});
export const CompanyNotificationSchema = z.strictObject({
  id,
  kind: z.enum(['KNOWLEDGE_ACK_REMINDER', 'EMPLOYEE_FILE_REQUEST']),
  subjectId: id,
  createdAt: datetime,
  readAt: datetime.nullable(),
});
export const CompanyNotificationPageSchema = z.strictObject({
  items: z.array(CompanyNotificationSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const CompanyRemindResultSchema = z.strictObject({
  delivered: z.number().int().nonnegative(),
});

// OD-7 internal payment runs (no money movement) ------------------------------
const money = z.string().regex(/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,4})?$/);
export const PaymentRunEligibleSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        reimbursementId: id,
        beneficiary: member,
        /** Approved, reserved and not yet proposed for payment. */
        amount: money,
        currency: z.string(),
      }),
    )
    .max(1000),
});
export const PaymentRunSchema = z.strictObject({
  id,
  label: z.string(),
  state: z.enum(['OPEN', 'CONFIRMED', 'CANCELED']),
  currency: z.string(),
  total: money,
  reference: z.string().nullable(),
  items: z.array(
    z.strictObject({
      reimbursementId: id,
      amount: money,
      /** Payment acknowledgement proposed on confirmation (the beneficiary still acknowledges). */
      acknowledgementId: id.nullable(),
    }),
  ),
  closedAt: datetime.nullable(),
  revision,
  createdAt: datetime,
  can: z.strictObject({ confirm: z.boolean(), cancel: z.boolean() }),
});
export const PaymentRunPageSchema = z.strictObject({
  items: z.array(PaymentRunSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const PaymentRunCreateSchema = z.strictObject({
  id,
  label: text(200),
  reimbursementIds: z.array(id).min(1).max(200),
});
export const PaymentRunConfirmSchema = z.strictObject({
  /** Internal payment reference recorded on each proposed acknowledgement. */
  reference: text(300),
});

// OD-8 / C9 sealed employee files ------------------------------------------------
export const EmployeeGrantSchema = z.strictObject({
  id,
  grantee: member,
  kind: z.enum(['HR', 'FINANCE', 'SECURITY']),
  expiresAt: datetime,
  revokedAt: datetime.nullable(),
  createdAt: datetime,
});
export const EmployeeGrantListSchema = z.strictObject({
  items: z.array(EmployeeGrantSchema).max(500),
});
export const EmployeeGrantCreateSchema = z.strictObject({
  id,
  grantee: member.omit({ displayName: true }),
  kind: z.enum(['HR', 'FINANCE', 'SECURITY']),
  /** Mandatory explicit expiry (time-boxed). */
  expiresAt: datetime,
});
export const EmployeeDocumentSchema = z.strictObject({
  id,
  title: z.string(),
  kind: z.enum(['CONTRACT', 'ID', 'CERTIFICATE', 'REVIEW', 'OTHER']),
  filename: z.string(),
  size: z.number().int().nullable(),
  status: z.enum(['INITIATED', 'READY', 'REJECTED', 'DELETED']),
  revision,
  createdAt: datetime,
});
export const EmployeeFileSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('sealed'),
    subjectAccessId: id,
    requested: z.boolean(),
  }),
  z.strictObject({
    status: z.literal('open'),
    subjectAccessId: id,
    own: z.boolean(),
    access: z.strictObject({
      kind: z.enum(['SELF', 'HR']),
      expiresAt: datetime.nullable(),
    }),
    canAddDocument: z.boolean(),
    documents: z.array(EmployeeDocumentSchema).max(500),
    log: z
      .array(
        z.strictObject({
          id,
          action: z.string(),
          at: datetime,
          actorDisplayName: z.string().nullable().optional(),
          actorId: id,
        }),
      )
      .max(200),
  }),
]);
export const EmployeeDocumentCreateSchema = z.strictObject({
  id,
  title: text(300),
  kind: EmployeeDocumentSchema.shape.kind,
  upload: z.strictObject({
    filename: z.string().min(1).max(180),
    mimeType: z.enum([
      'text/plain',
      'application/pdf',
      'image/png',
      'image/jpeg',
    ]),
    expectedSize: z.number().int().min(1).max(104857600),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
});

// B3 Brain Dump: one Personal page per day ---------------------------------------
const destination = z.enum(['TASK', 'NOTE', 'JOURNAL', 'EVENT', 'INBOX']);
export const BrainDumpLineSchema = z.strictObject({
  id,
  text: z.string(),
  sortedTo: destination.nullable(),
  sortedDay: day.nullable(),
  /** The Task/Note/Journal/Event/Inbox item the line was sorted to, when known. */
  targetId: id.nullable(),
  struck: z.boolean(),
});
export const BrainDumpPageSchema = z.strictObject({
  day,
  lines: z.array(BrainDumpLineSchema).max(1000),
  savedAt: datetime.nullable(),
  revision: z.number().int().nonnegative(),
});
export const BrainDumpPageListSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        day,
        lineCount: z.number().int().nonnegative(),
        unsortedCount: z.number().int().nonnegative(),
      }),
    )
    .max(400),
});
const line = z
  .string()
  .max(2000)
  .refine((v) => !v.includes('\0'));
export const BrainDumpSaveSchema = z.strictObject({
  /** Full ordered page: known ids keep their sort tags, unknown ids are new, omitted ids are deleted. */
  lines: z.array(z.strictObject({ id, text: line })).max(1000),
});
export const BrainDumpAddSchema = z.strictObject({
  id,
  text: line.refine((v) => v.trim().length > 0),
});
export const BrainDumpIdsSchema = z.strictObject({
  ids: z.array(id).min(1).max(1000),
});
export const BrainDumpSortSchema = z.strictObject({
  ids: z.array(id).min(1).max(1000),
  to: destination.exclude(['INBOX']),
  day: day.nullable().default(null),
  /** The destination the client created first (e.g. the Task), if any. */
  targetId: id.nullable().default(null),
});
export const BrainDumpStrikeSchema = z.strictObject({
  ids: z.array(id).min(1).max(1000),
  struck: z.boolean(),
});
export const BrainDumpRemovalSchema = z.strictObject({
  page: BrainDumpPageSchema,
  /** Send back to `restore` to undo. */
  removed: z.array(BrainDumpLineSchema.extend({ position: z.number().int() })),
});
export const BrainDumpRestoreSchema = z.strictObject({
  lines: z
    .array(
      BrainDumpLineSchema.extend({
        position: z.number().int().min(0).max(999),
      }),
    )
    .min(1)
    .max(1000),
});

// B4 Insights patterns -------------------------------------------------------------
export const InsightPatternQuerySchema = z.strictObject({
  id: z.enum(['focus', 'time', 'signals', 'estimates', 'habits']),
  from: day,
  to: day,
  timezone: z.string().min(1).max(100),
});
const context = z.strictObject({
  personal: z.number().int().nonnegative(),
  projects: z.number().int().nonnegative(),
  teams: z.number().int().nonnegative(),
  companies: z.number().int().nonnegative(),
  other: z.number().int().nonnegative(),
});
export const InsightPatternSchema = z.discriminatedUnion('id', [
  z.strictObject({
    id: z.literal('focus'),
    /** 7 rows (0 = Sunday) × 24 hours of recorded time-entry minutes, in the requested time zone. */
    minutesByWeekdayHour: z
      .array(z.array(z.number().int().nonnegative()).length(24))
      .length(7),
    totalMinutes: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative(),
    trackedEntries: z.number().int().nonnegative(),
    /** Best 2-hour window [startHour, endHour) over all days, and its share in basis points. */
    bestWindow: z.tuple([z.number().int(), z.number().int()]).nullable(),
    bestShare: z.number().int().min(0).max(10000).nullable(),
  }),
  z.strictObject({
    id: z.literal('time'),
    /** Minutes per weekday (0 = Sunday): Personal time entries plus the caller's own Shared work logs by space kind. */
    days: z
      .array(
        z.strictObject({
          weekday: z.number().int().min(0).max(6),
          minutes: context,
        }),
      )
      .length(7),
    totals: context,
    /** Context shares (basis points) over the immediately preceding period of equal length; null when it had no time. */
    previousShare: context.nullable(),
  }),
  z.strictObject({
    id: z.literal('signals'),
    /** Mood and energy are recorded on 1–5 scales (null when not recorded); focus is recorded minutes. */
    days: z.array(
      z.strictObject({
        day,
        mood: z.number().int().min(1).max(5).nullable(),
        energy: z.number().int().min(1).max(5).nullable(),
        focusMinutes: z.number().int().nonnegative(),
      }),
    ),
    /** Mean mood on days with ≥ 120 focus minutes vs other days with mood; null without data. */
    moodWithFocus: z.number().nullable(),
    moodWithoutFocus: z.number().nullable(),
  }),
  z.strictObject({
    id: z.literal('estimates'),
    /**
     * Completed Personal tasks (completedAt in range) with a category, an estimate > 0 and
     * recorded time. Actual = union of the task's current RECORDED time entries (minutes);
     * ratio = Σ actual ÷ Σ estimated per category (2 decimals), categories with ≥ 3 such
     * tasks only, biggest ratio first.
     */
    categories: z
      .array(
        z.strictObject({
          id: TaskCategorySchema,
          ratio: z.number().positive(),
          tasks: z.number().int().positive(),
          estimatedMinutes: z.number().int().positive(),
          actualMinutes: z.number().int().positive(),
        }),
      )
      .max(4),
    /** Top category when its ratio ≥ 1.10: +round5((ratio − 1) × 100)%, 5–100. Opt-in on the client. */
    suggestion: z
      .strictObject({
        category: TaskCategorySchema,
        bufferPercent: z.number().int().min(5).max(100),
      })
      .nullable(),
    /** Completed tasks in range left out, by reason (no category / no estimate / no recorded time). */
    excluded: z.strictObject({
      uncategorized: z.number().int().nonnegative(),
      unestimated: z.number().int().nonnegative(),
      untracked: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    id: z.literal('habits'),
    /** Mean mood (1–5) on days a habit was done vs mood days it was not; habits with ≥ 10 mood days. */
    rows: z.array(
      z.strictObject({
        habitId: id,
        title: z.string(),
        doneMood: z.number().nullable(),
        notDoneMood: z.number().nullable(),
        days: z.number().int().nonnegative(),
      }),
    ),
  }),
]);
export const InsightPatternResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ready'), pattern: InsightPatternSchema }),
  z.strictObject({
    status: z.literal('collecting'),
    have: z.number().int().nonnegative(),
    need: z.number().int().positive(),
  }),
  z.strictObject({
    status: z.literal('unavailable'),
    reason: z.enum(['TASK_CATEGORIES_NOT_RECORDED']),
  }),
]);
export const KnowledgePageQuerySchema = z.strictObject({
  number: z.coerce.number().int().positive().optional(),
});
export const DepartmentTransferQuerySchema = z.strictObject({
  accessId: id,
  fromScopeId: id,
  toScopeId: id,
});
export const DepartmentTransferPreviewSchema = z.strictObject({
  role: z.string().nullable(),
  activeAllocations: z.number().int().nonnegative(),
  pendingResourceRequests: z.number().int().nonnegative(),
  pendingExpenseReviews: z.number().int().nonnegative(),
  allowed: z.boolean(),
});
export const DepartmentTransferCreateSchema = z.strictObject({
  id,
  accessId: id,
  fromScopeId: id,
  toScopeId: id,
  memberRole: z.enum(['TEAM_LEAD', 'MEMBER', 'VIEWER']),
});
export const DepartmentTransferSchema = z.strictObject({
  id,
  from: z.strictObject({
    scopeId: id,
    accessId: id,
    generation: z.number().int().positive(),
  }),
  to: z.strictObject({
    scopeId: id,
    accessId: id,
    generation: z.number().int().positive(),
    revision,
  }),
  memberRole: z.enum(['TEAM_LEAD', 'MEMBER', 'VIEWER']),
  createdAt: datetime,
});
export const KnowledgeVersionPageSchema = KnowledgePageSchema;
export const EmployeeFileRequestResultSchema = z.strictObject({
  requested: z.literal(true),
});
export const EmployeeDocumentRemovedSchema = z.strictObject({
  id,
  removed: z.literal(true),
});
