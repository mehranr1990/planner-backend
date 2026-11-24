import { describe, it, expect } from 'vitest';
import {
  adminManagementRoutes,
  adminManagementResponses,
  AdminUserDetailSchema,
  AdminWorkspaceProfileSchema,
} from './admin-management.js';
describe('Platform Admin P1 contract boundaries', () => {
  it('defines a concrete nonempty success contract for every JSON operation', () => {
    expect(Object.keys(adminManagementResponses).sort()).toEqual(
      Object.keys(adminManagementRoutes).sort(),
    );
    for (const [route, schema] of Object.entries(adminManagementResponses))
      if (!route.endsWith('/export'))
        expect(schema.safeParse({}).success, route).toBe(false);
  });
  it('rejects unused filters and ownership/security mass assignment', () => {
    expect(
      adminManagementRoutes['GET users'].schema.safeParse({ type: 'TEAM' })
        .success,
    ).toBe(false);
    expect(
      adminManagementRoutes['GET workspaces'].schema.safeParse({
        status: 'INACTIVE',
      }).success,
    ).toBe(false);
    expect(
      AdminWorkspaceProfileSchema.safeParse({
        revision: 1,
        title: 'Name',
        reason: 'Correction',
        ownerUserId: '00000000-0000-4000-8000-000000000001',
      }).success,
    ).toBe(false);
    expect(
      AdminUserDetailSchema.safeParse({ password: 'secret' }).success,
    ).toBe(false);
  });
});
