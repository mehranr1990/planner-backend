import { describe, it, expect } from 'vitest';
import { createOpenApiDocument } from '../../../../packages/api-contracts/src/openapi.js';
type Op = {
  security: unknown;
  parameters?: Array<{ name: string; required?: boolean; in: string }>;
  responses: Record<string, unknown>;
};
describe('P1-11 authorized analytics and reward contracts', () => {
  const paths = createOpenApiDocument().paths as Record<
    string,
    Record<string, Op>
  >;
  it('documents all approved source families and optional reward operations with session security', () => {
    for (const family of [
      'overview',
      'tasks',
      'habits',
      'goals',
      'time',
      'finance',
    ]) {
      const op = paths['/api/v1/insights/' + family]!.get!;
      expect(op.security).toEqual([{ sessionCookie: [] }]);
      for (const name of ['from', 'to'])
        expect(op.parameters).toContainEqual(
          expect.objectContaining({ name, in: 'query', required: true }),
        );
      for (const code of ['200', '400', '401', '403', '404'])
        expect(op.responses).toHaveProperty(code);
    }
    for (const name of ['achievements', 'progress', 'preferences'])
      expect(paths['/api/v1/rewards/' + name]!.get!.security).toEqual([
        { sessionCookie: [] },
      ]);
  });
  it('requires strong revisions, origin and idempotency for preference/recalculation changes', () => {
    for (const [path, method] of [
      ['preferences', 'patch'],
      ['achievements/recalculate', 'post'],
    ]) {
      const op = paths['/api/v1/rewards/' + path]![method!]!;
      expect(op.security).toEqual([{ sessionCookie: [] }]);
      for (const name of ['If-Match', 'Idempotency-Key', 'Origin'])
        expect(op.parameters).toContainEqual(
          expect.objectContaining({ name, in: 'header', required: true }),
        );
      expect(op.responses).toHaveProperty('409');
    }
  });
  it('continues to exclude lifecycle/sync and company/team modules', () => {
    for (const path of [
      '/sync/push',
      '/sync/pull',
      '/me/export',
      '/me/deletion-request',
      '/teams',
      '/companies',
    ])
      expect(paths).not.toHaveProperty('/api/v1' + path);
  });
});
