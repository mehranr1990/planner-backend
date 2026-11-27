import {
  emailSubjectMigrationName,
  assertReviewedEmailSubjectMigration,
} from '../testing/reviewed-registration-email-migration.js';
import fs from 'node:fs';
import { expect, it } from 'vitest';
import {
  assertReviewedRegistrationEmailMigration,
  registrationEmailMigrationName,
} from '../testing/reviewed-registration-email-migration.js';
it('freezes the additive diagnostics migration without fabricating historical evidence', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + registrationEmailMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() => assertReviewedRegistrationEmailMigration(sql)).not.toThrow();
  expect(() => assertReviewedRegistrationEmailMigration(sql + '\n')).toThrow();
  expect(sql).toContain('RETAINED_AUDIT');
  expect(sql).toContain('diagnostics_email_source_deleted');
  expect(sql).not.toMatch(/DROP TABLE|DELETE FROM "User"|ALTER TABLE "Auth/);
});

it('freezes pre-commit mail subject erasure without rewriting M129', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + emailSubjectMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() => assertReviewedEmailSubjectMigration(sql)).not.toThrow();
  expect(() => assertReviewedEmailSubjectMigration(sql + '\n')).toThrow();
  expect(sql).toContain('"subjectUserId"=OLD.id');
});
