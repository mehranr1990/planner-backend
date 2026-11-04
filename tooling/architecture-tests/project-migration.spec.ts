import { it, expect } from 'vitest';
import fs from 'node:fs';
import {
  projectMigrationHashes,
  assertReviewedProjectMigration,
} from '../testing/reviewed-project-migration.js';
import { assertAdditiveMigration } from '../testing/migration-safety.js';
it('accepts only the exact reviewed M05 core and feature-register companion without weakening generic SQL review', () => {
  for (const name of Object.keys(projectMigrationHashes)) {
    const sql = fs.readFileSync(
      'prisma/migrations/' + name + '/migration.sql',
      'utf8',
    );
    expect(() => assertReviewedProjectMigration(name, sql)).not.toThrow();
    expect(() => assertReviewedProjectMigration(name, sql + '\n')).toThrow();
    expect(() => assertReviewedProjectMigration('renamed', sql)).toThrow();
    expect(() => assertAdditiveMigration(sql)).toThrow();
  }
});
