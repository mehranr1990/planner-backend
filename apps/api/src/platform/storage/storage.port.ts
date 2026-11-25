import type { Readable } from 'node:stream';

export const STORAGE_PORT = Symbol('STORAGE_PORT');
export type FileExpectation = {
  size: number;
  mimeType: string;
  sha256?: string | null;
  maxDurationMs?: number;
  maxBytes?: number;
};
export type FileEvidence = {
  size: number;
  sha256: string;
  durationMs?: number;
  /** Present only when the exact written bytes received a CLEAN scan. */
  scan?: { engine: string };
};
/** ADR 0068: `verified` means a persisted CLEAN verdict for exactly `sha256`.
 * Stored bytes are always re-hashed; unverified bytes are scanned first. */
export type ReadExpectation = FileEvidence & {
  verified?: boolean;
  onVerified?: (engine: string) => Promise<void>;
};
export class StorageFailure extends Error {
  constructor(readonly code: 'INVALID' | 'LIMIT' | 'UNAVAILABLE') {
    super('Private storage operation failed');
  }
}
export interface StoragePort {
  capacity?(): Promise<{ totalBytes: bigint; freeBytes: bigint }>;
  inventory?(): Promise<
    Array<{
      key: string;
      attempt: string | null;
      size?: number;
      modifiedAt?: string;
    }>
  >;
  removeOrphan?(
    key: string,
    attempt: string | null,
    expected: { size: number; modifiedAt: string },
  ): Promise<void>;
  write(
    key: string,
    attempt: string,
    source: Readable,
    expected: FileExpectation,
    signal: AbortSignal,
  ): Promise<FileEvidence>;
  open(key: string, expected: ReadExpectation): Promise<Readable>;
  remove(key: string, attempt?: string | null): Promise<void>;
}
