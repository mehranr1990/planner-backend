import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import { apiSignatures, assertApiCompatible } from './openapi-compatibility.js';
import { companyCompletionOperations } from '../../packages/api-contracts/src/company-completion-openapi.js';

const read = (file: string) =>
  JSON.parse(
    fs.readFileSync(`tooling/compatibility/${file}`, 'utf8'),
  ) as Record<string, unknown>;

const later = {
  ...(JSON.parse(
    fs.readFileSync(
      'tooling/compatibility/backend-completion-api-extensions.json',
      'utf8',
    ),
  ) as Record<string, { previous: string; approved: string }>),
  ...(JSON.parse(
    fs.readFileSync(
      'tooling/compatibility/gap-closure-api-extensions.json',
      'utf8',
    ),
  ) as Record<string, { previous: string; approved: string }>),
};
/** Later owner-approved exact transitions (backend completion) supersede earlier pins. */
const pinned = (key: string, hash: string) =>
  later[key]?.previous === hash ? later[key].approved : hash;

it('freezes the 23 additive Company completion operations and the exact resource typeId extension', () => {
  const doc = createOpenApiDocument();
  const frozen = read('company-completion-api-signatures.json') as Record<
    string,
    string
  >;
  const extensions = read('company-completion-api-extensions.json') as Record<
    string,
    { previous: string; approved: string }
  >;
  expect(companyCompletionOperations).toHaveLength(23);
  expect(
    new Set(Object.keys(frozen).map((k) => k.split(' ').slice(0, 2).join(' ')))
      .size,
  ).toBe(23);
  expect(Object.keys(extensions).sort()).toEqual([
    'get /api/v1/companies/{id}/contexts/{scopeId}/resources response 200',
    'get /api/v1/companies/{id}/contexts/{scopeId}/resources/{resourceId} response 200',
    'patch /api/v1/companies/{id}/contexts/{scopeId}/resources/{resourceId} response 200',
    'post /api/v1/companies/{id}/contexts/{scopeId}/resources response 201',
    'post /api/v1/companies/{id}/contexts/{scopeId}/resources/{resourceId}/retire response 200',
  ]);
  expect(() => assertApiCompatible(doc, frozen)).not.toThrow();
  const current = apiSignatures(doc);
  for (const [key, hash] of Object.entries(frozen))
    expect(current[key]).toBe(pinned(key, hash));
  for (const [key, value] of Object.entries(extensions))
    expect(current[key]).toBe(value.approved);
  const changed = structuredClone(doc) as unknown as {
    paths: Record<string, { get: { security: unknown[] } }>;
  };
  changed.paths[
    '/api/v1/companies/{id}/contexts/{scopeId}/resource-requests'
  ]!.get.security = [];
  expect(() => assertApiCompatible(changed, frozen)).toThrow('compatibility');
});
