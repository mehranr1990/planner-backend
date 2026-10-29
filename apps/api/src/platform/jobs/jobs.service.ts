import { Inject, Injectable } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { Pool } from 'pg';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { queues, verifyJobSchema } from './schema.js';
/** Lazy: importing the API module does not open a queue connection or perform DDL. */
@Injectable()
export class JobsService {
  private boss: PgBoss | undefined;
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  async start(handlers: {
    sweep: (after?: string) => Promise<string | null>;
    outbox: () => Promise<boolean>;
    delivery: (id: string) => Promise<void>;
    pending: () => Promise<Array<{ id: string; at: Date }>>;
  }) {
    if (this.boss) throw new Error('WORKER_ALREADY_STARTED');
    const pool = new Pool({
      connectionString: this.config.DATABASE_URL,
      max: 1,
    });
    try {
      await verifyJobSchema(pool, this.config.JOBS_SCHEMA);
    } finally {
      await pool.end();
    }
    const boss = new PgBoss({
      connectionString: this.config.DATABASE_URL,
      schema: this.config.JOBS_SCHEMA,
      migrate: false,
      createSchema: false,
      openTelemetry: { enabled: false },
      persistQueueStats: false,
      reindex: false,
      application_name: 'planner-worker',
    });
    boss.on('error', () =>
      process.stderr.write(
        'Worker queue error; inspect readiness and database health.\n',
      ),
    );
    this.boss = boss;
    try {
      await boss.start();
      for (const q of Object.values(queues))
        if (!(await boss.getQueue(q))) throw new Error('QUEUE_SETUP_REQUIRED');
      const safe = async (work: () => Promise<void>) => {
        try {
          await work();
        } catch {
          throw new Error('NOTIFICATION_JOB_FAILED');
        }
      };
      await boss.work<{ after?: string }>(
        queues.sweep,
        { batchSize: 1, pollingIntervalSeconds: this.config.JOBS_POLL_SECONDS },
        async (jobs) =>
          safe(async () => {
            for (const job of jobs) {
              const next = await handlers.sweep(job.data.after);
              if (next) await boss.send(queues.sweep, { after: next });
              for (const d of await handlers.pending())
                await boss.upsert(
                  queues.delivery,
                  { id: d.id },
                  { singletonKey: d.id, startAfter: d.at },
                );
              await boss.send(queues.outbox, {}, { singletonKey: 'consumer' });
            }
          }),
      );
      await boss.work(
        queues.outbox,
        { batchSize: 1, pollingIntervalSeconds: this.config.JOBS_POLL_SECONDS },
        async () =>
          safe(async () => {
            for (let n = 0; n < 100; n++)
              if (!(await handlers.outbox())) return;
            await boss.send(queues.outbox, {});
          }),
      );
      await boss.work<{ id: string }>(
        queues.delivery,
        { batchSize: 1, pollingIntervalSeconds: this.config.JOBS_POLL_SECONDS },
        async (jobs) =>
          safe(async () => {
            for (const job of jobs)
              if (
                typeof job.data.id === 'string' &&
                /^[a-f0-9-]{36}$/.test(job.data.id)
              )
                await handlers.delivery(job.data.id);
          }),
      );
      await boss.schedule(
        queues.sweep,
        '* * * * *',
        {},
        { tz: 'UTC', key: 'authoritative-sweep' },
      );
      await boss.send(queues.sweep, {});
      await boss.send(queues.outbox, {});
    } catch {
      await this.stop();
      throw new Error('Worker startup failed; verify controlled queue setup.');
    }
  }
  async stop() {
    const boss = this.boss;
    this.boss = undefined;
    if (boss) await boss.stop({ graceful: true, timeout: 15000 });
  }
}
