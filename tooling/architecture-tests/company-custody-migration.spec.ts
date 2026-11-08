import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  companyScopeCustodyMigrationName,
  assertReviewedCompanyScopeCustodyMigration,
} from '../testing/reviewed-company-scope-custody-migration.js';
import {
  domainScopeKeysMigrationName,
  assertReviewedDomainScopeKeysMigration,
} from '../testing/reviewed-domain-scope-keys-migration.js';
import {
  scopedLifecycleJobsMigrationName,
  assertReviewedScopedLifecycleJobsMigration,
} from '../testing/reviewed-scoped-lifecycle-jobs-migration.js';
import {
  companyDomainRepresentationMigrationName,
  assertReviewedCompanyDomainRepresentationMigration,
} from '../testing/reviewed-company-domain-representation-migration.js';

it('pins non-authorizing attribution, retained domain catalogs and guarded evidence disposal representation', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' +
      companyDomainRepresentationMigrationName +
      '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedCompanyDomainRepresentationMigration(
      companyDomainRepresentationMigrationName,
      sql,
    ),
  ).not.toThrow();
  expect(() =>
    assertReviewedCompanyDomainRepresentationMigration(
      companyDomainRepresentationMigrationName,
      sql + ' ',
    ),
  ).toThrow();
  expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|DISABLE TRIGGER|DROP INDEX/);
  expect(sql.match(/FOREIGN KEY/g)).toHaveLength(1);
  for (const guard of [
    'HISTORICAL',
    'originCustodyId',
    'Typed Company domain custody required',
    'Active domain custody requires scoped administration',
    'Historical attribution requires typed non-authorizing provenance',
    'Reviewed applied custody witness required',
    'Immutable custody disposal witness',
    'Company custody retention changed',
    'Immutable custody manifest',
    'Immutable custody consent identity',
  ])
    expect(sql).toContain(guard);
  const finalProtocol = sql.slice(
    sql.lastIndexOf(
      'CREATE OR REPLACE FUNCTION company_custody_protocol_guard()',
    ),
  );
  expect(finalProtocol).not.toContain(
    "(to_jsonb(OLD)->>'companyRetentionPolicyVersion') IS NULL",
  );
  expect(sql).toContain('DROP NOT NULL');
  expect(sql).toContain('company_domain_disposal_witness_valid');
});
it('pins typed domain lifecycle jobs and scope-specific immutable-history disposal', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + scopedLifecycleJobsMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedScopedLifecycleJobsMigration(
      scopedLifecycleJobsMigrationName,
      sql,
    ),
  ).not.toThrow();
  expect(() =>
    assertReviewedScopedLifecycleJobsMigration(
      scopedLifecycleJobsMigrationName,
      sql + ' ',
    ),
  ).toThrow();
  expect(sql.match(/DROP CONSTRAINT/g)).toHaveLength(2);
  expect(sql).not.toMatch(
    /DROP TABLE|DELETE FROM|DISABLE TRIGGER|ALTER.*FOREIGN KEY/,
  );
  for (const guard of [
    'Immutable lifecycle scope identity',
    'Live domain custody required',
    'Immutable domain lifecycle evidence',
    'Domain lifecycle requires its applied custody and captured policy',
    'j."scopeId" IS NULL',
    'shared_domain_purge_allowed(OLD."spaceId",OLD."scopeId")',
  ])
    expect(sql).toContain(guard);
  expect(
    sql.match(/shared_domain_purge_allowed\(OLD\."spaceId",OLD\."scopeId"\)/g),
  ).toHaveLength(3);
});
it('pins additive whole-root manifest, consent, scoped-custody and provenance expansion', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + companyScopeCustodyMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedCompanyScopeCustodyMigration(
      companyScopeCustodyMigrationName,
      sql,
    ),
  ).not.toThrow();
  expect(() =>
    assertReviewedCompanyScopeCustodyMigration(
      companyScopeCustodyMigrationName,
      sql + ' ',
    ),
  ).toThrow();
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(5);
  expect(sql.match(/FOREIGN KEY/g)).toHaveLength(28);
  expect(sql).not.toMatch(
    /DROP TABLE|DELETE FROM|DISABLE TRIGGER|ON DELETE CASCADE|ALTER TABLE/,
  );
  for (const invariant of [
    'Immutable custody manifest',
    'Immutable custody consent identity',
    'Immutable scoped custody identity',
    'Custody apply must complete atomically',
    'Applying custody manifest required',
  ])
    expect(sql).toContain(invariant);
});
it('pins stronger source-scope keys and removes temporary backfill allowances before commit', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + domainScopeKeysMigrationName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedDomainScopeKeysMigration(domainScopeKeysMigrationName, sql),
  ).not.toThrow();
  expect(() =>
    assertReviewedDomainScopeKeysMigration(
      domainScopeKeysMigrationName,
      sql + ' ',
    ),
  ).toThrow();
  expect(sql.match(/DROP CONSTRAINT/g)).toHaveLength(13);
  expect(sql.match(/FOREIGN KEY/g)).toHaveLength(13);
  expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|DISABLE TRIGGER/);
  for (const name of [
    'team_plan_shape',
    'team_item_shape',
    'team_interaction_guard',
  ]) {
    const start = sql.lastIndexOf('CREATE OR REPLACE FUNCTION ' + name + '()');
    expect(start).toBeGreaterThan(0);
    const end = sql.indexOf('$function$;', start);
    const final = sql.slice(start, end);
    expect(final).toContain('Immutable source scope identity');
    expect(final).not.toContain("(to_jsonb(OLD)->>'scopeId') IS NULL");
  }
  for (const rule of [
    'Both current owners must approve custody',
    'Every affected participant must consent to custody',
    'Explicit current destination admissions and role mappings required',
    'Custody receipt requires complete atomic graph migration',
  ])
    expect(sql).toContain(rule);
});
