import { it, expect } from 'vitest';
import {
  CompanyExpenseFactsSchema,
  CompanyExpenseReceiptCreateSchema,
  CompanyBudgetCreateSchema,
  CompanyMoneySchema,
} from './company-finance.js';
import { randomUUID } from 'node:crypto';
it('rejects numeric, exponent, negative, excess precision and oversized monetary transport', () => {
  for (const v of [1, '1e2', '-1', '1.00000', '1000000000000000000', '01.00'])
    expect(CompanyMoneySchema.safeParse(v).success).toBe(false);
  expect(CompanyMoneySchema.parse('999999999999999999.9999')).toBe(
    '999999999999999999.9999',
  );
});
it('restricts expense receipts to safe filenames, approved types and 10 MiB', () => {
  const body = {
    id: randomUUID(),
    filename: 'receipt.pdf',
    mimeType: 'application/pdf',
    expectedSize: 10485760,
  };
  expect(CompanyExpenseReceiptCreateSchema.safeParse(body).success).toBe(true);
  for (const change of [
    { filename: '../receipt.pdf' },
    { filename: 'invoice.js' },
    { mimeType: 'text/plain' },
    { expectedSize: 10485761 },
    { expectedSize: 0 },
    { public: true },
  ])
    expect(
      CompanyExpenseReceiptCreateSchema.safeParse({ ...body, ...change })
        .success,
    ).toBe(false);
});
it('validates explicit budget civil periods and IANA zones', () => {
  const body = {
    id: randomUUID(),
    title: 'Budget',
    amount: '1.00',
    currency: 'USD',
    startDate: '2026-01-01',
    endDate: '2027-01-01',
    timezone: 'Asia/Tehran',
  };
  expect(CompanyBudgetCreateSchema.safeParse(body).success).toBe(true);
  for (const change of [
    { currency: 'XYZ' },
    { endDate: '2026-01-01' },
    { timezone: 'unreal/zone' },
    { startDate: '2026-02-30' },
  ])
    expect(
      CompanyBudgetCreateSchema.safeParse({ ...body, ...change }).success,
    ).toBe(false);
});
it('rejects reimbursement fields and untyped payer or source references', () => {
  const body = {
    amount: '1.00',
    currency: 'USD',
    categoryId: randomUUID(),
    occurredDate: '2026-11-07',
    timezone: 'UTC',
  };
  expect(CompanyExpenseFactsSchema.safeParse(body).success).toBe(true);
  for (const change of [
    { paid: true },
    { reimbursementId: randomUUID() },
    { projectId: randomUUID() },
    { payer: { userId: randomUUID() } },
    { payer: { accessId: randomUUID(), generation: 0 } },
  ])
    expect(
      CompanyExpenseFactsSchema.safeParse({ ...body, ...change }).success,
    ).toBe(false);
});
