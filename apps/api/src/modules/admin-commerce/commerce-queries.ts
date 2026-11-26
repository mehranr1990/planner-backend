import { CatalogService } from './catalog.service.js';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ordinaryCommerceRoutes } from '@mehran/api-contracts';
import type { RequestActor } from '../../platform/auth/request-actor.js';
import { commerceScope } from '../spaces/public/commerce-context.js';
import {
  CommerceCore,
  json,
  page,
  pageWhere,
  match,
  fail,
} from './commerce-core.js';
import { resolveEntitlements } from './public/entitlements.js';
import {
  subscriptionView,
  SubscriptionsService,
} from './subscriptions.service.js';
import { BillingService } from './billing.service.js';
type Route = keyof typeof ordinaryCommerceRoutes;
@Injectable()
export class CommerceQueries {
  constructor(
    @Inject(CommerceCore) readonly core: CommerceCore,
    @Inject(CatalogService) readonly catalog: CatalogService,
    @Inject(BillingService) readonly billing: BillingService,
    @Inject(SubscriptionsService) readonly subscriptions: SubscriptionsService,
  ) {}
  async handle(
    route: Route,
    id: string,
    input: unknown,
    actor: RequestActor,
    key: string,
  ) {
    if (
      route === 'POST commerce/subscriptions/:id/cancel' ||
      route === 'POST commerce/subscriptions/:id/renew'
    ) {
      const initial = await this.core.db.client.commerceSubscription.findUnique(
        { where: { id } },
      );
      if (!initial) throw new NotFoundException();
      return this.core.user(
        actor,
        initial.customerId,
        route,
        key,
        json({ id, input }),
        async (tx) => {
          const s = await tx.commerceSubscription.findUniqueOrThrow({
            where: { id },
          });
          if (route === 'POST commerce/subscriptions/:id/cancel') {
            const b = ordinaryCommerceRoutes[route].schema.parse(input);
            match(s.revision, b.revision);
            const row = await tx.commerceSubscription.update({
              where: { id, revision: b.revision },
              data: {
                cancelAtEnd: true,
                scheduledPriceId: null,
                scheduledOrigin: null,
                scheduledChange: null,
                revision: { increment: 1 },
                nextAt: new Date(),
              },
            });
            await this.core.event(
              tx,
              s.customerId,
              'CUSTOMER_CANCELED',
              'Customer stopped future renewal',
              s.id,
              undefined,
              actor,
            );
            return json(subscriptionView(row));
          }
          const b = ordinaryCommerceRoutes[route].schema.parse(input);
          match(s.revision, b.revision);
          if (s.state === 'PAUSED' || !s.endsAt) fail('INVALID_RENEWAL_STATE');
          const { price, product } = await this.subscriptions.price(
            tx,
            s.customerId,
            b.priceId,
            false,
          );
          if (
            product.id !== s.productId ||
            !price.termDays ||
            price.complimentary ||
            price.amount.toString() === '0'
          )
            fail('EXTERNAL_RENEWAL_REQUIRED');
          if (
            s.kind === 'ADDON' &&
            (await this.subscriptions.suppressed(
              tx,
              s.customerId,
              price.versionId,
            ))
          )
            fail('ADDON_RENEWAL_SUPPRESSED');
          if (s.endsAt > new Date() && s.priceId !== price.id)
            fail('RENEWAL_PRICE_CHANGE_AT_TERM_END');
          await this.subscriptions.renewalPrice(
            tx,
            s,
            price,
            s.endsAt > new Date() ? s.endsAt : new Date(),
          );
          if (
            s.renewalPriceId &&
            s.renewalPriceAt &&
            s.renewalPriceAt <= s.endsAt &&
            price.id !== s.renewalPriceId
          )
            fail('RENEWAL_PRICE_POLICY_REQUIRED');
          if (
            await tx.commerceRenewal.findFirst({
              where: { subscriptionId: id, state: 'OPEN' },
            })
          )
            fail('RENEWAL_ALREADY_PENDING');
          let invoice = await this.billing.draft(
            tx,
            s.customerId,
            price.currency,
            price.amount.toString(),
            'Subscription renewal',
            s.id,
            b.promotionCodes,
          );
          invoice = await this.billing.issue(tx, invoice);
          const request = await tx.commerceRenewal.create({
            data: {
              customerId: s.customerId,
              subscriptionId: s.id,
              invoiceId: invoice.id,
              priceId: price.id,
              expectedRevision: s.revision,
              state: 'OPEN',
            },
          });
          await this.core.event(
            tx,
            s.customerId,
            'CUSTOMER_RENEWAL_REQUESTED',
            'Customer requested manual renewal',
            s.id,
            undefined,
            actor,
            { invoiceId: invoice.id },
          );
          return {
            id: request.id,
            state: 'AWAITING_PAYMENT',
            invoiceId: invoice.id,
          };
        },
      );
    }
    return this.core.db.client.$transaction(
      async (tx) => {
        await this.core.identity(tx, actor);
        if (route === 'GET commerce/scopes/:id') {
          const context = await commerceScope(tx, id, actor, this.core.kernel);
          return tx.commerceCustomer.findFirst({
            where: {
              spaceId: context.spaceId,
              scopeId: context.scopeId,
              closedAt: null,
            },
          });
        }
        if (route === 'GET commerce/subscriptions/:id/offer') {
          const sub = await tx.commerceSubscription.findUniqueOrThrow({
            where: { id },
          });
          await this.core.customer(tx, sub.customerId, actor, true);
          return {
            subscription: subscriptionView(sub),
            product: await tx.commerceProduct.findUniqueOrThrow({
              where: { id: sub.productId },
            }),
            price: await tx.commercePrice.findUniqueOrThrow({
              where: { id: sub.priceId },
            }),
            renewalPrice: sub.renewalPriceId
              ? await tx.commercePrice.findUniqueOrThrow({
                  where: { id: sub.renewalPriceId },
                })
              : null,
          };
        }
        const finance = ![
          'GET commerce/customers/:id/entitlements',
          'GET commerce/customers/:id/subscriptions',
          'GET commerce/customers/:id/notices',
        ].includes(route);
        const customer = await this.core.customer(tx, id, actor, finance);
        if (route === 'GET commerce/customers/:id/entitlements')
          return resolveEntitlements(tx, id);
        if (route === 'GET commerce/customers/:id/credit') {
          const b = ordinaryCommerceRoutes[route].schema.parse(input);
          return {
            currency: b.currency,
            available: (
              await this.billing.credit(tx, id, b.currency)
            ).toString(),
          };
        }
        const b =
            ordinaryCommerceRoutes[
              'GET commerce/customers/:id/subscriptions'
            ].schema.parse(input),
          paging = { ...pageWhere(b), customerId: id };
        if (route === 'GET commerce/customers/:id/subscriptions')
          return page(
            (
              await tx.commerceSubscription.findMany({
                where: paging,
                orderBy: { id: 'asc' },
                take: b.limit + 1,
              })
            ).map(subscriptionView),
            b.limit,
          );
        if (route === 'GET commerce/customers/:id/invoices') {
          const rows = await tx.commerceInvoice.findMany({
            where: paging,
            orderBy: { id: 'asc' },
            take: b.limit + 1,
          });
          const views = await Promise.all(
            rows.map(async (r) => {
              const v = await this.billing.invoiceView(tx, r);
              return {
                ...v,
                adjustments: v.adjustments.map((a) => ({
                  ...a,
                  reason:
                    a.kind === 'VOID'
                      ? 'Invoice voided'
                      : a.kind === 'WRITE_OFF'
                        ? 'Debt written off'
                        : 'Invoice corrected',
                })),
              };
            }),
          );
          return page(views, b.limit);
        }
        if (route === 'GET commerce/customers/:id/promotions')
          return page(
            await tx.commercePromotion.findMany({
              where: {
                ...pageWhere(b),
                active: true,
                visibility: 'PUBLIC',
                startsAt: { lte: new Date() },
                endsAt: { gt: new Date() },
                OR: [{ customerId: null }, { customerId: id }],
              },
              orderBy: { id: 'asc' },
              take: b.limit + 1,
            }),
            b.limit,
          );
        if (route === 'GET commerce/customers/:id/refunds') {
          const rows = await tx.commerceRefund.findMany({
            where: paging,
            orderBy: { id: 'asc' },
            take: b.limit + 1,
          });
          return page(
            rows.map((r) => ({ ...r, reason: 'Manual refund recorded' })),
            b.limit,
          );
        }
        if (route === 'GET commerce/customers/:id/payments')
          return page(
            await tx.commercePayment.findMany({
              where: paging,
              orderBy: { id: 'asc' },
              take: b.limit + 1,
            }),
            b.limit,
          );
        if (route === 'GET commerce/customers/:id/terms')
          return page(
            await tx.commerceTerm.findMany({
              where: { ...pageWhere(b), r_subscriptionId: { customerId: id } },
              orderBy: { id: 'asc' },
              take: b.limit + 1,
            }),
            b.limit,
          );
        if (route === 'GET commerce/customers/:id/notices')
          return page(
            await tx.commerceNotice.findMany({
              where: { ...paging, publishedAt: { not: null } },
              orderBy: { id: 'asc' },
              take: b.limit + 1,
            }),
            b.limit,
          );
        if (route === 'GET commerce/customers/:id/catalog') {
          const rows = await tx.commerceProduct.findMany({
            where: {
              ...pageWhere(b),
              archived: false,
              eligibility: { array_contains: [customer.kind] },
              r_CommerceVersion_productId: { some: {} },
              OR: [
                { visibility: 'PUBLIC' },
                {
                  visibility: 'TARGETED',
                  r_CommerceTarget_productId: { some: { customerId: id } },
                },
              ],
            },
            orderBy: { id: 'asc' },
            take: b.limit + 1,
          });
          const items = [];
          for (const product of rows)
            items.push(await this.catalog.offer(tx, product, id));
          return page(items, b.limit);
        }
        throw new NotFoundException();
      },
      { timeout: 20000 },
    );
  }
}
