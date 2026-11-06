import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  teamCapacityMigrationName,
  assertReviewedTeamCapacityMigration,
} from '../testing/reviewed-team-capacity-migration.js';
it('pins only the reviewed Team capacity expansion and retains the existing usage allowlist', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + teamCapacityMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedTeamCapacityMigration(teamCapacityMigrationName, sql),
  ).not.toThrow();
  expect(() =>
    assertReviewedTeamCapacityMigration(teamCapacityMigrationName, sql + ' '),
  ).toThrow();
  expect(sql).toContain('"TeamCapacityDay_generation"');
  expect(sql).not.toMatch(
    /ON DELETE CASCADE|ALTER TABLE "Task"|ALTER TABLE "Goal"/,
  );
  const prior = fs.readFileSync(
    'prisma/migrations/202611050023_team_work_planning/migration.sql',
    'utf8',
  );
  for (const literal of prior
    .slice(prior.indexOf('CHECK(feature IN'))
    .match(/'[^']+'/g) ?? [])
    expect(sql).toContain(literal);
});
