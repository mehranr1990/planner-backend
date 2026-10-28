import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as f from './finance.js';
import {
  financeCurrencyScales,
  financeCurrencySource,
} from './finance-currencies.js';
describe('Finance strict contracts', () => {
  it('accepts string amounts and rejects numeric/exponent/negative/zero/oversize money', () => {
    expect(f.FinanceAmountSchema.parse('0.01')).toBe('0.01');
    for (const n of [1, '1e3', '-2', '0', '9999999999999999999', '01', 'NaN'])
      expect(f.FinanceAmountSchema.safeParse(n).success).toBe(false);
  });
  it('freezes supported ISO currencies and rejects arbitrary codes', () => {
    for (const c of ['USD', 'JPY', 'BHD', 'IRR', 'KWD', 'CLF', 'UYW'])
      expect(f.FinanceCurrencySchema.safeParse(c).success).toBe(true);
    for (const c of ['usd', 'BTC', 'FOO', 'US', 'XDR', 'BGN'])
      expect(f.FinanceCurrencySchema.safeParse(c).success).toBe(false);
  });
  it('pins official ISO scales and provenance independently of Intl', () => {
    for (const code of ['AFN', 'COP', 'IDR', 'IRR'])
      expect(financeCurrencyScales[code]).toBe(2);
    expect(financeCurrencyScales.JPY).toBe(0);
    expect(financeCurrencyScales.KWD).toBe(3);
    expect(financeCurrencyScales.CLF).toBe(4);
    expect(financeCurrencyScales.UYW).toBe(4);
    expect(Object.keys(financeCurrencyScales)).toHaveLength(165);
    expect(financeCurrencySource.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects balance/owner/space overposting', () => {
    for (const extra of [
      { balance: '1.00' },
      { spaceId: randomUUID() },
      { createdByUserId: randomUUID() },
    ])
      expect(
        f.FinanceAccountCreateSchema.safeParse({
          name: 'Cash',
          currency: 'USD',
          ...extra,
        }).success,
      ).toBe(false);
  });
  it('makes savings sources mutually exclusive', () => {
    expect(
      f.FinanceSavingsCreateSchema.safeParse({
        name: 'Reserve',
        currency: 'USD',
        target: '100',
        mode: 'MANUAL',
        manualAmount: '0',
      }).success,
    ).toBe(true);
    expect(
      f.FinanceSavingsCreateSchema.safeParse({
        name: 'Reserve',
        currency: 'USD',
        target: '100',
        mode: 'ACCOUNT',
        accountId: randomUUID(),
        manualAmount: '10',
      }).success,
    ).toBe(false);
  });
  it('bounds report windows and recurrence configuration', () => {
    expect(
      f.FinanceReportQuerySchema.safeParse({
        from: '2024-01-01',
        to: '2026-01-01',
      }).success,
    ).toBe(false);
    expect(
      f.FinanceScheduleSchema.safeParse({
        version: 1,
        frequency: 'SELECTED_WEEKDAYS',
        weekdays: [1, 1],
      }).success,
    ).toBe(false);
    expect(
      f.FinanceScheduleSchema.safeParse({
        version: 1,
        frequency: 'WEEKLY',
        interval: 0,
      }).success,
    ).toBe(false);
  });
  it('requires paired existing-payment identity/revision', () => {
    expect(
      f.FinanceBillPostSchema.safeParse({
        occurrenceKey: '2024-01-01',
        transactionId: randomUUID(),
      }).success,
    ).toBe(false);
  });
  it('does not default omitted patch properties', () => {
    expect(f.FinanceBudgetPatchSchema.parse({ name: 'Changed' })).toEqual({
      name: 'Changed',
    });
    expect(
      f.FinanceBillPatchSchema.parse({
        effectiveFrom: '2024-01-01',
        name: 'Changed',
      }),
    ).toEqual({ effectiveFrom: '2024-01-01', name: 'Changed' });
  });
});
