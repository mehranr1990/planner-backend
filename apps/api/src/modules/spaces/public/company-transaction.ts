import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import type { SharedAccess } from './shared-authority.js';
/** Existing Company transaction boundary, independent of its application service. */
export type CompanyTransaction = {
  tx: Prisma.TransactionClient;
  now: Date;
  locked: string[];
  root: SharedAccess;
  actor: RequestActor;
  spaceId: string;
  begin: () => Promise<string>;
};
