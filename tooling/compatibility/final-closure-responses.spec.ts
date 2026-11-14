import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import { apiSignatures, assertApiCompatible } from './openapi-compatibility.js';
import { historicalCompanyCustodyResponses } from './company-custody-responses.js';
import { finalClosureOperations } from '../../packages/api-contracts/src/final-closure-openapi.js';

it('freezes the 5 final-closure operations', () => {
  const doc = createOpenApiDocument();
  const frozen = JSON.parse(
    fs.readFileSync(
      'tooling/compatibility/final-closure-api-signatures.json',
      'utf8',
    ),
  ) as Record<string, string>;
  expect(finalClosureOperations).toHaveLength(5);
  expect(
    new Set(Object.keys(frozen).map((k) => k.split(' ').slice(0, 2).join(' ')))
      .size,
  ).toBe(5);
  expect(() => assertApiCompatible(doc, frozen)).not.toThrow();
  const current = apiSignatures(historicalCompanyCustodyResponses(doc));
  for (const [key, hash] of Object.entries(frozen))
    expect(current[key]).toBe(hash);
});
