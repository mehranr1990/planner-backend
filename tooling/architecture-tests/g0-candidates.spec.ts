import { describe, it, expect } from 'vitest';
import {
  reviewedG0Candidates,
  assertG0Candidate,
} from '../testing/g0-candidates.js';
import { assertAdditiveMigration } from '../testing/migration-safety.js';

describe('G0 isolated candidate byte review', () => {
  it('accepts only reviewed files and leaves generic migration rejection intact', () => {
    for (const candidate of reviewedG0Candidates()) {
      expect(() =>
        assertG0Candidate(candidate.name, candidate.sql),
      ).not.toThrow();
      expect(() => assertG0Candidate('renamed.sql', candidate.sql)).toThrow();
      expect(() =>
        assertG0Candidate(
          candidate.name,
          candidate.sql + '\nDROP TABLE "User";',
        ),
      ).toThrow();
      expect(() => assertAdditiveMigration(candidate.sql)).toThrow();
    }
  });
});
