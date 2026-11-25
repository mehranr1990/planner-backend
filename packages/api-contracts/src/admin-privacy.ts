import { z } from 'zod';
const common = {
  targetId: z.uuid(),
  revision: z.number().int().positive(),
  reason: z.string().trim().min(5).max(500),
};
export const AdminDeletionImpactSchema = z.strictObject({
  members: z.number().int().nonnegative().nullable(),
  ownedBoundaries: z.number().int().nonnegative(),
  children: z.number().int().nonnegative().nullable(),
  retentionAcknowledged: z.literal(true).optional(),
  personalPolicyVersion: z.string().max(80).optional(),
});
export const AdminDeletionRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...common,
    kind: z.literal('ACCOUNT'),
    retentionAcknowledged: z.literal(true),
    recoveryDays: z.number().int().min(7).max(30).default(7),
  }),
  z.strictObject({
    ...common,
    kind: z.enum(['TEAM', 'COMPANY']),
    recoveryDays: z.union([z.literal(7), z.literal(30)]).default(7),
  }),
]);
export const AdminPrivacyRequestViewSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['ACCOUNT', 'TEAM', 'COMPANY']),
  targetId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  impactFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  impact: AdminDeletionImpactSchema,
  recoveryDays: z.number().int().min(7).max(30),
  state: z.enum(['REQUESTED', 'APPROVED', 'APPLIED', 'RECOVERED', 'EXPIRED']),
  requesterAdminId: z.uuid(),
  approverAdminId: z.uuid().nullable(),
  reason: z.string().max(500),
  expiresAt: z.iso.datetime(),
  resultJobId: z.uuid().nullable(),
  job: z
    .strictObject({
      state: z.string().max(32),
      attempts: z.number().int().nonnegative(),
      recoveryDeadline: z.iso.datetime().nullable(),
      failureCode: z.string().max(80).nullable(),
    })
    .nullable(),
});
const empty = z.strictObject({});
export const adminPrivacyRoutes = {
  'POST privacy/deletion-requests': {
    permission: 'admin.privacy.deletions.request',
    schema: AdminDeletionRequestSchema,
    response: AdminPrivacyRequestViewSchema,
  },
  'GET privacy/deletion-requests/:id': {
    permission: 'admin.privacy.deletions.read',
    schema: empty,
    response: AdminPrivacyRequestViewSchema,
  },
  'POST privacy/deletion-requests/:id/approve': {
    permission: 'admin.privacy.deletions.approve',
    schema: z.strictObject({
      reason: z.string().trim().min(5).max(500),
      targetId: z.uuid(),
      impactFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      recoveryDays: z.number().int().min(7).max(30),
    }),
    response: AdminPrivacyRequestViewSchema,
  },
  'POST privacy/deletion-requests/:id/execute': {
    permission: 'admin.privacy.deletions.execute',
    schema: empty,
    response: AdminPrivacyRequestViewSchema,
  },
  'POST privacy/deletion-requests/:id/recover': {
    permission: 'admin.privacy.accounts.recover',
    schema: z.strictObject({ reason: z.string().trim().min(5).max(500) }),
    response: AdminPrivacyRequestViewSchema,
  },
  'GET privacy/deletion-requests/:id/history': {
    permission: 'admin.privacy.deletions.read',
    schema: empty,
    response: z.strictObject({
      items: z
        .array(
          z.strictObject({
            id: z.uuid(),
            actorAdminId: z.uuid(),
            state: z.enum(['REQUESTED', 'APPROVED', 'APPLIED', 'RECOVERED']),
            createdAt: z.iso.datetime(),
          }),
        )
        .max(100),
    }),
  },
} as const;
