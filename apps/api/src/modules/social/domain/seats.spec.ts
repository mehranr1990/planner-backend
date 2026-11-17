import { describe, it, expect } from 'vitest';
import { reconcileSeats, requestSeat, seatCounts, OFFER_MS } from './seats.js';
import type { SeatRow } from './seats.js';
const now = new Date('2026-11-17T10:00:00.000Z');
const row = (id: string, seat: string, at?: number, expires?: number) =>
  ({
    id,
    state: 'ACTIVE',
    rsvp: seat === 'HELD' ? 'GOING' : 'PENDING',
    seat,
    waitlistedAt:
      seat === 'WAITLISTED' || seat === 'OFFERED'
        ? new Date(now.getTime() - (at ?? 0))
        : null,
    offerExpiresAt:
      seat === 'OFFERED' ? new Date(now.getTime() + (expires ?? 1)) : null,
  }) satisfies SeatRow;
describe('P6-02 capacity and waitlist', () => {
  it('offers released places FIFO for twelve hours without granting attendance', () => {
    const rows = [
      row('a', 'HELD'),
      row('c', 'WAITLISTED', 5),
      row('b', 'WAITLISTED', 10),
    ];
    const changes = reconcileSeats(2, true, rows, now);
    expect(changes).toEqual([
      {
        id: 'b',
        seat: 'OFFERED',
        waitlistedAt: rows[2]!.waitlistedAt,
        offerExpiresAt: new Date(now.getTime() + OFFER_MS),
      },
    ]);
  });
  it('expires stale offers and moves the place to the next waitlisted person', () => {
    const rows = [
      row('a', 'HELD'),
      row('b', 'OFFERED', 10, -1),
      row('c', 'WAITLISTED', 5),
    ];
    const changes = reconcileSeats(2, true, rows, now);
    expect(changes.find((c) => c.id === 'b')).toMatchObject({
      seat: 'NONE',
      offerExpiresAt: null,
    });
    expect(changes.find((c) => c.id === 'c')).toMatchObject({
      seat: 'OFFERED',
    });
  });
  it('never exceeds capacity and clears queues when the activity is not open', () => {
    const rows = [
      row('a', 'HELD'),
      row('b', 'HELD'),
      row('c', 'WAITLISTED', 1),
    ];
    expect(reconcileSeats(2, true, rows, now)).toEqual([]);
    expect(requestSeat(2, rows, row('d', 'NONE'))).toBe('WAITLISTED');
    expect(requestSeat(3, rows, row('d', 'NONE'))).toBe('HELD');
    expect(requestSeat(null, rows, row('d', 'NONE'))).toBe('HELD');
    expect(reconcileSeats(2, false, rows, now)).toEqual([
      { id: 'c', seat: 'NONE', waitlistedAt: null, offerExpiresAt: null },
    ]);
    expect(seatCounts(rows, now)).toEqual({ seatsTaken: 2, waitlistCount: 1 });
  });
  it('an offered participant may claim the reserved place', () => {
    const rows = [row('a', 'HELD'), row('b', 'OFFERED', 1, 1000)];
    expect(requestSeat(2, rows, rows[1]!)).toBe('HELD');
  });
});
