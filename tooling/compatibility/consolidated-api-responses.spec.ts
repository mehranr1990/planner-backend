import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import { apiSignatures, assertApiCompatible } from './openapi-compatibility.js';
import { historicalCompanyCustodyResponses } from './company-custody-responses.js';

const extensions = JSON.parse(
  fs.readFileSync(
    'tooling/compatibility/consolidated-api-response-extensions.json',
    'utf8',
  ),
) as Record<string, { previous: string; approved: string }>;

const later = JSON.parse(
  fs.readFileSync(
    'tooling/compatibility/backend-completion-api-extensions.json',
    'utf8',
  ),
) as Record<string, { previous: string; approved: string }>;

it('freezes every exact approved response extension and rejects any neighboring or new-field mutation', () => {
  const doc = createOpenApiDocument();
  const signatures = apiSignatures(historicalCompanyCustodyResponses(doc));
  const baseline = Object.fromEntries(
    Object.entries(extensions).map(([key, value]) => [key, value.previous]),
  );
  expect(Object.keys(extensions)).toHaveLength(85);
  expect(() => assertApiCompatible(doc, baseline)).not.toThrow();
  for (const [key, extension] of Object.entries(extensions)) {
    expect(key).toMatch(/ response (200|201)$/);
    expect(signatures[key]).toBe(
      later[key]?.previous === extension.previous
        ? later[key].approved
        : extension.approved,
    );
  }
  for (const [method, path, status] of [
    ['get', '/api/v1/teams/{id}/memberships', '200'],
    ['get', '/api/v1/conversations', '200'],
    ['post', '/api/v1/companies/{id}/contexts/{scopeId}/exports', '200'],
  ]) {
    const changed = structuredClone(doc) as unknown as {
      paths: Record<
        string,
        Record<
          string,
          {
            responses: Record<
              string,
              { content: Record<string, { schema: object }> }
            >;
          }
        >
      >;
    };
    const response = changed.paths[path!]![method!]!.responses[status!]!;
    Object.assign(response.content['application/json']!.schema, {
      additionalProperties: true,
    });
    expect(() => assertApiCompatible(changed, baseline)).toThrow(
      'compatibility',
    );
  }
});
