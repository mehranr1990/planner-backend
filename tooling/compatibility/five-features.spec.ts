import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import {
  apiSignatures,
  assertApiCompatible,
  approvedFiveFeaturesHash,
} from './openapi-compatibility.js';
import { historicalCompanyCustodyResponses } from './company-custody-responses.js';
it('permits only exact approved feature contract additions and rejects security or unrelated schema drift', () => {
  const extensions = JSON.parse(
    fs.readFileSync(
      'tooling/compatibility/five-features-api-extensions.json',
      'utf8',
    ),
  ) as Record<string, { previous: string[]; approved: string }>;
  const document = createOpenApiDocument();
  const current = apiSignatures(historicalCompanyCustodyResponses(document));
  for (const [key, change] of Object.entries(extensions)) {
    expect(key).not.toMatch(/security$/);
    expect(key).toMatch(
      /\/projects|\/conversations|\/notifications\/preferences/,
    );
    expect(current[key]).toBe(change.approved);
    for (const old of change.previous) {
      expect(approvedFiveFeaturesHash(key, old)).toBe(change.approved);
      assertApiCompatible(document, { [key]: old });
    }
  }
  const changed = structuredClone(document) as unknown as {
    paths: Record<string, { get: { security: unknown[] } }>;
  };
  changed.paths['/api/v1/projects']!.get!.security = [];
  expect(() => assertApiCompatible(changed, current)).toThrow('compatibility');
});
