import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as c from '@mehran/api-contracts';
import { Prisma } from '../../generated/prisma/client.js';
import type { AuthorizedSpace } from '../../platform/authorization/authorized-space.js';
import { DatabaseService } from '../../platform/database/database.service.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';
import { readCursor, signCursor } from '../../platform/sync/cursor.js';
import type { SyncSource } from '../../platform/sync/source.js';
import { TasksSync } from '../tasks/public/index.js';
import { PlanningSync } from '../planning/public/index.js';
import { HabitsSync } from '../habits/public/index.js';
import { NotesSync } from '../notes/public/index.js';
import { CaptureSync } from '../capture/public/index.js';
import { SpacesService } from '../spaces/public/index.js';
import type { z } from 'zod';
const entities = c.SyncEntitySchema.options;
const canonical = (v: unknown): string =>
  v !== null && typeof v === 'object'
    ? Array.isArray(v)
      ? '[' + v.map(canonical).join(',') + ']'
      : '{' +
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b, 'en'))
          .map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
          .join(',') +
        '}'
    : JSON.stringify(v);
@Injectable()
export class SyncService {
  private readonly sources: SyncSource[];
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TasksSync) tasks: TasksSync,
    @Inject(PlanningSync) planning: PlanningSync,
    @Inject(HabitsSync) habits: HabitsSync,
    @Inject(NotesSync) notes: NotesSync,
    @Inject(CaptureSync) capture: CaptureSync,
    @Inject(SpacesService) private readonly spaces: SpacesService,
  ) {
    this.sources = [tasks, planning, habits, notes, capture];
  }
  private source(entity: c.SyncEntity) {
    const found = this.sources.find((s) => s.entities.includes(entity));
    if (!found) throw new BadRequestException();
    return found;
  }
  private entity(op: string): c.SyncEntity {
    return op.startsWith('CHECKLIST_')
      ? 'CHECKLIST'
      : op.startsWith('LABEL_')
        ? 'LABEL'
        : op.startsWith('DAY_')
          ? 'DAILY_PLAN'
          : op.startsWith('HABIT_')
            ? 'HABIT_ENTRY'
            : op.startsWith('NOTE_')
              ? 'NOTE'
              : op.startsWith('CAPTURE_')
                ? 'CAPTURE'
                : 'TASK';
  }
  async status(scope: AuthorizedSpace) {
    return this.db.client.$transaction(async (tx) => {
      await scope.fence(tx);
      const state = await scope.syncState(tx);
      return c.SyncStatusSchema.parse({
        epoch: state.epoch,
        currentSequence: String(state.sequence),
        retainedSequence: String(state.retained),
        feedRetentionDays: 30,
        receiptBodyRetentionDays: 30,
        maxPushOperations: 50,
        maxPullItems: 100,
        entities,
        financePosting: 'ONLINE_ONLY',
      });
    });
  }
  async push(scope: AuthorizedSpace, input: z.infer<typeof c.SyncPushSchema>) {
    if (Buffer.byteLength(JSON.stringify(input)) > 131072)
      throw new BadRequestException();
    const results: z.infer<typeof c.SyncItemResultSchema>[] = [];
    for (const raw of input.operations) {
      results.push(
        await this.db.client.$transaction(
          async (tx) => {
            await scope.fence(tx);
            const state = await scope.syncState(tx);
            if (state.epoch !== input.epoch)
              throw new ConflictException({ code: 'RESYNC_REQUIRED' });
            const parsed = c.SyncCommandSchema.safeParse(raw),
              normalized = parsed.success ? parsed.data : raw;
            const { clientMutationId: _mutationId, ...fingerprintBody } =
              normalized;
            const fingerprint = createHash('sha256')
              .update(canonical(fingerprintBody))
              .digest('hex');
            const prior = await tx.syncMutationReceipt.findFirst({
              where: {
                spaceId: scope.spaceId,
                OR: [
                  { clientMutationId: raw.clientMutationId },
                  ...(raw.clientEntryId && raw.operation === 'HABIT_LOG'
                    ? [{ clientEntryId: raw.clientEntryId }]
                    : []),
                ],
              },
            });
            if (prior) {
              if (prior.fingerprint !== fingerprint)
                return c.SyncItemResultSchema.parse({
                  clientMutationId: raw.clientMutationId,
                  status: 'REJECTED',
                  originalStatus: null,
                  resource: null,
                  resultExpired: false,
                  error: {
                    code: 'MUTATION_ID_REUSED',
                    server: null,
                    client: null,
                  },
                });
              const previous =
                prior.result && prior.bodyExpiresAt > new Date()
                  ? c.SyncItemResultSchema.parse(prior.result)
                  : null;
              return c.SyncItemResultSchema.parse({
                clientMutationId: raw.clientMutationId,
                status: 'DUPLICATE',
                originalStatus: prior.disposition,
                resource: previous?.resource ?? null,
                error: previous?.error ?? null,
                resultExpired: !previous,
              });
            }
            let result: z.infer<typeof c.SyncItemResultSchema> = {
              clientMutationId: raw.clientMutationId,
              status: 'REJECTED',
              originalStatus: null,
              resource: null,
              resultExpired: false,
              error: { code: 'INVALID_OPERATION', server: null, client: null },
            };
            if (parsed.success) {
              await tx.$executeRawUnsafe('SAVEPOINT sync_operation');
              try {
                const resource = await this.source(
                  this.entity(parsed.data.operation),
                ).command(tx, scope, parsed.data);
                result = {
                  ...result,
                  status: 'APPLIED',
                  resource,
                  error: null,
                };
                await tx.$executeRawUnsafe('RELEASE SAVEPOINT sync_operation');
              } catch (error) {
                await tx.$executeRawUnsafe(
                  'ROLLBACK TO SAVEPOINT sync_operation',
                );
                if (
                  !(error instanceof HttpException) ||
                  error.getStatus() >= 500
                )
                  throw error;
                const conflict = error.getStatus() === 409;
                let server: c.SyncResource | null = null;
                if (conflict && raw.resourceId) {
                  server = await this.source(this.entity(raw.operation)).read(
                    tx,
                    scope,
                    this.entity(raw.operation),
                    raw.resourceId,
                    raw.parentId,
                  );
                }
                const response = error.getResponse(),
                  code =
                    typeof response === 'object' &&
                    'code' in response &&
                    typeof response.code === 'string'
                      ? response.code
                      : conflict
                        ? 'STALE_REVISION'
                        : error.getStatus() === 404
                          ? 'RESOURCE_UNAVAILABLE'
                          : 'INVALID_OPERATION';
                result = {
                  ...result,
                  status: conflict ? 'CONFLICT' : 'REJECTED',
                  error: { code, server, client: conflict ? raw.body : null },
                };
              }
            }
            const value = c.SyncItemResultSchema.parse(result);
            await tx.syncMutationReceipt.create({
              data: {
                spaceId: scope.spaceId,
                actorUserId: scope.actor.userId,
                clientMutationId: raw.clientMutationId,
                ...(raw.clientEntryId && raw.operation === 'HABIT_LOG'
                  ? { clientEntryId: raw.clientEntryId }
                  : {}),
                fingerprint,
                disposition: value.status,
                resourceId: value.resource?.id ?? null,
                result: value as Prisma.InputJsonValue,
                bodyExpiresAt: new Date(Date.now() + 30 * 86400000),
              },
            });
            return value;
          },
          { timeout: 30000 },
        ),
      );
    }
    return c.SyncPushResultSchema.parse({ results });
  }
  async pull(
    scope: AuthorizedSpace,
    input: z.infer<typeof c.SyncPullQuerySchema>,
  ) {
    return this.db.client.$transaction(
      async (tx) => {
        await scope.fence(tx);
        const state = await scope.syncState(tx),
          now = Date.now(),
          limit = Number(input.limit ?? 100);
        let cursor = input.cursor
          ? readCursor(
              this.config.BETTER_AUTH_SECRET,
              input.cursor,
              scope,
              state.epoch,
              state.retained,
              now,
            )
          : {
              v: 1 as const,
              u: scope.actor.userId,
              s: scope.spaceId,
              e: state.epoch,
              phase: 'BOOTSTRAP' as const,
              sequence: String(state.sequence),
              entity: 0,
              after: null,
              issued: now,
            };
        if (BigInt(cursor.sequence) > state.sequence)
          throw new ConflictException({ code: 'RESYNC_REQUIRED' });
        const items: c.SyncResource[] = [];
        let hasMore = false;
        if (cursor.phase === 'BOOTSTRAP') {
          while (cursor.entity < entities.length && items.length < limit) {
            const entity = entities[cursor.entity]!,
              page = await this.source(entity).list(
                tx,
                scope,
                entity,
                cursor.after ?? undefined,
                limit - items.length + 1,
              ),
              taken = page.slice(0, limit - items.length);
            items.push(...taken);
            if (page.length > taken.length) {
              cursor = { ...cursor, after: taken.at(-1)!.id };
              hasMore = true;
              break;
            }
            cursor = { ...cursor, entity: cursor.entity + 1, after: null };
          }
          if (cursor.entity >= entities.length)
            cursor = { ...cursor, phase: 'INCREMENTAL', after: null };
          else hasMore = true;
        } else {
          const changes = await tx.syncChange.findMany({
            where: {
              spaceId: scope.spaceId,
              sequence: { gt: BigInt(cursor.sequence) },
            },
            orderBy: { sequence: 'asc' },
            take: limit + 1,
          });
          for (const change of changes.slice(0, limit)) {
            const entity = c.SyncEntitySchema.parse(change.entity),
              value = await this.source(entity).read(
                tx,
                scope,
                entity,
                change.resourceId,
                change.parentId ?? undefined,
              );
            items.push(
              value ??
                c.SyncResourceSchema.parse({
                  entity,
                  id: change.resourceId,
                  revision: change.revision,
                  deleted: true,
                  data: null,
                }),
            );
            cursor = { ...cursor, sequence: String(change.sequence) };
          }
          hasMore = changes.length > limit;
        }
        return c.SyncPullResultSchema.parse({
          phase: cursor.phase,
          reset: !input.cursor,
          epoch: state.epoch,
          cursor: signCursor(this.config.BETTER_AUTH_SECRET, cursor),
          hasMore,
          semantics: 'CURRENT_STATE',
          items,
        });
      },
      { timeout: 30000 },
    );
  }
  async maintain() {
    const cutoff = new Date(Date.now() - 30 * 86400000),
      changes = await this.db.client.syncChange.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { spaceId: true },
        take: 100,
        orderBy: { createdAt: 'asc' },
      }),
      receipts = await this.db.client.syncMutationReceipt.findMany({
        where: {
          bodyExpiresAt: { lt: new Date() },
          result: { not: Prisma.AnyNull },
        },
        select: { id: true, spaceId: true },
        take: 100,
        orderBy: { bodyExpiresAt: 'asc' },
      });
    const ids = [
      ...new Set([...changes, ...receipts].map((v) => v.spaceId)),
    ].slice(0, 25);
    let worked = false;
    for (const id of ids)
      await this.db.client.$transaction(async (tx) => {
        const requestId = crypto.randomUUID(),
          scope = await this.spaces.background(tx, id, requestId, requestId);
        if (!scope) return;
        await scope.fence(tx);
        const prefix = await tx.syncChange.findMany({
            where: { spaceId: id },
            orderBy: { sequence: 'asc' },
            take: 100,
          }),
          expired = [];
        for (const row of prefix) {
          if (row.createdAt >= cutoff) break;
          expired.push(row);
        }
        if (expired.length) {
          const last = expired.at(-1)!;
          await tx.syncChange.deleteMany({
            where: { spaceId: id, sequence: { lte: last.sequence } },
          });
          await scope.retainSyncFrom(tx, last.sequence);
          worked = true;
        }
        const owned = receipts.filter((v) => v.spaceId === id).map((v) => v.id);
        if (owned.length) {
          await tx.syncMutationReceipt.updateMany({
            where: {
              spaceId: id,
              id: { in: owned },
              bodyExpiresAt: { lt: new Date() },
            },
            data: { result: Prisma.DbNull },
          });
          worked = true;
        }
      });
    return worked;
  }
}
