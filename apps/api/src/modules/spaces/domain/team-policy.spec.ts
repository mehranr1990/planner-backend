import { it, expect } from 'vitest';
import {
  permits,
  teamDefaultPolicy,
  defaultPolicy,
  validateRoleDefaults,
  roleInContext,
  roleAdministration,
} from './shared-policy.js';
it('keeps Team Lead and Project Manager catalogs distinct with the same bounded delegation tier', () => {
  expect(validateRoleDefaults(teamDefaultPolicy)).toBe(true);
  expect(
    validateRoleDefaults({ ...teamDefaultPolicy, MANAGER: ['task.read'] }),
  ).toBe(false);
  expect(roleInContext('LEAD', 'TEAM')).toBe(true);
  expect(roleInContext('MANAGER', 'TEAM')).toBe(false);
  expect(roleInContext('LEAD', 'PROJECT')).toBe(false);
  expect(roleInContext('MANAGER', 'PROJECT')).toBe(true);
  expect(roleAdministration('LEAD')).toBe('membership.manager');
  for (const cap of [
    'membership.manager',
    'membership.admin',
    'settings.manage',
    'policy.publish',
    'custody.handover',
  ] as const)
    expect(permits('LEAD', cap, teamDefaultPolicy)).toBe(false);
  expect(permits('LEAD', 'membership.member', teamDefaultPolicy)).toBe(true);
  expect(permits('LEAD', 'task.read', defaultPolicy)).toBe(false);
  expect(permits('VIEWER', 'membership.member', teamDefaultPolicy)).toBe(false);
});
