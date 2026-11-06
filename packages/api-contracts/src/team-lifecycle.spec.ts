import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  TeamLifecycleChangeSchema,
  TeamLifecycleRecoverSchema,
  TeamLifecycleProofSchema,
  TeamLifecyclePasswordSchema,
} from './team-lifecycle.js';
it('accepts only bounded password/generation recovery inputs and rejects authority or Company fields', () => {
  expect(
    TeamLifecycleRecoverSchema.parse({ password: 'synthetic', generation: 1 })
      .generation,
  ).toBe(1);
  for (const input of [
    { password: 'synthetic', generation: 0 },
    { password: 'synthetic', generation: 1, companyId: randomUUID() },
    {
      password: 'synthetic',
      generation: 1,
      proof: 'body is not a proof header',
    },
    { password: '', generation: 1 },
  ])
    expect(TeamLifecycleRecoverSchema.safeParse(input).success).toBe(false);
  expect(
    TeamLifecyclePasswordSchema.safeParse({ password: 'x'.repeat(1025) })
      .success,
  ).toBe(false);
});
it('keeps lifecycle changes free of source payloads and recovery proofs at exactly 256 bits', () => {
  const change = { id: randomUUID(), teamId: randomUUID(), revision: 1 };
  expect(TeamLifecycleChangeSchema.safeParse(change).success).toBe(true);
  expect(
    TeamLifecycleChangeSchema.safeParse({ ...change, evidence: 'private' })
      .success,
  ).toBe(false);
  const proof = {
    jobId: randomUUID(),
    generation: 1,
    revision: 1,
    recoveryDeadline: '2030-01-01T00:00:00.000Z',
    proof: 'a'.repeat(43),
  };
  expect(TeamLifecycleProofSchema.safeParse(proof).success).toBe(true);
  expect(
    TeamLifecycleProofSchema.safeParse({ ...proof, proof: 'a'.repeat(44) })
      .success,
  ).toBe(false);
});
