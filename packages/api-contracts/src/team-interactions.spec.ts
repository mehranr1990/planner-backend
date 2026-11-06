import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as c from './team-interactions.js';
it('bounds explicit disclosure recipients, rejects duplicates and invalid audience shapes', () => {
  const input = {
    id: randomUUID(),
    sourceRevision: 1,
    audience: 'NAMED',
    recipients: [{ accessId: randomUUID(), generation: 1 }],
    summary: 'Bounded summary',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  expect(c.TeamDisclosureCreateSchema.safeParse(input).success).toBe(true);
  for (const invalid of [
    { ...input, recipients: [] },
    { ...input, audience: 'TEAM' },
    { ...input, recipients: [...input.recipients, ...input.recipients] },
    { ...input, summary: '\0' },
    { ...input, privateEvidence: 'not an output' },
  ])
    expect(c.TeamDisclosureCreateSchema.safeParse(invalid).success).toBe(false);
});
it('keeps disclosed summaries separate from confidential source and reviewer fields', () => {
  const value = {
    id: randomUUID(),
    kind: 'CORRECTIVE',
    summary: 'Allowed summary only',
    expiresAt: new Date().toISOString(),
  };
  expect(c.TeamDisclosureSummarySchema.safeParse(value).success).toBe(true);
  for (const field of [
    'caseId',
    'reason',
    'evidence',
    'reviewNote',
    'author',
    'subject',
    'appeal',
  ])
    expect(
      c.TeamDisclosureSummarySchema.safeParse({ ...value, [field]: 'hidden' })
        .success,
    ).toBe(false);
});
it('keeps basic meetings distinct from recurring series and later minutes, files and external participants', () => {
  const value = {
    id: randomUUID(),
    event: {
      title: 'Team meeting',
      schedule: {
        kind: 'ALL_DAY',
        timezone: 'Asia/Tehran',
        startDate: '2030-01-07',
        endDate: '2030-01-08',
      },
    },
    agenda: 'Bounded agenda',
  };
  expect(c.TeamMeetingCreateSchema.safeParse(value).success).toBe(true);
  expect(
    c.TeamMeetingCreateSchema.safeParse({
      ...value,
      event: { ...value.event, recurrence: {} },
    }).success,
  ).toBe(false);
  for (const field of ['minutes', 'files', 'externalGuests'])
    expect(
      c.TeamMeetingCreateSchema.safeParse({ ...value, [field]: [] }).success,
    ).toBe(false);
});
