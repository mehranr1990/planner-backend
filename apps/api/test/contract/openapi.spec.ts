import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
import { authRoutes } from '@mehran/api-contracts';

describe('P0-02 API contract coverage', () => {
  it('describes all approved auth and account operations, excluding future lifecycle routes', () => {
    const document = createOpenApiDocument();
    const paths = document.paths as Record<string, Record<string, unknown>>;
    for (const key of Object.keys(authRoutes)) {
      const [method, suffix] = key.split(' ') as [string, string];
      expect(paths['/api/v1/auth' + suffix]).toHaveProperty(
        method.toLowerCase(),
      );
    }
    expect(paths['/api/v1/me']).toHaveProperty('get');
    expect(paths['/api/v1/me']).toHaveProperty('patch');
    expect(paths['/api/v1/me/settings']).toHaveProperty('patch');
    expect(paths['/api/v1/me/spaces']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/v1/me/export');
    expect(paths).not.toHaveProperty('/api/v1/auth/delete-user');
    expect(paths).toHaveProperty('/api/v1/task-recurrences');
  });
  it('describes exactly the authenticated file protocol without exposing physical storage or future business routes', () => {
    const paths = createOpenApiDocument().paths as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    for (const [path, method] of [
      ['/api/v1/files/uploads', 'post'],
      ['/api/v1/files/{id}/complete', 'post'],
      ['/api/v1/files/{id}/download', 'get'],
      ['/api/v1/files/{id}', 'delete'],
    ] as const)
      expect(paths[path]![method]!.security).toEqual([{ sessionCookie: [] }]);
    const completion = paths['/api/v1/files/{id}/complete']!.post!
      .requestBody as { content: Record<string, unknown> };
    expect(completion.content).toHaveProperty('application/octet-stream');
    expect(completion.content).toHaveProperty('application/json');
    const download = paths['/api/v1/files/{id}/download']!.get!;
    expect(download.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'signature', required: true }),
        expect.objectContaining({ name: 'expires', required: true }),
      ]),
    );
    expect(paths).not.toHaveProperty('/api/v1/files');
    expect(paths).toHaveProperty('/api/v1/task-recurrences');
  });
});
