import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { SpacesPort } from '../application/spaces.port.js';

@Injectable()
export class SpacesRepository implements SpacesPort {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  personalFor(userId: string) {
    return this.database.client.$transaction(async (tx) => {
      // Prisma's empty-update upsert may use a read/create path. The native
      // ON CONFLICT write must decide the race, not an application pre-check.
      await tx.space.createMany({
        data: [{ kind: 'PERSONAL', ownerUserId: userId }],
        skipDuplicates: true,
      });
      return tx.space.findUniqueOrThrow({
        where: { kind_ownerUserId: { kind: 'PERSONAL', ownerUserId: userId } },
      });
    });
  }
  findOwned(userId: string, spaceId: string) {
    return this.database.client.space.findFirst({
      where: { id: spaceId, ownerUserId: userId, kind: 'PERSONAL' },
    });
  }
}
