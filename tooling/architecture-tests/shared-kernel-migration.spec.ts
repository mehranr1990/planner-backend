import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  assertReviewedSharedKernel,
  sharedKernelMigrations,
} from '../testing/reviewed-shared-kernel.js';
import { assertAdditiveMigration } from '../testing/migration-safety.js';
describe('P2 exact migration review', () => {
  it.each(Object.keys(sharedKernelMigrations))(
    'pins %s without weakening generic rejection',
    (name) => {
      const sql = fs.readFileSync(
        `prisma/migrations/${name}/migration.sql`,
        'utf8',
      );
      expect(() => assertReviewedSharedKernel(name, sql)).not.toThrow();
      expect(() => assertReviewedSharedKernel(name, sql + '\n')).toThrow();
      expect(() => assertReviewedSharedKernel('renamed', sql)).toThrow();
      expect(() => assertAdditiveMigration(sql)).toThrow();
    },
  );
  it('pins every trigger function search path at migration time and isolates shared events', () => {
    const sql = fs.readFileSync(
      'prisma/migrations/202611040002_shared_space_kernel/migration.sql',
      'utf8',
    );
    expect((sql.match(/CREATE FUNCTION/g) ?? []).length).toBe(
      (sql.match(/SET search_path FROM CURRENT/g) ?? []).length,
    );
    expect(sql).toContain('Outbox_personal_until_extension');
    expect(sql).toContain('ResourceGrant_target_required');
  });
});
