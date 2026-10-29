import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { readdir, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { LocalFileStorage } from './local-storage.js';
const RecordSchema = z.strictObject({
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
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.root =
      config.ERASURE_CONTROL_ROOT ?? config.STORAGE_ROOT + '-erasure-control';
    this.storage = new LocalFileStorage({ ...config, STORAGE_ROOT: this.root });
  }
  async onModuleInit() {
    await this.storage.onModuleInit();
  }
  digest(kind: 'identity' | 'space', id: string) {
    return createHmac('sha256', this.config.BETTER_AUTH_SECRET)
      .update('erasure-' + kind + '-v1:' + id)
      .digest('hex');
  }
  private mac(data: string) {
    return createHmac('sha256', this.config.BETTER_AUTH_SECRET)
      .update('erasure-control-v1:' + data)
      .digest('hex');
  }
  async initialize() {
    await this.storage.onModuleInit();
    const bytes = Buffer.from(
      JSON.stringify({ version: 1, signature: this.mac('initialized-v1') }),
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
      bytes = Buffer.from(JSON.stringify({ body, signature: this.mac(body) }));
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
      .strictObject({ version: z.literal(1), signature: z.string() })
      .parse(
        JSON.parse(
          await readFile(path.join(this.root, genesis + '.blob'), 'utf8'),
        ),
      );
    if (!equalMarker(marker.signature, this.mac('initialized-v1')))
      throw new Error('Missing current erasure control checkpoint');
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
          body: z.string().max(3500),
          signature: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .parse(JSON.parse(await readFile(filename, 'utf8')));
      if (
        !timingSafeEqual(
          Buffer.from(envelope.signature, 'hex'),
          Buffer.from(this.mac(envelope.body), 'hex'),
        )
      )
        throw new Error('Invalid erasure control signature');
      const value = RecordSchema.parse(JSON.parse(envelope.body)),
        prior = latest.get(value.jobId);
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
function equalMarker(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
