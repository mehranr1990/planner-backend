import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import { teamGapOperations } from '../../packages/api-contracts/src/team-gap-closure-openapi.js';
import {
  assertApiCompatible,
  apiSignatures,
  approvedTeamHash,
} from './openapi-compatibility.js';
import { historicalCompanyCustodyResponses } from './company-custody-responses.js';
it('freezes the 25 Teams operations and exact authorized RSVP/Calendar/history transitions', () => {
  const doc = createOpenApiDocument(),
    frozen = JSON.parse(
      fs.readFileSync(
        'tooling/compatibility/team-gap-api-signatures.json',
        'utf8',
      ),
    ) as Record<string, string>;
  expect(teamGapOperations).toHaveLength(25);
  assertApiCompatible(doc, frozen);
  const changes = JSON.parse(
    fs.readFileSync(
      'tooling/compatibility/team-gap-api-extensions.json',
      'utf8',
    ),
  ) as Record<string, { previous: string[]; approved: string }>;
  const signatures = apiSignatures(historicalCompanyCustodyResponses(doc));
  for (const [key, change] of Object.entries(changes)) {
    expect(key).not.toMatch(/ security$| parameters$/);
    expect(signatures[key]).toBe(change.approved);
    for (const previous of change.previous)
      expect(approvedTeamHash(key, previous)).toBe(change.approved);
  }
  const changed = structuredClone(doc) as unknown as {
    paths: Record<string, Record<string, { security: unknown[] }>>;
  };
  changed.paths['/api/v1/teams/{id}/availability']!.get!.security = [];
  expect(() => assertApiCompatible(changed, frozen)).toThrow('compatibility');
});
