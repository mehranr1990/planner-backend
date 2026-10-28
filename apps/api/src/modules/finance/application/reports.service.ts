import { Inject, Injectable } from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { FINANCE_REPOSITORY } from './finance.port.js';
import type { FinancePort, FinanceTransactionPort } from './finance.port.js';
import { units, amount } from '../domain/money.js';
import { midnight, validRange } from '../domain/dates.js';
import { check, scale } from './ledger.service.js';
export function csvText(value: string): string {
  const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
@Injectable()
export class FinanceReportsService {
  constructor(@Inject(FINANCE_REPOSITORY) private readonly repo: FinancePort) {}
  private async window(tx: FinanceTransactionPort, q: c.FinanceReportQuery) {
    check(() => validRange(q.from, q.to));
    const timezone = q.timezone ?? (await tx.preferences()).timezone;
    return {
      timezone,
      startAt: midnight(q.from, timezone),
      endAt: midnight(q.to, timezone),
    };
  }
  report(scope: AuthorizedSpace, q: c.FinanceReportQuery) {
    return this.repo.run(scope, async (tx) => {
      const w = await this.window(tx, q),
        rows = await tx.postings(w.startAt, w.endAt, q),
        groups = new Map<
          string,
          {
            income: bigint;
            expense: bigint;
            fees: bigint;
            transferIn: bigint;
            transferOut: bigint;
            adjustments: bigint;
            net: bigint;
          }
        >();
      for (const p of rows) {
        const g = groups.get(p.currency) ?? {
            income: 0n,
            expense: 0n,
            fees: 0n,
            transferIn: 0n,
            transferOut: 0n,
            adjustments: 0n,
            net: 0n,
          },
          n = units(p.amount, p.scale);
        g.net += n;
        switch (p.role) {
          case 'INCOME':
            g.income += n;
            break;
          case 'EXPENSE':
            g.expense -= n;
            break;
          case 'FEE':
            g.expense -= n;
            g.fees -= n;
            break;
          case 'TRANSFER_IN':
            g.transferIn += n;
            break;
          case 'TRANSFER_OUT':
            g.transferOut -= n;
            break;
          case 'ADJUSTMENT':
            g.adjustments += n;
            break;
        }
        groups.set(p.currency, g);
      }
      return c.FinanceReportSchema.parse({
        from: q.from,
        to: q.to,
        timezone: w.timezone,
        startAt: w.startAt.toISOString(),
        endAt: w.endAt.toISOString(),
        postingCount: rows.length,
        currencies: [...groups.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, g]) => ({
            currency,
            ...Object.fromEntries(
              Object.entries(g).map(([k, v]) => [
                k,
                amount(v, scale(currency)),
              ]),
            ),
          })),
        definitions: {
          window: 'START_INCLUSIVE_END_EXCLUSIVE',
          expense: 'EXPENSE_PLUS_FEE',
          reversals: 'RESTATED_ORIGINAL_PERIOD',
          currencies: 'GROUPED_WITHOUT_IMPLICIT_CONVERSION',
        },
      });
    });
  }
  export(scope: AuthorizedSpace, q: c.FinanceReportQuery) {
    return this.repo.run(scope, async (tx) => {
      const w = await this.window(tx, q);
      await tx.postings(w.startAt, w.endAt, q);
      const transactions = await tx.exportTransactions(w.startAt, w.endAt, q);
      await tx.audit('FINANCE_EXPORT', scope.spaceId);
      return {
        version: 1,
        from: q.from,
        to: q.to,
        timezone: w.timezone,
        transactions,
      };
    });
  }
}
