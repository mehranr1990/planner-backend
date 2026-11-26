import { Inject, Injectable } from '@nestjs/common';
import { JobsService } from '../../../platform/jobs/jobs.service.js';
import { NotificationsPort } from './notifications.port.js';
import { PrivacyGate } from '../../../platform/authorization/privacy-gate.js';
import { ConfigurationRuntime } from '../../../platform/configuration/runtime.js';
@Injectable()
export class NotificationWorker {
  constructor(
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(NotificationsPort) private readonly port: NotificationsPort,
    @Inject(PrivacyGate) private readonly privacy: PrivacyGate,
    @Inject(ConfigurationRuntime)
    private readonly configuration: ConfigurationRuntime,
  ) {}
  start(additionalOutbox?: () => Promise<boolean>) {
    this.privacy.assert();
    return this.jobs.start({
      sweep: (after) => {
        this.privacy.assert();
        return this.configuration
          .worker('notifications', () => this.port.sweep(after))
          .then((result) => (result === false ? null : result));
      },
      outbox: async () => {
        this.privacy.assert();
        const notification = await this.configuration.worker(
          'notifications',
          () => this.port.consumeOutbox(),
        );
        const additional = additionalOutbox ? await additionalOutbox() : false;
        return notification || additional;
      },
      delivery: async (id) => {
        this.privacy.assert();
        await this.configuration.worker('notifications', () =>
          this.port.dispatch(id),
        );
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
