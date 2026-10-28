import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
import { assertApiCompatible } from '../../../../tooling/compatibility/openapi-compatibility.js';
describe('P1-04 calendar OpenAPI and P1-03 compatibility', () => {
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
  it('publishes every scoped calendar route with revisions and safe failures', () => {
    for (const [path, methods] of Object.entries({
      '/events': ['post', 'get'],
      '/events/{id}': ['get', 'patch', 'delete'],
      '/events/{id}/series': ['post'],
      '/time-blocks': ['post', 'get'],
      '/time-blocks/{id}': ['get', 'patch', 'delete'],
      '/views': ['get'],
      '/conflicts': ['get'],
    })) {
      expect(Object.keys(paths['/api/v1/calendar' + path]!).sort()).toEqual(
        methods.sort(),
      );
      for (const method of methods) {
        const op = paths['/api/v1/calendar' + path]![method]!;
        expect(op.security).toEqual([{ sessionCookie: [] }]);
        expect(op.responses).toHaveProperty('404');
        expect(op.responses).toHaveProperty('409');
        if (['patch', 'delete'].includes(method) || path.endsWith('/series'))
          expect(op.parameters).toContainEqual(
            expect.objectContaining({ name: 'If-Match', required: true }),
          );
        if (method === 'post' && !path.endsWith('/series'))
          expect(op.parameters).toContainEqual(
            expect.objectContaining({
              name: 'Idempotency-Key',
              required: true,
            }),
          );
      }
    }
  });
  it('retains every approved P1-03 API and excludes later batches', () => {
    expect(() =>
      assertApiCompatible(
        doc,
        JSON.parse(
          fs.readFileSync(
            'tooling/compatibility/p1-03-api-signatures.json',
            'utf8',
          ),
        ) as Record<string, string>,
      ),
    ).not.toThrow();
    for (const path of ['/finance/transfers', '/reminders', '/sync/push'])
      expect(paths).not.toHaveProperty('/api/v1' + path);
  });
});
