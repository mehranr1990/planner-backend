import { z } from 'zod';
import { PersonalEvidenceKeys } from './personal-evidence-keys.js';
const keys = (input: string | PersonalEvidenceKeys) =>
  typeof input === 'string'
    ? new PersonalEvidenceKeys({ BETTER_AUTH_SECRET: input })
    : input;
const Manifest = z.strictObject({
  version: z.literal(1),
  capturedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  checkpoint: z.string().regex(/^[a-f0-9]{64}$/),
  artifacts: z
    .array(
      z.strictObject({
        name: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(2)
    .max(100),
});
export type BackupManifest = z.infer<typeof Manifest>;
export function signBackup(
  secret: string | PersonalEvidenceKeys,
  input: BackupManifest,
) {
  const manifest = Manifest.parse(input),
    body = JSON.stringify(manifest);
  return {
    manifest,
    ...keys(secret).sign('backup', body, 'personal-backup-v1:'),
  };
}
export function verifyBackup(
  secret: string | PersonalEvidenceKeys,
  input: unknown,
  actual: Record<string, string>,
  now = new Date(),
) {
  const envelope = z
    .strictObject({
      manifest: Manifest,
      version: z.union([z.literal(1), z.literal(2)]).optional(),
      keyId: z.string().optional(),
      signature: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .parse(input);
  keys(secret).verify(
    'backup',
    JSON.stringify(envelope.manifest),
    envelope,
    'personal-backup-v1:',
  );
  const { manifest } = envelope,
    captured = new Date(manifest.capturedAt).getTime(),
    expires = new Date(manifest.expiresAt).getTime();
  if (
    captured > now.getTime() ||
    expires <= now.getTime() ||
    expires <= captured ||
    expires - captured > 30 * 86400000 ||
    new Set(manifest.artifacts.map((v) => v.name)).size !==
      manifest.artifacts.length ||
    manifest.artifacts.some((v) => actual[v.name] !== v.sha256) ||
    Object.keys(actual).length !== manifest.artifacts.length
  )
    throw new Error('Expired or inconsistent backup manifest');
  return manifest;
}
