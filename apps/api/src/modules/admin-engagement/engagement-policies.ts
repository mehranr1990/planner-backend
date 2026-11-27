import { SystemEmailEvidence } from '../../platform/auth/email-evidence.js';
import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  adminEngagementRoutes as routes,
  P4PolicyPreview,
} from '@mehran/api-contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AdminCommand } from '../../platform/admin/admin-command.js';
import { EngagementCore, hash, json } from './engagement-core.js';
const previewRoute = 'POST engagement/policies/:id/preview';
const publishRoute = 'PATCH engagement/policies/:id';
type Values = Record<string, number>;
@Injectable()
export class EngagementPolicies {
  constructor(
    @Inject(EngagementCore) private readonly core: EngagementCore,
    @Inject(SystemEmailEvidence)
    private readonly emailEvidence: SystemEmailEvidence,
  ) {}
  private validate(section: string, current: Values, value: Values) {
    if (
      Object.keys(value).sort().join(',') !==
        Object.keys(current).sort().join(',') ||
      (section === 'SUPPORT' &&
        (value.reopenDays! > 90 ||
          value.archiveDays! < value.reopenDays! ||
          value.retentionDays! < value.archiveDays! ||
          value.inboundTokenDays! > 90)) ||
      (section === 'MODERATION' &&
        (value.appealDays! > 90 ||
          Math.min(value.dismissedRetentionDays!, value.actionRetentionDays!) <
            value.appealDays!)) ||
      (section === 'COMMUNICATIONS' && value.maxAttempts! > 10)
    )
      throw new ConflictException({ code: 'INVALID_POLICY' });
  }
  private async impact(
    tx: Prisma.TransactionClient,
    section: string,
    value: Values,
    at: Date,
  ) {
    const before = (days: number) => new Date(+at - days * 86400000);
    const archive =
      section === 'SUPPORT'
        ? await tx.supportTicket.findMany({
            where: {
              state: { in: ['RESOLVED', 'CLOSED'] },
              archivedAt: null,
              resolvedAt: { lt: before(value.archiveDays!) },
            },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: 100001,
          })
        : [];
    const deleted =
      section === 'SUPPORT'
        ? await tx.supportTicket.findMany({
            where: {
              resolvedAt: { lt: before(value.retentionDays!) },
              OR: [
                { archivedAt: { not: null } },
                { state: { in: ['RESOLVED', 'CLOSED'] } },
              ],
            },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: 100001,
          })
        : section === 'COMMUNICATIONS'
          ? await tx.adminCommunication.findMany({
              where: {
                state: { in: ['CANCELED', 'COMPLETE'] },
                createdAt: { lt: before(value.retentionDays!) },
              },
              select: { id: true },
              orderBy: { id: 'asc' },
              take: 100001,
            })
          : [];
    if (archive.length > 100000 || deleted.length > 100000)
      throw new ConflictException({ code: 'POLICY_IMPACT_LIMIT' });
    const ids = deleted.map((r) => r.id);
    const sum = async (count: (ids: string[]) => Promise<number>) => {
      let total = 0;
      for (let offset = 0; offset < ids.length; offset += 1000)
        total += await count(ids.slice(offset, offset + 1000));
      return total;
    };
    const evidence =
      section === 'SUPPORT'
        ? await sum((ticketIds) =>
            tx.p4Evidence.count({ where: { ticketId: { in: ticketIds } } }),
          )
        : 0;
    const replies =
      section === 'SUPPORT'
        ? await sum((ticketIds) =>
            tx.supportReply.count({ where: { ticketId: { in: ticketIds } } }),
          )
        : 0;
    const recipients =
      section === 'COMMUNICATIONS'
        ? await sum((communicationIds) =>
            tx.adminCommunicationRecipient.count({
              where: { communicationId: { in: communicationIds } },
            }),
          )
        : 0;
    const receipts =
      section === 'SUPPORT'
        ? await tx.p4UserReceipt.count({
            where: { createdAt: { lt: before(value.retentionDays!) } },
          })
        : 0;
    return {
      archiveTickets: archive.length,
      deleteRecords: deleted.length,
      evidenceFiles: evidence,
      publicAndInternalReplies: replies,
      deliveryRecords:
        recipients +
        (section === 'COMMUNICATIONS'
          ? await this.emailEvidence.retentionImpact(tx, value.retentionDays!)
          : 0),
      idempotencyReceipts: receipts,
      existingModerationDeadlinesUnchanged: true as const,
      fingerprint: hash(
        JSON.stringify({
          archive,
          deleted,
          evidence,
          replies,
          recipients,
          receipts,
        }),
      ),
    };
  }
  async run(
    route: typeof previewRoute | typeof publishRoute,
    section: string,
    input: unknown,
    command: AdminCommand,
  ) {
    this.core.privacy.assert();
    command.require('admin.engagement.configure');
    return this.core.db.client.$transaction(
      (tx) =>
        command.execute(tx, async () => {
          await this.core.lock(tx, 'p4-policy:' + section);
          const current = await tx.p4Policy.findUnique({ where: { section } });
          if (!current) throw new NotFoundException();
          const b = routes[route].schema.parse(input);
          this.validate(section, current.value as Values, b.value);
          if (current.revision !== b.revision)
            throw new ConflictException({ code: 'STALE_REVISION' });
          const now = new Date();
          if (route === previewRoute) {
            const result = {
              id: randomUUID(),
              kind: 'P4_POLICY_PREVIEW' as const,
              section,
              revision: b.revision,
              value: b.value,
              impact: await this.impact(tx, section, b.value, now),
              expiresAt: new Date(+now + 900000).toISOString(),
            };
            await command.recordChange(
              tx,
              { revision: current.revision },
              json(result),
            );
            return json(result);
          }
          const publish = routes[publishRoute].schema.parse(input);
          // Existing durable command receipts bind an immutable, audited preview. A
          // revision increment consumes it; no additional retention store is needed.
          const receipt = await tx.adminMutationReceipt.findFirst({
            where: {
              actorAdminId: command.adminId,
              operation: command.permission,
              result: { path: ['id'], equals: publish.previewId },
            },
          });
          const parsed = P4PolicyPreview.safeParse(receipt?.result);
          if (
            !parsed.success ||
            parsed.data.kind !== 'P4_POLICY_PREVIEW' ||
            parsed.data.section !== section ||
            +new Date(parsed.data.expiresAt) <= +now ||
            parsed.data.revision !== current.revision ||
            JSON.stringify(Object.entries(parsed.data.value).sort()) !==
              JSON.stringify(Object.entries(b.value).sort())
          )
            throw new ConflictException({ code: 'POLICY_PREVIEW_REQUIRED' });
          const impact = await this.impact(tx, section, b.value, now);
          if (
            impact.fingerprint !== parsed.data.impact.fingerprint ||
            publish.impactFingerprint !== impact.fingerprint
          )
            throw new ConflictException({ code: 'POLICY_IMPACT_CHANGED' });
          const updated = await tx.p4Policy.update({
            where: { section },
            data: {
              value: b.value,
              revision: { increment: 1 },
              updatedAt: now,
            },
          });
          await command.recordChange(
            tx,
            json({ revision: current.revision, value: current.value }),
            json({
              revision: updated.revision,
              value: updated.value,
              previewId: publish.previewId,
              impact,
            }),
          );
          return json(updated);
        }),
      { isolationLevel: 'ReadCommitted', timeout: 30000 },
    );
  }
}
