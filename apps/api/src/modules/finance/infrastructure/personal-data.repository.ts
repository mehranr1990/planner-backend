import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { ExportBudget } from '../../../platform/lifecycle/personal-data.js';
import { FinanceData } from '../public/personal-data.js';
@Injectable()
export class FinanceDataRepository extends FinanceData {
  override async detach(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    await tx.transaction.updateMany({
      where: { spaceId: scope.spaceId },
      data: { sourceCaptureId: null },
    });
  }
  async snapshot(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    budget: ExportBudget,
  ) {
    await budget.collect(
      'financialAccount',
      (after: string | undefined) =>
        tx.financialAccount.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
    await budget.collect(
      'financeCategory',
      (after: string | undefined) =>
        tx.financeCategory.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
    await budget.collect(
      'transaction',
      (after: string | undefined) =>
        tx.transaction.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
    await budget.collect(
      'transactionPosting',
      (after: string | undefined) =>
        tx.transactionPosting.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
    await budget.collect(
      'exchangeRateSnapshot',
      (after: string | undefined) =>
        tx.exchangeRateSnapshot.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
    await budget.collect(
      'budget',
      (after: string | undefined) =>
        tx.budget.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
    await budget.collect(
      'budgetPeriod',
      (after: string | undefined) =>
        tx.budgetPeriod.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
    await budget.collect(
      'bill',
      (after: string | undefined) =>
        tx.bill.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
    await budget.collect(
      'savingsGoal',
      (after: string | undefined) =>
        tx.savingsGoal.findMany({
          where: {
            spaceId: scope.spaceId,
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      (row) => row.id,
    );
  }
  async erase(tx: Prisma.TransactionClient, scope: AuthorizedSpace) {
    const where = { spaceId: scope.spaceId };
    await tx.budgetPeriod.deleteMany({ where });
    await tx.budget.deleteMany({ where });
    await tx.savingsGoal.deleteMany({ where });
    await tx.transactionPosting.deleteMany({ where });
    await tx.exchangeRateSnapshot.deleteMany({ where });
    await tx.transaction.deleteMany({ where });
    await tx.bill.deleteMany({ where });
    await tx.financeCategory.deleteMany({ where });
    await tx.financialAccount.deleteMany({ where });
  }
}
