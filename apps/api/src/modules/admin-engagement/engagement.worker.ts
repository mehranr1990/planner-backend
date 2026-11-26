import { lockEngagementPersonal } from '../spaces/public/engagement-availability.js';
import { engagementPersonalOpen } from '../spaces/public/engagement-availability.js';
import { Injectable, Inject } from '@nestjs/common';
import { EngagementCore } from './engagement-core.js';
import { EngagementEvidence } from './engagement-evidence.js';
import { SupportService } from './support.service.js';
import { ModerationService } from './moderation.service.js';
import { CommunicationsService } from './communications.service.js';
import { EngagementDelivery } from '../notifications/public/engagement-delivery.js';
import { engagementIdentity } from '../account/public/engagement.js';
@Injectable()
export class EngagementWorker {
  private lastSweep = 0;
  constructor(
    @Inject(EngagementCore) private readonly core: EngagementCore,
    @Inject(EngagementEvidence) private readonly evidence: EngagementEvidence,
    @Inject(SupportService) private readonly support: SupportService,
    @Inject(ModerationService) private readonly moderation: ModerationService,
    @Inject(CommunicationsService)
    private readonly communications: CommunicationsService,
    @Inject(EngagementDelivery) private readonly delivery: EngagementDelivery,
  ) {}
  async consume() {
    this.core.privacy.assert();
    if (Date.now() - this.lastSweep > 30000) {
      await this.support.sweep();
      await this.moderation.sweep();
      await this.communications.sweep();
      const policy = await this.core.policy(this.core.db.client, 'SUPPORT');
      await this.core.db.client.p4UserReceipt.deleteMany({
        where: {
          createdAt: {
            lt: new Date(Date.now() - policy.retentionDays! * 86400000),
          },
        },
      });
      await this.evidence.sweep();
      await this.core.db.client.p4RateBucket.deleteMany({
        where: { startAt: { lt: new Date(Date.now() - 2 * 86400000) } },
      });
      await this.core.db.client.supportInboundReceipt.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 90 * 86400000) } },
      });
      this.lastSweep = Date.now();
    }
    const notice = await this.consumeNotice();
    return (await this.communications.consume()) || notice;
  }
  async consumeNotice() {
    const claim = await this.core.db.client.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        { id: string; deliveryState: string }[]
      >`SELECT id,"deliveryState" FROM "P4Notice" WHERE "userId" IS NOT NULL AND (("deliveryState"='PENDING' AND "nextAt"<=clock_timestamp()) OR ("deliveryState"='SENDING' AND "leaseUntil"<=clock_timestamp())) ORDER BY "nextAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!row) return null;
      if (row.deliveryState === 'SENDING') {
        await tx.p4Notice.update({
          where: { id: row.id },
          data: {
            deliveryState: 'AMBIGUOUS',
            lastCode: 'WORKER_ACCEPTANCE_UNKNOWN',
            leaseUntil: null,
          },
        });
        return { done: true as const };
      }
      const r = await tx.p4Notice.update({
        where: { id: row.id },
        data: {
          deliveryState: 'SENDING',
          attempts: { increment: 1 },
          leaseUntil: new Date(Date.now() + 60000),
        },
      });
      return {
        done: false as const,
        id: r.id,
        userId: r.userId!,
        attempt: r.attempts,
      };
    });
    if (!claim) return false;
    if (claim.done) return true;
    return this.core.db.client.$transaction(
      async (tx) => {
        const recipientOpen = await lockEngagementPersonal(
          tx,
          claim.userId,
          false,
        );
        await tx.$queryRaw`SELECT id FROM "P4Notice" WHERE id=${claim.id}::uuid FOR UPDATE`;
        const row = await tx.p4Notice.findUnique({ where: { id: claim.id } });
        if (
          !row ||
          row.deliveryState !== 'SENDING' ||
          row.attempts !== claim.attempt ||
          !row.leaseUntil ||
          row.leaseUntil <= new Date()
        )
          return true;
        let owner;
        try {
          owner = await engagementIdentity(tx, row.userId!);
        } catch {
          await tx.p4Notice.update({
            where: { id: row.id },
            data: {
              deliveryState: 'SUPPRESSED',
              lastCode: 'RECIPIENT_UNAVAILABLE',
            },
          });
          return true;
        }
        const essential = row.kind === 'MODERATION_OUTCOME',
          policy = await this.delivery.policy(tx, row.userId!, new Date());
        if (
          !recipientOpen ||
          !owner.active ||
          !(await engagementPersonalOpen(tx, row.userId!)) ||
          !owner.emailVerified ||
          (!essential && !policy.channels.EMAIL)
        ) {
          await tx.p4Notice.update({
            where: { id: row.id },
            data: {
              deliveryState: 'SUPPRESSED',
              lastCode: 'RECIPIENT_OR_PREFERENCE',
            },
          });
          return true;
        }
        if (!essential && policy.quietUntil && policy.quietUntil > new Date()) {
          await tx.p4Notice.update({
            where: { id: row.id },
            data: {
              deliveryState: 'PENDING',
              attempts: { decrement: 1 },
              nextAt: policy.quietUntil,
              leaseUntil: null,
            },
          });
          return false;
        }
        const result = await this.delivery.send(tx, {
          id: row.id,
          communicationId: row.id,
          userId: row.userId!,
          channel: 'EMAIL',
          subscriptionId: null,
          subscriptionRevision: null,
          email: owner.email,
          subject:
            'Mehran Planner: ' +
            (essential ? 'moderation outcome' : 'support ticket update'),
          body:
            'An update is available in your private ' +
            (essential ? 'moderation case.' : 'support ticket.') +
            ' Sign in to view it.',
        });
        await tx.p4Notice.update({
          where: { id: row.id },
          data: {
            deliveryState:
              result.outcome === 'ACCEPTED'
                ? 'SENT'
                : result.outcome === 'RETRY' && row.attempts < 5
                  ? 'PENDING'
                  : result.outcome === 'AMBIGUOUS'
                    ? 'AMBIGUOUS'
                    : 'FAILED',
            lastCode: result.code,
            leaseUntil: null,
            nextAt: new Date(Date.now() + 30000 * 2 ** row.attempts),
          },
        });
        return true;
      },
      { timeout: 30000 },
    );
  }
}
