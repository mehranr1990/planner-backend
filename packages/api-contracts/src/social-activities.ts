import { z } from 'zod';
import { CalendarZoneSchema } from './calendar.js';
import { financeCurrencyScales } from './finance-currencies.js';
import { SocialPageQuerySchema } from './social.js';
/** P6-02 Activities and P6-03 recordkeeping-only shared expenses (ADR 0051, ADR 0060). */
const id = z.uuid();
const Instant = z.iso.datetime();
const DAY = 86400000;
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item).max(100),
    nextCursor: z.string().nullable(),
  });
const Text = (max: number) => z.string().trim().min(1).max(max);
const Optional = (max: number) => z.string().max(max).nullable().optional();
export const SocialActivityTemplateSchema = z.enum([
  'GENERAL',
  'TRAVEL',
  'SPORT',
  'FAMILY',
  'GATHERING',
]);
const scheduleOk = (v: {
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
}) =>
  !v.startsAt ||
  !v.endsAt ||
  (Date.parse(v.endsAt) > Date.parse(v.startsAt) &&
    Date.parse(v.endsAt) - Date.parse(v.startsAt) <= 90 * DAY);
const ActivityFields = {
  template: SocialActivityTemplateSchema,
  title: Text(200),
  description: Optional(4000),
  location: Optional(500),
  timezone: CalendarZoneSchema,
  startsAt: Instant,
  endsAt: Instant,
  capacity: z.number().int().min(1).max(1000).nullable().optional(),
};
export const SocialActivityCreateSchema = z
  .strictObject({ id, groupId: id.nullable().default(null), ...ActivityFields })
  .refine(scheduleOk, { message: 'SCHEDULE_INVALID' });
export const SocialActivityPatchSchema = z
  .strictObject(ActivityFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0)
  .refine(scheduleOk, { message: 'SCHEDULE_INVALID' });
export const SocialActivityListQuerySchema = SocialPageQuerySchema.extend({
  groupId: id.optional(),
});
export const SocialActivityLifecycleActionSchema = z.enum(['cancel', 'close']);
export const SocialParticipantRoleSchema = z.enum(['ORGANIZER', 'PARTICIPANT']);
export const SocialParticipantStateSchema = z.enum([
  'INVITED',
  'ACTIVE',
  'DECLINED',
  'LEFT',
  'REMOVED',
]);
export const SocialRsvpSchema = z.enum([
  'PENDING',
  'GOING',
  'MAYBE',
  'DECLINED',
]);
export const SocialSeatSchema = z.enum([
  'NONE',
  'HELD',
  'WAITLISTED',
  'OFFERED',
]);
export const SocialActivityParticipationSchema = z.strictObject({
  participantId: id,
  role: SocialParticipantRoleSchema,
  state: SocialParticipantStateSchema,
  rsvp: SocialRsvpSchema,
  seat: SocialSeatSchema,
  guest: z.boolean(),
  offerExpiresAt: Instant.nullable(),
  reminderMinutes: z.number().int().nullable(),
  generation: z.number().int().positive(),
  revision: z.number().int().positive(),
});
export const SocialActivitySummarySchema = z.strictObject({
  id,
  groupId: id.nullable(),
  template: SocialActivityTemplateSchema,
  title: z.string(),
  timezone: z.string(),
  startsAt: Instant,
  endsAt: Instant,
  state: z.enum(['PLANNED', 'CANCELED', 'CLOSED', 'DELETED']),
  capacity: z.number().int().nullable(),
  seatsTaken: z.number().int().nonnegative(),
  waitlistCount: z.number().int().nonnegative(),
  me: SocialActivityParticipationSchema.nullable(),
});
export const SocialActivitySchema = SocialActivitySummarySchema.extend({
  description: z.string().nullable(),
  location: z.string().nullable(),
  conversationId: id.nullable(),
  conversationManaged: z.boolean(),
  successorParticipantId: id.nullable(),
  orphanedAt: Instant.nullable(),
  deletedAt: Instant.nullable(),
  recoverUntil: Instant.nullable(),
  manage: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: Instant,
  updatedAt: Instant,
});
export const SocialActivityPageSchema = page(SocialActivitySummarySchema);
export const SocialActivityParticipantSchema = z.strictObject({
  id,
  userId: id.nullable(),
  displayName: z.string().nullable(),
  role: SocialParticipantRoleSchema,
  state: SocialParticipantStateSchema,
  rsvp: SocialRsvpSchema,
  seat: SocialSeatSchema,
  guest: z.boolean(),
  waitlistedAt: Instant.nullable(),
  offerExpiresAt: Instant.nullable(),
  revision: z.number().int().positive(),
});
export const SocialActivityParticipantPageSchema = page(
  SocialActivityParticipantSchema,
);
export const SocialActivityInviteSchema = z.strictObject({ userId: id });
export const SocialActivityRsvpSchema = z.strictObject({
  rsvp: z.enum(['GOING', 'MAYBE', 'DECLINED']),
});
export const SocialActivityRoleSchema = z.strictObject({
  role: SocialParticipantRoleSchema,
});
export const SocialActivityItemKindSchema = z.enum([
  'ITINERARY',
  'AGENDA',
  'CHECKLIST',
]);
const ItemFields = {
  title: Text(300),
  notes: Optional(2000),
  location: Optional(500),
  startsAt: Instant.nullable().optional(),
  endsAt: Instant.nullable().optional(),
  assigneeParticipantId: id.nullable().optional(),
};
export const SocialActivityItemCreateSchema = z.strictObject({
  id,
  kind: SocialActivityItemKindSchema,
  ...ItemFields,
});
export const SocialActivityItemPatchSchema = z
  .strictObject({ ...ItemFields, done: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const SocialActivityItemSchema = z.strictObject({
  id,
  activityId: id,
  kind: SocialActivityItemKindSchema,
  title: z.string(),
  notes: z.string().nullable(),
  location: z.string().nullable(),
  startsAt: Instant.nullable(),
  endsAt: Instant.nullable(),
  localDate: z.iso.date().nullable(),
  dayIndex: z.number().int().nullable(),
  position: z.number().int().positive(),
  done: z.boolean(),
  assigneeParticipantId: id.nullable(),
  createdByParticipantId: id,
  revision: z.number().int().positive(),
  createdAt: Instant,
  updatedAt: Instant,
});
export const SocialActivityItemPageSchema = page(SocialActivityItemSchema);
export const SocialActivityTaskLinkSchema = z.strictObject({
  itemId: id,
  taskId: id,
  created: z.boolean(),
});
export const SocialActivityPollCreateSchema = z
  .strictObject({
    id,
    kind: z.enum(['GENERAL', 'SCHEDULE']),
    question: Text(300),
    multiple: z.boolean().default(false),
    options: z
      .array(
        z
          .strictObject({
            id,
            label: Text(200),
            startsAt: Instant.optional(),
            endsAt: Instant.optional(),
          })
          .refine(
            (o) =>
              (o.startsAt === undefined) === (o.endsAt === undefined) &&
              scheduleOk(o),
          ),
      )
      .min(2)
      .max(20),
  })
  .refine(
    (p) =>
      new Set(p.options.map((o) => o.id)).size === p.options.length &&
      (p.kind === 'GENERAL' || p.options.every((o) => o.startsAt)),
  );
export const SocialActivityPollSchema = z.strictObject({
  id,
  activityId: id,
  kind: z.enum(['GENERAL', 'SCHEDULE']),
  question: z.string(),
  multiple: z.boolean(),
  state: z.enum(['OPEN', 'CLOSED']),
  chosenOptionId: id.nullable(),
  revision: z.number().int().positive(),
  createdAt: Instant,
  closedAt: Instant.nullable(),
  options: z.array(
    z.strictObject({
      id,
      label: z.string(),
      startsAt: Instant.nullable(),
      endsAt: Instant.nullable(),
      votes: z.number().int().nonnegative(),
    }),
  ),
  myOptionIds: z.array(id),
});
export const SocialActivityPollPageSchema = page(SocialActivityPollSchema);
export const SocialActivityVoteSchema = z.strictObject({
  optionIds: z.array(id).max(20),
});
export const SocialActivityPollCloseSchema = z.strictObject({
  chosenOptionId: id.nullable().default(null),
});
const Interval = z.strictObject({ start: Instant, end: Instant });
export const SocialActivityBusyShareSchema = z.strictObject({
  participantId: id,
  capturedAt: Instant,
  intervals: z.array(Interval).max(1000),
});
export const SocialActivityBusySchema = z.strictObject({
  items: z
    .array(
      SocialActivityBusyShareSchema.extend({
        displayName: z.string().nullable(),
      }),
    )
    .max(1000),
});
export const SocialActivityConversationSchema = z.strictObject({
  conversationId: id.nullable(),
});
export const SocialActivityReminderSchema = z.strictObject({
  minutesBefore: z.number().int().min(5).max(10080).nullable(),
});
export const SocialActivityCalendarQuerySchema = z
  .strictObject({ from: Instant, to: Instant })
  .refine(
    (q) =>
      Date.parse(q.to) > Date.parse(q.from) &&
      Date.parse(q.to) - Date.parse(q.from) <= 93 * DAY,
  );
export const SocialActivityCalendarSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        activityId: id,
        itemId: id.nullable(),
        kind: z.enum(['ACTIVITY', 'ITINERARY']),
        title: z.string(),
        startsAt: Instant,
        endsAt: Instant,
        timezone: z.string(),
      }),
    )
    .max(1000),
});
export const SocialNoticeKindSchema = z.enum([
  'ACTIVITY_INVITED',
  'ACTIVITY_UPDATED',
  'ACTIVITY_CANCELED',
  'ACTIVITY_REMOVED',
  'SEAT_OFFERED',
  'ACTIVITY_REMINDER',
  'EXPENSE_PROPOSED',
  'EXPENSE_DECIDED',
  'SETTLEMENT_RECORDED',
  'SETTLEMENT_DECIDED',
  'ORGANIZER_NOMINATED',
  'ACTIVITY_DELETED',
]);
export const SocialNoticeSchema = z.strictObject({
  id,
  kind: SocialNoticeKindSchema,
  activityId: id.nullable(),
  groupId: id.nullable(),
  resourceId: id,
  createdAt: Instant,
  readAt: Instant.nullable(),
});
export const SocialNoticePageSchema = page(SocialNoticeSchema);

// P6-03 -----------------------------------------------------------------------
const Currency = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine((v) => Object.hasOwn(financeCurrencyScales, v), {
    message: 'CURRENCY_UNSUPPORTED',
  });
/** Exact integer minor units as decimal strings; never floating point. */
const Minor = z.string().regex(/^[1-9][0-9]{0,17}$/);
const MinorOrZero = z.string().regex(/^(0|[1-9][0-9]{0,17})$/);
const SignedMinor = z.string().regex(/^(0|-?[1-9][0-9]{0,18})$/);
export const SocialSplitMethodSchema = z.enum([
  'EQUAL',
  'PERCENT',
  'FIXED',
  'WEIGHTED',
]);
export const SocialExpenseInputSchema = z.strictObject({
  title: Text(200),
  note: Optional(2000),
  currency: Currency,
  amountMinor: Minor,
  payerUserId: id,
  method: SocialSplitMethodSchema,
  incurredOn: z.iso.date(),
  shares: z
    .array(z.strictObject({ userId: id, value: MinorOrZero.optional() }))
    .min(1)
    .max(200),
});
export const SocialExpenseCreateSchema = SocialExpenseInputSchema.extend({
  id,
});
export const SocialExpenseDecisionActionSchema = z.enum([
  'approve',
  'reject',
  'withdraw',
]);
export const SocialExpenseDecisionSchema = z.strictObject({
  note: Optional(2000),
});
export const SocialExpenseShareSchema = z.strictObject({
  position: z.number().int().positive(),
  userId: id.nullable(),
  input: MinorOrZero.nullable(),
  shareMinor: MinorOrZero,
});
export const SocialExpenseRevisionSchema = z.strictObject({
  id,
  number: z.number().int().positive(),
  state: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN']),
  title: z.string(),
  note: z.string().nullable(),
  currency: z.string(),
  scale: z.number().int().min(0).max(4),
  amountMinor: Minor,
  payerUserId: id.nullable(),
  method: SocialSplitMethodSchema,
  incurredOn: z.iso.date(),
  proposedByUserId: id.nullable(),
  decidedByUserId: id.nullable(),
  decidedAt: Instant.nullable(),
  decisionNote: z.string().nullable(),
  createdAt: Instant,
  sharesRestricted: z.boolean(),
  shares: z.array(SocialExpenseShareSchema).max(200),
});
export const SocialExpenseSchema = z.strictObject({
  id,
  groupId: id.nullable(),
  activityId: id.nullable(),
  state: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']),
  proposedByUserId: id.nullable(),
  revision: z.number().int().positive(),
  createdAt: Instant,
  updatedAt: Instant,
  canDecide: z.boolean(),
  effective: SocialExpenseRevisionSchema.nullable(),
  pending: SocialExpenseRevisionSchema.nullable(),
});
export const SocialExpensePageSchema = page(SocialExpenseSchema);
export const SocialExpenseHistorySchema = z.strictObject({
  items: z.array(SocialExpenseRevisionSchema).max(1000),
});
export const SocialBalanceSchema = z.strictObject({
  userId: id,
  displayName: z.string().nullable(),
  currency: z.string(),
  paidMinor: MinorOrZero,
  shareMinor: MinorOrZero,
  settledOutMinor: MinorOrZero,
  settledInMinor: MinorOrZero,
  netMinor: SignedMinor,
  owedMinor: MinorOrZero,
  receivableMinor: MinorOrZero,
});
export const SocialBalanceListSchema = z.strictObject({
  items: z.array(SocialBalanceSchema).max(10000),
});
export const SocialSettlementCreateSchema = z.strictObject({
  id,
  payeeUserId: id,
  currency: Currency,
  amountMinor: Minor,
  note: Optional(2000),
});
export const SocialSettlementActionSchema = z.enum([
  'confirm',
  'dispute',
  'cancel',
]);
export const SocialSettlementDecisionSchema = z.strictObject({
  note: Optional(2000),
});
export const SocialSettlementSchema = z.strictObject({
  id,
  groupId: id.nullable(),
  activityId: id.nullable(),
  payerUserId: id.nullable(),
  payeeUserId: id.nullable(),
  currency: z.string(),
  scale: z.number().int().min(0).max(4),
  amountMinor: Minor,
  state: z.enum(['RECORDED', 'CONFIRMED', 'DISPUTED', 'CANCELED']),
  note: z.string().nullable(),
  disputeNote: z.string().nullable(),
  revision: z.number().int().positive(),
  createdAt: Instant,
  decidedAt: Instant.nullable(),
});
export const SocialSettlementPageSchema = page(SocialSettlementSchema);

// ADR 0060/0061/0062 gap closure ----------------------------------------------
export const SocialActivitySuccessionSchema = z.strictObject({
  participantId: id,
});
export const SocialActivitySuccessionActionSchema = z.enum([
  'accept',
  'decline',
  'cancel',
]);
export const SocialActivityConversationOpenSchema = z.strictObject({
  id,
  retentionPolicyVersion: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
});
export const SocialFinancePostingRequestSchema = z.strictObject({
  accountId: id,
  categoryId: id.nullable().default(null),
});
export const SocialFinancePostingConfirmSchema =
  SocialFinancePostingRequestSchema.extend({
    revisionId: id,
    confirm: z.literal(true),
  });
export const SocialFinancePostingPreviewSchema = z.strictObject({
  expenseId: id,
  revisionId: id,
  currency: z.string(),
  scale: z.number().int().min(0).max(4),
  amountMinor: MinorOrZero,
  amount: z.string(),
  localDate: z.iso.date(),
  transactionType: z.literal('EXPENSE'),
  accountId: id,
  accountName: z.string(),
  categoryId: id.nullable(),
  alreadyPosted: z
    .strictObject({ transactionId: id, revisionId: id.nullable() })
    .nullable(),
});
export const SocialFinancePostingResultSchema = z.strictObject({
  expenseId: id,
  revisionId: id,
  transactionId: id,
  created: z.boolean(),
});
