import { z } from 'zod';
import { ProfileSchema } from './account.js';

const CallbackSchema = z.string().min(1).max(2048);
const EmailSchema = z
  .string()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const PasswordSchema = z.string().min(8).max(128);
const EmptySchema = z.strictObject({});
export const authRoutes = {
  'POST /sign-up/email': z.strictObject({
    name: z.string().trim().min(1).max(100),
    email: EmailSchema,
    password: PasswordSchema,
    callbackURL: CallbackSchema.optional(),
    rememberMe: z.boolean().optional(),
  }),
  'POST /sign-in/email': z.strictObject({
    email: EmailSchema,
    password: z.string().min(1).max(128),
    callbackURL: CallbackSchema.optional(),
    rememberMe: z.boolean().optional(),
  }),
  'POST /sign-out': EmptySchema,
  'GET /get-session': EmptySchema,
  'GET /list-sessions': EmptySchema,
  'POST /revoke-session': z.strictObject({ token: z.string().min(1).max(512) }),
  'POST /revoke-sessions': EmptySchema,
  'POST /revoke-other-sessions': EmptySchema,
  'POST /request-password-reset': z.strictObject({
    email: EmailSchema,
    redirectTo: CallbackSchema.optional(),
  }),
  'POST /reset-password': z.strictObject({
    newPassword: PasswordSchema,
    token: z.string().min(1).max(2048),
  }),
  'POST /send-verification-email': z.strictObject({
    email: EmailSchema,
    callbackURL: CallbackSchema.optional(),
  }),
  'GET /verify-email': z.strictObject({
    token: z.string().min(1).max(4096),
    callbackURL: CallbackSchema.optional(),
  }),
  'POST /change-email': z.strictObject({
    newEmail: EmailSchema,
    callbackURL: CallbackSchema.optional(),
  }),
  'POST /change-password': z.strictObject({
    newPassword: PasswordSchema,
    currentPassword: z.string().min(1).max(128),
    revokeOtherSessions: z.boolean().optional(),
  }),
} as const;
export const PasswordResetCallbackQuerySchema = z.strictObject({
  callbackURL: CallbackSchema,
});

export const AuthSessionSchema = z.strictObject({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  token: z.string(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  ipAddress: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
});
export const AuthStatusSchema = z.strictObject({ status: z.boolean() });
export const AuthUserTokenSchema = z.strictObject({
  token: z.string().nullable(),
  user: ProfileSchema,
});
export const AuthSignInSchema = z.strictObject({
  redirect: z.boolean(),
  token: z.string(),
  url: z.string().optional(),
  user: ProfileSchema,
});
export const AuthCurrentSessionSchema = z
  .strictObject({ session: AuthSessionSchema, user: ProfileSchema })
  .nullable();
export const AuthSessionsSchema = z.array(AuthSessionSchema);
export const AuthRecoverySchema = z.strictObject({
  status: z.boolean(),
  message: z.string(),
});
export const AuthVerifySchema = z.strictObject({
  status: z.boolean(),
  user: ProfileSchema.nullable().optional(),
});
export const AuthSignOutSchema = z.strictObject({ success: z.boolean() });
export const authResponseSchemas: Record<string, z.ZodType> = {
  'POST /sign-up/email': AuthUserTokenSchema,
  'POST /sign-in/email': AuthSignInSchema,
  'POST /sign-out': AuthSignOutSchema,
  'GET /get-session': AuthCurrentSessionSchema,
  'GET /list-sessions': AuthSessionsSchema,
  'POST /revoke-session': AuthStatusSchema,
  'POST /revoke-sessions': AuthStatusSchema,
  'POST /revoke-other-sessions': AuthStatusSchema,
  'POST /request-password-reset': AuthRecoverySchema,
  'POST /reset-password': AuthStatusSchema,
  'POST /send-verification-email': AuthStatusSchema,
  'GET /verify-email': AuthVerifySchema,
  'POST /change-email': AuthStatusSchema,
  'POST /change-password': AuthUserTokenSchema,
};
