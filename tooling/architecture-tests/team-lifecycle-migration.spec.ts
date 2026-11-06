import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  teamLifecycleMigrationName,
  assertReviewedTeamLifecycleMigration,
} from '../testing/reviewed-team-lifecycle-migration.js';
it('pins the Team purge admission extension while preserving every existing purge safeguard', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + teamLifecycleMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedTeamLifecycleMigration(teamLifecycleMigrationName, sql),
  ).not.toThrow();
  expect(() =>
    assertReviewedTeamLifecycleMigration(teamLifecycleMigrationName, sql + ' '),
  ).toThrow();
  const prior = fs.readFileSync(
    'prisma/migrations/202611050019_shared_lifecycle_effects/migration.sql',
    'utf8',
  );
  const body = (s: string) =>
    s.slice(
      s.indexOf(' SELECT EXISTS'),
      s.indexOf('$$;', s.indexOf(' SELECT EXISTS')),
    );
  expect(body(sql)).toBe(
    body(prior).replace("c.kind='PROJECT'", "c.kind IN ('PROJECT','TEAM')"),
  );
  expect(sql).not.toMatch(/CREATE TABLE|DROP|ALTER TABLE/);
});
