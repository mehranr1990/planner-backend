import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import type { FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { PinoLogger } from 'nestjs-pino';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { LocalFileStorage } from './local-storage.js';
import { MALWARE_SCANNER } from './malware-scanner.port.js';
import type { MalwareScannerPort } from './malware-scanner.port.js';
import { StorageFailure } from './storage.port.js';

/** ADR 0068: without a configured malware scanner no file has a trusted
 * verdict, so business bytes and file references are refused up front. */
export function assertFileContentAvailable(config: AppConfig): void {
  if (config.MALWARE_SCANNER !== 'clamav')
    throw new ForbiddenException({ code: 'UNSCANNED_FILES_BLOCKED' });
}

/** Business bytes only. Independently signed control stores retain their own IO. */
@Injectable()
export class BusinessFileStorage extends LocalFileStorage {
  protected override readonly inspectsContent = true;
  constructor(
    @Inject(APP_CONFIG) private readonly contentConfig: AppConfig,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScannerPort,
    @Optional()
    @Inject(PinoLogger)
    private readonly logger?: PinoLogger,
  ) {
    super(contentConfig);
  }
  override async write(...args: Parameters<LocalFileStorage['write']>) {
    assertFileContentAvailable(this.contentConfig);
    return super.write(...args);
  }
  override async open(...args: Parameters<LocalFileStorage['open']>) {
    assertFileContentAvailable(this.contentConfig);
    return super.open(...args);
  }
  protected override async inspect(
    handle: FileHandle,
    size: number,
    signal?: AbortSignal,
  ) {
    // Positional reads: a FileHandle stream would close the caller's handle.
    const content = Readable.from(
      (async function* () {
        for (let at = 0; at < size;) {
          const { bytesRead, buffer } = await handle.read(
            Buffer.alloc(Math.min(65536, size - at)),
            0,
            Math.min(65536, size - at),
            at,
          );
          if (!bytesRead) throw new StorageFailure('UNAVAILABLE');
          at += bytesRead;
          yield buffer.subarray(0, bytesRead);
        }
      })(),
      { objectMode: false },
    );
    let result;
    try {
      result = await this.scanner.scan(content, size, signal);
    } finally {
      content.destroy();
    }
    if (result.verdict === 'CLEAN') return result.engine;
    // Metadata only: never file bytes, names, keys or paths.
    this.logger?.warn(
      {
        verdict: result.verdict,
        ...(result.verdict === 'INFECTED'
          ? { signature: result.signature }
          : {}),
      },
      'Business file content refused by malware scan',
    );
    throw new StorageFailure(
      result.verdict === 'INFECTED'
        ? 'INVALID'
        : result.verdict === 'LIMIT'
          ? 'LIMIT'
          : 'UNAVAILABLE',
    );
  }
}
