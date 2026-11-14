import { describe, expect, it } from 'vitest';
import { moveAccessChanges, moveRefusal } from './context-move.js';
import type { CompanyRule } from './company-policy.js';

const dept = (id: string) => ({
  id,
  kind: 'DEPARTMENT' as const,
  departmentId: null,
});
const unit = (id: string, departmentId: string) => ({
  id,
  kind: 'UNIT' as const,
  departmentId,
});
const rule = (r: Partial<CompanyRule>): CompanyRule => ({
  key: 'directory.read',
  mode: 'DEFAULT',
  roles: ['OWNER', 'ORG_ADMIN', 'DEPT_MANAGER'],
  overrideDefault: false,
  ...r,
});
const ok = { ancestors: [{ rules: [] }, { rules: [] }], own: { rules: [] } };

describe('OD-5 context move rules', () => {
  it('moves a unit to another department only', () => {
    expect(moveRefusal(unit('u', 'a'), dept('b'), ok)).toBeNull();
    expect(moveRefusal(unit('u', 'a'), dept('a'), ok)).toBe('MOVE_SAME_PARENT');
    expect(moveRefusal(unit('u', 'a'), null, null)).toBe('MOVE_LEVEL_CHANGE');
    expect(moveRefusal(unit('u', 'a'), unit('v', 'b'), null)).toBe(
      'MOVE_LEVEL_CHANGE',
    );
  });
  it('refuses self-parenting, cycles and department level changes', () => {
    expect(moveRefusal(dept('a'), dept('a'), null)).toBe('MOVE_SELF_PARENT');
    expect(moveRefusal(unit('u', 'a'), unit('u', 'a'), null)).toBe(
      'MOVE_SELF_PARENT',
    );
    expect(moveRefusal(dept('a'), unit('u', 'a'), null)).toBe('MOVE_CYCLE');
    expect(moveRefusal(dept('a'), dept('b'), null)).toBe('MOVE_LEVEL_CHANGE');
    expect(moveRefusal(dept('a'), null, null)).toBe('MOVE_SAME_PARENT');
  });
  it('refuses a unit whose own DEFAULT rule would silently stop overriding the destination', () => {
    const own = { rules: [rule({})] };
    const destination = { rules: [rule({ roles: ['OWNER'] })] };
    expect(
      moveRefusal(unit('u', 'a'), dept('b'), {
        ancestors: [{ rules: [] }, destination],
        own,
      }),
    ).toBe('MOVE_POLICY_CONFLICT');
  });
  it('counts seats whose visibility changes under the destination chain', () => {
    const before = [{ rules: [] }, { rules: [] }, { rules: [] }];
    const after = [
      { rules: [] },
      {
        rules: [
          rule({
            mode: 'MANDATORY',
            roles: ['OWNER', 'ORG_ADMIN', 'DEPT_MANAGER', 'TEAM_LEAD'],
          }),
        ],
      },
      { rules: [] },
    ];
    expect(
      moveAccessChanges(['MEMBER', 'VIEWER', 'TEAM_LEAD'], before, after),
    ).toBe(2);
    expect(moveAccessChanges(['MEMBER'], before, before)).toBe(0);
  });
});
