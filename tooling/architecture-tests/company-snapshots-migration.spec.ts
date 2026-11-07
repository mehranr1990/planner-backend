import fs from 'node:fs';
import { it, expect } from 'vitest';
import {
  companySnapshotsName,
  assertReviewedCompanySnapshots,
} from '../testing/reviewed-company-invitation-snapshots.js';
it('pins recipient generation/revision snapshots without mutating legacy invitation state, recipient or proof data', () => {
  const sql = fs.readFileSync(
    'prisma/migrations/' + companySnapshotsName + '/migration.sql',
    'utf8',
  );
  expect(() =>
    assertReviewedCompanySnapshots(companySnapshotsName, sql),
  ).not.toThrow();
  expect(() =>
    assertReviewedCompanySnapshots(companySnapshotsName, sql + ' '),
  ).toThrow();
  expect(sql).toContain('"ContextInvitation_company_snapshot"');
  expect(sql).toContain('"companyTargetRevision"');
  expect(sql).not.toMatch(
    /(?:UPDATE|DELETE FROM|TRUNCATE)\s+"|DROP TABLE|DROP COLUMN/,
  );
});
