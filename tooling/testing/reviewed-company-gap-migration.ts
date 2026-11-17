import { createHash } from 'node:crypto';
export const companyGapMigrationName = '202611160073_company_gap_closure';
export const companyGapMigrationHashes: Readonly<Record<string, string>> = {
  '202611160073_company_gap_closure':
    '4ecce13a8eb7e67c7580d398281b3d8f4b01281e26e80a8de7df5d4929d363b8',
  '202611170074_company_history_guards':
    '5ef52471b60b124c114884be3666dc340e6ad60a58164f400a68b2278a6690ca',
};
export function assertReviewedCompanyGapMigration(name: string, sql: string) {
  if (
    !companyGapMigrationHashes[name] ||
    createHash('sha256').update(sql).digest('hex') !==
      companyGapMigrationHashes[name]
  )
    throw new Error('Unreviewed Company gap migration');
}
