import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  messagesMeetingsGapMigrationName,
  assertReviewedMessagesMeetingsGapMigration,
} from '../testing/reviewed-messages-meetings-gap-migration.js';
it('pins additive agenda/scheduling SQL, typed admissions, indexes and immutable history', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + messagesMeetingsGapMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() => assertReviewedMessagesMeetingsGapMigration(sql)).not.toThrow();
  expect(() => assertReviewedMessagesMeetingsGapMigration(sql + ' ')).toThrow();
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(2);
  expect(sql).toContain('MeetingAgendaRevision_actor_fk');
  expect(sql).toContain('AnnouncementSchedule_issuer_fk');
  expect(sql).toContain('shared_domain_purge_allowed');
  expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM|UPDATE "User"/);
});
