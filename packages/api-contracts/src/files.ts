import { z } from 'zod';

export const FileMimeSchema = z.enum([
  'text/plain',
  'application/pdf',
  'image/png',
  'image/jpeg',
]);
export const FileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine(
    (name) =>
      !/[\x00-\x1f\x7f/\\<>:"|?*\ud800-\udfff]/u.test(name) &&
      !/^[. ]|[. ]$/.test(name) &&
      !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) &&
      !/\.(?:exe|dll|com|bat|cmd|ps1|js|mjs|html?|svg|sh|msi)$/i.test(name),
  );
export const FileUploadSchema = z.strictObject({
  filename: FileNameSchema,
  mimeType: FileMimeSchema,
  expectedSize: z.number().int().min(1).max(104857600),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export const FileIdSchema = z.string().uuid();
export const FileDownloadQuerySchema = z.strictObject({
  expires: z.string().regex(/^[1-9][0-9]{9,10}$/),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});
export const StoredFileSchema = z.strictObject({
  id: FileIdSchema,
  status: z.enum(['INITIATED', 'READY', 'REJECTED', 'DELETED']),
  filename: FileNameSchema,
  mimeType: FileMimeSchema,
  expectedSize: z.number().int().positive(),
  actualSize: z.number().int().positive().nullable(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  createdAt: z.iso.datetime(),
  uploadExpiresAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  download: z
    .strictObject({
      url: z.string().startsWith('/api/v1/files/'),
      expiresAt: z.iso.datetime(),
    })
    .nullable(),
});
export type FileUpload = z.infer<typeof FileUploadSchema>;
export type FileDownloadQuery = z.infer<typeof FileDownloadQuerySchema>;
