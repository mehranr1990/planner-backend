import { expect, it } from 'vitest';
import fs from 'node:fs';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import { assertApiCompatible } from './openapi-compatibility.js';
it('freezes exact reviewed optional Client additions and keeps required/security changes blocked', () => {
  const transitions = JSON.parse(
    fs.readFileSync(
      'tooling/compatibility/client-backend-api-extensions.json',
      'utf8',
    ),
  ) as Record<string, { previous: string[]; approved: string }>;
  const baseline = Object.fromEntries(
    Object.entries(transitions).map(([key, value]) => [
      key,
      value.previous[0]!,
    ]),
  );
  const document = createOpenApiDocument() as unknown as {
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };
  expect(() => assertApiCompatible(document, baseline)).not.toThrow();
  const broken = structuredClone(document);
  const request = broken.paths['/api/v1/habits']!.post!.requestBody as {
    content: { 'application/json': { schema: { required: string[] } } };
  };
  request.content['application/json'].schema.required.push('category');
  expect(() => assertApiCompatible(broken, baseline)).toThrow(
    'contract changed',
  );
  const read = document.paths[
    '/api/v1/invitation-notifications/{kind}/{id}/read'
  ]!.post as {
    security: unknown[];
    parameters: { name: string; schema: { enum?: string[] } }[];
  };
  expect(read.security).toEqual([{ sessionCookie: [] }]);
  expect(read.parameters.find((p) => p.name === 'kind')?.schema.enum).toEqual([
    'PROJECT',
    'TEAM',
    'COMPANY',
    'CONVERSATION',
    'MEETING',
    'SOCIAL_GROUP',
  ]);
});
