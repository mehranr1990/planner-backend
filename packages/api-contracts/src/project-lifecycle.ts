import { z } from 'zod';
const revision = z.number().int().positive().max(2147483646),
  id = z.uuid();
export const ProjectLifecyclePasswordSchema = z.strictObject({
  password: z.string().min(1).max(1024),
});
export const ProjectLifecycleRecoverSchema =
  ProjectLifecyclePasswordSchema.extend({ generation: revision });
export const ProjectLifecycleJobSchema = z.strictObject({
  jobId: id,
  generation: revision,
  revision,
  state: z.enum([
    'OWNER_EXIT_FROZEN',
    'CLOSING_GRACE',
    'CLEANUP_PENDING',
    'WAITING_OBLIGATIONS',
    'BLOCKED_POLICY',
    'PURGING',
    'DELETED',
    'FAILED',
    'CANCELED',
  ]),
  recoveryDeadline: z.iso.datetime(),
  nextAt: z.iso.datetime(),
  stage: z.string().nullable(),
  failureCode: z.string().nullable(),
});
export const ProjectLifecycleProofSchema = z.strictObject({
  jobId: id,
  generation: revision,
  revision,
  recoveryDeadline: z.iso.datetime(),
  proof: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const ProjectLifecycleRecoverySchema = z.strictObject({
  jobId: id,
  generation: revision,
  revision,
  state: z.literal('CANCELED'),
});
