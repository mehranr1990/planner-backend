import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
import { assertApiCompatible } from '../../../../tooling/compatibility/openapi-compatibility.js';
describe('P1-08 writing/search/voice contracts and previous API compatibility', () => {
  const doc = createOpenApiDocument(),
    paths = doc.paths as Record<
      string,
      Record<
        string,
        {
          security: unknown;
          parameters?: Array<{ name: string; required: boolean }>;
          responses: Record<string, unknown>;
          requestBody?: { content: Record<string, unknown> };
        }
      >
    >;
  it('documents every scoped route with revisions/receipts and explicit private search', () => {
    const routes: Record<string, string[]> = {
      '/notes': ['get', 'post'],
      '/notes/{id}': ['get', 'patch', 'delete'],
      '/notes/{id}/history': ['get'],
      '/notes/folders': ['get', 'post'],
      '/notes/folders/{id}': ['get', 'patch', 'delete'],
      '/journal/entries': ['get', 'post'],
      '/journal/entries/{id}': ['get', 'patch', 'delete'],
      '/journal/entries/{id}/history': ['get'],
      '/journal/daily-checkins': ['get', 'post'],
      '/journal/daily-checkins/{date}': ['get'],
      '/moods': ['get', 'post'],
      '/moods/{id}': ['get', 'patch', 'delete'],
      '/moods/{id}/history': ['get'],
      '/capture': ['get', 'post'],
      '/capture/{id}': ['get', 'patch'],
      '/capture/{id}/triage': ['post'],
      '/capture/parse': ['post'],
      '/search/personal': ['get'],
      '/files/voice/uploads': ['post'],
      '/files/voice/{id}/complete': ['post'],
      '/files/voice/{id}/download': ['get'],
      '/files/voice/{id}': ['delete'],
    };
    for (const [path, methods] of Object.entries(routes)) {
      expect(Object.keys(paths['/api/v1' + path]!).sort()).toEqual(
        methods.sort(),
      );
      for (const method of methods) {
        const op = paths['/api/v1' + path]![method]!;
        expect(op.security).toEqual([{ sessionCookie: [] }]);
        expect(op.responses).toHaveProperty('404');
        if (['patch', 'delete'].includes(method) && !path.startsWith('/files/'))
          expect(op.parameters).toContainEqual(
            expect.objectContaining({ name: 'If-Match', required: true }),
          );
        if (
          method === 'post' &&
          !['/capture/parse', '/files/voice/{id}/complete'].includes(path)
        )
          expect(op.parameters).toContainEqual(
            expect.objectContaining({
              name: 'Idempotency-Key',
              required: true,
            }),
          );
      }
    }
    expect(
      paths['/api/v1/files/voice/{id}/complete']!.post!.requestBody!.content,
    ).toHaveProperty('application/octet-stream');
    expect(paths['/api/v1/search/personal']!.get!.parameters).toContainEqual(
      expect.objectContaining({ name: 'includeJournal', required: false }),
    );
  });
  it('retains every P1-07 signature and excludes unapproved future features', () => {
    expect(() =>
      assertApiCompatible(
        doc,
        JSON.parse(
          fs.readFileSync(
            'tooling/compatibility/p1-07-api-signatures.json',
            'utf8',
          ),
        ) as Record<string, string>,
      ),
    ).not.toThrow();
    // P1-11 is now explicitly approved; earlier signature checks remain unchanged.
    for (const approved of [
      '/insights/overview',
      '/rewards/progress',
      '/insights/tasks',
    ])
      expect(paths).toHaveProperty('/api/v1' + approved);
    expect(paths).toHaveProperty('/api/v1/sync/push');
    for (const path of ['/teams', '/companies'])
      expect(paths).not.toHaveProperty('/api/v1' + path);
  });
});
