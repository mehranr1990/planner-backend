import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
export function messageKey(key: string | undefined) {
  if (!key || !/^[\x21-\x7e]{1,128}$/.test(key))
    throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  return createHash('sha256').update(key).digest('hex');
}
export function messageVersion(expected: number | undefined, actual: number) {
  if (expected === undefined) throw new BadRequestException();
  if (expected !== actual)
    throw new ConflictException({ code: 'REVISION_CONFLICT' });
}
