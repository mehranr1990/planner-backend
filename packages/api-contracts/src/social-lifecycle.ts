import { z } from 'zod';
import {
  ProjectLifecycleJobSchema,
  ProjectLifecycleProofSchema,
  ProjectLifecycleRecoverySchema,
  ProjectLifecyclePasswordSchema,
  ProjectLifecycleRecoverSchema,
} from './project-lifecycle.js';
// P6-06 (ADR 0066): Social Group deletion, 30-day recovery and departure
// confirmation. Lifecycle job, proof and recovery reuse the shared shapes.
const id = z.uuid(),
  revision = z.number().int().positive().max(2147483646),
  confirmation = z.string().regex(/^[a-f0-9]{64}$/),
  Minor = z.string().regex(/^-?(0|[1-9][0-9]{0,17})$/);
export const SocialGroupLeaveSchema = z.strictObject({
  outstandingBalanceConfirmation: confirmation.optional(),
});
export const SocialGroupDeleteSchema = ProjectLifecyclePasswordSchema.extend({
  outstandingBalanceConfirmation: confirmation.optional(),
});
export const SocialGroupLifecycleChangeSchema = z.strictObject({
  id,
  groupId: id,
  revision,
});
export const SocialObligationSchema = z.strictObject({
  ledgerKind: z.enum(['GROUP', 'ACTIVITY']),
  ledgerId: id,
  currency: z.string(),
  netMinor: Minor,
  owedMinor: Minor,
  receivableMinor: Minor,
});
export const SocialGroupExitCheckSchema = z.strictObject({
  groupId: id,
  /** The caller's membership revision (If-Match for leave). */
  membershipRevision: revision,
  /** The caller's own open balances only; no counterparties or content. */
  obligations: z.array(SocialObligationSchema).max(10000),
  departureConfirmation: confirmation.nullable(),
  /** Primary Owner only; counts, never identities or amounts. */
  deletion: z
    .strictObject({
      groupRevision: revision,
      outstandingLedgerCount: z.number().int().nonnegative(),
      outstandingPartyCount: z.number().int().nonnegative(),
      confirmation: confirmation.nullable(),
    })
    .nullable(),
});
export const SocialGroupLifecycleJobSchema = ProjectLifecycleJobSchema;
export const SocialGroupLifecycleProofSchema = ProjectLifecycleProofSchema;
export const SocialGroupLifecycleRecoverySchema =
  ProjectLifecycleRecoverySchema;
export const SocialGroupLifecyclePasswordSchema =
  ProjectLifecyclePasswordSchema;
export const SocialGroupLifecycleRecoverSchema = ProjectLifecycleRecoverSchema;
