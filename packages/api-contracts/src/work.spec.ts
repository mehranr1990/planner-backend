import { describe, it, expect } from 'vitest';
import * as w from './work.js';
import { workPaths } from './work-openapi.js';
describe('P2-04 strict work contracts', () => {
  it('rejects assignment authority overposting and invalid decline reasons', () => {
    const input = {
      id: 'a6c82572-6422-4f32-8ab2-7d64a7f98e50',
      recipientAccessId: 'af4ad19b-60f7-48c2-8822-2e4a21852314',
      recipientGeneration: 1,
      kind: 'PRIMARY',
    };
    expect(w.TaskAssignmentCreateSchema.safeParse(input).success).toBe(true);
    expect(
      w.TaskAssignmentCreateSchema.safeParse({ ...input, decision: 'ACCEPTED' })
        .success,
    ).toBe(false);
    for (const reason of ['', '  ', '\u0000', 'x'.repeat(2001)])
      expect(w.TaskAssignmentDeclineSchema.safeParse({ reason }).success).toBe(
        false,
      );
    expect(
      w.TaskAssignmentDeclineSchema.parse({
        reason: '  Decline for capacity  ',
      }).reason,
    ).toBe('Decline for capacity');
  });
  it('bounds overlay dates, zones and project selection without widening Personal queries', () => {
    const query = {
      from: '2026-01-01',
      to: '2026-04-04',
      timezone: 'America/New_York',
    };
    expect(w.WorkOverlayQuerySchema.safeParse(query).success).toBe(true);
    expect(
      w.WorkOverlayQuerySchema.safeParse({ ...query, to: '2026-04-05' })
        .success,
    ).toBe(false);
    expect(
      w.WorkOverlayQuerySchema.safeParse({ ...query, timezone: 'invalid' })
        .success,
    ).toBe(false);
    expect(
      w.WorkOverlayQuerySchema.safeParse({ ...query, projectIds: 'invalid' })
        .success,
    ).toBe(false);
    expect(
      w.WorkOverlayQuerySchema.safeParse({ ...query, limit: 101 }).success,
    ).toBe(false);
    expect(
      w.WorkTaskQuerySchema.safeParse({ includePrivateFocus: true }).success,
    ).toBe(false);
  });
  it('describes exactly nineteen authenticated operations with current revision and privacy headers', () => {
    const operations = Object.values(workPaths()).flatMap((path) =>
      Object.values(path),
    ) as {
      security: unknown;
      parameters: { name: string; required: boolean }[];
      responses: Record<string, { headers: unknown }>;
    }[];
    expect(operations).toHaveLength(19);
    for (const op of operations) {
      expect(op.security).toEqual([{ sessionCookie: [] }]);
      for (const code of ['200', '201'])
        if (op.responses[code])
          expect(op.responses[code]!.headers).toHaveProperty('Cache-Control');
    }
    expect(
      w.SharedTaskScheduleInputSchema.safeParse({
        plannedStartAt: '2026-11-05T12:00:00Z',
        dueAt: '2026-11-04T12:00:00Z',
        scheduledDate: null,
      }).success,
    ).toBe(false);
  });
});
