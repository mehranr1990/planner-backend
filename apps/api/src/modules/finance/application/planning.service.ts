import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { FINANCE_REPOSITORY } from './finance.port.js';
import type { FinancePort, In, Kind } from './finance.port.js';
import {
  LedgerService,
  check,
  money,
  scale,
  revision,
  key,
} from './ledger.service.js';
import {
  localDate,
  midnight,
  periodDates,
  validRange,
  addDays,
  dueOn,
} from '../domain/dates.js';
import { units, amount } from '../domain/money.js';
@Injectable()
export class FinancePlanningService {
  constructor(
    @Inject(FINANCE_REPOSITORY) readonly repo: FinancePort,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}
  get<K extends Kind>(scope: AuthorizedSpace, kind: K, id: string) {
    return this.repo.run(scope, (tx) => tx.get(kind, id));
  }
  list<K extends Kind>(scope: AuthorizedSpace, kind: K, q: c.FinanceQuery) {
    return this.repo.run(scope, (tx) => tx.list(kind, q));
  }
  history(scope: AuthorizedSpace, id: string, q: c.FinanceQuery) {
    return this.repo.run(scope, (tx) => tx.history(id, q));
  }
  updateAccount(
    scope: AuthorizedSpace,
    id: string,
    r: number,
    input: In<typeof c.FinanceAccountPatchSchema>,
  ) {
    return this.repo.run(scope, async (tx) => {
      revision(await tx.get('account', id), r);
      const v = await tx.update('account', id, r, input);
      await tx.audit('FINANCE_ACCOUNT_CHANGE', id);
      return v;
    });
  }
  updateCategory(
    scope: AuthorizedSpace,
    id: string,
    r: number,
    input: In<typeof c.FinanceCategoryPatchSchema>,
  ) {
    return this.repo.run(scope, async (tx) => {
      revision(await tx.get('category', id), r);
      const v = await tx.update('category', id, r, input);
      await tx.audit('FINANCE_CATEGORY_CHANGE', id);
      return v;
    });
  }
  createBudget(
    scope: AuthorizedSpace,
    k: string | undefined,
    input: In<typeof c.FinanceBudgetCreateSchema>,
  ) {
    return this.repo.once(
      scope,
      'post.finance.budget',
      key(k),
      input,
      async (tx) => {
        const p = await tx.preferences(),
          s = scale(input.currency);
        await this.ledger.category(tx, input.categoryId, 'EXPENSE');
        const result = await tx.createBudget({
          ...input,
          limit: money(input.limit, s),
          scale: s,
          timezone: input.timezone ?? p.timezone,
          calendar: input.calendar ?? p.calendar,
          firstDayOfWeek: input.firstDayOfWeek ?? p.firstDayOfWeek,
        });
        await tx.audit('FINANCE_BUDGET_CHANGE', result.id);
        return result;
      },
    );
  }
  updateBudget(
    scope: AuthorizedSpace,
    id: string,
    r: number,
    input: In<typeof c.FinanceBudgetPatchSchema>,
  ) {
    return this.repo.run(scope, async (tx) => {
      const b = await tx.get('budget', id);
      revision(b, r);
      if (input.categoryId !== undefined)
        await this.ledger.category(tx, input.categoryId, 'EXPENSE');
      const result = await tx.update('budget', id, r, {
        ...input,
        ...(input.limit ? { limit: money(input.limit, b.scale) } : {}),
      });
      await tx.audit('FINANCE_BUDGET_CHANGE', id);
      return result;
    });
  }
  createPeriod(
    scope: AuthorizedSpace,
    id: string,
    r: number,
    k: string | undefined,
    input: In<typeof c.FinancePeriodCreateSchema>,
  ) {
    return this.repo.once(
      scope,
      'post.finance.period',
      key(k),
      { id, r, input },
      async (tx) => {
        const b = await tx.get('budget', id);
        revision(b, r);
        if (b.archived) throw new ConflictException();
        if (b.period !== 'CUSTOM' && input.endDate !== undefined)
          throw new BadRequestException();
        const dates = check(() =>
          periodDates(
            input.date,
            b.period,
            b.calendar,
            b.firstDayOfWeek,
            input.endDate,
          ),
        );
        const v = await tx.createPeriod({
          budgetId: id,
          ...dates,
          startAt: midnight(dates.startDate, b.timezone).toISOString(),
          endAt: midnight(dates.endDate, b.timezone).toISOString(),
          timezone: b.timezone,
          calendar: b.calendar,
          firstDayOfWeek: b.firstDayOfWeek,
          currency: b.currency,
          scale: b.scale,
          limit: b.limit,
          categoryId: b.categoryId,
        });
        await tx.audit('FINANCE_BUDGET_CHANGE', id);
        return v;
      },
    );
  }
  periods(scope: AuthorizedSpace, id: string, q: c.FinanceQuery) {
    return this.repo.run(scope, async (tx) => {
      await tx.get('budget', id);
      return tx.list('period', q, id);
    });
  }
  updatePeriod(
    scope: AuthorizedSpace,
    id: string,
    periodId: string,
    r: number,
    input: In<typeof c.FinancePeriodPatchSchema>,
  ) {
    return this.repo.run(scope, async (tx) => {
      await tx.get('budget', id);
      const p = await tx.get('period', periodId);
      if (p.budgetId !== id) throw new BadRequestException();
      revision(p, r);
      const v = await tx.update('period', periodId, r, {
        limit: money(input.limit, p.scale),
      });
      await tx.audit('FINANCE_BUDGET_CHANGE', id);
      return v;
    });
  }
  createBill(
    scope: AuthorizedSpace,
    k: string | undefined,
    input: In<typeof c.FinanceBillCreateSchema>,
  ) {
    return this.repo.once(
      scope,
      'post.finance.bill',
      key(k),
      input,
      async (tx) => {
        const a = await tx.get('account', input.accountId);
        if (a.archived) throw new ConflictException();
        await this.ledger.category(tx, input.categoryId, input.type);
        const timezone = input.timezone ?? (await tx.preferences()).timezone;
        if (input.schedule?.until && input.schedule.until < input.dueDate)
          throw new BadRequestException();
        const v = await tx.createBill({
          ...input,
          timezone,
          currency: a.currency,
          scale: a.scale,
          amount: money(input.amount, a.scale),
          effectiveFrom: input.dueDate,
          archived: false,
        });
        await tx.audit('FINANCE_BILL_CHANGE', v.id);
        return v;
      },
    );
  }
  updateBill(
    scope: AuthorizedSpace,
    id: string,
    r: number,
    input: In<typeof c.FinanceBillPatchSchema>,
  ) {
    return this.repo.run(scope, async (tx) => {
      const b = await tx.get('bill', id);
      revision(b, r);
      if (
        input.effectiveFrom < localDate(new Date(), b.timezone) ||
        input.effectiveFrom < b.effectiveFrom
      )
        throw new BadRequestException();
      const categoryId =
        input.categoryId === undefined ? b.categoryId : input.categoryId;
      await this.ledger.category(tx, categoryId, b.type);
      const data = {
        ...b,
        effectiveFrom: input.effectiveFrom,
        name: input.name ?? b.name,
        archived: input.archived ?? b.archived,
        dueDate: input.dueDate ?? b.dueDate,
        schedule: input.schedule === undefined ? b.schedule : input.schedule,
        categoryId,
        amount: input.amount ? money(input.amount, b.scale) : b.amount,
      };
      if (data.schedule?.until && data.schedule.until < data.dueDate)
        throw new BadRequestException();
      const v = await tx.createBill(data, b);
      await tx.audit('FINANCE_BILL_CHANGE', id);
      return v;
    });
  }
  versions(
    scope: AuthorizedSpace,
    kind: 'bill' | 'savings',
    id: string,
    q: c.FinanceQuery,
  ) {
    return this.repo.run(scope, (tx) => tx.versions(kind, id, q));
  }
  private versionFor(versions: c.FinanceBill[], date: string) {
    return versions.filter((v) => v.effectiveFrom <= date).at(-1);
  }
  preview(
    scope: AuthorizedSpace,
    id: string,
    q: In<typeof c.FinanceBillPreviewQuerySchema>,
  ) {
    return this.repo.run(scope, async (tx) => {
      const versions = await tx.billVersions(id),
        b = await tx.get('bill', id);
      check(() => validRange(q.from, q.to));
      let start = q.from;
      const filter = JSON.stringify([id, q.from, q.to, b.revision]);
      if (q.cursor) {
        try {
          const raw = JSON.parse(
            Buffer.from(q.cursor, 'base64url').toString('utf8'),
          ) as {
            spaceId: string;
            actor: string;
            filter: string;
            after: string;
          };
          if (
            raw.spaceId !== scope.spaceId ||
            raw.actor !== scope.actor.userId ||
            raw.filter !== filter ||
            typeof raw.after !== 'string' ||
            raw.after < q.from ||
            raw.after >= q.to
          )
            throw Error();
          start = addDays(raw.after, 1);
        } catch {
          throw new BadRequestException();
        }
      }
      const items: In<typeof c.FinanceBillOccurrenceSchema>[] = [],
        limit = Number(q.limit ?? 25);
      let nextCursor: string | null = null;
      for (let d = start; d < q.to; d = addDays(d, 1)) {
        const v = this.versionFor(versions, d),
          paid = await tx.billPayment(id, d);
        if (
          !paid &&
          (!v || v.archived || !check(() => dueOn(d, v.dueDate, v.schedule)))
        )
          continue;
        if (items.length === limit) {
          const last = items.at(-1)!;
          nextCursor = Buffer.from(
            JSON.stringify({
              spaceId: scope.spaceId,
              actor: scope.actor.userId,
              filter,
              after: last.occurrenceKey,
            }),
          ).toString('base64url');
          break;
        }
        const spec = v ?? b;
        items.push({
          billId: id,
          billRevision: b.revision,
          occurrenceKey: d,
          dueDate: d,
          currency: paid?.postings[0]?.currency ?? spec.currency,
          amount: paid
            ? amount(
                ((n) => (n < 0n ? -n : n))(
                  units(paid.postings[0]!.amount, spec.scale),
                ),
                spec.scale,
              )
            : spec.amount,
          state: paid
            ? paid.state === 'REVERSED'
              ? 'REVERSED'
              : 'PAID'
            : 'UNPAID',
          transactionId: paid?.id ?? null,
        });
      }
      return c.FinanceBillOccurrencePageSchema.parse({ items, nextCursor });
    });
  }
  payBill(
    scope: AuthorizedSpace,
    id: string,
    r: number,
    k: string | undefined,
    input: In<typeof c.FinanceBillPostSchema>,
  ) {
    return this.repo.once(
      scope,
      'post.finance.bill_pay',
      key(k),
      { id, r, input },
      async (tx) => {
        const current = await tx.get('bill', id);
        revision(current, r);
        if (await tx.billPayment(id, input.occurrenceKey))
          throw new ConflictException();
        const b = this.versionFor(
          await tx.billVersions(id),
          input.occurrenceKey,
        );
        if (
          !b ||
          b.archived ||
          !check(() => dueOn(input.occurrenceKey, b.dueDate, b.schedule))
        )
          throw new BadRequestException();
        let result: c.FinanceTransaction;
        if (input.transactionId) {
          const t = await tx.get('transaction', input.transactionId);
          if (input.transactionRevision === undefined)
            throw new BadRequestException();
          revision(t, input.transactionRevision);
          const p = t.postings[0];
          if (
            t.state !== 'POSTED' ||
            t.effect !== 'POSTED' ||
            t.billId ||
            t.type !== b.type ||
            t.postings.length !== 1 ||
            !p ||
            p.accountId !== b.accountId ||
            p.currency !== b.currency ||
            (units(p.amount, b.scale) < 0n
              ? -units(p.amount, b.scale)
              : units(p.amount, b.scale)) !== units(b.amount, b.scale)
          )
            throw new BadRequestException();
          result = await tx.linkBill(t.id, t.revision, id, input.occurrenceKey);
        } else
          result = await this.ledger.postInside(
            tx,
            {
              type: b.type,
              accountId: b.accountId,
              amount: b.amount,
              categoryId: b.categoryId,
              note: null,
              occurredAt: input.occurredAt,
              timezone: input.timezone ?? b.timezone,
            },
            { billId: id, occurrenceKey: input.occurrenceKey },
          );
        await tx.audit('FINANCE_BILL_CHANGE', id);
        return result;
      },
    );
  }
  createSavings(
    scope: AuthorizedSpace,
    k: string | undefined,
    input: In<typeof c.FinanceSavingsCreateSchema>,
  ) {
    return this.repo.once(
      scope,
      'post.finance.savings',
      key(k),
      input,
      async (tx) => {
        const s = scale(input.currency);
        if (input.accountId) {
          const a = await tx.get('account', input.accountId);
          if (a.archived || a.currency !== input.currency)
            throw new BadRequestException();
        }
        const v = await tx.createSavings({
          ...input,
          scale: s,
          target: money(input.target, s),
          manualAmount:
            input.manualAmount === null
              ? null
              : money(input.manualAmount, s, false),
          archived: false,
        });
        await tx.audit('FINANCE_SAVINGS_CHANGE', v.id);
        return v;
      },
    );
  }
  updateSavings(
    scope: AuthorizedSpace,
    id: string,
    r: number,
    input: In<typeof c.FinanceSavingsPatchSchema>,
  ) {
    return this.repo.run(scope, async (tx) => {
      const b = await tx.get('savings', id);
      revision(b, r);
      if (input.manualAmount !== undefined && b.mode !== 'MANUAL')
        throw new BadRequestException();
      const v = await tx.createSavings(
        {
          ...b,
          name: input.name ?? b.name,
          archived: input.archived ?? b.archived,
          target: input.target ? money(input.target, b.scale) : b.target,
          manualAmount:
            input.manualAmount === undefined
              ? b.manualAmount
              : money(input.manualAmount, b.scale, false),
        },
        b,
      );
      await tx.audit('FINANCE_SAVINGS_CHANGE', id);
      return v;
    });
  }
}
