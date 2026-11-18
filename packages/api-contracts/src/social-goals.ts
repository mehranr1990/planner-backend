import { z } from 'zod';
import { SocialPageQuerySchema } from './social.js';
import { CalendarZoneSchema } from './calendar.js';
/**
 * P6-05 Social Goals and Challenges (ADR 0065 D1–D5). Each record has exactly
 * one Group or Activity context. Participation is voluntary; progress is
 * self-reported, optionally reviewed by an organizer, and never derived from
 * Personal Goals, Habits or other private data. A completion badge marks a
 * completed Social Goal/Challenge only: no ranking, verification, certification
 * or reward is implied.
 */
const id = z.uuid();
const Instant = z.iso.datetime();
const Day = z.iso.date();
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item).max(100),
    nextCursor: z.string().nullable(),
  });
const Text = (max: number) => z.string().trim().min(1).max(max);
const Optional = (max: number) => z.string().max(max).nullable().optional();
/** Whole units of the goal's own unit; choose a finer unit for fractions. */
const Quantity = z.number().int().min(1).max(1_000_000_000);

/** GOAL: one collective target. CHALLENGE: each participant's own target. */
export const SocialGoalKindSchema = z.enum(['GOAL', 'CHALLENGE']);
export const SocialGoalStateSchema = z.enum(['ACTIVE', 'CLOSED', 'CANCELED']);
/** Derived from `startsOn`/`endsOn` in the goal's IANA time zone. */
export const SocialGoalWindowSchema = z.enum(['UPCOMING', 'OPEN', 'ENDED']);
export const SocialGoalCreateSchema = z
  .strictObject({
    id,
    kind: SocialGoalKindSchema,
    groupId: id.nullable().optional(),
    activityId: id.nullable().optional(),
    title: Text(200),
    description: Optional(2000),
    unit: Text(40),
    target: Quantity,
    startsOn: Day,
    endsOn: Day,
    timezone: CalendarZoneSchema,
    /** Organizer review before progress counts. Default: ordinary self-reporting. */
    reviewRequired: z.boolean().default(false),
  })
  .refine((v) => !!v.groupId !== !!v.activityId, {
    message: 'Exactly one of groupId or activityId is required',
    path: ['groupId'],
  })
  .refine((v) => v.endsOn >= v.startsOn, { path: ['endsOn'] });
/** Organizer only, while ACTIVE. `reviewRequired` applies to later submissions. */
export const SocialGoalPatchSchema = z
  .strictObject({
    title: Text(200).optional(),
    description: Optional(2000),
    target: Quantity.optional(),
    endsOn: Day.optional(),
    reviewRequired: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const SocialGoalActionSchema = z.enum(['close', 'cancel']);
export const SocialGoalListQuerySchema = SocialPageQuerySchema.extend({
  groupId: id.optional(),
  activityId: id.optional(),
  kind: SocialGoalKindSchema.optional(),
  state: SocialGoalStateSchema.optional(),
  /** JOINED: the caller is an active participant. */
  participation: z.enum(['ANY', 'JOINED', 'NOT_JOINED']).default('ANY'),
}).refine((v) => !!v.groupId !== !!v.activityId, { path: ['groupId'] });

export const SocialGoalBadgeSchema = z.strictObject({
  /** Completion of this Social Goal/Challenge only; never verified or rewarded. */
  kind: z.literal('COMPLETION'),
  awardedAt: Instant,
});
export const SocialGoalParticipantSchema = z.strictObject({
  id,
  goalId: id,
  /** Null after the participant's account was erased. */
  userId: id.nullable(),
  state: z.enum(['ACTIVE', 'WITHDRAWN']),
  joinedAt: Instant,
  withdrawnAt: Instant.nullable(),
  /** Approved submissions plus organizer corrections; pending never counts. */
  approvedTotal: z.number().int(),
  /** Visible to the participant and organizers only; otherwise null. */
  pendingTotal: z.number().int().nullable(),
  /** CHALLENGE: own total against the target. GOAL: share of the collective target. */
  percent: z.number().int().min(0).max(100),
  completed: z.boolean(),
  badge: SocialGoalBadgeSchema.nullable(),
  revision: z.number().int().positive(),
});
export const SocialGoalParticipantPageSchema = page(
  SocialGoalParticipantSchema,
);
export const SocialGoalSchema = z.strictObject({
  id,
  kind: SocialGoalKindSchema,
  groupId: id.nullable(),
  activityId: id.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  unit: z.string(),
  target: z.number().int().positive(),
  startsOn: Day,
  endsOn: Day,
  timezone: z.string(),
  reviewRequired: z.boolean(),
  state: SocialGoalStateSchema,
  window: SocialGoalWindowSchema,
  createdByUserId: id.nullable(),
  /** GOAL only: when the collective approved total reached the target. */
  completedAt: Instant.nullable(),
  closedAt: Instant.nullable(),
  aggregate: z.strictObject({
    /** Current, context-authorized active participants. */
    participantCount: z.number().int().min(0),
    completedCount: z.number().int().min(0),
    /** Every approved submission and correction recorded in this goal. */
    approvedTotal: z.number().int(),
    percent: z.number().int().min(0).max(100),
    /** Organizers only; otherwise null. */
    pendingReviewCount: z.number().int().min(0).nullable(),
  }),
  viewer: z.strictObject({
    organizer: z.boolean(),
    /**
     * True when at least one current organizer other than the caller exists.
     * Nobody approves their own progress (not even a sole organizer); when this
     * is false and review is required, the caller's submissions stay PENDING.
     */
    independentReviewerAvailable: z.boolean(),
    participant: SocialGoalParticipantSchema.nullable(),
  }),
  revision: z.number().int().positive(),
  createdAt: Instant,
  updatedAt: Instant,
});
export const SocialGoalPageSchema = page(SocialGoalSchema);

// Progress entries -------------------------------------------------------------
export const SocialGoalEntryStateSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'RETRACTED',
]);
export const SocialGoalEntryCreateSchema = z.strictObject({
  /** Client-generated; a retry with the same id never counts twice. */
  id,
  amount: Quantity,
  occurredOn: Day,
  note: Optional(1000),
});
/** Organizer-only explicit correction of an administrative error; always audited. */
export const SocialGoalCorrectionCreateSchema = z.strictObject({
  id,
  participantId: id,
  delta: z
    .number()
    .int()
    .min(-1_000_000_000)
    .max(1_000_000_000)
    .refine((v) => v !== 0),
  reason: Text(1000),
  correctsEntryId: id.nullable().optional(),
});
export const SocialGoalEntryActionSchema = z.enum([
  'approve',
  'reject',
  'retract',
]);
export const SocialGoalEntryDecisionSchema = z.strictObject({
  note: Optional(1000),
});
export const SocialGoalEntryListQuerySchema = SocialPageQuerySchema.extend({
  state: SocialGoalEntryStateSchema.optional(),
  participantId: id.optional(),
});
export const SocialGoalEntrySchema = z.strictObject({
  id,
  goalId: id,
  participantId: id,
  participantUserId: id.nullable(),
  kind: z.enum(['SUBMISSION', 'CORRECTION']),
  /** Positive for submissions; signed for corrections. */
  amount: z.number().int(),
  occurredOn: Day.nullable(),
  note: z.string().nullable(),
  state: SocialGoalEntryStateSchema,
  submittedByUserId: id.nullable(),
  submittedAt: Instant,
  reviewedByUserId: id.nullable(),
  reviewedAt: Instant.nullable(),
  reviewNote: z.string().nullable(),
  correctsEntryId: id.nullable(),
  revision: z.number().int().positive(),
});
export const SocialGoalEntryPageSchema = page(SocialGoalEntrySchema);
export const SocialGoalHistorySchema = z.strictObject({
  truncated: z.boolean(),
  items: z.array(
    z.strictObject({
      id,
      participantId: id.nullable(),
      entryId: id.nullable(),
      actorUserId: id.nullable(),
      action: z.string(),
      fromState: z.string().nullable(),
      toState: z.string().nullable(),
      amount: z.number().int().nullable(),
      occurredAt: Instant,
    }),
  ),
});
