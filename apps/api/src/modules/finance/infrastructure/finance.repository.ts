import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import { Prisma } from '../../../generated/prisma/client.js';
import type {
  FinancialAccount,
  FinanceCategory,
  Budget,
  BudgetPeriod,
  Bill,
  SavingsGoal,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { scopedWhere } from '../../../platform/database/scoped-where.js';
import {
  cursorPosition,
  cursorPage,
  afterCursor,
} from '../../../platform/database/cursor-pagination.js';
import {
  afterLogical,
  writingContext,
} from '../../../platform/database/writing-pagination.js';
import { idempotent } from '../../../platform/database/idempotency.js';
import type { MutationReceipt } from '../../../platform/database/idempotency.js';
import { writeAudit } from '../../../platform/audit/audit.service.js';
import { appendOutbox } from '../../../platform/outbox/outbox.js';
import { FinancePreferences } from '../../account/public/index.js';
import { FinanceCaptures } from '../../capture/public/index.js';
import type {
  FinancePort,
  FinanceTransactionPort,
  Resources,
  Kind,
  LedgerWrite,
  In,
  ReportPosting,
} from '../application/finance.port.js';
import { units, amount, ratioPercent } from '../domain/money.js';
function defined<T extends object>(
  v: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(v).filter(([, v]) => v !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };
}
const day = (d: Date) => d.toISOString().slice(0, 10),
  date = (v: string) => new Date(v + 'T00:00:00Z');
const root = (r: {
  id: string;
  spaceId: string;
  createdByUserId: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: r.id,
  spaceId: r.spaceId,
  createdByUserId: r.createdByUserId,
  revision: r.revision,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
const fixed = (n: Prisma.Decimal | null, s: number) =>
  n?.toFixed(s) ?? amount(0n, s);
export class Store implements FinanceTransactionPort {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly scope: AuthorizedSpace,
    private readonly prefs: FinancePreferences,
    private readonly captures: FinanceCaptures,
  ) {}
  private where<T extends object>(q: T) {
    return scopedWhere(this.scope, q);
  }
  preferences() {
    return this.prefs.read(this.tx, this.scope);
  }
  async balance(accountId: string, scale: number) {
    const r = await this.tx.transactionPosting.aggregate({
      where: this.where({ accountId }),
      _sum: { amount: true },
    });
    return fixed(r._sum.amount, scale);
  }
  private async accountView(r: FinancialAccount) {
    return c.FinanceAccountSchema.parse({
      ...root(r),
      name: r.name,
      currency: r.currency,
      scale: r.scale,
      archived: r.archived,
      balance: await this.balance(r.id, r.scale),
    });
  }
  private categoryView(r: FinanceCategory) {
    return c.FinanceCategorySchema.parse({
      ...root(r),
      name: r.name,
      kind: r.kind,
      position: r.position,
      archived: r.archived,
    });
  }
  private budgetView(r: Budget) {
    return c.FinanceBudgetSchema.parse({
      ...root(r),
      name: r.name,
      currency: r.currency,
      scale: r.scale,
      limit: fixed(r.limit, r.scale),
      categoryId: r.categoryId,
      period: r.period,
      timezone: r.timezone,
      calendar: r.calendar,
      firstDayOfWeek: r.firstDayOfWeek,
      archived: r.archived,
    });
  }
  private async periodView(r: BudgetPeriod) {
    const rows = await this.postings(r.startAt, r.endAt, {
      currency: r.currency,
      ...(r.categoryId ? { categoryId: r.categoryId } : {}),
    });
    let spent = 0n;
    for (const p of rows)
      if (p.role === 'EXPENSE' || p.role === 'FEE')
        spent -= units(p.amount, r.scale);
    const limit = units(fixed(r.limit, r.scale), r.scale);
    return c.FinancePeriodSchema.parse({
      ...root(r),
      budgetId: r.budgetId,
      startDate: day(r.startDate),
      endDate: day(r.endDate),
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      timezone: r.timezone,
      calendar: r.calendar,
      firstDayOfWeek: r.firstDayOfWeek,
      currency: r.currency,
      scale: r.scale,
      limit: amount(limit, r.scale),
      categoryId: r.categoryId,
      spent: amount(spent, r.scale),
      remaining: amount(limit - spent, r.scale),
      overspent: spent > limit,
    });
  }
  private billView(r: Bill) {
    return c.FinanceBillSchema.parse({
      ...root(r),
      id: r.logicalId,
      revisionId: r.id,
      current: r.current,
      effectiveFrom: day(r.effectiveFrom),
      name: r.name,
      accountId: r.accountId,
      type: r.type,
      amount: fixed(r.amount, r.scale),
      currency: r.currency,
      scale: r.scale,
      categoryId: r.categoryId,
      dueDate: day(r.dueDate),
      timezone: r.timezone,
      schedule: r.schedule,
      archived: r.archived,
    });
  }
  private async savingsView(r: SavingsGoal) {
    const progress =
        r.mode === 'ACCOUNT'
          ? await this.balance(r.accountId!, r.scale)
          : fixed(r.manualAmount, r.scale),
      target = fixed(r.target, r.scale);
    return c.FinanceSavingsSchema.parse({
      ...root(r),
      id: r.logicalId,
      revisionId: r.id,
      current: r.current,
      name: r.name,
      currency: r.currency,
      scale: r.scale,
      target,
      mode: r.mode,
      accountId: r.accountId,
      manualAmount:
        r.manualAmount === null ? null : fixed(r.manualAmount, r.scale),
      archived: r.archived,
      progress,
      percent: ratioPercent(units(progress, r.scale), units(target, r.scale)),
      exceeded: units(progress, r.scale) > units(target, r.scale),
    });
  }
  async get<K extends Kind>(kind: K, id: string): Promise<Resources[K]> {
    let out: Resources[Kind] | null = null;
    switch (kind) {
      case 'account': {
        const r = await this.tx.financialAccount.findFirst({
          where: this.where({ id }),
        });
        if (r) out = await this.accountView(r);
        break;
      }
      case 'category': {
        const r = await this.tx.financeCategory.findFirst({
          where: this.where({ id }),
        });
        if (r) out = this.categoryView(r);
        break;
      }
      case 'budget': {
        const r = await this.tx.budget.findFirst({ where: this.where({ id }) });
        if (r) out = this.budgetView(r);
        break;
      }
      case 'period': {
        const r = await this.tx.budgetPeriod.findFirst({
          where: this.where({ id }),
        });
        if (r) out = await this.periodView(r);
        break;
      }
      case 'bill': {
        const r = await this.tx.bill.findFirst({
          where: this.where({ logicalId: id, current: true }),
        });
        if (r) out = this.billView(r);
        break;
      }
      case 'savings': {
        const r = await this.tx.savingsGoal.findFirst({
          where: this.where({ logicalId: id, current: true }),
        });
        if (r) out = await this.savingsView(r);
        break;
      }
      case 'transaction':
        out = await this.transaction(id);
        break;
    }
    if (!out) throw new NotFoundException();
    return out as Resources[K];
  }
  async transaction(id: string) {
    const r = await this.tx.transaction.findFirst({
      where: this.where({ id }),
      include: {
        postings: { orderBy: { id: 'asc' } },
        exchangeRate: true,
        reversal: { select: { id: true } },
        replacement: { select: { id: true } },
      },
    });
    if (!r) throw new NotFoundException();
    return this.transactionView(r);
  }
  private transactionView(
    r: Prisma.TransactionGetPayload<{
      include: {
        postings: true;
        exchangeRate: true;
        reversal: { select: { id: true } };
        replacement: { select: { id: true } };
      };
    }>,
  ) {
    return c.FinanceTransactionSchema.parse({
      ...root(r),
      type: r.type,
      effect: r.effect,
      state: r.state,
      occurredAt: r.occurredAt.toISOString(),
      localDate: day(r.localDate),
      timezone: r.timezone,
      note: r.note,
      originalId: r.originalId,
      replacesId: r.replacesId,
      reversalId: r.reversal?.id ?? null,
      replacementId: r.replacement?.id ?? null,
      sourceCaptureId: r.sourceCaptureId,
      billId: r.billId,
      occurrenceKey: r.occurrenceKey,
      postings: r.postings.map((p) => ({
        id: p.id,
        accountId: p.accountId,
        currency: p.currency,
        scale: p.scale,
        amount: fixed(p.amount, p.scale),
        role: p.role,
        categoryId: p.categoryId,
      })),
      exchangeRate: r.exchangeRate
        ? {
            sourceCurrency: r.exchangeRate.sourceCurrency,
            destinationCurrency: r.exchangeRate.destinationCurrency,
            rate: r.exchangeRate.rate.toFixed(12),
            conversionDate: day(r.exchangeRate.conversionDate),
            rounding: r.exchangeRate.rounding,
          }
        : null,
    });
  }
  private async filters(q: {
    accountId?: string | undefined;
    categoryId?: string | undefined;
  }) {
    if (q.accountId) await this.get('account', q.accountId);
    if (q.categoryId) await this.get('category', q.categoryId);
  }
  async list<K extends Kind>(
    kind: K,
    q: c.FinanceQuery,
    context?: string,
  ): Promise<{ items: Resources[K][]; nextCursor: string | null }> {
    await this.filters(q);
    const ctx = writingContext('finance:' + kind + ':', {
        ...q,
        cursor: undefined,
        limit: undefined,
        context,
      }),
      p = cursorPosition(this.scope, ctx, q.cursor),
      limit = Number(q.limit ?? 25),
      logical = kind === 'bill' || kind === 'savings',
      after = logical ? afterLogical(p) : afterCursor(p),
      archived = q.archived === undefined ? false : q.archived === 'true';
    let rows: Array<{
      id: string;
      createdAt: Date;
      logicalId?: string;
      position?: number;
    }> = [];
    const base = { ...after, ...(q.currency ? { currency: q.currency } : {}) };
    switch (kind) {
      case 'account':
        rows = await this.tx.financialAccount.findMany({
          where: this.where({
            ...base,
            archived,
            ...(q.accountId ? { id: q.accountId } : {}),
          }),
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: limit + 1,
        });
        break;
      case 'category':
        rows = await this.tx.financeCategory.findMany({
          where: this.where({
            ...(p
              ? {
                  OR: [
                    { position: { gt: p.createdAt.getTime() } },
                    { position: p.createdAt.getTime(), id: { gt: p.id } },
                  ],
                }
              : {}),
            archived,
            ...(q.categoryId ? { id: q.categoryId } : {}),
          }),
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          take: limit + 1,
        });
        break;
      case 'budget':
        rows = await this.tx.budget.findMany({
          where: this.where({
            ...base,
            archived,
            ...(q.categoryId ? { categoryId: q.categoryId } : {}),
          }),
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: limit + 1,
        });
        break;
      case 'period':
        rows = await this.tx.budgetPeriod.findMany({
          where: this.where({
            ...base,
            ...(context ? { budgetId: context } : {}),
          }),
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: limit + 1,
        });
        break;
      case 'bill':
        rows = await this.tx.bill.findMany({
          where: this.where({
            ...base,
            current: true,
            archived,
            ...(q.accountId ? { accountId: q.accountId } : {}),
            ...(q.categoryId ? { categoryId: q.categoryId } : {}),
          }),
          orderBy: [{ createdAt: 'asc' }, { logicalId: 'asc' }],
          take: limit + 1,
        });
        break;
      case 'savings':
        rows = await this.tx.savingsGoal.findMany({
          where: this.where({
            ...base,
            current: true,
            archived,
            ...(q.accountId ? { accountId: q.accountId } : {}),
          }),
          orderBy: [{ createdAt: 'asc' }, { logicalId: 'asc' }],
          take: limit + 1,
        });
        break;
      case 'transaction':
        rows = await this.tx.transaction.findMany({
          where: this.where({
            ...after,
            ...(q.type ? { type: q.type } : {}),
            ...(q.state ? { state: q.state } : {}),
            ...(q.from
              ? { localDate: { gte: date(q.from), lt: date(q.to!) } }
              : {}),
            ...(q.accountId || q.categoryId || q.currency
              ? {
                  postings: {
                    some: {
                      ...(q.accountId ? { accountId: q.accountId } : {}),
                      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
                      ...(q.currency ? { currency: q.currency } : {}),
                    },
                  },
                }
              : {}),
          }),
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: limit + 1,
        });
        break;
    }
    const page = cursorPage(
      this.scope,
      ctx,
      limit,
      rows.map((r) => ({
        id: logical ? r.logicalId! : r.id,
        createdAt: kind === 'category' ? new Date(r.position!) : r.createdAt,
      })),
    );
    const items: Resources[K][] = [];
    for (const r of rows.slice(0, limit))
      items.push(await this.get(kind, logical ? r.logicalId! : r.id));
    return { nextCursor: page.nextCursor, items };
  }
  async createAccount(data: { name: string; currency: string; scale: number }) {
    const r = await this.tx.financialAccount.create({
      data: {
        ...data,
        spaceId: this.scope.spaceId,
        createdByUserId: this.scope.actor.userId,
      },
    });
    return this.accountView(r);
  }
  async createCategory(data: In<typeof c.FinanceCategoryCreateSchema>) {
    return this.categoryView(
      await this.tx.financeCategory.create({
        data: {
          ...data,
          spaceId: this.scope.spaceId,
          createdByUserId: this.scope.actor.userId,
        },
      }),
    );
  }
  async update<K extends 'account' | 'category' | 'budget' | 'period'>(
    kind: K,
    id: string,
    revision: number,
    data: K extends 'account'
      ? In<typeof c.FinanceAccountPatchSchema>
      : K extends 'category'
        ? In<typeof c.FinanceCategoryPatchSchema>
        : K extends 'budget'
          ? In<typeof c.FinanceBudgetPatchSchema>
          : In<typeof c.FinancePeriodPatchSchema>,
  ): Promise<Resources[K]> {
    let count = 0;
    const where = this.where({ id, revision });
    switch (kind) {
      case 'account':
        count = (
          await this.tx.financialAccount.updateMany({
            where,
            data: {
              ...defined(data as In<typeof c.FinanceAccountPatchSchema>),
              revision: { increment: 1 },
            },
          })
        ).count;
        break;
      case 'category':
        count = (
          await this.tx.financeCategory.updateMany({
            where,
            data: {
              ...defined(data as In<typeof c.FinanceCategoryPatchSchema>),
              revision: { increment: 1 },
            },
          })
        ).count;
        break;
      case 'budget':
        count = (
          await this.tx.budget.updateMany({
            where,
            data: {
              ...defined(data as In<typeof c.FinanceBudgetPatchSchema>),
              revision: { increment: 1 },
            },
          })
        ).count;
        break;
      case 'period':
        count = (
          await this.tx.budgetPeriod.updateMany({
            where,
            data: {
              ...(data as In<typeof c.FinancePeriodPatchSchema>),
              revision: { increment: 1 },
            },
          })
        ).count;
        break;
    }
    if (count !== 1) throw new ConflictException();
    return this.get(kind, id);
  }
  async post(data: LedgerWrite) {
    const { postings, exchangeRate, ...input } = data;
    const r = await this.tx.transaction.create({
      data: {
        ...input,
        occurredAt: new Date(input.occurredAt),
        localDate: date(input.localDate),
        spaceId: this.scope.spaceId,
        createdByUserId: this.scope.actor.userId,
      },
    });
    await this.tx.transactionPosting.createMany({
      data: postings.map((p) => ({
        ...p,
        spaceId: this.scope.spaceId,
        transactionId: r.id,
      })),
    });
    if (exchangeRate)
      await this.tx.exchangeRateSnapshot.create({
        data: {
          ...exchangeRate,
          conversionDate: date(exchangeRate.conversionDate),
          spaceId: this.scope.spaceId,
          transactionId: r.id,
        },
      });
    return this.transaction(r.id);
  }
  async markReversed(id: string, revision: number) {
    if (
      (
        await this.tx.transaction.updateMany({
          where: this.where({
            id,
            revision,
            state: 'POSTED',
            effect: 'POSTED',
          }),
          data: { state: 'REVERSED', revision: { increment: 1 } },
        })
      ).count !== 1
    )
      throw new ConflictException();
  }
  async history(id: string, q: c.FinanceQuery) {
    let root = await this.transaction(id);
    const visited = new Set<string>();
    while (root.originalId || root.replacesId) {
      if (visited.has(root.id) || visited.size >= 1000)
        throw new BadRequestException();
      visited.add(root.id);
      root = await this.transaction((root.originalId ?? root.replacesId)!);
    }
    const items: c.FinanceTransaction[] = [],
      queue = [root];
    while (queue.length) {
      if (items.length >= 1000) throw new BadRequestException();
      const t = queue.shift()!;
      items.push(t);
      if (t.reversalId) queue.push(await this.transaction(t.reversalId));
      if (t.replacementId) queue.push(await this.transaction(t.replacementId));
    }
    items.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const ctx = 'finance.history:' + root.id,
      p = cursorPosition(this.scope, ctx, q.cursor),
      limit = Number(q.limit ?? 25),
      rows = items.filter(
        (v) =>
          !p ||
          v.createdAt > p.createdAt.toISOString() ||
          (v.createdAt === p.createdAt.toISOString() && v.id > p.id),
      );
    const page = cursorPage(
      this.scope,
      ctx,
      limit,
      rows.map((v) => ({ id: v.id, createdAt: new Date(v.createdAt) })),
    );
    return { items: rows.slice(0, limit), nextCursor: page.nextCursor };
  }
  async createBudget(
    data: Parameters<FinanceTransactionPort['createBudget']>[0],
  ) {
    return this.budgetView(
      await this.tx.budget.create({
        data: {
          ...data,
          spaceId: this.scope.spaceId,
          createdByUserId: this.scope.actor.userId,
        },
      }),
    );
  }
  async createPeriod(
    data: Parameters<FinanceTransactionPort['createPeriod']>[0],
  ) {
    return this.periodView(
      await this.tx.budgetPeriod.create({
        data: {
          ...data,
          startDate: date(data.startDate),
          endDate: date(data.endDate),
          startAt: new Date(data.startAt),
          endAt: new Date(data.endAt),
          spaceId: this.scope.spaceId,
          createdByUserId: this.scope.actor.userId,
        },
      }),
    );
  }
  async createBill(
    data: Parameters<FinanceTransactionPort['createBill']>[0],
    before?: c.FinanceBill,
  ) {
    const id = randomUUID();
    if (
      before &&
      (
        await this.tx.bill.updateMany({
          where: this.where({
            logicalId: before.id,
            current: true,
            revision: before.revision,
          }),
          data: { current: false, updatedAt: new Date(before.updatedAt) },
        })
      ).count !== 1
    )
      throw new ConflictException();
    const r = await this.tx.bill.create({
      data: {
        id,
        spaceId: this.scope.spaceId,
        createdByUserId: this.scope.actor.userId,
        logicalId: before?.id ?? id,
        rootId: before?.id ?? null,
        revision: (before?.revision ?? 0) + 1,
        createdAt: before ? new Date(before.createdAt) : new Date(),
        effectiveFrom: date(data.effectiveFrom),
        name: data.name,
        accountId: data.accountId,
        type: data.type,
        amount: data.amount,
        currency: data.currency,
        scale: data.scale,
        categoryId: data.categoryId,
        dueDate: date(data.dueDate),
        timezone: data.timezone,
        schedule: data.schedule ?? Prisma.DbNull,
        archived: data.archived,
      },
    });
    return this.billView(r);
  }
  async billVersions(id: string) {
    await this.get('bill', id);
    const rows = await this.tx.bill.findMany({
      where: this.where({ logicalId: id }),
      orderBy: { revision: 'asc' },
      take: 1001,
    });
    if (rows.length > 1000) throw new BadRequestException();
    return rows.map((r) => this.billView(r));
  }
  async billPayment(id: string, key: string) {
    const r = await this.tx.transaction.findFirst({
      where: this.where({ billId: id, occurrenceKey: key }),
    });
    return r ? this.transaction(r.id) : null;
  }
  async linkBill(
    transactionId: string,
    revision: number,
    billId: string,
    key: string,
  ) {
    if (
      (
        await this.tx.transaction.updateMany({
          where: this.where({
            id: transactionId,
            revision,
            billId: null,
            effect: 'POSTED',
            state: 'POSTED',
          }),
          data: { billId, occurrenceKey: key, revision: { increment: 1 } },
        })
      ).count !== 1
    )
      throw new ConflictException();
    return this.transaction(transactionId);
  }
  async createSavings(
    data: Parameters<FinanceTransactionPort['createSavings']>[0],
    before?: c.FinanceSavings,
  ) {
    const id = randomUUID();
    if (
      before &&
      (
        await this.tx.savingsGoal.updateMany({
          where: this.where({
            logicalId: before.id,
            current: true,
            revision: before.revision,
          }),
          data: { current: false, updatedAt: new Date(before.updatedAt) },
        })
      ).count !== 1
    )
      throw new ConflictException();
    const r = await this.tx.savingsGoal.create({
      data: {
        id,
        spaceId: this.scope.spaceId,
        createdByUserId: this.scope.actor.userId,
        logicalId: before?.id ?? id,
        rootId: before?.id ?? null,
        revision: (before?.revision ?? 0) + 1,
        createdAt: before ? new Date(before.createdAt) : new Date(),
        name: data.name,
        currency: data.currency,
        scale: data.scale,
        target: data.target,
        mode: data.mode,
        accountId: data.accountId,
        manualAmount: data.manualAmount,
        archived: data.archived,
      },
    });
    return this.savingsView(r);
  }
  async versions(kind: 'bill' | 'savings', id: string, q: c.FinanceQuery) {
    await this.get(kind, id);
    const ctx = 'finance.versions:' + kind + ':' + id,
      p = cursorPosition(this.scope, ctx, q.cursor),
      limit = Number(q.limit ?? 25),
      where = this.where({
        logicalId: id,
        ...(p ? { revision: { gt: Number(p.createdAt.getTime()) } } : {}),
      });
    const rows =
      kind === 'bill'
        ? await this.tx.bill.findMany({
            where,
            orderBy: { revision: 'asc' },
            take: limit + 1,
          })
        : await this.tx.savingsGoal.findMany({
            where,
            orderBy: { revision: 'asc' },
            take: limit + 1,
          });
    const page = cursorPage(
      this.scope,
      ctx,
      limit,
      rows.map((v) => ({ id: v.id, createdAt: new Date(v.revision) })),
    );
    const items: (c.FinanceBill | c.FinanceSavings)[] = [];
    for (const v of rows.slice(0, limit))
      items.push(
        kind === 'bill'
          ? this.billView(v as Bill)
          : await this.savingsView(v as SavingsGoal),
      );
    return { items, nextCursor: page.nextCursor };
  }
  async postings(
    from: Date,
    to: Date,
    q: Pick<c.FinanceReportQuery, 'accountId' | 'categoryId' | 'currency'>,
  ): Promise<ReportPosting[]> {
    await this.filters(q);
    const [bounded] = await this.tx.$queryRaw<
      Array<{ count: number }>
    >`SELECT count(*)::int AS count FROM (SELECT p.id FROM "TransactionPosting" p JOIN "Transaction" t ON t.id=p."transactionId" WHERE p."spaceId"=${this.scope.spaceId}::uuid AND t."occurredAt">=${from} AND t."occurredAt"<${to} ${q.accountId ? Prisma.sql`AND p."accountId"=${q.accountId}::uuid` : Prisma.empty} ${q.categoryId ? Prisma.sql`AND p."categoryId"=${q.categoryId}::uuid` : Prisma.empty} ${q.currency ? Prisma.sql`AND p.currency=${q.currency}` : Prisma.empty} LIMIT 10001) bounded`;
    if (!bounded || bounded.count > 10000) throw new BadRequestException(); // Composite posting/transaction FK already guarantees same Space; p is explicitly scoped.
    const rows = await this.tx.$queryRaw<
      Array<{
        accountId: string;
        currency: string;
        scale: number;
        amount: Prisma.Decimal;
        role: string;
        categoryId: string | null;
        occurredAt: Date;
        effect: 'POSTED' | 'REVERSAL';
        transactionId: string;
      }>
    >`SELECT p."accountId",p.currency,p.scale,p.amount,p.role,p."categoryId",t."occurredAt",t.effect,t.id AS "transactionId" FROM "TransactionPosting" p JOIN "Transaction" t ON t.id=p."transactionId" WHERE p."spaceId"=${this.scope.spaceId}::uuid AND t."occurredAt">=${from} AND t."occurredAt"<${to} ${q.accountId ? Prisma.sql`AND p."accountId"=${q.accountId}::uuid` : Prisma.empty} ${q.categoryId ? Prisma.sql`AND p."categoryId"=${q.categoryId}::uuid` : Prisma.empty} ${q.currency ? Prisma.sql`AND p.currency=${q.currency}` : Prisma.empty} ORDER BY t."occurredAt",t.id,p.id LIMIT 10000`;
    return rows.map((p) => ({
      accountId: p.accountId,
      currency: p.currency,
      scale: p.scale,
      amount: fixed(p.amount, p.scale),
      role: c.FinancePostingSchema.shape.role.parse(p.role),
      categoryId: p.categoryId,
      occurredAt: p.occurredAt.toISOString(),
      effect: p.effect,
      transactionId: p.transactionId,
    }));
  }

  async exportTransactions(from: Date, to: Date, q: c.FinanceReportQuery) {
    const posts = await this.postings(from, to, q),
      ids = [...new Set(posts.map((p) => p.transactionId))];
    const rows: c.FinanceTransaction[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const records = await this.tx.transaction.findMany({
        where: this.where({ id: { in: ids.slice(i, i + 200) } }),
        include: {
          postings: { orderBy: { id: 'asc' } },
          exchangeRate: true,
          reversal: { select: { id: true } },
          replacement: { select: { id: true } },
        },
      });
      rows.push(...records.map((r) => this.transactionView(r)));
    }
    return rows.sort(
      (a, b) =>
        a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
    );
  }
  draft(id: string, revision: number) {
    return this.captures.requireExpense(this.tx, this.scope, id, revision);
  }
  finishDraft(id: string, revision: number, transactionId: string) {
    return this.captures.finish(
      this.tx,
      this.scope,
      id,
      revision,
      transactionId,
    );
  }
  async audit(
    action: Parameters<FinanceTransactionPort['audit']>[0],
    id: string,
  ) {
    await writeAudit(this.tx, {
      action,
      outcome: 'SUCCEEDED',
      actorUserId: this.scope.actor.userId,
      resourceId: id,
      requestId: this.scope.actor.requestId,
      correlationId: this.scope.actor.correlationId,
    });
  }
  async event(
    type: Parameters<FinanceTransactionPort['event']>[0],
    id: string,
  ) {
    await appendOutbox(this.tx, this.scope, {
      type,
      version: 1,
      aggregateId: id,
      payload: {},
    });
  }
}
@Injectable()
export class FinanceRepository implements FinancePort {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(FinancePreferences) private readonly prefs: FinancePreferences,
    @Inject(FinanceCaptures) private readonly captures: FinanceCaptures,
  ) {}
  private async store(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    draft = false,
  ) {
    await scope.fence(tx);
    if (draft) await this.captures.lock(tx, scope);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'finance:' + scope.spaceId},0))::text`;
    return new Store(tx, scope, this.prefs, this.captures);
  }
  run<T>(
    scope: AuthorizedSpace,
    work: (tx: FinanceTransactionPort) => Promise<T>,
  ) {
    return this.db.client.$transaction(
      async (tx) => work(await this.store(tx, scope)),
      { timeout: 30000 },
    );
  }
  async once<T extends { id: string }>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    input: unknown,
    work: (tx: FinanceTransactionPort) => Promise<T>,
    draft = false,
  ) {
    const receipt = await idempotent(
      this.db.client,
      scope,
      operation,
      key,
      input,
      async (tx) => {
        const result = await work(await this.store(tx, scope, draft));
        return {
          resultId: result.id,
          statusCode: 201,
          result: JSON.parse(JSON.stringify(result)) as NonNullable<
            MutationReceipt['result']
          >,
        };
      },
    );
    return receipt.result as T;
  }
}
