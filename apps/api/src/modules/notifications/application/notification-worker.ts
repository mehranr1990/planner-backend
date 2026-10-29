import { Inject, Injectable } from '@nestjs/common';
import { JobsService } from '../../../platform/jobs/jobs.service.js';
import { NotificationsPort } from './notifications.port.js';
import { PrivacyGate } from '../../../platform/authorization/privacy-gate.js';
@Injectable()
export class NotificationWorker {
  constructor(
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(NotificationsPort) private readonly port: NotificationsPort,
    @Inject(PrivacyGate) private readonly privacy: PrivacyGate,
  ) {}
  start(additionalOutbox?: () => Promise<boolean>) {
    this.privacy.assert();
    return this.jobs.start({
      sweep: (after) => {
        this.privacy.assert();
        return this.port.sweep(after);
      },
      outbox: async () => {
        this.privacy.assert();
        const notification = await this.port.consumeOutbox();
        const additional = additionalOutbox ? await additionalOutbox() : false;
        return notification || additional;
      },
      delivery: (id) => {
        this.privacy.assert();
        return this.port.dispatch(id);
      },
      pending: () => {
        this.privacy.assert();
        return this.port.pending();
      },
    });
  }
  stop() {
    return this.jobs.stop();
  }
}
