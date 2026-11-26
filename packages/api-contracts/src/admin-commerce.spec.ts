import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  adminCommerceRoutes,
  ordinaryCommerceRoutes,
} from './admin-commerce.js';
it('rejects floating monetary inputs, privilege injection and implicit charging or transfer', () => {
  const p = {
    reason: 'Reviewed external purchase',
    versionId: randomUUID(),
    currency: 'USD',
    amount: '100',
    termDays: 30,
    recurring: true,
    complimentary: false,
  };
  const schema = adminCommerceRoutes['POST commerce/prices'].schema;
  expect(schema.safeParse(p).success).toBe(true);
  for (const amount of [100, '1.01', '1e3', '-1', '01'])
    expect(schema.safeParse({ ...p, amount }).success).toBe(false);
  expect(schema.safeParse({ ...p, providerSecret: 'forbidden' }).success).toBe(
    false,
  );
  expect(
    'POST commerce/subscriptions/:id/pause' in ordinaryCommerceRoutes,
  ).toBe(false);
  expect('POST commerce/charge' in adminCommerceRoutes).toBe(false);
  expect(
    'POST commerce/subscriptions/:id/transfer' in adminCommerceRoutes,
  ).toBe(false);
});
it('requires a reason and revision for high-risk mutations and gives every route a response schema', () => {
  expect(
    adminCommerceRoutes['POST commerce/invoices/:id/correct'].schema.safeParse({
      revision: 1,
      subtotal: '1',
      description: 'Correction',
    }).success,
  ).toBe(false);
  for (const r of Object.values(adminCommerceRoutes)) {
    expect(r.permission).toMatch(/^admin\./);
    expect(r.response).toBeDefined();
  }
  for (const r of Object.values(ordinaryCommerceRoutes))
    expect(r.response).toBeDefined();
});
