import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as c from './social-activities.js';
import { socialActivityPaths } from './social-activities-openapi.js';
const id = () => randomUUID();
describe('P6-02/P6-03 Social Activity contracts', () => {
  it('validates multi-day schedules and strict Activity input', () => {
    const base = {
      id: id(),
      template: 'TRAVEL',
      title: 'Trip',
      timezone: 'Asia/Tehran',
      startsAt: '2030-01-01T00:00:00.000Z',
      endsAt: '2030-01-05T00:00:00.000Z',
    };
    expect(c.SocialActivityCreateSchema.parse(base).groupId).toBeNull();
    expect(
      c.SocialActivityCreateSchema.safeParse({ ...base, endsAt: base.startsAt })
        .success,
    ).toBe(false);
    expect(
      c.SocialActivityCreateSchema.safeParse({
        ...base,
        endsAt: '2030-06-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      c.SocialActivityCreateSchema.safeParse({ ...base, timezone: 'Mars/Base' })
        .success,
    ).toBe(false);
    expect(
      c.SocialActivityCreateSchema.safeParse({ ...base, ownerUserId: id() })
        .success,
    ).toBe(false);
  });
  it('accepts only exact integer minor units and supported currencies', () => {
    const expense = {
      id: id(),
      title: 'Fuel',
      currency: 'USD',
      amountMinor: '1999',
      payerUserId: id(),
      method: 'EQUAL',
      incurredOn: '2030-01-01',
      shares: [{ userId: id() }],
    };
    expect(c.SocialExpenseCreateSchema.safeParse(expense).success).toBe(true);
    for (const amountMinor of ['19.99', '0', '-5', '1e3', 1999])
      expect(
        c.SocialExpenseCreateSchema.safeParse({ ...expense, amountMinor })
          .success,
      ).toBe(false);
    expect(
      c.SocialExpenseCreateSchema.safeParse({ ...expense, currency: 'XXX1' })
        .success,
    ).toBe(false);
    expect(c.SocialSettlementActionSchema.safeParse('transfer').success).toBe(
      false,
    );
  });
  it('declares mutation Origin, idempotency and no payment or feed operations', () => {
    const paths = socialActivityPaths();
    expect(Object.keys(paths).join(' ')).not.toMatch(
      /payment|transfer|feed|phone|album|lending/,
    );
    for (const [path, verbs] of Object.entries(paths))
      for (const [verb, raw] of Object.entries(verbs)) {
        const op = raw as {
          parameters: { in: string; name: string; required?: boolean }[];
          security: unknown[];
        };
        expect(op.security).toHaveLength(1);
        if (verb !== 'get')
          for (const name of path.endsWith('/finance-posting/preview')
            ? ['Origin']
            : ['Origin', 'Idempotency-Key'])
            expect(op.parameters).toContainEqual(
              expect.objectContaining({ name, in: 'header', required: true }),
            );
      }
  });
});
