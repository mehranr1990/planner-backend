import { createHash } from 'node:crypto';

/** Exact P2-01 artifacts, reviewed against the approved G0 candidates. */
export const sharedKernelMigrations: Record<string, string> = {
  '202611040001_shared_space_kind':
    '80c62729e0d5b534194bda06b415ce817e96a4341000cac729d740b8db68b56d',
  '202611040002_shared_space_kernel':
    '0901f65badfef176120ff6b6e10f859d24ebe9085e1518919bb1566ba25edfde',
};
export function assertReviewedSharedKernel(name: string, sql: string) {
  if (
    !sharedKernelMigrations[name] ||
    createHash('sha256').update(sql).digest('hex') !==
      sharedKernelMigrations[name]
  )
    throw new Error('Unreviewed shared kernel migration name or bytes');
}
