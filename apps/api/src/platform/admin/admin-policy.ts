import {
  adminManagementRoutes,
  adminSecurityRoutes,
  adminAuditRoutes,
  adminUserSecurityRoutes,
  adminRetentionRoutes,
  adminPrivacyRoutes,
} from '@mehran/api-contracts';

export const adminPermissions = [
  'admin.session.read',
  'admin.session.revoke',
  'admin.super',
  ...Object.values(adminManagementRoutes).map((r) => r.permission),
  ...Object.values(adminSecurityRoutes).map((r) => r.permission),
  ...Object.values(adminAuditRoutes).map((r) => r.permission),
  ...Object.values(adminUserSecurityRoutes).map((r) => r.permission),
  ...Object.values(adminRetentionRoutes).map((r) => r.permission),
  ...Object.values(adminPrivacyRoutes).map((r) => r.permission),
  'admin.privacy.accounts.delete',
  'admin.privacy.workspaces.delete',
  'admin.audit.category.security',
  'admin.audit.category.control',
  'admin.audit.category.privacy',
  'admin.audit.sensitive',
] as const;
export type AdminPermission = (typeof adminPermissions)[number];
export function permits(role: string, permission: string): boolean {
  if (!(adminPermissions as readonly string[]).includes(permission))
    return false;
  return (
    Object.hasOwn(adminRolePermissions, role) &&
    adminRolePermissions[role]!.includes(permission)
  );
}

const ownSession = ['admin.session.read', 'admin.session.revoke'];
const metadataRead = [
  'admin.dashboard.read',
  'admin.dashboard.export',
  'admin.users.read',
  'admin.workspaces.read',
  'admin.memberships.read',
];
export const adminRolePermissions: Record<string, readonly string[]> = {
  SUPER_ADMIN: [...new Set(adminPermissions)],
  SUPPORT: [
    ...ownSession,
    ...metadataRead,
    'admin.users.update',
    'admin.users.recovery_initiate',
    'admin.users.sessions.revoke',
    'admin.audit.read',
    'admin.audit.category.control',
  ],
  SECURITY_REVIEWER: [
    ...ownSession,
    ...metadataRead,
    'admin.users.sessions.revoke',
    'admin.security.read',
    'admin.security.sessions.read',
    'admin.security.sessions.revoke',
    'admin.security.user_sessions.read',
    'admin.security.user_sessions.revoke',
    'admin.security.user_login.restrict',
    'admin.security.user_recovery.initiate',
    'admin.audit.read',
    'admin.audit.export',
    'admin.audit.category.security',
  ],
  BILLING_MANAGER: ownSession,
};
