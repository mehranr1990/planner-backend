import { isDeepStrictEqual } from 'node:util';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client.js';
import { SharedRetentionSchema } from '../../apps/api/src/modules/spaces/application/shared-retention.ts';

/**
 * Retention Policy Catalog v1.0 (owner product configuration, 2026-11-14),
 * mapped onto the existing SharedRetentionPolicy model without schema change.
 * The model governs Shared Spaces only: each class keeps data for
 * `retainAfterClosureSeconds` after closure/departure, on top of the fixed
 * 30-day recovery window, and a closed Space is disposed at its longest class
 * window. See docs/retention-policy-catalog-v1.md for the full mapping and
 * the categories that cannot be represented.
 */
const day = 86400,
  year = 365 * day;
export const CATALOG_APPROVAL =
  'RPC-v1.0 owner product configuration 2026-11-14; development/pre-production only; production operator approval pending';
const rule = (retainAfterClosureSeconds: number) => ({
  retainAfterClosureSeconds,
  audience: ['OWNER', 'ADMIN'],
  exportAuthority: ['OWNER'],
  disposalAction: 'PURGE' as const,
});
const policy = (
  policyVersion: string,
  applicableContexts: ('PROJECT' | 'TEAM' | 'CONVERSATION' | 'MEETING')[],
  content: number,
) => ({
  policyVersion,
  approvalReference: CATALOG_APPROVAL,
  accountableOperator: 'Mehran Planner owner (development/pre-production)',
  applicableContexts,
  marketScope: 'Mehran Planner initial catalog v1.0',
  sharedRecoverySeconds: 2592000 as const,
  classRules: {
    workContent: rule(content),
    commentsHistory: rule(content),
    // Active files live for their authorized active lifecycle only.
    filesDerivatives: rule(0),
    exports: rule(0),
    // Operational activity records: 2 years; the evidence floor still applies.
    accessAuditLifecycle: rule(2 * year),
  },
  obligations: [],
  holds: [],
  backupPolicyReference:
    'docs/architecture/SHARED_RESOURCES_AND_LIFECYCLE.md (consistent PostgreSQL + file volume backup)',
});
/** Seedable entries; every one validates against SharedRetentionSchema. */
export const RETENTION_CATALOG_V1 = [
  // Project/Team work: retained while active; cleanup after closure.
  policy('mp-rpc-v1.0-work', ['PROJECT', 'TEAM'], 0),
  // Conversation messages: 3 years.
  policy('mp-rpc-v1.0-conversation', ['CONVERSATION'], 3 * year),
  // Meeting minutes and decisions: 5 years.
  policy('mp-rpc-v1.0-meeting', ['MEETING'], 5 * year),
].map((p) => SharedRetentionSchema.parse(p));

/**
 * Not seeded: legal or operator review is required, or no approved product
 * rule exists. Recorded for review only; never inserted by the seed.
 */
export const RETENTION_CATALOG_V1_PENDING = [
  {
    context: 'COMPANY',
    status: 'PENDING_LEGAL_REVIEW',
    reason:
      'Financial records (proposed 7 years) and sealed employee files (operator legal policy) have no confirmed legal basis; the model has no per-category class for them and a Company policy would authorize whole-Space PURGE.',
  },
  {
    context: 'SOCIAL_GROUP',
    status: 'NO_APPROVED_RULE',
    reason: 'The v1.0 product configuration defines no Social Group rule.',
  },
] as const;

type Client = Pick<PrismaClient, '$transaction'>;
export type SeedResult = {
  version: string;
  status: 'INSERTED' | 'UNCHANGED' | 'CONFLICT' | 'PLANNED';
}[];
/**
 * Idempotent: inserts missing versions, reports identical rows as UNCHANGED
 * and never overwrites a differing row (policies are immutable). Any CONFLICT
 * aborts the whole run before a write. `apply: false` only reports the plan.
 */
export async function seedRetentionCatalog(
  client: Client,
  apply: boolean,
): Promise<SeedResult> {
  return client.$transaction(async (tx) => {
    const existing = new Map(
      (
        await tx.sharedRetentionPolicy.findMany({
          where: {
            version: { in: RETENTION_CATALOG_V1.map((p) => p.policyVersion) },
          },
        })
      ).map((r) => [r.version, r]),
    );
    const result: SeedResult = RETENTION_CATALOG_V1.map((p) => {
      const row = existing.get(p.policyVersion);
      if (!row)
        return {
          version: p.policyVersion,
          status: apply ? 'INSERTED' : 'PLANNED',
        };
      return {
        version: p.policyVersion,
        status:
          row.approvalReference === p.approvalReference &&
          isDeepStrictEqual(row.configuration, JSON.parse(JSON.stringify(p)))
            ? 'UNCHANGED'
            : 'CONFLICT',
      };
    });
    if (!apply || result.some((r) => r.status === 'CONFLICT')) return result;
    for (const p of RETENTION_CATALOG_V1)
      if (!existing.has(p.policyVersion))
        await tx.sharedRetentionPolicy.create({
          data: {
            version: p.policyVersion,
            approvalReference: p.approvalReference,
            configuration: p,
          },
        });
    return result;
  });
}
