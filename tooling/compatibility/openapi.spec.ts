import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import { assertApiCompatible } from './openapi-compatibility.js';
const baseline = JSON.parse(
  fs.readFileSync('tooling/compatibility/p0-02-api-signatures.json', 'utf8'),
) as Record<string, string>;
describe('approved API compatibility', () => {
  it('retains every P0-01/P0-02 request, response, session-security and error contract', () => {
    expect(() =>
      assertApiCompatible(createOpenApiDocument(), baseline),
    ).not.toThrow();
  });
  it('blocks removed routes and changed response or permission semantics', () => {
    const original = createOpenApiDocument();
    const changed = JSON.parse(JSON.stringify(original)) as {
      paths: Record<string, Record<string, { security?: unknown }>>;
    };
    delete changed.paths['/api/v1/me'];
    expect(() => assertApiCompatible(changed, baseline)).toThrow();
    const permission = structuredClone(original);
    const me = (permission.paths as Record<string, unknown>)[
      '/api/v1/me'
    ] as Record<string, { security: unknown }>;
    me.get!.security = [];
    expect(() => assertApiCompatible(permission, baseline)).toThrow();
  });
});
