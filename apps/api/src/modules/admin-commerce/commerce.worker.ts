import { Inject, Injectable, HttpException } from '@nestjs/common';
import { CommerceCore } from './commerce-core.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { effectiveSubscription, dayMs } from './domain/commercial-policy.js';
@Injectable()
export class CommerceWorker {
  constructor(
    @Inject(CommerceCore) readonly core: CommerceCore,
    @Inject(SubscriptionsService) readonly subscriptions: SubscriptionsService,
  ) {}
  async consume() {
    this.core.privacy.assert();
    const now = new Date();
    const hints = await this.core.db.client.commerceSubscription.findMany({
      where: { nextAt: { lte: now } },
      orderBy: [{ nextAt: 'asc' }, { id: 'asc' }],
      select: { id: true, customerId: true },
      take: 50,
    });
    for (const hint of hints)
      await this.core.db.client
        .$transaction(
          async (tx) => {
            const customer = await this.core.customer(tx, hint.customerId),
              s = await tx.commerceSubscription.findUniqueOrThrow({
                where: { id: hint.id },
              });
            if (s.nextAt > new Date()) return;
            if (customer.closedAt || !customer.spaceId) {
              if (s.state !== 'CANCELED') {
                await tx.commerceSubscription.update({
                  where: { id: s.id },
                  data: {
                    state: 'CANCELED',
                    pausedAt: null,
                    pauseClock: null,
                    cancelAtEnd: true,
                    revision: { increment: 1 },
                    nextAt: new Date(now.getTime() + 36500 * dayMs),
                  },
                });
                await this.core.event(
                  tx,
                  customer.id,
                  'SCOPE_DETACHED',
                  'Live customer scope erased; financial history retained',
                  s.id,
                );
              }
              return;
            }
            if (
              s.scheduledPriceId &&
              s.scheduledOrigin &&
              s.endsAt &&
              s.endsAt <= now &&
              s.scheduledChange === 'TERM_END'
            ) {
              // The operator committed a future grant; no payment-provider side effect.
              await this.subscriptions.change(
                tx,
                s,
                s.scheduledPriceId,
                s.scheduledOrigin,
                false,
                'Previously authorized scheduled plan change',
                undefined,
                s.endsAt,
              );
              return;
            }
            const effective = effectiveSubscription(s, now);
            const policy = await tx.commercePolicy.findUniqueOrThrow({
              where: { id: 'GLOBAL' },
            });
            if (
              s.endsAt &&
              s.state !== 'CANCELED' &&
              !(s.state === 'PAUSED' && s.pauseClock === 'FREEZE')
            ) {
              const notices = [
                {
                  kind: 'PRE_EXPIRY',
                  dueAt: new Date(
                    s.endsAt.getTime() - policy.preExpiryDays * dayMs,
                  ),
                },
                {
                  kind: 'POST_EXPIRY',
                  dueAt: new Date(
                    s.endsAt.getTime() + policy.postExpiryDays * dayMs,
                  ),
                },
              ];
              for (const n of notices) {
                const key = n.kind + ':' + s.id + ':' + s.endsAt.toISOString();
                await tx.commerceNotice.upsert({
                  where: { key },
                  create: {
                    customerId: s.customerId,
                    subscriptionId: s.id,
                    key,
                    kind: n.kind,
                    dueAt: n.dueAt,
                    publishedAt: n.dueAt <= now ? now : null,
                  },
                  update: {},
                });
              }
            }
            if (effective !== s.state) {
              await this.core.event(
                tx,
                s.customerId,
                'SUBSCRIPTION_' + effective,
                'Authoritative UTC term reconciliation',
                s.id,
              );
            }
            const end = s.endsAt?.getTime(),
              grace = end ? end + s.graceDays * dayMs : null;
            const next = [
              now.getTime() + dayMs,
              ...(end && end > now.getTime() ? [end] : []),
              ...(end && end - policy.preExpiryDays * dayMs > now.getTime()
                ? [end - policy.preExpiryDays * dayMs]
                : []),
              ...(grace && grace > now.getTime() ? [grace] : []),
            ];
            await tx.commerceSubscription.update({
              where: { id: s.id },
              data: {
                state: effective,
                ...(effective !== 'PAUSED'
                  ? { pausedAt: null, pauseClock: null }
                  : {}),
                ...(effective !== s.state
                  ? { revision: { increment: 1 } }
                  : {}),
                nextAt: new Date(Math.min(...next)),
              },
            });
          },
          { timeout: 20000 },
        )
        .catch(async (error) => {
          if (!(error instanceof HttpException)) throw error;
          await this.core.db.client.$transaction(async (tx) => {
            await this.core.customer(tx, hint.customerId);
            const sub = await tx.commerceSubscription.findUniqueOrThrow({
              where: { id: hint.id },
            });
            if (sub.scheduledPriceId) {
              await tx.commerceSubscription.update({
                where: { id: sub.id },
                data: {
                  scheduledPriceId: null,
                  scheduledChange: null,
                  scheduledOrigin: null,
                  revision: { increment: 1 },
                  nextAt: new Date(),
                },
              });
              await this.core.event(
                tx,
                sub.customerId,
                'SCHEDULED_CHANGE_REVIEW',
                'Current eligibility prevents the scheduled grant',
                sub.id,
              );
              await tx.commerceNotice.upsert({
                where: {
                  key: 'scheduled-review:' + sub.id + ':' + sub.revision,
                },
                create: {
                  customerId: sub.customerId,
                  subscriptionId: sub.id,
                  key: 'scheduled-review:' + sub.id + ':' + sub.revision,
                  kind: 'SCHEDULED_CHANGE_REVIEW',
                  dueAt: new Date(),
                  publishedAt: new Date(),
                },
                update: {},
              });
            } else
              await tx.commerceSubscription.update({
                where: { id: sub.id },
                data: { nextAt: new Date(Date.now() + dayMs) },
              });
          });
        });
    const notices = await this.core.db.client.commerceNotice.findMany({
      where: { publishedAt: null, dueAt: { lte: new Date() } },
      select: { id: true, customerId: true },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    for (const hint of notices)
      await this.core.db.client.$transaction(async (tx) => {
        const customer = await this.core.customer(tx, hint.customerId),
          notice = await tx.commerceNotice.findUnique({
            where: { id: hint.id },
          });
        if (!notice || notice.publishedAt) return;
        const sub = notice.subscriptionId
          ? await tx.commerceSubscription.findUnique({
              where: { id: notice.subscriptionId },
            })
          : null;
        const current =
          !customer.closedAt &&
          sub &&
          sub.state !== 'CANCELED' &&
          !(sub.state === 'PAUSED' && sub.pauseClock === 'FREEZE') &&
          sub.endsAt &&
          notice.key ===
            notice.kind + ':' + sub.id + ':' + sub.endsAt.toISOString();
        if (!current)
          await tx.commerceNotice.delete({ where: { id: notice.id } });
        else
          await tx.commerceNotice.update({
            where: { id: notice.id },
            data: { publishedAt: new Date() },
          });
      });
    return hints.length > 0 || notices.length > 0;
  }
}
