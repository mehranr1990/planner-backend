import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  projectExecutionMigrationHashes,
  assertReviewedProjectExecutionMigration,
} from '../testing/reviewed-project-execution-migrations.js';
it('pins exact additive P2-06 SQL without weakening historical migration review', () => {
  for (const name of Object.keys(projectExecutionMigrationHashes)) {
    const sql = fs.readFileSync(
      'prisma/migrations/' + name + '/migration.sql',
      'utf8',
    );
    expect(() =>
      assertReviewedProjectExecutionMigration(name, sql),
    ).not.toThrow();
    expect(() =>
      assertReviewedProjectExecutionMigration(name, sql + ' '),
    ).toThrow();
    expect(sql).toMatch(/^BEGIN;/);
    expect(sql).toMatch(/COMMIT;\s*$/);
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  }
});
