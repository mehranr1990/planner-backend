import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  assertReviewedVoiceMigration,
  reviewedVoiceMigrationName,
} from '../../../../../tooling/testing/reviewed-voice-migration.js';
import {
  assertAdditiveMigration,
  reviewMigrations,
} from '../../../../../tooling/testing/migration-safety.js';
describe('ADR 0015 exact migration exception', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + reviewedVoiceMigrationName + '/migration.sql',
    'utf8',
  );
  it('accepts only the exact approved atomic CHECK expansion', () => {
    expect(() =>
      assertReviewedVoiceMigration(reviewedVoiceMigrationName, sql),
    ).not.toThrow();
    expect(reviewMigrations()).toContain(reviewedVoiceMigrationName);
  });
  it('preserves generic rejection of constraint drops', () =>
    expect(() => assertAdditiveMigration(sql)).toThrow());
  it('rejects modified MIME sets, transaction removal, extra destructive SQL or renamed migration', () => {
    for (const changed of [
      sql.replace("'audio/wav'", "'application/javascript'"),
      sql.replace('BEGIN;', ''),
      sql + 'DROP TABLE "Task";',
      sql.replace("'image/png',", ''),
    ])
      expect(() =>
        assertReviewedVoiceMigration(reviewedVoiceMigrationName, changed),
      ).toThrow();
    expect(() => assertReviewedVoiceMigration('unapproved', sql)).toThrow();
  });
});
