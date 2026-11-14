import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import { apiSignatures, assertApiCompatible } from './openapi-compatibility.js';
import { historicalCompanyCustodyResponses } from './company-custody-responses.js';

it('freezes Social name extensions while preserving every old request, security and neighboring response field', () => {
  const doc = createOpenApiDocument();
  const baseline = JSON.parse(
    fs.readFileSync(
      'tooling/compatibility/p6-01-social-api-signatures.json',
      'utf8',
    ),
  ) as Record<string, string>;
  const extensions = JSON.parse(
    fs.readFileSync(
      'tooling/compatibility/social-integration-api-response-extensions.json',
      'utf8',
    ),
  ) as Record<string, { previous: string; approved: string }>;
  expect(Object.keys(extensions)).toHaveLength(9);
  const signatures = apiSignatures(historicalCompanyCustodyResponses(doc));
  for (const [key, change] of Object.entries(extensions)) {
    expect(signatures[key]).toBe(change.approved);
    expect(baseline[key]).toBe(change.previous);
  }
  expect(() => assertApiCompatible(doc, baseline)).not.toThrow();
  for (const [path, mutation] of [
    ['/api/v1/social/connections', 'response'],
    ['/api/v1/social-groups/{id}/memberships', 'response'],
    ['/api/v1/social-groups/{id}/join-requests', 'response'],
    ['/api/v1/social/connections', 'security'],
  ]) {
    const changed = structuredClone(doc) as unknown as {
      paths: Record<
        string,
        {
          get: {
            security: unknown[];
            responses: Record<
              string,
              { content: Record<string, { schema: object }> }
            >;
          };
        }
      >;
    };
    const get = changed.paths[path!]!.get;
    if (mutation === 'security') get.security = [];
    else
      Object.assign(get.responses['200']!.content['application/json']!.schema, {
        additionalProperties: true,
      });
    expect(() => assertApiCompatible(changed, baseline)).toThrow(
      'compatibility',
    );
  }
});
