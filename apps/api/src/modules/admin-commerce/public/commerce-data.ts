import { Injectable } from '@nestjs/common';
import {
  PersonalData,
  type ExportBudget,
} from '../../../platform/lifecycle/personal-data.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { commerceLock } from './entitlements.js';
/** Personal portability includes owned financial records, excluding operator notes. */
@Injectable()
export class CommerceData extends PersonalData {
  async snapshot(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    budget: ExportBudget,
  ) {
    const customer = await tx.commerceCustomer.findFirst({
      where: { spaceId: scope.spaceId, kind: 'PERSONAL' },
    });
    if (!customer) return;
    await commerceLock(tx, customer.id);
    budget.add('commercialCustomer', [
      { id: customer.id, kind: customer.kind },
    ]);
    await budget.collect(
      'commercialSubscriptions',
      (after: string | undefined) =>
        tx.commerceSubscription.findMany({
          where: {
            customerId: customer.id,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 250,
          select: {
            id: true,
            productId: true,
            versionId: true,
            priceId: true,
            state: true,
            kind: true,
            startsAt: true,
            endsAt: true,
            origin: true,
            cancelAtEnd: true,
            pauseClock: true,
            pausedAt: true,
            renewal: true,
          },
        }),
      (r) => r.id,
    );
    await budget.collect(
      'commercialTerms',
      (after: string | undefined) =>
        tx.commerceTerm.findMany({
          where: {
            r_subscriptionId: { customerId: customer.id },
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 250,
          include: { shifts: true, closure: true },
        }),
      (r) => r.id,
    );
    await budget.collect(
      'commercialInvoices',
      (after: string | undefined) =>
        tx.commerceInvoice.findMany({
          where: {
            customerId: customer.id,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 250,
          include: { r_CommerceInvoiceVersion_invoiceId: true },
        }),
      (r) => r.id,
    );
    await budget.collect(
      'commercialPayments',
      (after: string | undefined) =>
        tx.commercePayment.findMany({
          where: {
            customerId: customer.id,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 250,
          select: {
            id: true,
            invoiceId: true,
            subscriptionId: true,
            termId: true,
            methodId: true,
            reference: true,
            currency: true,
            amount: true,
            state: true,
            verifiedAt: true,
            createdAt: true,
          },
        }),
      (r) => r.id,
    );
    await budget.collect(
      'commercialRefunds',
      async (after: string | undefined) =>
        (
          await tx.commerceRefund.findMany({
            where: {
              customerId: customer.id,
              ...(after ? { id: { gt: after } } : {}),
            },
            orderBy: { id: 'asc' },
            take: 250,
          })
        ).map((r) => ({
          id: r.id,
          paymentId: r.paymentId,
          currency: r.currency,
          amount: r.amount,
          reference: r.reference,
          createdAt: r.createdAt,
        })),
      (r) => r.id,
    );
  }
  async erase(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    const rows = await tx.commerceCustomer.findMany({
      where: { spaceId: scope.spaceId, kind: 'PERSONAL' },
    });
    for (const row of rows) {
      await commerceLock(tx, row.id);
      await tx.commerceCustomer.update({
        where: { id: row.id },
        data: {
          spaceId: null,
          scopeId: null,
          closedAt: new Date(),
          revision: { increment: 1 },
        },
      });
      await tx.commerceSubscription.updateMany({
        where: { customerId: row.id },
        data: {
          state: 'CANCELED',
          cancelAtEnd: true,
          pausedAt: null,
          pauseClock: null,
          revision: { increment: 1 },
        },
      });
    }
    await tx.commerceFinancialGrant.deleteMany({
      where: { userId: scope.actor.userId },
    });
    await tx.commerceReceipt.deleteMany({
      where: { userId: scope.actor.userId },
    });
  }
}
