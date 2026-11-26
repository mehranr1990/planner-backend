import { createHash } from 'node:crypto';
export const adminP5MigrationName = '202611260119_platform_admin_p5';
export function assertReviewedAdminP5Migration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    'caa347e41636eba0d822030d58b822f48952619d6ab7387799be9a6fe44f6373'
  )
    throw new Error('Unreviewed Platform Admin P5 migration');
}

export const adminP5ClockMigrationName = '202611260120_p5_term_clock_history';
export function assertReviewedAdminP5ClockMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    '399e1a52801417457a7b58f0a52d1b9db6ac5a4a37ee7cef96572aa22725ae64'
  )
    throw new Error('Unreviewed P5 term clock migration');
}

export const adminP5ClosureMigrationName = '202611260121_p5_term_closure';
export function assertReviewedAdminP5ClosureMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    '83f64b566a541b40e48aadcfd2026f8e3546f2f43bbb73e8804e3cca3895921b'
  )
    throw new Error('Unreviewed P5 term closure migration');
}
