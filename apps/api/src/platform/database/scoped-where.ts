import type { AuthorizedSpace } from '../authorization/authorized-space.js';

/** Keeps the owning repository's Prisma query visible; AND prevents scope override. */
export function scopedWhere<T extends object>(
  scope: AuthorizedSpace,
  where: T,
) {
  return { AND: [where, { spaceId: scope.spaceId }] };
}
