import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import { apiSignatures, assertApiCompatible } from './openapi-compatibility.js';
import { teamCompletionOperations } from '../../packages/api-contracts/src/team-completion-openapi.js';

const later = JSON.parse(
  fs.readFileSync(
    'tooling/compatibility/backend-completion-api-extensions.json',
    'utf8',
  ),
) as Record<string, { previous: string; approved: string }>;
/** Later owner-approved exact transitions (backend completion) supersede earlier pins. */
const pinned = (key: string, hash: string) =>
  later[key]?.previous === hash ? later[key].approved : hash;

it('freezes the 23 additive Team completion operations without changing any earlier operation', () => {
  const doc = createOpenApiDocument();
  const frozen = JSON.parse(
    fs.readFileSync(
      'tooling/compatibility/team-completion-api-signatures.json',
      'utf8',
    ),
  ) as Record<string, string>;
  expect(teamCompletionOperations).toHaveLength(23);
  const operations = new Set(
    Object.keys(frozen).map((k) => k.split(' ').slice(0, 2).join(' ')),
  );
  expect(operations.size).toBe(23);
  expect(() => assertApiCompatible(doc, frozen)).not.toThrow();
  const current = apiSignatures(doc);
  for (const [key, hash] of Object.entries(frozen))
    expect(current[key]).toBe(pinned(key, hash));
  const changed = structuredClone(doc) as unknown as {
    paths: Record<string, { get: { security: unknown[] } }>;
  };
  changed.paths['/api/v1/teams/{id}/feedback']!.get.security = [];
  expect(() => assertApiCompatible(changed, frozen)).toThrow('compatibility');
});
