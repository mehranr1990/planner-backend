import { Inject, Injectable, ForbiddenException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { LocalFileStorage } from './local-storage.js';
import { SharedReplaySchema } from '../lifecycle/shared-replay.js';
import type { SharedReplay } from '../lifecycle/shared-replay.js';
const floorSchema = z.strictObject({
  kind: z.literal('FLOOR'),
  before: z.iso.datetime(),
});

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
  private readonly verified = new Map<
    string,
    {
      stamp: string;
      envelope: { version: 1; keyId: string; body: string; signature: string };
      bytes: number;
    }
  >();
  private verifiedBytes = 0;
  private async readEnvelope(name: string) {
    const file = path.join(this.root, name),
      stat = await lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size > 65536
    )
      throw new Error('Invalid shared control artifact');
    const stamp = [
      stat.dev,
      stat.ino,
      stat.size,
      stat.mtimeMs,
      stat.ctimeMs,
      stat.birthtimeMs,
    ].join(':');
    const prior = this.verified.get(name);
    if (prior?.stamp === stamp) return prior.envelope;
    const envelope = z
      .strictObject({
        version: z.literal(1),
        keyId: z.string(),
        body: z.string().max(60000),
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
    const replaced = this.verified.get(name);
    if (replaced) this.verifiedBytes -= replaced.bytes;
    this.verified.delete(name);
    this.verified.set(name, { stamp, envelope, bytes: stat.size });
    this.verifiedBytes += stat.size;
    while (this.verifiedBytes > 16 * 1024 * 1024) {
      const oldest = this.verified.keys().next().value!;
      this.verifiedBytes -= this.verified.get(oldest)!.bytes;
      this.verified.delete(oldest);
    }
    return envelope;
  }
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
  private async entries() {
    await this.ready();
    await this.storage.checkRoot();
    const names = await readdir(this.root);
    if (names.length > 100000) throw new Error('Shared control bound exceeded');
    let marker = false;
    const records: SharedControlRecord[] = [];
    const replays: SharedReplay[] = [];
    const floors: (z.infer<typeof floorSchema> & { key: string })[] = [];
    const files: { key: string; spaceId: string }[] = [];
    const temporary: string[] = [];
    const published = names.filter((name) => {
      if (
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.part$/i.test(
          name,
        )
      ) {
        temporary.push(name);
        return false;
      }
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.blob$/i.test(
          name,
        )
      )
        throw new Error('Unknown shared control artifact');
      return true;
    });
    for (const name of temporary) {
      try {
        const stat = await lstat(path.join(this.root, name));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
          throw new Error('Invalid shared staging artifact');
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        )
          throw error;
      }
    }
    const present = new Set(published);
    for (const [name, value] of this.verified)
      if (!present.has(name)) {
        this.verifiedBytes -= value.bytes;
        this.verified.delete(name);
      }
    const envelopes = [];
    for (let at = 0; at < published.length; at += 32)
      envelopes.push(
        ...(await Promise.all(
          published.slice(at, at + 32).map(async (name) => ({
            name,
            envelope: await this.readEnvelope(name),
          })),
        )),
      );
    for (const { name, envelope } of envelopes) {
      if (name === markerId + '.blob') {
        if (envelope.body !== 'initialized-shared-control-v1')
          throw new Error('Invalid shared checkpoint');
        marker = true;
      } else {
        const body = JSON.parse(envelope.body) as { kind?: string };
        if (body.kind === 'REPLAY') {
          const r = SharedReplaySchema.parse(body);
          replays.push(r);
          files.push({ key: name.slice(0, -5), spaceId: r.spaceId });
        } else if (body.kind === 'FLOOR')
          floors.push({ ...floorSchema.parse(body), key: name.slice(0, -5) });
        else {
          const r = controlRecord.parse(body);
          records.push(r);
          files.push({ key: name.slice(0, -5), spaceId: r.spaceId });
        }
      }
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
    return { records, replays, floors, files };
  }
  async records() {
    return (await this.entries()).records;
  }
  async currentEvidence() {
    const view = await this.entries();
    return {
      records: view.records,
      floor: view.floors.reduce(
        (latest, f) => (f.before > latest ? f.before : latest),
        '1970-01-01T00:00:00.000Z',
      ),
    };
  }
  async replayEvidence() {
    return (await this.entries()).replays;
  }
  async appendReplay(value: SharedReplay) {
    const body = JSON.stringify(SharedReplaySchema.parse(value));
    if (Buffer.byteLength(body) > 60000)
      throw new Error('Shared replay evidence exceeds safe envelope');
    await this.write(randomUUID(), body);
  }
  async restoreFloor() {
    return (await this.entries()).floors.reduce(
      (latest, f) => (f.before > latest ? f.before : latest),
      '1970-01-01T00:00:00.000Z',
    );
  }
  async advanceRestoreFloor(before: Date, approvalReference: string) {
    if (
      !Number.isFinite(before.getTime()) ||
      before.getTime() > Date.now() - 30 * 86400000
    )
      throw new Error('Backup expiry horizon has not elapsed');
    if (!approvalReference.trim() || approvalReference.length > 200)
      throw new Error('Disposal approval reference required');
    if (before.toISOString() <= (await this.restoreFloor())) return;
    await this.write(
      randomUUID(),
      JSON.stringify(
        floorSchema.parse({
          kind: 'FLOOR',
          before: before.toISOString(),
        }),
      ),
    );
    const floors = (await this.entries()).floors.toSorted(
      (a, b) => a.before.localeCompare(b.before) || a.key.localeCompare(b.key),
    );
    for (const old of floors.slice(0, -1).slice(0, 25))
      await this.storage.remove(old.key);
  }

  async disposeEvidence(spaceId: string) {
    const rows = (await this.entries()).files
      .filter((f) => f.spaceId === spaceId)
      .slice(0, 25);
    for (const f of rows) await this.storage.remove(f.key);
    return rows.length;
  }
  async assertCurrent(
    spaceId: string,
    version: bigint,
    current?: SharedControlRecord[],
  ) {
    const records = (current ?? (await this.records())).filter(
      (r) => r.spaceId === spaceId,
    );
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
