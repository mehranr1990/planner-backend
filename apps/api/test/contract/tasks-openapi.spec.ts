import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
import fs from 'node:fs';
import { assertApiCompatible } from '../../../../tooling/compatibility/openapi-compatibility.js';

describe('P1-01 API coverage and Phase 0 compatibility', () => {
  const paths = createOpenApiDocument().paths as Record<
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
  it('documents all Task, checklist, label, subtree, recovery, attachment and history operations', () => {
    const expected: Record<string, string[]> = {
      '/tasks': ['get', 'post'],
      '/tasks/{id}': ['get', 'patch', 'delete'],
      '/tasks/{id}/complete': ['post'],
      '/tasks/{id}/reopen': ['post'],
      '/tasks/{id}/restore': ['post'],
      '/tasks/{id}/subtasks': ['get', 'post'],
      '/tasks/{id}/checklist-items': ['get', 'post'],
      '/tasks/{id}/checklist-items/{itemId}': ['patch', 'delete'],
      '/tasks/{id}/labels': ['get'],
      '/tasks/{id}/labels/{labelId}': ['put', 'delete'],
      '/tasks/{id}/attachments': ['get'],
      '/tasks/{id}/attachments/{fileId}': ['put', 'delete'],
      '/tasks/{id}/history': ['get'],
      '/labels': ['get', 'post'],
      '/labels/{id}': ['get', 'patch', 'delete'],
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
        const creates =
          method === 'post' &&
          (path === '/tasks' ||
            path === '/labels' ||
            path.endsWith('/subtasks'));
        if (method !== 'get' && !creates)
          expect(operation.parameters).toContainEqual(
            expect.objectContaining({ name: 'If-Match', required: true }),
          );
        expect(operation.responses).toHaveProperty('404');
        expect(operation.responses).toHaveProperty('409');
      }
    }
  });
  it('retains every approved Phase 0 file/auth/error contract and excludes later batches', () => {
    expect(() =>
      assertApiCompatible(
        createOpenApiDocument(),
        JSON.parse(
          fs.readFileSync(
            'tooling/compatibility/p0-04-api-signatures.json',
            'utf8',
          ),
        ) as Record<string, string>,
      ),
    ).not.toThrow();
    for (const path of ['/calendar', '/focus/sessions'])
      expect(paths).not.toHaveProperty('/api/v1' + path);
  });
});
