import { isDeepStrictEqual } from 'node:util';
import { parseEnvironment } from '../../apps/api/src/bootstrap/environment.ts';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client.js';
import { SharedRetentionSchema } from '../../apps/api/src/modules/spaces/application/shared-retention.ts';
import { RETENTION_CATALOG_V1 } from './catalog-v1.ts';

// Separate from the general catalog: never provision in pre-production/production.
export const LOCAL_COMPANY_POLICY = SharedRetentionSchema.parse({
  ...structuredClone(RETENTION_CATALOG_V1[0]),
  policyVersion: 'mp-local-company-v1-20261117',
  approvalReference:
    'Owner explicit approval 2026-11-17: copy Project/Team settings for synthetic local Company testing only; no legal or production approval',
  accountableOperator: 'Mehran Planner owner (local development only)',
  applicableContexts: ['COMPANY'],
  marketScope: 'Synthetic local development only: loopback mehran_dev',
});

export function localCompanyEnvironment(
  env: Record<string, string | undefined>,
) {
  // Existing parser enforces explicit development, loopback API/auth/CORS and
  // mehran_dev without URL options whenever this flag is enabled.
  const config = parseEnvironment(env);
  if (!config.SHARED_LOCAL_DEVELOPMENT_TEST_MODE)
    throw new Error('Company policy requires explicit local Shared test mode');
  return config;
}

export async function seedLocalCompanyPolicy(
  client: Pick<PrismaClient, '$transaction'>,
  env: Record<string, string | undefined>,
  apply: boolean,
) {
  localCompanyEnvironment(env);
  return client.$transaction(async (tx) => {
    const p = LOCAL_COMPANY_POLICY;
    const existing = await tx.sharedRetentionPolicy.findUnique({
      where: { version: p.policyVersion },
    });
    if (existing)
      return existing.approvalReference === p.approvalReference &&
        isDeepStrictEqual(existing.configuration, p)
        ? 'UNCHANGED'
        : 'CONFLICT';
    if (!apply) return 'PLANNED';
    await tx.sharedRetentionPolicy.create({
      data: {
        version: p.policyVersion,
        approvalReference: p.approvalReference,
        configuration: p,
      },
    });
    return 'INSERTED';
  });
}
