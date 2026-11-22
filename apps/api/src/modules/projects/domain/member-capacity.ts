export function memberCapacity(
  date: string,
  dated: { minutes: number | null } | null,
  override: number | null | undefined,
  team: {
    dated: { minutes: number | null } | null;
    minutes: number | null;
    fullDayOff: boolean;
    leaveMinutes: number;
  } | null,
  hasOwnerTeam: boolean,
) {
  if (dated) return dated.minutes;
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const base = team?.dated
    ? team.dated.minutes
    : override !== undefined && override !== null
      ? override
      : hasOwnerTeam
        ? (team?.minutes ?? null)
        : weekday === 4 || weekday === 5
          ? 0
          : 480;
  if (team?.fullDayOff) return 0;
  return base === null ? null : Math.max(0, base - (team?.leaveMinutes ?? 0));
}
