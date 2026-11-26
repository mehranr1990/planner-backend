import { it, expect } from 'vitest';
import { trafficBinding, maintenanceBlocks } from './traffic.js';
it('matches Express case-insensitive routes and nested module operations without losing maintenance fences', () => {
  for (const [path, method, module, operation] of [
    ['/api/v1/focus/sessions', 'POST', 'focus', 'write'],
    ['/api/v1/teams/opaque/files', 'POST', 'files', 'upload'],
    ['/api/v1/social-groups/opaque', 'GET', 'social', 'read'],
    ['/api/v1/tasks/opaque', 'DELETE', 'tasks', 'delete'],
    ['/api/v1/me/exports', 'POST', 'account', 'export'],
  ] as const) {
    const expected = { module, operation };
    expect(trafficBinding(path, method)).toEqual(expected);
    expect(trafficBinding(path.toUpperCase(), method.toLowerCase())).toEqual(
      expected,
    );
    expect(maintenanceBlocks('FULL', [], expected)).toBe(true);
  }
});
