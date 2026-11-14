import { companyAllows, validCompanyOverride } from './company-policy.js';
import type { CompanyRule, CorporateRole } from './company-policy.js';
export type MoveNode = {
  id: string;
  kind: 'DEPARTMENT' | 'UNIT';
  departmentId: string | null;
};
export type MoveRefusal =
  | 'MOVE_SELF_PARENT'
  | 'MOVE_CYCLE'
  | 'MOVE_LEVEL_CHANGE'
  | 'MOVE_SAME_PARENT'
  | 'MOVE_POLICY_CONFLICT';
type Policy = { rules: CompanyRule[] };

/**
 * OD-5: the tree is Company → department → unit and a context's level is its
 * immutable identity. Only a unit moves, to another department, and only when
 * its own rules stay valid under the destination ancestors.
 */
export function moveRefusal(
  scope: MoveNode,
  parent: MoveNode | null,
  destination: { ancestors: Policy[]; own: Policy } | null,
): MoveRefusal | null {
  if (parent?.id === scope.id) return 'MOVE_SELF_PARENT';
  if (parent?.kind === 'UNIT' && parent.departmentId === scope.id)
    return 'MOVE_CYCLE';
  if (scope.kind === 'DEPARTMENT')
    return parent ? 'MOVE_LEVEL_CHANGE' : 'MOVE_SAME_PARENT';
  if (!parent || parent.kind === 'UNIT') return 'MOVE_LEVEL_CHANGE';
  if (parent.id === scope.departmentId) return 'MOVE_SAME_PARENT';
  if (
    destination &&
    !validCompanyOverride(destination.ancestors, destination.own.rules)
  )
    return 'MOVE_POLICY_CONFLICT';
  return null;
}

/** Seats whose structure/directory visibility differs between the two policy chains. */
export function moveAccessChanges(
  roles: CorporateRole[],
  before: Policy[],
  after: Policy[],
) {
  return roles.filter((role) =>
    (['structure.read', 'directory.read'] as const).some(
      (key) =>
        companyAllows(before, key, role) !== companyAllows(after, key, role),
    ),
  ).length;
}
