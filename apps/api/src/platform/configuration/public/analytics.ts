import { NotFoundException, ConflictException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { effectiveConfiguration } from '../configuration-core.js';

/** Read-only cohort projection. Configuration remains the flag-resolution owner. */
export async function analyticsFlagCohort(
  tx: Prisma.TransactionClient,
  definitionId: string,
  subjects: readonly { userId: string; workspaceId: string }[],
) {
  if (subjects.length > 1000)
    throw new ConflictException({ code: 'ANALYTICS_FLAG_SUBJECT_LIMIT' });
  const definition = await tx.platformConfigDefinition.findUnique({
    where: { id: definitionId },
  });
  if (!definition || definition.category !== 'FLAG')
    throw new NotFoundException();
  const result: boolean[] = [];
  for (const subject of subjects) {
    const flag = await effectiveConfiguration(tx, definition, {
      ...subject,
      clientVersion: 1,
    });
    if (typeof flag.value !== 'boolean')
      throw new ConflictException({ code: 'INVALID_FLAG_VALUE' });
    result.push(flag.value);
  }
  return result;
}
