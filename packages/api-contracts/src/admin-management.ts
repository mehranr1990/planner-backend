import { z } from 'zod';

export const AdminReasonSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
  internalNote: z.string().trim().max(2000).optional(),
  revision: z.number().int().positive(),
});
export const AdminSuspensionSchema = AdminReasonSchema.extend({
  expiresAt: z.iso.datetime().optional(),
});
export const AdminProfileSchema = AdminReasonSchema.extend({
  name: z.string().trim().min(1).max(200),
});
export const AdminVerifyEmailSchema = AdminReasonSchema.extend({
  email: z.email(),
});
export const AdminPageSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(1024).optional(),
  search: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  type: z.enum(['PERSONAL', 'TEAM', 'COMPANY']).optional(),
  from: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
  sort: z.enum(['createdAt', 'createdAt_desc']).default('createdAt'),
});
export const AdminDashboardQuerySchema = z.strictObject({
  range: z.enum(['today', '7d', '30d', '90d', 'custom']).default('30d'),
  from: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
});
export const AdminUserQuerySchema = AdminPageSchema.omit({ type: true });
export const AdminWorkspaceQuerySchema = AdminPageSchema.extend({
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});
export const AdminWorkspaceCreateSchema = z.strictObject({
  id: z.uuid(),
  type: z.enum(['TEAM', 'COMPANY']),
  ownerUserId: z.uuid(),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10000).optional(),
  retentionPolicyVersion: z.string().min(1).max(80),
  reason: z.string().trim().min(1).max(500),
  internalNote: z.string().max(2000).optional(),
});
export const AdminWorkspaceProfileSchema = AdminReasonSchema.extend({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10000).optional(),
});
export const AdminMemberAddSchema = z.strictObject({
  userId: z.uuid(),
  role: z.enum([
    'ADMIN',
    'MANAGER',
    'LEAD',
    'ORG_ADMIN',
    'DEPT_MANAGER',
    'TEAM_LEAD',
    'MEMBER',
    'VIEWER',
  ]),
  reason: z.string().trim().min(1).max(500),
  internalNote: z.string().max(2000).optional(),
});
export const AdminMemberChangeSchema = AdminReasonSchema.extend({
  membershipId: z.uuid(),
  role: z
    .enum([
      'ADMIN',
      'MANAGER',
      'LEAD',
      'ORG_ADMIN',
      'DEPT_MANAGER',
      'TEAM_LEAD',
      'MEMBER',
      'VIEWER',
    ])
    .optional(),
});
export const AdminInvitationActionSchema = AdminReasonSchema.extend({
  invitationId: z.uuid(),
});
export const AdminHandoverInitiateSchema = AdminReasonSchema.extend({
  successorAccessId: z.uuid(),
});
export const AdminMembershipQuerySchema = AdminPageSchema.omit({
  status: true,
  type: true,
}).extend({
  status: z
    .enum(['ACTIVE', 'SUSPENDED', 'LEFT', 'REVOKED', 'ERASED'])
    .optional(),
  role: z
    .enum([
      'OWNER',
      'ADMIN',
      'MANAGER',
      'LEAD',
      'ORG_ADMIN',
      'DEPT_MANAGER',
      'TEAM_LEAD',
      'MEMBER',
      'VIEWER',
    ])
    .optional(),
});
export const AdminInvitationQuerySchema = AdminPageSchema.omit({
  status: true,
  type: true,
}).extend({
  status: z
    .enum(['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED'])
    .optional(),
});
export const AdminBulkPreviewSchema = z.strictObject({
  operation: z.enum(['suspend', 'reactivate']),
  userIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((v) => new Set(v).size === v.length),
  reason: z.string().trim().min(1).max(500),
  internalNote: z.string().max(2000).optional(),
  expiresAt: z.iso.datetime().optional(),
});
export const AdminBulkExecuteSchema = z.strictObject({
  previewId: z.uuid(),
  confirmation: z.array(z.uuid()).min(1).max(100),
});

export const adminManagementRoutes = {
  'GET dashboard': {
    permission: 'admin.dashboard.read',
    schema: AdminDashboardQuerySchema,
  },
  'GET dashboard/export': {
    permission: 'admin.dashboard.export',
    schema: AdminDashboardQuerySchema,
  },
  'GET users': { permission: 'admin.users.read', schema: AdminUserQuerySchema },
  'GET users/:id': {
    permission: 'admin.users.read',
    schema: z.strictObject({}),
  },
  'PATCH users/:id': {
    permission: 'admin.users.update',
    schema: AdminProfileSchema,
  },
  'POST users/:id/suspend': {
    permission: 'admin.users.suspend',
    schema: AdminSuspensionSchema,
  },
  'POST users/:id/reactivate': {
    permission: 'admin.users.reactivate',
    schema: AdminReasonSchema,
  },
  'POST users/:id/verify-email': {
    permission: 'admin.users.verify_email',
    schema: AdminVerifyEmailSchema,
  },
  'POST users/:id/revoke-sessions': {
    permission: 'admin.users.sessions.revoke',
    schema: AdminReasonSchema,
  },
  'POST users/:id/recovery': {
    permission: 'admin.users.recovery_initiate',
    schema: AdminReasonSchema,
  },
  'POST users/bulk/preview': {
    permission: 'admin.users.bulk_manage',
    schema: AdminBulkPreviewSchema,
  },
  'POST users/bulk/execute': {
    permission: 'admin.users.bulk_manage',
    schema: AdminBulkExecuteSchema,
  },
  'GET workspaces': {
    permission: 'admin.workspaces.read',
    schema: AdminWorkspaceQuerySchema,
  },
  'POST workspaces': {
    permission: 'admin.workspaces.create',
    schema: AdminWorkspaceCreateSchema,
  },
  'PATCH workspaces/:id': {
    permission: 'admin.workspaces.update',
    schema: AdminWorkspaceProfileSchema,
  },
  'POST workspaces/:id/owner-transfers': {
    permission: 'admin.workspaces.transfer_owner',
    schema: AdminHandoverInitiateSchema,
  },
  'POST workspaces/:id/memberships': {
    permission: 'admin.memberships.add',
    schema: AdminMemberAddSchema,
  },
  'POST workspaces/:id/memberships/remove': {
    permission: 'admin.memberships.remove',
    schema: AdminMemberChangeSchema.omit({ role: true }),
  },
  'PATCH workspaces/:id/memberships/role': {
    permission: 'admin.memberships.update_role',
    schema: AdminMemberChangeSchema.required({ role: true }),
  },
  'POST workspaces/:id/invitations/cancel': {
    permission: 'admin.memberships.invitations.manage',
    schema: AdminInvitationActionSchema,
  },
  'POST workspaces/:id/invitations/resend': {
    permission: 'admin.memberships.invitations.manage',
    schema: AdminInvitationActionSchema,
  },
  'GET workspaces/:id': {
    permission: 'admin.workspaces.read',
    schema: z.strictObject({}),
  },
  'POST workspaces/:id/suspend': {
    permission: 'admin.workspaces.suspend',
    schema: AdminSuspensionSchema,
  },
  'POST workspaces/:id/reactivate': {
    permission: 'admin.workspaces.reactivate',
    schema: AdminReasonSchema,
  },
  'GET workspaces/:id/memberships': {
    permission: 'admin.memberships.read',
    schema: AdminMembershipQuerySchema,
  },
  'GET users/:id/memberships': {
    permission: 'admin.memberships.read',
    schema: AdminMembershipQuerySchema,
  },
  'GET workspaces/:id/invitations': {
    permission: 'admin.memberships.read',
    schema: AdminInvitationQuerySchema,
  },
} as const;

const instant = z.iso.datetime(),
  count = z.number().int().nonnegative();
export const AdminUnavailableSchema = z.strictObject({
  available: z.literal(false),
  reason: z.string(),
});
const suspension = z
  .strictObject({
    publicReason: z.string().nullable(),
    expiresAt: instant.nullable(),
    effective: z.boolean(),
  })
  .nullable();
export const AdminUserDetailSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  createdAt: instant,
  updatedAt: instant,
  revision: z.number().int().positive(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']),
  suspension,
  security: z.strictObject({
    activeSessions: count,
    mfa: AdminUnavailableSchema,
  }),
  usage: AdminUnavailableSchema,
});
export const AdminWorkspaceDetailSchema = z.strictObject({
  id: z.uuid(),
  spaceId: z.uuid(),
  companyId: z.uuid().nullable(),
  parentScopeId: z.uuid().nullable(),
  type: z.enum(['PERSONAL', 'TEAM', 'COMPANY']),
  ownerUserId: z.uuid().nullable(),
  ownerAccessId: z.uuid().nullable(),
  lifecycleState: z.string(),
  revision: z.number().int().positive(),
  custodyRevision: z.number().int().positive(),
  profile: z
    .strictObject({
      title: z.string(),
      description: z.string().nullable(),
      revision: z.number().int().positive(),
    })
    .nullable(),
  createdAt: instant,
  updatedAt: instant,
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  suspension,
  activeMembers: count,
  pendingInvitations: count,
  capacity: AdminUnavailableSchema,
  usage: AdminUnavailableSchema,
});
export const AdminMembershipSchema = z.strictObject({
  id: z.uuid(),
  spaceId: z.uuid(),
  scopeId: z.uuid(),
  state: z.enum(['ACTIVE', 'SUSPENDED', 'LEFT', 'REVOKED', 'ERASED']),
  role: z.string().nullable(),
  revision: z.number().int().positive(),
  generation: z.number().int().positive(),
  createdAt: instant,
  endedAt: instant.nullable(),
  userId: z.uuid().nullable(),
});
export const AdminInvitationSchema = z.strictObject({
  id: z.uuid(),
  spaceId: z.uuid(),
  scopeId: z.uuid(),
  memberRole: z.string(),
  state: z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED']),
  revision: z.number().int().positive(),
  createdAt: instant,
  expiresAt: instant,
  endedAt: instant.nullable(),
  recipientUserId: z.uuid().nullable(),
});
const page = <T extends z.ZodType>(schema: T) =>
  z.strictObject({
    items: z.array(schema).max(100),
    nextCursor: z.string().nullable(),
  });
export const AdminSharedActionSchema = z.strictObject({
  id: z.uuid(),
  state: z.string(),
  revision: z.number().int().positive(),
  expiresAt: instant.optional(),
  expectedCustodyRevision: z.number().int().positive().optional(),
  role: z.string().nullable().optional(),
});
export const AdminWorkspaceProfileResultSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
  before: z.strictObject({
    title: z.string(),
    description: z.string().nullable(),
  }),
  after: z.strictObject({
    title: z.string(),
    description: z.string().nullable(),
  }),
});
const trend = z.array(z.strictObject({ day: z.iso.date(), count }));
export const AdminDashboardSchema = z.strictObject({
  range: z.strictObject({
    from: instant,
    until: instant,
    timezone: z.literal('UTC'),
    boundaries: z.literal('[from,until)'),
  }),
  users: z
    .strictObject({
      total: count,
      registrations: trend,
      active: count,
      inactive: count,
      suspended: count,
    })
    .optional(),
  workspaces: z
    .strictObject({
      personal: count,
      team: count,
      company: count,
      growth: trend,
      activeMemberships: count.optional(),
      invitations: z
        .array(z.strictObject({ state: z.string(), _count: count }))
        .optional(),
    })
    .optional(),
  securityWarnings: z
    .strictObject({ available: z.literal(true), deniedAdminRequests: count })
    .optional(),
  operationalWarnings: z.strictObject({
    available: z.literal(true),
    failedAdministrativeDeliveries: count,
  }),
  usage: z.union([
    AdminUnavailableSchema,
    z.strictObject({
      available: z.literal(true),
      definition: z.literal('NET_LEDGER_DELTA'),
      features: z.array(
        z.strictObject({ feature: z.string(), delta: z.number().int() }),
      ),
    }),
  ]),
});
export const AdminBulkPreviewResultSchema = z.strictObject({
  previewId: z.uuid(),
  expiresAt: instant,
  targets: z
    .array(
      z.strictObject({ id: z.uuid(), revision: count, eligible: z.boolean() }),
    )
    .max(100),
});
export const AdminBulkResultSchema = z.strictObject({
  previewId: z.uuid(),
  outcomes: z
    .array(
      z.strictObject({
        id: z.uuid(),
        outcome: z.enum(['SUCCEEDED', 'DENIED', 'FAILED']),
      }),
    )
    .max(100),
});
export const adminManagementResponses: Record<
  keyof typeof adminManagementRoutes,
  z.ZodType
> = {
  'GET dashboard': AdminDashboardSchema,
  'GET dashboard/export': z.string(),
  'GET users': page(AdminUserDetailSchema),
  'GET users/:id': AdminUserDetailSchema,
  'PATCH users/:id': AdminUserDetailSchema,
  'POST users/:id/suspend': AdminUserDetailSchema,
  'POST users/:id/reactivate': AdminUserDetailSchema,
  'POST users/:id/verify-email': AdminUserDetailSchema,
  'POST users/:id/revoke-sessions': AdminUserDetailSchema,
  'POST users/:id/recovery': AdminUserDetailSchema,
  'POST users/bulk/preview': AdminBulkPreviewResultSchema,
  'POST users/bulk/execute': AdminBulkResultSchema,
  'GET workspaces': page(AdminWorkspaceDetailSchema),
  'GET workspaces/:id': AdminWorkspaceDetailSchema,
  'POST workspaces': AdminWorkspaceDetailSchema,
  'PATCH workspaces/:id': AdminWorkspaceProfileResultSchema,
  'POST workspaces/:id/suspend': AdminWorkspaceDetailSchema,
  'POST workspaces/:id/reactivate': AdminWorkspaceDetailSchema,
  'GET workspaces/:id/memberships': page(AdminMembershipSchema),
  'GET users/:id/memberships': page(AdminMembershipSchema),
  'GET workspaces/:id/invitations': page(AdminInvitationSchema),
  'POST workspaces/:id/owner-transfers': AdminSharedActionSchema,
  'POST workspaces/:id/memberships': AdminSharedActionSchema,
  'POST workspaces/:id/memberships/remove': AdminSharedActionSchema,
  'PATCH workspaces/:id/memberships/role': AdminSharedActionSchema,
  'POST workspaces/:id/invitations/cancel': AdminSharedActionSchema,
  'POST workspaces/:id/invitations/resend': AdminSharedActionSchema,
};
export type AdminUserDetail = z.infer<typeof AdminUserDetailSchema>;
export type AdminWorkspaceDetail = z.infer<typeof AdminWorkspaceDetailSchema>;
export type AdminMembership = z.infer<typeof AdminMembershipSchema>;
export type AdminInvitation = z.infer<typeof AdminInvitationSchema>;
export type AdminDashboard = z.infer<typeof AdminDashboardSchema>;
export type AdminBulkResult = z.infer<typeof AdminBulkResultSchema>;
