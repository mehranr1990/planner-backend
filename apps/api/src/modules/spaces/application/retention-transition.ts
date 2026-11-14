import type { z } from 'zod';
import type { SharedRetentionSchema } from './shared-retention.js';
type Policy = z.infer<typeof SharedRetentionSchema>;
const classes = [
  'workContent',
  'commentsHistory',
  'filesDerivatives',
  'exports',
  'accessAuditLifecycle',
] as const;
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v) => b.includes(v));
const key = (v: string) => v.toLowerCase();
/**
 * R1/R2 (owner-approved): after creation a Space may only move to an applicable,
 * operator-approved policy that is comparable (same market scope, disposal
 * actions, audiences and export authority per data class), keeps every active
 * hold and outstanding obligation, never shortens any class and lengthens at
 * least one. Returns the refusal code, or null when the transition is allowed.
 */
export function retentionTransition(
  current: Policy,
  next: Policy,
  kind: string,
): string | null {
  if (
    !next.applicableContexts.includes(
      kind as Policy['applicableContexts'][number],
    )
  )
    return 'RETENTION_NOT_APPLICABLE';
  if (next.marketScope !== current.marketScope)
    return 'RETENTION_NOT_COMPARABLE';
  let longer = false;
  for (const name of classes) {
    const a = current.classRules[name],
      b = next.classRules[name];
    if (
      a.disposalAction !== b.disposalAction ||
      !sameSet(a.audience, b.audience) ||
      !sameSet(a.exportAuthority, b.exportAuthority)
    )
      return 'RETENTION_NOT_COMPARABLE';
    if (b.retainAfterClosureSeconds < a.retainAfterClosureSeconds)
      return 'RETENTION_SHORTENING_FORBIDDEN';
    if (b.retainAfterClosureSeconds > a.retainAfterClosureSeconds)
      longer = true;
  }
  for (const hold of current.holds.filter((h) => h.state === 'ACTIVE'))
    if (
      !next.holds.some(
        (h) => key(h.id) === key(hold.id) && h.state === 'ACTIVE',
      )
    )
      return 'RETENTION_HOLD_DROPPED';
  for (const o of current.obligations.filter((o) => o.state === 'OUTSTANDING'))
    if (
      !next.obligations.some(
        (n) => key(n.id) === key(o.id) && n.state === 'OUTSTANDING',
      )
    )
      return 'RETENTION_OBLIGATION_DROPPED';
  return longer ? null : 'RETENTION_NOT_INCREASED';
}
