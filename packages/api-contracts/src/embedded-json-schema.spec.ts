import { describe, it, expect } from 'vitest';
import { embeddedJsonSchema, pointerSegment } from './embedded-json-schema.js';

describe('embedded recursive JSON Schema', () => {
  it('rebases nested definitions without mutating the source or component references', () => {
    const schema = {
      anyOf: [
        { $ref: '#/$defs/value' },
        { $ref: '#/components/schemas/ApiError' },
      ],
      $defs: { value: { items: { $ref: '#/$defs/value' } } },
    };
    const pointer = `#/paths/${pointerSegment('/a~b')}/post/requestBody/content/application~1json/schema`;
    const result = embeddedJsonSchema(schema, pointer);
    expect(result.anyOf[0]!.$ref).toBe(pointer + '/$defs/value');
    expect(result.$defs.value.items.$ref).toBe(pointer + '/$defs/value');
    expect(result.anyOf[1]!.$ref).toBe('#/components/schemas/ApiError');
    expect(schema.anyOf[0]!.$ref).toBe('#/$defs/value');
  });
});
