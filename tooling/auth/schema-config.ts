import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client.js';
import { authSchemaOptions } from '../../apps/api/src/platform/auth/auth-options.js';

// Schema generation does not connect or migrate. This config is not runtime auth.
const client = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: 'postgresql://localhost/schema_generation_only',
  }),
});
export const auth = betterAuth({
  ...authSchemaOptions,
  secret: 'schema-generation-only-not-a-runtime-credential',
  baseURL: 'http://localhost:3000',
  database: prismaAdapter(client, {
    provider: 'postgresql',
    transaction: true,
  }),
  emailAndPassword: { enabled: true },
});
