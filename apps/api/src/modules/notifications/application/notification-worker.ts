import { Inject, Injectable } from '@nestjs/common';
import { JobsService } from '../../../platform/jobs/jobs.service.js';
import { NotificationsPort } from './notifications.port.js';
@Injectable()
export class NotificationWorker {
  constructor(
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(NotificationsPort) private readonly port: NotificationsPort,
  ) {}
  start(additionalOutbox?: () => Promise<boolean>) {
    return this.jobs.start({
      sweep: (after) => this.port.sweep(after),
      outbox: async () => {
        const notification = await this.port.consumeOutbox();
        const additional = additionalOutbox ? await additionalOutbox() : false;
        return notification || additional;
      },
      delivery: (id) => this.port.dispatch(id),
      pending: () => this.port.pending(),
    });
  }
  stop() {
    return this.jobs.stop();
  }
}
