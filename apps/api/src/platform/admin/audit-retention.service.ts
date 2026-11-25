import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { AdminCommand } from './admin-command.js';
import type { Prisma } from '../../generated/prisma/client.js';
@Injectable()
export class AdminAuditRetention {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async policies() {
    return {
      items: await this.db.client.adminAuditRetentionPolicy.findMany({
        orderBy: { category: 'asc' },
      }),
    };
  }
  private view(row: {
    id: string;
    category: string;
    days: number;
    expectedRevision: number;
    eligibleRecords: number;
    state: string;
    requesterAdminId: string;
    approverAdminId: string | null;
    reason: string;
    expiresAt: Date;
  }) {
    return {
      id: row.id,
      category: row.category,
      days: row.days,
      expectedRevision: row.expectedRevision,
      eligibleRecords: row.eligibleRecords,
      state:
        row.state !== 'APPLIED' && row.expiresAt <= new Date()
          ? 'EXPIRED'
          : row.state,
      requesterAdminId: row.requesterAdminId,
      approverAdminId: row.approverAdminId,
      reason: row.reason,
      expiresAt: row.expiresAt.toISOString(),
    };
  }
  async change(id: string) {
    const row = await this.db.client.adminAuditRetentionChange.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException();
    return this.view(row);
  }
  private async impact(
    tx: Prisma.TransactionClient,
    category: string,
    days: number,
  ) {
    // Previously signed manifests keep their original deadlines.
    if (category === 'BACKUP') return 0;
    const [row] = await tx.$queryRaw<
      { total: bigint }[]
    >`SELECT count(*) total FROM "AdminAuditEvidence" e WHERE category=${category} AND "createdAt"<=clock_timestamp()-make_interval(days=>${days}::integer)
      AND (source<>'ADMIN' OR NOT EXISTS(SELECT 1 FROM "AdminDelivery" d WHERE d."auditId"=e."eventId"))`;
    return Number(row!.total);
  }
  async mutate(
    command: AdminCommand,
    operation: string,
    id: string | undefined,
    body: unknown,
  ) {
    command.require(
      'admin.privacy.retention.' +
        (operation === 'apply' ? 'publish' : operation),
    );
    return this.db.client.$transaction((tx) =>
      command.execute(tx, async () => {
        if (operation === 'expire') {
          const input = body as { category: string; limit: number };
          const [row] = await tx.$queryRaw<
            { deleted: number }[]
          >`SELECT admin_expire_audit_evidence(${input.category},${input.limit}::integer) deleted`;
          return { deleted: row!.deleted };
        }
        if (operation === 'preview') {
          const input = body as {
            category: string;
            days: number;
            revision: number;
            reason: string;
          };
          const policy = await tx.adminAuditRetentionPolicy.findUniqueOrThrow({
            where: { category: input.category },
          });
          if (policy.revision !== input.revision)
            throw new ConflictException({ code: 'STALE_REVISION' });
          const now = (
            await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() now`
          )[0]!.now;
          const row = await tx.adminAuditRetentionChange.create({
            data: {
              category: input.category,
              days: input.days,
              expectedRevision: input.revision,
              eligibleRecords: await this.impact(
                tx,
                input.category,
                input.days,
              ),
              requesterAdminId: command.adminId,
              reason: input.reason,
              createdAt: now,
              expiresAt: new Date(+now + 900000),
            },
          });
          return this.view(row);
        }
        await tx.$queryRaw`SELECT id FROM "AdminAuditRetentionChange" WHERE id=${id!}::uuid FOR UPDATE`;
        const row = await tx.adminAuditRetentionChange.findUnique({
          where: { id: id! },
        });
        if (!row) throw new NotFoundException();
        if (row.expiresAt <= new Date())
          throw new ConflictException({ code: 'RETENTION_PREVIEW_EXPIRED' });
        if (operation === 'approve') {
          const input = body as { eligibleRecords: number; reason: string };
          if (
            row.state !== 'PREVIEW' ||
            command.adminId === row.requesterAdminId
          )
            throw new ForbiddenException();
          if (input.eligibleRecords !== row.eligibleRecords)
            throw new ConflictException({
              code: 'RETENTION_IMPACT_CONFIRMATION_REQUIRED',
            });
          await AdminCommand.requireInitiator(
            tx,
            row.requesterAdminId,
            'admin.privacy.retention.preview',
          );
          return this.view(
            await tx.adminAuditRetentionChange.update({
              where: { id: row.id },
              data: {
                state: 'APPROVED',
                approverAdminId: command.adminId,
                approvalReason: input.reason,
              },
            }),
          );
        }
        if (
          operation !== 'apply' ||
          row.state !== 'APPROVED' ||
          row.requesterAdminId !== command.adminId ||
          !row.approverAdminId
        )
          throw new ForbiddenException();
        await AdminCommand.requireInitiator(
          tx,
          row.approverAdminId,
          'admin.privacy.retention.approve',
        );
        if (
          (await this.impact(tx, row.category, row.days)) !==
          row.eligibleRecords
        )
          throw new ConflictException({ code: 'RETENTION_IMPACT_CHANGED' });
        const result = await tx.adminAuditRetentionPolicy.updateMany({
          where: { category: row.category, revision: row.expectedRevision },
          data: { days: row.days, revision: { increment: 1 } },
        });
        if (result.count !== 1)
          throw new ConflictException({ code: 'STALE_REVISION' });
        return this.view(
          await tx.adminAuditRetentionChange.update({
            where: { id: row.id },
            data: { state: 'APPLIED' },
          }),
        );
      }),
    );
  }
}
