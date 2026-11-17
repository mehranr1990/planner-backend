import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { LocalFileStorage } from './local-storage.js';

/** Temporary ADR 0057: no file has a trusted scan verdict in local test mode. */
export function assertFileContentAvailable(config: AppConfig): void {
  if (config.SHARED_LOCAL_DEVELOPMENT_TEST_MODE)
    throw new ForbiddenException({ code: 'UNSCANNED_FILES_BLOCKED' });
}

/** Business bytes only. Independently signed control stores retain their own IO. */
@Injectable()
export class BusinessFileStorage extends LocalFileStorage {
  constructor(@Inject(APP_CONFIG) private readonly contentConfig: AppConfig) {
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
}
