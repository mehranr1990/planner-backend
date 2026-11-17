import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import {
  apiSignatures,
  assertApiCompatible,
  approvedMessagesMeetingsHash,
} from './openapi-compatibility.js';
import { historicalCompanyCustodyResponses } from './company-custody-responses.js';
it('freezes eight new operations and eight exact additive pin/query transitions', () => {
  const doc = createOpenApiDocument();
  const baseline = JSON.parse(
    fs.readFileSync(
      'tooling/compatibility/messages-meetings-gap-api-signatures.json',
      'utf8',
    ),
  ) as Record<string, string>;
  assertApiCompatible(doc, baseline);
  const changes = JSON.parse(
    fs.readFileSync(
      'tooling/compatibility/messages-meetings-gap-api-extensions.json',
      'utf8',
    ),
  ) as Record<string, { previous: string[]; approved: string }>;
  expect(Object.keys(changes)).toHaveLength(8);
  const current = apiSignatures(historicalCompanyCustodyResponses(doc));
  for (const [key, value] of Object.entries(changes)) {
    expect(key).toMatch(/announcements/);
    expect(key).not.toMatch(/ security$| request$/);
    expect(current[key]).toBe(value.approved);
    for (const previous of value.previous)
      expect(approvedMessagesMeetingsHash(key, previous)).toBe(value.approved);
  }
  const broken = structuredClone(doc) as {
    paths: Record<string, Record<string, { security: unknown[] }>>;
  };
  broken.paths[
    '/api/v1/announcements/{id}/versions/{versionId}/schedule'
  ]!.post!.security = [];
  expect(() => assertApiCompatible(broken, baseline)).toThrow('compatibility');
});
