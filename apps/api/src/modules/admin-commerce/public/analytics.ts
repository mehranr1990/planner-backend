import { Inject, Injectable, ConflictException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { BillingService } from '../billing.service.js';
import { effectiveSubscription } from '../domain/commercial-policy.js';
import { termWindow } from '../domain/term-clock.js';
import { minor } from '../domain/commercial-policy.js';
import { adminCommerceRoutes } from '@mehran/api-contracts';
/** Authoritative P5 calculations remain owned by Commerce. No analytics ledger. */
@Injectable()
export class CommerceAnalytics {
  constructor(@Inject(BillingService) readonly billing: BillingService) {}
  async financial(
    tx: Prisma.TransactionClient,
    from: string,
    to: string,
    minimum: number,
  ) {
    const result = await this.billing.analyticsReport(tx, { from, to }, true);
    const report =
      adminCommerceRoutes['GET commerce/reports'].response.parse(result);
    const payments = await tx.commercePayment.findMany({
      where: {
        state: 'VERIFIED',
        verifiedAt: { gte: new Date(from), lt: new Date(to) },
      },
      select: {
        customerId: true,
        currency: true,
        r_termId: { select: { r_versionId: { select: { productId: true } } } },
      },
      take: 10001,
    });
    if (payments.length > 10000)
      throw new ConflictException({ code: 'ANALYTICS_ROW_LIMIT' });
    const groups = new Map<string, Set<string>>();
    for (const row of payments) {
      for (const key of [
        row.currency,
        row.currency +
          ':' +
          (row.r_termId?.r_versionId.productId ?? 'unattributed'),
      ]) {
        const group = groups.get(key) ?? new Set<string>();
        group.add(row.customerId);
        groups.set(key, group);
      }
    }
    let suppressed =
      !groups.size ||
      [...groups.values()].some((g) => g.size < minimum) ||
      report.currencies.some(
        (r) =>
          r.conversionNumerator < minimum || r.conversionDenominator < minimum,
      );
    const terms = await tx.commerceTerm.findMany({
      where: {
        origin: 'EXTERNAL',
        startsAt: { lt: new Date(Math.max(Date.parse(to), Date.now())) },
      },
      include: {
        shifts: true,
        closure: true,
        r_subscriptionId: true,
        r_CommercePayment_termId: {
          where: { state: 'VERIFIED' },
          include: { r_CommerceRefund_paymentId: true },
        },
      },
      take: 10001,
    });
    if (terms.length > 10000)
      throw new ConflictException({ code: 'ANALYTICS_ROW_LIMIT' });
    const ledgerGroups = await tx.commerceLedger.groupBy({
      by: ['currency', 'kind', 'customerId'],
      where: { createdAt: { lt: new Date() } },
      _count: true,
      orderBy: { customerId: 'asc' },
      take: 10001,
    });
    if (ledgerGroups.length > 10000)
      throw new ConflictException({ code: 'ANALYTICS_ROW_LIMIT' });
    const privacyGroups = new Map<string, Set<string>>();
    for (const row of ledgerGroups) {
      const key = row.currency + ':' + row.kind,
        group = privacyGroups.get(key) ?? new Set<string>();
      group.add(row.customerId);
      privacyGroups.set(key, group);
    }
    if ([...privacyGroups.values()].some((g) => g.size < minimum))
      suppressed = true;
    const prices = result.prices ?? [];
    if (prices.some((p) => p.payingCustomers < minimum)) suppressed = true;
    const economics = [];
    for (const currency of report.currencies.map((c) => c.currency)) {
      const paidAt = (at: Date) =>
        new Set(
          terms
            .filter((t) => {
              const w = termWindow(t);
              return (
                t.currency === currency &&
                w.startsAt <= at &&
                (!w.endsAt || w.endsAt > at) &&
                t.r_CommercePayment_termId.some(
                  (p) =>
                    p.verifiedAt &&
                    p.verifiedAt <= at &&
                    minor(p.amount) >
                      p.r_CommerceRefund_paymentId
                        .filter((r) => r.createdAt <= at)
                        .reduce((n, r) => n + minor(r.amount), 0n),
                )
              );
            })
            .map((t) => t.r_subscriptionId.customerId),
        );
      const before = paidAt(new Date(from)),
        after = paidAt(new Date(to)),
        churned = [...before].filter((id) => !after.has(id)).length;
      if (
        report.currencies.some(
          (r) => r.currency === currency && r.mrr !== '0',
        ) &&
        paidAt(new Date(report.snapshotAt)).size < minimum
      )
        suppressed = true;
      const first = await tx.commercePayment.groupBy({
        by: ['customerId'],
        where: {
          currency,
          state: 'VERIFIED',
          amount: { gt: 0 },
          verifiedAt: { lt: new Date(to) },
        },
        _min: { verifiedAt: true },
        take: 10001,
        orderBy: { customerId: 'asc' },
      });
      if (first.length > 10000)
        throw new ConflictException({ code: 'ANALYTICS_ROW_LIMIT' });
      const freeToPaid = first.filter(
        (p) => p._min.verifiedAt && p._min.verifiedAt >= new Date(from),
      ).length;
      const denominator = await tx.commerceCustomer.count({
        where: { createdAt: { lt: new Date(to) } },
      });
      const hidden =
        before.size < minimum ||
        churned < minimum ||
        freeToPaid < minimum ||
        denominator < minimum;
      economics.push({
        currency,
        paidAtStart: hidden ? null : before.size,
        churned: hidden ? null : churned,
        churnRate: hidden ? null : churned / before.size,
        freeToPaid: hidden ? null : freeToPaid,
        conversionDenominator: hidden ? null : denominator,
        suppressed: hidden,
      });
    }
    return {
      suppressed,
      report: suppressed ? null : report,
      economics,
      prices: suppressed ? [] : prices,
    };
  }
  async segments(
    tx: Prisma.TransactionClient,
    planId: string,
    at = new Date(),
  ) {
    const rows = await tx.commerceSubscription.findMany({
      where: { productId: planId, r_customerId: { closedAt: null } },
      include: { r_customerId: true },
      take: 10001,
    });
    if (rows.length > 10000)
      throw new ConflictException({ code: 'ANALYTICS_ROW_LIMIT' });
    return rows
      .filter((s) => effectiveSubscription(s, at) === 'ACTIVE')
      .map((s) => s.r_customerId.scopeId ?? s.r_customerId.spaceId)
      .filter((v): v is string => !!v);
  }
}
