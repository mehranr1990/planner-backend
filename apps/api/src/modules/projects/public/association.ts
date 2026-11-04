/** Typed future association requests. Only INDEPENDENT is executable during P2. */
export type ProjectAssociationIntent =
  | { kind: 'INDEPENDENT' }
  | { kind: 'TEAM'; teamId: string }
  | { kind: 'COMPANY'; companyId: string; scopeId: string };
export function executableProjectAssociation(
  intent: ProjectAssociationIntent,
): intent is { kind: 'INDEPENDENT' } {
  return intent.kind === 'INDEPENDENT';
}
