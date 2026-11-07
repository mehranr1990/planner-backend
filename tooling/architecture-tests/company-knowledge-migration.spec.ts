import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  companyKnowledgeMigrationName,
  assertReviewedCompanyKnowledgeMigration,
} from '../testing/reviewed-company-knowledge-migration.js';
it('pins additive Company knowledge ownership and immutable publication without custody activation', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + companyKnowledgeMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedCompanyKnowledgeMigration(companyKnowledgeMigrationName, sql),
  ).not.toThrow();
  expect(() =>
    assertReviewedCompanyKnowledgeMigration(
      companyKnowledgeMigrationName,
      sql + ' ',
    ),
  ).toThrow();
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(3);
  for (const invariant of [
    'company_knowledge_guard',
    'company_knowledge_file_guard',
    'FOR UPDATE',
    'CompanyKnowledgeDocument_published',
  ])
    expect(sql).toContain(invariant);
  expect(sql).not.toMatch(
    /ON DELETE CASCADE|ALTER TABLE "User"|ALTER TABLE "Task"|DROP TABLE|DELETE FROM|CREATE EXTENSION/,
  );
});
