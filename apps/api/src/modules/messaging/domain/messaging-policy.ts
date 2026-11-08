/** Conversation roles do not confer context authority. Source roles are evaluated separately. */
export function managesChannel(kind: string, sourceRole: string | null) {
  return kind === 'COMPANY'
    ? sourceRole === 'OWNER' || sourceRole === 'ORG_ADMIN'
    : sourceRole === 'OWNER' || sourceRole === 'ADMIN';
}
export function sameAdmission(
  member: {
    sourceAccessId: string;
    sourceGeneration: number;
    restoreGeneration: number;
  },
  proof: { accessId: string; generation: number; restoreGeneration: number },
) {
  return (
    member.sourceAccessId === proof.accessId &&
    member.sourceGeneration === proof.generation &&
    member.restoreGeneration === proof.restoreGeneration
  );
}
