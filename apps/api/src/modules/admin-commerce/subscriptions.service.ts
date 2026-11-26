import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CommerceAdminRoute } from '@mehran/api-contracts';
import type {
  Prisma,
  CommerceSubscription,
} from '../../generated/prisma/client.js';
import type { AdminCommand } from '../../platform/admin/admin-command.js';
import { commerceScope } from '../spaces/public/commerce-context.js';
import {
  CommerceCore,
  json,
  match,
  page,
  pageWhere,
  fail,
} from './commerce-core.js';
import { parse } from './catalog.service.js';
import {
  dayMs,
  effectiveSubscription,
  minor,
  unusedCredit,
} from './domain/commercial-policy.js';
import { FinancialLedger } from './financial-ledger.js';
import { termWindow } from './domain/term-clock.js';
export const subscriptionView = (s: CommerceSubscription) => ({
  ...s,
  effectiveState: effectiveSubscription(s),
});
@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(CommerceCore) readonly core: CommerceCore,
    @Inject(FinancialLedger) readonly ledger: FinancialLedger,
  ) {}
  async price(
    tx: Prisma.TransactionClient,
    customerId: string,
    priceId: string,
    newPurchase = true,
  ) {
    const customer = await this.core.customer(tx, customerId);
    if (customer.closedAt || !customer.spaceId) fail('CUSTOMER_CLOSED');
    const scope = await commerceScope(tx, customer.scopeId ?? customer.spaceId);
    if (scope.spaceId !== customer.spaceId) fail('CUSTOMER_SCOPE_CHANGED');
    const price = await tx.commercePrice.findUniqueOrThrow({
      where: { id: priceId },
      include: {
        r_versionId: {
          include: {
            r_productId: { include: { r_CommerceTarget_productId: true } },
            r_CommerceAllowance_versionId: true,
          },
        },
      },
    });
    const product = price.r_versionId.r_productId;
    if (
      !price.active ||
      (newPurchase && product.archived) ||
      (price.customerId && price.customerId !== customerId) ||
      !(product.eligibility as string[]).includes(customer.kind) ||
      (product.visibility === 'TARGETED' &&
        !product.r_CommerceTarget_productId.some(
          (t) => t.customerId === customerId,
        ))
    )
      fail('PRICE_NOT_ELIGIBLE');
    if (newPurchase) {
      const latest = await tx.commerceVersion.findFirstOrThrow({
        where: { productId: product.id },
        orderBy: { version: 'desc' },
      });
      if (latest.id !== price.versionId) fail('CURRENT_OFFER_VERSION_REQUIRED');
    }
    return { price, product, customer };
  }
  async suppressed(
    tx: Prisma.TransactionClient,
    customerId: string,
    versionId: string,
  ) {
    const base = await tx.commerceSubscription.findFirst({
      where: { customerId, kind: 'PLAN', state: { in: ['ACTIVE', 'GRACE'] } },
      include: {
        r_versionId: { include: { r_CommerceAllowance_versionId: true } },
      },
    });
    if (!base || !['ACTIVE', 'GRACE'].includes(effectiveSubscription(base)))
      return false;
    const addon = await tx.commerceAllowance.findMany({
      where: { versionId },
      include: { r_featureId: true },
    });
    return (
      addon.length > 0 &&
      addon.every(
        (a) =>
          a.r_featureId.kind === 'BOOLEAN' &&
          (base.r_versionId.r_CommerceAllowance_versionId.find(
            (b) => b.featureId === a.featureId,
          )?.value ?? 0n) >= a.value,
      )
    );
  }
  origin(
    price: { complimentary: boolean; amount: { toString(): string } },
    origin: string,
  ) {
    if (
      origin === 'EXTERNAL' &&
      (price.complimentary || minor(price.amount) === 0n)
    )
      fail('EXTERNAL_PRICE_REQUIRED');
  }
  async term(tx: Prisma.TransactionClient, s: CommerceSubscription) {
    const price = await tx.commercePrice.findUniqueOrThrow({
      where: { id: s.priceId },
    });
    return tx.commerceTerm.create({
      data: {
        subscriptionId: s.id,
        versionId: s.versionId,
        priceId: s.priceId,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        currency: price.currency,
        amount: s.origin === 'COMPLIMENTARY' ? '0' : price.amount,
        origin: s.origin,
      },
    });
  }
  async renew(
    tx: Prisma.TransactionClient,
    s: CommerceSubscription,
    priceId: string,
    origin: string,
    reason: string,
    command?: AdminCommand,
  ) {
    const { price, product } = await this.price(
      tx,
      s.customerId,
      priceId,
      false,
    );
    if (
      product.id !== s.productId ||
      !price.termDays ||
      s.state === 'PAUSED' ||
      s.endsAt === null
    )
      fail('INVALID_RENEWAL');
    const versionId = priceId === s.priceId ? s.versionId : price.versionId;
    if (
      s.kind === 'ADDON' &&
      (await this.suppressed(tx, s.customerId, versionId))
    )
      fail('ADDON_RENEWAL_SUPPRESSED');
    this.origin(price, origin);
    const now = new Date(),
      start = s.endsAt > now ? s.endsAt : now;
    await this.renewalPrice(tx, s, price, start);
    if (
      s.renewalPriceId &&
      s.renewalPriceAt &&
      s.renewalPriceAt <= start &&
      priceId !== s.renewalPriceId
    )
      fail('RENEWAL_PRICE_POLICY_REQUIRED');
    if (start > now && priceId !== s.priceId)
      fail('RENEWAL_PRICE_CHANGE_AT_TERM_END');
    const row = await tx.commerceSubscription.update({
      where: { id: s.id, revision: s.revision },
      data: {
        priceId,
        versionId,
        startsAt: start > now ? s.startsAt : start,
        endsAt: new Date(start.getTime() + price.termDays * dayMs),
        state: s.startsAt > now ? 'SCHEDULED' : 'ACTIVE',
        origin,
        cancelAtEnd: false,
        scheduledPriceId: null,
        scheduledOrigin: null,
        scheduledChange: null,
        revision: { increment: 1 },
        nextAt: start,
      },
    });
    await this.term(tx, { ...row, startsAt: start });
    await this.core.event(
      tx,
      s.customerId,
      'SUBSCRIPTION_RENEWED',
      reason,
      s.id,
      command,
    );
    return row;
  }
  async renewalPrice(
    tx: Prisma.TransactionClient,
    s: CommerceSubscription,
    price: { id: string; currency: string; amount: { toString(): string } },
    start: Date,
  ) {
    const prior = await tx.commercePrice.findUniqueOrThrow({
      where: { id: s.priceId },
    });
    if (prior.currency !== price.currency) fail('CROSS_CURRENCY_RENEWAL');
    if (
      minor(price.amount) > minor(prior.amount) &&
      (!s.renewalPriceId ||
        s.renewalPriceId !== price.id ||
        !s.renewalPriceAt ||
        s.renewalPriceAt > start)
    )
      fail('RENEWAL_PRICE_POLICY_REQUIRED');
  }
  async change(
    tx: Prisma.TransactionClient,
    s: CommerceSubscription,
    priceId: string,
    origin: string,
    credit: boolean,
    reason: string,
    command?: AdminCommand,
    effectiveAt?: Date,
  ) {
    const { price, product } = await this.price(tx, s.customerId, priceId);
    if (
      product.kind !== s.kind ||
      (effectiveAt
        ? s.scheduledPriceId !== priceId ||
          s.scheduledChange !== 'TERM_END' ||
          s.endsAt?.getTime() !== effectiveAt.getTime() ||
          s.state === 'CANCELED' ||
          s.state === 'PAUSED'
        : !['ACTIVE', 'GRACE'].includes(effectiveSubscription(s)))
    )
      fail('INVALID_PLAN_CHANGE');
    this.origin(price, origin);
    const now = effectiveAt ?? new Date();
    const terms = await tx.commerceTerm.findMany({
      where: { subscriptionId: s.id, closure: null },
      include: { shifts: true, closure: true },
      orderBy: { startsAt: 'asc' },
    });
    for (const term of terms) {
      const window = termWindow(term);
      if (window.endsAt && window.endsAt <= now) continue;
      if (credit) {
        if (term.currency !== price.currency)
          fail('CROSS_CURRENCY_CHANGE_CREDIT');
        const calculated =
          now < window.startsAt
            ? minor(term.amount)
            : unusedCredit(
                minor(term.amount),
                window.startsAt,
                window.endsAt,
                now,
              );
        if (calculated > 0n)
          await this.ledger.grantCredit(
            tx,
            s.customerId,
            term.currency,
            calculated,
            'term-credit:' + term.id,
            { termId: term.id },
            null,
            s.id,
          );
      }
      await tx.commerceTermClosure.create({
        data: { termId: term.id, endedAt: now, kind: 'CHANGE' },
      });
    }

    const row = await tx.commerceSubscription.update({
      where: { id: s.id, revision: s.revision },
      data: {
        productId: product.id,
        versionId: price.versionId,
        priceId: price.id,
        startsAt: now,
        endsAt: price.termDays
          ? new Date(now.getTime() + price.termDays * dayMs)
          : null,
        origin,
        state: effectiveSubscription({
          ...s,
          state: 'ACTIVE',
          startsAt: now,
          endsAt: price.termDays
            ? new Date(now.getTime() + price.termDays * dayMs)
            : null,
          cancelAtEnd: false,
        }),
        cancelAtEnd: false,
        scheduledPriceId: null,
        scheduledOrigin: null,
        scheduledChange: null,
        revision: { increment: 1 },
        nextAt: new Date(),
      },
    });
    await this.term(tx, row);
    await this.core.event(
      tx,
      s.customerId,
      'SUBSCRIPTION_CHANGED',
      reason,
      s.id,
      command,
      undefined,
      { fromProductId: s.productId, toProductId: product.id, credit },
    );
    return row;
  }
  async handle(
    route: CommerceAdminRoute,
    id: string | undefined,
    input: unknown,
    command: AdminCommand,
  ) {
    return this.core.admin(command, async (tx) =>
      json(await this.run(tx, route, id ?? '', input, command)),
    );
  }
  async run(
    tx: Prisma.TransactionClient,
    route: CommerceAdminRoute,
    id: string,
    input: unknown,
    command: AdminCommand,
  ): Promise<unknown> {
    if (route === 'GET commerce/customers/:id/subscriptions') {
      const b = parse(route, input);
      await this.core.customer(tx, id!);
      return page(
        (
          await tx.commerceSubscription.findMany({
            where: { customerId: id, ...pageWhere(b) },
            orderBy: { id: 'asc' },
            take: b.limit + 1,
          })
        ).map(subscriptionView),
        b.limit,
      );
    }
    if (route === 'GET commerce/subscriptions/:id/terms') {
      const b = parse(route, input),
        s = await tx.commerceSubscription.findUniqueOrThrow({ where: { id } });
      await this.core.customer(tx, s.customerId);
      return page(
        await tx.commerceTerm.findMany({
          where: { subscriptionId: id, ...pageWhere(b) },
          orderBy: { id: 'asc' },
          take: b.limit + 1,
        }),
        b.limit,
      );
    }
    if (route === 'POST commerce/customers/:id/subscriptions') {
      const b = parse(route, input),
        { price, product } = await this.price(tx, id!, b.priceId);
      this.origin(price, b.origin);
      const startsAt = new Date(b.startsAt),
        now = new Date();
      if (
        startsAt.getTime() < now.getTime() - 60000 ||
        startsAt.getTime() > now.getTime() + 3650 * dayMs
      )
        fail('INVALID_ACTIVATION_TIME');
      const prior = await tx.commerceSubscription.findMany({
        where: {
          customerId: id,
          kind: product.kind,
          ...(product.kind === 'ADDON' ? { productId: product.id } : {}),
        },
      });
      for (const old of prior) {
        const state = effectiveSubscription(old);
        if (['EXPIRED', 'CANCELED'].includes(state) && old.state !== state)
          await tx.commerceSubscription.update({
            where: { id: old.id },
            data: {
              state,
              pausedAt: null,
              pauseClock: null,
              revision: { increment: 1 },
            },
          });
        else if (!['EXPIRED', 'CANCELED'].includes(state))
          fail('ACTIVE_SUBSCRIPTION_EXISTS');
      }
      if (
        product.kind === 'ADDON' &&
        b.origin === 'EXTERNAL' &&
        (await this.suppressed(tx, id!, price.versionId))
      )
        fail('ADDON_RENEWAL_SUPPRESSED');
      const policy = await tx.commercePolicy.findUniqueOrThrow({
          where: { id: 'GLOBAL' },
        }),
        endsAt =
          b.nonExpiring || !price.termDays
            ? null
            : new Date(startsAt.getTime() + price.termDays * dayMs);
      const row = await tx.commerceSubscription.create({
        data: {
          customerId: id!,
          productId: product.id,
          versionId: price.versionId,
          priceId: price.id,
          kind: product.kind,
          state: startsAt > now ? 'SCHEDULED' : 'ACTIVE',
          origin: b.origin,
          startsAt,
          endsAt,
          renewal: b.renewal,
          graceDays: policy.graceDays,
          graceWritable: policy.graceWritable,
          nextAt: startsAt > now ? startsAt : now,
        },
      });
      await this.term(tx, row);
      await this.core.event(
        tx,
        id!,
        'SUBSCRIPTION_GRANTED',
        b.reason,
        row.id,
        command,
      );
      return subscriptionView(row);
    }
    const initial = await tx.commerceSubscription.findUnique({ where: { id } });
    if (!initial) throw new NotFoundException();
    await this.core.customer(tx, initial.customerId);
    const s = await tx.commerceSubscription.findUniqueOrThrow({
      where: { id },
    });
    if (route === 'POST commerce/subscriptions/:id/renew') {
      const b = parse(route, input);
      match(s.revision, b.revision);
      return subscriptionView(
        await this.renew(tx, s, b.priceId, b.origin, b.reason, command),
      );
    }
    if (route === 'POST commerce/subscriptions/:id/change') {
      const b = parse(route, input);
      match(s.revision, b.revision);
      if (s.kind !== 'PLAN') fail('BASE_PLAN_CHANGE_ONLY');
      if (b.mode !== 'TERM_END')
        return subscriptionView(
          await this.change(
            tx,
            s,
            b.priceId,
            b.origin,
            b.mode === 'IMMEDIATE_CREDIT',
            b.reason,
            command,
          ),
        );
      if (!s.endsAt || s.endsAt <= new Date() || s.state === 'PAUSED')
        fail('TERM_END_REQUIRED');
      const { price, product } = await this.price(tx, s.customerId, b.priceId);
      if (product.kind !== 'PLAN') fail('BASE_PLAN_REQUIRED');
      this.origin(price, b.origin);
      const row = await tx.commerceSubscription.update({
        where: { id, revision: b.revision },
        data: {
          scheduledPriceId: b.priceId,
          scheduledOrigin: b.origin,
          scheduledChange: 'TERM_END',
          cancelAtEnd: false,
          nextAt: s.endsAt,
          revision: { increment: 1 },
        },
      });
      await this.core.event(
        tx,
        s.customerId,
        'PLAN_CHANGE_SCHEDULED',
        b.reason,
        s.id,
        command,
      );
      return subscriptionView(row);
    }
    if (route === 'POST commerce/subscriptions/:id/cancel') {
      const b = parse(route, input);
      match(s.revision, b.revision);
      if (s.state === 'CANCELED') fail('ALREADY_CANCELED');
      if (b.immediate) {
        const terms = await tx.commerceTerm.findMany({
          where: { subscriptionId: s.id, closure: null },
          select: { id: true },
        });
        for (const term of terms)
          await tx.commerceTermClosure.create({
            data: { termId: term.id, endedAt: new Date(), kind: 'CANCEL' },
          });
      }
      const row = await tx.commerceSubscription.update({
        where: { id, revision: b.revision },
        data: {
          state: b.immediate ? 'CANCELED' : s.state,
          cancelAtEnd: true,
          scheduledPriceId: null,
          scheduledOrigin: null,
          scheduledChange: null,
          ...(b.immediate ? { pausedAt: null, pauseClock: null } : {}),
          revision: { increment: 1 },
          nextAt: new Date(),
        },
      });
      await this.core.event(
        tx,
        s.customerId,
        'SUBSCRIPTION_CANCELED',
        b.reason,
        s.id,
        command,
      );
      return subscriptionView(row);
    }
    if (route === 'POST commerce/subscriptions/:id/pause') {
      const b = parse(route, input);
      match(s.revision, b.revision);
      if (!['ACTIVE', 'GRACE'].includes(effectiveSubscription(s)))
        fail('INVALID_PAUSE_STATE');
      const row = await tx.commerceSubscription.update({
        where: { id, revision: b.revision },
        data: {
          state: 'PAUSED',
          pausedAt: new Date(),
          pauseClock: b.clock,
          revision: { increment: 1 },
          nextAt: new Date(),
        },
      });
      await this.core.event(
        tx,
        s.customerId,
        'SUBSCRIPTION_PAUSED',
        b.reason,
        s.id,
        command,
        undefined,
        { clock: b.clock },
      );
      return subscriptionView(row);
    }
    if (route === 'POST commerce/subscriptions/:id/reactivate') {
      const b = parse(route, input);
      match(s.revision, b.revision);
      const now = new Date();
      if (s.state === 'PAUSED') {
        if (s.pauseClock === 'FREEZE') {
          const extension = BigInt(now.getTime() - s.pausedAt!.getTime());
          const terms = await tx.commerceTerm.findMany({
            where: { subscriptionId: s.id, closure: null },
            include: { shifts: true, closure: true },
          });
          for (const term of terms) {
            const window = termWindow(term);
            if (!window.endsAt || window.endsAt > s.pausedAt!) {
              await tx.commerceTermShift.create({
                data: {
                  termId: term.id,
                  startShiftMs: window.startsAt >= s.pausedAt! ? extension : 0n,
                  endShiftMs: extension,
                  sourceKey: 'pause:' + s.id + ':' + s.revision + ':' + term.id,
                },
              });
            }
          }
        }
        const endsAt =
          s.endsAt && s.pauseClock === 'FREEZE'
            ? new Date(
                s.endsAt.getTime() + now.getTime() - s.pausedAt!.getTime(),
              )
            : s.endsAt;
        const state = effectiveSubscription(
          { ...s, state: 'ACTIVE', pausedAt: null, pauseClock: null, endsAt },
          now,
        );
        const row = await tx.commerceSubscription.update({
          where: { id, revision: b.revision },
          data: {
            state,
            pausedAt: null,
            pauseClock: null,
            endsAt,
            revision: { increment: 1 },
            nextAt: now,
          },
        });
        await this.core.event(
          tx,
          s.customerId,
          'SUBSCRIPTION_RESUMED',
          b.reason,
          s.id,
          command,
          undefined,
          {
            clock: s.pauseClock,
            resumedAt: now.toISOString(),
            extensionMs:
              s.pauseClock === 'FREEZE'
                ? String(now.getTime() - s.pausedAt!.getTime())
                : '0',
          },
        );
        return subscriptionView(row);
      }
      if ((s.endsAt && s.endsAt <= now) || !s.cancelAtEnd)
        fail('RENEWAL_REQUIRED');
      const row = await tx.commerceSubscription.update({
        where: { id, revision: b.revision },
        data: {
          state: s.startsAt > now ? 'SCHEDULED' : 'ACTIVE',
          cancelAtEnd: false,
          revision: { increment: 1 },
          nextAt: now,
        },
      });
      if (s.state === 'CANCELED')
        await this.term(tx, { ...row, startsAt: now });
      await this.core.event(
        tx,
        s.customerId,
        'SUBSCRIPTION_REACTIVATED',
        b.reason,
        s.id,
        command,
      );
      return subscriptionView(row);
    }
    if (route === 'POST commerce/subscriptions/:id/renewal-price') {
      const b = parse(route, input);
      match(s.revision, b.revision);
      const { price, product } = await this.price(
          tx,
          s.customerId,
          b.priceId,
          false,
        ),
        effectiveAt = new Date(b.effectiveAt);
      if (
        product.id !== s.productId ||
        !s.endsAt ||
        effectiveAt < new Date(Date.now() + dayMs) ||
        price.currency !==
          (
            await tx.commercePrice.findUniqueOrThrow({
              where: { id: s.priceId },
            })
          ).currency
      )
        fail('INVALID_RENEWAL_PRICE_NOTICE');
      const row = await tx.commerceSubscription.update({
        where: { id, revision: b.revision },
        data: {
          renewalPriceId: price.id,
          renewalPriceAt: effectiveAt,
          revision: { increment: 1 },
        },
      });
      await tx.commerceNotice.create({
        data: {
          customerId: s.customerId,
          subscriptionId: s.id,
          key: 'renewal-price:' + s.id + ':' + row.revision,
          kind: 'RENEWAL_PRICE_CHANGED',
          dueAt: new Date(),
          publishedAt: new Date(),
        },
      });
      await this.core.event(
        tx,
        s.customerId,
        'RENEWAL_PRICE_SCHEDULED',
        b.reason,
        s.id,
        command,
        undefined,
        { priceId: price.id, effectiveAt: b.effectiveAt },
      );
      return subscriptionView(row);
    }
    throw new NotFoundException();
  }
}
