import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { QueueControl } from './queue-control.js';
import { SystemHealth } from './system-health.js';
import { BackupRuns } from './backup-runs.js';
@Injectable()
export class OperationsWorker {
  private busy = false;
  private revision = 0;
  private lastTick = 0;
  private readonly instanceId = randomUUID();
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(QueueControl) private readonly queues: QueueControl,
    @Inject(SystemHealth) private readonly health: SystemHealth,
    @Inject(BackupRuns) private readonly backups: BackupRuns,
  ) {}
  async tick() {
    if (this.busy || Date.now() - this.lastTick < 30000) return;
    this.busy = true;
    this.lastTick = Date.now();
    try {
      await this.db.client.adminOperationalHeartbeat.upsert({
        where: { name: 'worker' },
        create: { name: 'worker', instanceId: this.instanceId },
        update: { instanceId: this.instanceId, lastSeenAt: new Date() },
      });
      // Independent failures must not hide other dependency incidents.
      const subsystems = await Promise.allSettled([
        this.health.detect(),
        this.health.deliver(),
        this.backups.schedule(),
        this.backups.failExpiredLeases(),
      ]);
      if (subsystems.some((result) => result.status === 'rejected'))
        process.stderr.write(
          'Operational subsystem reconciliation incomplete; inspect protected health evidence.\n',
        );
      const policy =
        await this.db.client.adminOperationalPolicy.findUniqueOrThrow({
          where: { section: 'JOBS' },
        });
      if (policy.revision !== this.revision)
        this.revision = await this.queues.applyPolicy();
      await this.queues.expireResults();
      for (let n = 0; n < 25; n++)
        if (
          !(await this.queues.consume(async () => {
            await this.health.snapshot();
          }))
        )
          break;
    } finally {
      this.busy = false;
    }
  }
}
