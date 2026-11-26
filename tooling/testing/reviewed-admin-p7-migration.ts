import { createHash } from 'node:crypto';
export const adminP7MigrationName = '202611260124_platform_admin_p7';
export const adminP7MigrationSha256 =
  '06a540c5f6498f45045553dcf503740120f042e89ca45f69a087aebe070bb6f1';
export function assertReviewedAdminP7Migration(sql: string) {
  if (createHash('sha256').update(sql).digest('hex') !== adminP7MigrationSha256)
    throw new Error('Unreviewed P7 migration');
}

export const adminP7OrderMigrationName =
  '202611260125_p7_privacy_refresh_order';
export const adminP7OrderMigrationSha256 =
  '54d8f55387567f6aa5dfff7c298fa0aaeaeee040ae5da88c628d0640076a7dfd';
export function assertReviewedAdminP7OrderMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    adminP7OrderMigrationSha256
  )
    throw new Error('Unreviewed P7 privacy order migration');
}

export const adminP7FenceMigrationName = '202611260126_p7_erasure_fence';
export const adminP7FenceMigrationSha256 =
  '97205a686aa97e3fdf05020533e4028f171498a5f779c21285bf4216a1866bf1';
export function assertReviewedAdminP7FenceMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    adminP7FenceMigrationSha256
  )
    throw new Error('Unreviewed P7 erasure fence migration');
}

export const adminP7ContextMigrationName =
  '202611260127_p7_existing_context_activity';
export const adminP7ContextMigrationSha256 =
  '07c1131a19db5397010130513c629f07e3bf8642173f57478b732f6c45234bb5';
export function assertReviewedAdminP7ContextMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    adminP7ContextMigrationSha256
  )
    throw new Error('Unreviewed P7 existing-context migration');
}

export const adminP7FinancialMigrationName =
  '202611260128_p7_financial_reports';
export const adminP7FinancialMigrationSha256 =
  '856495ddfe0b071004ef9e1c85edaacef34db272c478dc376f7924e9e6e88652';
export function assertReviewedAdminP7FinancialMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    adminP7FinancialMigrationSha256
  )
    throw new Error('Unreviewed P7 financial reporting migration');
}
