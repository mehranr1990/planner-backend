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
      references: 6236,
      operations: 700,
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
    // Each repeated key must agree across every historical baseline. Compare the
    // complete union once, avoiding eleven regenerations/hashes of the same API.
    const combined: Record<string, string> = {};
    Object.assign(
      combined,
      JSON.parse(
        fs.readFileSync(
          'tooling/compatibility/p4-06-api-signatures.json',
          'utf8',
        ),
      ) as Record<string, string>,
    );
    for (const batch of [
      'p2-04',
      'p2-05',
      'p2-06',
      'p2-07',
      'p3-01',
      'p3-02',
      'p3-03',
      'p3-04',
      'p2-03',
      'p1-12',
      'p2-02',
    ]) {
      const baseline = JSON.parse(
        fs.readFileSync(
          'tooling/compatibility/' + batch + '-api-signatures.json',
          'utf8',
        ),
      ) as Record<string, string>;
      for (const [contract, hash] of Object.entries(baseline)) {
        if (combined[contract] !== undefined && combined[contract] !== hash)
          throw new Error('Conflicting historical API contract: ' + contract);
        combined[contract] = hash;
      }
    }
    assertApiCompatible(createOpenApiDocument(), combined);
  });
  it('preserves accepted P4-05 contracts', () => {
    assertApiCompatible(
      createOpenApiDocument(),
      JSON.parse(
        fs.readFileSync(
          'tooling/compatibility/p4-05-api-signatures.json',
          'utf8',
        ),
      ),
    );
  });
  it('preserves accepted P4-04 contracts', () => {
    assertApiCompatible(
      createOpenApiDocument(),
      JSON.parse(
        fs.readFileSync(
          'tooling/compatibility/p4-04-api-signatures.json',
          'utf8',
        ),
      ),
    );
  });
  it('preserves accepted P4-03 contracts', () => {
    assertApiCompatible(
      createOpenApiDocument(),
      JSON.parse(
        fs.readFileSync(
          'tooling/compatibility/p4-03-api-signatures.json',
          'utf8',
        ),
      ),
    );
  });
  it('preserves accepted P4-02 contracts', () => {
    assertApiCompatible(
      createOpenApiDocument(),
      JSON.parse(
        fs.readFileSync(
          'tooling/compatibility/p4-02-api-signatures.json',
          'utf8',
        ),
      ),
    );
  });
  it('preserves accepted P4-01 contracts', () => {
    assertApiCompatible(
      createOpenApiDocument(),
      JSON.parse(
        fs.readFileSync(
          'tooling/compatibility/p4-01-api-signatures.json',
          'utf8',
        ),
      ),
    );
  });
  it('preserves accepted P3-05 contracts', () => {
    assertApiCompatible(
      createOpenApiDocument(),
      JSON.parse(
        fs.readFileSync(
          'tooling/compatibility/p3-05-api-signatures.json',
          'utf8',
        ),
      ),
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
