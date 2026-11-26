import { z } from 'zod';

const uuid = z.uuid();
const instant = z.iso.datetime();
const reason = z.string().trim().min(5).max(500);
const empty = z.strictObject({});
export const AdminSecurityPolicySchema = z.strictObject({
  adminLoginMax: z.number().int().min(1).max(5),
  userLoginMax: z.number().int().min(1).max(3),
  alertThreshold: z.number().int().min(1).max(100),
  alertWindowSeconds: z.number().int().min(60).max(3600),
  alertSeverity: z.enum(['WARNING', 'CRITICAL']),
  alertChannels: z
    .array(z.enum(['IN_APP', 'EMAIL']))
    .min(1)
    .max(2)
    .refine((v) => new Set(v).size === v.length),
});
export const AdminSecurityPolicyViewSchema = z.strictObject({
  revision: z.number().int().positive(),
  policy: AdminSecurityPolicySchema,
});
export const AdminCriticalRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.enum([
      'CONFIG_PUBLICATION',
      'CONFIG_KILL_RELEASE',
      'MAINTENANCE_REOPEN',
    ]),
    targetId: uuid,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    reason,
  }),
  z.strictObject({
    action: z.literal('MFA_RECOVERY'),
    targetAdminId: uuid,
    identityReviewReference: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{4,119}$/),
    identityVerified: z.literal(true),
    reason,
  }),
  z.strictObject({
    action: z.literal('SECURITY_POLICY'),
    revision: z.number().int().positive(),
    policy: AdminSecurityPolicySchema,
    reason,
  }),
]);
export const AdminApprovalViewSchema = z.strictObject({
  request: AdminCriticalRequestSchema,
  id: uuid,
  action: z.enum([
    'MFA_RECOVERY',
    'SECURITY_POLICY',
    'CONFIG_PUBLICATION',
    'CONFIG_KILL_RELEASE',
    'MAINTENANCE_REOPEN',
  ]),
  state: z.enum(['PENDING', 'APPROVED', 'EXECUTED', 'REJECTED', 'EXPIRED']),
  requesterAdminId: uuid,
  approverAdminId: uuid.nullable(),
  expiresAt: instant,
  createdAt: instant,
  completedAt: instant.nullable(),
});
const sessions = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: uuid,
        createdAt: instant,
        expiresAt: instant,
      }),
    )
    .max(100),
  truncated: z.boolean(),
});
const result = z.strictObject({ revoked: z.number().int().nonnegative() });
export const adminSecurityRoutes = {
  'GET security/alerts': {
    permission: 'admin.security.read',
    schema: z.strictObject({
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
    response: z.strictObject({
      items: z
        .array(
          z.strictObject({
            id: uuid,
            rule: z.literal('LOGIN_FAILURES'),
            bucketStart: instant,
            policyRevision: z.number().int().positive(),
            severity: z.enum(['WARNING', 'CRITICAL']),
            observed: z.number().int().positive(),
            threshold: z.number().int().positive(),
            createdAt: instant,
          }),
        )
        .max(100),
    }),
  },
  'GET security/policy': {
    permission: 'admin.security.read',
    schema: empty,
    response: AdminSecurityPolicyViewSchema,
  },
  'POST security/approvals': {
    permission: 'admin.security.critical.request',
    schema: AdminCriticalRequestSchema,
    response: AdminApprovalViewSchema,
  },
  'GET security/approvals/:id': {
    permission: 'admin.security.critical.request',
    schema: empty,
    response: AdminApprovalViewSchema,
  },
  'POST security/approvals/:id/approve': {
    permission: 'admin.security.critical.approve',
    schema: z.strictObject({ reason, identityVerified: z.literal(true) }),
    response: AdminApprovalViewSchema,
  },
  'POST security/approvals/:id/reject': {
    permission: 'admin.security.critical.approve',
    schema: z.strictObject({ reason }),
    response: AdminApprovalViewSchema,
  },
  'POST security/approvals/:id/execute': {
    permission: 'admin.security.critical.request',
    schema: empty,
    response: AdminApprovalViewSchema,
  },
  'GET security/admins/:id/sessions': {
    permission: 'admin.security.sessions.read',
    schema: empty,
    response: sessions,
  },
  'POST security/admins/:id/revoke-sessions': {
    permission: 'admin.security.sessions.revoke',
    schema: z.strictObject({
      reason,
      sessionIds: z.array(uuid).min(1).max(100).optional(),
    }),
    response: result,
  },
  'POST security/admins/:id/block-login': {
    permission: 'admin.security.login.restrict',
    schema: z.strictObject({ reason, blockedUntil: instant.nullable() }),
    response: z.strictObject({ id: uuid, blockedUntil: instant.nullable() }),
  },
} as const;
