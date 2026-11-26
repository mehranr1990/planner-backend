import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import {
  adminP4MigrationName,
  assertReviewedAdminP4Migration,
} from '../testing/reviewed-admin-p4-migration.js';
it('freezes additive P4 migration bytes and rejects historical rewrites', () => {
  const sql = readFileSync(
    `prisma/migrations/${adminP4MigrationName}/migration.sql`,
    'utf8',
  );
  expect(() => assertReviewedAdminP4Migration(sql)).not.toThrow();
  expect(() => assertReviewedAdminP4Migration(sql + '\n')).toThrow();
  expect(sql).not.toMatch(
    /DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE "User"/i,
  );
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(14);
});
