import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type {
  PlanningTaskSnapshot,
  ProductivityTaskSummary,
} from '../../tasks/public/index.js';
export const FOCUS_REPOSITORY = Symbol('FOCUS_REPOSITORY');
export type PageQuery = {
  limit?: string | undefined;
  cursor?: string | undefined;
};
export type SessionWrite = Pick<
  c.FocusRevision,
  | 'title'
  | 'mode'
  | 'pomodoro'
  | 'timezone'
  | 'taskId'
  | 'selectedTaskRevision'
  | 'state'
  | 'action'
  | 'elapsedMs'
  | 'runningSince'
  | 'recordedAt'
  | 'clockAdjusted'
>;
export type TimeWrite = Pick<
  c.TimeEntry,
  | 'kind'
  | 'state'
  | 'sessionId'
  | 'segmentOrdinal'
  | 'taskId'
  | 'selectedTaskRevision'
  | 'startAt'
  | 'endAt'
  | 'note'
  | 'timezone'
  | 'recordedAt'
>;
export interface FocusTransaction {
  clock(): Promise<Date>;
  timezone(): Promise<string>;
  session(id: string): Promise<c.FocusRevision>;
  sessions(
    query: z.infer<typeof c.FocusQuerySchema>,
  ): Promise<{ items: c.FocusRevision[]; nextCursor: string | null }>;
  history(
    id: string,
    q: PageQuery,
  ): Promise<{ items: c.FocusRevision[]; nextCursor: string | null }>;
  versions(id: string): Promise<c.FocusRevision[]>;
  appendSession(
    data: SessionWrite,
    before?: c.FocusRevision,
  ): Promise<c.FocusRevision>;
  entry(id: string): Promise<c.TimeEntry>;
  entries(
    q: z.infer<typeof c.TimeQuerySchema>,
  ): Promise<{ items: c.TimeEntry[]; nextCursor: string | null }>;
  entryHistory(
    id: string,
    q: PageQuery,
  ): Promise<{ items: c.TimeEntry[]; nextCursor: string | null }>;
  appendEntry(data: TimeWrite, before?: c.TimeEntry): Promise<c.TimeEntry>;
  task(id: string): Promise<PlanningTaskSnapshot>;
  reserved(): Promise<c.FocusRevision | null>;
  range(
    from: Date,
    to: Date,
  ): Promise<{
    entries: c.TimeEntry[];
    events: Array<{ action: string; recordedAt: string }>;
  }>;
  taskSummary(): Promise<ProductivityTaskSummary>;
  audit(
    action:
      | 'FOCUS_CREATE'
      | 'FOCUS_CHANGE'
      | 'TIME_ENTRY_CREATE'
      | 'TIME_ENTRY_CORRECT',
    id: string,
  ): Promise<void>;
}
export interface FocusPort {
  run<T>(
    scope: AuthorizedSpace,
    work: (tx: FocusTransaction) => Promise<T>,
  ): Promise<T>;
  once<T extends { id: string }>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    request: unknown,
    work: (tx: FocusTransaction) => Promise<T>,
  ): Promise<T>;
}
