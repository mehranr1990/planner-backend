import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
import { assertApiCompatible } from '../../../../tooling/compatibility/openapi-compatibility.js';
describe('P1-03 OpenAPI and prior API compatibility', () => {
  const doc = createOpenApiDocument(),
    paths = doc.paths as Record<
      string,
      Record<
        string,
        {
          security: unknown;
          parameters?: Array<{ name: string; required: boolean }>;
          responses: Record<string, unknown>;
        }
      >
    >;
  it('documents every planning, review, rollover and capacity route and required preconditions', () => {
    const expected: Record<string, string[]> = {
      '/days/{date}': ['get', 'post', 'patch'],
      '/days/{date}/items/{taskId}': ['put', 'delete'],
      '/days/{date}/items/{taskId}/move': ['post'],
      '/weeks/{date}': ['get', 'post'],
      '/reviews': ['get', 'post'],
      '/reviews/{id}': ['get', 'patch', 'delete'],
      '/rollover/preview': ['post'],
      '/rollover/commit': ['post'],
      '/capacity': ['get'],
      '/capacity/availability': ['get', 'put'],
    };
    for (const [path, methods] of Object.entries(expected)) {
      expect(Object.keys(paths['/api/v1/planning' + path]!).sort()).toEqual(
        methods.sort(),
      );
      for (const method of methods) {
        const op = paths['/api/v1/planning' + path]![method]!;
        expect(op.security).toEqual([{ sessionCookie: [] }]);
        if (method !== 'get')
          expect(op.parameters).toContainEqual(
            expect.objectContaining({ name: 'Origin', required: true }),
          );
        if (
          ['patch', 'delete', 'put'].includes(method) ||
          path.endsWith('/move')
        )
          expect(op.parameters).toContainEqual(
            expect.objectContaining({ name: 'If-Match', required: true }),
          );
        if (path === '/rollover/commit')
          expect(op.parameters).toContainEqual(
            expect.objectContaining({
              name: 'Idempotency-Key',
              required: true,
            }),
          );
        expect(op.responses).toHaveProperty('404');
        expect(op.responses).toHaveProperty('409');
      }
    }
  });
  it('retains every approved P1-02 signature and excludes later-batch features', () => {
    expect(() =>
      assertApiCompatible(
        doc,
        JSON.parse(
          fs.readFileSync(
            'tooling/compatibility/p1-02-api-signatures.json',
            'utf8',
          ),
        ) as Record<string, string>,
      ),
    ).not.toThrow();
    for (const path of ['/finance/budgets', '/reminders', '/sync/push'])
      expect(paths).not.toHaveProperty('/api/v1' + path);
  });
});
