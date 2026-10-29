import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';
import { BadRequestException, ConflictException } from '@nestjs/common';
const Claim = z.strictObject({
  v: z.literal(1),
  u: z.uuid(),
  s: z.uuid(),
  e: z.uuid(),
  phase: z.enum(['BOOTSTRAP', 'INCREMENTAL']),
  sequence: z.string().regex(/^\d{1,20}$/),
  entity: z.number().int().min(0).max(7),
  after: z.uuid().nullable(),
  issued: z.number().int().positive(),
});
export type SyncCursor = z.infer<typeof Claim>;
export function signCursor(secret: string, c: SyncCursor) {
  const data = Buffer.from(JSON.stringify(Claim.parse(c))).toString(
    'base64url',
  );
  return (
    data +
    '.' +
    createHmac('sha256', secret)
      .update('personal-sync-v1:' + data)
      .digest('base64url')
  );
}
export function readCursor(
  secret: string,
  value: string,
  scope: AuthorizedSpace,
  epoch: string,
  retained: bigint,
  now: number,
): SyncCursor {
  let claim: SyncCursor;
  try {
    if (value.length > 2048) throw new Error();
    const [data, mac, ...extra] = value.split('.');
    if (!data || !mac || extra.length) throw new Error();
    const actual = Buffer.from(mac, 'base64url'),
      expected = createHmac('sha256', secret)
        .update('personal-sync-v1:' + data)
        .digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error();
    claim = Claim.parse(
      JSON.parse(Buffer.from(data, 'base64url').toString('utf8')),
    );
    if (claim.u !== scope.actor.userId || claim.s !== scope.spaceId)
      throw new Error();
  } catch {
    throw new BadRequestException({ code: 'INVALID_SYNC_CURSOR' });
  }
  if (
    claim.e !== epoch ||
    BigInt(claim.sequence) < retained ||
    now - claim.issued > 30 * 86400000 ||
    claim.issued > now + 60000
  )
    throw new ConflictException({ code: 'RESYNC_REQUIRED' });
  return claim;
}
