/** P6-02 capacity, FIFO waitlist and ADR 0051 twelve-hour released-place offers. */
export const OFFER_MS = 12 * 3600 * 1000;
export type SeatRow = {
  id: string;
  state: string;
  rsvp: string;
  seat: string;
  waitlistedAt: Date | null;
  offerExpiresAt: Date | null;
};
export type SeatChange = Pick<
  SeatRow,
  'id' | 'seat' | 'waitlistedAt' | 'offerExpiresAt'
>;
const holds = (r: SeatRow) => r.seat === 'HELD' || r.seat === 'OFFERED';
/**
 * Expires stale offers, clears queues of non-open activities and offers free
 * places to the oldest waitlisted participants. An offer is never attendance.
 */
export function reconcileSeats(
  capacity: number | null,
  open: boolean,
  rows: SeatRow[],
  now: Date,
): SeatChange[] {
  const current = new Map(rows.map((r) => [r.id, { ...r }]));
  const changes = new Map<string, SeatChange>();
  const set = (r: SeatRow, patch: Omit<SeatChange, 'id'>) => {
    Object.assign(r, patch);
    changes.set(r.id, { id: r.id, ...patch });
  };
  for (const r of current.values())
    if (
      (r.seat === 'OFFERED' && r.offerExpiresAt! <= now) ||
      (!open && (r.seat === 'OFFERED' || r.seat === 'WAITLISTED')) ||
      (r.state !== 'ACTIVE' && r.seat !== 'NONE')
    )
      set(r, { seat: 'NONE', waitlistedAt: null, offerExpiresAt: null });
  if (open) {
    const taken = [...current.values()].filter(holds).length;
    let free = capacity === null ? Infinity : capacity - taken;
    const queue = [...current.values()]
      .filter((r) => r.seat === 'WAITLISTED')
      .sort(
        (a, b) =>
          a.waitlistedAt!.getTime() - b.waitlistedAt!.getTime() ||
          a.id.localeCompare(b.id),
      );
    for (const r of queue) {
      if (free <= 0) break;
      set(r, {
        seat: 'OFFERED',
        waitlistedAt: r.waitlistedAt,
        offerExpiresAt: new Date(now.getTime() + OFFER_MS),
      });
      free--;
    }
  }
  return [...changes.values()];
}
/** Call only after reconcileSeats has been applied in the same locked transaction. */
export function requestSeat(
  capacity: number | null,
  rows: SeatRow[],
  me: SeatRow,
): 'HELD' | 'WAITLISTED' {
  if (me.seat === 'HELD' || me.seat === 'OFFERED') return 'HELD';
  const taken = rows.filter((r) => r.id !== me.id && holds(r)).length;
  return capacity === null || taken < capacity ? 'HELD' : 'WAITLISTED';
}
export function seatCounts(rows: SeatRow[], now: Date) {
  const live = (r: SeatRow) =>
    r.seat === 'HELD' || (r.seat === 'OFFERED' && r.offerExpiresAt! > now);
  return {
    seatsTaken: rows.filter(live).length,
    waitlistCount: rows.filter(
      (r) =>
        r.seat === 'WAITLISTED' ||
        (r.seat === 'OFFERED' && r.offerExpiresAt! <= now),
    ).length,
  };
}
