import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { AdminCommand } from '../admin/admin-command.js';
import {
  EncryptedBackupBundleSchema,
  type EncryptedBackupBundle,
} from './encrypted-backup.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { z } from 'zod';
export const OperatorTargetRegistrySchema = z.record(
  z.string(),
  z.strictObject({
    isolated: z.literal(true),
    environmentFile: z.string().min(1),
  }),
);

/** Trusted operator process boundary, deliberately absent from the HTTP API. */
@Injectable()
export class BackupOperator {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async backupVerified(
    id: string,
    lease: string,
    bundle: EncryptedBackupBundle,
    offHostApproval: string,
  ) {
    bundle = EncryptedBackupBundleSchema.parse(bundle);
    if (bundle.runId !== id || !/^[A-Za-z0-9._-]{1,100}$/.test(offHostApproval))
      throw new ConflictException();
    return this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AdminBackupRun" WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.adminBackupRun.findUniqueOrThrow({ where: { id } });
      if (
        row.state !== 'RUNNING' ||
        row.operatorLeaseId !== lease ||
        !row.leaseUntil ||
        row.leaseUntil <= new Date() ||
        Date.parse(bundle.capturedAt) < +row.createdAt ||
        Date.parse(bundle.expiresAt) <= Date.now() ||
        Date.parse(bundle.expiresAt) >
          +row.createdAt + row.retentionDays * 86400000
      )
        throw new ConflictException({
          code: 'BACKUP_LEASE_OR_RETENTION_CHANGED',
        });
      if (row.actorAdminId)
        await AdminCommand.requireInitiator(
          tx,
          row.actorAdminId,
          'admin.backups.request',
        );
      const evidence = {
        capturedAt: bundle.capturedAt,
        encryption: 'AES-256-GCM',
        offHostApproval,
        bundleDigest: createHash('sha256')
          .update(JSON.stringify(bundle))
          .digest('hex'),
        encryptedArtifacts: bundle.artifacts.map((a) => ({
          name: a.name,
          sha256: a.encryptedSha256,
        })),
      };
      await tx.adminBackupRun.update({
        where: { id },
        data: {
          state: 'VERIFIED',
          encrypted: true,
          offHostVerified: true,
          manifestDigest: bundle.manifestDigest,
          expiresAt: new Date(bundle.expiresAt),
          completedAt: new Date(),
          evidence,
        },
      });
      await tx.adminAuditEvent.create({
        data: {
          action: 'BACKUP_VERIFIED',
          outcome: 'SUCCEEDED',
          actorAdminId: row.actorAdminId,
          requestId: randomUUID(),
          metadata: { backupId: id, manifestDigest: bundle.manifestDigest },
        },
      });
    });
  }
  async restoreVerified(
    id: string,
    lease: string,
    evidence: {
      backupId: string;
      bundleDigest: string;
      targetReference: string;
      migrations: number;
      files: number;
      replayDigest: string;
      readiness: true;
    },
  ) {
    return this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AdminRestoreRun" WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.adminRestoreRun.findUniqueOrThrow({ where: { id } });
      if (
        row.state !== 'RUNNING' ||
        row.operatorLeaseId !== lease ||
        !row.leaseUntil ||
        row.leaseUntil <= new Date() ||
        !row.approverAdminId ||
        row.backupId !== evidence.backupId ||
        row.targetReference !== evidence.targetReference ||
        !/^[a-f0-9]{64}$/.test(evidence.replayDigest) ||
        !/^[a-f0-9]{64}$/.test(evidence.bundleDigest) ||
        evidence.readiness !== true
      )
        throw new ConflictException({
          code: 'RESTORE_EVIDENCE_OR_LEASE_CHANGED',
        });
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
      const backup = await tx.adminBackupRun.findUniqueOrThrow({
        where: { id: row.backupId },
      });
      const backupEvidence = backup.evidence as {
        bundleDigest?: string;
      } | null;
      if (
        backup.state !== 'VERIFIED' ||
        !backup.expiresAt ||
        backup.expiresAt <= new Date() ||
        backupEvidence?.bundleDigest !== evidence.bundleDigest
      )
        throw new ConflictException({ code: 'RESTORE_BACKUP_CHANGED' });
      await tx.adminRestoreRun.update({
        where: { id },
        data: {
          state: 'VERIFIED',
          replayVerified: true,
          readinessVerified: true,
          completedAt: new Date(),
          evidence,
        },
      });
      await tx.adminAuditEvent.create({
        data: {
          action: 'RESTORE_VERIFIED',
          outcome: 'SUCCEEDED',
          actorAdminId: row.requesterAdminId,
          requestId: randomUUID(),
          metadata: {
            restoreId: id,
            backupId: row.backupId,
            targetReference: row.targetReference,
            mode: row.mode,
          },
        },
      });
    });
  }
  async failed(kind: 'backup' | 'restore', id: string, lease: string) {
    await this.db.client.$transaction(async (tx) => {
      const args = {
        where: { id, state: 'RUNNING', operatorLeaseId: lease },
        data: {
          state: 'FAILED',
          failureCode: 'OPERATOR_VERIFICATION_FAILED',
          completedAt: new Date(),
        },
      };
      const result =
        kind === 'backup'
          ? await tx.adminBackupRun.updateMany(args)
          : await tx.adminRestoreRun.updateMany(args);
      if (result.count)
        await tx.adminAuditEvent.create({
          data: {
            action: kind === 'backup' ? 'BACKUP_FAILED' : 'RESTORE_FAILED',
            outcome: 'FAILED',
            requestId: randomUUID(),
            metadata: { runId: id } as Prisma.InputJsonValue,
          },
        });
    });
  }
}
