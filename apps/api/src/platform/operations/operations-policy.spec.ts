import { describe, it, expect, vi } from 'vitest';
import {
  adminOperationsRoutes,
  JobPolicySchema,
  OperationsPolicyInputSchema,
  StoragePolicySchema,
} from '@mehran/api-contracts';
import { permits } from '../admin/admin-policy.js';
import { ApiMetrics } from './api-metrics.js';
describe('P3 policy and privilege safety', () => {
  it('grants private-file access only through the explicit Super Admin catalog', () => {
    for (const role of [
      'SUPPORT',
      'SECURITY_REVIEWER',
      'BILLING_MANAGER',
      'unknown',
    ]) {
      expect(permits(role, 'admin.storage.private_files.read')).toBe(false);
      expect(permits(role, 'admin.restores.approve')).toBe(false);
    }
    expect(permits('SUPER_ADMIN', 'admin.storage.private_files.read')).toBe(
      true,
    );
    expect(permits('SUPER_ADMIN', 'admin.storage.arbitrary_content')).toBe(
      false,
    );
  });
  it('rejects dangerous job kinds, shell input, unbounded policies and secret overposting', () => {
    const run = adminOperationsRoutes['POST operations/jobs/run'].schema;
    for (const queue of [
      'planner.delivery',
      'planner.dead',
      'payment',
      'deletion',
      'restore',
      'x; DROP TABLE',
    ])
      expect(run.safeParse({ queue, reason: 'review' }).success).toBe(false);
    expect(
      run.safeParse({
        queue: 'planner.sweep',
        reason: 'review',
        sql: 'SELECT 1',
      }).success,
    ).toBe(false);
    expect(
      StoragePolicySchema.safeParse({
        mode: 'BLOCK',
        minimumFreeBytes: 1,
        graceMinutes: 0,
        cleanupAgeHours: 0,
      }).success,
    ).toBe(false);
    expect(JobPolicySchema.safeParse({ sweepMinutes: 0 }).success).toBe(false);
    expect(
      OperationsPolicyInputSchema.safeParse({
        section: 'BACKUP',
        revision: 1,
        value: {
          enabled: true,
          intervalHours: 24,
          drillIntervalDays: 30,
          key: 'secret',
        },
        reason: 'review',
      }).success,
    ).toBe(false);
    expect(
      adminOperationsRoutes['POST operations/restores'].schema.safeParse({
        backupId: crypto.randomUUID(),
        mode: 'RESTORE',
        targetReference: '../../live',
        reason: 'review',
      }).success,
    ).toBe(false);
  });
  it('records each finished/aborted request once and derives real bounded metrics', () => {
    const metrics = new ApiMetrics(),
      a = metrics.begin(),
      b = metrics.begin();
    expect(metrics.snapshot().inFlight).toBe(2);
    a(503);
    a(200);
    b(200);
    expect(metrics.snapshot()).toMatchObject({
      requests: 2,
      errors: 1,
      inFlight: 0,
    });
  });
  it('lets error alerts recover when their five-minute measurement window expires', () => {
    vi.useFakeTimers();
    try {
      const metrics = new ApiMetrics();
      metrics.begin()(503);
      expect(metrics.recentErrors()).toBe(1);
      vi.advanceTimersByTime(301000);
      expect(metrics.recentErrors()).toBe(0);
      expect(metrics.snapshot().errors).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
