import type { Prisma } from '../../../generated/prisma/client.js';
import { NotFoundException } from '@nestjs/common';
import { effectiveSuspension } from '../../../platform/admin/management-policy.js';
export async function engagementIdentity(
  tx: Prisma.TransactionClient,
  id: string,
) {
  const row = await tx.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      settings: {
        select: {
          locale: true,
          timezone: true,
          suspendedAt: true,
          suspensionExpiresAt: true,
        },
      },
    },
  });
  if (!row) throw new NotFoundException();
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    locale: row.settings?.locale ?? 'en',
    timezone: row.settings?.timezone ?? 'UTC',
    active: !row.settings || !effectiveSuspension(row.settings),
  };
}
export function engagementAudience(
  tx: Prisma.TransactionClient,
  input: {
    verified?: boolean | undefined;
    createdFrom?: string | undefined;
    createdUntil?: string | undefined;
    userIds?: string[] | undefined;
  },
) {
  return tx.user.findMany({
    where: {
      ...(input.userIds ? { id: { in: input.userIds } } : {}),
      ...(input.verified === undefined
        ? {}
        : { emailVerified: input.verified }),
      createdAt: {
        ...(input.createdFrom ? { gte: new Date(input.createdFrom) } : {}),
        ...(input.createdUntil ? { lt: new Date(input.createdUntil) } : {}),
      },
    },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 1001,
  });
}
