import { it, expect } from 'vitest';
import fs from 'node:fs';
import {
  assertReviewedCollaborationMigration,
  collaborationMigrationName,
} from '../testing/reviewed-collaboration-migration.js';
import { assertAdditiveMigration } from '../testing/migration-safety.js';
it('accepts only the reviewed P2-02 name/bytes and retains generic procedural/timeout rejection', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + collaborationMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedCollaborationMigration(collaborationMigrationName, sql),
  ).not.toThrow();
  expect(() =>
    assertReviewedCollaborationMigration(
      collaborationMigrationName,
      sql + '\n',
    ),
  ).toThrow();
  expect(() => assertReviewedCollaborationMigration('renamed', sql)).toThrow();
  expect(() => assertAdditiveMigration(sql)).toThrow();
});
