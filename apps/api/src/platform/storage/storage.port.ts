import type { Readable } from 'node:stream';

export const STORAGE_PORT = Symbol('STORAGE_PORT');
export type FileExpectation = {
  size: number;
  mimeType: string;
  sha256?: string | null;
};
export type FileEvidence = { size: number; sha256: string };
export class StorageFailure extends Error {
  constructor(readonly code: 'INVALID' | 'LIMIT' | 'UNAVAILABLE') {
    super('Private storage operation failed');
  }
}
export interface StoragePort {
  inventory?(): Promise<Array<{ key: string; attempt: string | null }>>;
  write(
    key: string,
    attempt: string,
    source: Readable,
    expected: FileExpectation,
    signal: AbortSignal,
  ): Promise<FileEvidence>;
  open(key: string, expected: FileEvidence): Promise<Readable>;
  remove(key: string, attempt?: string | null): Promise<void>;
}
