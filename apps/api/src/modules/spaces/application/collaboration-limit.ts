import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { SharedControl } from '../../../platform/storage/shared-control.js';
import { RateLimitException } from '../../../bootstrap/rate-limit.js';
import { sharedRatePolicy } from '../domain/http-rate-policy.js';
import type { SharedTraffic } from '../domain/http-rate-policy.js';

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
    const result = await tx.$queryRaw<{ requests: number; reset: number }[]>`
      WITH tick AS (SELECT clock_timestamp() AS now), counted AS (
      INSERT INTO "SharedRateLimit" ("keyHash","windowAt",requests,"expiresAt")
      SELECT ${key},date_trunc('minute',now),1,date_trunc('minute',now)+interval '2 minutes' FROM tick
      ON CONFLICT ("keyHash") DO UPDATE SET
      requests=CASE WHEN "SharedRateLimit"."windowAt"=EXCLUDED."windowAt" THEN "SharedRateLimit".requests+1 ELSE 1 END,
      "windowAt"=EXCLUDED."windowAt","expiresAt"=EXCLUDED."expiresAt" RETURNING requests, "windowAt")
      SELECT requests, GREATEST(1,ceil(extract(epoch FROM ("windowAt"+interval '1 minute'-(SELECT now FROM tick)))))::integer AS reset FROM counted`;
    const state = {
      limit,
      remaining: Math.max(0, limit - result[0]!.requests),
      reset: result[0]!.reset,
    };
    if (result[0]!.requests > limit) throw new RateLimitException(state);
    return state;
  }
  /** Runs before business validation, in independent short statements, so failed proofs count. */
  async request(
    ip: string,
    userId?: string,
    preview = false,
    traffic?: SharedTraffic,
  ) {
    const policy = sharedRatePolicy(traffic, preview);
    const prefix = `http:v2:${policy.family}:${preview ? 'preview' : policy.kind}:`;
    const states = [];
    // Actor first: an exhausted user must not burn the shared NAT allowance.
    if (userId)
      states.push(await this.take(prefix + 'actor:' + userId, policy.actor));
    states.push(await this.take(prefix + 'ip:' + ip, policy.ip));
    if (policy.endpoint) {
      const endpoint = `http:v2:${policy.family}:endpoint:${policy.endpoint}:`;
      if (userId)
        states.push(await this.take(endpoint + 'actor:' + userId, 30));
      states.push(await this.take(endpoint + 'ip:' + ip, 300));
    }
    // Describe the closest constraint to exhaustion, without exposing identities.
    return states.reduce((a, b) =>
      a.remaining / a.limit <= b.remaining / b.limit ? a : b,
    );
  }
  async maintain() {
    return this.db.client
      .$executeRaw`DELETE FROM "SharedRateLimit" WHERE "keyHash" IN (SELECT "keyHash" FROM "SharedRateLimit" WHERE "expiresAt"<=clock_timestamp() ORDER BY "expiresAt","keyHash" LIMIT 100 FOR UPDATE SKIP LOCKED)`;
  }
}
