import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import { apiSignatures, assertApiCompatible } from './openapi-compatibility.js';
import { historicalCompanyCustodyResponses } from './company-custody-responses.js';
import { gapClosureOperations } from '../../packages/api-contracts/src/gap-closure-openapi.js';

const read = (file: string) =>
  JSON.parse(
    fs.readFileSync(`tooling/compatibility/${file}`, 'utf8'),
  ) as Record<string, unknown>;

it('freezes the 67 gap-closure operations and only the approved KPI goals transition', () => {
  const doc = createOpenApiDocument();
  const frozen = read('gap-closure-api-signatures.json') as Record<
    string,
    string
  >;
  const extensions = read('gap-closure-api-extensions.json') as Record<
    string,
    { previous: string; approved: string }
  >;
  expect(gapClosureOperations).toHaveLength(67);
  expect(
    new Set(Object.keys(frozen).map((k) => k.split(' ').slice(0, 2).join(' ')))
      .size,
  ).toBe(67);
  expect(Object.keys(extensions)).toEqual([
    'get /api/v1/companies/{id}/contexts/{scopeId}/reports/kpis response 200',
  ]);
  expect(() => assertApiCompatible(doc, frozen)).not.toThrow();
  const current = apiSignatures(historicalCompanyCustodyResponses(doc));
  // The final closure (2026-11-14) approved exactly these later transitions of frozen keys.
  const later = read('final-closure-api-extensions.json') as Record<
    string,
    { previous: string; approved: string }
  >;
  expect(Object.keys(later).sort()).toEqual([
    'get /api/v1/companies/{id}/contexts/{scopeId}/rooms response 200',
    'get /api/v1/insights/patterns response 200',
    'put /api/v1/companies/{id}/contexts/{scopeId}/resources/{resourceId}/room response 200',
  ]);
  for (const [key, hash] of Object.entries(frozen))
    if (later[key]) {
      expect(later[key].previous).toBe(hash);
      expect(current[key]).toBe(later[key].approved);
    } else expect(current[key]).toBe(hash);
  for (const [key, value] of Object.entries(extensions))
    expect(current[key]).toBe(value.approved);
  const changed = structuredClone(doc) as unknown as {
    paths: Record<string, { get: { security: unknown[] } }>;
  };
  changed.paths['/api/v1/messaging/search']!.get.security = [];
  expect(() => assertApiCompatible(changed, frozen)).toThrow('compatibility');
});
