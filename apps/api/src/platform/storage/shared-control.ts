import { Inject, Injectable, ForbiddenException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { LocalFileStorage } from './local-storage.js';

const controlRecord = z.strictObject({
  id: z.uuid(),
  spaceId: z.uuid(),
  version: z.string().regex(/^[1-9][0-9]*$/),
  action: z.string().regex(/^[a-z.]{1,80}$/),
  resourceId: z.uuid().nullable(),
  outcome: z.enum(['INTENT', 'COMMITTED', 'ABORTED']),
  at: z.iso.datetime(),
});
export type SharedControlRecord = z.infer<typeof controlRecord>;
const markerId = '00000000-0000-4000-8000-000000000031';
const keySchema = z.record(
  z.string().regex(/^[A-Za-z0-9._-]{1,40}$/),
  z.string().min(32),
);
/** Restrictive evidence is the sole permitted precommit filesystem effect. No business sends. */
@Injectable()
export class SharedControl {
  private readonly root: string;
  private readonly storage: LocalFileStorage;
  private readonly keys: Record<string, string>;
  private rootReady?: Promise<void>;
  private ready() {
    return (this.rootReady ??= this.storage.onModuleInit());
  }
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.root = path.resolve(
      config.SHARED_CONTROL_ROOT ?? config.STORAGE_ROOT + '-shared-control',
    );
    for (const other of [
      config.STORAGE_ROOT,
      config.ERASURE_CONTROL_ROOT ?? config.STORAGE_ROOT + '-erasure-control',
    ]) {
      const a = path.relative(path.resolve(other), this.root),
        b = path.relative(this.root, path.resolve(other));
      const outside = (relative: string) =>
        relative === '..' ||
        relative.startsWith('..' + path.sep) ||
        path.isAbsolute(relative);
      if (
        !a ||
        !b ||
        !outside(a) ||
        !outside(b) ||
        this.root === path.parse(this.root).root
      )
        throw new Error('Shared control requires an independent sibling root');
    }
    this.storage = new LocalFileStorage({ ...config, STORAGE_ROOT: this.root });
    try {
      this.keys = config.SHARED_CONTROL_KEYS
        ? keySchema.parse(JSON.parse(config.SHARED_CONTROL_KEYS))
        : {};
      if (Object.values(this.keys).includes(config.BETTER_AUTH_SECRET))
        throw new Error(
          'Shared control signing requires an independent secret',
        );
    } catch {
      throw new Error(
        'Invalid shared control key configuration (values withheld)',
      );
    }
  }
  private mac(body: string, keyId: string) {
    const key = this.keys[keyId];
    if (!key)
      throw new Error(
        'Unknown shared control key ID; retain referenced verification keys',
      );
    return createHmac('sha256', key)
      .update('shared-control-v1:' + body)
      .digest('hex');
  }
  opaqueRateKey(value: string) {
    const keyId = this.config.SHARED_CONTROL_ACTIVE_KEY_ID;
    if (!keyId)
      throw new ForbiddenException({ code: 'SHARED_CONTROL_UNAVAILABLE' });
    const key = this.keys[keyId];
    if (!key) throw new Error('Unknown shared control key ID');
    return createHmac('sha256', key)
      .update('shared-abuse-v1:' + value)
      .digest('hex');
  }
  signCursor(value: unknown) {
    const keyId = this.config.SHARED_CONTROL_ACTIVE_KEY_ID,
      key = keyId && this.keys[keyId];
    if (!keyId || !key)
      throw new ForbiddenException({ code: 'SHARED_CONTROL_UNAVAILABLE' });
    const body = JSON.stringify(value),
      signature = createHmac('sha256', key)
        .update('shared-cursor-v1:' + body)
        .digest('hex');
    return Buffer.from(JSON.stringify({ keyId, body, signature })).toString(
      'base64url',
    );
  }
  verifyCursor(token: string): unknown {
    if (token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token))
      throw new Error('Invalid shared cursor');
    const envelope = z
      .strictObject({
        keyId: z.string().min(1).max(40),
        body: z.string().max(1000),
        signature: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .parse(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')));
    const key = this.keys[envelope.keyId];
    if (!key) throw new Error('Unknown shared cursor key');
    const signature = createHmac('sha256', key)
      .update('shared-cursor-v1:' + envelope.body)
      .digest();
    if (!timingSafeEqual(signature, Buffer.from(envelope.signature, 'hex')))
      throw new Error('Invalid shared cursor');
    return JSON.parse(envelope.body);
  }
  private async write(id: string, body: string) {
    await this.ready();
    const keyId = this.config.SHARED_CONTROL_ACTIVE_KEY_ID;
    if (!keyId)
      throw new ForbiddenException({ code: 'SHARED_CONTROL_UNAVAILABLE' });
    const bytes = Buffer.from(
      JSON.stringify({
        version: 1,
        keyId,
        body,
        signature: this.mac(body, keyId),
      }),
    );
    await this.storage.write(
      id,
      randomUUID(),
      Readable.from(bytes),
      { size: bytes.length, mimeType: 'application/json' },
      new AbortController().signal,
    );
  }
  /** Explicit operator provisioning; never called automatically by API/worker startup. */
  async initialize() {
    await this.ready();
    await this.write(markerId, 'initialized-shared-control-v1');
  }
  async append(record: SharedControlRecord) {
    await this.write(randomUUID(), JSON.stringify(controlRecord.parse(record)));
  }
  async records() {
    await this.ready();
    await this.storage.inventory();
    const names = await readdir(this.root);
    if (names.length > 100000) throw new Error('Shared control bound exceeded');
    let marker = false;
    const records: SharedControlRecord[] = [];
    for (const name of names) {
      if (name.endsWith('.part')) continue;
      if (!/^[a-f0-9-]{36}\.blob$/i.test(name))
        throw new Error('Unknown shared control artifact');
      const file = path.join(this.root, name),
        stat = await lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > 4096
      )
        throw new Error('Invalid shared control artifact');
      const envelope = z
        .strictObject({
          version: z.literal(1),
          keyId: z.string(),
          body: z.string().max(3000),
          signature: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .parse(JSON.parse(await readFile(file, 'utf8')));
      if (
        !timingSafeEqual(
          Buffer.from(envelope.signature, 'hex'),
          Buffer.from(this.mac(envelope.body, envelope.keyId), 'hex'),
        )
      )
        throw new Error('Invalid shared control signature');
      if (name === markerId + '.blob') {
        if (envelope.body !== 'initialized-shared-control-v1')
          throw new Error('Invalid shared checkpoint');
        marker = true;
      } else records.push(controlRecord.parse(JSON.parse(envelope.body)));
    }
    if (!marker) throw new Error('Missing current shared checkpoint');
    const identities = new Map<string, SharedControlRecord>();
    const terminal = new Map<string, string>();
    for (const record of records) {
      const previous = identities.get(record.id);
      if (
        previous &&
        (previous.spaceId !== record.spaceId ||
          previous.version !== record.version ||
          previous.action !== record.action ||
          previous.resourceId !== record.resourceId)
      )
        throw new Error('Conflicting shared control identity');
      identities.set(record.id, record);
      if (record.outcome !== 'INTENT') {
        if (
          terminal.has(record.id) &&
          terminal.get(record.id) !== record.outcome
        )
          throw new Error('Conflicting shared control outcome');
        terminal.set(record.id, record.outcome);
      }
    }
    return records;
  }
  async assertCurrent(spaceId: string, version: bigint) {
    const records = (await this.records()).filter((r) => r.spaceId === spaceId);
    const outcomes = new Map(
      records
        .filter((r) => r.outcome !== 'INTENT')
        .map((r) => [r.id, r.outcome]),
    );
    for (const r of records) {
      if (r.outcome === 'ABORTED' || outcomes.get(r.id) === 'ABORTED') continue;
      if (BigInt(r.version) > version)
        throw new ForbiddenException({
          code: 'SHARED_RESTORE_REPLAY_REQUIRED',
        });
    }
    // An intent at or behind the DB version still requires a terminal outcome.
    for (const r of records)
      if (r.outcome === 'INTENT' && !outcomes.has(r.id))
        throw new ForbiddenException({
          code: 'SHARED_CONTROL_RECONCILIATION_REQUIRED',
        });
  }
}
