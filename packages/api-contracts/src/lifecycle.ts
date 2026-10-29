import { z } from 'zod';
const Password = z.string().min(1).max(128),
  Id = z.uuid();
export const ExportRequestSchema = z.strictObject({ password: Password });
export const ExportJobSchema = z.strictObject({
  id: Id,
  revision: z.number().int().positive(),
  state: z.enum([
    'QUEUED',
    'RUNNING',
    'READY',
    'FAILED',
    'EXPIRED',
    'CANCELED',
  ]),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  failureCode: z.string().max(80).nullable(),
  size: z.number().int().nonnegative().nullable(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  downloadProof: z.string().max(1024).nullable(),
});
export const ExportReadQuerySchema = z.strictObject({
  download: z.literal('true').optional(),
});
export const DeletionRequestSchema = z.strictObject({
  password: Password,
  accountRevision: z.number().int().positive(),
  retentionAcknowledged: z.literal(true),
  policyVersion: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
});
export const DeletionConfirmSchema = z.strictObject({
  jobId: Id,
  revision: z.number().int().positive(),
});
export const DeletionCancelSchema = z.strictObject({
  jobId: Id,
  password: Password,
});
export const DeletionStatusQuerySchema = z.strictObject({ jobId: Id });
export const DeletionJobSchema = z.strictObject({
  id: Id,
  revision: z.number().int().positive(),
  state: z.enum([
    'PENDING',
    'WAITING',
    'ERASING',
    'CANCELED',
    'EXPIRED',
    'FAILED',
    'BLOCKED_POLICY',
    'ERASED',
  ]),
  createdAt: z.iso.datetime(),
  eraseAfter: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  failureCode: z.string().max(80).nullable(),
  backupExpiryDeadline: z.iso.datetime().nullable(),
});
export const DeletionChallengeSchema = z.strictObject({
  job: DeletionJobSchema,
  confirmationProof: z.string().max(128),
  recoveryCapability: z.string().max(128),
  confirmationExpiresAt: z.iso.datetime(),
});
