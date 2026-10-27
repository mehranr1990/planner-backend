import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client.js';
import { isolatedTestDatabaseUrl } from './test-database.ts';

// A separate process deliberately exits before/after commit, without graceful shutdown.
const url = isolatedTestDatabaseUrl(process.env);
const identifiers = (process.env.P003_CRASH_IDS ?? '').split(',');
if (
  identifiers.length !== 4 ||
  identifiers.some((id) => !/^[0-9a-f-]{36}$/.test(id))
)
  throw new Error('Invalid crash fixture.');
const [userId, spaceId, eventId, correlationId] = identifiers as [
  string,
  string,
  string,
  string,
];
const generated = (await import(
  pathToFileURL(path.resolve('apps/api/dist/generated/prisma/client.js')).href
)) as { PrismaClient: new (options: object) => PrismaClient };
const client = new generated.PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
  log: [],
});
const user = await client.user.findUniqueOrThrow({ where: { id: userId } });
if (!user.email.startsWith('p003-') || !user.email.endsWith('@example.test'))
  throw new Error('Not a disposable crash fixture.');
await client.$transaction(async (tx) => {
  const space = await tx.space.findFirstOrThrow({
    where: { id: spaceId, ownerUserId: userId },
  });
  await tx.userSettings.update({
    where: { userId },
    data: { revision: { increment: 1 } },
  });
  await tx.outboxEvent.create({
    data: {
      id: eventId,
      type: 'account.timezone_changed',
      version: 1,
      aggregateId: userId,
      spaceId: space.id,
      correlationId,
      payload: {},
    },
  });
  if (process.env.P003_CRASH_POINT === 'before') process.exit(41);
});
process.exit(42);
