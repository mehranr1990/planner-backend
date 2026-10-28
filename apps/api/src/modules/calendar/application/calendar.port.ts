import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { Event, Version, Block } from '../domain/model.js';
import type { Schedule } from '../domain/calendar.js';
import type { RecurrenceDefinition } from '../domain/recurrence.js';
export const CALENDAR_REPOSITORY = Symbol('CALENDAR_REPOSITORY');
export type EventWrite = {
  title: string;
  description: string | null;
  schedule: Schedule;
  status: 'ACTIVE' | 'CANCELED';
  seriesId?: string;
  recurrenceKey?: string;
  previousSeriesId?: string;
  splitBefore?: string;
  deletedAt?: string;
};
export type BlockWrite = {
  title: string;
  schedule: Schedule;
  status: 'ACTIVE' | 'CANCELED';
  taskId: string | null;
  selectedTaskRevision: number | null;
  deletedAt?: string;
};
export type Position = { id: string; createdAt: string };
export type LinkedTask = {
  revision: number;
  deleted: boolean;
  isMaster: boolean;
  status: string;
  occurrenceState: string | null;
};
export interface CalendarTransaction {
  event(id: string): Promise<Event>;
  events(position: Position | null, limit: number): Promise<Event[]>;
  createEvent(data: EventWrite): Promise<Event>;
  updateEvent(before: Event, data: Partial<EventWrite>): Promise<Event>;
  versions(id: string): Promise<Version[]>;
  exceptions(id: string): Promise<Event[]>;
  createVersion(
    event: Event,
    definition: RecurrenceDefinition,
    fromKey: string,
    identityTime: string,
  ): Promise<void>;
  closeVersion(version: Version, untilKey: string): Promise<void>;
  block(id: string): Promise<Block>;
  blocks(position: Position | null, limit: number): Promise<Block[]>;
  createBlock(data: BlockWrite): Promise<Block>;
  updateBlock(before: Block, data: BlockWrite): Promise<Block>;
  task(id: string): Promise<LinkedTask | null>;
  changed(kind: 'EVENT' | 'TIME_BLOCK', id: string): Promise<void>;
}
export interface CalendarPort {
  run<T>(
    scope: AuthorizedSpace,
    work: (tx: CalendarTransaction) => Promise<T>,
  ): Promise<T>;
  once<T extends Record<string, unknown>>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    request: unknown,
    work: (tx: CalendarTransaction) => Promise<T>,
  ): Promise<T>;
}
