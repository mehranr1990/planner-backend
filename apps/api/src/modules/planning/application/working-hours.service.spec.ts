import { describe, it, expect } from 'vitest';
import { WorkingHoursService } from './working-hours.service.js';
import type { WorkingHoursPort } from './working-hours.port.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
describe('working-hours temporal capacity', () => {
  const scope = {} as AuthorizedSpace;
  const service = (
    intervals = [{ start: '01:00', end: '04:00' }],
    exceptions: Array<{
      date: string;
      intervals: Array<{ start: string; end: string }>;
    }> = [],
  ) =>
    new WorkingHoursService(
      {
        write: async () => {
          throw new Error('Read-only fixture');
        },
        read: async () => ({
          revision: 1,
          timezone: 'America/New_York',
          firstDayOfWeek: 0,
          workingHours: {
            intervalsByWeekday: Array.from({ length: 7 }, () => intervals),
            exceptions,
          },
        }),
      } as WorkingHoursPort,
      { busy: async () => [] },
    );
  it('uses actual elapsed intervals across spring and autumn DST', async () => {
    expect(
      (await service().capacity(scope, { date: '2026-03-08' }))
        .availableMinutes,
    ).toBe(120);
    expect(
      (await service().capacity(scope, { date: '2026-11-01' }))
        .availableMinutes,
    ).toBe(240);
  });
  it('reports missing wall endpoints explicitly', async () => {
    const result = await service([{ start: '02:30', end: '04:00' }]).capacity(
      scope,
      { date: '2026-03-08' },
    );
    expect(result.state).toBe('DST_GAP');
    expect(result.availableMinutes).toBeNull();
  });
  it('aggregates a DST week and a partial-day exception', async () => {
    const result = await service(undefined, [
      { date: '2026-03-09', intervals: [{ start: '10:00', end: '11:00' }] },
    ]).capacity(scope, { weekStartDate: '2026-03-08' });
    expect(result.availableMinutes).toBe(1080); // 2h + 1h exception + five 3h days
    expect(result.days).toHaveLength(7);
  });
});
