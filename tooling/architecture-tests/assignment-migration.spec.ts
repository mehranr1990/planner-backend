import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  assignmentMigrationName,
  assertReviewedAssignmentMigration,
} from '../testing/reviewed-assignment-migration.js';
import { assertAdditiveMigration } from '../testing/migration-safety.js';
it('requires exact M06 bytes without weakening generic SQL review', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + assignmentMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedAssignmentMigration(assignmentMigrationName, sql),
  ).not.toThrow();
  expect(() =>
    assertReviewedAssignmentMigration(assignmentMigrationName, sql + '\n'),
  ).toThrow();
  expect(() => assertReviewedAssignmentMigration('renamed', sql)).toThrow();
  expect(() => assertAdditiveMigration(sql)).toThrow();
});
