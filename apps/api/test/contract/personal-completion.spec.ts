import { describe, it, expect } from 'vitest';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
import {
  RoutineScheduleSchema,
  WorkingHoursSchema,
  FocusRecoveryCommandSchema,
} from '@mehran/api-contracts';
describe('Personal completion contracts', () => {
  it('documents every new operation with owner authentication and mutation preconditions', () => {
    const paths = createOpenApiDocument().paths as unknown as Record<
      string,
      Record<
        string,
        {
          security: unknown;
          parameters: Array<{ name: string; required: boolean }>;
        }
      >
    >;
    for (const path of [
      '/routines/{id}/schedule',
      '/routines/{id}/occurrences',
      '/routines/{id}/occurrences/{date}/execute',
      '/planning/working-hours',
      '/planning/capacity/schedule',
      '/focus/sessions/{id}/recovery',
      '/me/deletion-policy',
      '/me/deletion-request/current',
      '/notifications/unread-count',
    ]) {
      expect(paths['/api/v1' + path]).toBeDefined();
      for (const [method, op] of Object.entries(paths['/api/v1' + path]!)) {
        expect(op.security).toEqual([{ sessionCookie: [] }]);
        if (method !== 'get')
          expect(op.parameters).toContainEqual(
            expect.objectContaining({ name: 'If-Match', required: true }),
          );
      }
    }
  });
  it('rejects missing schedule times, invalid intervals, duplicated exceptions and extension amounts', () => {
    expect(
      RoutineScheduleSchema.safeParse({
        startDate: '2026-11-01',
        kind: 'DAILY',
        timezone: 'UTC',
      }).success,
    ).toBe(false);
    expect(
      WorkingHoursSchema.safeParse({
        intervalsByWeekday: Array.from({ length: 7 }, () => [
          { start: '13:00', end: '12:00' },
        ]),
        exceptions: [],
      }).success,
    ).toBe(false);
    expect(
      FocusRecoveryCommandSchema.safeParse({ action: 'EXTEND' }).success,
    ).toBe(false);
    expect(
      FocusRecoveryCommandSchema.safeParse({ action: 'PAUSE', minutes: 5 })
        .success,
    ).toBe(false);
  });
});
