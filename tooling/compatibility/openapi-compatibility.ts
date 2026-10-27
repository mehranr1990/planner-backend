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
  for (const name of ['ApiError', 'LiveHealth', 'ReadyHealth'])
    signatures[`schema ${name}`] = digest(doc.components.schemas[name]!);
  return signatures;
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
