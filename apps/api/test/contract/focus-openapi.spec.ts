import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
import { assertApiCompatible } from '../../../../tooling/compatibility/openapi-compatibility.js';
describe('P1-07 route contracts and previous compatibility', () => {
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
  it('documents every Focus/Time/productivity route and mutation safeguards', () => {
    const routes: Record<string, string[]> = {
      '/focus/sessions': ['get', 'post'],
      '/focus/sessions/{id}': ['get', 'patch'],
      '/focus/sessions/{id}/history': ['get'],
      '/time-entries': ['get', 'post'],
      '/time-entries/{id}': ['get', 'patch', 'delete'],
      '/time-entries/{id}/history': ['get'],
      '/tasks/{id}/productivity': ['get', 'patch'],
      '/productivity/summary': ['get'],
    };
    for (const action of ['start', 'pause', 'resume', 'finish', 'stop'])
      routes['/focus/sessions/{id}/' + action] = ['post'];
    for (const [path, methods] of Object.entries(routes)) {
      expect(Object.keys(paths['/api/v1' + path]!).sort()).toEqual(
        methods.sort(),
      );
      for (const method of methods) {
        const op = paths['/api/v1' + path]![method]!;
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
        if (
          ['patch', 'delete'].includes(method) ||
          (method === 'post' && path.includes('{id}'))
        )
          expect(op.parameters).toContainEqual(
            expect.objectContaining({ name: 'If-Match', required: true }),
          );
      }
    }
  });
  it('retains all P1-06 signatures and excludes future batches', () => {
    expect(() =>
      assertApiCompatible(
        doc,
        JSON.parse(
          fs.readFileSync(
            'tooling/compatibility/p1-06-api-signatures.json',
            'utf8',
          ),
        ) as Record<string, string>,
      ),
    ).not.toThrow();
    for (const path of [
      '/rewards/achievements',
      '/insights/time',
      '/insights/overview',
      '/insights/tasks',
      '/sync/push',
      '/teams',
      '/companies',
    ])
      expect(paths).not.toHaveProperty('/api/v1' + path);
  });
});
