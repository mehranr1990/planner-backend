import { createHash } from 'node:crypto';
// New local-only P2 schema: bounded policy/approval state and detached immutable
// audit evidence. Existing rows, authentication credentials and SQL are preserved.
const reviewed: Record<string, string> = {
  '202611240111_admin_audit_expiry_bounds':
    '26fdd75f54479bb777f2184086d32a0f8ef748ba8485d54ac2abb91e50bc52dd',
  '202611240110_admin_audit_change_summary':
    'c365823dd4bc4d5d3b705c1d85a918f1e25c4a1bfb6aaafd76ea25c178bd48d9',
  '202611240109_admin_backup_retention':
    '3d952ea89016f5b45fe629a7b7e0f84eed16f89ee376967a4cca1f959fb5bd78',
  '202611240108_admin_audit_backfill':
    'd9d13bca7c1a67ff76237a679c15b46f61026f1b1c4cca8b689a251216edde9c',
  '202611240107_admin_privacy_review_fencing':
    'eba50c97eac645f849c751dd9150c03b3e32d3fe497615b45e91a771780a65bc',
  '202611240105_admin_audit_retention':
    '395a0ffc137db95246dc6d96fb57f89e999a67e496524c07a569288f74cc084d',
  '202611240104_admin_approval_fencing':
    'fc3fcf2518d85f133a39126f160fb6aa7fe03f254ea66fe76303964a1fee82ba',
  '202611240101_platform_admin_p2_security':
    '51bb94ce4061bf8db3e79d547c7601974d22983d46c4ad7a71989883db7854d0',
  '202611240102_platform_admin_p2_audit':
    'e66d8e7215ab0db568e380720b7130573986fd9c1b6911cc33bfdd53faa2b80f',
};
export function isAdminP2Migration(name: string) {
  return Object.hasOwn(reviewed, name);
}
export function assertReviewedAdminP2Migration(name: string, sql: string) {
  if (
    !isAdminP2Migration(name) ||
    createHash('sha256').update(sql).digest('hex') !== reviewed[name]
  )
    throw new Error('Unreviewed Platform Admin P2 migration');
}
