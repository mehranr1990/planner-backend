import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as c from './company-staff.js';
it('bounds work availability and validates civil dates and IANA zones without private-source inputs', () => {
  const body = {
    id: randomUUID(),
    member: { accessId: randomUUID(), generation: 1 },
    date: '2026-11-07',
    timezone: 'Asia/Tehran',
    availableMinutes: 0,
  };
  expect(c.CompanyAvailabilityCreateSchema.parse(body).availableMinutes).toBe(
    0,
  );
  expect(
    c.CompanyAvailabilityCreateSchema.parse({ ...body, availableMinutes: null })
      .availableMinutes,
  ).toBeNull();
  for (const extra of [
    { availableMinutes: 1441 },
    { availableMinutes: -1 },
    { availableMinutes: 0.5 },
    { date: '2026-02-30' },
    { timezone: 'not/a-zone' },
    { personalCalendar: true },
  ])
    expect(
      c.CompanyAvailabilityCreateSchema.safeParse({ ...body, ...extra })
        .success,
    ).toBe(false);
});
it('requires positive allocation windows and strict named-participant/evidence schemas', () => {
  const member = { accessId: randomUUID(), generation: 1 },
    body = {
      id: randomUUID(),
      member,
      startAt: '2026-11-07T08:00:00Z',
      endAt: '2026-11-07T09:00:00Z',
    };
  expect(c.CompanyAllocationCreateSchema.safeParse(body).success).toBe(true);
  expect(
    c.CompanyAllocationCreateSchema.safeParse({ ...body, endAt: body.startAt })
      .success,
  ).toBe(false);
  expect(
    c.CompanyAllocationCreateSchema.safeParse({ ...body, quantity: 10 })
      .success,
  ).toBe(false);
  expect(
    c.CompanyEmployeeCaseCreateSchema.safeParse({
      id: randomUUID(),
      subject: member,
      reviewer: member,
      reason: 'bounded',
      evidence: 'text',
      attachmentId: randomUUID(),
    }).success,
  ).toBe(false);
  expect(
    c.CompanyCaseEntryCreateSchema.safeParse({
      id: randomUUID(),
      kind: 'REVIEW',
      body: 'Reviewed',
    }).success,
  ).toBe(false);
  expect(
    c.CompanyWorkContactSchema.safeParse({
      published: true,
      email: 'forged@example.test',
    }).success,
  ).toBe(false);
});
it('rejects empty profile updates, sensitive HR fields and configurable case readers', () => {
  expect(c.CompanyStaffProfilePatchSchema.safeParse({}).success).toBe(false);
  for (const body of [
    { salary: 100 },
    { homeAddress: 'private' },
    { readers: ['OWNER'] },
    { workEmail: 'spoof@example.test' },
  ])
    expect(c.CompanyStaffProfilePatchSchema.safeParse(body).success).toBe(
      false,
    );
});
