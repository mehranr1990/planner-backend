import { adminManagementRoutes } from '@mehran/api-contracts';

export const adminPermissions = [
  'admin.session.read',
  'admin.session.revoke',
  'admin.super',
  ...Object.values(adminManagementRoutes).map((r) => r.permission),
] as const;
export type AdminPermission = (typeof adminPermissions)[number];
export function permits(role: string, permission: string): boolean {
  if (!(adminPermissions as readonly string[]).includes(permission))
    return false;
  return (adminRolePermissions[role] ?? []).includes(permission);
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
  ],
  SECURITY_REVIEWER: [
    ...ownSession,
    ...metadataRead,
    'admin.users.sessions.revoke',
  ],
  BILLING_MANAGER: ownSession,
};
