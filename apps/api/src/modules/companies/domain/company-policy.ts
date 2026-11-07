export const corporateRoles = [
  'OWNER',
  'ORG_ADMIN',
  'DEPT_MANAGER',
  'TEAM_LEAD',
  'MEMBER',
  'VIEWER',
] as const;
export type CorporateRole = (typeof corporateRoles)[number];
export type CompanyRule = {
  key: 'structure.read' | 'directory.read';
  mode: 'MANDATORY' | 'DEFAULT' | 'OPTIONAL';
  roles: CorporateRole[];
  overrideDefault: boolean;
};
export function companyAllows(
  chain: readonly { rules: CompanyRule[] }[],
  key: CompanyRule['key'],
  role: CorporateRole,
) {
  let ordinary: readonly CorporateRole[] = corporateRoles;
  const restrictions: CorporateRole[][] = [];
  let inheritedDefault = false;
  for (const policy of chain)
    for (const rule of policy.rules) {
      if (rule.key !== key) continue;
      if (rule.mode === 'DEFAULT') {
        if (!inheritedDefault || rule.overrideDefault) ordinary = rule.roles;
        inheritedDefault = true;
      } else restrictions.push(rule.roles);
    }
  return (
    ordinary.includes(role) &&
    restrictions.every((roles) => roles.includes(role))
  );
}
export function validCompanyOverride(
  ancestors: readonly { rules: CompanyRule[] }[],
  rules: CompanyRule[],
) {
  return rules.every(
    (rule) =>
      rule.mode !== 'DEFAULT' ||
      !ancestors.some((p) =>
        p.rules.some((r) => r.key === rule.key && r.mode === 'DEFAULT'),
      ) ||
      rule.overrideDefault,
  );
}
