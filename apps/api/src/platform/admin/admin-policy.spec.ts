import { describe, expect, it } from 'vitest';
import { permits } from './admin-policy.js';
import { adminAuthRoutes } from '@mehran/api-contracts';
describe('admin permission and input boundaries', () => {
  it('denies unknown roles and unknown permissions including for super admins', () => {
    expect(permits('OWNER', 'admin.session.read')).toBe(false);
    expect(permits('SUPER_ADMIN', 'journal.read')).toBe(false);
    expect(permits('SUPPORT', 'admin.super')).toBe(false);
    expect(permits('SUPER_ADMIN', 'admin.super')).toBe(true);
  });
  it('has no registration, MFA disable, device trust, or role update surface', () => {
    expect(adminAuthRoutes['POST /sign-up/email']).toBeUndefined();
    expect(adminAuthRoutes['POST /two-factor/disable']).toBeUndefined();
    expect(adminAuthRoutes['POST /update-user']).toBeUndefined();
    expect(
      adminAuthRoutes['POST /two-factor/verify-totp']!.safeParse({
        code: '123456',
        trustDevice: true,
      }).success,
    ).toBe(false);
    expect(
      adminAuthRoutes['POST /sign-in/email']!.safeParse({
        email: 'x@example.test',
        password: 'password',
        role: 'SUPER_ADMIN',
      }).success,
    ).toBe(false);
  });
});
