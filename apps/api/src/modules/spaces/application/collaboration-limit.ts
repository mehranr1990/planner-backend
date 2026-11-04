import { Inject, Injectable, HttpException } from '@nestjs/common';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { SharedControl } from '../../../platform/storage/shared-control.js';

@Injectable()
export class CollaborationLimit {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SharedControl) private readonly control: SharedControl,
  ) {}
  async take(
    subject: string,
    limit: number,
    tx: Prisma.TransactionClient = this.db.client,
  ) {
    const key = this.control.opaqueRateKey(subject);
    const result = await tx.$queryRaw<{ requests: number }[]>`
      INSERT INTO "SharedRateLimit" ("keyHash","windowAt",requests,"expiresAt")
      VALUES (${key},date_trunc('minute',clock_timestamp()),1,date_trunc('minute',clock_timestamp())+interval '2 minutes')
      ON CONFLICT ("keyHash") DO UPDATE SET
      requests=CASE WHEN "SharedRateLimit"."windowAt"=EXCLUDED."windowAt" THEN "SharedRateLimit".requests+1 ELSE 1 END,
      "windowAt"=EXCLUDED."windowAt","expiresAt"=EXCLUDED."expiresAt" RETURNING requests`;
    if (result[0]!.requests > limit)
      throw new HttpException({ code: 'COLLABORATION_RATE_LIMIT' }, 429);
  }
  /** Runs before business validation, in independent short statements, so failed proofs count. */
  async request(ip: string, userId?: string, preview = false) {
    await this.take((preview ? 'preview.ip:' : 'collaboration.ip:') + ip, 30);
    if (userId) await this.take('collaboration.actor:' + userId, 20);
  }
  async maintain() {
    return this.db.client
      .$executeRaw`DELETE FROM "SharedRateLimit" WHERE "keyHash" IN (SELECT "keyHash" FROM "SharedRateLimit" WHERE "expiresAt"<=clock_timestamp() ORDER BY "expiresAt","keyHash" LIMIT 100 FOR UPDATE SKIP LOCKED)`;
  }
}
