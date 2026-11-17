import { it, expect } from 'vitest';
import {
  AgendaDetailPatchSchema,
  AnnouncementScheduleInputSchema,
} from './messages-meetings-gap.js';
it('validates nullable explicit minutes and bounded safe shared notes without changing legacy defaults', () => {
  for (const plannedMinutes of [0, -1, 1.5, 2147483648])
    expect(AgendaDetailPatchSchema.safeParse({ plannedMinutes }).success).toBe(
      false,
    );
  expect(AgendaDetailPatchSchema.parse({ plannedMinutes: null })).toEqual({
    plannedMinutes: null,
  });
  expect(AgendaDetailPatchSchema.safeParse({}).success).toBe(false);
  expect(AgendaDetailPatchSchema.safeParse({ notes: 'unsafe\0' }).success).toBe(
    false,
  );
  expect(
    AgendaDetailPatchSchema.safeParse({ notes: 'a'.repeat(10001) }).success,
  ).toBe(false);
  expect(
    AgendaDetailPatchSchema.safeParse({
      completed: true,
      ownerUserId: 'invented',
    }).success,
  ).toBe(false);
});
it('requires UTC publication instants, IANA zones and the existing explicit audience model', () => {
  const body = {
    scheduledAt: '2027-01-01T09:00:00Z',
    timezone: 'Asia/Tehran',
    audience: { audience: 'ALL' },
  };
  expect(AnnouncementScheduleInputSchema.safeParse(body).success).toBe(true);
  for (const patch of [
    { timezone: '+03:30' },
    { timezone: 'Invalid/Zone' },
    { scheduledAt: '2027-01-01T09:00' },
    { audience: { audience: 'ROLE', role: 'MEMBER' } },
  ])
    expect(
      AnnouncementScheduleInputSchema.safeParse({ ...body, ...patch }).success,
    ).toBe(false);
});
