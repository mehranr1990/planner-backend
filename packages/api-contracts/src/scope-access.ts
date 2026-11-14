import { z } from 'zod';

/** Capability hints describe current authority; every operation rechecks it. */
export const ScopeAccessMeSchema = z.strictObject({
  accessId: z.uuid(),
  actorId: z.uuid(),
  role: z
    .enum([
      'OWNER',
      'ADMIN',
      'MANAGER',
      'LEAD',
      'ORG_ADMIN',
      'DEPT_MANAGER',
      'TEAM_LEAD',
      'MEMBER',
      'VIEWER',
    ])
    .nullable(),
  generation: z.number().int().positive(),
  capabilities: z.array(z.string()),
});
export const PendingInvitationSummarySchema = z.strictObject({
  id: z.uuid(),
  contextLabel: z.enum(['Team', 'Company']),
  revision: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
});
export const PendingInvitationPageSchema = z.strictObject({
  items: z.array(PendingInvitationSummarySchema).max(100),
  nextCursor: z.string().nullable(),
});
