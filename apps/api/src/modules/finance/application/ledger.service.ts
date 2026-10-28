import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { FINANCE_REPOSITORY } from './finance.port.js';
import type {
  FinancePort,
  FinanceTransactionPort,
  LedgerWrite,
  Posting,
  In,
} from './finance.port.js';
import { units, amount, converted } from '../domain/money.js';
import { localDate } from '../domain/dates.js';
export function check<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof RangeError) throw new BadRequestException();
    throw e;
  }
}
export function revision(v: { revision: number }, r: number) {
  if (v.revision !== r) throw new ConflictException();
}
export function key(v: string | undefined) {
  if (!v) throw new BadRequestException();
  return v;
}
export function scale(currency: string) {
  const s = c.financeCurrencyScales[currency];
  if (s === undefined) throw new BadRequestException();
  return s;
}
export function money(v: string, s: number, positive = true) {
  return check(() => amount(units(v, s, positive), s));
}
@Injectable()
export class LedgerService {
  constructor(@Inject(FINANCE_REPOSITORY) readonly repo: FinancePort) {}
  async category(
    tx: FinanceTransactionPort,
    id: string | null,
    kind: 'INCOME' | 'EXPENSE',
    historical = false,
  ) {
    if (id) {
      const cat = await tx.get('category', id);
      if (cat.kind !== kind || (!historical && cat.archived))
        throw new BadRequestException();
    }
  }
  async build(
    tx: FinanceTransactionPort,
    input: c.FinancePost,
    historical = false,
  ): Promise<LedgerWrite> {
    const now = new Date(),
      timezone = input.timezone ?? (await tx.preferences()).timezone,
      instant = input.occurredAt ?? now.toISOString(),
      date = localDate(new Date(instant), timezone);
    if (
      Date.parse(instant) > now.getTime() ||
      (input.localDate !== undefined && input.localDate !== date)
    )
      throw new BadRequestException();
    const postings: Posting[] = [];
    let exchangeRate: LedgerWrite['exchangeRate'] = null;
    const account = async (id: string) => {
      const a = await tx.get('account', id);
      if (a.archived && !historical) throw new ConflictException();
      return a;
    };
    if (input.type === 'TRANSFER') {
      if (input.sourceAccountId === input.destinationAccountId)
        throw new BadRequestException();
      const a = await account(input.sourceAccountId),
        b = await account(input.destinationAccountId),
        source = money(input.sourceAmount, a.scale),
        dest = money(input.destinationAmount, b.scale);
      if (a.currency === b.currency) {
        if (
          units(source, a.scale) !== units(dest, b.scale) ||
          input.rate !== undefined ||
          input.conversionDate !== undefined
        )
          throw new BadRequestException();
      } else {
        if (
          input.rate === undefined ||
          input.conversionDate === undefined ||
          input.conversionDate > date
        )
          throw new BadRequestException();
        const expected = check(() =>
          converted(
            units(source, a.scale, true),
            a.scale,
            b.scale,
            input.rate!,
          ),
        );
        if (expected <= 0n || expected !== units(dest, b.scale))
          throw new BadRequestException();
        exchangeRate = {
          sourceCurrency: a.currency,
          destinationCurrency: b.currency,
          rate: input.rate,
          conversionDate: input.conversionDate,
          rounding: 'HALF_UP',
        };
      }
      postings.push(
        {
          accountId: a.id,
          currency: a.currency,
          scale: a.scale,
          amount: '-' + source,
          role: 'TRANSFER_OUT',
          categoryId: null,
        },
        {
          accountId: b.id,
          currency: b.currency,
          scale: b.scale,
          amount: dest,
          role: 'TRANSFER_IN',
          categoryId: null,
        },
      );
      if (input.fee) {
        await this.category(tx, input.fee.categoryId, 'EXPENSE', historical);
        postings.push({
          accountId: a.id,
          currency: a.currency,
          scale: a.scale,
          amount: '-' + money(input.fee.amount, a.scale),
          role: 'FEE',
          categoryId: input.fee.categoryId,
        });
      }
    } else {
      const a = await account(input.accountId),
        v = money(input.amount, a.scale);
      if (input.type === 'ADJUSTMENT' && input.categoryId !== null)
        throw new BadRequestException();
      if (input.type !== 'ADJUSTMENT')
        await this.category(tx, input.categoryId, input.type, historical);
      postings.push({
        accountId: a.id,
        currency: a.currency,
        scale: a.scale,
        amount:
          input.type === 'EXPENSE' ||
          (input.type === 'ADJUSTMENT' && input.direction === 'OUT')
            ? '-' + v
            : v,
        role: input.type,
        categoryId: input.categoryId,
      });
    }
    return {
      type: input.type,
      occurredAt: instant,
      localDate: date,
      timezone,
      note: input.note,
      postings,
      exchangeRate,
    };
  }
  async postInside(
    tx: FinanceTransactionPort,
    input: c.FinancePost,
    extra: Pick<
      LedgerWrite,
      'replacesId' | 'sourceCaptureId' | 'billId' | 'occurrenceKey'
    > = {},
    historical = false,
  ) {
    const result = await tx.post({
      ...(await this.build(tx, input, historical)),
      ...extra,
    });
    await tx.audit('FINANCE_POST', result.id);
    await tx.event('finance.transaction_posted', result.id);
    return result;
  }
  post(scope: AuthorizedSpace, k: string | undefined, input: c.FinancePost) {
    return this.repo.once(
      scope,
      'post.finance.transaction',
      key(k),
      input,
      (tx) => this.postInside(tx, input),
    );
  }
  async reverseInside(tx: FinanceTransactionPort, id: string, r: number) {
    const before = await tx.get('transaction', id);
    revision(before, r);
    if (before.effect !== 'POSTED' || before.state !== 'POSTED')
      throw new ConflictException();
    await tx.markReversed(id, r);
    const result = await tx.post({
      type: before.type,
      effect: 'REVERSAL',
      occurredAt: before.occurredAt,
      localDate: before.localDate,
      timezone: before.timezone,
      note: null,
      originalId: id,
      postings: before.postings.map(({ id: _id, ...p }) => ({
        ...p,
        amount: amount(-units(p.amount, p.scale), p.scale),
      })),
      exchangeRate: null,
    });
    await tx.audit('FINANCE_REVERSE', id);
    await tx.event('finance.transaction_reversed', id);
    return result;
  }
  reverse(
    scope: AuthorizedSpace,
    id: string,
    r: number,
    k: string | undefined,
  ) {
    return this.repo.once(
      scope,
      'post.finance.reverse',
      key(k),
      { id, r },
      (tx) => this.reverseInside(tx, id, r),
    );
  }
  correct(
    scope: AuthorizedSpace,
    id: string,
    r: number,
    k: string | undefined,
    input: In<typeof c.FinanceCorrectionSchema>,
  ) {
    return this.repo.once(
      scope,
      'post.finance.correct',
      key(k),
      { id, r, input },
      async (tx) => {
        await this.reverseInside(tx, id, r);
        return this.postInside(tx, input.replacement, { replacesId: id }, true);
      },
    );
  }
  createAccount(
    scope: AuthorizedSpace,
    k: string | undefined,
    input: In<typeof c.FinanceAccountCreateSchema>,
  ) {
    return this.repo.once(
      scope,
      'post.finance.account',
      key(k),
      input,
      async (tx) => {
        const a = await tx.createAccount({
          name: input.name,
          currency: input.currency,
          scale: scale(input.currency),
        });
        if (input.opening)
          await this.postInside(tx, {
            type: 'ADJUSTMENT',
            accountId: a.id,
            amount: input.opening.amount,
            direction: input.opening.direction,
            occurredAt: input.opening.occurredAt,
            timezone: input.opening.timezone,
            note: null,
            categoryId: null,
          });
        await tx.audit('FINANCE_ACCOUNT_CHANGE', a.id);
        return tx.get('account', a.id);
      },
    );
  }
  createCategory(
    scope: AuthorizedSpace,
    k: string | undefined,
    input: In<typeof c.FinanceCategoryCreateSchema>,
  ) {
    return this.repo.once(
      scope,
      'post.finance.category',
      key(k),
      input,
      async (tx) => {
        const c = await tx.createCategory(input);
        await tx.audit('FINANCE_CATEGORY_CHANGE', c.id);
        return c;
      },
    );
  }
  fromCapture(
    scope: AuthorizedSpace,
    k: string | undefined,
    input: In<typeof c.FinanceCapturePostSchema>,
  ) {
    return this.repo.once(
      scope,
      'post.finance.from_capture',
      key(k),
      input,
      async (tx) => {
        await tx.draft(input.captureId, input.captureRevision);
        const result = await this.postInside(tx, input.expense, {
            sourceCaptureId: input.captureId,
          }),
          capture = await tx.finishDraft(
            input.captureId,
            input.captureRevision,
            result.id,
          );
        return {
          id: result.id,
          revision: result.revision,
          captureId: input.captureId,
          captureRevision: capture.revision,
          transaction: result,
        };
      },
      true,
    );
  }
}
