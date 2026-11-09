/** ADR 0048: a role is necessary for management, never sufficient for admission. */
export function meetingManages(kind: string, role: string | null) {
  switch (kind) {
    case 'INDEPENDENT':
    case 'MEETING':
      return role === 'OWNER' || role === 'ADMIN';
    case 'PROJECT':
      return role === 'OWNER' || role === 'ADMIN' || role === 'MANAGER';
    case 'TEAM':
      return role === 'OWNER' || role === 'ADMIN' || role === 'LEAD';
    case 'COMPANY':
      return role === 'OWNER' || role === 'ORG_ADMIN';
    default:
      return false;
  }
}
