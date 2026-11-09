import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createOpenApiDocument } from '../../packages/api-contracts/src/openapi.js';
import {
  ProjectCreateSchema,
  DomainCustodyAssociationSchema,
} from '../../packages/api-contracts/src/projects.js';
import { TeamCreateSchema } from '../../packages/api-contracts/src/teams.js';
import {
  TeamPortfolioSourceSchema,
  TeamWorkSummarySchema,
} from '../../packages/api-contracts/src/team-analytics.js';
import { assertApiCompatible } from './openapi-compatibility.js';
import {
  companyCustodyResponses,
  portfolioCustodyResponses,
} from './company-custody-responses.js';

const baseline = JSON.parse(
  fs.readFileSync('tooling/compatibility/p4-05-api-signatures.json', 'utf8'),
);
type Node = Record<string, unknown>;
function properties(
  doc: unknown,
  entry: readonly [string, string, string, string],
): Node {
  const [method, path, status, location] = entry;
  let current = doc as Node;
  for (const key of [
    'paths',
    path,
    method,
    'responses',
    status,
    'content',
    'application/json',
    'schema',
    ...location.split('.'),
  ])
    current = current[key] as Node;
  return current;
}
it('preserves every frozen signature with exactly the approved nine response expansions', () => {
  const doc = createOpenApiDocument();
  expect(() => assertApiCompatible(doc, baseline)).not.toThrow();
});
it.each(companyCustodyResponses)(
  'rejects old/new/neighbor mutations in %s %s response %s at %s',
  (method, path, status, location) => {
    const doc = createOpenApiDocument();
    const entry = [method, path, status, location] as const;
    const association = properties(doc, entry).association as { anyOf: Node[] };
    expect(association.anyOf).toHaveLength(2);
    for (const mutation of ['old', 'new', 'neighbor'] as const) {
      const copy = structuredClone(doc);
      const props = properties(copy, entry);
      const branches = (props.association as { anyOf: Node[] }).anyOf;
      if (mutation === 'old') branches[0]!.additionalProperties = true;
      if (mutation === 'new') branches[1]!.additionalProperties = true;
      if (mutation === 'neighbor') (props.title as Node).maxLength = 301;
      expect(() => assertApiCompatible(copy, baseline)).toThrow(
        'compatibility',
      );
    }
  },
);
it('rejects unrelated security changes despite approved custody response expansions', () => {
  const doc = createOpenApiDocument();
  const changed = structuredClone(doc) as unknown as {
    paths: Record<string, Node>;
  };
  const get = changed.paths['/api/v1/me']!.get as Node;
  get.security = [];
  expect(() => assertApiCompatible(changed, baseline)).toThrow();
});

it('normalizes only the exact two approved portfolio expansions', () => {
  const doc = createOpenApiDocument();
  expect(() => assertApiCompatible(doc, baseline)).not.toThrow();
  for (const entry of portfolioCustodyResponses) {
    expect(
      (properties(doc, entry).items as { anyOf: unknown[] }).anyOf,
    ).toHaveLength(2);
  }
});
const portfolioMutations = [
  'old',
  'new',
  'old-summary',
  'new-summary',
  'scope',
  'kind',
  'array',
  'security',
  'request',
  'status',
] as const;
it.each(
  portfolioCustodyResponses.flatMap((entry) =>
    portfolioMutations.map((mutation) => ({ entry, mutation })),
  ),
)('rejects portfolio mutation $mutation in $entry', ({ entry, mutation }) => {
  const doc = createOpenApiDocument(),
    copy = structuredClone(doc),
    sources = properties(copy, entry);
  const branches = (sources.items as { anyOf: Node[] }).anyOf;
  if (mutation === 'old') branches[0]!.additionalProperties = true;
  if (mutation === 'new') branches[1]!.additionalProperties = true;
  if (mutation === 'old-summary' || mutation === 'new-summary') {
    const branch = branches[mutation === 'old-summary' ? 0 : 1]!;
    const fields = (branch.properties as Node).summary as {
      properties: Node;
    };
    (fields.properties.taskCount as Node).maximum = 10;
  }
  if (mutation === 'scope')
    ((branches[1]!.properties as Node).scopeId as Node).pattern = '.*';
  if (mutation === 'kind')
    ((branches[1]!.properties as Node).kind as Node).enum = ['PROJECT'];
  if (mutation === 'array') sources.maxItems = 102;
  const operation = (copy.paths as Record<string, Record<string, Node>>)[
    entry[1]
  ]![entry[0]]!;
  if (mutation === 'security') operation.security = [];
  if (mutation === 'request') operation.requestBody = { required: true };
  if (mutation === 'status') delete (operation.responses as Node)['200'];
  expect(() => assertApiCompatible(copy, baseline)).toThrow('compatibility');
});

it('preserves independent portfolio shapes and distinct source IDs under one Company custody', () => {
  const company = '11111111-1111-4111-8111-111111111111';
  const ids = [
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ];
  const summary = TeamWorkSummarySchema.parse(
    Object.fromEntries(
      Object.keys(TeamWorkSummarySchema.shape).map((key) => [
        key,
        key === 'statusCounts'
          ? { OPEN: 0, IN_PROGRESS: 0, DONE: 0, CANCELED: 0 }
          : 0,
      ]),
    ),
  );
  const old = { kind: 'PROJECT', spaceId: ids[0], summary };
  expect(TeamPortfolioSourceSchema.parse(old)).toEqual(old);
  const sources = ids.map((scopeId) =>
    TeamPortfolioSourceSchema.parse({
      kind: 'PROJECT',
      spaceId: company,
      scopeId,
      summary,
    }),
  );
  expect(sources.map((s) => ('scopeId' in s ? s.scopeId : null))).toEqual(ids);
  expect(new Set(sources.map((s) => s.spaceId)).size).toBe(1);
  for (const value of [
    { ...old, scopeId: 'invalid' },
    { ...old, scopeId: ids[1], inheritedAccess: true },
    { kind: 'PROJECT', spaceId: company, scopeId: ids[1] },
  ])
    expect(TeamPortfolioSourceSchema.safeParse(value).success).toBe(false);
});
it('accepts only complete custody responses and rejects Company custody mass assignment', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  expect(DomainCustodyAssociationSchema.parse({ kind: 'INDEPENDENT' })).toEqual(
    { kind: 'INDEPENDENT' },
  );
  expect(
    DomainCustodyAssociationSchema.safeParse({
      kind: 'COMPANY',
      companyId: id,
      parentScopeId: id,
    }).success,
  ).toBe(true);
  expect(
    DomainCustodyAssociationSchema.safeParse({ kind: 'COMPANY', companyId: id })
      .success,
  ).toBe(false);
  for (const schema of [ProjectCreateSchema, TeamCreateSchema])
    expect(
      schema.safeParse({
        id,
        title: 'Source',
        retentionPolicyVersion: 'v1',
        association: { kind: 'COMPANY', companyId: id, parentScopeId: id },
      }).success,
    ).toBe(false);
});
