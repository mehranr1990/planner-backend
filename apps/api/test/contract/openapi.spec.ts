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
    expect(paths).not.toHaveProperty('/api/v1/me/export');
    expect(paths).not.toHaveProperty('/api/v1/auth/delete-user');
    expect(paths).not.toHaveProperty('/api/v1/tasks');
  });
});
