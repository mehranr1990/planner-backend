import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  adminP3MigrationName,
  assertReviewedAdminP3Migration,
} from '../testing/reviewed-admin-p3-migration.js';
import { assertAdditiveMigration } from '../testing/migration-safety.js';
it('preserves reviewed operational evidence, approval and lifecycle SQL exactly', () => {
  const sql = readFileSync(
    `prisma/migrations/${adminP3MigrationName}/migration.sql`,
    'utf8',
  );
  expect(() => assertReviewedAdminP3Migration(sql)).not.toThrow();
  expect(() => assertReviewedAdminP3Migration(sql + '\n')).toThrow();
  expect(() => assertAdditiveMigration(sql)).toThrow();
  expect(sql).not.toMatch(/DELETE FROM|TRUNCATE|DROP TABLE/i);
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(11);
});
