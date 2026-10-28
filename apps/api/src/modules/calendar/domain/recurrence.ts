// Calendar-owned rule evaluation follows approved ADR 0008 patterns. No Task persistence or lifecycle coupling.
export type RecurrenceRule =
  | { kind: 'DAILY'; interval: number }
  | { kind: 'WEEKLY'; interval: number }
  | { kind: 'WEEKDAYS'; interval: number; weekdays: number[] }
  | { kind: 'MONTHLY_DATE'; interval: number; day: number }
  | { kind: 'MONTHLY_NTH'; interval: number; weekday: number; nth: number }
  | { kind: 'YEARLY'; interval: number; month: number; day: number }
  | {
      kind: 'INTERVAL';
      interval: number;
      unit: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
    };
export type RecurrenceDefinition = {
  version: 1;
  startDate: string;
  endDate: string | null;
  localTime: string;
  timezone: string;
  rule: RecurrenceRule;
  exclusionDates: string[];
};
const dayMs = 86400000;
const date = (value: string) => new Date(value + 'T00:00:00Z');
export const nextDate = (value: string, days = 1) =>
  new Date(date(value).getTime() + days * dayMs).toISOString().slice(0, 10);
export function matchesDate(def: RecurrenceDefinition, value: string): boolean {
  if (
    value < def.startDate ||
    (def.endDate !== null && value > def.endDate) ||
    def.exclusionDates.includes(value)
  )
    return false;
  const start = date(def.startDate),
    current = date(value),
    rule = def.rule;
  const days = Math.round((current.getTime() - start.getTime()) / dayMs);
  const months =
    (current.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    current.getUTCMonth() -
    start.getUTCMonth();
  const years = current.getUTCFullYear() - start.getUTCFullYear();
  const weekday = ((current.getUTCDay() + 6) % 7) + 1; // ISO Monday=1
  const startWeekday = ((start.getUTCDay() + 6) % 7) + 1;
  switch (rule.kind) {
    case 'DAILY':
      return days % rule.interval === 0;
    case 'WEEKLY':
      return days % (7 * rule.interval) === 0;
    case 'WEEKDAYS':
      return (
        Math.floor((days + startWeekday - 1) / 7) % rule.interval === 0 &&
        rule.weekdays.includes(weekday)
      );
    case 'MONTHLY_DATE':
      return months % rule.interval === 0 && current.getUTCDate() === rule.day;
    case 'MONTHLY_NTH':
      return (
        months % rule.interval === 0 &&
        weekday === rule.weekday &&
        (rule.nth === -1
          ? date(nextDate(value, 7)).getUTCMonth() !== current.getUTCMonth()
          : Math.floor((current.getUTCDate() - 1) / 7) + 1 === rule.nth)
      );
    case 'YEARLY':
      return (
        years % rule.interval === 0 &&
        current.getUTCMonth() + 1 === rule.month &&
        current.getUTCDate() === rule.day
      );
    case 'INTERVAL':
      switch (rule.unit) {
        case 'DAY':
          return days % rule.interval === 0;
        case 'WEEK':
          return days % (7 * rule.interval) === 0;
        case 'MONTH':
          return (
            months % rule.interval === 0 &&
            current.getUTCDate() === start.getUTCDate()
          );
        case 'YEAR':
          return (
            years % rule.interval === 0 &&
            current.getUTCMonth() === start.getUTCMonth() &&
            current.getUTCDate() === start.getUTCDate()
          );
      }
  }
}
