import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  projectCollaborationMigrationHashes,
  assertReviewedProjectCollaborationMigration,
} from '../testing/reviewed-project-collaboration-migrations.js';
import { assertAdditiveMigration } from '../testing/migration-safety.js';
it('admits only the individually reviewed P2-07 artifact bytes and retains generic SQL rejection', () => {
  for (const name of Object.keys(projectCollaborationMigrationHashes)) {
    const sql = fs.readFileSync(
      'prisma/migrations/' + name + '/migration.sql',
      'utf8',
    );
    expect(() =>
      assertReviewedProjectCollaborationMigration(name, sql),
    ).not.toThrow();
    expect(() =>
      assertReviewedProjectCollaborationMigration(name, sql + ' '),
    ).toThrow();
    expect(() =>
      assertReviewedProjectCollaborationMigration('other', sql),
    ).toThrow();
    expect(() => assertAdditiveMigration(sql)).toThrow();
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  }
});
