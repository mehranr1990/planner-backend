import {
  Inject,
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../../platform/database/database.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestActor } from '../../platform/auth/request-actor.js';
import { PrivacyGate } from '../../platform/authorization/privacy-gate.js';
import { AdminCommand } from '../../platform/admin/admin-command.js';
import { SharedKernel } from '../spaces/public/index.js';
import { commerceScope } from '../spaces/public/commerce-context.js';
import { commerceLock } from './public/entitlements.js';
import { lockEngagementPersonal } from '../spaces/public/engagement-availability.js';
export const json = <T>(value: T): Prisma.InputJsonValue =>
  JSON.parse(
    JSON.stringify(value, (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    ),
  ) as Prisma.InputJsonValue;
export const match = (actual: number, expected: number) => {
  if (actual !== expected)
    throw new ConflictException({ code: 'STALE_REVISION' });
};
export const pageWhere = (q: { after?: string | undefined }) =>
  q.after ? { id: { gt: q.after } } : {};
export const page = <T extends { id: string }>(rows: T[], limit: number) => ({
  items: rows.slice(0, limit),
  nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
});
export function fail(code: string): never {
  throw new ConflictException({ code });
}
export function currency(code: string) {
  if (!Intl.supportedValuesOf('currency').includes(code))
    throw new BadRequestException({ code: 'UNSUPPORTED_CURRENCY' });
}
@Injectable()
export class CommerceCore {
  constructor(
    @Inject(DatabaseService) readonly db: DatabaseService,
    @Inject(PrivacyGate) readonly privacy: PrivacyGate,
    @Inject(SharedKernel) readonly kernel: SharedKernel,
  ) {}
  async customer(
    tx: Prisma.TransactionClient,
    id: string,
    actor?: RequestActor,
    financial = false,
  ) {
    this.privacy.assert();
    await commerceLock(tx, id);
    const customer = await tx.commerceCustomer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException();
    if (actor) {
      if (customer.closedAt || !customer.spaceId) throw new NotFoundException();
      const context = await commerceScope(
        tx,
        customer.scopeId ?? customer.spaceId,
        actor,
        this.kernel,
      );
      if (
        context.spaceId !== customer.spaceId ||
        context.kind !== customer.kind
      )
        throw new NotFoundException();
      if (
        financial &&
        !context.owner &&
        !(await tx.commerceFinancialGrant.findFirst({
          where: { customerId: id, userId: actor.userId, revokedAt: null },
        }))
      )
        throw new NotFoundException();
    }
    return customer;
  }
  async identity(tx: Prisma.TransactionClient, actor: RequestActor) {
    if (!actor.sessionId) throw new ForbiddenException();
    await lockEngagementPersonal(tx, actor.userId);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.userId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${actor.sessionId}::uuid FOR SHARE`;
    const user = await tx.user.findUnique({
      where: { id: actor.userId },
      select: {
        emailVerified: true,
        settings: { select: { suspendedAt: true, suspensionExpiresAt: true } },
      },
    });
    const personal = await tx.space.findFirst({
      where: {
        ownerUserId: actor.userId,
        kind: 'PERSONAL',
        accessClosedAt: null,
      },
    });
    const session =
      actor.sessionId &&
      (await tx.authSession.findFirst({
        where: {
          id: actor.sessionId,
          userId: actor.userId,
          expiresAt: { gt: new Date() },
        },
      }));
    if (
      !user?.emailVerified ||
      !session ||
      !personal ||
      (user.settings?.suspendedAt &&
        (!user.settings.suspensionExpiresAt ||
          user.settings.suspensionExpiresAt > new Date()))
    )
      throw new ForbiddenException();
  }
  async event(
    tx: Prisma.TransactionClient,
    customerId: string,
    kind: string,
    reason: string,
    subscriptionId: string | null,
    command?: AdminCommand,
    actor?: RequestActor,
    metadata: Prisma.InputJsonValue = {},
  ) {
    await tx.commerceEvent.create({
      data: {
        customerId,
        kind,
        reason,
        subscriptionId,
        actorAdminId: command?.adminId ?? null,
        actorUserId: actor?.userId ?? null,
        metadata,
      },
    });
  }
  async admin<T extends Prisma.InputJsonValue>(
    command: AdminCommand,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    isolationLevel: Prisma.TransactionIsolationLevel = 'ReadCommitted',
  ) {
    this.privacy.assert();
    const envelope = command.input as {
      id?: string | null;
      input?: { revision?: number };
    };
    const summary = (value: Prisma.InputJsonValue): Prisma.InputJsonValue => {
      const record =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, Prisma.InputJsonValue>)
          : {};
      const result: Record<string, Prisma.InputJsonValue> = {
        operation: command.permission,
      };
      if (envelope.id) result.targetId = envelope.id;
      for (const key of [
        'id',
        'customerId',
        'subscriptionId',
        'productId',
        'versionId',
        'priceId',
        'featureId',
        'revision',
        'currentVersion',
        'state',
        'kind',
        'enforcement',
        'enforced',
        'archived',
      ]) {
        const item = record[key];
        if (
          typeof item === 'string' ||
          typeof item === 'number' ||
          typeof item === 'boolean'
        )
          result[key] = item;
      }
      return result;
    };
    return this.db.client.$transaction(
      (tx) =>
        command.execute(
          tx,
          async () => {
            const result = await work(tx);
            await command.recordChange(
              tx,
              envelope.input?.revision
                ? { revision: envelope.input.revision }
                : null,
              summary(result),
            );
            return json(result) as T;
          },
          summary,
        ),
      { timeout: 20000, isolationLevel },
    );
  }
  async user<T extends Prisma.InputJsonValue>(
    actor: RequestActor,
    id: string,
    operation: string,
    key: string,
    input: Prisma.InputJsonValue,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    if (!/^[!-~]{1,128}$/.test(key))
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    return this.db.client.$transaction(
      async (tx) => {
        await this.identity(tx, actor);
        const customer = await this.customer(tx, id, actor, true);
        const context = await commerceScope(
          tx,
          customer.scopeId ?? customer.spaceId!,
          actor,
          this.kernel,
        );
        if (!context.owner)
          throw new ForbiddenException({ code: 'BILLING_OWNER_REQUIRED' });
        const hash = (v: string) =>
            createHash('sha256').update(v).digest('hex'),
          keyHash = hash(key),
          fingerprint = hash(JSON.stringify({ id, input }));
        await commerceLock(tx, actor.userId + ':' + operation + ':' + keyHash);
        const prior = await tx.commerceReceipt.findUnique({
          where: {
            userId_operation_keyHash: {
              userId: actor.userId,
              operation,
              keyHash,
            },
          },
        });
        if (prior) {
          if (prior.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT');
          return prior.result as T;
        }
        const result = await work(tx);
        await tx.commerceReceipt.create({
          data: {
            userId: actor.userId,
            customerId: id,
            operation,
            keyHash,
            fingerprint,
            result: json(result),
          },
        });
        return result;
      },
      { timeout: 20000 },
    );
  }
}
