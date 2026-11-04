export const roles = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'] as const;
export type SharedRole = (typeof roles)[number];
export type MemberRole = Exclude<SharedRole, 'OWNER'>;
export const ordinaryCapabilities = [
  'task.read',
  'task.create',
  'task.update',
  'task.complete',
  'task.delete',
  'assignment.accept',
  'assignment.decline',
  'assignment.assign',
  'workflow.transition',
  'workflow.publish',
  'export.visible',
  'file.read',
] as const;
export type OrdinaryCapability = (typeof ordinaryCapabilities)[number];
export const fixedCapabilities = [
  'comment.create',
  'goal.manage',
  'work.manage',
  'membership.member',
  'membership.manager',
  'membership.admin',
  'policy.publish',
  'settings.manage',
  'custody.archive',
  'custody.handover',
  'custody.transfer',
  'custody.dissolve',
  'membership.leave',
  'custody.accept',
] as const;
export type SharedCapability =
  OrdinaryCapability | (typeof fixedCapabilities)[number];
export type RoleDefaults = Record<SharedRole, OrdinaryCapability[]>;
export const defaultPolicy: RoleDefaults = {
  OWNER: [...ordinaryCapabilities],
  ADMIN: [...ordinaryCapabilities],
  MANAGER: ordinaryCapabilities.filter((c) => c !== 'export.visible'),
  MEMBER: [
    'task.read',
    'task.create',
    'task.update',
    'task.complete',
    'assignment.accept',
    'assignment.decline',
    'workflow.transition',
    'file.read',
  ],
  VIEWER: ['task.read', 'file.read'],
};
export function withinCeiling(
  role: SharedRole,
  capability: OrdinaryCapability,
) {
  if (role === 'VIEWER')
    return ['task.read', 'export.visible', 'file.read'].includes(capability);
  if (role === 'MEMBER')
    return !['task.delete', 'workflow.publish'].includes(capability);
  return true;
}
export function validateRoleDefaults(value: unknown): value is RoleDefaults {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === roles.length &&
    roles.every((role) => {
      const caps = record[role];
      return (
        Array.isArray(caps) &&
        new Set(caps).size === caps.length &&
        caps.every(
          (cap: unknown) =>
            ordinaryCapabilities.includes(cap as OrdinaryCapability) &&
            withinCeiling(role, cap as OrdinaryCapability),
        )
      );
    })
  );
}
export function permits(
  role: SharedRole | null,
  capability: SharedCapability,
  policy: RoleDefaults,
) {
  if (!role) return false;
  if (capability === 'membership.leave') return true;
  if (capability === 'custody.accept') return true;
  if (ordinaryCapabilities.includes(capability as OrdinaryCapability))
    return policy[role].includes(capability as OrdinaryCapability);
  if (
    capability === 'membership.admin' ||
    (capability.startsWith('custody.') && capability !== 'custody.archive')
  )
    return role === 'OWNER';
  if (
    [
      'membership.manager',
      'policy.publish',
      'settings.manage',
      'custody.archive',
    ].includes(capability)
  )
    return role === 'OWNER' || role === 'ADMIN';
  if (['goal.manage', 'work.manage', 'membership.member'].includes(capability))
    return ['OWNER', 'ADMIN', 'MANAGER'].includes(role);
  return capability === 'comment.create' && role !== 'VIEWER';
}
export function roleAdministration(role: MemberRole) {
  return role === 'ADMIN'
    ? 'membership.admin'
    : role === 'MANAGER'
      ? 'membership.manager'
      : 'membership.member';
}
