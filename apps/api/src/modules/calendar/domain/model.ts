import type { Schedule } from './calendar.js';
import type { RecurrenceDefinition } from './recurrence.js';
export type Entity = {
  id: string;
  spaceId: string;
  createdByUserId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  title: string;
  status: 'ACTIVE' | 'CANCELED';
  schedule: Schedule;
};
export type Event = Entity & {
  description: string | null;
  seriesId: string | null;
  recurrenceKey: string | null;
  previousSeriesId: string | null;
  splitBefore: string | null;
  recurrence: RecurrenceDefinition | null;
};
export type Version = {
  id: string;
  eventId: string;
  revision: number;
  fromKey: string;
  untilKey: string | null;
  identityTime: string;
  definition: RecurrenceDefinition;
  title: string;
  description: string | null;
  status: 'ACTIVE' | 'CANCELED';
  schedule: Schedule;
};
export type TaskDisposition =
  | 'READY'
  | 'STALE'
  | 'DELETED'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'CANCELED'
  | 'BLOCKED';
export type Block = Entity & {
  taskId: string | null;
  selectedTaskRevision: number | null;
  taskDisposition: TaskDisposition | null;
};
export type Occurrence = {
  identity: string;
  resourceId: string;
  kind: 'EVENT' | 'TIME_BLOCK';
  seriesId: string | null;
  recurrenceKey: string | null;
  revision: number;
  exceptionRevision: number;
  title: string;
  status: 'ACTIVE' | 'CANCELED' | 'SKIPPED';
  reason: 'DST_GAP' | null;
  schedule: Schedule;
  displayStart: string;
  displayEnd: string;
  taskId: string | null;
  taskDisposition: TaskDisposition | null;
};
export const policies = {
  foldPolicy: 'EARLIER' as const,
  gapPolicy: 'REJECT_EXPLICIT_SKIP_RECURRENCE' as const,
};
