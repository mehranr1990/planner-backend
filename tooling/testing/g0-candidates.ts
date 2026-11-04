import fs from 'node:fs';
import { createHash } from 'node:crypto';

export const g0CandidateDirectory = 'tooling/migration-candidates/g0';
/** Engineering-reviewed bytes for isolated rehearsal ONLY, not a production allowlist. */
export const g0Candidates = [
  {
    name: '01-shared-kind.sql',
    sha256: '80c62729e0d5b534194bda06b415ce817e96a4341000cac729d740b8db68b56d',
  },
  {
    name: '02-custody-kernel.sql',
    sha256: '1bc5c5053772677c75de599fe0335ff9e836199f0bf4618dfec7ce40e9fe0a7b',
  },
] as const;

export function assertG0Candidate(name: string, sql: string): void {
  const expected = g0Candidates.find((c) => c.name === name);
  if (
    !expected ||
    createHash('sha256').update(sql).digest('hex') !== expected.sha256
  )
    throw new Error('Unreviewed G0 candidate name or SQL bytes');
}
export function reviewedG0Candidates() {
  const files = fs
    .readdirSync(g0CandidateDirectory)
    .filter((n) => n.endsWith('.sql'))
    .sort();
  if (JSON.stringify(files) !== JSON.stringify(g0Candidates.map((c) => c.name)))
    throw new Error('Unexpected G0 candidate files');
  return g0Candidates.map((candidate) => {
    const sql = fs.readFileSync(
      g0CandidateDirectory + '/' + candidate.name,
      'utf8',
    );
    assertG0Candidate(candidate.name, sql);
    return { ...candidate, sql };
  });
}
