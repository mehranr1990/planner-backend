import { z } from 'zod';
const id = z.uuid(),
  revision = z.number().int().positive().max(2147483646),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ProjectTransferSelectionSchema = z.strictObject({ id, revision });
const selections = z
  .array(ProjectTransferSelectionSchema)
  .max(50)
  .refine((v) => new Set(v.map((r) => r.id)).size === v.length);
export const ProjectTransferConsentSchema = z.strictObject({
  includeTaskHistory: z.boolean(),
  includeGoalReviews: z.boolean(),
  privateReferences: z.literal('REJECT'),
  files: z.literal('REJECT'),
});
export const ProjectTransferPreviewInputSchema = z
  .strictObject({
    id,
    tasks: selections,
    goals: selections,
    consent: ProjectTransferConsentSchema,
  })
  .refine(
    (v) =>
      v.tasks.length + v.goals.length >= 1 &&
      v.tasks.length + v.goals.length <= 50,
  );
export const ProjectTransferCandidateSchema = z.strictObject({
  kind: z.enum(['TASK', 'GOAL']),
  id,
  revision,
  sourceHash: hash,
  children: z.number().int().nonnegative(),
  history: z.number().int().nonnegative(),
  nodes: z
    .array(
      z.strictObject({
        kind: z.enum([
          'TASK',
          'CHECKLIST',
          'TASK_HISTORY',
          'GOAL',
          'GOAL_METRIC',
          'GOAL_MILESTONE',
          'GOAL_REVIEW',
        ]),
        id,
      }),
    )
    .max(2001),
  privateReferences: z
    .array(
      z.strictObject({
        relation: z.string().min(1).max(100),
        count: z.number().int().positive(),
        disposition: z.literal('REJECT'),
      }),
    )
    .max(50),
  blockers: z.array(z.string().min(1).max(100)),
});
export const ProjectTransferManifestSchema = z.strictObject({
  sourceCustody: z.strictObject({ kind: z.literal('PERSONAL'), id }),
  destinationCustody: z.strictObject({
    kind: z.literal('SHARED_PROJECT'),
    id,
    scopeId: id,
  }),
  creatorAccessId: id,
  creatorGeneration: revision,
  authorizationVersion: z.string().regex(/^[1-9][0-9]*$/),
  tasks: selections,
  goals: selections,
  consent: ProjectTransferConsentSchema,
  candidates: z.array(ProjectTransferCandidateSchema).min(1).max(50),
});
export const ProjectTransferSchema = z.strictObject({
  id,
  projectId: id,
  state: z.enum([
    'PREVIEWED',
    'ACCEPTED',
    'APPLYING',
    'APPLIED',
    'EXPIRED',
    'CANCELED',
    'FAILED',
  ]),
  revision,
  manifest: ProjectTransferManifestSchema,
  manifestHash: hash,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  appliedAt: z.iso.datetime().nullable(),
});
export const ProjectTransferAcceptSchema = z.strictObject({
  manifestHash: hash,
  consentConfirmed: z.literal(true),
});
export const ProjectTransferApplySchema = z.strictObject({
  manifestHash: hash,
  password: z.string().min(1).max(1024),
});
