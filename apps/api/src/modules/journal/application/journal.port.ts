import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
export const JOURNAL_REPOSITORY = Symbol('JOURNAL_REPOSITORY');
export type PageQuery = {
  limit?: string | undefined;
  cursor?: string | undefined;
};
export type JournalWrite = Pick<
  c.JournalEntry,
  'title' | 'content' | 'localDate' | 'timezone' | 'kind' | 'deleted'
>;
export type MoodWrite = Pick<
  c.MoodEntry,
  | 'mood'
  | 'energy'
  | 'note'
  | 'localDate'
  | 'timezone'
  | 'journalEntryId'
  | 'state'
>;
export interface JournalTransaction {
  timezone(): Promise<string>;
  entry(id: string): Promise<c.JournalEntry>;
  entries(
    q: z.infer<typeof c.JournalQuerySchema>,
  ): Promise<{ items: c.JournalEntry[]; nextCursor: string | null }>;
  history(
    id: string,
    q: PageQuery,
  ): Promise<{ items: c.JournalEntry[]; nextCursor: string | null }>;
  append(input: JournalWrite, before?: c.JournalEntry): Promise<c.JournalEntry>;
  checkin(date: string): Promise<c.JournalEntry>;
  mood(id: string): Promise<c.MoodEntry>;
  moods(
    q: z.infer<typeof c.MoodQuerySchema>,
  ): Promise<{ items: c.MoodEntry[]; nextCursor: string | null }>;
  moodForJournal(id: string): Promise<c.MoodEntry | null>;
  moodHistory(
    id: string,
    q: PageQuery,
  ): Promise<{ items: c.MoodEntry[]; nextCursor: string | null }>;
  appendMood(input: MoodWrite, before?: c.MoodEntry): Promise<c.MoodEntry>;
  audit(
    action: 'JOURNAL_CREATE' | 'JOURNAL_UPDATE' | 'MOOD_CREATE' | 'MOOD_UPDATE',
    id: string,
  ): Promise<void>;
}
export interface JournalPort {
  run<T>(
    scope: AuthorizedSpace,
    work: (tx: JournalTransaction) => Promise<T>,
  ): Promise<T>;
  once<T extends { id: string }>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    input: unknown,
    work: (tx: JournalTransaction) => Promise<T>,
  ): Promise<T>;
}
