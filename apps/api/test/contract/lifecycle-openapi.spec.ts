import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as c from '@mehran/api-contracts';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
import { assertApiCompatible } from '../../../../tooling/compatibility/openapi-compatibility.js';
describe('P1-12 lifecycle and limited sync contracts', () => {
  const paths = createOpenApiDocument().paths as Record<
    string,
    Record<
      string,
      {
        parameters?: Array<{ name: string; required?: boolean }>;
        security?: unknown[];
      }
    >
  >;
  it('publishes exactly the approved sync and lifecycle route families', () => {
    for (const path of [
      '/sync/push',
      '/sync/pull',
      '/sync/status',
      '/me/export',
      '/me/exports/{id}',
      '/me/exports/{id}/download',
      '/me/exports/{id}/attachments/{fileId}',
      '/me/deletion-request',
      '/me/deletion-request/confirm',
      '/me/deletion-request/cancel',
    ])
      expect(paths['/api/v1' + path]).toBeDefined();
    for (const path of [
      '/teams',
      '/companies',
      '/projects',
      '/sync/finance',
      '/sync/journal',
      '/sync/files',
    ])
      expect(paths['/api/v1' + path]).toBeUndefined();
  });
  it('requires private export proof, idempotency and session security at the documented boundaries', () => {
    expect(
      paths['/api/v1/me/exports/{id}/download']!.get!.parameters,
    ).toContainEqual(
      expect.objectContaining({ name: 'X-Export-Proof', required: true }),
    );
    expect(paths['/api/v1/me/export']!.post!.security).toEqual([
      { sessionCookie: [] },
    ]);
    expect(paths['/api/v1/me/export']!.post!.parameters).toContainEqual(
      expect.objectContaining({ name: 'Idempotency-Key', required: true }),
    );
    expect(
      paths['/api/v1/me/deletion-request/cancel']!.post!.parameters,
    ).toContainEqual(
      expect.objectContaining({ name: 'X-Deletion-Recovery', required: true }),
    );
  });
  it('rejects authority overposting and missing retention acknowledgement', () => {
    expect(
      c.DeletionRequestSchema.safeParse({
        password: 'test',
        accountRevision: 1,
        policyVersion: 'v1',
        retentionAcknowledged: false,
      }).success,
    ).toBe(false);
    expect(
      c.ExportRequestSchema.safeParse({
        password: 'test',
        ownerUserId: 'injected',
      }).success,
    ).toBe(false);
    expect(
      c.SyncPushSchema.safeParse({ epoch: 'bad', operations: [] }).success,
    ).toBe(false);
  });
  it('preserves every accepted P1-11 request, response, permission and error signature', () => {
    expect(() =>
      assertApiCompatible(
        createOpenApiDocument(),
        JSON.parse(
          fs.readFileSync(
            'tooling/compatibility/p1-11-api-signatures.json',
            'utf8',
          ),
        ) as Record<string, string>,
      ),
    ).not.toThrow();
  });
});
