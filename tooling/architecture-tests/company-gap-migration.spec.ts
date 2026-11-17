import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  companyGapMigrationHashes,
  assertReviewedCompanyGapMigration,
} from '../testing/reviewed-company-gap-migration.js';
it('pins the two additive Company migrations and their custody, history and policy guards', () => {
  for (const name of Object.keys(companyGapMigrationHashes)) {
    const sql = fs.readFileSync(
      'prisma/migrations/' + name + '/migration.sql',
      'utf8',
    );
    expect(() => assertReviewedCompanyGapMigration(name, sql)).not.toThrow();
    expect(() => assertReviewedCompanyGapMigration(name, sql + ' ')).toThrow();
    expect(sql).not.toMatch(
      /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE "User"|ALTER TABLE "Task"|ALTER TABLE "Goal"/,
    );
  }
  const sql = fs.readFileSync(
    'prisma/migrations/202611160073_company_gap_closure/migration.sql',
    'utf8',
  );
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(19);
  expect(sql).toContain('CompanyAssetCustody_active');
  expect(sql).toContain('CompanyFinancialApproval_budget_change');
  expect(sql).toContain('company_budget_controlled_guard');
  expect(sql).toContain('company_gap_history_guard');
});
