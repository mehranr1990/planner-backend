import { SharedRetentionSchema } from '../../apps/api/src/modules/spaces/application/shared-retention.ts';

/**
 * Retention Policy Catalog v2.0 (ADR 0069, owner product decision 2026-11-20):
 * every recoverable user-initiated deletion recovers for exactly 7 days
 * (sharedRecoverySeconds 604800). Class retention, holds, obligations, audit,
 * backup and disposal rules are unchanged from v1.x. v1.x rows stay immutable.
 *
 * Approval values are never defaulted: the accountable owner/operator supplies
 * them at seed time (docs/retention-policy-catalog-v2.md approval checklist).
 */
const day = 86400,
  year = 365 * day;
const rule = (retainAfterClosureSeconds: number) => ({
  retainAfterClosureSeconds,
  audience: ['OWNER', 'ADMIN'],
  exportAuthority: ['OWNER'],
  disposalAction: 'PURGE' as const,
});
type Context = 'PROJECT' | 'TEAM' | 'CONVERSATION' | 'MEETING' | 'SOCIAL_GROUP';
export type CatalogApproval = {
  approvalReference: string;
  accountableOperator: string;
};
const placeholder =
  /^(?:|synthetic.*|pending.*|tbd|todo|n\/a|none|test.*|example.*|replace.*|.*development.*)$/i;

export const RETENTION_CATALOG_V2_VERSIONS = [
  'mp-rpc-v2.0-work',
  'mp-rpc-v2.0-conversation',
  'mp-rpc-v2.0-meeting',
  'mp-rpc-v2.0-social-group',
] as const;

export function buildRetentionCatalogV2(approval: CatalogApproval) {
  for (const value of [
    approval.approvalReference,
    approval.accountableOperator,
  ])
    if (placeholder.test(value.trim()))
      throw new Error(
        'Catalog v2 requires a genuine approval reference and accountable operator',
      );
  const policy = (
    policyVersion: (typeof RETENTION_CATALOG_V2_VERSIONS)[number],
    applicableContexts: Context[],
    content: number,
    audit: number,
  ) => ({
    policyVersion,
    approvalReference: approval.approvalReference.trim(),
    accountableOperator: approval.accountableOperator.trim(),
    applicableContexts,
    marketScope: 'Mehran Planner catalog v2.0',
    sharedRecoverySeconds: 604800 as const,
    classRules: {
      workContent: rule(content),
      commentsHistory: rule(content),
      filesDerivatives: rule(0),
      exports: rule(0),
      accessAuditLifecycle: rule(audit),
    },
    obligations: [],
    holds: [],
    backupPolicyReference:
      'docs/architecture/SHARED_RESOURCES_AND_LIFECYCLE.md (consistent PostgreSQL + file volume backup)',
  });
  return [
    // Project/Team work: retained while active; cleanup after closure.
    policy('mp-rpc-v2.0-work', ['PROJECT', 'TEAM'], 0, 2 * year),
    // Conversation messages: 3 years; meeting minutes/decisions: 5 years.
    policy('mp-rpc-v2.0-conversation', ['CONVERSATION'], 3 * year, 2 * year),
    policy('mp-rpc-v2.0-meeting', ['MEETING'], 5 * year, 2 * year),
    // Social Group: protected expense/settlement/loan/dispute/audit records stay
    // guarded by the Social content guard (ADR 0066 G/H), as in v1.1.
    policy('mp-rpc-v2.0-social-group', ['SOCIAL_GROUP'], 0, 0),
  ].map((p) => SharedRetentionSchema.parse(p));
}

/** Not seedable until the listed legal/operator inputs exist. */
export const RETENTION_CATALOG_V2_PENDING = [
  {
    context: 'COMPANY',
    status: 'PENDING_LEGAL_REVIEW',
    required:
      'Jurisdiction(s); legal basis and minimum retention for financial records, payroll/settlements and sealed employee files; accountable operator; legal approval reference. The current model has no per-category finance/employee class and a Company policy authorizes whole-Space PURGE, so a schema decision is also required.',
  },
] as const;
