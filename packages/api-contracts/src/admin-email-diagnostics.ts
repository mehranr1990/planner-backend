import { z } from 'zod';
export const EmailCategorySchema = z.enum([
  'REGISTRATION_VERIFICATION',
  'PASSWORD_RECOVERY',
  'EMAIL_CHANGE_VERIFICATION',
  'PROJECT_INVITATION',
  'TEAM_INVITATION',
  'COMPANY_INVITATION',
  'CONVERSATION_INVITATION',
  'MEETING_INVITATION',
  'SOCIAL_GROUP_INVITATION',
  'SUPPORT',
  'SECURITY_NOTICE',
  'COMMUNICATIONS',
  'SYSTEM_NOTICE',
  'REMINDER',
]);
export const EmailDeliveryStatusSchema = z.enum([
  'QUEUED',
  'PROCESSING',
  'SMTP_ACCEPTED',
  'FAILED',
  'BOUNCED',
  'UNKNOWN',
  'CANCELED',
  'SINK_ACCEPTED',
]);
export const EmailSourceSchema = z.enum([
  'DIRECT',
  'CONTEXT_INVITATION',
  'CONVERSATION_INVITATION',
  'MEETING_INVITATION',
  'ADMIN_DELIVERY',
  'SECURITY_ALERT',
  'OPERATIONAL_ALERT',
  'COMMUNICATION',
  'NOTICE',
  'NOTIFICATION',
]);
export const AdminEmailQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(1024).optional(),
  category: EmailCategorySchema.optional(),
  status: EmailDeliveryStatusSchema.optional(),
  sourceKind: EmailSourceSchema.optional(),
  userId: z.uuid().optional(),
  resourceId: z.uuid().optional(),
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[^\u0000-\u001f\u007f]+$/)
    .optional(),
  from: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
});
export const EmailRetryActionSchema = z.enum([
  'RESEND_VERIFICATION',
  'RECOVERY',
  'RETRY_NOTICE',
]);
const reason = z.string().trim().min(5).max(500);
export const AdminEmailRetrySchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('RESEND_VERIFICATION'),
    revision: z.number().int().positive(),
    reason,
  }),
  z.strictObject({
    action: z.literal('RECOVERY'),
    revision: z.number().int().positive(),
    reason,
  }),
  z.strictObject({
    action: z.literal('RETRY_NOTICE'),
    attempts: z.number().int().nonnegative(),
    reason,
  }),
]);
export const AdminEmailRetryResultSchema = z.strictObject({
  action: EmailRetryActionSchema,
  queuedDeliveryId: z.uuid(),
});
export const AdminEmailLogSchema = z.strictObject({
  id: z.uuid(),
  sourceKind: EmailSourceSchema,
  sourceId: z.uuid(),
  category: EmailCategorySchema,
  recipient: z.string().nullable(),
  recipientEvidence: z.enum(['OBSERVED', 'PLANNED', 'UNKNOWN']),
  userId: z.uuid().nullable(),
  resourceKind: z.string().nullable(),
  resourceId: z.uuid().nullable(),
  createdAt: z.iso.datetime().nullable(),
  creationEvidence: z.enum(['RECORDED', 'UNKNOWN']),
  status: EmailDeliveryStatusSchema,
  sourceState: z.string(),
  attemptCount: z.number().int().nonnegative(),
  observedAttemptCount: z.number().int().nonnegative(),
  firstRecordedAttemptAt: z.iso.datetime().nullable(),
  lastRecordedAttemptAt: z.iso.datetime().nullable(),
  lastRecordedCompletionAt: z.iso.datetime().nullable(),
  nextAttemptAt: z.iso.datetime().nullable(),
  failureCode: z.string().nullable(),
  providerMessageReference: z.string().nullable(),
  deliveryEvidence: z.enum(['OBSERVED_ATTEMPT', 'SOURCE_STATE_ONLY']),
  inboxDelivery: z.literal('UNKNOWN'),
  retryActions: z.array(EmailRetryActionSchema),
});
export const AdminEmailPageSchema = z.strictObject({
  items: z.array(AdminEmailLogSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const AdminRegistrationDiagnosticsSchema = z.strictObject({
  registeredAt: z.iso.datetime(),
  verificationStatus: z.enum(['VERIFIED', 'UNVERIFIED']),
  emailVerifiedAt: z.iso.datetime().nullable(),
  verificationDateEvidence: z.enum(['RECORDED', 'UNKNOWN', 'NOT_VERIFIED']),
  loginStatus: z.enum(['RECORDED_SUCCESS', 'NO_RECORDED_SUCCESS']),
  firstSuccessfulLoginAt: z.iso.datetime().nullable(),
  firstLoginEvidence: z.enum(['COMPLETE_HISTORY', 'UNKNOWN']),
  firstRecordedSuccessfulLoginAt: z.iso.datetime().nullable(),
  lastSuccessfulLoginAt: z.iso.datetime().nullable(),
  loginHistory: z.enum(['COMPLETE', 'PARTIAL', 'UNKNOWN']),
  loginEvidence: z.enum(['UNKNOWN', 'RETAINED_AUDIT', 'OBSERVED_AUTH']),
});
