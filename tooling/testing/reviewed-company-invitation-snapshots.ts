import { createHash } from 'node:crypto';
export const companySnapshotsName = '202611060029_company_invitation_snapshots';
export const companySnapshotsHash =
  '4841b4a44f0e236f7d7bb418683dce433a85da460f739fe0af62eb5adaa6f2c7';
export function assertReviewedCompanySnapshots(name: string, sql: string) {
  if (
    name !== companySnapshotsName ||
    createHash('sha256').update(sql).digest('hex') !== companySnapshotsHash
  )
    throw new Error('Unreviewed Company invitation snapshot migration');
}
