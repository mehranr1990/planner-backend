import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import { FOCUS_REPOSITORY } from './focus.port.js';
import type {
  FocusPort,
  FocusTransaction,
  SessionWrite,
  TimeWrite,
  PageQuery,
} from './focus.port.js';
import {
  measured,
  transition,
  workSpans,
  TimerError,
} from '../domain/focus.js';
import { clip, unionMilliseconds } from '../domain/intervals.js';
import type { Interval } from '../domain/intervals.js';
import { dayBoundary, addDays } from '../domain/dates.js';
const invalid = (code: string): never => {
  throw new BadRequestException({
    code: 'VALIDATION_ERROR',
    details: [{ path: 'focus', code }],
  });
};
const sessionWrite = (v: c.FocusRevision): SessionWrite => ({
  title: v.title,
  mode: v.mode,
  pomodoro: v.pomodoro,
  timezone: v.timezone,
  taskId: v.taskId,
  selectedTaskRevision: v.selectedTaskRevision,
  state: v.state,
  action: v.action,
  elapsedMs: v.elapsedMs,
  runningSince: v.runningSince,
  recordedAt: v.recordedAt,
  clockAdjusted: v.clockAdjusted,
});
const timeWrite = (v: c.TimeEntry): TimeWrite => ({
  kind: v.kind,
  state: v.state,
  sessionId: v.sessionId,
  segmentOrdinal: v.segmentOrdinal,
  taskId: v.taskId,
  selectedTaskRevision: v.selectedTaskRevision,
  startAt: v.startAt,
  endAt: v.endAt,
  note: v.note,
  timezone: v.timezone,
  recordedAt: v.recordedAt,
});
@Injectable()
export class FocusService {
  constructor(@Inject(FOCUS_REPOSITORY) private readonly repo: FocusPort) {}
  private key(key: string | undefined) {
    if (!key) throw new BadRequestException();
    return key;
  }
  private revision(value: { revision: number }, expected: number) {
    if (value.revision !== expected) throw new ConflictException();
  }
  private async newLink(
    tx: FocusTransaction,
    id: string | null | undefined,
    revision: number | undefined,
  ) {
    if (!id) return { taskId: null, selectedTaskRevision: null };
    const t = await tx.task(id);
    this.revision(t, revision!);
    if (
      t.deleted ||
      t.isMaster ||
      !['OPEN', 'IN_PROGRESS'].includes(t.status) ||
      t.occurrenceState === 'SKIPPED' ||
      t.occurrenceState === 'CANCELED'
    )
      invalid('TASK_UNAVAILABLE');
    return { taskId: id, selectedTaskRevision: t.revision };
  }
  private async view(
    tx: FocusTransaction,
    row: c.FocusRevision,
    now: Date,
  ): Promise<c.FocusView> {
    let disposition: c.FocusView['taskDisposition'] = 'NONE';
    if (row.taskId) {
      const t = await tx.task(row.taskId);
      disposition = t.deleted
        ? 'DELETED'
        : t.isMaster
          ? 'MASTER'
          : t.occurrenceState === 'SKIPPED'
            ? 'SKIPPED'
            : t.status === 'CANCELED' || t.occurrenceState === 'CANCELED'
              ? 'CANCELED'
              : t.status === 'DONE'
                ? 'DONE'
                : 'AVAILABLE';
    }
    return c.FocusViewSchema.parse({
      ...row,
      ...measured(row, now),
      serverNow: now.toISOString(),
      taskDisposition: disposition,
    });
  }
  create(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: c.FocusCreate,
  ) {
    return this.repo.once(
      scope,
      'create.focus',
      this.key(key),
      input,
      async (tx) => {
        const now = await tx.clock(),
          link = await this.newLink(tx, input.taskId, input.taskRevision);
        const row = await tx.appendSession({
          title: input.title,
          mode: input.mode,
          pomodoro:
            input.mode === 'POMODORO'
              ? (input.pomodoro ?? c.PomodoroSchema.parse({}))
              : null,
          timezone: input.timezone ?? (await tx.timezone()),
          ...link,
          state: 'IDLE',
          action: 'CREATE',
          elapsedMs: 0,
          runningSince: null,
          recordedAt: now.toISOString(),
          clockAdjusted: false,
        });
        await tx.audit('FOCUS_CREATE', row.id);
        return this.view(tx, row, now);
      },
    );
  }
  get(scope: AuthorizedSpace, id: string) {
    return this.repo.run(scope, async (tx) =>
      this.view(tx, await tx.session(id), await tx.clock()),
    );
  }
  list(scope: AuthorizedSpace, q: z.infer<typeof c.FocusQuerySchema>) {
    return this.repo.run(scope, async (tx) => {
      const page = await tx.sessions(q),
        now = await tx.clock();
      return {
        ...page,
        items: await Promise.all(page.items.map((r) => this.view(tx, r, now))),
      };
    });
  }
  history(scope: AuthorizedSpace, id: string, q: PageQuery) {
    return this.repo.run(scope, async (tx) => {
      await tx.session(id);
      return tx.history(id, q);
    });
  }
  patch(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: c.FocusPatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const before = await tx.session(id);
      this.revision(before, revision);
      if (before.state !== 'IDLE') throw new ConflictException();
      if (before.revision >= 999) invalid('REVISION_LIMIT');
      if (input.pomodoro && before.mode !== 'POMODORO') invalid('NOT_POMODORO');
      const now = await tx.clock(),
        at = new Date(
          Math.max(now.getTime(), Date.parse(before.recordedAt)),
        ).toISOString();
      const data = {
        ...sessionWrite(before),
        title: input.title ?? before.title,
        pomodoro: input.pomodoro ?? before.pomodoro,
        action: 'EDIT' as const,
        recordedAt: at,
        clockAdjusted:
          before.clockAdjusted || now.getTime() < Date.parse(before.recordedAt),
        ...(input.taskId === undefined
          ? {}
          : await this.newLink(tx, input.taskId, input.taskRevision)),
      };
      const row = await tx.appendSession(data, before);
      await tx.audit('FOCUS_CHANGE', id);
      return this.view(tx, row, now);
    });
  }
  action(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    action: 'START' | 'PAUSE' | 'RESUME' | 'FINISH' | 'STOP',
    key: string | undefined,
  ) {
    return this.repo.once(
      scope,
      'transition.focus.' + action.toLowerCase(),
      this.key(key),
      { id, revision, action },
      async (tx) => {
        const before = await tx.session(id);
        this.revision(before, revision);
        const terminal = action === 'FINISH' || action === 'STOP';
        if (before.revision >= 1000 || (!terminal && before.revision >= 999))
          invalid('REVISION_LIMIT');
        if (action === 'START' && (await tx.reserved()))
          throw new ConflictException();
        const now = await tx.clock();
        let change: ReturnType<typeof transition>;
        try {
          change = transition(before, action, now);
        } catch (e) {
          if (e instanceof TimerError) throw new ConflictException();
          throw e;
        }
        const row = await tx.appendSession(
          { ...sessionWrite(before), ...change, action },
          before,
        );
        if (terminal) {
          const spans = workSpans(
            await tx.versions(id),
            new Date(row.recordedAt),
          );
          for (const [segmentOrdinal, span] of spans.entries()) {
            await tx.appendEntry({
              kind: 'TRACKED',
              state: 'RECORDED',
              sessionId: id,
              segmentOrdinal,
              taskId: row.taskId,
              selectedTaskRevision: row.selectedTaskRevision,
              startAt: new Date(span.start).toISOString(),
              endAt: new Date(span.end).toISOString(),
              note: null,
              timezone: row.timezone,
              recordedAt: row.recordedAt,
            });
          }
        }
        await tx.audit('FOCUS_CHANGE', id);
        return this.view(tx, row, now);
      },
    );
  }
  private validateEntry(startAt: string, endAt: string, now: Date) {
    const start = Date.parse(startAt),
      end = Date.parse(endAt);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      end - start > 7 * 86400000 ||
      end > now.getTime()
    )
      invalid('INVALID_TIME_RANGE');
  }
  createEntry(
    scope: AuthorizedSpace,
    key: string | undefined,
    input: c.TimeCreate,
  ) {
    return this.repo.once(
      scope,
      'create.time',
      this.key(key),
      input,
      async (tx) => {
        const now = await tx.clock();
        this.validateEntry(input.startAt, input.endAt, now);
        const row = await tx.appendEntry({
          kind: 'MANUAL',
          state: 'RECORDED',
          sessionId: null,
          segmentOrdinal: null,
          startAt: input.startAt,
          endAt: input.endAt,
          note: input.note,
          timezone: input.timezone ?? (await tx.timezone()),
          recordedAt: now.toISOString(),
          ...(await this.newLink(tx, input.taskId, input.taskRevision)),
        });
        await tx.audit('TIME_ENTRY_CREATE', row.id);
        return row;
      },
    );
  }
  entry(scope: AuthorizedSpace, id: string) {
    return this.repo.run(scope, (tx) => tx.entry(id));
  }
  entries(scope: AuthorizedSpace, q: z.infer<typeof c.TimeQuerySchema>) {
    return this.repo.run(scope, (tx) => tx.entries(q));
  }
  entryHistory(scope: AuthorizedSpace, id: string, q: PageQuery) {
    return this.repo.run(scope, async (tx) => {
      await tx.entry(id);
      return tx.entryHistory(id, q);
    });
  }
  patchEntry(
    scope: AuthorizedSpace,
    id: string,
    revision: number,
    input: c.TimePatch,
  ) {
    return this.repo.run(scope, async (tx) => {
      const before = await tx.entry(id);
      this.revision(before, revision);
      if (before.kind !== 'MANUAL') throw new ConflictException();
      const now = await tx.clock(),
        startAt = input.startAt ?? before.startAt,
        endAt = input.endAt ?? before.endAt;
      this.validateEntry(startAt, endAt, now);
      const row = await tx.appendEntry(
        {
          ...timeWrite(before),
          startAt,
          endAt,
          note: input.note === undefined ? before.note : input.note,
          state:
            input.void === undefined
              ? before.state
              : input.void
                ? 'VOID'
                : 'RECORDED',
          recordedAt: new Date(
            Math.max(now.getTime(), Date.parse(before.recordedAt)),
          ).toISOString(),
          ...(input.taskId === undefined
            ? {}
            : await this.newLink(tx, input.taskId, input.taskRevision)),
        },
        before,
      );
      await tx.audit('TIME_ENTRY_CORRECT', id);
      return row;
    });
  }
  summary(scope: AuthorizedSpace, q: c.ProductivityQuery) {
    return this.repo.run(scope, async (tx) => {
      const now = await tx.clock(),
        range = {
          start: dayBoundary(q.from, q.timezone),
          end: dayBoundary(q.to, q.timezone),
        };
      const { entries, events } = await tx.range(
          new Date(range.start),
          new Date(range.end),
        ),
        reserved = await tx.reserved();
      const live = reserved
        ? workSpans(await tx.versions(reserved.id), now)
        : [];
      const amounts = (bounds: Interval) => {
        const values = entries
          .map((e) => ({
            entry: e,
            span: clip(
              { start: Date.parse(e.startAt), end: Date.parse(e.endAt) },
              bounds,
            ),
          }))
          .filter(
            (e): e is { entry: c.TimeEntry; span: Interval } => e.span !== null,
          );
        const duration = (v: { span: Interval }) => v.span.end - v.span.start;
        const recordedMs = values.reduce((n, v) => n + duration(v), 0),
          distinctWorkMs = unionMilliseconds(values.map((v) => v.span));
        return {
          recordedMs,
          distinctWorkMs,
          overlapMs: recordedMs - distinctWorkMs,
          manualMs: values
            .filter((v) => v.entry.kind === 'MANUAL')
            .reduce((n, v) => n + duration(v), 0),
          trackedMs: values
            .filter((v) => v.entry.kind === 'TRACKED')
            .reduce((n, v) => n + duration(v), 0),
          entryCount: values.length,
        };
      };
      const days = [];
      let start = range.start;
      for (let date = q.from; date < q.to; date = addDays(date)) {
        const end = dayBoundary(addDays(date), q.timezone);
        days.push({ localDate: date, ...amounts({ start, end }) });
        start = end;
      }
      return c.ProductivitySummarySchema.parse({
        ...q,
        serverNow: now.toISOString(),
        ...amounts(range),
        uncommittedWorkMs: unionMilliseconds(
          live
            .map((i) => clip(i, range))
            .filter((i): i is Interval => i !== null),
        ),
        days,
        sessions: {
          started: events.filter((e) => e.action === 'START').length,
          finished: events.filter((e) => e.action === 'FINISH').length,
          abandoned: events.filter((e) => e.action === 'STOP').length,
        },
        tasks: await tx.taskSummary(),
        definition:
          'CURRENT_NONVOID_ENTRIES_CLIPPED_TO_RANGE;DISTINCT_IS_INTERVAL_UNION;LIVE_EXCLUDED',
      });
    });
  }
}
