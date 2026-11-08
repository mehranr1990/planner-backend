import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
]);
export const RequestIdSchema = z.string().uuid();
export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z
      .array(z.strictObject({ path: z.string(), code: z.string() }))
      .optional(),
    requestId: RequestIdSchema,
  }),
});
export const EmptyQuerySchema = z.strictObject({});
export const LiveHealthSchema = z.strictObject({ status: z.literal('ok') });
export const ReadyHealthSchema = z.strictObject({
  status: z.literal('ok'),
  checks: z.strictObject({ database: z.literal('up') }),
});
export const healthRoutes = {
  live: '/health/live',
  ready: '/health/ready',
} as const;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export * from './account.js';
export * from './auth.js';
export * from './foundation.js';
export * from './files.js';
export * from './tasks.js';
export * from './task-tools.js';
export * from './recurrence.js';
export * from './planning.js';
export * from './calendar.js';
export * from './habits.js';

export * from './goals.js';

export * from './focus.js';

export * from './writing.js';
export * from './voice-files.js';

export * from './finance.js';
export * from './finance-currencies.js';

export * from './notifications.js';
export * from './insights.js';
export * from './sync.js';
export * from './lifecycle.js';
export * from './collaboration.js';
export * from './projects.js';
export * from './work.js';
export * from './project-tools.js';
export * from './project-execution.js';
export * from './project-collaboration.js';
export * from './project-transfer.js';
export * from './project-lifecycle.js';
export * from './teams.js';
export * from './team-work.js';
export * from './team-analytics.js';

export * from './team-interactions.js';

export * from './team-lifecycle.js';

export * from './companies.js';
export * from './company-staff.js';
export * from './company-finance.js';

export * from './company-settlements.js';

export * from './company-knowledge.js';
export * from './company-lifecycle.js';

export * from './company-associations.js';
export * from './messaging.js';
