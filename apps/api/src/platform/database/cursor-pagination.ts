import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';
import { CursorQuerySchema } from '@mehran/api-contracts';

const CursorSchema = z.strictObject({
  version: z.literal(1),
  userId: z.string().uuid(),
  spaceId: z.string().uuid(),
  filter: z.string().max(100),
  createdAt: z.iso.datetime(),
  id: z.string().uuid(),
});
export type CursorRow = { id: string; createdAt: Date };
export function cursorPosition(
  scope: AuthorizedSpace,
  filter: string,
  cursor?: string,
): CursorRow | undefined {
  if (cursor === undefined) return undefined;
  try {
    if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor))
      throw new Error();
    const parsed = CursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    if (
      parsed.spaceId !== scope.spaceId ||
      parsed.userId !== scope.actor.userId ||
      parsed.filter !== filter
    )
      throw new Error();
    return { id: parsed.id, createdAt: new Date(parsed.createdAt) };
  } catch {
    throw new BadRequestException();
  }
}
export function cursorPage<T extends CursorRow>(
  scope: AuthorizedSpace,
  filter: string,
  limit: number,
  rows: T[],
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new BadRequestException();
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify(
              CursorSchema.parse({
                version: 1,
                userId: scope.actor.userId,
                spaceId: scope.spaceId,
                filter,
                createdAt: last.createdAt.toISOString(),
                id: last.id,
              }),
            ),
          ).toString('base64url')
        : null,
  };
}
export function cursorQuery(input: unknown) {
  const result = CursorQuerySchema.safeParse(input);
  if (!result.success) throw new BadRequestException();
  return {
    limit: result.data.limit ? Number(result.data.limit) : 25,
    cursor: result.data.cursor,
  };
}
export function afterCursor(position: CursorRow | undefined) {
  return position
    ? {
        OR: [
          { createdAt: { gt: position.createdAt } },
          { createdAt: position.createdAt, id: { gt: position.id } },
        ],
      }
    : {};
}
