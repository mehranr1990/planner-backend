/** Rebase local definitions when a standalone JSON Schema is embedded in OpenAPI. */
export function embeddedJsonSchema<T>(schema: T, pointer: string): T {
  const result = structuredClone(schema);
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === 'string' && record.$ref.startsWith('#/$defs/'))
      record.$ref = pointer + record.$ref.slice(1);
    for (const child of Object.values(record)) visit(child);
  };
  visit(result);
  return result;
}

export const pointerSegment = (value: string) =>
  value.replaceAll('~', '~0').replaceAll('/', '~1');
