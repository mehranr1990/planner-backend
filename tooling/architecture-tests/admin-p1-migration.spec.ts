import { it, expect } from 'vitest';
import fs from 'node:fs';
import {
  adminP1MigrationName,
  teamScopedDisposalMigrationName,
  assertReviewedTeamScopedDisposalMigration,
  adminInvitationDeliveryMigrationName,
  assertReviewedAdminP1Migration,
  assertReviewedAdminInvitationDeliveryMigration,
  teamCompanyCustodyMigrationName,
  assertReviewedTeamCompanyCustodyMigration,
  teamCompanyCustodyProtocolMigrationName,
  assertReviewedTeamCompanyCustodyProtocolMigration,
} from '../testing/reviewed-admin-p1-migration.js';
import { assertAdditiveMigration } from '../testing/migration-safety.js';
it('freezes exact Admin attribution guards and delivery recipient changes without widening generic migration acceptance', () => {
  for (const [name, review] of [
    [
      teamScopedDisposalMigrationName,
      assertReviewedTeamScopedDisposalMigration,
    ],
    [adminP1MigrationName, assertReviewedAdminP1Migration],
    [
      teamCompanyCustodyMigrationName,
      assertReviewedTeamCompanyCustodyMigration,
    ],
    [
      teamCompanyCustodyProtocolMigrationName,
      assertReviewedTeamCompanyCustodyProtocolMigration,
    ],
    [
      adminInvitationDeliveryMigrationName,
      assertReviewedAdminInvitationDeliveryMigration,
    ],
  ] as const) {
    const sql = fs.readFileSync(
      `prisma/migrations/${name}/migration.sql`,
      'utf8',
    );
    expect(() => review(sql)).not.toThrow();
    expect(() => review(sql + '\n')).toThrow();
    expect(() => assertAdditiveMigration(sql)).toThrow();
  }
});
