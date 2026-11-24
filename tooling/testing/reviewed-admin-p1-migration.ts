import { createHash } from 'node:crypto';
export const teamScopedDisposalMigrationName =
  '202611240100_team_scoped_disposal';
export function assertReviewedTeamScopedDisposalMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    'ac18caf2da9691d6014bacce1d79d3b20ef46eab9f04b15fb1e8d2562ffc6fb3'
  )
    throw new Error('Unreviewed P1 scoped Team disposal migration');
}
export const teamCompanyCustodyMigrationName =
  '202611240098_independent_team_company_custody';
export function assertReviewedTeamCompanyCustodyMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    'cecd385df2a46b837b1cc50fe0afcf18fa83545436870c82889c5a17b345417f'
  )
    throw new Error('Unreviewed one-way Team custody migration');
}
export const teamCompanyCustodyProtocolMigrationName =
  '202611240099_team_company_custody_protocol';
export function assertReviewedTeamCompanyCustodyProtocolMigration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    '535889d5f333ac4cc5125046fea3d91f7d3304c72c1eb99831d8225a51a3d183'
  )
    throw new Error(
      'Unreviewed Team custody consent/replay protocol migration',
    );
}
// Owner-authorized P1 completion: additive columns/tables plus a stricter attribution guard.
// Replaces only SharedActor CHECKs to distinguish Admin attribution from Planner identity.
// No rows, tables, ordinary roles or existing memberships are removed or recreated.
export const adminP1MigrationName = '202611230096_platform_admin_p1_completion';
export const adminInvitationDeliveryMigrationName =
  '202611230097_admin_invitation_delivery';
export function assertReviewedAdminInvitationDeliveryMigration(sql: string) {
  // Only the new outbox recipient becomes nullable, with an at-least-one recipient CHECK.
  if (
    createHash('sha256').update(sql).digest('hex') !==
    '95c40d4e0cba1111cd7cb07dab69a482fb2136a50f440c436dbf2134841b85d3'
  )
    throw new Error('Unreviewed Admin invitation delivery migration');
}
export function assertReviewedAdminP1Migration(sql: string) {
  if (
    createHash('sha256').update(sql).digest('hex') !==
    '20e30ae2c5ed619ae4af45b9d0810b8b5bd11a43b93cf7892e63824049a32fe0'
  )
    throw new Error('Unreviewed Admin P1 completion migration');
}
