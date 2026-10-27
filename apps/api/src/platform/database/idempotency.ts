import { createHash } from 'node:crypto';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../authorization/authorized-space.js';

function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new BadRequestException();
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return (
      '[' + value.map((item) => canonical(item, depth + 1)).join(',') + ']'
    );
  if (
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return (
      '{' +
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(
          ([key, item]) =>
            JSON.stringify(key) + ':' + canonical(item, depth + 1),
        )
        .join(',') +
      '}'
    );
  throw new BadRequestException();
}
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const ReceiptSchema = z.strictObject({
  resultId: z.string().uuid(),
  statusCode: z.number().int().min(200).max(299),
});
export type MutationReceipt = z.infer<typeof ReceiptSchema>;

/** Storage foundation only; no public idempotent route is added in Phase 0. */
export async function idempotent(
  client: PrismaClient,
  scope: AuthorizedSpace,
  operation: string,
  key: string,
  validatedRequest: unknown,
  work: (tx: Prisma.TransactionClient) => Promise<MutationReceipt>,
): Promise<MutationReceipt & { replayed: boolean }> {
  if (
    !/^[a-z][a-z0-9._-]{0,79}$/.test(operation) ||
    !/^[\x21-\x7e]{1,128}$/.test(key)
  )
    throw new BadRequestException();
  const request = canonical(validatedRequest);
  if (Buffer.byteLength(request) > 131072) throw new BadRequestException();
  const fingerprint = hash(request);
  const identity = {
    actorUserId: scope.actor.userId,
    spaceId: scope.spaceId,
    operation,
    keyHash: hash(key),
  };
  return client.$transaction(
    async (tx) => {
      // Transaction-scoped lock serializes this scoped operation across API processes.
      // Hash collisions only serialize unrelated work; they do not grant replay access.
      const lock = hash(canonical(identity)).slice(0, 16);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${BigInt.asIntN(64, BigInt('0x' + lock))})::text`;
      const [clock] = await tx.$queryRaw<
        Array<{ now: Date }>
      >`SELECT clock_timestamp() AS now`;
      if (!clock) throw new Error('Database clock unavailable');
      const where = { actorUserId_spaceId_operation_keyHash: identity };
      const previous = await tx.idempotencyRecord.findUnique({ where });
      if (previous && previous.expiresAt.getTime() > clock.now.getTime()) {
        if (previous.fingerprint !== fingerprint) throw new ConflictException();
        return {
          ...ReceiptSchema.parse({
            resultId: previous.resultId,
            statusCode: previous.statusCode,
          }),
          replayed: true,
        };
      }
      if (previous) await tx.idempotencyRecord.delete({ where });
      const receipt = ReceiptSchema.parse(await work(tx));
      await tx.idempotencyRecord.create({
        data: {
          ...identity,
          fingerprint,
          ...receipt,
          createdAt: clock.now,
          expiresAt: new Date(clock.now.getTime() + 24 * 60 * 60 * 1000),
        },
      });
      return { ...receipt, replayed: false };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}
