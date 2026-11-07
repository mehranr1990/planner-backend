import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  CompanyFinancialWorkflowVersionCreateSchema,
  CompanyReimbursementCreateSchema,
  CompanyPaymentAcknowledgementCreateSchema,
  CompanyAcknowledgementCorrectionCreateSchema,
} from './company-settlements.js';
it('bounds controlled workflow steps and requires generation-bound reviewer references', () => {
  const member = { accessId: randomUUID(), generation: 1 },
    step = { label: 'Review', primary: member, alternate: null },
    body = { id: randomUUID(), title: 'Version', steps: [step] };
  expect(
    CompanyFinancialWorkflowVersionCreateSchema.safeParse(body).success,
  ).toBe(true);
  for (const steps of [
    [],
    Array.from({ length: 6 }, () => step),
    [{ ...step, primary: { userId: randomUUID() } }],
    [{ ...step, primary: { ...member, generation: 0 } }],
  ])
    expect(
      CompanyFinancialWorkflowVersionCreateSchema.safeParse({ ...body, steps })
        .success,
    ).toBe(false);
});
it('accepts exact partial amounts and rejects numeric, negative and exponent money', () => {
  const body = { id: randomUUID(), expenseId: randomUUID(), amount: '0.01' };
  expect(CompanyReimbursementCreateSchema.safeParse(body).success).toBe(true);
  for (const amount of [1, '-1.00', '1e2', '1.00000', '1000000000000000000'])
    expect(
      CompanyReimbursementCreateSchema.safeParse({ ...body, amount }).success,
    ).toBe(false);
});
it('keeps execution, provider and unilateral paid-state fields outside reimbursement contracts', () => {
  for (const extra of [
    { paid: true },
    { provider: 'external' },
    { bankAccount: 'example' },
    { personalPosting: true },
  ])
    expect(
      CompanyReimbursementCreateSchema.safeParse({
        id: randomUUID(),
        expenseId: randomUUID(),
        amount: '1.00',
        ...extra,
      }).success,
    ).toBe(false);
  expect(
    CompanyPaymentAcknowledgementCreateSchema.safeParse({
      id: randomUUID(),
      amount: '1.00',
      status: 'ACKNOWLEDGED',
    }).success,
  ).toBe(false);
});
it('requires bounded acknowledgement correction evidence rather than a mutable original payment', () => {
  const body = {
    id: randomUUID(),
    amount: '1.00',
    reason: 'Record correction',
  };
  expect(
    CompanyAcknowledgementCorrectionCreateSchema.safeParse(body).success,
  ).toBe(true);
  for (const extra of [
    { reason: '' },
    { reason: 'x'.repeat(1001) },
    { paymentExecuted: true },
  ])
    expect(
      CompanyAcknowledgementCorrectionCreateSchema.safeParse({
        ...body,
        ...extra,
      }).success,
    ).toBe(false);
});
