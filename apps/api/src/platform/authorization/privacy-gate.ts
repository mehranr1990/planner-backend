import { Injectable, ForbiddenException } from '@nestjs/common';
@Injectable()
export class PrivacyGate {
  private ready = true;
  quarantine() {
    this.ready = false;
  }
  release() {
    this.ready = true;
  }
  assert() {
    if (!this.ready)
      throw new ForbiddenException({ code: 'RESTORE_REPLAY_REQUIRED' });
  }
}
