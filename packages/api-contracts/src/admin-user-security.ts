import { z } from 'zod';
const empty = z.strictObject({});
const change = z.strictObject({
  revision: z.number().int().positive(),
  reason: z.string().trim().min(5).max(500),
});
const result = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
});
export const adminUserSecurityRoutes = {
  'GET security/users/:id/sessions': {
    permission: 'admin.security.user_sessions.read',
    schema: empty,
    response: z.strictObject({
      items: z
        .array(
          z.strictObject({
            id: z.uuid(),
            createdAt: z.iso.datetime(),
            expiresAt: z.iso.datetime(),
          }),
        )
        .max(100),
      truncated: z.boolean(),
    }),
  },
  'POST security/users/:id/revoke-sessions': {
    permission: 'admin.security.user_sessions.revoke',
    schema: change.extend({
      sessionIds: z.array(z.uuid()).min(1).max(100).optional(),
    }),
    response: result,
  },
  'POST security/users/:id/block-login': {
    permission: 'admin.security.user_login.restrict',
    schema: change.extend({ expiresAt: z.iso.datetime().optional() }),
    response: result,
  },
  'POST security/users/:id/unblock-login': {
    permission: 'admin.security.user_login.restrict',
    schema: change,
    response: result,
  },
  'POST security/users/:id/recovery': {
    permission: 'admin.security.user_recovery.initiate',
    schema: change,
    response: result,
  },
} as const;
