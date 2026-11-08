import { isDeepStrictEqual } from 'node:util';

type Node = Record<string, unknown>;
const uuid = {
  type: 'string',
  format: 'uuid',
  pattern:
    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
};
const independent = {
  type: 'object',
  properties: { kind: { type: 'string', const: 'INDEPENDENT' } },
  required: ['kind'],
  additionalProperties: false,
};
const approved = {
  anyOf: [
    independent,
    {
      type: 'object',
      properties: {
        kind: { type: 'string', const: 'COMPANY' },
        companyId: uuid,
        parentScopeId: uuid,
      },
      required: ['kind', 'companyId', 'parentScopeId'],
      additionalProperties: false,
    },
  ],
};

/** ADR 0041: only these nine successful response locations may expand. */
export const companyCustodyResponses = [
  ['post', '/api/v1/projects', '201', 'properties'],
  ['get', '/api/v1/projects', '200', 'properties.items.items.properties'],
  ['get', '/api/v1/projects/{id}', '200', 'properties'],
  ['patch', '/api/v1/projects/{id}', '200', 'properties'],
  ['post', '/api/v1/teams', '201', 'properties'],
  ['get', '/api/v1/teams', '200', 'properties.items.items.properties'],
  ['get', '/api/v1/teams/{id}', '200', 'properties'],
  ['patch', '/api/v1/teams/{id}', '200', 'properties'],
  [
    'get',
    '/api/v1/teams/{id}/projects',
    '200',
    'properties.items.items.properties.project.properties',
  ],
] as const;

/** ADR 0042: two success shapes only; independently freeze both source branches. */
export const portfolioCustodyResponses = [
  ['get', '/api/v1/teams/{id}/portfolio', '200', 'properties.sources'],
  [
    'get',
    '/api/v1/teams/{id}/dashboard',
    '200',
    'properties.portfolio.properties.sources',
  ],
] as const;
const count = { type: 'integer', minimum: 0, maximum: 9007199254740991 };
const summaryFields = [
  'taskCount',
  'statusCounts',
  'estimatedMinutes',
  'unknownEstimates',
  'completedInWindow',
  'overdueTaskCount',
  'recordedSeconds',
  'workLogCount',
  'goalCount',
];
const statuses = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELED'];
const summary = {
  type: 'object',
  properties: Object.fromEntries(
    summaryFields.map((field) => [
      field,
      field === 'statusCounts'
        ? {
            type: 'object',
            properties: Object.fromEntries(
              statuses.map((status) => [status, count]),
            ),
            required: statuses,
            additionalProperties: false,
          }
        : count,
    ]),
  ),
  required: summaryFields,
  additionalProperties: false,
};
const independentSource = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['TEAM', 'PROJECT'] },
    spaceId: uuid,
    summary,
  },
  required: ['kind', 'spaceId', 'summary'],
  additionalProperties: false,
};
const approvedSource = {
  anyOf: [
    independentSource,
    {
      ...independentSource,
      properties: { ...independentSource.properties, scopeId: uuid },
      required: [...independentSource.required, 'scopeId'],
    },
  ],
};

export function historicalCompanyCustodyResponses(document: unknown): unknown {
  const copy = structuredClone(document) as Node;
  for (const [method, path, status, location] of companyCustodyResponses) {
    const keys = [
      'paths',
      path,
      method,
      'responses',
      status,
      'content',
      'application/json',
      'schema',
      ...location.split('.'),
    ];
    let node: unknown = copy;
    for (const key of keys)
      node = node && typeof node === 'object' ? (node as Node)[key] : undefined;
    if (node && typeof node === 'object') {
      const properties = node as Node;
      // Exact equality validates the original branch AND every new-branch field.
      // Any other difference remains visible to the original frozen hash check.
      if (isDeepStrictEqual(properties.association, approved))
        properties.association = structuredClone(independent);
    }
  }
  for (const [method, path, status, location] of portfolioCustodyResponses) {
    let node: unknown = copy;
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
      node = node && typeof node === 'object' ? (node as Node)[key] : undefined;
    if (
      node &&
      typeof node === 'object' &&
      isDeepStrictEqual((node as Node).items, approvedSource)
    )
      (node as Node).items = structuredClone(independentSource);
  }
  return copy;
}
