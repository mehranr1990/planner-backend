export type FieldKind =
  | 'TEXT'
  | 'NUMBER'
  | 'DATE'
  | 'BOOLEAN'
  | 'SINGLE_SELECT'
  | 'MULTI_SELECT'
  | 'PERSON'
  | 'CURRENCY';
export type FieldDefinition = Readonly<{
  kind: FieldKind;
  maxLength?: number;
  minimum?: string;
  maximum?: string;
  options?: readonly { id: string; label: string }[];
  defaultValue?: unknown;
}>;
export type FieldValue =
  | string
  | boolean
  | readonly string[]
  | { accessId: string; generation: number }
  | { currency: string; amount: string }
  | null;
export class FieldRuleError extends Error {
  constructor(
    readonly code:
      | 'INVALID_DEFINITION'
      | 'INVALID_VALUE'
      | 'UNKNOWN_OPTION'
      | 'INVALID_CURRENCY',
  ) {
    super(code);
  }
}
const decimal = /^-?(?:0|[1-9]\d{0,23})(?:\.\d{1,6})?$/;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function number(value: unknown): string {
  if (typeof value !== 'string' || !decimal.test(value))
    throw new FieldRuleError('INVALID_VALUE');
  const canonical = value.includes('.')
    ? value.replace(/0+$/, '').replace(/\.$/, '')
    : value;
  return /^-0$/.test(canonical) ? '0' : canonical;
}
function units(value: string): bigint {
  const sign = value.startsWith('-') ? -1n : 1n,
    [integer, fraction = ''] = value.replace(/^-/, '').split('.');
  return sign * (BigInt(integer!) * 1000000n + BigInt(fraction.padEnd(6, '0')));
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new FieldRuleError('INVALID_VALUE');
  return value as Record<string, unknown>;
}
export function fieldDefinition(
  input: FieldDefinition,
  currencyScales: Readonly<Record<string, number>>,
): void {
  if (
    ![
      'TEXT',
      'NUMBER',
      'DATE',
      'BOOLEAN',
      'SINGLE_SELECT',
      'MULTI_SELECT',
      'PERSON',
      'CURRENCY',
    ].includes(input.kind)
  )
    throw new FieldRuleError('INVALID_DEFINITION');
  if (
    input.maxLength !== undefined &&
    (input.kind !== 'TEXT' ||
      !Number.isSafeInteger(input.maxLength) ||
      input.maxLength < 1 ||
      input.maxLength > 2000)
  )
    throw new FieldRuleError('INVALID_DEFINITION');
  if (input.minimum !== undefined || input.maximum !== undefined) {
    if (input.kind !== 'NUMBER') throw new FieldRuleError('INVALID_DEFINITION');
    if (input.minimum !== undefined) number(input.minimum);
    if (input.maximum !== undefined) number(input.maximum);
    if (
      input.minimum !== undefined &&
      input.maximum !== undefined &&
      units(input.minimum) > units(input.maximum)
    )
      throw new FieldRuleError('INVALID_DEFINITION');
  }
  const select =
    input.kind === 'SINGLE_SELECT' || input.kind === 'MULTI_SELECT';
  if (select) {
    const options = input.options ?? [];
    if (
      !options.length ||
      options.length > 100 ||
      new Set(options.map((o) => o.id.toLowerCase())).size !== options.length ||
      options.some(
        (o) => !uuid.test(o.id) || !o.label.trim() || o.label.length > 100,
      )
    )
      throw new FieldRuleError('INVALID_DEFINITION');
  } else if (input.options !== undefined)
    throw new FieldRuleError('INVALID_DEFINITION');
  if (input.defaultValue !== undefined)
    fieldValue(input, input.defaultValue, currencyScales);
}
/** No implicit retrofit: callers explicitly choose a supplied value or the published default. */
export function fieldValue(
  definition: FieldDefinition,
  input: unknown,
  currencyScales: Readonly<Record<string, number>>,
): FieldValue {
  if (input === null) return null;
  switch (definition.kind) {
    case 'TEXT':
      if (
        typeof input !== 'string' ||
        input.length > (definition.maxLength ?? 2000) ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input)
      )
        throw new FieldRuleError('INVALID_VALUE');
      return input;
    case 'NUMBER': {
      const value = number(input);
      if (
        (definition.minimum !== undefined &&
          units(value) < units(definition.minimum)) ||
        (definition.maximum !== undefined &&
          units(value) > units(definition.maximum))
      )
        throw new FieldRuleError('INVALID_VALUE');
      return value;
    }
    case 'DATE': {
      if (typeof input !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(input))
        throw new FieldRuleError('INVALID_VALUE');
      const date = new Date(input + 'T00:00:00Z');
      if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== input
      )
        throw new FieldRuleError('INVALID_VALUE');
      return input;
    }
    case 'BOOLEAN':
      if (typeof input !== 'boolean') throw new FieldRuleError('INVALID_VALUE');
      return input;
    case 'SINGLE_SELECT': {
      if (
        typeof input !== 'string' ||
        !definition.options?.some(
          (o) => o.id.toLowerCase() === input.toLowerCase(),
        )
      )
        throw new FieldRuleError('UNKNOWN_OPTION');
      return input.toLowerCase();
    }
    case 'MULTI_SELECT': {
      if (
        !Array.isArray(input) ||
        input.length > 20 ||
        input.some((v) => typeof v !== 'string') ||
        new Set(input.map((v) => (v as string).toLowerCase())).size !==
          input.length
      )
        throw new FieldRuleError('INVALID_VALUE');
      const values = input as string[];
      if (
        values.some(
          (v) =>
            !definition.options?.some(
              (o) => o.id.toLowerCase() === v.toLowerCase(),
            ),
        )
      )
        throw new FieldRuleError('UNKNOWN_OPTION');
      return values.map((v) => v.toLowerCase()).sort();
    }
    case 'PERSON': {
      const value = object(input);
      if (
        Object.keys(value).sort().join(',') !== 'accessId,generation' ||
        typeof value.accessId !== 'string' ||
        !uuid.test(value.accessId) ||
        !Number.isSafeInteger(value.generation) ||
        (value.generation as number) < 1
      )
        throw new FieldRuleError('INVALID_VALUE');
      return {
        accessId: value.accessId.toLowerCase(),
        generation: value.generation as number,
      };
    }
    case 'CURRENCY': {
      const value = object(input);
      if (
        Object.keys(value).sort().join(',') !== 'amount,currency' ||
        typeof value.currency !== 'string' ||
        currencyScales[value.currency] === undefined
      )
        throw new FieldRuleError('INVALID_CURRENCY');
      const amount = number(value.amount),
        scale = currencyScales[value.currency]!;
      if ((amount.split('.')[1]?.length ?? 0) > scale)
        throw new FieldRuleError('INVALID_CURRENCY');
      return { currency: value.currency, amount };
    }
  }
}
