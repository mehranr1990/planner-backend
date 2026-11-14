import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import { apiSignatures, assertApiCompatible } from './openapi-compatibility.js';
import { historicalCompanyCustodyResponses } from './company-custody-responses.js';
import { backendCompletionOperations } from '../../packages/api-contracts/src/backend-completion-openapi.js';

const read = (file: string) =>
  JSON.parse(
    fs.readFileSync(`tooling/compatibility/${file}`, 'utf8'),
  ) as Record<string, unknown>;

it('freezes the 50 backend completion operations and only the 18 exact approved transitions', () => {
  const doc = createOpenApiDocument();
  const frozen = read('backend-completion-api-signatures.json') as Record<
    string,
    string
  >;
  const extensions = read('backend-completion-api-extensions.json') as Record<
    string,
    { previous: string; approved: string }
  >;
  expect(backendCompletionOperations).toHaveLength(50);
  expect(
    new Set(Object.keys(frozen).map((k) => k.split(' ').slice(0, 2).join(' ')))
      .size,
  ).toBe(50);
  expect(Object.keys(extensions)).toHaveLength(18);
  expect(() => assertApiCompatible(doc, frozen)).not.toThrow();
  const current = apiSignatures(historicalCompanyCustodyResponses(doc));
  for (const [key, hash] of Object.entries(frozen))
    expect(current[key]).toBe(hash);
  for (const [key, value] of Object.entries(extensions))
    expect(current[key]).toBe(value.approved);
  const changed = structuredClone(doc) as unknown as {
    paths: Record<string, { get: { security: unknown[] } }>;
  };
  changed.paths['/api/v1/teams/{id}/my-work']!.get.security = [];
  expect(() => assertApiCompatible(changed, frozen)).toThrow('compatibility');
});
