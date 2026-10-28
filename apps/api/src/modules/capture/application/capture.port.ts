import type * as c from '@mehran/api-contracts';
import type { z } from 'zod';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
export const CAPTURE_REPOSITORY = Symbol('CAPTURE_REPOSITORY');
export type CaptureWrite = Pick<
  c.Capture,
  | 'type'
  | 'text'
  | 'voiceFileId'
  | 'state'
  | 'targetTaskId'
  | 'targetNoteId'
  | 'targetJournalId'
  | 'targetHabitEntryId'
> & { targetHabitId: string | null };
export interface CaptureTransaction {
  timezone(): Promise<string>;
  capture(id: string): Promise<c.Capture>;
  captures(
    q: z.infer<typeof c.CaptureQuerySchema>,
  ): Promise<{ items: c.Capture[]; nextCursor: string | null }>;
  create(input: c.CaptureCreate): Promise<c.Capture>;
  update(before: c.Capture, input: CaptureWrite): Promise<c.Capture>;
  voice(id: string): Promise<void>;
  createTask(
    input: Extract<c.CaptureTriage, { action: 'CREATE_TASK' }>['task'],
  ): Promise<{ id: string; revision: number }>;
  createNote(input: c.NoteCreate): Promise<{ id: string; revision: number }>;
  createJournal(
    input: c.JournalCreate,
  ): Promise<{ id: string; revision: number }>;
  recordHabit(
    id: string,
    input: Extract<c.CaptureTriage, { action: 'RECORD_HABIT' }>['entry'],
  ): Promise<{ id: string; habitId: string; revision: number }>;
  search(
    kind: c.PersonalSearchHit['kind'],
    r: c.SearchRequest,
  ): Promise<c.PersonalSearchHit[]>;
  audit(
    action: 'CAPTURE_CREATE' | 'CAPTURE_UPDATE' | 'CAPTURE_TRIAGE',
    id: string,
  ): Promise<void>;
  event(id: string): Promise<void>;
}
export interface CapturePort {
  run<T>(
    scope: AuthorizedSpace,
    work: (tx: CaptureTransaction) => Promise<T>,
  ): Promise<T>;
  once<T extends { id: string }>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    input: unknown,
    work: (tx: CaptureTransaction) => Promise<T>,
  ): Promise<T>;
}
