import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  TeamAnalyticsQuerySchema,
  TeamCapacityCreateSchema,
} from './team-analytics.js';
it('bounds civil reporting windows, rejects unknown filters and requires exact member generations and availability', () => {
  const q = {
    fromDate: '2030-01-01',
    toDate: '2030-04-04',
    timezone: 'Asia/Tehran',
  };
  expect(TeamAnalyticsQuerySchema.safeParse(q).success).toBe(true);
  for (const invalid of [
    { ...q, toDate: '2030-04-05' },
    { ...q, toDate: q.fromDate },
    { ...q, timezone: 'Invalid/Zone' },
    { ...q, privateFocus: true },
  ])
    expect(TeamAnalyticsQuerySchema.safeParse(invalid).success).toBe(false);
  const input = {
    id: randomUUID(),
    member: { accessId: randomUUID(), generation: 1 },
    date: '2030-01-01',
    timezone: 'UTC',
    availableMinutes: null,
  };
  expect(TeamCapacityCreateSchema.safeParse(input).success).toBe(true);
  for (const availableMinutes of [-1, 1441, 1.5])
    expect(
      TeamCapacityCreateSchema.safeParse({ ...input, availableMinutes })
        .success,
    ).toBe(false);
  expect(
    TeamCapacityCreateSchema.safeParse({
      ...input,
      member: { ...input.member, generation: 0 },
    }).success,
  ).toBe(false);
});
