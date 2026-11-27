import { AdminCommand } from '../../platform/admin/admin-command.js';
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../platform/database/database.service.js';
import { AdminAccounts, PersonalLifecycle } from '../account/public/index.js';
import { IdentityMailService } from '../../platform/auth/mail.service.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { effectiveSuspension } from '../../platform/admin/management-policy.js';
import { InvitationMailService } from '../spaces/public/index.js';
/** Durable PostgreSQL outbox, swept by the existing pg-boss worker. Delivery is at least once. */
@Injectable()
export class AdminDeliveryService {
  constructor(
    @Inject(InvitationMailService)
    private readonly invitations: InvitationMailService,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AdminAccounts) private readonly accounts: AdminAccounts,
    @Inject(PersonalLifecycle) private readonly lifecycle: PersonalLifecycle,
    @Inject(IdentityMailService) private readonly mail: IdentityMailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  async consume() {
    const row = await this.db.client.$transaction(async (tx) => {
      const [claim] = await tx.$queryRaw<
        { id: string; attempts: number }[]
      >`SELECT id,attempts FROM "AdminDelivery" WHERE (state='PENDING' AND "nextAt"<=clock_timestamp() OR state='SENDING' AND "leaseUntil"<=clock_timestamp()) ORDER BY "nextAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!claim) return null;
      if (claim.attempts >= 8)
        return tx.adminDelivery.update({
          where: { id: claim.id },
          data: { state: 'FAILED', leaseUntil: null },
        });
      return tx.adminDelivery.update({
        where: { id: claim.id },
        data: {
          state: 'SENDING',
          attempts: { increment: 1 },
          leaseUntil: new Date(Date.now() + 60000),
        },
      });
    });
    if (!row) return false;
    if (row.state === 'FAILED') return true;
    try {
      if (row.kind === 'INVITATION_LINK') {
        const data = row.payload as {
          invitationId: string;
          encryptedProof: string;
        };
        if (!row.recipientEmail)
          throw new Error('Missing invitation recipient');
        const state = await this.invitations.deliverQueued(
          data.invitationId,
          row.recipientEmail,
          data.encryptedProof,
        );
        if (state !== 'SENT' && state !== 'CANCELED')
          throw new Error('Invitation delivery unavailable');
        await this.db.client.adminDelivery.updateMany({
          where: { id: row.id, state: 'SENDING', attempts: row.attempts },
          data: { state, leaseUntil: null },
        });
        return true;
      }
      if (!row.targetUserId) throw new Error('Missing account recipient');
      const user = await this.db.client.user.findUnique({
        where: { id: row.targetUserId },
        select: { email: true, emailVerified: true },
      });
      const snapshot = row.payload as { expectedEmail?: string };
      if (snapshot.expectedEmail && user?.email !== snapshot.expectedEmail) {
        await this.db.client.adminDelivery.updateMany({
          where: { id: row.id, attempts: row.attempts },
          data: { state: 'CANCELED', leaseUntil: null },
        });
        return true;
      }
      if (row.kind === 'EMAIL_VERIFICATION') {
        const payload = row.payload as { expectedEmail: string };
        const audit = await this.db.client.adminAuditEvent.findUniqueOrThrow({
          where: { id: row.auditId },
        });
        if (
          !user ||
          user.emailVerified ||
          user.email !== payload.expectedEmail ||
          !audit.actorAdminId
        ) {
          await this.db.client.adminDelivery.updateMany({
            where: { id: row.id, attempts: row.attempts },
            data: { state: 'CANCELED', leaseUntil: null },
          });
          return true;
        }
        await this.db.client.$transaction((tx) =>
          AdminCommand.requireInitiator(
            tx,
            audit.actorAdminId!,
            'admin.users.verification.resend',
          ),
        );
        await this.accounts.verification(row.targetUserId, {
          sourceKind: 'ADMIN_DELIVERY',
          sourceId: row.id,
          category: 'REGISTRATION_VERIFICATION',
          userId: row.targetUserId,
        });
        await this.db.client.adminDelivery.updateMany({
          where: { id: row.id, state: 'SENDING', attempts: row.attempts },
          data: { state: 'SENT', leaseUntil: null },
        });
        return true;
      }
      if (!user?.emailVerified) {
        await this.db.client.adminDelivery.updateMany({
          where: { id: row.id, state: 'SENDING', attempts: row.attempts },
          data: { state: 'CANCELED', leaseUntil: null },
        });
        return true;
      }
      if (row.kind === 'PASSWORD_RECOVERY') {
        const account = await this.db.client.userSettings.findUnique({
          where: { userId: row.targetUserId },
          select: { suspendedAt: true, suspensionExpiresAt: true },
        });
        if (account && effectiveSuspension(account))
          throw new Error('Recovery unavailable');
        await this.accounts.recovery(row.targetUserId, {
          sourceKind: 'ADMIN_DELIVERY',
          sourceId: row.id,
          category: 'PASSWORD_RECOVERY',
          userId: row.targetUserId,
        });
      } else if (row.kind === 'ACCOUNT_DELETION') {
        const data = row.payload as { jobId: string };
        const notice = await this.lifecycle.deletionNotice(
          data.jobId,
          row.targetUserId,
        );
        if (!notice) {
          await this.db.client.adminDelivery.updateMany({
            where: { id: row.id, state: 'SENDING', attempts: row.attempts },
            data: { state: 'CANCELED', leaseUntil: null },
          });
          return true;
        }
        const url = new URL(this.config.BETTER_AUTH_URL);
        url.hash = new URLSearchParams({
          deletionJobId: data.jobId,
          recoveryCapability: notice.recovery,
        }).toString();
        await this.mail.send({
          metadata: {
            sourceKind: 'ADMIN_DELIVERY',
            sourceId: row.id,
            category: 'SYSTEM_NOTICE',
            userId: row.targetUserId,
          },
          to: user.email,
          kind: 'administrative',
          url: url.toString(),
          message:
            'Platform Administration scheduled account deletion. Recovery is available before ' +
            notice.deadline +
            '. Use the recovery capability with your password; revoked sessions do not return.',
        });
      } else {
        const data = row.payload as {
          workspaceId?: string;
          invitationId?: string;
          handoverId?: string;
          reason?: string;
        };
        const link = new URL(this.config.BETTER_AUTH_URL);
        link.hash = new URLSearchParams({
          event: row.kind,
          ...(data.workspaceId ? { workspaceId: data.workspaceId } : {}),
          ...(data.invitationId ? { invitationId: data.invitationId } : {}),
          ...(data.handoverId ? { handoverId: data.handoverId } : {}),
        }).toString();
        await this.mail.send({
          metadata: {
            sourceKind: 'ADMIN_DELIVERY',
            sourceId: row.id,
            category: 'SYSTEM_NOTICE',
            userId: row.targetUserId,
          },
          to: user.email,
          kind: 'administrative',
          url: link.toString(),
          message: data.reason
            ? 'An administrative change was recorded. ' + data.reason
            : 'An administrative change or offer requires your attention. Sign in to view it.',
        });
      }
      await this.db.client.adminDelivery.updateMany({
        where: { id: row.id, state: 'SENDING', attempts: row.attempts },
        data: { state: 'SENT', leaseUntil: null },
      });
    } catch {
      await this.db.client.adminDelivery.updateMany({
        where: { id: row.id, state: 'SENDING', attempts: row.attempts },
        data: {
          state: row.attempts >= 8 ? 'FAILED' : 'PENDING',
          leaseUntil: null,
          nextAt: new Date(
            Date.now() + Math.min(300000, 1000 * 2 ** row.attempts),
          ),
        },
      });
    }
    return true;
  }
}
