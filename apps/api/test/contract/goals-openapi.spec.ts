import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
import { assertApiCompatible } from '../../../../tooling/compatibility/openapi-compatibility.js';
describe('P1-06 contracts and prior compatibility', () => {
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
  it('documents all scoped routes, revisions, receipts and safe failures', () => {
    const routes: Record<string, string[]> = {
      '/life-areas': ['get', 'post'],
      '/life-areas/{id}': ['get', 'patch', 'delete'],
      '/goals': ['get', 'post'],
      '/goals/{id}': ['get', 'patch'],
      '/goals/{id}/progress': ['get', 'post'],
      '/goals/{id}/reviews': ['get', 'post'],
    };
    for (const child of [
      'milestones',
      'metrics',
      'links/tasks',
      'links/habits',
    ]) {
      routes['/goals/{id}/' + child] = ['get', 'post'];
      routes['/goals/{id}/' + child + '/{childId}'] = ['patch', 'delete'];
    }
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
  it('preserves P1-05 signatures and excludes later functionality', () => {
    expect(() =>
      assertApiCompatible(
        doc,
        JSON.parse(
          fs.readFileSync(
            'tooling/compatibility/p1-05-api-signatures.json',
            'utf8',
          ),
        ) as Record<string, string>,
      ),
    ).not.toThrow();
    // P1-11 is now explicitly approved; earlier signature checks remain unchanged.
    for (const approved of [
      '/rewards/achievements',
      '/insights/time',
      '/insights/overview',
      '/insights/tasks',
    ])
      expect(paths).toHaveProperty('/api/v1' + approved);
    expect(paths).toHaveProperty('/api/v1/sync/push');
    for (const path of ['/companies', '/teams'])
      expect(paths).not.toHaveProperty('/api/v1' + path);
  });
});
