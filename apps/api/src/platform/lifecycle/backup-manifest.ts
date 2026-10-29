import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
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
export function signBackup(secret: string, input: BackupManifest) {
  const manifest = Manifest.parse(input),
    body = JSON.stringify(manifest);
  return {
    manifest,
    signature: createHmac('sha256', secret)
      .update('personal-backup-v1:' + body)
      .digest('hex'),
  };
}
export function verifyBackup(
  secret: string,
  input: unknown,
  actual: Record<string, string>,
  now = new Date(),
) {
  const envelope = z
      .strictObject({
        manifest: Manifest,
        signature: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(input),
    expected = signBackup(secret, envelope.manifest).signature;
  if (
    !timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(envelope.signature, 'hex'),
    )
  )
    throw new Error('Invalid backup signature');
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
