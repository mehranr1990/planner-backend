import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BackupPolicySchema } from '@mehran/api-contracts';
import { DatabaseService } from '../database/database.service.js';
import { AdminCommand } from '../admin/admin-command.js';
import type {
  Prisma,
  AdminBackupRun,
  AdminRestoreRun,
} from '../../generated/prisma/client.js';

@Injectable()
export class BackupRuns {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  backupView(r: AdminBackupRun) {
    const evidence = r.evidence as { capturedAt?: string } | null;
    return {
      id: r.id,
      state:
        r.state === 'VERIFIED' && r.expiresAt && r.expiresAt <= new Date()
          ? 'EXPIRED'
          : r.state,
      origin: r.origin,
      retentionDays: r.retentionDays,
      policyRevision: r.policyRevision,
      createdAt: r.createdAt.toISOString(),
      capturedAt: evidence?.capturedAt ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      failureCode: r.failureCode,
      encrypted: r.encrypted,
      offHostVerified: r.offHostVerified,
      manifestDigest: r.manifestDigest,
    };
  }
  restoreView(r: AdminRestoreRun) {
    return {
      id: r.id,
      backupId: r.backupId,
      mode: r.mode,
      targetReference: r.targetReference,
      state:
        ['REQUESTED', 'APPROVED'].includes(r.state) && r.expiresAt <= new Date()
          ? 'EXPIRED'
          : r.state,
      requesterAdminId: r.requesterAdminId,
      approverAdminId: r.approverAdminId,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      failureCode: r.failureCode,
      replayVerified: r.replayVerified,
      readinessVerified: r.readinessVerified,
    };
  }
  async list(
    kind: 'backup' | 'restore',
    q: { limit: number; after?: string | undefined },
  ) {
    const args = {
      where: q.after ? { id: { gt: q.after } } : {},
      take: q.limit + 1,
      orderBy: { id: 'asc' as const },
    };
    const rows =
      kind === 'backup'
        ? await this.db.client.adminBackupRun.findMany(args)
        : await this.db.client.adminRestoreRun.findMany(args);
    return {
      items: rows
        .slice(0, q.limit)
        .map((r) =>
          kind === 'backup'
            ? this.backupView(r as AdminBackupRun)
            : this.restoreView(r as AdminRestoreRun),
        ),
      nextAfter: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
    };
  }
  async detail(id: string) {
    const row = await this.db.client.adminBackupRun.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException();
    return this.backupView(row);
  }
  private async create(
    tx: Prisma.TransactionClient,
    actorAdminId: string | null,
    origin: string,
  ) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('admin-backup-request',0))::text`;
    if (
      await tx.adminBackupRun.count({
        where: { state: { in: ['QUEUED', 'RUNNING'] } },
      })
    )
      throw new ConflictException({ code: 'BACKUP_ALREADY_PENDING' });
    const policy = await tx.adminAuditRetentionPolicy.findUniqueOrThrow({
      where: { category: 'BACKUP' },
    });
    return tx.adminBackupRun.create({
      data: {
        actorAdminId,
        origin,
        retentionDays: policy.days,
        policyRevision: policy.revision,
      },
    });
  }
  async request(command: AdminCommand) {
    command.require('admin.backups.request');
    return this.db.client.$transaction((tx) =>
      command.execute(tx, async () =>
        this.backupView(await this.create(tx, command.adminId, 'MANUAL')),
      ),
    );
  }
  async restore(
    command: AdminCommand,
    input: {
      backupId: string;
      mode: 'DRILL' | 'RESTORE';
      targetReference: string;
    },
  ) {
    command.require('admin.restores.request');
    return this.db.client.$transaction((tx) =>
      command.execute(tx, async () => {
        await this.requireBackup(tx, input.backupId);
        const pending = await tx.adminRestoreRun.count({
          where: {
            state: { in: ['REQUESTED', 'APPROVED', 'RUNNING'] },
            expiresAt: { gt: new Date() },
          },
        });
        if (pending >= 10)
          throw new ConflictException({ code: 'RESTORE_REQUEST_LIMIT' });
        return this.restoreView(
          await tx.adminRestoreRun.create({
            data: {
              backupId: input.backupId,
              mode: input.mode,
              targetReference: input.targetReference,
              requesterAdminId: command.adminId,
              expiresAt: new Date(Date.now() + 1800000),
            },
          }),
        );
      }),
    );
  }
  private async requireBackup(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.adminBackupRun.findUnique({ where: { id } });
    if (
      !row ||
      row.state !== 'VERIFIED' ||
      !row.expiresAt ||
      row.expiresAt <= new Date() ||
      !row.encrypted ||
      !row.offHostVerified
    )
      throw new ConflictException({ code: 'BACKUP_NOT_RESTORABLE' });
    return row;
  }
  async approve(
    command: AdminCommand,
    id: string,
    input: { backupId: string; targetReference: string },
  ) {
    command.require('admin.restores.approve');
    return this.db.client.$transaction((tx) =>
      command.execute(tx, async () => {
        await tx.$queryRaw`SELECT id FROM "AdminRestoreRun" WHERE id=${id}::uuid FOR UPDATE`;
        const row = await tx.adminRestoreRun.findUnique({ where: { id } });
        if (!row) throw new NotFoundException();
        if (row.requesterAdminId === command.adminId)
          throw new ForbiddenException();
        if (
          row.state !== 'REQUESTED' ||
          row.expiresAt <= new Date() ||
          row.backupId !== input.backupId ||
          row.targetReference !== input.targetReference
        )
          throw new ConflictException({
            code: 'RESTORE_REVIEW_CHANGED_OR_EXPIRED',
          });
        await this.requireBackup(tx, row.backupId);
        await AdminCommand.requireInitiator(
          tx,
          row.requesterAdminId,
          'admin.restores.request',
        );
        return this.restoreView(
          await tx.adminRestoreRun.update({
            where: { id },
            data: { state: 'APPROVED', approverAdminId: command.adminId },
          }),
        );
      }),
    );
  }
  async schedule() {
    return this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('admin-backup-schedule',0))::text`;
      const row = await tx.adminOperationalPolicy.findUniqueOrThrow({
          where: { section: 'BACKUP' },
        }),
        policy = BackupPolicySchema.parse(row.value);
      if (!policy.enabled) return false;
      const latest = await tx.adminBackupRun.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      if (
        latest &&
        (['QUEUED', 'RUNNING'].includes(latest.state) ||
          Date.now() - +latest.createdAt < policy.intervalHours * 3600000)
      )
        return false;
      const run = await this.create(tx, null, 'SCHEDULE');
      await tx.adminAuditEvent.create({
        data: {
          action: 'SCHEDULED_BACKUP_REQUESTED',
          outcome: 'SUCCEEDED',
          requestId: randomUUID(),
          metadata: { backupId: run.id },
        },
      });
      return true;
    });
  }
  /** Operator console only; no HTTP controller exposes claim/completion methods. */
  async claim(kind: 'backup' | 'restore', id: string) {
    return this.db.client.$transaction(async (tx) => {
      const lease = randomUUID();
      if (kind === 'backup') {
        await tx.$queryRaw`SELECT id FROM "AdminBackupRun" WHERE id=${id}::uuid FOR UPDATE`;
        const row = await tx.adminBackupRun.findUniqueOrThrow({
          where: { id },
        });
        if (row.state !== 'QUEUED')
          throw new ConflictException({ code: 'BACKUP_NOT_QUEUED' });
        if (row.actorAdminId)
          await AdminCommand.requireInitiator(
            tx,
            row.actorAdminId,
            'admin.backups.request',
          );
        return tx.adminBackupRun.update({
          where: { id },
          data: {
            state: 'RUNNING',
            operatorLeaseId: lease,
            leaseUntil: new Date(Date.now() + 3600000),
          },
        });
      }
      await tx.$queryRaw`SELECT id FROM "AdminRestoreRun" WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.adminRestoreRun.findUniqueOrThrow({ where: { id } });
      if (
        row.state !== 'APPROVED' ||
        row.expiresAt <= new Date() ||
        !row.approverAdminId
      )
        throw new ConflictException({ code: 'RESTORE_APPROVAL_REQUIRED' });
      await this.requireBackup(tx, row.backupId);
      await AdminCommand.requireInitiator(
        tx,
        row.requesterAdminId,
        'admin.restores.request',
      );
      await AdminCommand.requireInitiator(
        tx,
        row.approverAdminId,
        'admin.restores.approve',
      );
      return tx.adminRestoreRun.update({
        where: { id },
        data: {
          state: 'RUNNING',
          operatorLeaseId: lease,
          leaseUntil: new Date(Date.now() + 3600000),
        },
      });
    });
  }
  async failExpiredLeases() {
    // Never automatically rerun backup/restore, nor reopen maintenance after a crash.
    for (const kind of ['backup', 'restore'] as const)
      await this.db.client.$transaction(async (tx) => {
        const args = {
          where: { state: 'RUNNING', leaseUntil: { lte: new Date() } },
          select: { id: true },
          take: 25,
        };
        const rows =
          kind === 'backup'
            ? await tx.adminBackupRun.findMany(args)
            : await tx.adminRestoreRun.findMany(args);
        for (const row of rows) {
          if (kind === 'backup')
            await tx.adminBackupRun.updateMany({
              where: {
                id: row.id,
                state: 'RUNNING',
                leaseUntil: { lte: new Date() },
              },
              data: {
                state: 'FAILED',
                failureCode: 'OPERATOR_LEASE_EXPIRED',
                completedAt: new Date(),
              },
            });
          else
            await tx.adminRestoreRun.updateMany({
              where: {
                id: row.id,
                state: 'RUNNING',
                leaseUntil: { lte: new Date() },
              },
              data: {
                state: 'FAILED',
                failureCode: 'OPERATOR_LEASE_EXPIRED',
                completedAt: new Date(),
              },
            });
          await tx.adminAuditEvent.create({
            data: {
              action: 'OPERATOR_LEASE_EXPIRED',
              outcome: 'FAILED',
              requestId: randomUUID(),
              metadata: { runId: row.id, kind },
            },
          });
        }
      });
  }
}
