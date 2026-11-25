import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertReviewedAdminP2Migration } from '../testing/reviewed-admin-p2-migration.js';
import { assertAdditiveMigration } from '../testing/migration-safety.js';
it('preserves exact P2 policy/approval and evidence SQL without relaxing generic migration checks', () => {
  for (const name of [
    '202611240111_admin_audit_expiry_bounds',
    '202611240110_admin_audit_change_summary',
    '202611240109_admin_backup_retention',
    '202611240108_admin_audit_backfill',
    '202611240107_admin_privacy_review_fencing',
    '202611240105_admin_audit_retention',
    '202611240104_admin_approval_fencing',
    '202611240101_platform_admin_p2_security',
    '202611240102_platform_admin_p2_audit',
  ]) {
    const sql = readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8');
    expect(() => assertReviewedAdminP2Migration(name, sql)).not.toThrow();
    expect(() => assertReviewedAdminP2Migration(name, sql + '\n')).toThrow();
    expect(() => assertAdditiveMigration(sql)).toThrow();
  }
});
