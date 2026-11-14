import { createHash } from 'node:crypto';
import { historicalCompanyCustodyResponses } from './company-custody-responses.ts';
import fs from 'node:fs';

// Owner-approved consolidated API gaps (2026-11-13): exact success-response
// transitions only. Keep every released baseline, request and security hash intact.
const responseExtensions = JSON.parse(
  fs.readFileSync(
    new URL('./consolidated-api-response-extensions.json', import.meta.url),
    'utf8',
  ),
) as Record<string, { previous: string; approved: string }>;
Object.assign(
  responseExtensions,
  JSON.parse(
    fs.readFileSync(
      new URL(
        './social-integration-api-response-extensions.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as Record<string, { previous: string; approved: string }>,
);
// Owner-approved stabilization (2026-11-13): exact transitions that only add
// an optional request field/alternative (M-X4) and response fields (M-A1).
Object.assign(
  responseExtensions,
  JSON.parse(
    fs.readFileSync(
      new URL('./stabilization-api-extensions.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, { previous: string; approved: string }>,
);

// Owner-approved Company completion (2026-11-13): resource responses add the
// nullable manager-defined typeId only (C-M4). Exact transitions; nothing else.
Object.assign(
  responseExtensions,
  JSON.parse(
    fs.readFileSync(
      new URL('./company-completion-api-extensions.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, { previous: string; approved: string }>,
);

// Owner-approved backend completion (2026-11-13): exact transitions that only add
// optional fields (LS settings, M-X6/M-X7 minutes attribution, AN Thanks Project,
// approval-history reason) or the required rejection reason (ER/AT) to requests.
Object.assign(
  responseExtensions,
  JSON.parse(
    fs.readFileSync(
      new URL('./backend-completion-api-extensions.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, { previous: string; approved: string }>,
);

// Owner-approved gap closure (2026-11-13): KPI `goals` becomes a nullable measured summary (OD-2).
Object.assign(
  responseExtensions,
  JSON.parse(
    fs.readFileSync(
      new URL('./gap-closure-api-extensions.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, { previous: string; approved: string }>,
);

// Owner-approved final closure (2026-11-14): Insights patterns add the measured 'estimates'
// pattern (B4); room bookings add the nullable, privacy-filtered booker title.
Object.assign(
  responseExtensions,
  JSON.parse(
    fs.readFileSync(
      new URL('./final-closure-api-extensions.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, { previous: string; approved: string }>,
);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
function stable(value: Json): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + stable(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
const digest = (value: Json) =>
  createHash('sha256').update(stable(value)).digest('hex');
export function apiSignatures(document: unknown): Record<string, string> {
  const doc = document as {
    paths: Record<string, Record<string, Record<string, Json>>>;
    components: { schemas: Record<string, Json> };
  };
  const signatures: Record<string, string> = {};
  for (const [path, operations] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      signatures[`${method} ${path} security`] = digest(
        operation.security ?? [],
      );
      signatures[`${method} ${path} request`] = digest(
        operation.requestBody ?? null,
      );
      // New optional headers are additive. Required headers/query/path contracts remain fixed.
      signatures[`${method} ${path} parameters`] = digest(
        ((operation.parameters ?? []) as Array<Record<string, Json>>).filter(
          (parameter) =>
            parameter.in !== 'header' || parameter.required === true,
        ),
      );
      for (const [status, response] of Object.entries(
        operation.responses as Record<string, Record<string, Json>>,
      ))
        signatures[`${method} ${path} response ${status}`] = digest(
          response.content ?? null,
        );
    }
  }
  for (const [name, schema] of Object.entries(doc.components.schemas))
    signatures[`schema ${name}`] = digest(schema);
  return signatures;
}

/** Offline checks complement Zod/HTTP tests; snapshot equality cannot detect dangling refs. */
export function assertOpenApiContract(document: unknown): {
  references: number;
  operations: number;
} {
  const doc = document as {
    openapi: string;
    paths: Record<
      string,
      Record<string, { operationId?: string; responses?: object }>
    >;
  };
  if (doc.openapi !== '3.1.0' || !doc.paths)
    throw new Error('Invalid OpenAPI root');
  const ids = new Set<string>();
  let references = 0;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === 'string') {
      if (!record.$ref.startsWith('#/'))
        throw new Error('Nonlocal OpenAPI reference requires review');
      let target: unknown = document;
      for (const segment of decodeURIComponent(record.$ref.slice(2)).split(
        '/',
      )) {
        const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
        target =
          target && typeof target === 'object'
            ? Object.prototype.hasOwnProperty.call(target, key)
              ? (target as Record<string, unknown>)[key]
              : undefined
            : undefined;
      }
      if (target === undefined)
        throw new Error(`Unresolved OpenAPI reference: ${record.$ref}`);
      references++;
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(document);
  for (const item of Object.values(doc.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (
        ![
          'get',
          'post',
          'put',
          'patch',
          'delete',
          'head',
          'options',
          'trace',
        ].includes(method)
      )
        continue;
      if (
        !operation.operationId ||
        ids.has(operation.operationId) ||
        !operation.responses ||
        !Object.keys(operation.responses).length
      )
        throw new Error(
          'Missing/duplicate operation identity or response contract',
        );
      ids.add(operation.operationId);
    }
  }
  return { references, operations: ids.size };
}
export function assertApiCompatible(
  document: unknown,
  baseline: Record<string, string>,
): void {
  const current = apiSignatures(historicalCompanyCustodyResponses(document));
  for (const [contract, hash] of Object.entries(baseline)) {
    const extension = responseExtensions[contract];
    if (
      current[contract] !== hash &&
      !(
        extension?.previous === hash && extension.approved === current[contract]
      )
    )
      throw new Error(
        `Approved API compatibility contract changed: ${contract}`,
      );
  }
}
