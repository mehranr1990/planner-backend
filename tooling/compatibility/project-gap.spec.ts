import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import { projectGapOperations } from '../../packages/api-contracts/src/project-gap-closure-openapi.js';
import {
  apiSignatures,
  assertApiCompatible,
  approvedProjectHash,
} from './openapi-compatibility.js';
import { historicalCompanyCustodyResponses } from './company-custody-responses.js';
it('freezes all 36 Project gap operations and permits only the exact approved prior-contract transitions', () => {
  const doc = createOpenApiDocument(),
    frozen = JSON.parse(
      fs.readFileSync(
        'tooling/compatibility/project-gap-api-signatures.json',
        'utf8',
      ),
    ) as Record<string, string>,
    extensions = JSON.parse(
      fs.readFileSync(
        'tooling/compatibility/project-gap-api-extensions.json',
        'utf8',
      ),
    ) as Record<string, { previous: string[]; approved: string }>;
  expect(projectGapOperations).toHaveLength(36);
  expect(
    JSON.parse(fs.readFileSync('docs/frontend-handoff/openapi.json', 'utf8')),
  ).toEqual(JSON.parse(fs.readFileSync('docs/api/openapi.json', 'utf8')));
  expect(
    new Set(Object.keys(frozen).map((k) => k.split(' ').slice(0, 2).join(' ')))
      .size,
  ).toBe(36);
  assertApiCompatible(doc, frozen);
  const signatures = apiSignatures(historicalCompanyCustodyResponses(doc));
  for (const [key, change] of Object.entries(extensions)) {
    expect(signatures[key]).toBe(change.approved);
    expect(key).not.toMatch(/ security$/);
    for (const previous of change.previous)
      expect(approvedProjectHash(key, previous)).toBe(change.approved);
  }
  const changed = structuredClone(doc) as unknown as {
    paths: Record<
      string,
      Record<string, { security: unknown[]; requestBody: object }>
    >;
  };
  changed.paths['/api/v1/projects/{projectId}/analytics']!.get!.security = [];
  expect(() => assertApiCompatible(changed, frozen)).toThrow('compatibility');
  const neighbor = structuredClone(doc) as unknown as typeof changed;
  neighbor.paths['/api/v1/projects']!.post!.requestBody = {};
  const creation = extensions['post /api/v1/projects request']!;
  expect(() =>
    assertApiCompatible(neighbor, {
      'post /api/v1/projects request': creation.previous[0]!,
    }),
  ).toThrow('compatibility');
});
