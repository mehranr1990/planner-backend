import type { BetterAuthOptions } from 'better-auth';

// Shared with the official schema generator. Provider-owned scalar fields are
// generated from these options, never maintained as parallel auth models.
export const authSchemaOptions = {
  user: { modelName: 'User', changeEmail: { enabled: true } },
  session: { modelName: 'AuthSession', cookieCache: { enabled: false } },
  account: { modelName: 'AuthAccount', accountLinking: { enabled: false } },
  verification: { modelName: 'AuthVerification', storeInDatabase: true },
  advanced: { database: { generateId: 'uuid', validateSchema: true } },
} satisfies BetterAuthOptions;
