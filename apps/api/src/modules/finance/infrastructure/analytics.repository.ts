import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { AnalyticsFinance } from '../public/analytics.js';
import { FinancePreferences } from '../../account/public/index.js';
import { FinanceCaptures } from '../../capture/public/index.js';
import { Store } from './finance.repository.js';
import { units, amount } from '../domain/money.js';
import { midnight } from '../domain/dates.js';
import type { InsightReadModel } from '@mehran/api-contracts';
@Injectable()
export class AnalyticsFinanceRepository extends AnalyticsFinance {
  constructor(
    @Inject(FinancePreferences) private readonly account: FinancePreferences,
    @Inject(FinanceCaptures) private readonly captures: FinanceCaptures,
  ) {
    super();
  }
  async read(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    r: Parameters<AnalyticsFinance['read']>[2],
  ): Promise<InsightReadModel> {
    const store = new Store(tx, scope, this.account, this.captures),
      rows = await store.postings(
        midnight(r.from, r.timezone),
        midnight(r.to, r.timezone),
        {},
      );
    return {
      metrics: (from, to) => {
        const start = midnight(from, r.timezone).getTime(),
          end = midnight(to, r.timezone).getTime();
        const groups = new Map<
          string,
          { scale: number; income: bigint; expense: bigint; fees: bigint }
        >();
        for (const row of rows) {
          const at = Date.parse(row.occurredAt);
          if (at < start || at >= end) continue;
          const g = groups.get(row.currency) ?? {
              scale: row.scale,
              income: 0n,
              expense: 0n,
              fees: 0n,
            },
            n = units(row.amount, row.scale);
          if (row.role === 'INCOME') g.income += n;
          if (row.role === 'EXPENSE' || row.role === 'FEE') g.expense -= n;
          if (row.role === 'FEE') g.fees -= n;
          groups.set(row.currency, g);
        }
        return [...groups]
          .sort(([a], [b]) => a.localeCompare(b))
          .flatMap(([currency, g]) =>
            (['income', 'expense', 'fees'] as const).map((k) => ({
              id: 'finance.' + k,
              sourceType: 'TRANSACTION_POSTING' as const,
              currency,
              value: amount(g[k], g.scale),
              definition:
                'SIGNED_LEDGER_EFFECTS_FEES_AS_EXPENSE_TRANSFER_PRINCIPAL_ADJUSTMENTS_EXCLUDED_REVERSALS_RESTATED',
            })),
          );
      },
    };
  }
}
