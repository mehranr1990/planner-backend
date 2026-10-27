import { Prisma } from '../../generated/prisma/client.js';

/** Class-checked provider errors only. Never serialize message, meta or constraint names. */
export function persistenceStatus(error: unknown): number | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
      case 'P2034':
        return 409;
      case 'P2003':
        return 400;
      case 'P2025':
        return 404;
      case 'P2024':
      case 'P1001':
      case 'P1002':
      case 'P1017':
        return 503;
    }
  }
  if (error instanceof Prisma.PrismaClientInitializationError) return 503;
  return undefined;
}
