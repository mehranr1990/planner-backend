import { createHash } from 'node:crypto';

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
  const current = apiSignatures(document);
  for (const [contract, hash] of Object.entries(baseline)) {
    if (current[contract] !== hash)
      throw new Error(
        `Approved API compatibility contract changed: ${contract}`,
      );
  }
}
