import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  teamsMigrationName,
  assertReviewedTeamsMigration,
  teamReferenceUsageName,
  assertReviewedTeamReferenceUsage,
} from '../testing/reviewed-teams-migration.js';
import { assertAdditiveMigration } from '../testing/migration-safety.js';
it('permits only reviewed P3-01 expansion bytes without weakening generic migration rejection', () => {
  for (const [name, review] of [
    [teamsMigrationName, assertReviewedTeamsMigration],
    [teamReferenceUsageName, assertReviewedTeamReferenceUsage],
  ] as const) {
    const sql = fs.readFileSync(
      'prisma/migrations/' + name + '/migration.sql',
      'utf8',
    );
    expect(() => review(name, sql)).not.toThrow();
    expect(() => review('renamed', sql)).toThrow();
    expect(() => review(name, sql + '\n')).toThrow();
    expect(() => assertAdditiveMigration(sql)).toThrow();
  }
});
