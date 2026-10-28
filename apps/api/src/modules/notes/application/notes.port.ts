import type { z } from 'zod';
import type * as c from '@mehran/api-contracts';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
export const NOTES_REPOSITORY = Symbol('NOTES_REPOSITORY');
export type PageQuery = {
  limit?: string | undefined;
  cursor?: string | undefined;
};
export type NoteWrite = Pick<
  c.Note,
  'title' | 'content' | 'state' | 'folderId' | 'taskId' | 'goalId'
>;
export interface NotesTransaction {
  folder(id: string): Promise<c.NoteFolder>;
  folders(
    q: PageQuery,
  ): Promise<{ items: c.NoteFolder[]; nextCursor: string | null }>;
  graph(): Promise<Array<{ id: string; parentId: string | null }>>;
  createFolder(input: c.NoteFolderCreate): Promise<c.NoteFolder>;
  updateFolder(
    before: c.NoteFolder,
    input: c.NoteFolderPatch,
  ): Promise<c.NoteFolder>;
  note(id: string): Promise<c.Note>;
  notes(
    q: z.infer<typeof c.NoteQuerySchema>,
  ): Promise<{ items: c.Note[]; nextCursor: string | null }>;
  history(
    id: string,
    q: PageQuery,
  ): Promise<{ items: c.Note[]; nextCursor: string | null }>;
  append(input: NoteWrite, before?: c.Note): Promise<c.Note>;
  task(id: string, allowDeleted?: boolean): Promise<void>;
  goal(id: string): Promise<void>;
  audit(
    action:
      | 'NOTE_CREATE'
      | 'NOTE_UPDATE'
      | 'NOTE_FOLDER_CREATE'
      | 'NOTE_FOLDER_UPDATE',
    id: string,
  ): Promise<void>;
}
export interface NotesPort {
  run<T>(
    scope: AuthorizedSpace,
    work: (tx: NotesTransaction) => Promise<T>,
  ): Promise<T>;
  once<T extends { id: string }>(
    scope: AuthorizedSpace,
    operation: string,
    key: string,
    input: unknown,
    work: (tx: NotesTransaction) => Promise<T>,
  ): Promise<T>;
}
