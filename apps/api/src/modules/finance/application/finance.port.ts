import type * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
export const FINANCE_REPOSITORY = Symbol('FINANCE_REPOSITORY');
export type Resources = {
  account: c.FinanceAccount;
  category: c.FinanceCategory;
  transaction: c.FinanceTransaction;
  budget: c.FinanceBudget;
  period: c.FinancePeriod;
  bill: c.FinanceBill;
  savings: c.FinanceSavings;
};
export type Kind = keyof Resources;
export type In<T extends z.ZodType> = z.infer<T>;
export type Posting = Omit<In<typeof c.FinancePostingSchema>, 'id'>;
export type LedgerWrite = {
  type: c.FinanceTransaction['type'];
  effect?: 'POSTED' | 'REVERSAL';
  occurredAt: string;
  localDate: string;
  timezone: string;
  note: string | null;
  originalId?: string;
  replacesId?: string;
  sourceCaptureId?: string;
  billId?: string;
  occurrenceKey?: string;
  postings: Posting[];
  exchangeRate: In<typeof c.FinanceRateSchema> | null;
};
export type ReportPosting = Posting & {
  occurredAt: string;
  effect: 'POSTED' | 'REVERSAL';
  transactionId: string;
};
export interface FinanceTransactionPort {
  preferences(): Promise<{
    timezone: string;
    calendar: 'GREGORIAN' | 'JALALI';
    firstDayOfWeek: number;
  }>;
  get<K extends Kind>(kind: K, id: string): Promise<Resources[K]>;
  list<K extends Kind>(
    kind: K,
    q: c.FinanceQuery,
    context?: string,
  ): Promise<{ items: Resources[K][]; nextCursor: string | null }>;
  createAccount(data: {
    name: string;
    currency: string;
    scale: number;
  }): Promise<c.FinanceAccount>;
  createCategory(
    data: In<typeof c.FinanceCategoryCreateSchema>,
  ): Promise<c.FinanceCategory>;
  update<K extends 'account' | 'category' | 'budget' | 'period'>(
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
  ): Promise<Resources[K]>;
  post(data: LedgerWrite): Promise<c.FinanceTransaction>;
  markReversed(id: string, revision: number): Promise<void>;
  history(
    id: string,
    q: c.FinanceQuery,
  ): Promise<{ items: c.FinanceTransaction[]; nextCursor: string | null }>;
  createBudget(
    data: Omit<
      c.FinanceBudget,
      | 'id'
      | 'spaceId'
      | 'createdByUserId'
      | 'revision'
      | 'createdAt'
      | 'updatedAt'
      | 'archived'
    >,
  ): Promise<c.FinanceBudget>;
  createPeriod(
    data: Omit<
      c.FinancePeriod,
      | 'id'
      | 'spaceId'
      | 'createdByUserId'
      | 'revision'
      | 'createdAt'
      | 'updatedAt'
      | 'spent'
      | 'remaining'
      | 'overspent'
    >,
  ): Promise<c.FinancePeriod>;
  createBill(
    data: Omit<
      c.FinanceBill,
      | 'id'
      | 'spaceId'
      | 'createdByUserId'
      | 'revision'
      | 'createdAt'
      | 'updatedAt'
      | 'revisionId'
      | 'current'
    >,
    before?: c.FinanceBill,
  ): Promise<c.FinanceBill>;
  billVersions(id: string): Promise<c.FinanceBill[]>;
  billPayment(id: string, key: string): Promise<c.FinanceTransaction | null>;
  linkBill(
    transactionId: string,
    revision: number,
    billId: string,
    key: string,
  ): Promise<c.FinanceTransaction>;
  createSavings(
    data: Omit<
      c.FinanceSavings,
      | 'id'
      | 'spaceId'
      | 'createdByUserId'
      | 'revision'
      | 'createdAt'
      | 'updatedAt'
      | 'revisionId'
      | 'current'
      | 'progress'
      | 'percent'
      | 'exceeded'
    >,
    before?: c.FinanceSavings,
  ): Promise<c.FinanceSavings>;
  versions(
    kind: 'bill' | 'savings',
    id: string,
    q: c.FinanceQuery,
  ): Promise<{
    items: (c.FinanceBill | c.FinanceSavings)[];
    nextCursor: string | null;
  }>;
  postings(
    from: Date,
    to: Date,
    q: Pick<c.FinanceReportQuery, 'accountId' | 'categoryId' | 'currency'>,
  ): Promise<ReportPosting[]>;
  exportTransactions(
    from: Date,
    to: Date,
    q: c.FinanceReportQuery,
  ): Promise<c.FinanceTransaction[]>;
  draft(id: string, revision: number): Promise<void>;
  finishDraft(
    id: string,
    revision: number,
    transactionId: string,
  ): Promise<{ revision: number }>;
  audit(
    action:
      | 'FINANCE_ACCOUNT_CHANGE'
      | 'FINANCE_CATEGORY_CHANGE'
      | 'FINANCE_POST'
      | 'FINANCE_REVERSE'
      | 'FINANCE_BUDGET_CHANGE'
      | 'FINANCE_BILL_CHANGE'
      | 'FINANCE_SAVINGS_CHANGE'
      | 'FINANCE_EXPORT',
    id: string,
  ): Promise<void>;
  event(
    type: 'finance.transaction_posted' | 'finance.transaction_reversed',
    id: string,
  ): Promise<void>;
}
export interface FinancePort {
  run<T>(
    scope: AuthorizedSpace,
    work: (tx: FinanceTransactionPort) => Promise<T>,
  ): Promise<T>;
  once<T extends { id: string }>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    input: unknown,
    work: (tx: FinanceTransactionPort) => Promise<T>,
    draft?: boolean,
  ): Promise<T>;
}
