import { describe, it, expect } from 'vitest';
import {
  roles,
  ordinaryCapabilities,
  defaultPolicy,
  permits,
  validateRoleDefaults,
} from './shared-policy.js';
import type { SharedCapability } from './shared-policy.js';
describe('P2-01 fixed roles and bounded policy', () => {
  it.each([
    ['task.read', roles],
    ['task.create', ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER']],
    ['task.update', ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER']],
    ['task.complete', ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER']],
    ['task.delete', ['OWNER', 'ADMIN', 'MANAGER']],
    ['assignment.assign', ['OWNER', 'ADMIN', 'MANAGER']],
    ['workflow.publish', ['OWNER', 'ADMIN', 'MANAGER']],
    ['export.visible', ['OWNER', 'ADMIN']],
    ['comment.create', ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER']],
    ['goal.manage', ['OWNER', 'ADMIN', 'MANAGER']],
    ['membership.member', ['OWNER', 'ADMIN', 'MANAGER']],
    ['membership.manager', ['OWNER', 'ADMIN']],
    ['membership.admin', ['OWNER']],
    ['policy.publish', ['OWNER', 'ADMIN']],
    ['settings.manage', ['OWNER', 'ADMIN']],
    ['custody.archive', ['OWNER', 'ADMIN']],
    ['custody.handover', ['OWNER']],
    ['custody.transfer', ['OWNER']],
    ['custody.dissolve', ['OWNER']],
  ] as const)('%s default and grant-only denial', (cap, allowed) => {
    for (const role of roles)
      expect(permits(role, cap, defaultPolicy)).toBe(
        (allowed as readonly string[]).includes(role),
      );
    expect(permits(null, cap, defaultPolicy)).toBe(false);
  });
  it('rejects privilege injection, unknown roles, duplicated capabilities and Viewer writes', () => {
    expect(validateRoleDefaults(defaultPolicy)).toBe(true);
    for (const cap of ordinaryCapabilities.filter(
      (c) => !['task.read', 'file.read', 'export.visible'].includes(c),
    ))
      expect(validateRoleDefaults({ ...defaultPolicy, VIEWER: [cap] })).toBe(
        false,
      );
    expect(
      validateRoleDefaults({ ...defaultPolicy, MEMBER: ['workflow.publish'] }),
    ).toBe(false);
    expect(
      validateRoleDefaults({ ...defaultPolicy, ADMIN: ['custody.handover'] }),
    ).toBe(false);
    expect(
      validateRoleDefaults({ ...defaultPolicy, PLATFORM_ADMIN: ['task.read'] }),
    ).toBe(false);
    expect(
      validateRoleDefaults({
        ...defaultPolicy,
        MEMBER: ['task.read', 'task.read'],
      }),
    ).toBe(false);
  });
  it('permits bounded export opt-in without delegating administration or removing Owner repair', () => {
    const policy = {
      ...defaultPolicy,
      OWNER: [],
      VIEWER: [
        'task.read',
        'export.visible',
      ] as (typeof ordinaryCapabilities)[number][],
    };
    expect(validateRoleDefaults(policy)).toBe(true);
    expect(permits('VIEWER', 'export.visible', policy)).toBe(true);
    expect(permits('VIEWER', 'policy.publish', policy)).toBe(false);
    expect(permits('OWNER', 'policy.publish', policy)).toBe(true);
    expect(
      permits(
        'PLATFORM_ADMIN' as never,
        'custody.handover' as SharedCapability,
        policy,
      ),
    ).toBe(false);
  });
});
