import { it, expect } from 'vitest';
import {
  ConfigurationPayloadSchema,
  MaintenanceValueSchema,
  ConfigurationTargetSchema,
  adminConfigurationRoutes,
  ordinaryConfigurationRoutes,
} from './admin-configuration.js';
import { randomUUID } from 'node:crypto';
it('rejects unknown config fields, invalid target types, out-of-range rollout and invalid maintenance messages', () => {
  expect(
    ConfigurationPayloadSchema.safeParse({ value: true, secret: 'disallowed' })
      .success,
  ).toBe(false);
  expect(
    ConfigurationTargetSchema.safeParse({
      kind: 'WORKSPACE',
      workspaceId: randomUUID(),
      userId: randomUUID(),
    }).success,
  ).toBe(false);
  expect(
    ConfigurationPayloadSchema.safeParse({
      value: true,
      rules: [{ target: { kind: 'GLOBAL' }, value: false, basisPoints: 10001 }],
    }).success,
  ).toBe(false);
  expect(
    MaintenanceValueSchema.safeParse({
      mode: 'READ_ONLY',
      bindings: [],
      messages: { fa: 'در حال تعمیر' },
      defaultLocale: 'en',
      estimatedEndAt: null,
      progress: 101,
      status: 'Working',
    }).success,
  ).toBe(false);
  expect(
    ordinaryConfigurationRoutes['GET platform/configuration'].schema.safeParse({
      clientVersion: 2,
    }).success,
  ).toBe(false);
});
it('provides strict typed inputs and strong response schemas for every configuration route', () => {
  expect(Object.keys(adminConfigurationRoutes)).toHaveLength(17);
  for (const [route, spec] of Object.entries(adminConfigurationRoutes)) {
    expect(spec.permission).toMatch(/^admin\.(configuration|maintenance)\./);
    expect(
      spec.response.safeParse({ arbitrary: 'result' }).success,
      route,
    ).toBe(false);
  }
});
