import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
import { assertApiCompatible } from '../../../../tooling/compatibility/openapi-compatibility.js';
describe('P1-02 OpenAPI and prior-contract preservation', () => {
  const document = createOpenApiDocument(),
    paths = document.paths as Record<
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
  it('documents every approved route with session/origin/revision/key requirements', () => {
    const expected: Record<string, string[]> = {
      '/task-recurrences': ['get', 'post'],
      '/task-recurrences/{id}': ['get', 'patch', 'delete'],
      '/task-recurrences/{id}/catch-up': ['post'],
      '/task-recurrences/{id}/occurrences': ['get'],
      '/task-occurrences/{id}': ['get'],
      '/task-occurrences/{id}/complete': ['post'],
      '/task-occurrences/{id}/skip': ['post'],
      '/task-occurrences/{id}/cancel': ['post'],
      '/task-templates': ['get', 'post'],
      '/task-templates/{id}': ['get', 'patch', 'delete'],
      '/task-templates/{id}/apply': ['post'],
      '/saved-task-filters': ['get', 'post'],
      '/saved-task-filters/{id}': ['get', 'patch', 'delete'],
      '/saved-task-filters/{id}/tasks': ['get'],
      '/tasks/bulk': ['post'],
    };
    for (const [path, methods] of Object.entries(expected)) {
      expect(Object.keys(paths['/api/v1' + path]!).sort()).toEqual(
        methods.sort(),
      );
      for (const method of methods) {
        const operation = paths['/api/v1' + path]![method]!;
        expect(operation.security).toEqual([{ sessionCookie: [] }]);
        if (method !== 'get')
          expect(operation.parameters).toContainEqual(
            expect.objectContaining({ name: 'Origin', required: true }),
          );
        if (
          method === 'patch' ||
          method === 'delete' ||
          (path.startsWith('/task-occurrences/') && method === 'post')
        )
          expect(operation.parameters).toContainEqual(
            expect.objectContaining({ name: 'If-Match', required: true }),
          );
        if (path.endsWith('/apply') || path === '/tasks/bulk')
          expect(operation.parameters).toContainEqual(
            expect.objectContaining({
              name: 'Idempotency-Key',
              required: true,
            }),
          );
        expect(operation.responses).toHaveProperty('404');
        expect(operation.responses).toHaveProperty('409');
      }
    }
  });
  it('preserves every approved P1-01 response, request and parameter signature', () => {
    expect(() =>
      assertApiCompatible(
        document,
        JSON.parse(
          fs.readFileSync(
            'tooling/compatibility/p1-01-api-signatures.json',
            'utf8',
          ),
        ) as Record<string, string>,
      ),
    ).not.toThrow();
    for (const path of [
      '/planning',
      '/calendar',
      '/goals',
      '/reminders',
      '/sync',
    ])
      expect(paths).not.toHaveProperty('/api/v1' + path);
  });
});
