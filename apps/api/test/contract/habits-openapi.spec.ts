import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
import { assertApiCompatible } from '../../../../tooling/compatibility/openapi-compatibility.js';
describe('P1-05 habit/routine contracts and previous API compatibility', () => {
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
  it('documents each approved route, revisions, receipts and owner authorization', () => {
    const routes: Record<string, string[]> = {
      '/habits': ['post', 'get'],
      '/habits/{id}': ['get', 'patch', 'delete'],
      '/habits/{id}/schedules': ['get'],
      '/habits/{id}/entries': ['get', 'post'],
      '/habits/{id}/entries/{entryId}': ['get', 'patch'],
      '/habits/{id}/entries/{entryId}/history': ['get'],
      '/habits/{id}/stats': ['get'],
      '/habits/water-summary': ['get'],
      '/routines': ['get', 'post'],
      '/routines/{id}': ['get', 'patch', 'delete'],
    };
    for (const [route, methods] of Object.entries(routes)) {
      expect(Object.keys(paths['/api/v1' + route]!).sort()).toEqual(
        methods.sort(),
      );
      for (const method of methods) {
        const op = paths['/api/v1' + route]![method]!;
        expect(op.security).toEqual([{ sessionCookie: [] }]);
        expect(op.responses).toHaveProperty('404');
        expect(op.responses).toHaveProperty('409');
        if (method === 'post')
          expect(op.parameters).toContainEqual(
            expect.objectContaining({
              name: 'Idempotency-Key',
              required: true,
            }),
          );
        if (['patch', 'delete'].includes(method))
          expect(op.parameters).toContainEqual(
            expect.objectContaining({ name: 'If-Match', required: true }),
          );
      }
    }
  });
  it('retains all approved P1-04 API signatures and excludes later batches', () => {
    expect(() =>
      assertApiCompatible(
        doc,
        JSON.parse(
          fs.readFileSync(
            'tooling/compatibility/p1-04-api-signatures.json',
            'utf8',
          ),
        ) as Record<string, string>,
      ),
    ).not.toThrow();
    for (const path of [
      '/finance/transfers',
      '/finance/budgets',
      '/reminders',
      '/sync/push',
    ])
      expect(paths).not.toHaveProperty('/api/v1' + path);
  });
});
