import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import { apiSignatures, assertApiCompatible } from './openapi-compatibility.js';
import { teamFileOperations } from '../../packages/api-contracts/src/team-files-openapi.js';

it('freezes the 13 additive TM-11 Team file library operations', () => {
  const doc = createOpenApiDocument();
  const frozen = JSON.parse(
    fs.readFileSync(
      'tooling/compatibility/team-files-api-signatures.json',
      'utf8',
    ),
  ) as Record<string, string>;
  expect(teamFileOperations).toHaveLength(13);
  expect(
    new Set(Object.keys(frozen).map((k) => k.split(' ').slice(0, 2).join(' ')))
      .size,
  ).toBe(13);
  expect(() => assertApiCompatible(doc, frozen)).not.toThrow();
  const current = apiSignatures(doc);
  for (const [key, hash] of Object.entries(frozen))
    expect(current[key]).toBe(hash);
  const changed = structuredClone(doc) as unknown as {
    paths: Record<string, { get: { security: unknown[] } }>;
  };
  changed.paths['/api/v1/teams/{id}/files']!.get.security = [];
  expect(() => assertApiCompatible(changed, frozen)).toThrow('compatibility');
});
