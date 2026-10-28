import { z } from 'zod';
import { FileNameSchema, StoredFileSchema } from './files.js';
export const VoiceFileUploadSchema = z.strictObject({
  filename: FileNameSchema,
  mimeType: z.literal('audio/wav'),
  expectedSize: z.number().int().min(46).max(10485760),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export const VoiceStoredFileSchema = StoredFileSchema.extend({
  mimeType: z.literal('audio/wav'),
});
export type VoiceFileUpload = z.infer<typeof VoiceFileUploadSchema>;
