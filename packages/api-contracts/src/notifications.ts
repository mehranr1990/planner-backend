import { z } from 'zod';
import { TaskIdSchema } from './tasks.js';
import { PlanningDateSchema } from './planning.js';
import { CalendarZoneSchema } from './calendar.js';
import { CursorQuerySchema } from './foundation.js';
const Id = TaskIdSchema,
  DateOnly = PlanningDateSchema,
  Time = z.iso.datetime(),
  Zone = CalendarZoneSchema,
  Rev = z.number().int().min(1).max(2147483646),
  Clock = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/),
  SafeCode = z
    .string()
    .max(80)
    .regex(/^[A-Z][A-Z0-9_]*$/);
const clean = (v: string) =>
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]/u.test(v);
const Title = z.string().trim().min(1).max(300).refine(clean),
  Body = z.string().max(2000).refine(clean);
export const NotificationChannelSchema = z.enum([
  'IN_APP',
  'EMAIL',
  'WEB_PUSH',
]);
const Channels = z
  .array(NotificationChannelSchema)
  .min(1)
  .max(3)
  .refine((v) => new Set(v).size === v.length);
export const ReminderScheduleSchema = z
  .strictObject({
    version: z.literal(1),
    frequency: z.enum([
      'DAILY',
      'WEEKLY',
      'SELECTED_WEEKDAYS',
      'MONTHLY',
      'YEARLY',
      'INTERVAL',
    ]),
    interval: z.number().int().min(1).max(365).default(1),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    until: DateOnly.nullable().default(null),
    count: z.number().int().min(1).max(10000).nullable().default(null),
    exclusions: z.array(DateOnly).max(366).default([]),
  })
  .refine(
    (v) =>
      new Set(v.weekdays).size === v.weekdays.length &&
      new Set(v.exclusions).size === v.exclusions.length &&
      (v.frequency === 'SELECTED_WEEKDAYS'
        ? v.weekdays.length > 0
        : v.weekdays.length === 0),
  );
export const ReminderRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal('ABSOLUTE'),
    at: Time,
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal('LOCAL'),
    startDate: DateOnly,
    time: Clock,
    recurrence: ReminderScheduleSchema.nullable().default(null),
  }),
  z
    .strictObject({
      version: z.literal(1),
      kind: z.literal('TASK'),
      field: z.enum(['DUE_AT', 'PLANNED_START_AT', 'SCHEDULED_DATE']),
      offsetMinutes: z.number().int().min(-525600).max(525600).default(0),
      localTime: Clock.optional(),
    })
    .refine((v) =>
      v.field === 'SCHEDULED_DATE'
        ? v.localTime !== undefined
        : v.localTime === undefined,
    ),
]);
const fields = {
  title: Title.default('Reminder'),
  body: Body.nullable().default(null),
  taskId: Id.nullable().default(null),
  taskRevision: Rev.optional(),
  rule: ReminderRuleSchema,
  timezoneMode: z.enum(['FIXED', 'ACCOUNT']).default('ACCOUNT'),
  timezone: Zone.optional(),
  channels: Channels.default(['IN_APP']),
  urgent: z.boolean().default(false),
};
export const ReminderCreateSchema = z
  .strictObject(fields)
  .refine(
    (v) =>
      (v.timezoneMode !== 'FIXED' || v.timezone !== undefined) &&
      (v.taskId !== null
        ? v.taskRevision !== undefined
        : v.taskRevision === undefined) &&
      (v.rule.kind !== 'TASK' || v.taskId !== null) &&
      !(v.taskId && v.rule.kind === 'LOCAL' && v.rule.recurrence),
  );
export const ReminderPatchSchema = z
  .strictObject({
    title: Title.optional(),
    body: Body.nullable().optional(),
    taskId: Id.nullable().optional(),
    taskRevision: Rev.optional(),
    rule: ReminderRuleSchema.optional(),
    timezoneMode: z.enum(['FIXED', 'ACCOUNT']).optional(),
    timezone: Zone.optional(),
    channels: Channels.optional(),
    urgent: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
const root = {
  id: Id,
  spaceId: Id,
  ownerUserId: Id,
  createdByUserId: Id,
  revision: Rev,
  createdAt: Time,
  updatedAt: Time,
};
export const ReminderSchema = z.strictObject({
  ...root,
  title: Title,
  body: Body.nullable(),
  taskId: Id.nullable(),
  selectedTaskRevision: Rev.nullable(),
  rule: ReminderRuleSchema,
  timezoneMode: z.enum(['FIXED', 'ACCOUNT']),
  timezone: Zone,
  channels: Channels,
  urgent: z.boolean(),
  state: z.enum(['ACTIVE', 'PAUSED', 'CANCELED']),
  reason: SafeCode.nullable(),
  ruleVersion: Rev,
  nextAt: Time.nullable(),
  exhausted: z.boolean(),
  pausedAt: Time.nullable(),
  canceledAt: Time.nullable(),
});
export const ReminderQuerySchema = CursorQuerySchema.extend({
  state: z.enum(['ACTIVE', 'PAUSED', 'CANCELED']).optional(),
  taskId: Id.optional(),
});
export const NotificationSchema = z.strictObject({
  ...root,
  reminderId: Id,
  scheduledAt: Time,
  occurrenceKey: z.string().max(100),
  timezone: Zone,
  localDate: DateOnly,
  title: Title,
  body: Body.nullable(),
  inbox: z.boolean(),
  readAt: Time.nullable(),
  acknowledgedAt: Time.nullable(),
  dismissedAt: Time.nullable(),
  snoozedAt: Time.nullable(),
  firstDeliveredAt: Time.nullable(),
  sourceNotificationId: Id.nullable(),
});
export const NotificationReadSchema = z.strictObject({ read: z.boolean() });
export const NotificationQuerySchema = CursorQuerySchema.extend({
  state: z.enum(['ACTIVE', 'UNREAD', 'READ', 'DISMISSED']).optional(),
  history: z.enum(['true', 'false']).optional(),
  reminderId: Id.optional(),
});
export const NotificationDeliveryStateSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'RETRY',
  'DELIVERED',
  'SKIPPED',
  'CANCELED',
  'EXPIRED',
  'FAILED',
  'AMBIGUOUS',
]);
export const NotificationDeliverySchema = z.strictObject({
  ...root,
  reminderId: Id,
  kind: z.enum(['CHANNEL', 'ENDPOINT']),
  notificationId: Id.nullable(),
  parentId: Id.nullable(),
  subscriptionId: Id.nullable(),
  subscriptionRevision: Rev.nullable(),
  sourceNotificationId: Id.nullable(),
  sourceDeliveryId: Id.nullable(),
  channel: NotificationChannelSchema,
  scheduledAt: Time.nullable(),
  notBefore: Time.nullable(),
  occurrenceKey: z.string().max(100),
  ruleVersion: Rev,
  timezone: Zone,
  localDate: DateOnly,
  localTime: Clock,
  state: NotificationDeliveryStateSchema,
  reason: SafeCode.nullable(),
  attempts: z.number().int().min(0).max(5),
  leaseUntil: Time.nullable(),
  networkStartedAt: Time.nullable(),
  sentAt: Time.nullable(),
  canceledAt: Time.nullable(),
  reactivatedAt: Time.nullable(),
  cancelRequestedAt: Time.nullable(),
  lastErrorCode: SafeCode.nullable(),
});
export const NotificationDeliveryQuerySchema = CursorQuerySchema.extend({
  state: NotificationDeliveryStateSchema.optional(),
  kind: z.enum(['CHANNEL', 'ENDPOINT']).optional(),
});
export const NotificationSnoozeSchema = z.strictObject({ until: Time });
export const NotificationPreferencePatchSchema = z
  .strictObject({
    inApp: z.boolean().optional(),
    email: z.boolean().optional(),
    webPush: z.boolean().optional(),
    reactivateOnReopen: z.boolean().optional(),
    quietStart: Clock.nullable().optional(),
    quietEnd: Clock.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const NotificationPreferenceSchema = z.strictObject({
  ...root,
  inApp: z.boolean(),
  email: z.boolean(),
  webPush: z.boolean(),
  reactivateOnReopen: z.boolean(),
  quietStart: Clock.nullable(),
  quietEnd: Clock.nullable(),
  availableChannels: z.array(NotificationChannelSchema).min(1).max(3),
  webPushPublicKey: z.string().nullable(),
});
export const PushSubscriptionCreateSchema = z.strictObject({
  endpoint: z.string().url().max(4096),
  keys: z.strictObject({
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
  }),
  label: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine(clean)
    .nullable()
    .default(null),
});
export const PushSubscriptionSchema = z.strictObject({
  ...root,
  label: z.string().nullable(),
  endpointHost: z.string().max(253),
  state: z.enum(['ACTIVE', 'REVOKED']),
  revokedAt: Time.nullable(),
});
export const PushSubscriptionQuerySchema = CursorQuerySchema.extend({
  state: z.enum(['ACTIVE', 'REVOKED']).optional(),
});
export const NotificationTestSchema = z.strictObject({
  channel: NotificationChannelSchema.default('IN_APP'),
});
const page = <T extends z.ZodType>(s: T) =>
  z.strictObject({
    items: z.array(s).max(100),
    nextCursor: z.string().nullable(),
  });
export const ReminderPageSchema = page(ReminderSchema),
  NotificationPageSchema = page(NotificationSchema),
  NotificationDeliveryPageSchema = page(NotificationDeliverySchema),
  PushSubscriptionPageSchema = page(PushSubscriptionSchema);
export const NotificationSnoozeResultSchema = z.strictObject({
  id: Id,
  revision: Rev,
  notification: NotificationSchema,
  deliveries: z.array(NotificationDeliverySchema).max(3),
});
export type Reminder = z.infer<typeof ReminderSchema>;
export type ReminderCreate = z.infer<typeof ReminderCreateSchema>;
export type ReminderPatch = z.infer<typeof ReminderPatchSchema>;
export type ReminderRule = z.infer<typeof ReminderRuleSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type NotificationDelivery = z.infer<typeof NotificationDeliverySchema>;
export type NotificationPreference = z.infer<
  typeof NotificationPreferenceSchema
>;
export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;
