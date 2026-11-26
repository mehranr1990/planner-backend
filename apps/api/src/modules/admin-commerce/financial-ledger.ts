import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { minor, bounded } from './domain/commercial-policy.js';
import { fail } from './commerce-core.js';
const balanceKinds = [
  'CHARGE',
  'ADJUSTMENT',
  'PAYMENT',
  'CREDIT_APPLY',
  'CREDIT_TRANSFER',
  'WRITE_OFF',
];
const creditKinds = ['CREDIT_GRANT', 'CREDIT_APPLY', 'CREDIT_REFUND'];
@Injectable()
export class FinancialLedger {
  async sum(
    tx: Prisma.TransactionClient,
    where: Prisma.CommerceLedgerWhereInput,
  ) {
    return minor(
      (await tx.commerceLedger.aggregate({ where, _sum: { amount: true } }))
        ._sum.amount ?? '0',
    );
  }
  async balance(tx: Prisma.TransactionClient, id: string) {
    const value = await this.sum(tx, {
      invoiceId: id,
      kind: { in: balanceKinds },
    });
    return value > 0n ? value : 0n;
  }
  async credit(
    tx: Prisma.TransactionClient,
    customerId: string,
    currency: string,
  ) {
    const value = await this.sum(tx, {
      customerId,
      currency,
      kind: { in: creditKinds },
    });
    if (value < 0n) fail('NEGATIVE_CREDIT_INVARIANT');
    return value;
  }
  async entry(
    tx: Prisma.TransactionClient,
    data: Omit<Prisma.CommerceLedgerUncheckedCreateInput, 'amount'> & {
      amount: bigint;
    },
  ) {
    return tx.commerceLedger.create({
      data: { ...data, amount: bounded(data.amount) },
    });
  }
  async consumeCredit(
    tx: Prisma.TransactionClient,
    customerId: string,
    currency: string,
    amount: bigint,
    invoiceId: string,
    key: string,
  ) {
    if ((await this.credit(tx, customerId, currency)) < amount)
      fail('INSUFFICIENT_CREDIT');
    const pools = await tx.commerceLedger.groupBy({
      by: ['paymentId'],
      where: { customerId, currency, kind: { in: creditKinds } },
      _sum: { amount: true },
      orderBy: { paymentId: 'asc' },
    });
    let remaining = amount;
    for (const pool of pools) {
      const available = minor(pool._sum.amount ?? '0');
      if (available <= 0n || !pool.paymentId || remaining === 0n) continue;
      const take = remaining < available ? remaining : available;
      await this.entry(tx, {
        customerId,
        currency,
        invoiceId,
        paymentId: pool.paymentId,
        kind: 'CREDIT_APPLY',
        amount: -take,
        sourceKey: key + ':' + pool.paymentId,
      });
      remaining -= take;
    }
    if (remaining !== 0n) fail('CREDIT_BACKING_REQUIRED');
  }
  async grantCredit(
    tx: Prisma.TransactionClient,
    customerId: string,
    currency: string,
    amount: bigint,
    key: string,
    where: Prisma.CommercePaymentWhereInput,
    invoiceId: string | null = null,
    subscriptionId: string | null = null,
  ) {
    const payments = await tx.commercePayment.findMany({
      where: { ...where, customerId, currency, state: 'VERIFIED' },
      include: { r_CommerceRefund_paymentId: true },
      orderBy: { id: 'asc' },
    });
    let remaining = amount;
    for (const p of payments) {
      const issued = await this.sum(tx, {
        paymentId: p.id,
        kind: { in: ['CREDIT_GRANT', 'CREDIT_REFUND'] },
      });
      const budget =
        minor(p.amount) -
        p.r_CommerceRefund_paymentId.reduce((n, r) => n + minor(r.amount), 0n) -
        issued;
      if (budget <= 0n || remaining === 0n) continue;
      const take = budget < remaining ? budget : remaining;
      await this.entry(tx, {
        customerId,
        currency,
        invoiceId,
        subscriptionId,
        paymentId: p.id,
        kind: 'CREDIT_GRANT',
        amount: take,
        sourceKey: key + ':' + p.id,
      });
      remaining -= take;
    }
    return amount - remaining;
  }
}
