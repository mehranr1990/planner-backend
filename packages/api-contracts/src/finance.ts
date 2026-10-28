import { z } from 'zod';
import { TaskIdSchema } from './tasks.js';
import { CursorQuerySchema } from './foundation.js';
import { PlanningDateSchema } from './planning.js';
import { CalendarZoneSchema } from './calendar.js';
import { financeCurrencyScales } from './finance-currencies.js';
const Id = TaskIdSchema,
  DateOnly = PlanningDateSchema,
  Zone = CalendarZoneSchema,
  Rev = z.number().int().min(1).max(2147483646),
  Name = z
    .string()
    .trim()
    .min(1)
    .max(300)
    .refine((v) => !/[\x00-\x1f\x7f\ud800-\udfff]/u.test(v));
export const FinanceAmountSchema = z
  .string()
  .max(23)
  .regex(/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,4})?$/)
  .refine((v) => /[1-9]/.test(v));
export const FinanceNonnegativeSchema = z
  .string()
  .max(23)
  .regex(/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,4})?$/);
export const FinanceDecimalSchema = z
  .string()
  .max(40)
  .regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/);
export const FinanceCurrencySchema = z.enum(
  Object.keys(financeCurrencyScales) as [string, ...string[]],
);
const Money = FinanceAmountSchema,
  Currency = FinanceCurrencySchema,
  Note = z
    .string()
    .max(4000)
    .refine((v) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]/u.test(v)),
  Time = z.iso.datetime();
const root = {
  id: Id,
  spaceId: Id,
  createdByUserId: Id,
  revision: Rev,
  createdAt: Time,
  updatedAt: Time,
};
export const FinanceAccountCreateSchema = z.strictObject({
  name: Name,
  currency: Currency,
  opening: z
    .strictObject({
      amount: Money,
      direction: z.enum(['IN', 'OUT']),
      occurredAt: Time.optional(),
      timezone: Zone.optional(),
    })
    .optional(),
});
export const FinanceAccountPatchSchema = z
  .strictObject({ name: Name.optional(), archived: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0);
export const FinanceAccountSchema = z.strictObject({
  ...root,
  name: Name,
  currency: Currency,
  scale: z.number().int().min(0).max(4),
  archived: z.boolean(),
  balance: FinanceDecimalSchema,
});
export const FinanceCategoryCreateSchema = z.strictObject({
  name: Name,
  kind: z.enum(['INCOME', 'EXPENSE']),
  position: z.number().int().min(0).max(9999).default(0),
});
export const FinanceCategoryPatchSchema = z
  .strictObject({
    name: Name.optional(),
    position: z.number().int().min(0).max(9999).optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const FinanceCategorySchema = z.strictObject({
  ...root,
  name: Name,
  kind: z.enum(['INCOME', 'EXPENSE']),
  position: z.number().int(),
  archived: z.boolean(),
});
const actual = {
  occurredAt: Time.optional(),
  timezone: Zone.optional(),
  localDate: DateOnly.optional(),
  note: Note.nullable().default(null),
};
const one = {
  ...actual,
  accountId: Id,
  amount: Money,
  categoryId: Id.nullable().default(null),
};
export const FinanceSingleCreateSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...one, type: z.literal('INCOME') }),
  z.strictObject({ ...one, type: z.literal('EXPENSE') }),
  z.strictObject({
    ...one,
    type: z.literal('ADJUSTMENT'),
    direction: z.enum(['IN', 'OUT']),
  }),
]);
export const FinanceTransferCreateSchema = z.strictObject({
  ...actual,
  type: z.literal('TRANSFER'),
  sourceAccountId: Id,
  destinationAccountId: Id,
  sourceAmount: Money,
  destinationAmount: Money,
  rate: z
    .string()
    .max(31)
    .regex(/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,12})?$/)
    .optional(),
  conversionDate: DateOnly.optional(),
  fee: z
    .strictObject({ amount: Money, categoryId: Id.nullable().default(null) })
    .optional(),
});
export const FinancePostSchema = z.union([
  FinanceSingleCreateSchema,
  FinanceTransferCreateSchema,
]);
export const FinancePostingSchema = z.strictObject({
  id: Id,
  accountId: Id,
  currency: Currency,
  scale: z.number().int().min(0).max(4),
  amount: FinanceDecimalSchema,
  role: z.enum([
    'INCOME',
    'EXPENSE',
    'TRANSFER_OUT',
    'TRANSFER_IN',
    'ADJUSTMENT',
    'FEE',
  ]),
  categoryId: Id.nullable(),
});
export const FinanceRateSchema = z.strictObject({
  sourceCurrency: Currency,
  destinationCurrency: Currency,
  rate: z.string(),
  conversionDate: DateOnly,
  rounding: z.literal('HALF_UP'),
});
export const FinanceTransactionSchema = z.strictObject({
  ...root,
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER', 'ADJUSTMENT']),
  effect: z.enum(['POSTED', 'REVERSAL']),
  state: z.enum(['POSTED', 'REVERSED']),
  occurredAt: Time,
  localDate: DateOnly,
  timezone: Zone,
  note: Note.nullable(),
  originalId: Id.nullable(),
  replacesId: Id.nullable(),
  reversalId: Id.nullable(),
  replacementId: Id.nullable(),
  sourceCaptureId: Id.nullable(),
  billId: Id.nullable(),
  occurrenceKey: DateOnly.nullable(),
  postings: z.array(FinancePostingSchema).min(1).max(3),
  exchangeRate: FinanceRateSchema.nullable(),
});
export const FinanceCorrectionSchema = z.strictObject({
  replacement: FinancePostSchema,
});
export const FinanceCapturePostSchema = z.strictObject({
  captureId: Id,
  captureRevision: Rev,
  expense: z.strictObject({ ...one, type: z.literal('EXPENSE') }),
});
export const FinanceDraftResultSchema = z.strictObject({
  id: Id,
  revision: Rev,
  captureId: Id,
  captureRevision: Rev,
  transaction: FinanceTransactionSchema,
});
export const FinanceQuerySchema = CursorQuerySchema.extend({
  accountId: Id.optional(),
  categoryId: Id.optional(),
  currency: Currency.optional(),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER', 'ADJUSTMENT']).optional(),
  state: z.enum(['POSTED', 'REVERSED']).optional(),
  from: DateOnly.optional(),
  to: DateOnly.optional(),
  archived: z.enum(['true', 'false']).optional(),
}).refine(
  (v) =>
    (v.from === undefined && v.to === undefined) ||
    (v.from !== undefined &&
      v.to !== undefined &&
      v.to > v.from &&
      Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000),
);
export const FinanceBudgetCreateSchema = z.strictObject({
  name: Name,
  currency: Currency,
  limit: Money,
  categoryId: Id.nullable().default(null),
  period: z.enum(['WEEKLY', 'MONTHLY', 'CUSTOM']),
  timezone: Zone.optional(),
  calendar: z.enum(['GREGORIAN', 'JALALI']).optional(),
  firstDayOfWeek: z.number().int().min(0).max(6).optional(),
});
export const FinanceBudgetPatchSchema = z
  .strictObject({
    name: Name.optional(),
    limit: Money.optional(),
    categoryId: Id.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
const context = {
  currency: Currency,
  scale: z.number().int().min(0).max(4),
  limit: FinanceDecimalSchema,
  categoryId: Id.nullable(),
  timezone: Zone,
  calendar: z.enum(['GREGORIAN', 'JALALI']),
  firstDayOfWeek: z.number().int().min(0).max(6),
};
export const FinanceBudgetSchema = z.strictObject({
  ...root,
  name: Name,
  ...context,
  period: z.enum(['WEEKLY', 'MONTHLY', 'CUSTOM']),
  archived: z.boolean(),
});
export const FinancePeriodCreateSchema = z.strictObject({
  date: DateOnly,
  endDate: DateOnly.optional(),
});
export const FinancePeriodPatchSchema = z.strictObject({ limit: Money });
export const FinancePeriodSchema = z.strictObject({
  ...root,
  ...context,
  budgetId: Id,
  startDate: DateOnly,
  endDate: DateOnly,
  startAt: Time,
  endAt: Time,
  spent: FinanceDecimalSchema,
  remaining: FinanceDecimalSchema,
  overspent: z.boolean(),
});
export const FinanceScheduleSchema = z
  .strictObject({
    version: z.literal(1),
    frequency: z.enum([
      'DAILY',
      'WEEKLY',
      'SELECTED_WEEKDAYS',
      'MONTHLY',
      'YEARLY',
      'INTERVAL',
    ]),
    interval: z.number().int().min(1).max(365).default(1),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    until: DateOnly.nullable().default(null),
    count: z.number().int().min(1).max(10000).nullable().default(null),
    exclusions: z.array(DateOnly).max(366).default([]),
  })
  .refine(
    (v) =>
      new Set(v.weekdays).size === v.weekdays.length &&
      new Set(v.exclusions).size === v.exclusions.length &&
      (v.frequency === 'SELECTED_WEEKDAYS'
        ? v.weekdays.length > 0
        : v.weekdays.length === 0),
  );
export const FinanceBillCreateSchema = z.strictObject({
  name: Name,
  accountId: Id,
  type: z.enum(['INCOME', 'EXPENSE']).default('EXPENSE'),
  amount: Money,
  categoryId: Id.nullable().default(null),
  dueDate: DateOnly,
  timezone: Zone.optional(),
  schedule: FinanceScheduleSchema.nullable().default(null),
});
export const FinanceBillPatchSchema = z
  .strictObject({
    effectiveFrom: DateOnly,
    name: Name.optional(),
    amount: Money.optional(),
    categoryId: Id.nullable().optional(),
    dueDate: DateOnly.optional(),
    schedule: FinanceScheduleSchema.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 1);
export const FinanceBillSchema = z.strictObject({
  ...root,
  revisionId: Id,
  current: z.boolean(),
  effectiveFrom: DateOnly,
  name: Name,
  accountId: Id,
  type: z.enum(['INCOME', 'EXPENSE']),
  amount: FinanceDecimalSchema,
  currency: Currency,
  scale: z.number().int().min(0).max(4),
  categoryId: Id.nullable(),
  dueDate: DateOnly,
  timezone: Zone,
  schedule: FinanceScheduleSchema.nullable(),
  archived: z.boolean(),
});
export const FinanceBillPreviewQuerySchema = CursorQuerySchema.extend({
  from: DateOnly,
  to: DateOnly,
}).refine(
  (v) =>
    v.to > v.from && Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
);
export const FinanceBillOccurrenceSchema = z.strictObject({
  billId: Id,
  billRevision: Rev,
  occurrenceKey: DateOnly,
  dueDate: DateOnly,
  currency: Currency,
  amount: FinanceDecimalSchema,
  state: z.enum(['UNPAID', 'PAID', 'REVERSED']),
  transactionId: Id.nullable(),
});
export const FinanceBillPostSchema = z
  .strictObject({
    occurrenceKey: DateOnly,
    transactionId: Id.optional(),
    transactionRevision: Rev.optional(),
    occurredAt: Time.optional(),
    timezone: Zone.optional(),
  })
  .refine(
    (v) =>
      (v.transactionId === undefined) === (v.transactionRevision === undefined),
  );
export const FinanceSavingsCreateSchema = z
  .strictObject({
    name: Name,
    currency: Currency,
    target: Money,
    mode: z.enum(['ACCOUNT', 'MANUAL']),
    accountId: Id.nullable().default(null),
    manualAmount: FinanceNonnegativeSchema.nullable().default(null),
  })
  .refine((v) =>
    v.mode === 'ACCOUNT'
      ? v.accountId !== null && v.manualAmount === null
      : v.accountId === null && v.manualAmount !== null,
  );
export const FinanceSavingsPatchSchema = z
  .strictObject({
    name: Name.optional(),
    target: Money.optional(),
    manualAmount: FinanceNonnegativeSchema.optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const FinanceSavingsSchema = z.strictObject({
  ...root,
  revisionId: Id,
  current: z.boolean(),
  name: Name,
  currency: Currency,
  scale: z.number().int().min(0).max(4),
  target: FinanceDecimalSchema,
  mode: z.enum(['ACCOUNT', 'MANUAL']),
  accountId: Id.nullable(),
  manualAmount: FinanceDecimalSchema.nullable(),
  archived: z.boolean(),
  progress: FinanceDecimalSchema,
  percent: z.string(),
  exceeded: z.boolean(),
});
export const FinanceReportQuerySchema = z
  .strictObject({
    from: DateOnly,
    to: DateOnly,
    timezone: Zone.optional(),
    accountId: Id.optional(),
    categoryId: Id.optional(),
    currency: Currency.optional(),
  })
  .refine(
    (v) =>
      v.to > v.from && Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
  );
export const FinanceReportSchema = z.strictObject({
  from: DateOnly,
  to: DateOnly,
  timezone: Zone,
  startAt: Time,
  endAt: Time,
  postingCount: z.number().int().min(0).max(10000),
  currencies: z
    .array(
      z.strictObject({
        currency: Currency,
        income: FinanceDecimalSchema,
        expense: FinanceDecimalSchema,
        fees: FinanceDecimalSchema,
        transferIn: FinanceDecimalSchema,
        transferOut: FinanceDecimalSchema,
        adjustments: FinanceDecimalSchema,
        net: FinanceDecimalSchema,
      }),
    )
    .max(200),
  definitions: z.strictObject({
    window: z.literal('START_INCLUSIVE_END_EXCLUSIVE'),
    expense: z.literal('EXPENSE_PLUS_FEE'),
    reversals: z.literal('RESTATED_ORIGINAL_PERIOD'),
    currencies: z.literal('GROUPED_WITHOUT_IMPLICIT_CONVERSION'),
  }),
});
export const FinanceExportQuerySchema = FinanceReportQuerySchema.extend({
  format: z.enum(['json', 'csv']).default('json'),
});
const page = <T extends z.ZodType>(s: T) =>
  z.strictObject({
    items: z.array(s).max(100),
    nextCursor: z.string().nullable(),
  });
export const FinanceAccountPageSchema = page(FinanceAccountSchema),
  FinanceCategoryPageSchema = page(FinanceCategorySchema),
  FinanceTransactionPageSchema = page(FinanceTransactionSchema),
  FinanceBudgetPageSchema = page(FinanceBudgetSchema),
  FinancePeriodPageSchema = page(FinancePeriodSchema),
  FinanceBillPageSchema = page(FinanceBillSchema),
  FinanceBillOccurrencePageSchema = page(FinanceBillOccurrenceSchema),
  FinanceSavingsPageSchema = page(FinanceSavingsSchema);
export type FinancePost = z.infer<typeof FinancePostSchema>;
export type FinanceAccount = z.infer<typeof FinanceAccountSchema>;
export type FinanceCategory = z.infer<typeof FinanceCategorySchema>;
export type FinanceTransaction = z.infer<typeof FinanceTransactionSchema>;
export type FinanceBudget = z.infer<typeof FinanceBudgetSchema>;
export type FinancePeriod = z.infer<typeof FinancePeriodSchema>;
export type FinanceBill = z.infer<typeof FinanceBillSchema>;
export type FinanceSavings = z.infer<typeof FinanceSavingsSchema>;
export type FinanceQuery = z.infer<typeof FinanceQuerySchema>;
export type FinanceReportQuery = z.infer<typeof FinanceReportQuerySchema>;
