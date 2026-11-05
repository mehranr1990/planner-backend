import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  localSecurityMigrationName,
  assertReviewedLocalSecurityMigration,
} from '../testing/reviewed-local-security-migration.js';
import { assertAdditiveMigration } from '../testing/migration-safety.js';
it('keeps the terminal-evidence exception exact and preserves generic procedural rejection', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + localSecurityMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedLocalSecurityMigration(localSecurityMigrationName, sql),
  ).not.toThrow();
  expect(() =>
    assertReviewedLocalSecurityMigration(localSecurityMigrationName, sql + ' '),
  ).toThrow();
  expect(() => assertReviewedLocalSecurityMigration('other', sql)).toThrow();
  expect(() => assertAdditiveMigration(sql)).toThrow();
  expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
});
