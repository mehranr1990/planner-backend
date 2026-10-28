import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
import { assertApiCompatible } from '../../../../tooling/compatibility/openapi-compatibility.js';
describe('P1-09 approved API and compatibility', () => {
  const doc = createOpenApiDocument(),
    paths = doc.paths as Record<
      string,
      Record<
        string,
        {
          parameters?: Array<{ in: string; name: string; required?: boolean }>;
          security?: unknown;
          responses?: Record<string, { content?: Record<string, unknown> }>;
        }
      >
    >;
  it('includes each approved Finance route family with verified sessions', () => {
    for (const p of [
      'accounts',
      'categories',
      'transactions',
      'transfers',
      'budgets',
      'bills',
      'savings-goals',
      'reports',
      'export',
    ]) {
      const ops = paths['/api/v1/finance/' + p];
      expect(ops).toBeDefined();
      for (const op of Object.values(ops!))
        expect(op.security).toEqual([{ sessionCookie: [] }]);
    }
  });
  it('requires revision/receipt protection on critical mutations and documents private CSV', () => {
    for (const p of [
      '/transactions/{id}/reverse',
      '/transactions/{id}/correct',
      '/bills/{id}/pay',
    ]) {
      const params = paths['/api/v1/finance' + p]!.post!.parameters;
      for (const name of ['If-Match', 'Idempotency-Key'])
        expect(params).toContainEqual(
          expect.objectContaining({ in: 'header', name, required: true }),
        );
    }
    expect(
      paths['/api/v1/finance/transactions/from-capture']!.post!.parameters,
    ).toContainEqual(
      expect.objectContaining({
        in: 'header',
        name: 'Idempotency-Key',
        required: true,
      }),
    );
    expect(
      paths['/api/v1/finance/export']!.get!.responses!['200']!.content,
    ).toHaveProperty('text/csv');
  });
  it('preserves all P1-08 contracts and rejects future modules', () => {
    expect(() =>
      assertApiCompatible(
        doc,
        JSON.parse(
          fs.readFileSync(
            'tooling/compatibility/p1-08-api-signatures.json',
            'utf8',
          ),
        ) as Record<string, string>,
      ),
    ).not.toThrow();
    for (const p of [
      '/reminders',
      '/notifications/preferences',
      '/insights/finance',
      '/sync/push',
    ])
      expect(paths).not.toHaveProperty('/api/v1' + p);
  });
});
