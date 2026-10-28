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
