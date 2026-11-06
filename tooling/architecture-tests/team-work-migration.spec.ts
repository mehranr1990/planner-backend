import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  teamWorkMigrationName,
  assertReviewedTeamWorkMigration,
  teamCalendarOrderName,
  assertReviewedTeamCalendarOrder,
} from '../testing/reviewed-team-work-migration.js';
import { assertAdditiveMigration } from '../testing/migration-safety.js';
it('restricts Team source/Calendar/planning expansion to exact reviewed bytes', () => {
  const orderSql = fs.readFileSync(
    'prisma/migrations/' + teamCalendarOrderName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedTeamCalendarOrder(teamCalendarOrderName, orderSql),
  ).not.toThrow();
  expect(() =>
    assertReviewedTeamCalendarOrder(teamCalendarOrderName, orderSql + ' '),
  ).toThrow();
  expect(() => assertReviewedTeamCalendarOrder('renamed', orderSql)).toThrow();
  expect(() => assertAdditiveMigration(orderSql)).toThrow();
  const sql = fs.readFileSync(
    'prisma/migrations/' + teamWorkMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedTeamWorkMigration(teamWorkMigrationName, sql),
  ).not.toThrow();
  expect(() => assertReviewedTeamWorkMigration('renamed', sql)).toThrow();
  expect(() =>
    assertReviewedTeamWorkMigration(teamWorkMigrationName, sql + ' '),
  ).toThrow();
  expect(() => assertAdditiveMigration(sql)).toThrow();
  expect(sql).toContain('project_transfer_permitted');
  expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|UPDATE "/);
});
