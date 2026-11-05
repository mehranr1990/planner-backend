import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import {
  assertApiCompatible,
  assertOpenApiContract,
} from './openapi-compatibility.js';
const baseline = JSON.parse(
  fs.readFileSync('tooling/compatibility/p0-02-api-signatures.json', 'utf8'),
) as Record<string, string>;
describe('approved API compatibility', () => {
  it('resolves recursive request/result definitions and rejects dangling refs and duplicate operations', () => {
    const doc = createOpenApiDocument();
    expect(assertOpenApiContract(doc)).toEqual({
      references: 3756,
      operations: 452,
    });
    const broken = structuredClone(doc) as { paths: Record<string, unknown> };
    broken.paths['/probe'] = {
      get: {
        operationId: 'probe',
        responses: { 200: { $ref: '#/$defs/missing' } },
      },
    };
    expect(() => assertOpenApiContract(broken)).toThrow('Unresolved');
    broken.paths['/probe'] = structuredClone(Object.values(doc.paths)[0]);
    expect(() => assertOpenApiContract(broken)).toThrow('duplicate');
  });
  it('freezes all current P1-12 operations and component schemas', () => {
    for (const batch of ['p2-04', 'p2-05', 'p2-06', 'p2-07'])
      assertApiCompatible(
        createOpenApiDocument(),
        JSON.parse(
          fs.readFileSync(
            `tooling/compatibility/${batch}-api-signatures.json`,
            'utf8',
          ),
        ) as Record<string, string>,
      );
    assertApiCompatible(
      createOpenApiDocument(),
      JSON.parse(
        fs.readFileSync(
          'tooling/compatibility/p2-03-api-signatures.json',
          'utf8',
        ),
      ) as Record<string, string>,
    );
    assertApiCompatible(
      createOpenApiDocument(),
      JSON.parse(
        fs.readFileSync(
          'tooling/compatibility/p1-12-api-signatures.json',
          'utf8',
        ),
      ) as Record<string, string>,
    );
    assertApiCompatible(
      createOpenApiDocument(),
      JSON.parse(
        fs.readFileSync(
          'tooling/compatibility/p2-02-api-signatures.json',
          'utf8',
        ),
      ) as Record<string, string>,
    );
  });
  it('retains every P0-01/P0-02/P0-03 request, response, session-security and error contract', () => {
    expect(() =>
      assertApiCompatible(createOpenApiDocument(), baseline),
    ).not.toThrow();
    expect(() =>
      assertApiCompatible(
        createOpenApiDocument(),
        JSON.parse(
          fs.readFileSync(
            'tooling/compatibility/p0-03-api-signatures.json',
            'utf8',
          ),
        ) as Record<string, string>,
      ),
    ).not.toThrow();
  });
  it('blocks removed routes and changed response or permission semantics', () => {
    const original = createOpenApiDocument();
    const changed = JSON.parse(JSON.stringify(original)) as {
      paths: Record<string, Record<string, { security?: unknown }>>;
    };
    delete changed.paths['/api/v1/me'];
    expect(() => assertApiCompatible(changed, baseline)).toThrow();
    const permission = structuredClone(original);
    const me = (permission.paths as Record<string, unknown>)[
      '/api/v1/me'
    ] as Record<string, { security: unknown }>;
    me.get!.security = [];
    expect(() => assertApiCompatible(permission, baseline)).toThrow();
  });
});
