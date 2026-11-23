import { z } from 'zod';
export const AdminProvisionSchema = z.strictObject({
  email: z.email().transform((v) => v.toLowerCase()),
  name: z.string().min(1).max(200),
  password: z.string().min(16).max(128),
  role: z.enum([
    'SUPER_ADMIN',
    'SUPPORT',
    'BILLING_MANAGER',
    'SECURITY_REVIEWER',
  ]),
});
export const adminAuthRoutes: Record<string, z.ZodType> = {
  'POST /sign-in/email': z.strictObject({
    email: z.email(),
    password: z.string().min(1).max(1024),
  }),
  'POST /sign-out': z.strictObject({}),
  'POST /two-factor/enable': z.strictObject({
    password: z.string().min(1).max(1024),
  }),
  'POST /two-factor/verify-totp': z.strictObject({
    code: z.string().regex(/^\d{6}$/),
  }),
  'POST /two-factor/verify-backup-code': z.strictObject({
    code: z.string().min(1).max(128),
  }),
  'GET /list-sessions': z.strictObject({}),
  'POST /revoke-session': z.strictObject({ token: z.string().min(1).max(512) }),
  'POST /revoke-sessions': z.strictObject({}),
  'POST /revoke-other-sessions': z.strictObject({}),
};
