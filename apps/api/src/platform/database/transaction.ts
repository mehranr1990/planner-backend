import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

/** DB-only callbacks: no SMTP, HTTP, queue dispatch or other external side effects. */
export async function serializable<T>(
  client: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.$transaction(work, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      if (
        attempt >= 2 ||
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'P2034'
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
