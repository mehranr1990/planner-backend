export const adminPermissions = [
  'admin.session.read',
  'admin.session.revoke',
  'admin.super',
] as const;
export type AdminPermission = (typeof adminPermissions)[number];
export function permits(role: string, permission: string): boolean {
  if (!(adminPermissions as readonly string[]).includes(permission))
    return false;
  if (role === 'SUPER_ADMIN') return true;
  return (
    ['SUPPORT', 'BILLING_MANAGER', 'SECURITY_REVIEWER'].includes(role) &&
    permission !== 'admin.super'
  );
}
