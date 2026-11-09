import { describe, it, expect } from 'vitest';
import { meetingManages } from './meeting-policy.js';
describe('ADR 0048 exact-source organizer roles', () => {
  it.each([
    ['PROJECT', 'MANAGER'],
    ['TEAM', 'LEAD'],
    ['COMPANY', 'ORG_ADMIN'],
    ['INDEPENDENT', 'ADMIN'],
    ['MEETING', 'OWNER'],
  ])(
    'permits %s %s after independent current-admission authorization',
    (kind, role) => {
      expect(meetingManages(kind!, role!)).toBe(true);
    },
  );
  it.each([
    ['PROJECT', 'LEAD'],
    ['PROJECT', 'ORG_ADMIN'],
    ['TEAM', 'MANAGER'],
    ['TEAM', 'ORG_ADMIN'],
    ['COMPANY', 'ADMIN'],
    ['COMPANY', 'LEAD'],
    ['INDEPENDENT', 'MEMBER'],
    ['UNKNOWN', 'OWNER'],
  ])('does not borrow a role from another context: %s %s', (kind, role) => {
    expect(meetingManages(kind!, role!)).toBe(false);
  });
  it.each(['PROJECT', 'TEAM', 'COMPANY', 'INDEPENDENT', 'MEETING'])(
    'excludes Viewer, ordinary member and grant-only in %s',
    (kind) => {
      for (const role of ['VIEWER', 'MEMBER', null])
        expect(meetingManages(kind, role)).toBe(false);
    },
  );
});
