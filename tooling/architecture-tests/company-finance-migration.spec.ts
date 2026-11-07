import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  companyFinanceMigrationName,
  assertReviewedCompanyFinanceMigration,
} from '../testing/reviewed-company-finance-migration.js';
it('pins the additive finance migration, precision, typed sources and immutable history', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + companyFinanceMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedCompanyFinanceMigration(companyFinanceMigrationName, sql),
  ).not.toThrow();
  expect(() =>
    assertReviewedCompanyFinanceMigration(
      companyFinanceMigrationName,
      sql + ' ',
    ),
  ).toThrow();
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(12);
  expect(sql).toContain('FOR UPDATE');
  expect(sql).toContain('CompanyExpenseVersion_currency_scale');
  expect(sql).toContain('CompanyExpenseReceipt_file');
  expect(sql).toContain('CompanyProjectFinanceLink_source');
  expect(sql).toContain('CompanyProjectFinanceLink_anchor');
  expect(sql).not.toMatch(
    /ON DELETE CASCADE|UPDATE "User"|DELETE FROM|TRUNCATE|DROP TABLE|ALTER TABLE "Task"|ALTER TABLE "Goal"|CREATE EXTENSION/,
  );
});
