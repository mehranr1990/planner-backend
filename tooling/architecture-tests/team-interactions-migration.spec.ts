import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  teamInteractionsMigrationName,
  assertReviewedTeamInteractionsMigration,
} from '../testing/reviewed-team-interactions-migration.js';
it('pins the approved confidentiality/meeting expansion, typed boundaries, immutable history and prior feature keys', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + teamInteractionsMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedTeamInteractionsMigration(teamInteractionsMigrationName, sql),
  ).not.toThrow();
  expect(() =>
    assertReviewedTeamInteractionsMigration(
      teamInteractionsMigrationName,
      sql + ' ',
    ),
  ).toThrow();
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(6);
  expect(sql).toContain('"TeamCase_reviewerInterval"');
  expect(sql).toContain('"TeamMeeting_Event"');
  expect(sql).not.toMatch(
    /ON DELETE CASCADE|ALTER TABLE "Task"|ALTER TABLE "Goal"/,
  );
  const prior = fs.readFileSync(
    'prisma/migrations/202611060025_team_capacity/migration.sql',
    'utf8',
  );
  for (const literal of prior
    .slice(prior.indexOf('CHECK(feature IN'))
    .match(/'[^']+'/g) ?? [])
    expect(sql).toContain(literal);
});
