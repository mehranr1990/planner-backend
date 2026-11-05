/** Independent custody is preserved. Team references use the separate authorized Team routes. Company remains inactive. */
export type ProjectAssociationIntent =
  | { kind: 'INDEPENDENT' }
  | { kind: 'TEAM'; teamId: string }
  | { kind: 'COMPANY'; companyId: string; scopeId: string };
export function executableProjectAssociation(
  intent: ProjectAssociationIntent,
): intent is { kind: 'INDEPENDENT' } {
  return intent.kind === 'INDEPENDENT';
}
