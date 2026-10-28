import { z } from 'zod';
import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { PersonalSearchKindSchema } from '@mehran/api-contracts';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
const Schema = z.strictObject({
  version: z.literal(1),
  userId: z.string().uuid(),
  spaceId: z.string().uuid(),
  filter: z.string().length(64),
  createdAt: z.iso.datetime(),
  id: z.string().uuid(),
  kind: PersonalSearchKindSchema,
});
export const searchFilter = (input: unknown) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');
export function decodeSearch(
  scope: AuthorizedSpace,
  filter: string,
  cursor: string | undefined,
) {
  if (cursor === undefined) return null;
  try {
    if (cursor.length > 1024 || !/^[-A-Za-z0-9_]+$/.test(cursor))
      throw new Error();
    const r = Schema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    if (
      r.userId !== scope.actor.userId ||
      r.spaceId !== scope.spaceId ||
      r.filter !== filter
    )
      throw new Error();
    return { createdAt: r.createdAt, id: r.id, kind: r.kind };
  } catch {
    throw new BadRequestException();
  }
}
export function encodeSearch(
  scope: AuthorizedSpace,
  filter: string,
  last: {
    createdAt: string;
    id: string;
    kind: z.infer<typeof PersonalSearchKindSchema>;
  },
) {
  return Buffer.from(
    JSON.stringify(
      Schema.parse({
        version: 1,
        userId: scope.actor.userId,
        spaceId: scope.spaceId,
        filter,
        ...last,
      }),
    ),
  ).toString('base64url');
}
