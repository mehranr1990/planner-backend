import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import { companyGapOperations } from '../../packages/api-contracts/src/company-gap-closure-openapi.js';
import {
  apiSignatures,
  assertApiCompatible,
  approvedCompanyHash,
} from './openapi-compatibility.js';
import { historicalCompanyCustodyResponses } from './company-custody-responses.js';
it('freezes Company routes and only the exact approved financial-kind, source and notice extensions', () => {
  const doc = createOpenApiDocument(),
    baseline = JSON.parse(
      fs.readFileSync(
        'tooling/compatibility/company-gap-api-signatures.json',
        'utf8',
      ),
    ) as Record<string, string>;
  expect(companyGapOperations).toHaveLength(68);
  for (const op of companyGapOperations)
    expect(
      (doc.paths as Record<string, Record<string, unknown>>)[
        '/api/v1' + op.path
      ]?.[op.method],
    ).toBeDefined();
  assertApiCompatible(doc, baseline);
  const signatures = apiSignatures(historicalCompanyCustodyResponses(doc)),
    changes = JSON.parse(
      fs.readFileSync(
        'tooling/compatibility/company-gap-api-extensions.json',
        'utf8',
      ),
    ) as Record<string, { previous: string[]; approved: string }>;
  for (const [key, value] of Object.entries(changes)) {
    expect(key).not.toMatch(/ security$| parameters$/);
    expect(signatures[key]).toBe(value.approved);
    for (const previous of value.previous)
      expect(approvedCompanyHash(key, previous)).toBe(value.approved);
  }
  const broken = structuredClone(doc) as unknown as {
    paths: Record<string, Record<string, { security: unknown[] }>>;
  };
  broken.paths['/api/v1/companies/{id}/organization-chart']!.get!.security = [];
  expect(() => assertApiCompatible(broken, baseline)).toThrow('compatibility');
});
