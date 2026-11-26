import type { Prisma } from '../../../generated/prisma/client.js';
/** Internal aggregate input only. No identity or private profile is returned. */
export async function analyticsRegistrations(
  tx: Prisma.TransactionClient,
  from: Date,
  to: Date,
) {
  return {
    newUsers: await tx.user.count({
      where: { createdAt: { gte: from, lt: to } },
    }),
    population: await tx.user.count({ where: { createdAt: { lt: to } } }),
  };
}
export async function analyticsRegistrationCohort(
  tx: Prisma.TransactionClient,
  ids: string[],
  from?: string,
  to?: string,
) {
  return tx.user.findMany({
    where: {
      ...(from || to ? {} : { id: { in: ids } }),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lt: new Date(to) } : {}),
            },
          }
        : {}),
    },
    select: { id: true, createdAt: true },
    take: 10001,
  });
}
