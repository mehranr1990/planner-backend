import {
  addDates,
  dayBoundary,
  localKey,
  wallInstant,
  overlaps,
} from './calendar.js';
import type { Schedule } from './calendar.js';
import { matchesDate } from './recurrence.js';
import type { Event, Version, Block, Occurrence } from './model.js';
export type Range = { from: string; to: string; timezone: string };
export function interval(schedule: Schedule, timezone: string) {
  return schedule.kind === 'ALL_DAY'
    ? {
        start: dayBoundary(schedule.startDate, timezone),
        end: dayBoundary(schedule.endDate, timezone),
      }
    : schedule.startAt && schedule.endAt
      ? { start: Date.parse(schedule.startAt), end: Date.parse(schedule.endAt) }
      : null;
}
export function inRange(schedule: Schedule, range: Range) {
  if (schedule.kind === 'ALL_DAY')
    return schedule.startDate < range.to && schedule.endDate > range.from;
  const actual = interval(schedule, range.timezone);
  return (
    actual !== null &&
    overlaps(actual, {
      start: dayBoundary(range.from, range.timezone),
      end: dayBoundary(range.to, range.timezone),
    })
  );
}
function display(schedule: Schedule, timezone: string) {
  return schedule.kind === 'ALL_DAY'
    ? { displayStart: schedule.startDate, displayEnd: schedule.endDate }
    : {
        displayStart: schedule.startAt
          ? localKey(new Date(schedule.startAt), timezone)
          : schedule.localStart,
        displayEnd: schedule.endAt
          ? localKey(new Date(schedule.endAt), timezone)
          : schedule.localEnd,
      };
}
export function eventOccurrence(
  event: Event,
  timezone: string,
  owner?: Event,
): Occurrence {
  const seriesId = owner?.id ?? event.seriesId;
  return {
    identity: seriesId ? seriesId + '/' + event.recurrenceKey : event.id,
    resourceId: event.id,
    kind: 'EVENT',
    seriesId,
    recurrenceKey: event.recurrenceKey,
    revision: owner?.revision ?? event.revision,
    exceptionRevision: event.seriesId ? event.revision : 0,
    title: event.title,
    status: event.status,
    reason: null,
    schedule: event.schedule,
    ...display(event.schedule, timezone),
    taskId: null,
    taskDisposition: null,
  };
}
export function blockOccurrence(block: Block, timezone: string): Occurrence {
  return {
    identity: block.id,
    resourceId: block.id,
    kind: 'TIME_BLOCK',
    seriesId: null,
    recurrenceKey: null,
    revision: block.revision,
    exceptionRevision: 0,
    title: block.title,
    status: block.status,
    reason: null,
    schedule: block.schedule,
    ...display(block.schedule, timezone),
    taskId: block.taskId,
    taskDisposition: block.taskDisposition,
  };
}
export function scheduled(
  version: Version,
  date: string,
): { schedule: Schedule; gap: boolean } {
  const base = version.schedule;
  if (base.kind === 'ALL_DAY')
    return {
      schedule: {
        kind: 'ALL_DAY',
        timezone: base.timezone,
        startDate: date,
        endDate: addDates(
          date,
          (Date.parse(base.endDate) - Date.parse(base.startDate)) / 86400000,
        ),
        startAt: null,
        endAt: null,
      },
      gap: false,
    };
  const localStart = date + 'T' + version.definition.localTime,
    start = wallInstant(localStart, version.definition.timezone),
    duration = Date.parse(base.endAt!) - Date.parse(base.startAt!);
  const end = start ? new Date(start.getTime() + duration) : null;
  return {
    gap: start === null,
    schedule: {
      kind: 'TIMED',
      timezone: version.definition.timezone,
      localStart,
      localEnd: end
        ? localKey(end, version.definition.timezone).slice(0, 16)
        : new Date(Date.parse(localStart + 'Z') + duration)
            .toISOString()
            .slice(0, 16),
      startAt: start?.toISOString() ?? null,
      endAt: end?.toISOString() ?? null,
    },
  };
}
export function versionAt(versions: Version[], key: string) {
  return versions.find(
    (v) => key >= v.fromKey && (!v.untilKey || key < v.untilKey),
  );
}
/** Work is bounded to the requested 93 days plus the allowed 366-day duration.
 * Version identity intervals are disjoint; exceptions replace the original key. */
export function expand(
  event: Event,
  versions: Version[],
  exceptions: Event[],
  range: Range,
): Occurrence[] {
  if (event.deletedAt) return [];
  if (!versions.length)
    return inRange(event.schedule, range)
      ? [eventOccurrence(event, range.timezone)]
      : [];
  const overridden = new Set(exceptions.map((e) => e.recurrenceKey)),
    result: Occurrence[] = [];
  for (const v of versions) {
    const durationDays =
      v.schedule.kind === 'ALL_DAY'
        ? (Date.parse(v.schedule.endDate) - Date.parse(v.schedule.startDate)) /
          86400000
        : Math.ceil(
            (Date.parse(v.schedule.endAt!) - Date.parse(v.schedule.startAt!)) /
              86400000,
          );
    let date = [
      addDates(range.from, -durationDays - 2),
      v.fromKey.slice(0, 10),
      v.definition.startDate,
    ]
      .sort()
      .at(-1)!;
    const until = [
      addDates(range.to, 2),
      v.untilKey?.slice(0, 10) ?? '9999-12-31',
      event.splitBefore?.slice(0, 10) ?? '9999-12-31',
      v.definition.endDate ?? '9999-12-31',
    ].sort()[0]!;
    for (; date <= until; date = addDates(date, 1)) {
      const key = date + 'T' + v.identityTime;
      if (
        key < v.fromKey ||
        (v.untilKey && key >= v.untilKey) ||
        (event.splitBefore && key >= event.splitBefore) ||
        overridden.has(key) ||
        !matchesDate(v.definition, date)
      )
        continue;
      const candidate = scheduled(v, date);
      if (
        candidate.gap
          ? date < range.from || date >= range.to
          : !inRange(candidate.schedule, range)
      )
        continue;
      const o = eventOccurrence(
        {
          ...event,
          title: v.title,
          status: v.status,
          schedule: candidate.schedule,
          recurrenceKey: key,
        },
        range.timezone,
        event,
      );
      o.identity = event.id + '/' + key;
      o.seriesId = event.id;
      if (candidate.gap) {
        o.status = 'SKIPPED';
        o.reason = 'DST_GAP';
      }
      result.push(o);
    }
  }
  for (const exception of exceptions)
    if (!exception.deletedAt && inRange(exception.schedule, range))
      result.push(eventOccurrence(exception, range.timezone, event));
  return result.sort((a, b) =>
    a.recurrenceKey!.localeCompare(b.recurrenceKey!),
  );
}
