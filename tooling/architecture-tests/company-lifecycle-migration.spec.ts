import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  companyLifecycleMigrationName,
  assertReviewedCompanyLifecycleMigration,
} from '../testing/reviewed-company-lifecycle-migration.js';
import {
  companyAssociationsMigrationName,
  assertReviewedCompanyAssociationsMigration,
} from '../testing/reviewed-company-associations-migration.js';
it('pins controlled Company lifecycle disposal and typed custody-preserving association migrations', () => {
  for (const [name, review] of [
    [companyLifecycleMigrationName, assertReviewedCompanyLifecycleMigration],
    [
      companyAssociationsMigrationName,
      assertReviewedCompanyAssociationsMigration,
    ],
  ] as const) {
    const sql = fs.readFileSync(
      'prisma/migrations/' + name + '/migration.sql',
      'utf8',
    );
    expect(() => review(name, sql)).not.toThrow();
    expect(() => review(name, sql + ' ')).toThrow();
    expect(sql).not.toMatch(
      /DROP TABLE|DELETE FROM|ON DELETE CASCADE|DISABLE TRIGGER|ALTER TABLE "User"/,
    );
  }
  const disposal = fs.readFileSync(
    'prisma/migrations/' + companyLifecycleMigrationName + '/migration.sql',
    'utf8',
  );
  expect(disposal).toContain("c.kind IN ('PROJECT','TEAM','COMPANY')");
  for (const guard of [
    'recoveryDeadline',
    'leaseUntil',
    'shared_purge_allowed',
  ])
    expect(disposal).toContain(guard);
  const sql = fs.readFileSync(
    'prisma/migrations/' + companyAssociationsMigrationName + '/migration.sql',
    'utf8',
  );
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(2);
  expect(sql.match(/FOREIGN KEY/g)).toHaveLength(24);
  expect(sql).toContain("WHERE state<>'REVOKED'");
  expect(sql).toContain('company_association_identity');
});
