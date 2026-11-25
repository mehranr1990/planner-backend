import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  HealthPolicySchema,
  StoragePolicySchema,
  BackupPolicySchema,
} from '@mehran/api-contracts';
import { DatabaseService } from '../database/database.service.js';
import { PrivacyGate } from '../authorization/privacy-gate.js';
import { StorageOperations } from '../storage/storage-operations.js';
import { QueueControl } from './queue-control.js';
import { ApiMetrics } from './api-metrics.js';
import { AdminCommand } from '../admin/admin-command.js';
import { permits } from '../admin/admin-policy.js';
import { IdentityMailService } from '../auth/mail.service.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { OperationsControl } from './operations-control.js';

@Injectable()
export class SystemHealth {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PrivacyGate) private readonly privacy: PrivacyGate,
    @Inject(StorageOperations) private readonly storage: StorageOperations,
    @Inject(QueueControl) private readonly queues: QueueControl,
    @Inject(ApiMetrics) private readonly metrics: ApiMetrics,
    @Inject(IdentityMailService) private readonly mail: IdentityMailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OperationsControl) private readonly control: OperationsControl,
  ) {}
  async snapshot() {
    const checks: {
      name: string;
      status: 'UP' | 'DOWN' | 'UNAVAILABLE';
      latencyMs: number;
      code: string | null;
    }[] = [];
    let capacity: { totalBytes: string; freeBytes: string } | null = null,
      workerLastSeenAt: string | null = null;
    const check = async (name: string, work: () => Promise<void>) => {
      const at = performance.now();
      try {
        await work();
        checks.push({
          name,
          status: 'UP',
          latencyMs: Math.round(performance.now() - at),
          code: null,
        });
      } catch {
        checks.push({
          name,
          status: 'DOWN',
          latencyMs: Math.round(performance.now() - at),
          code: name.toUpperCase() + '_UNAVAILABLE',
        });
      }
    };
    await Promise.allSettled([
      check('database', () => this.db.checkConnection()),
      check('queue', () => this.queues.verify()),
      check('storage', async () => {
        const c = await this.storage.capacity();
        capacity = {
          totalBytes: String(c.totalBytes),
          freeBytes: String(c.freeBytes),
        };
      }),
      check('restore', async () => {
        this.privacy.assert();
      }),
      check('maintenance', () => this.control.assert()),
      check('worker', async () => {
        const row = await this.db.client.adminOperationalHeartbeat.findUnique({
          where: { name: 'worker' },
        });
        workerLastSeenAt = row?.lastSeenAt.toISOString() ?? null;
        if (!row || Date.now() - +row.lastSeenAt > 180000) throw new Error();
      }),
      check('delivery', () => this.mail.check()),
    ]);
    checks.sort((a, b) => a.name.localeCompare(b.name));
    return {
      status: checks.every((c) => c.status === 'UP') ? 'READY' : 'DEGRADED',
      observedAt: new Date().toISOString(),
      checks,
      api: this.metrics.snapshot(),
      workerLastSeenAt: workerLastSeenAt as string | null,
      storage: capacity as { totalBytes: string; freeBytes: string } | null,
    };
  }
  private incidentView(r: {
    id: string;
    rule: string;
    severity: string;
    state: string;
    cause: string;
    startedAt: Date;
    recoveredAt: Date | null;
    lastNotifiedAt: Date | null;
  }) {
    return {
      id: r.id,
      rule: r.rule,
      severity: r.severity,
      state: r.state,
      cause: r.cause,
      startedAt: r.startedAt.toISOString(),
      recoveredAt: r.recoveredAt?.toISOString() ?? null,
      lastNotifiedAt: r.lastNotifiedAt?.toISOString() ?? null,
    };
  }
  async incidents(q: {
    after?: string | undefined;
    limit: number;
    state?: string | undefined;
  }) {
    const rows = await this.db.client.adminOperationalIncident.findMany({
      where: {
        ...(q.after ? { id: { gt: q.after } } : {}),
        ...(q.state ? { state: q.state } : {}),
      },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
    });
    return {
      items: rows.slice(0, q.limit).map((r) => this.incidentView(r)),
      nextAfter: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
    };
  }
  async notes(id: string, q: { after?: string | undefined; limit: number }) {
    if (
      !(await this.db.client.adminOperationalIncident.findUnique({
        where: { id },
      }))
    )
      throw new NotFoundException();
    const rows = await this.db.client.adminOperationalNote.findMany({
      where: { incidentId: id, ...(q.after ? { id: { gt: q.after } } : {}) },
      orderBy: { id: 'asc' },
      take: q.limit + 1,
    });
    return {
      items: rows
        .slice(0, q.limit)
        .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      nextAfter: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
    };
  }
  async note(command: AdminCommand, id: string, note: string) {
    command.require('admin.health.notes');
    return this.db.client.$transaction((tx) =>
      command.execute(tx, async () => {
        if (!(await tx.adminOperationalIncident.findUnique({ where: { id } })))
          throw new NotFoundException();
        const row = await tx.adminOperationalNote.create({
          data: { incidentId: id, actorAdminId: command.adminId, note },
        });
        return { ...row, createdAt: row.createdAt.toISOString() };
      }),
    );
  }
  async detect() {
    const health = await this.snapshot();
    const [p, s, lastBackup, bp, drill] = await Promise.all([
      this.db.client.adminOperationalPolicy.findUniqueOrThrow({
        where: { section: 'HEALTH' },
      }),
      this.db.client.adminOperationalPolicy.findUniqueOrThrow({
        where: { section: 'STORAGE' },
      }),
      this.db.client.adminBackupRun.findFirst({
        where: { state: 'VERIFIED', expiresAt: { gt: new Date() } },
        orderBy: { completedAt: 'desc' },
      }),
      this.db.client.adminOperationalPolicy.findUniqueOrThrow({
        where: { section: 'BACKUP' },
      }),
      this.db.client.adminRestoreRun.findFirst({
        where: { mode: 'DRILL', state: 'VERIFIED' },
        orderBy: { completedAt: 'desc' },
      }),
    ]);
    const backupPolicy = BackupPolicySchema.parse(bp.value);
    const capturedAt = (lastBackup?.evidence as { capturedAt?: string } | null)
      ?.capturedAt;
    const drillOverdue =
      !drill?.completedAt ||
      Date.now() - +drill.completedAt >
        backupPolicy.drillIntervalDays * 86400000;
    const policy = HealthPolicySchema.parse(p.value),
      storage = StoragePolicySchema.parse(s.value);
    const values: Record<string, number> = {
      DATABASE:
        health.checks.find((c) => c.name === 'database')?.status === 'UP'
          ? 0
          : 1,
      QUEUE:
        health.checks.find((c) => c.name === 'queue')?.status === 'UP' ? 0 : 1,
      STORAGE:
        health.storage &&
        BigInt(health.storage.freeBytes) >= BigInt(storage.minimumFreeBytes)
          ? 0
          : 1,
      WORKER: health.workerLastSeenAt
        ? Math.floor((Date.now() - Date.parse(health.workerLastSeenAt)) / 1000)
        : 1000000,
      DELIVERY:
        health.checks.find((c) => c.name === 'delivery')?.status === 'UP'
          ? 0
          : 1,
      BACKUP_AGE: drillOverdue
        ? 1000000
        : capturedAt
          ? Math.floor((Date.now() - Date.parse(capturedAt)) / 3600000)
          : 1000000,
      API_ERRORS: this.metrics.recentErrors(),
    };
    await this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('admin-operational-alerts',0))::text`;
      for (const rule of policy.rules) {
        const prior = await tx.adminOperationalIncident.findFirst({
            where: { rule: rule.rule, state: 'OPEN' },
          }),
          breached = values[rule.rule]! >= rule.threshold,
          now = new Date();
        if (!breached) {
          if (prior) {
            await tx.adminOperationalIncident.update({
              where: { id: prior.id },
              data: { state: 'RECOVERED', recoveredAt: now },
            });
            await tx.adminAuditEvent.create({
              data: {
                action: 'OPERATIONAL_INCIDENT_RECOVERED',
                outcome: 'SUCCEEDED',
                requestId: randomUUID(),
                metadata: { incidentId: prior.id, rule: rule.rule },
              },
            });
          }
          continue;
        }
        if (!rule.enabled) continue;
        const incident =
          prior ??
          (await tx.adminOperationalIncident.create({
            data: {
              rule: rule.rule,
              severity: rule.severity,
              cause: rule.rule + '_THRESHOLD_EXCEEDED',
            },
          }));
        if (!prior)
          await tx.adminAuditEvent.create({
            data: {
              action: 'OPERATIONAL_INCIDENT_OPENED',
              outcome: 'SUCCEEDED',
              requestId: randomUUID(),
              metadata: {
                incidentId: incident.id,
                rule: rule.rule,
                severity: rule.severity,
              },
            },
          });
        if (
          (rule.silencedUntil && Date.parse(rule.silencedUntil) > +now) ||
          (incident.lastNotifiedAt &&
            +now - +incident.lastNotifiedAt < rule.repeatMinutes * 60000)
        )
          continue;
        const next = await tx.adminOperationalIncident.update({
          where: { id: incident.id },
          data: { lastNotifiedAt: now, notificationSequence: { increment: 1 } },
        });
        if (rule.channels.includes('EMAIL')) {
          const users = await tx.adminUser.findMany({
            where: {
              active: true,
              twoFactorEnabled: true,
              role: { in: ['SUPER_ADMIN', 'SECURITY_REVIEWER'] },
            },
            select: { id: true },
          });
          for (const user of users)
            await tx.adminOperationalDelivery.create({
              data: {
                incidentId: incident.id,
                adminUserId: user.id,
                sequence: next.notificationSequence,
              },
            });
        }
      }
    });
    return health;
  }
  async deliver() {
    const claim = await this.db.client.$transaction(async (tx) => {
      const [r] = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "AdminOperationalDelivery" WHERE (state='PENDING' AND "nextAt"<=clock_timestamp()) OR (state='SENDING' AND "leaseUntil"<=clock_timestamp()) ORDER BY "nextAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!r) return null;
      const row = await tx.adminOperationalDelivery.findUniqueOrThrow({
        where: { id: r.id },
      });
      return tx.adminOperationalDelivery.update({
        where: { id: r.id },
        data:
          row.attempts >= 8
            ? { state: 'FAILED', leaseUntil: null }
            : {
                state: 'SENDING',
                attempts: { increment: 1 },
                leaseUntil: new Date(Date.now() + 60000),
              },
      });
    });
    if (!claim || claim.state === 'FAILED') return false;
    try {
      const user = await this.db.client.adminUser.findUniqueOrThrow({
        where: { id: claim.adminUserId },
      });
      const incident =
        await this.db.client.adminOperationalIncident.findUniqueOrThrow({
          where: { id: claim.incidentId },
        });
      const policy = HealthPolicySchema.parse(
          (
            await this.db.client.adminOperationalPolicy.findUniqueOrThrow({
              where: { section: 'HEALTH' },
            })
          ).value,
        ),
        rule = policy.rules.find((r) => r.rule === incident.rule);
      const canceled =
        !user.active ||
        !user.twoFactorEnabled ||
        (user.signInBlockedUntil && user.signInBlockedUntil > new Date()) ||
        !permits(user.role, 'admin.health.read') ||
        !rule?.enabled ||
        !rule.channels.includes('EMAIL') ||
        (rule.silencedUntil && Date.parse(rule.silencedUntil) > Date.now()) ||
        incident.state !== 'OPEN';
      if (!canceled)
        await this.mail.send({
          to: user.email,
          kind: 'administrative',
          url: new URL(
            '/api/v1/admin/operations/incidents',
            this.config.BETTER_AUTH_URL,
          ).toString(),
          message:
            'Operational incident ' +
            incident.severity +
            ': ' +
            incident.rule +
            '. Review the authorized operational dashboard.',
        });
      await this.db.client.adminOperationalDelivery.updateMany({
        where: { id: claim.id, attempts: claim.attempts, state: 'SENDING' },
        data: { state: canceled ? 'CANCELED' : 'SENT', leaseUntil: null },
      });
    } catch {
      await this.db.client.adminOperationalDelivery.updateMany({
        where: { id: claim.id, attempts: claim.attempts, state: 'SENDING' },
        data: {
          state: claim.attempts >= 8 ? 'FAILED' : 'PENDING',
          nextAt: new Date(
            Date.now() + Math.min(300000, 1000 * 2 ** claim.attempts),
          ),
          leaseUntil: null,
        },
      });
    }
    return true;
  }
}
