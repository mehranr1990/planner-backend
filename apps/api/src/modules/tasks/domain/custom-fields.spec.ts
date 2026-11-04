import { it, expect, describe } from 'vitest';
import { fieldDefinition, fieldValue } from './custom-fields.js';
import type { FieldKind } from './custom-fields.js';
const scales = { USD: 2, JPY: 0, KWD: 3 };
const id = '63d3e2da-4b7d-4f01-8332-5f6c92b03b47',
  other = '8f22d750-eeca-4efe-97a8-48f9bcbcd986';
describe('P2-05 typed custom fields', () => {
  it.each([
    ['TEXT', 'private work text'],
    ['NUMBER', '-12.3400'],
    ['DATE', '2024-02-29'],
    ['BOOLEAN', false],
    ['SINGLE_SELECT', id],
    ['MULTI_SELECT', [other, id]],
    ['PERSON', { accessId: id, generation: 2 }],
    ['CURRENCY', { currency: 'KWD', amount: '0.001' }],
  ] as const)(
    'validates %s without coercing other value types',
    (kind, value) => {
      const definition = {
        kind,
        ...(kind.endsWith('SELECT')
          ? {
              options: [
                { id, label: 'First' },
                { id: other, label: 'Second' },
              ],
            }
          : {}),
      };
      fieldDefinition(definition, scales);
      expect(fieldValue(definition, value, scales)).not.toBeUndefined();
    },
  );
  it.each([
    ['TEXT', 42],
    ['NUMBER', 0.1],
    ['NUMBER', '1e10'],
    ['NUMBER', 'NaN'],
    ['DATE', '2023-02-29'],
    ['BOOLEAN', 'true'],
    ['SINGLE_SELECT', other],
    ['MULTI_SELECT', [id, id]],
    ['PERSON', { userId: id }],
    ['PERSON', { accessId: id, generation: 0 }],
    ['CURRENCY', { currency: 'USD', amount: '1.001' }],
    ['CURRENCY', { currency: 'JPY', amount: '0.1' }],
    ['CURRENCY', { currency: 'XXX', amount: '1' }],
  ] as const)('rejects invalid %s values', (kind, value) => {
    expect(() =>
      fieldValue(
        { kind: kind as FieldKind, options: [{ id, label: 'Only' }] },
        value,
        scales,
      ),
    ).toThrow();
  });
  it('compares decimal bounds exactly and normalizes signed zero', () => {
    const definition = {
      kind: 'NUMBER' as const,
      minimum: '9007199254740992',
      maximum: '9007199254740993',
    };
    expect(fieldValue(definition, '9007199254740993', scales)).toBe(
      '9007199254740993',
    );
    expect(() =>
      fieldValue(definition, '9007199254740993.000001', scales),
    ).toThrow();
    expect(fieldValue({ kind: 'NUMBER' }, '-0.000000', scales)).toBe('0');
  });
  it('rejects incompatible definition options, impossible bounds and invalid defaults', () => {
    expect(() =>
      fieldDefinition({ kind: 'TEXT', options: [{ id, label: 'x' }] }, scales),
    ).toThrow();
    expect(() =>
      fieldDefinition({ kind: 'NUMBER', minimum: '2', maximum: '1' }, scales),
    ).toThrow();
    expect(() =>
      fieldDefinition(
        {
          kind: 'SINGLE_SELECT',
          options: [
            { id, label: 'x' },
            { id, label: 'y' },
          ],
        },
        scales,
      ),
    ).toThrow();
    expect(() =>
      fieldDefinition({ kind: 'DATE', defaultValue: '2023-02-29' }, scales),
    ).toThrow();
    expect(() =>
      fieldDefinition({ kind: 'TEXT', maxLength: 2001 }, scales),
    ).toThrow();
  });
  it('keeps selection and person references explicit and rejects overposting', () => {
    expect(
      fieldValue(
        {
          kind: 'MULTI_SELECT',
          options: [
            { id, label: 'x' },
            { id: other, label: 'y' },
          ],
        },
        [other, id],
        scales,
      ),
    ).toEqual([id, other].sort());
    expect(() =>
      fieldValue(
        { kind: 'PERSON' },
        { accessId: id, generation: 1, role: 'OWNER' },
        scales,
      ),
    ).toThrow();
    expect(() =>
      fieldValue(
        { kind: 'CURRENCY' },
        { currency: 'USD', amount: '1', accountId: id },
        scales,
      ),
    ).toThrow();
    expect(
      fieldValue({ kind: 'TEXT', defaultValue: 'default' }, null, scales),
    ).toBeNull();
  });
});
