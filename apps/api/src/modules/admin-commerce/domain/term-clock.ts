export function termWindow(term: {
  startsAt: Date;
  endsAt: Date | null;
  shifts: { startShiftMs: bigint; endShiftMs: bigint }[];
  closure?: { endedAt: Date } | null;
}) {
  const start = term.shifts.reduce((n, v) => n + v.startShiftMs, 0n),
    end = term.shifts.reduce((n, v) => n + v.endShiftMs, 0n);
  const endsAt = term.endsAt
    ? new Date(term.endsAt.getTime() + Number(end))
    : null;
  return {
    startsAt: new Date(term.startsAt.getTime() + Number(start)),
    endsAt:
      term.closure && (!endsAt || term.closure.endedAt < endsAt)
        ? term.closure.endedAt
        : endsAt,
  };
}
