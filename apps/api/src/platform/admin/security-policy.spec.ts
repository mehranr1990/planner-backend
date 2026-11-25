import { describe, it, expect } from 'vitest';
import {
  AdminSecurityPolicySchema,
  AdminCriticalRequestSchema,
  adminSecurityRoutes,
} from '@mehran/api-contracts';
import {
  approvalState,
  defaultAdminSecurityPolicy,
} from './security-policy.js';
import { permits } from './admin-policy.js';
describe('P2 security and audit contract boundaries', () => {
  it('preserves provider security floors and rejects secret/config overposting', () => {
    expect(
      AdminSecurityPolicySchema.safeParse(defaultAdminSecurityPolicy).success,
    ).toBe(true);
    for (const patch of [
      { adminLoginMax: 6 },
      { userLoginMax: 4 },
      { adminLoginMax: 0 },
      { alertChannels: ['SMS'] },
      { adminIpAllowlist: ['127.0.0.1'] },
      { secret: 'value' },
    ])
      expect(
        AdminSecurityPolicySchema.safeParse({
          ...defaultAdminSecurityPolicy,
          ...patch,
        }).success,
      ).toBe(false);
  });
  it('requires an explicit identity-review record without exposing a secret-bearing recovery input', () => {
    const value = {
      action: 'MFA_RECOVERY',
      targetAdminId: '00000000-0000-4000-8000-000000000001',
      identityReviewReference: 'review/12345',
      identityVerified: true,
      reason: 'Verified through independent identity review',
    };
    expect(AdminCriticalRequestSchema.safeParse(value).success).toBe(true);
    expect(
      AdminCriticalRequestSchema.safeParse({
        ...value,
        identityVerified: false,
      }).success,
    ).toBe(false);
    expect(
      AdminCriticalRequestSchema.safeParse({ ...value, password: 'injected' })
        .success,
    ).toBe(false);
  });
  it('expires pending and approved authority at the exact deadline without changing terminal history', () => {
    const now = new Date('2026-11-24T12:00:00Z');
    for (const state of ['PENDING', 'APPROVED'])
      expect(approvalState({ state, expiresAt: now }, now)).toBe('EXPIRED');
    for (const state of ['EXECUTED', 'REJECTED'])
      expect(approvalState({ state, expiresAt: now }, now)).toBe(state);
  });
  it('denies inherited and unknown roles and separates audit categories from critical approval', () => {
    for (const role of ['__proto__', 'constructor', 'toString', 'OWNER'])
      expect(permits(role, 'admin.session.read')).toBe(false);
    expect(permits('SECURITY_REVIEWER', 'admin.audit.category.security')).toBe(
      true,
    );
    expect(permits('SECURITY_REVIEWER', 'admin.audit.category.privacy')).toBe(
      false,
    );
    expect(permits('SUPPORT', 'admin.audit.category.control')).toBe(true);
    expect(permits('SUPPORT', 'admin.audit.export')).toBe(false);
    expect(permits('SUPER_ADMIN', 'admin.audit.unknown')).toBe(false);
    expect(
      permits('SECURITY_REVIEWER', 'admin.security.critical.approve'),
    ).toBe(false);
    for (const route of Object.values(adminSecurityRoutes))
      expect(permits('SUPER_ADMIN', route.permission)).toBe(true);
  });
});
