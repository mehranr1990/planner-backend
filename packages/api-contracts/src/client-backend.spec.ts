import { it, expect } from 'vitest';
import {
  HabitCreateSchema,
  HabitPatchSchema,
  CompanyInvitationCreateSchema,
} from './index.js';
const base = {
  title: 'Read',
  type: 'QUANTITY',
  unit: 'PAGE',
  target: '10',
  schedule: { startDate: '2026-11-25', rule: { kind: 'DAILY' } },
};
it('accepts Unicode display metadata while preserving canonical units and strict clocks', () => {
  const result = HabitCreateSchema.parse({
    ...base,
    category: 'سلامتی',
    unitLabel: 'صفحه',
    icon: 'BOOK',
    timeOfDay: 'EVENING',
    preferredTime: '20:30',
    reminder: { time: '21:00', ifNotDone: true },
  });
  expect(result.unit).toBe('PAGE');
  expect(result.unitLabel).toBe('صفحه');
  expect(HabitCreateSchema.safeParse({ ...base, unit: 'صفحه' }).success).toBe(
    false,
  );
  for (const patch of [
    { icon: 'arbitrary-url' },
    { preferredTime: '24:00' },
    { reminder: { time: '8:00' } },
    { unitLabel: '\u0000private' },
  ])
    expect(HabitPatchSchema.safeParse(patch).success).toBe(false);
  expect(
    HabitPatchSchema.safeParse({
      reminder: null,
      category: null,
      unitLabel: null,
      preferredTime: null,
    }).success,
  ).toBe(true);
});
it('keeps Company invitation fields optional and validates supervisor identifiers', () => {
  const base = {
    memberRole: 'MEMBER',
    recipient: { email: 'recipient@example.test' },
  };
  expect(CompanyInvitationCreateSchema.safeParse(base).success).toBe(true);
  expect(
    CompanyInvitationCreateSchema.safeParse({
      ...base,
      position: 'مهندس',
      supervisorMemberId: null,
    }).success,
  ).toBe(true);
  expect(
    CompanyInvitationCreateSchema.safeParse({
      ...base,
      supervisorMemberId: 'another-account',
    }).success,
  ).toBe(false);
});
