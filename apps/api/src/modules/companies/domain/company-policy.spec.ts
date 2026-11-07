import { it, expect } from 'vitest';
import {
  companyAllows,
  validCompanyOverride,
  corporateRoles,
} from './company-policy.js';
import type { CompanyRule } from './company-policy.js';
const r = (
  mode: CompanyRule['mode'],
  roles: CompanyRule['roles'],
  overrideDefault = false,
): CompanyRule => ({ key: 'structure.read', mode, roles, overrideDefault });
it('never broadens an inherited mandatory denial through default or optional configuration', () => {
  const chain = [
    { rules: [r('MANDATORY', ['OWNER'])] },
    { rules: [r('DEFAULT', [...corporateRoles], true)] },
    { rules: [r('OPTIONAL', [...corporateRoles])] },
  ];
  expect(companyAllows(chain, 'structure.read', 'MEMBER')).toBe(false);
  expect(companyAllows(chain, 'structure.read', 'OWNER')).toBe(true);
});
it('requires an explicit override when a default is inherited, including newly introduced parent defaults', () => {
  const parent = { rules: [r('DEFAULT', ['OWNER'])] },
    child = { rules: [r('DEFAULT', [...corporateRoles])] };
  expect(validCompanyOverride([parent], child.rules)).toBe(false);
  expect(companyAllows([parent, child], 'structure.read', 'MEMBER')).toBe(
    false,
  );
  expect(
    companyAllows(
      [parent, { rules: [r('DEFAULT', [...corporateRoles], true)] }],
      'structure.read',
      'MEMBER',
    ),
  ).toBe(true);
});
it('keeps optional settings inside default and mandatory ceilings', () => {
  expect(
    companyAllows(
      [
        { rules: [r('DEFAULT', ['OWNER'])] },
        { rules: [r('OPTIONAL', [...corporateRoles])] },
      ],
      'structure.read',
      'VIEWER',
    ),
  ).toBe(false);
  expect(
    companyAllows(
      [{ rules: [r('OPTIONAL', ['OWNER'])] }],
      'structure.read',
      'VIEWER',
    ),
  ).toBe(false);
  expect(companyAllows([], 'directory.read', 'VIEWER')).toBe(true);
});
