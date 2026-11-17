export type ApprovalTier = {
  currency: string;
  minimum: string;
  maximum: string | null;
  categoryId: string | null;
  workflowVersionId: string;
  escalateAfterSeconds: number | null;
};
function fixed(v: string) {
  const [a, b = ''] = v.split('.');
  return BigInt(a!) * 10000n + BigInt(b.padEnd(4, '0'));
}
export function matchingTier(
  rules: readonly ApprovalTier[],
  facts: { currency: string; amount: string; categoryId: string | null },
) {
  const n = fixed(facts.amount);
  return rules.filter(
    (r) =>
      r.currency === facts.currency &&
      (r.categoryId === null || r.categoryId === facts.categoryId) &&
      fixed(r.minimum) <= n &&
      (r.maximum === null || n < fixed(r.maximum)),
  );
}
export function overlappingTiers(a: ApprovalTier, b: ApprovalTier) {
  return (
    a.currency === b.currency &&
    (a.categoryId === null ||
      b.categoryId === null ||
      a.categoryId === b.categoryId) &&
    (a.maximum === null || fixed(b.minimum) < fixed(a.maximum)) &&
    (b.maximum === null || fixed(a.minimum) < fixed(b.maximum))
  );
}
export function validTiers(rules: readonly ApprovalTier[]) {
  return rules.every(
    (r, i) =>
      (r.maximum === null || fixed(r.minimum) < fixed(r.maximum)) &&
      !rules.slice(i + 1).some((other) => overlappingTiers(r, other)),
  );
}
