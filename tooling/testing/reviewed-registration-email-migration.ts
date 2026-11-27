import { createHash } from 'node:crypto';
export const registrationEmailMigrationName =
  '202611270129_registration_email_diagnostics';
export const registrationEmailMigrationSha256 =
  '0ec432d1a0c38fdb5d71f997d5e30fb725943d3d5a235ef3db7972356cd9baa1';
export function assertReviewedRegistrationEmailMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    registrationEmailMigrationSha256
  )
    throw new Error('Unreviewed registration/email diagnostics migration');
}

export const emailSubjectMigrationName = '202611270130_email_subject_erasure';
export const emailSubjectMigrationSha256 =
  '7010c615c0f234a312fdbc21a8cc700cab4f22dfbe9c4b1341a9639775501944';
export function assertReviewedEmailSubjectMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    emailSubjectMigrationSha256
  )
    throw new Error('Unreviewed email subject erasure migration');
}
