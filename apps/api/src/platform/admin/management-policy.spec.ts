import { describe, expect, it } from 'vitest';
import {
  csvCell,
  dashboardRange,
  effectiveSuspension,
} from './management-policy.js';
import { permits, adminRolePermissions } from './admin-policy.js';
import {
  AdminBulkPreviewSchema,
  AdminVerifyEmailSchema,
} from '@mehran/api-contracts';
describe('P1 administrative privacy and security policy', () => {
  it('expires suspension at the exact boundary without a worker', () => {
    const now = new Date('2026-11-23T00:00:00Z');
    expect(
      effectiveSuspension(
        { suspendedAt: new Date(0), suspensionExpiresAt: now },
        now,
      ),
    ).toBe(false);
    expect(
      effectiveSuspension(
        { suspendedAt: new Date(0), suspensionExpiresAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      effectiveSuspension(
        { suspendedAt: null, suspensionExpiresAt: null },
        now,
      ),
    ).toBe(false);
  });
  it('uses bounded UTC calendar days and rejects inverted/unbounded ranges', () => {
    const now = new Date('2026-11-23T09:00:00Z');
    expect(dashboardRange({ range: '7d' }, now)).toEqual({
      from: new Date('2026-11-17T00:00:00Z'),
      until: new Date('2026-11-24T00:00:00Z'),
    });
    expect(() =>
      dashboardRange(
        {
          range: 'custom',
          from: '2025-01-01T00:00:00Z',
          until: now.toISOString(),
        },
        now,
      ),
    ).toThrow();
    expect(() =>
      dashboardRange(
        { range: 'custom', from: now.toISOString(), until: now.toISOString() },
        now,
      ),
    ).toThrow();
  });
  it('escapes spreadsheet formulas, delimiters, quotes and leading control characters', () => {
    for (const cell of ['=1+1', '+cmd', '-2+3', '@SUM(1)', '  =1', '\t=1'])
      expect(csvCell(cell)).toMatch(/^"'/);
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
  it('makes each role grant explicit without a private-content or unknown permission bypass', () => {
    for (const [role, permissions] of Object.entries(adminRolePermissions)) {
      for (const permission of permissions)
        expect(permits(role, permission)).toBe(true);
      expect(permits(role, 'journal.read')).toBe(false);
      expect(permits(role, '*')).toBe(false);
    }
    expect(permits('BILLING_MANAGER', 'admin.users.read')).toBe(false);
    expect(permits('SUPPORT', 'admin.users.suspend')).toBe(false);
    expect(permits('SECURITY_REVIEWER', 'admin.users.verify_email')).toBe(
      false,
    );
    expect(permits('SUPER_ADMIN', 'admin.users.verify_email')).toBe(true);
    expect(permits('SUPER_ADMIN', 'admin.users.delete')).toBe(false);
  });
  it('rejects manual verification mass assignment and duplicate bulk targets', () => {
    expect(
      AdminVerifyEmailSchema.safeParse({
        reason: 'verified evidence',
        revision: 1,
        email: 'x@example.test',
        password: 'injected',
      }).success,
    ).toBe(false);
    const id = '00000000-0000-4000-8000-000000000001';
    expect(
      AdminBulkPreviewSchema.safeParse({
        operation: 'suspend',
        userIds: [id, id],
        reason: 'test',
      }).success,
    ).toBe(false);
  });
});
