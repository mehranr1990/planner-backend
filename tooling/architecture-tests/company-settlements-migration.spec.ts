import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  companySettlementsMigrationName,
  assertReviewedCompanySettlementsMigration,
} from '../testing/reviewed-company-settlements-migration.js';
it('pins additive controlled approvals and separate reimbursement evidence without source custody changes', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + companySettlementsMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedCompanySettlementsMigration(
      companySettlementsMigrationName,
      sql,
    ),
  ).not.toThrow();
  expect(() =>
    assertReviewedCompanySettlementsMigration(
      companySettlementsMigrationName,
      sql + ' ',
    ),
  ).toThrow();
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(10);
  for (const guard of [
    'company_financial_source_decision_guard',
    'company_reimbursement_balance_guard',
    'company_financial_event_guard',
    'company_financial_version_guard',
  ])
    expect(sql).toContain(guard);
  expect(sql).toContain('FOR UPDATE');
  expect(sql).toContain('"CompanyFinancialApproval_expense_active"');
  expect(sql).not.toMatch(
    /ON DELETE CASCADE|ALTER TABLE "User"|ALTER TABLE "Task"|ALTER TABLE "Goal"|DROP TABLE|DELETE FROM|CREATE EXTENSION/,
  );
});
