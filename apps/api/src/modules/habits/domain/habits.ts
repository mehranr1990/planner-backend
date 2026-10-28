export type Rule =
  | { kind: 'DAILY' }
  | { kind: 'WEEKLY' }
  | { kind: 'WEEKDAYS'; weekdays: number[] }
  | { kind: 'INTERVAL'; days: number };
export type Definition = { version: 1; startDate: string; rule: Rule };
export type Status = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type Habit = {
  id: string;
  spaceId: string;
  createdByUserId: string;
  title: string;
  type: 'CHECKBOX' | 'QUANTITY' | 'DURATION';
  unit: string;
  purpose: 'GENERIC' | 'WATER';
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type Schedule = {
  id: string;
  habitId: string;
  revision: number;
  effectiveFrom: string;
  timezone: string;
  target: string;
  status: Status;
  schedule: Definition;
  createdAt: string;
};
export type Entry = {
  id: string;
  revisionId: string;
  habitId: string;
  scheduleId: string;
  revision: number;
  previousRevisionId: string | null;
  kind: Habit['type'] | 'SKIP';
  state: 'RECORDED' | 'VOID';
  localDate: string;
  value: string | null;
  timezone: string;
  recordedTimezone: string;
  recordedAt: string;
  actorUserId: string;
  current: boolean;
};
export type Routine = {
  id: string;
  spaceId: string;
  createdByUserId: string;
  title: string;
  status: 'ACTIVE' | 'ARCHIVED';
  revision: number;
  createdAt: string;
  updatedAt: string;
  habitIds: string[];
};
export const addDays = (date: string, count = 1) =>
  new Date(Date.parse(date + 'T00:00:00Z') + count * 86400000)
    .toISOString()
    .slice(0, 10);
export function localDate(now: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
/** All arithmetic uses integer thousandths; never convert a measure to Number. */
export function units(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, '0'));
}
export function decimal(value: bigint) {
  const whole = value / 1000n,
    part = String(value % 1000n)
      .padStart(3, '0')
      .replace(/0+$/, '');
  return String(whole) + (part ? '.' + part : '');
}
export function scheduleAt(versions: Schedule[], date: string) {
  return (
    versions
      .filter((v) => v.effectiveFrom <= date)
      .sort((a, b) => b.revision - a.revision)[0] ?? null
  );
}
export function currentSchedule(versions: Schedule[], now: Date) {
  return (
    versions
      .filter((v) => v.effectiveFrom <= localDate(now, v.timezone))
      .sort((a, b) => b.revision - a.revision)[0] ?? null
  );
}
export function due(def: Definition, date: string) {
  if (date < def.startDate) return false;
  const days = (Date.parse(date) - Date.parse(def.startDate)) / 86400000;
  switch (def.rule.kind) {
    case 'DAILY':
      return true;
    case 'WEEKLY':
      return days % 7 === 0;
    case 'INTERVAL':
      return days % def.rule.days === 0;
    case 'WEEKDAYS':
      return def.rule.weekdays.includes(
        ((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1,
      );
  }
}
export function sum(entries: Entry[], date?: string) {
  return entries
    .filter(
      (e) =>
        e.current &&
        e.state === 'RECORDED' &&
        e.kind !== 'SKIP' &&
        (date === undefined || e.localDate === date),
    )
    .reduce((sum, e) => sum + units(e.value!), 0n);
}
export function stats(
  habitId: string,
  versions: Schedule[],
  entries: Entry[],
  from: string,
  to: string,
  asOfDate: string,
) {
  const days: Array<{
    localDate: string;
    scheduleId: string | null;
    timezone: string | null;
    target: string | null;
    total: string;
    outcome:
      | 'COMPLETED'
      | 'MISSED'
      | 'PENDING'
      | 'SKIPPED'
      | 'REST'
      | 'PAUSED'
      | 'ARCHIVED'
      | 'UPCOMING';
  }> = [];
  let streak = 0,
    longest = 0,
    completed = 0,
    skipped = 0,
    missed = 0,
    pending = 0;
  const totals = new Map<string, bigint>(),
    skips = new Set<string>();
  for (const e of entries)
    if (e.current && e.state === 'RECORDED') {
      if (e.kind === 'SKIP') skips.add(e.localDate);
      else
        totals.set(
          e.localDate,
          (totals.get(e.localDate) ?? 0n) + units(e.value!),
        );
    }
  for (let date = from; date < to; date = addDays(date)) {
    const v = scheduleAt(versions, date),
      total = totals.get(date) ?? 0n;
    let outcome: (typeof days)[number]['outcome'];
    if (!v || !due(v.schedule, date)) outcome = 'REST';
    else if (v.status !== 'ACTIVE') outcome = v.status;
    else if (date > asOfDate) outcome = 'UPCOMING';
    else if (skips.has(date)) {
      outcome = 'SKIPPED';
      skipped++;
    } else if (total >= units(v.target)) {
      outcome = 'COMPLETED';
      completed++;
      streak++;
      longest = Math.max(longest, streak);
    } else if (date === asOfDate) {
      outcome = 'PENDING';
      pending++;
    } else {
      outcome = 'MISSED';
      missed++;
      streak = 0;
    }
    days.push({
      localDate: date,
      scheduleId: v?.id ?? null,
      timezone: v?.timezone ?? null,
      target: v?.target ?? null,
      total: decimal(total),
      outcome,
    });
  }
  return {
    habitId,
    from,
    to,
    asOfDate,
    streakScope: 'RANGE' as const,
    currentStreak: streak,
    longestStreak: longest,
    due: completed + skipped + missed + pending,
    completed,
    skipped,
    missed,
    pending,
    completionRate: {
      numerator: completed,
      denominator: completed + missed + pending,
    },
    days,
  };
}
