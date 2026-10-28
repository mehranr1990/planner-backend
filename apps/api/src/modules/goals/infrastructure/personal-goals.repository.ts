import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../../platform/authorization/authorized-space.js';
import type { SearchRequest, PersonalSearchHit } from '@mehran/api-contracts';
import { PersonalGoals } from '../public/personal-goals.js';
import {
  searchAfter,
  literalSearch,
  searchSnippet,
} from '../../../platform/database/personal-search.js';
@Injectable()
export class PersonalGoalsRepository extends PersonalGoals {
  async require(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    id: string,
  ) {
    if (
      !(await tx.goal.findFirst({
        where: { spaceId: scope.spaceId, id },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
  }
  async search(
    tx: Prisma.TransactionClient,
    scope: AuthorizedSpace,
    r: SearchRequest,
  ): Promise<PersonalSearchHit[]> {
    const text = { contains: literalSearch(r.q), mode: 'insensitive' as const };
    const rows = await tx.goal.findMany({
      where: {
        spaceId: scope.spaceId,
        AND: [
          { OR: [{ title: text }, { description: text }] },
          searchAfter(r, 'GOAL', false),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: r.limit,
    });
    return rows.map((v) => ({
      kind: 'GOAL',
      id: v.id,
      revision: v.revision,
      title: v.title,
      snippet: searchSnippet(v.description ?? v.title),
      createdAt: v.createdAt.toISOString(),
    }));
  }
}
