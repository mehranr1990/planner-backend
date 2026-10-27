import { BadRequestException, ConflictException } from '@nestjs/common';
import { IfMatchSchema } from '@mehran/api-contracts';

export function revisionTag(revision: number): string {
  return `"${revision}"`;
}
export function expectedRevision(
  header: string | undefined,
): number | undefined {
  if (header === undefined) return undefined;
  if (!IfMatchSchema.safeParse(header).success) throw new BadRequestException();
  const revision = Number(header.slice(1, -1));
  if (revision > 2147483646) throw new BadRequestException();
  return revision;
}
export function requireOneRevision(count: number): void {
  if (count !== 1) throw new ConflictException();
}
