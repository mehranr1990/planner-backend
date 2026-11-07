import { createHash } from 'node:crypto';
export const companyKnowledgeMigrationName =
  '202611070033_company_knowledge_and_reports';
export const companyKnowledgeMigrationHash =
  'dd0578829944930aab32b124b40315c500b9ba5f05ba8e8130cb00fe486f627a';
export function assertReviewedCompanyKnowledgeMigration(
  name: string,
  sql: string,
) {
  if (
    name !== companyKnowledgeMigrationName ||
    createHash('sha256').update(sql).digest('hex') !==
      companyKnowledgeMigrationHash
  )
    throw new Error('Unreviewed Company knowledge migration');
}
