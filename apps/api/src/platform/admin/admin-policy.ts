import { adminCommerceRoutes } from '@mehran/api-contracts';
import { adminEngagementRoutes } from '@mehran/api-contracts';
import {
  adminManagementRoutes,
  adminSecurityRoutes,
  adminAuditRoutes,
  adminUserSecurityRoutes,
  adminRetentionRoutes,
  adminPrivacyRoutes,
  adminOperationsRoutes,
} from '@mehran/api-contracts';

export const adminPermissions = [
  'admin.configuration.sensitive.publish',
  ...Object.values(adminConfigurationRoutes).map((r) => r.permission),
  ...Object.values(adminCommerceRoutes).map((r) => r.permission),
  ...Object.values(adminEngagementRoutes).map((r) => r.permission),
  'admin.session.read',
  'admin.session.revoke',
  'admin.super',
  ...Object.values(adminManagementRoutes).map((r) => r.permission),
  ...Object.values(adminSecurityRoutes).map((r) => r.permission),
  ...Object.values(adminAuditRoutes).map((r) => r.permission),
  ...Object.values(adminUserSecurityRoutes).map((r) => r.permission),
  ...Object.values(adminRetentionRoutes).map((r) => r.permission),
  ...Object.values(adminPrivacyRoutes).map((r) => r.permission),
  ...Object.values(adminOperationsRoutes).map((r) => r.permission),
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
    'admin.support.read',
    'admin.support.reply',
    'admin.support.assign',
    'admin.users.update',
    'admin.users.recovery_initiate',
    'admin.users.sessions.revoke',
    'admin.audit.read',
    'admin.audit.category.control',
  ],
  SECURITY_REVIEWER: [
    'admin.moderation.read',
    'admin.moderation.report',
    'admin.moderation.manage',
    'admin.moderation.content.read',
    'admin.moderation.penalty',
    'admin.health.read',
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
  BILLING_MANAGER: [
    ...ownSession,
    'admin.plans.read',
    'admin.subscriptions.read',
    'admin.subscriptions.manage',
    'admin.billing.read',
    'admin.billing.manage',
    'admin.billing.verify',
    'admin.billing.correct',
    'admin.billing.refund',
  ],
};
import { adminConfigurationRoutes } from '@mehran/api-contracts';
