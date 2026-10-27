import { BadRequestException } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues.map((issue) => ({
          // Input field names may themselves contain sensitive user content.
          path: issue.path
            .map((part) => (typeof part === 'number' ? String(part) : 'field'))
            .join('.'),
          code: issue.code,
        })),
      });
    }
    return parsed.data;
  }
}
