import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertAdditiveMigration } from '../testing/migration-safety.js';
import {
  clientBackendMigrationName,
  assertReviewedClientBackendMigration,
} from '../testing/reviewed-client-backend-migration.js';
it('adds only reviewed Client fields, constraints and typed delivery references', () => {
  const sql = readFileSync(
    `prisma/migrations/${clientBackendMigrationName}/migration.sql`,
    'utf8',
  );
  expect(() => assertReviewedClientBackendMigration(sql)).not.toThrow();
  expect(() => assertReviewedClientBackendMigration(sql + '\n')).toThrow();
  expect(() => assertAdditiveMigration(sql)).not.toThrow();
  expect(sql).not.toMatch(/DELETE FROM|TRUNCATE|DROP TABLE/i);
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(1);
});
