import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { LocalFileStorage } from './local-storage.js';
import { PersonalEvidenceKeys } from '../lifecycle/personal-evidence-keys.js';
const RecordSchema = z.strictObject({
  digestKeyId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,40}$/)
    .nullable()
    .optional(),
  jobId: z.uuid(),
  identityDigest: z.string().regex(/^[a-f0-9]{64}$/),
  spaceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['CLOSED', 'CANCELED', 'ERASING', 'ERASED']),
  at: z.iso.datetime(),
  eraseAfter: z.iso.datetime(),
  policyVersion: z.string().max(80),
  recoveryHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
const genesis = '00000000-0000-4000-8000-000000000012';
export type ErasureRecord = z.infer<typeof RecordSchema>;
/** Independent append-only, signed control namespace. Never included in planner restores. */
@Injectable()
export class ErasureControl implements OnModuleInit {
  private readonly storage: LocalFileStorage;
  private readonly root: string;
  readonly keys: PersonalEvidenceKeys;
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.keys = new PersonalEvidenceKeys(config);
    this.root =
      config.ERASURE_CONTROL_ROOT ?? config.STORAGE_ROOT + '-erasure-control';
    this.storage = new LocalFileStorage({ ...config, STORAGE_ROOT: this.root });
  }
  async onModuleInit() {
    await this.storage.onModuleInit();
  }
  digest(kind: 'identity' | 'space', id: string) {
    return this.keys.digest(kind, id);
  }
  matchesDigest(kind: 'identity' | 'space', id: string, digest: string) {
    return this.keys.digests(kind, id).includes(digest);
  }
  digests(kind: 'identity' | 'space', id: string) {
    return this.keys.digests(kind, id);
  }
  async initialize() {
    await this.storage.onModuleInit();
    const bytes = Buffer.from(
      JSON.stringify(
        this.keys.sign('control', 'initialized-v1', 'erasure-control-v1:'),
      ),
    );
    await this.storage.write(
      genesis,
      randomUUID(),
      Readable.from(bytes),
      { size: bytes.length, mimeType: 'application/json' },
      new AbortController().signal,
    );
  }
  async append(value: ErasureRecord) {
    const body = JSON.stringify(RecordSchema.parse(value)),
      bytes = Buffer.from(
        JSON.stringify({
          body,
          ...this.keys.sign('control', body, 'erasure-control-v1:'),
        }),
      );
    await this.storage.write(
      randomUUID(),
      randomUUID(),
      Readable.from(bytes),
      { size: bytes.length, mimeType: 'application/json' },
      new AbortController().signal,
    );
  }
  async records() {
    const names = await readdir(this.root);
    if (names.length > 100000)
      throw new Error('Erasure control bound exceeded');
    const marker = z
      .strictObject({
        version: z.union([z.literal(1), z.literal(2)]),
        keyId: z.string().optional(),
        signature: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(
        JSON.parse(
          await readFile(path.join(this.root, genesis + '.blob'), 'utf8'),
        ),
      );
    this.keys.verify(
      'control',
      'initialized-v1',
      marker,
      'erasure-control-v1:',
    );
    const latest = new Map<string, ErasureRecord>();
    for (const name of names) {
      if (name.endsWith('.part') || name === genesis + '.blob') continue;
      if (!/^[a-f0-9-]{36}\.blob$/i.test(name))
        throw new Error('Unknown erasure control artifact');
      const filename = path.join(this.root, name),
        stat = await lstat(filename);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > 4096
      )
        throw new Error('Invalid erasure control artifact');
      const envelope = z
        .strictObject({
          version: z.union([z.literal(1), z.literal(2)]).optional(),
          keyId: z.string().optional(),
          body: z.string().max(3500),
          signature: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .parse(JSON.parse(await readFile(filename, 'utf8')));
      this.keys.verify(
        'control',
        envelope.body,
        envelope,
        'erasure-control-v1:',
      );
      const value = RecordSchema.parse(JSON.parse(envelope.body)),
        prior = latest.get(value.jobId);
      this.keys.requireDigestKey(value.digestKeyId);
      if (!prior || value.at > prior.at) latest.set(value.jobId, value);
    }
    return [...latest.values()];
  }
  checkpoint(records: ErasureRecord[]) {
    return createHash('sha256')
      .update(
        JSON.stringify(
          records.toSorted((a, b) => a.jobId.localeCompare(b.jobId)),
        ),
      )
      .digest('hex');
  }
  async prune(now = new Date()) {
    const records = await this.records(),
      expired = new Set(
        records
          .filter(
            (v) =>
              ['CANCELED', 'ERASED'].includes(v.state) &&
              new Date(v.at).getTime() < now.getTime() - 90 * 86400000,
          )
          .map((v) => v.jobId),
      );
    if (!expired.size) return [];
    for (const name of await readdir(this.root)) {
      if (name === genesis + '.blob' || !name.endsWith('.blob')) continue;
      const envelope = JSON.parse(
        await readFile(path.join(this.root, name), 'utf8'),
      ) as { body: string };
      const value = RecordSchema.parse(JSON.parse(envelope.body));
      if (expired.has(value.jobId))
        await this.storage.remove(name.slice(0, -5));
    }
    return [...expired];
  }
}
