import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  companyFoundationMigrationName,
  assertReviewedCompanyFoundationMigration,
} from '../testing/reviewed-company-foundation-migration.js';
it('pins the Company-only context expansion and preserves independent source and purge boundaries', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + companyFoundationMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedCompanyFoundationMigration(
      companyFoundationMigrationName,
      sql,
    ),
  ).not.toThrow();
  expect(() =>
    assertReviewedCompanyFoundationMigration(
      companyFoundationMigrationName,
      sql + ' ',
    ),
  ).toThrow();
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(5);
  expect(sql).toContain('"ContextAccess_company_binding"');
  expect(sql).toContain('"CompanyContextAdmission_immutable"');
  expect(sql).toContain('"ContextInvitation_company"');
  expect(sql).toContain('cardinality(catalog)');
  expect(sql).not.toMatch(
    /ON DELETE CASCADE|ALTER TABLE "Task"|ALTER TABLE "Goal"|CREATE OR REPLACE FUNCTION shared_purge_allowed/,
  );
  for (const prior of ['PROJECT', 'TEAM', 'ADMIN', 'MANAGER', 'LEAD'])
    expect(sql).toContain("'" + prior + "'");
});
