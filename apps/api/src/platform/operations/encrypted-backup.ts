import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { verifyBackup } from '../lifecycle/backup-manifest.js';
import type { PersonalEvidenceKeys } from '../lifecycle/personal-evidence-keys.js';

const names = [
  'planner.dump',
  'files.tar.gz',
  'control.tar.gz',
  'manifest.json',
] as const;
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const EncryptedBackupBundleSchema = z.strictObject({
  version: z.literal(1),
  runId: z.uuid(),
  capturedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  manifestDigest: Hash,
  artifacts: z
    .array(
      z.strictObject({
        name: z.enum(names),
        sha256: Hash,
        encryptedSha256: Hash,
        iv: z.string().regex(/^[a-f0-9]{24}$/),
        tag: z.string().regex(/^[a-f0-9]{32}$/),
      }),
    )
    .length(4),
});
export type EncryptedBackupBundle = z.infer<typeof EncryptedBackupBundleSchema>;
async function directory(root: string, create: boolean) {
  const absolute = path.resolve(root);
  if (create) await mkdir(absolute, { recursive: true, mode: 0o700 });
  for (let current = absolute; ; current = path.dirname(current)) {
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Unsafe backup directory');
    if (path.dirname(current) === current) break;
  }
  return realpath(absolute);
}
async function regular(file: string) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw new Error('Unsafe backup artifact');
  return stat;
}
export async function artifactHash(file: string) {
  await regular(file);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function signedBundle(root: string, keys: PersonalEvidenceKeys) {
  const file = path.join(await directory(root, false), 'bundle.json');
  if ((await regular(file)).size > 16384)
    throw new Error('Backup bundle bound');
  const envelope = z
    .strictObject({
      body: z.string().max(12000),
      version: z.union([z.literal(1), z.literal(2)]),
      keyId: z.string().optional(),
      signature: Hash,
    })
    .parse(JSON.parse(await readFile(file, 'utf8')));
  keys.verify('backup', envelope.body, envelope, 'operational-backup-v1:');
  const bundle = EncryptedBackupBundleSchema.parse(JSON.parse(envelope.body));
  if (
    new Set(bundle.artifacts.map((v) => v.name)).size !== names.length ||
    Date.parse(bundle.expiresAt) <= Date.now() ||
    Date.parse(bundle.capturedAt) > Date.now() ||
    Date.parse(bundle.expiresAt) - Date.parse(bundle.capturedAt) > 30 * 86400000
  )
    throw new Error('Expired or invalid encrypted bundle');
  return bundle;
}
/** Local operator primitive. AES-256-GCM keys never enter database or manifests. */
export async function encryptBackup(input: {
  runId: string;
  source: string;
  destination: string;
  key: Buffer;
  keys: PersonalEvidenceKeys;
  expiresNoLaterThan: Date;
}) {
  if (input.key.length !== 32)
    throw new Error('Backup encryption requires a 256-bit key');
  const source = await directory(input.source, false),
    destination = await directory(input.destination, true);
  if (
    source === destination ||
    destination.startsWith(source + path.sep) ||
    source.startsWith(destination + path.sep)
  )
    throw new Error('Backup roots overlap');
  const actual: Record<string, string> = {};
  for (const name of names)
    actual[name] = await artifactHash(path.join(source, name));
  if ((await regular(path.join(source, 'manifest.json'))).size > 16384)
    throw new Error('Manifest bound');
  const envelope = JSON.parse(
    await readFile(path.join(source, 'manifest.json'), 'utf8'),
  ) as { manifest: { artifacts: { name: string }[] } };
  const signedActual: Record<string, string> = {};
  for (const a of envelope.manifest.artifacts) {
    if (!actual[a.name]) throw new Error('Unexpected signed backup artifact');
    signedActual[a.name] = actual[a.name]!;
  }
  const manifest = verifyBackup(input.keys, envelope, signedActual);
  if (
    !manifest.artifacts.some((a) => a.name === 'planner.dump') ||
    !manifest.artifacts.some((a) => a.name === 'files.tar.gz') ||
    +input.expiresNoLaterThan <= Date.now()
  )
    throw new Error('Backup does not match frozen request retention');
  const artifacts: EncryptedBackupBundle['artifacts'] = [];
  for (const name of names) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', input.key, iv);
    cipher.setAAD(Buffer.from(input.runId + ':' + name));
    await pipeline(
      createReadStream(path.join(source, name)),
      cipher,
      createWriteStream(path.join(destination, name + '.enc'), {
        flags: 'wx',
        mode: 0o600,
      }),
    );
    artifacts.push({
      name,
      sha256: actual[name]!,
      encryptedSha256: await artifactHash(
        path.join(destination, name + '.enc'),
      ),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
    });
  }
  const bundle = EncryptedBackupBundleSchema.parse({
      version: 1,
      runId: input.runId,
      capturedAt: manifest.capturedAt,
      expiresAt: new Date(
        Math.min(Date.parse(manifest.expiresAt), +input.expiresNoLaterThan),
      ).toISOString(),
      manifestDigest: actual['manifest.json'],
      artifacts,
    }),
    body = JSON.stringify(bundle);
  await writeFile(
    path.join(destination, 'bundle.json'),
    JSON.stringify({
      body,
      ...input.keys.sign('backup', body, 'operational-backup-v1:'),
    }),
    { flag: 'wx', mode: 0o600 },
  );
  await verifyEncryptedBackup(destination, input.key, input.keys);
  return bundle;
}
export async function verifyEncryptedBackup(
  root: string,
  key: Buffer,
  keys: PersonalEvidenceKeys,
) {
  if (key.length !== 32) throw new Error('Invalid backup key');
  const absolute = await directory(root, false),
    bundle = await signedBundle(absolute, keys);
  for (const artifact of bundle.artifacts) {
    const file = path.join(absolute, artifact.name + '.enc');
    if ((await artifactHash(file)) !== artifact.encryptedSha256)
      throw new Error('Encrypted artifact checksum mismatch');
    const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(artifact.iv, 'hex'),
      ),
      hash = createHash('sha256');
    decipher.setAAD(Buffer.from(bundle.runId + ':' + artifact.name));
    decipher.setAuthTag(Buffer.from(artifact.tag, 'hex'));
    await pipeline(
      createReadStream(file),
      decipher,
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          callback();
        },
      }),
    );
    if (hash.digest('hex') !== artifact.sha256)
      throw new Error('Decrypted artifact checksum mismatch');
  }
  return bundle;
}
export async function copyEncryptedBackup(
  source: string,
  destination: string,
  key: Buffer,
  keys: PersonalEvidenceKeys,
) {
  const from = await directory(source, false),
    to = await directory(destination, true);
  if (
    from === to ||
    to.startsWith(from + path.sep) ||
    from.startsWith(to + path.sep)
  )
    throw new Error('Off-host copy must use a distinct provisioned root');
  const bundle = await verifyEncryptedBackup(from, key, keys);
  for (const name of [...names.map((n) => n + '.enc'), 'bundle.json']) {
    const origin = path.join(from, name),
      target = path.join(to, name);
    await regular(origin);
    await copyFile(origin, target, 1); // COPYFILE_EXCL: never overwrite evidence.
    if ((await artifactHash(origin)) !== (await artifactHash(target)))
      throw new Error('Off-host copy verification failed');
  }
  await verifyEncryptedBackup(to, key, keys);
  return bundle;
}
export async function decryptBackup(
  root: string,
  destination: string,
  key: Buffer,
  keys: PersonalEvidenceKeys,
) {
  const bundle = await verifyEncryptedBackup(root, key, keys),
    target = await directory(destination, true),
    source = await directory(root, false);
  if (
    target === source ||
    target.startsWith(source + path.sep) ||
    source.startsWith(target + path.sep)
  )
    throw new Error('Restore roots overlap');
  for (const artifact of bundle.artifacts) {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(artifact.iv, 'hex'),
    );
    decipher.setAAD(Buffer.from(bundle.runId + ':' + artifact.name));
    decipher.setAuthTag(Buffer.from(artifact.tag, 'hex'));
    await pipeline(
      createReadStream(path.join(source, artifact.name + '.enc')),
      decipher,
      createWriteStream(path.join(target, artifact.name), {
        flags: 'wx',
        mode: 0o600,
      }),
    );
  }
  return bundle;
}
