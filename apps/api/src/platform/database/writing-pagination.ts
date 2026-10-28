import { cursorPage, cursorPosition } from './cursor-pagination.js';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';
import { createHash } from 'node:crypto';
export type WritingPageQuery = {
  limit?: string | undefined;
  cursor?: string | undefined;
};
export const writingContext = (prefix: string, value: unknown) =>
  prefix + createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function writingPosition(
  scope: AuthorizedSpace,
  context: string,
  q: WritingPageQuery,
) {
  return cursorPosition(scope, context, q.cursor);
}
export function afterLogical(position: ReturnType<typeof cursorPosition>) {
  return position
    ? {
        OR: [
          { createdAt: { gt: position.createdAt } },
          { createdAt: position.createdAt, logicalId: { gt: position.id } },
        ],
      }
    : {};
}
export function writingPage<
  T extends { id: string; logicalId: string; createdAt: Date },
  R,
>(
  scope: AuthorizedSpace,
  context: string,
  q: WritingPageQuery,
  rows: T[],
  view: (r: T) => R,
) {
  const limit = Number(q.limit ?? 25),
    page = cursorPage(
      scope,
      context,
      limit,
      rows.map((r) => ({ id: r.logicalId, createdAt: r.createdAt })),
    );
  return { items: rows.slice(0, limit).map(view), nextCursor: page.nextCursor };
}
