import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { wallInstant } from '../../calendar/public/index.js';
import { assertAdditiveMigration } from '../../../../../../tooling/testing/migration-safety.js';
import {
  boardState,
  checkinStatus,
  checkinWindow,
  engineStatus,
  presenceActive,
  validClearTime,
} from './collaboration.js';

describe('Team collaboration rules', () => {
  it('derives board states only while the overlay status still matches', () => {
    const review = { state: 'REVIEW', taskStatus: 'IN_PROGRESS' };
    expect(boardState('IN_PROGRESS', review)).toBe('REVIEW');
    expect(boardState('OPEN', review)).toBe('TODO');
    expect(boardState('DONE', review)).toBe('DONE');
    expect(boardState('OPEN', { state: 'BLOCKED', taskStatus: 'OPEN' })).toBe(
      'BLOCKED',
    );
    expect(boardState('IN_PROGRESS', null)).toBe('IN_PROGRESS');
    expect(engineStatus('REVIEW', 'OPEN')).toBe('IN_PROGRESS');
    expect(engineStatus('BLOCKED', 'DONE')).toBe('OPEN');
    expect(engineStatus('BLOCKED', 'IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(() => engineStatus('CANCELED', 'OPEN')).toThrow();
  });
  it('resolves weekly windows with the 24h late period and DST-safe wall times', () => {
    const s = {
      cadence: 'WEEKLY' as const,
      opensDay: 6,
      opensTime: '09:00',
      closesDay: 3,
      closesTime: '18:00',
      timezone: 'Asia/Tehran',
    };
    const w = checkinWindow(wallInstant, '2030-01-05', s);
    expect(w.opensAt.toISOString()).toBe('2030-01-05T05:30:00.000Z');
    expect(w.closesAt.toISOString()).toBe('2030-01-09T14:30:00.000Z');
    expect(w.lateUntil.getTime() - w.closesAt.getTime()).toBe(86400000);
    expect(checkinStatus(w, new Date('2030-01-04T00:00:00Z'))).toBe('UPCOMING');
    expect(checkinStatus(w, new Date('2030-01-06T00:00:00Z'))).toBe('OPEN');
    expect(checkinStatus(w, new Date('2030-01-10T00:00:00Z'))).toBe('LATE');
    expect(checkinStatus(w, new Date('2030-01-11T00:00:00Z'))).toBe('CLOSED');
    expect(() => checkinWindow(wallInstant, '2030-01-06', s)).toThrow(
      'PERIOD_NOT_ON_OPENING_DAY',
    );
    const gap = checkinWindow(wallInstant, '2030-03-10', {
      ...s,
      opensDay: 0,
      opensTime: '02:30',
      timezone: 'America/New_York',
    });
    expect(gap.opensAt.toISOString()).toBe('2030-03-10T07:00:00.000Z');
  });
  it('gives daily check-ins the approved 24h late window and supports overnight closing', () => {
    const daily = {
      cadence: 'DAILY' as const,
      opensTime: '20:00',
      closesTime: '10:00',
      timezone: 'UTC',
    };
    const w = checkinWindow(wallInstant, '2030-01-07', daily);
    expect(w.closesAt.toISOString()).toBe('2030-01-08T10:00:00.000Z');
    expect(w.lateUntil.toISOString()).toBe('2030-01-09T10:00:00.000Z');
    expect(checkinStatus(w, new Date('2030-01-09T09:59:00Z'))).toBe('LATE');
    expect(checkinStatus(w, new Date('2030-01-09T10:00:00Z'))).toBe('CLOSED');
  });
  it('accepts only bounded client clear times and expires statuses', () => {
    const now = new Date('2030-01-01T00:00:00Z');
    expect(validClearTime('NEVER', null, now)).toBe(true);
    expect(validClearTime('HOUR', new Date('2030-01-01T01:00:00Z'), now)).toBe(
      true,
    );
    expect(validClearTime('HOUR', new Date('2030-01-01T03:00:00Z'), now)).toBe(
      false,
    );
    expect(validClearTime('TODAY', now, now)).toBe(false);
    expect(
      presenceActive(
        { status: 'BUSY', until: new Date(now.getTime() - 1) },
        now,
      ),
    ).toBe(false);
    expect(presenceActive({ status: null, until: null }, now)).toBe(false);
  });
  it('keeps the Team completion migration strictly additive', () => {
    expect(() =>
      assertAdditiveMigration(
        fs.readFileSync(
          'prisma/migrations/202611130048_team_completion/migration.sql',
          'utf8',
        ),
      ),
    ).not.toThrow();
  });
});
