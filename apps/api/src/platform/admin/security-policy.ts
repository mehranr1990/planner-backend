import type { AdminSecurityPolicySchema } from '@mehran/api-contracts';
import type { z } from 'zod';
export const defaultAdminSecurityPolicy: z.infer<
  typeof AdminSecurityPolicySchema
> = {
  adminLoginMax: 5,
  userLoginMax: 3,
  alertThreshold: 5,
  alertWindowSeconds: 300,
  alertSeverity: 'WARNING',
  alertChannels: ['IN_APP'],
};
export const SECURITY_POLICY_ID = '00000000-0000-4000-8000-000000000101';
export function approvalState(
  row: { state: string; expiresAt: Date },
  now = new Date(),
) {
  return row.state === 'PENDING' || row.state === 'APPROVED'
    ? row.expiresAt <= now
      ? 'EXPIRED'
      : row.state
    : row.state;
}
