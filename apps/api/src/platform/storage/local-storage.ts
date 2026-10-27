import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, lstat, realpath, open, link, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { StorageFailure } from './storage.port.js';
import type {
  StoragePort,
  FileExpectation,
  FileEvidence,
} from './storage.port.js';
import { validContent } from './content-policy.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = (error: unknown): StorageFailure =>
  error instanceof StorageFailure ? error : new StorageFailure('UNAVAILABLE');

@Injectable()
export class LocalFileStorage implements StoragePort, OnModuleInit {
  private readonly root: string;
  private canonical = '';
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.root = path.resolve(config.STORAGE_ROOT);
  }

  async onModuleInit(): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      for (let current = this.root; ; current = path.dirname(current)) {
        if ((await lstat(current)).isSymbolicLink())
          throw new StorageFailure('UNAVAILABLE');
        if (path.dirname(current) === current) break;
      }
      this.canonical = await realpath(this.root);
      await this.checkRoot();
    } catch {
      throw new Error(
        'Private storage initialization failed; verify directory ownership and permissions.',
      );
    }
  }
  private async checkRoot() {
    const status = await lstat(this.root);
    if (
      !status.isDirectory() ||
      status.isSymbolicLink() ||
      (await realpath(this.root)) !== this.canonical
    )
      throw new StorageFailure('UNAVAILABLE');
  }
  private location(key: string, attempt?: string) {
    if (!uuid.test(key) || (attempt !== undefined && !uuid.test(attempt)))
      throw new StorageFailure('UNAVAILABLE');
    return path.join(
      this.root,
      attempt ? `${key}.${attempt}.part` : `${key}.blob`,
    );
  }
  private async syncDirectory() {
    // Node does not expose a portable directory fsync on Windows. Deployment is
    // Linux, where directory entries must reach disk before marking bytes READY.
    if (process.platform === 'win32') return;
    const directory = await open(this.root, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  private async removeOne(filename: string) {
    try {
      const status = await lstat(filename);
      if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1)
        throw new StorageFailure('UNAVAILABLE');
      await unlink(filename);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return;
      throw error;
    }
  }
  async write(
    key: string,
    attempt: string,
    source: Readable,
    expected: FileExpectation,
    signal: AbortSignal,
  ): Promise<FileEvidence> {
    let handle: FileHandle | undefined;
    const temporary = this.location(key, attempt);
    const abort = () => {
      source.destroy();
    };
    let published = false;
    try {
      await this.checkRoot();
      if (signal.aborted) throw new StorageFailure('INVALID');
      signal.addEventListener('abort', abort, { once: true });
      handle = await open(temporary, 'wx', 0o600);
      const hash = createHash('sha256');
      let size = 0;
      let head = Buffer.alloc(0);
      let tail = Buffer.alloc(0);
      const decoder = new TextDecoder('utf-8', { fatal: true });
      for await (const value of source.iterator({ destroyOnReturn: false })) {
        if (signal.aborted) throw new StorageFailure('INVALID');
        const chunk = Buffer.isBuffer(value)
          ? value
          : Buffer.from(value as Uint8Array);
        size += chunk.length;
        if (size > expected.size || size > this.config.FILE_MAX_BYTES)
          throw new StorageFailure('LIMIT');
        if (head.length < 512)
          head = Buffer.concat([head, chunk.subarray(0, 512 - head.length)]);
        tail = Buffer.concat([tail, chunk]).subarray(-1024);
        if (expected.mimeType === 'text/plain') {
          let text: string;
          try {
            text = decoder.decode(chunk, { stream: true });
          } catch {
            throw new StorageFailure('INVALID');
          }
          if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))
            throw new StorageFailure('INVALID');
        }
        hash.update(chunk);
        await handle.writeFile(chunk);
      }
      if (signal.aborted) throw new StorageFailure('INVALID');
      if (expected.mimeType === 'text/plain') {
        try {
          decoder.decode();
        } catch {
          throw new StorageFailure('INVALID');
        }
      }
      const sha256 = hash.digest('hex');
      if (
        size !== expected.size ||
        !validContent(expected.mimeType, head, tail) ||
        (expected.sha256 && expected.sha256 !== sha256)
      )
        throw new StorageFailure('INVALID');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.checkRoot();
      // Same-volume hard-link publication is atomic and refuses overwriting an existing blob.
      await link(temporary, this.location(key));
      published = true;
      await unlink(temporary);
      await this.syncDirectory();
      return { size, sha256 };
    } catch (error) {
      if (published) await this.remove(key, attempt).catch(() => undefined);
      throw signal.aborted ? new StorageFailure('INVALID') : unavailable(error);
    } finally {
      signal.removeEventListener('abort', abort);
      await handle?.close().catch(() => undefined);
      await this.removeOne(temporary).catch(() => undefined);
    }
  }
  async open(key: string, expected: FileEvidence): Promise<Readable> {
    let handle: FileHandle | undefined;
    try {
      await this.checkRoot();
      const filename = this.location(key);
      const before = await lstat(filename);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
        throw new StorageFailure('UNAVAILABLE');
      handle = await open(filename, 'r');
      const status = await handle.stat();
      if (
        !status.isFile() ||
        status.ino !== before.ino ||
        status.dev !== before.dev ||
        status.size !== expected.size ||
        status.nlink !== 1
      )
        throw new StorageFailure('UNAVAILABLE');
      const buffer = Buffer.alloc(65536);
      const hash = createHash('sha256');
      for (let position = 0; position < expected.size;) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, expected.size - position),
          position,
        );
        if (!bytesRead) throw new StorageFailure('UNAVAILABLE');
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      if (hash.digest('hex') !== expected.sha256)
        throw new StorageFailure('UNAVAILABLE');
      const stream = handle.createReadStream({ start: 0, autoClose: true });
      handle = undefined;
      return stream;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      throw unavailable(error);
    }
  }
  async remove(key: string, attempt?: string | null): Promise<void> {
    try {
      await this.checkRoot();
      if (attempt) {
        // Recover a crash between atomic link publication and removal of its staging name.
        try {
          const final = await lstat(this.location(key));
          const temporary = await lstat(this.location(key, attempt));
          if (
            final.isFile() &&
            temporary.isFile() &&
            !final.isSymbolicLink() &&
            !temporary.isSymbolicLink() &&
            final.ino === temporary.ino &&
            final.dev === temporary.dev &&
            final.nlink === 2 &&
            temporary.nlink === 2
          )
            await unlink(this.location(key, attempt));
        } catch (error) {
          if (!(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          ))
            throw error;
        }
      }
      await this.removeOne(this.location(key));
      if (attempt) await this.removeOne(this.location(key, attempt));
      await this.syncDirectory();
    } catch (error) {
      throw unavailable(error);
    }
  }
}
