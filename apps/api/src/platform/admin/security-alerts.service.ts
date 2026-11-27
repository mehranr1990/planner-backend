import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { AdminSecurityService } from './security.service.js';
import { IdentityMailService } from '../auth/mail.service.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { permits } from './admin-policy.js';
import { randomUUID } from 'node:crypto';
@Injectable()
export class AdminSecurityAlerts {
  async list(limit: number) {
    const rows = await this.db.client.adminSecurityAlert.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return {
      items: rows.map((r) => ({
        ...r,
        bucketStart: r.bucketStart.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AdminSecurityService)
    private readonly security: AdminSecurityService,
    @Inject(IdentityMailService) private readonly mail: IdentityMailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  async detect() {
    const { revision, policy } = await this.security.policy(),
      span = policy.alertWindowSeconds * 1000;
    const start = new Date(Math.floor(Date.now() / span) * span),
      end = new Date(+start + span);
    return this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'admin-security-alert:' + start.toISOString() + ':' + revision},0))::text`;
      const observed = await tx.adminAuditEvidence.count({
        where: {
          category: 'SECURITY',
          outcome: 'DENIED',
          createdAt: { gte: start, lt: end },
          action: {
            in: [
              'AUTH_SIGN_IN',
              'POST /sign-in/email',
              'POST /two-factor/verify-totp',
              'POST /two-factor/verify-backup-code',
            ],
          },
        },
      });
      if (observed < policy.alertThreshold) return false;
      const prior = await tx.adminSecurityAlert.findUnique({
        where: {
          rule_bucketStart_policyRevision: {
            rule: 'LOGIN_FAILURES',
            bucketStart: start,
            policyRevision: revision,
          },
        },
      });
      if (prior) return false;
      const alert = await tx.adminSecurityAlert.create({
        data: {
          rule: 'LOGIN_FAILURES',
          bucketStart: start,
          policyRevision: revision,
          severity: policy.alertSeverity,
          observed,
          threshold: policy.alertThreshold,
        },
      });
      if (policy.alertChannels.includes('EMAIL')) {
        await tx.$executeRaw`INSERT INTO "AdminSecurityAlertDelivery" ("alertId","adminUserId")
          SELECT ${alert.id}::uuid,id FROM "AdminUser"
          WHERE active AND "twoFactorEnabled" AND role IN ('SUPER_ADMIN','SECURITY_REVIEWER')
          AND ("signInBlockedUntil" IS NULL OR "signInBlockedUntil"<=clock_timestamp())`;
      }
      await tx.adminAuditEvent.create({
        data: {
          action: 'SECURITY_ALERT_RAISED',
          outcome: 'SUCCEEDED',
          requestId: randomUUID(),
          metadata: {
            alertId: alert.id,
            rule: alert.rule,
            severity: alert.severity,
            observed,
          },
        },
      });
      return true;
    });
  }
  async consume() {
    const detected = await this.detect();
    const row = await this.db.client.$transaction(async (tx) => {
      const [claim] = await tx.$queryRaw<
        { id: string; attempts: number }[]
      >`SELECT id,attempts FROM "AdminSecurityAlertDelivery" WHERE (state='PENDING' AND "nextAt"<=clock_timestamp()) OR (state='SENDING' AND "leaseUntil"<=clock_timestamp()) ORDER BY "nextAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!claim) return null;
      if (claim.attempts >= 8)
        return tx.adminSecurityAlertDelivery.update({
          where: { id: claim.id },
          data: { state: 'FAILED', leaseUntil: null },
        });
      return tx.adminSecurityAlertDelivery.update({
        where: { id: claim.id },
        data: {
          state: 'SENDING',
          attempts: { increment: 1 },
          leaseUntil: new Date(Date.now() + 60000),
        },
      });
    });
    if (!row) return detected;
    if (row.state === 'FAILED') return true;
    try {
      const user = await this.db.client.adminUser.findUnique({
        where: { id: row.adminUserId },
      });
      const state =
        !user?.active ||
        !user.twoFactorEnabled ||
        (user.signInBlockedUntil && user.signInBlockedUntil > new Date()) ||
        !permits(user.role, 'admin.security.read')
          ? 'CANCELED'
          : 'SENT';
      if (state === 'SENT') {
        const alert = await this.db.client.adminSecurityAlert.findUniqueOrThrow(
          { where: { id: row.alertId } },
        );
        await this.mail.send({
          metadata: {
            sourceKind: 'SECURITY_ALERT',
            sourceId: row.id,
            category: 'SECURITY_NOTICE',
            adminUserId: user!.id,
          },
          to: user!.email,
          kind: 'administrative',
          url: new URL(
            '/api/v1/admin/security/alerts',
            this.config.BETTER_AUTH_URL,
          ).toString(),
          message: `Security alert ${alert.severity}: repeated authentication failures crossed the configured threshold. Review the authorized security audit.`,
        });
      }
      await this.db.client.adminSecurityAlertDelivery.updateMany({
        where: { id: row.id, state: 'SENDING', attempts: row.attempts },
        data: { state, leaseUntil: null },
      });
    } catch {
      await this.db.client.adminSecurityAlertDelivery.updateMany({
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
