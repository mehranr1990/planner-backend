import { termWindow } from './domain/term-clock.js';
import { FinancialLedger } from './financial-ledger.js';
import {
  Inject,
  Injectable,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CommerceAdminRoute } from '@mehran/api-contracts';
import type { Prisma, CommerceInvoice } from '../../generated/prisma/client.js';
import type { AdminCommand } from '../../platform/admin/admin-command.js';
import { assertBillingEvidence } from '../../platform/storage/public/billing-evidence.js';
import {
  CommerceCore,
  json,
  match,
  page,
  pageWhere,
  fail,
  currency,
} from './commerce-core.js';
import { parse } from './catalog.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { commerceLock } from './public/entitlements.js';
import {
  minor,
  bounded,
  percent,
  dayMs,
  effectiveSubscription,
} from './domain/commercial-policy.js';
const balanceKinds = [
  'CHARGE',
  'ADJUSTMENT',
  'PAYMENT',
  'CREDIT_APPLY',
  'CREDIT_TRANSFER',
  'WRITE_OFF',
];
const creditKinds = ['CREDIT_GRANT', 'CREDIT_APPLY', 'CREDIT_REFUND'];
@Injectable()
export class BillingService extends FinancialLedger {
  constructor(
    @Inject(CommerceCore) readonly core: CommerceCore,
    @Inject(SubscriptionsService) readonly subscriptions: SubscriptionsService,
  ) {
    super();
  }
  async invoiceView(tx: Prisma.TransactionClient, row: CommerceInvoice) {
    return {
      ...row,
      outstanding: (await this.balance(tx, row.id)).toString(),
      versions: await tx.commerceInvoiceVersion.findMany({
        where: { invoiceId: row.id },
        orderBy: { version: 'asc' },
      }),
      adjustments: await tx.commerceAdjustment.findMany({
        where: { invoiceId: row.id },
        orderBy: { createdAt: 'asc' },
      }),
    };
  }
  async calculate(
    tx: Prisma.TransactionClient,
    customerId: string,
    invoiceId: string,
    currency: string,
    subtotal: bigint,
    codes: string[],
    subscriptionId: string | null,
  ) {
    const policy = await tx.commercePolicy.findUniqueOrThrow({
        where: { id: 'GLOBAL' },
      }),
      promotions = [];
    if (new Set(codes.map((c) => c.toUpperCase())).size !== codes.length)
      fail('DUPLICATE_PROMOTION');
    let discounted = subtotal;
    for (const code of [...codes].map((c) => c.toUpperCase()).sort()) {
      await commerceLock(tx, 'promotion:' + code);
      const p = await tx.commercePromotion.findUnique({ where: { code } });
      if (!p) fail('PROMOTION_UNAVAILABLE');
      const prior = await tx.commerceRedemption.findFirst({
          where: { promotionId: p.id, invoiceId },
        }),
        now = new Date();
      if (!prior && (!p.active || p.startsAt > now || p.endsAt <= now))
        fail('PROMOTION_UNAVAILABLE');
      if (
        (p.customerId && p.customerId !== customerId) ||
        (p.currency && p.currency !== currency) ||
        (codes.length > 1 && !p.combinable)
      )
        fail('PROMOTION_NOT_ELIGIBLE');
      if (
        p.productId &&
        (!subscriptionId ||
          !(await tx.commerceSubscription.findFirst({
            where: { id: subscriptionId, customerId, productId: p.productId },
          })))
      )
        fail('PROMOTION_NOT_ELIGIBLE');
      if (
        !prior &&
        ((await tx.commerceRedemption.count({
          where: { promotionId: p.id },
        })) >= p.maxUses ||
          (await tx.commerceRedemption.count({
            where: { promotionId: p.id, customerId },
          })) >= p.perCustomer)
      )
        fail('PROMOTION_LIMIT');
      const proposed =
          p.kind === 'PERCENT'
            ? percent(discounted, Number(p.amount))
            : minor(p.amount),
        deduction = proposed < discounted ? proposed : discounted;
      discounted -= deduction;
      promotions.push({
        id: p.id,
        amount: deduction.toString(),
        existing: !!prior,
      });
    }
    const tax = percent(discounted, policy.taxBps),
      fee = percent(discounted, policy.feeBps);
    if (discounted + tax + fee >= 10n ** 24n) fail('FINANCIAL_AMOUNT_RANGE');
    return {
      subtotal: bounded(subtotal),
      discount: bounded(subtotal - discounted),
      tax: bounded(tax),
      fee: bounded(fee),
      total: bounded(discounted + tax + fee),
      calculation: json({
        taxBps: policy.taxBps,
        feeBps: policy.feeBps,
        promotions,
      }),
      promotions,
    };
  }
  async draft(
    tx: Prisma.TransactionClient,
    customerId: string,
    currencyCode: string,
    subtotal: string,
    description: string,
    subscriptionId: string | null,
    codes: string[] = [],
  ) {
    currency(currencyCode);
    await this.core.customer(tx, customerId);
    if (
      subscriptionId &&
      !(await tx.commerceSubscription.findFirst({
        where: { id: subscriptionId, customerId },
      }))
    )
      fail('FOREIGN_SUBSCRIPTION');
    const row = await tx.commerceInvoice.create({
      data: {
        customerId,
        subscriptionId,
        number: 'INV-' + randomUUID(),
        currency: currencyCode,
        state: 'DRAFT',
      },
    });
    const calc = await this.calculate(
        tx,
        customerId,
        row.id,
        currencyCode,
        minor(subtotal),
        codes,
        subscriptionId,
      ),
      { promotions, ...amounts } = calc;
    const version = await tx.commerceInvoiceVersion.create({
      data: { invoiceId: row.id, version: 1, description, ...amounts },
    });
    for (const p of promotions)
      if (!p.existing)
        await tx.commerceRedemption.create({
          data: {
            promotionId: p.id,
            customerId,
            invoiceId: row.id,
            versionId: version.id,
            amount: p.amount,
          },
        });
    return row;
  }
  async issue(tx: Prisma.TransactionClient, invoice: CommerceInvoice) {
    if (invoice.state !== 'DRAFT') fail('INVOICE_NOT_DRAFT');
    const v = await tx.commerceInvoiceVersion.findUniqueOrThrow({
      where: {
        invoiceId_version: {
          invoiceId: invoice.id,
          version: invoice.currentVersion,
        },
      },
    });
    await this.entry(tx, {
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      subscriptionId: invoice.subscriptionId,
      currency: invoice.currency,
      amount: minor(v.total),
      kind: 'CHARGE',
      sourceKey: 'invoice:' + invoice.id,
    });
    return tx.commerceInvoice.update({
      where: { id: invoice.id, revision: invoice.revision },
      data: {
        state: minor(v.total) === 0n ? 'PAID' : 'ISSUED',
        issuedAt: new Date(),
        revision: { increment: 1 },
      },
    });
  }
  async settleState(tx: Prisma.TransactionClient, invoiceId: string) {
    const balance = await this.balance(tx, invoiceId);
    return tx.commerceInvoice.update({
      where: { id: invoiceId },
      data: {
        state: balance === 0n ? 'PAID' : 'ISSUED',
        revision: { increment: 1 },
      },
    });
  }
  async correction(
    tx: Prisma.TransactionClient,
    invoice: CommerceInvoice,
    subtotal: string,
    description: string,
    codes: string[],
    reason: string,
    kind: 'CORRECTION' | 'VOID' | 'WRITE_OFF' = 'CORRECTION',
  ) {
    if (invoice.state === 'VOIDED') fail('INVOICE_VOIDED');
    const previous = await tx.commerceInvoiceVersion.findUniqueOrThrow({
      where: {
        invoiceId_version: {
          invoiceId: invoice.id,
          version: invoice.currentVersion,
        },
      },
    });
    const calc =
      kind === 'CORRECTION'
        ? await this.calculate(
            tx,
            invoice.customerId,
            invoice.id,
            invoice.currency,
            minor(subtotal),
            codes,
            invoice.subscriptionId,
          )
        : {
            subtotal,
            discount: '0',
            tax: '0',
            fee: '0',
            total: subtotal,
            calculation: json({ kind }),
            promotions: [],
          };
    const { promotions, ...values } = calc;
    const version = await tx.commerceInvoiceVersion.create({
      data: {
        invoiceId: invoice.id,
        version: invoice.currentVersion + 1,
        description,
        ...values,
      },
    });
    for (const p of promotions)
      if (!p.existing)
        await tx.commerceRedemption.create({
          data: {
            promotionId: p.id,
            customerId: invoice.customerId,
            invoiceId: invoice.id,
            versionId: version.id,
            amount: p.amount,
          },
        });
    if (invoice.issuedAt) {
      const delta = minor(values.total) - minor(previous.total);
      const adjustment = await tx.commerceAdjustment.create({
        data: {
          invoiceId: invoice.id,
          versionId: version.id,
          currency: invoice.currency,
          amount: bounded(delta),
          kind,
          reason,
        },
      });
      await this.entry(tx, {
        customerId: invoice.customerId,
        invoiceId: invoice.id,
        subscriptionId: invoice.subscriptionId,
        adjustmentId: adjustment.id,
        currency: invoice.currency,
        amount: delta,
        kind: kind === 'WRITE_OFF' ? 'WRITE_OFF' : 'ADJUSTMENT',
        sourceKey: 'adjustment:' + adjustment.id,
      });
      const raw = await this.sum(tx, {
        invoiceId: invoice.id,
        kind: { in: balanceKinds },
      });
      if (raw < 0n) {
        await this.grantCredit(
          tx,
          invoice.customerId,
          invoice.currency,
          -raw,
          'invoice-credit:' + version.id,
          { invoiceId: invoice.id },
          invoice.id,
          invoice.subscriptionId,
        );
        await this.entry(tx, {
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          adjustmentId: adjustment.id,
          currency: invoice.currency,
          amount: -raw,
          kind: 'CREDIT_TRANSFER',
          sourceKey: 'invoice-credit-transfer:' + version.id,
        });
      }
    }
    const row = await tx.commerceInvoice.update({
      where: { id: invoice.id, revision: invoice.revision },
      data: {
        currentVersion: version.version,
        revision: { increment: 1 },
        state:
          kind === 'VOID'
            ? 'VOIDED'
            : invoice.issuedAt
              ? (await this.balance(tx, invoice.id)) === 0n
                ? 'PAID'
                : 'ISSUED'
              : 'DRAFT',
      },
    });
    return row;
  }
  async handle(
    route: CommerceAdminRoute,
    id: string | undefined,
    input: unknown,
    command: AdminCommand,
  ) {
    return this.core.admin(
      command,
      async (tx) => json(await this.run(tx, route, id ?? '', input, command)),
      route === 'GET commerce/reports' ? 'RepeatableRead' : 'ReadCommitted',
    );
  }
  async run(
    tx: Prisma.TransactionClient,
    route: CommerceAdminRoute,
    id: string,
    input: unknown,
    command: AdminCommand,
  ): Promise<unknown> {
    if (route === 'GET commerce/methods') {
      const b = parse(route, input);
      return page(
        await tx.commerceMethod.findMany({
          where: pageWhere(b),
          orderBy: { id: 'asc' },
          take: b.limit + 1,
        }),
        b.limit,
      );
    }
    if (route === 'POST commerce/methods') {
      const b = parse(route, input);
      if (b.kind === 'FUTURE_PROVIDER' && b.active)
        fail('ONLINE_PAYMENT_DISABLED');
      const { reason: _, ...data } = b;
      return tx.commerceMethod.create({ data });
    }
    if (route === 'POST commerce/methods/:id') {
      const b = parse(route, input),
        m = await tx.commerceMethod.findUniqueOrThrow({ where: { id } });
      match(m.revision, b.revision);
      if (m.kind === 'FUTURE_PROVIDER' && b.active)
        fail('ONLINE_PAYMENT_DISABLED');
      return tx.commerceMethod.update({
        where: { id, revision: b.revision },
        data: { active: b.active, revision: { increment: 1 } },
      });
    }
    if (route === 'GET commerce/customers/:id/invoices') {
      const b = parse(route, input);
      await this.core.customer(tx, id!);
      const rows = await tx.commerceInvoice.findMany({
        where: { customerId: id, ...pageWhere(b) },
        orderBy: { id: 'asc' },
        take: b.limit + 1,
      });
      return page(
        await Promise.all(rows.map((r) => this.invoiceView(tx, r))),
        b.limit,
      );
    }
    if (route === 'POST commerce/customers/:id/invoices') {
      const b = parse(route, input);
      const row = await this.draft(
        tx,
        id!,
        b.currency,
        b.subtotal,
        b.description,
        b.subscriptionId,
        b.promotionCodes,
      );
      await this.core.event(
        tx,
        id!,
        'INVOICE_DRAFTED',
        b.reason,
        b.subscriptionId,
        command,
        undefined,
        { invoiceId: row.id },
      );
      return this.invoiceView(tx, row);
    }
    if (
      route === 'POST commerce/invoices/:id/issue' ||
      route === 'POST commerce/invoices/:id/correct' ||
      route === 'POST commerce/invoices/:id/void' ||
      route === 'POST commerce/invoices/:id/apply-credit' ||
      route === 'POST commerce/invoices/:id/write-off'
    ) {
      const b = parse(route, input),
        initial = await tx.commerceInvoice.findUniqueOrThrow({ where: { id } });
      await this.core.customer(tx, initial.customerId);
      const invoice = await tx.commerceInvoice.findUniqueOrThrow({
        where: { id },
      });
      match(invoice.revision, b.revision);
      let row;
      if (route === 'POST commerce/invoices/:id/issue')
        row = await this.issue(tx, invoice);
      else if (route === 'POST commerce/invoices/:id/correct') {
        const c = parse(route, input);
        row = await this.correction(
          tx,
          invoice,
          c.subtotal,
          c.description,
          c.promotionCodes,
          c.reason,
        );
      } else if (route === 'POST commerce/invoices/:id/void')
        row = await this.correction(
          tx,
          invoice,
          '0',
          'Voided invoice',
          [],
          b.reason,
          'VOID',
        );
      else if (route === 'POST commerce/invoices/:id/apply-credit') {
        if (invoice.state !== 'ISSUED') fail('INVOICE_NOT_OUTSTANDING');
        const due = await this.balance(tx, invoice.id);
        await this.consumeCredit(
          tx,
          invoice.customerId,
          invoice.currency,
          due,
          invoice.id,
          'credit-apply:' + invoice.id + ':' + invoice.revision,
        );
        row = await this.settleState(tx, invoice.id);
      } else {
        if (invoice.state !== 'ISSUED') fail('INVOICE_NOT_OUTSTANDING');
        const due = await this.balance(tx, invoice.id),
          policy = await tx.commercePolicy.findUniqueOrThrow({
            where: { id: 'GLOBAL' },
          });
        if (due > minor(policy.writeOffMaximum)) fail('WRITE_OFF_POLICY_LIMIT');
        const v = await tx.commerceInvoiceVersion.findUniqueOrThrow({
          where: {
            invoiceId_version: {
              invoiceId: invoice.id,
              version: invoice.currentVersion,
            },
          },
        });
        row = await this.correction(
          tx,
          invoice,
          bounded(minor(v.total) - due),
          'Debt written off',
          [],
          b.reason,
          'WRITE_OFF',
        );
      }
      await this.core.event(
        tx,
        invoice.customerId,
        'INVOICE_CHANGED',
        b.reason,
        invoice.subscriptionId,
        command,
        undefined,
        { invoiceId: invoice.id, operation: route },
      );
      return this.invoiceView(tx, row);
    }
    if (route === 'GET commerce/customers/:id/refunds') {
      const b = parse(route, input);
      await this.core.customer(tx, id);
      return page(
        await tx.commerceRefund.findMany({
          where: { customerId: id, ...pageWhere(b) },
          orderBy: { id: 'asc' },
          take: b.limit + 1,
        }),
        b.limit,
      );
    }
    if (route === 'GET commerce/customers/:id/payments') {
      const b = parse(route, input);
      await this.core.customer(tx, id!);
      return page(
        await tx.commercePayment.findMany({
          where: { customerId: id, ...pageWhere(b) },
          orderBy: { id: 'asc' },
          take: b.limit + 1,
        }),
        b.limit,
      );
    }
    if (route === 'POST commerce/customers/:id/payments') {
      const b = parse(route, input),
        customer = await this.core.customer(tx, id!);
      currency(b.currency);
      if (minor(b.amount) <= 0n) fail('POSITIVE_PAYMENT_REQUIRED');
      const method = await tx.commerceMethod.findUniqueOrThrow({
        where: { id: b.methodId },
      });
      if (!method.active || method.kind === 'FUTURE_PROVIDER')
        fail('PAYMENT_METHOD_UNAVAILABLE');
      const invoice = b.invoiceId
        ? await tx.commerceInvoice.findFirst({
            where: { id: b.invoiceId, customerId: id, currency: b.currency },
          })
        : null;
      if (
        b.invoiceId &&
        (!invoice || invoice.state === 'DRAFT' || invoice.state === 'VOIDED')
      )
        fail('INVOICE_UNAVAILABLE');
      if (
        b.subscriptionId &&
        !(await tx.commerceSubscription.findFirst({
          where: { id: b.subscriptionId, customerId: id },
        }))
      )
        fail('FOREIGN_SUBSCRIPTION');
      if (
        invoice?.subscriptionId &&
        b.subscriptionId &&
        invoice.subscriptionId !== b.subscriptionId
      )
        fail('SUBSCRIPTION_MISMATCH');
      const subscriptionId =
        b.subscriptionId ?? invoice?.subscriptionId ?? null;
      const renewal = b.invoiceId
        ? await tx.commerceRenewal.findUnique({
            where: { invoiceId: b.invoiceId },
          })
        : null;
      const term =
        subscriptionId && !renewal
          ? await tx.commerceTerm.findFirst({
              where: { subscriptionId, currency: b.currency, closure: null },
              orderBy: { createdAt: 'desc' },
            })
          : null;
      if (b.evidenceFileId)
        await assertBillingEvidence(
          tx,
          b.evidenceFileId,
          customer.spaceId,
          customer.scopeId,
        );
      const reference = b.reference.normalize('NFKC').trim().toUpperCase();
      if (reference.length > 160) fail('REFERENCE_TOO_LONG');
      const row = await tx.commercePayment.create({
        data: {
          customerId: id!,
          invoiceId: b.invoiceId,
          subscriptionId,
          methodId: b.methodId,
          reference,
          currency: b.currency,
          amount: b.amount,
          state: 'PENDING',
          overpayment: b.overpayment,
          evidenceFileId: b.evidenceFileId,
          termId: term?.id ?? null,
        },
      });
      await this.core.event(
        tx,
        id!,
        'PAYMENT_RECORDED',
        b.reason,
        subscriptionId,
        command,
        undefined,
        { paymentId: row.id },
      );
      return row;
    }
    if (route === 'POST commerce/payments/:id/verify') {
      const b = parse(route, input),
        initial = await tx.commercePayment.findUniqueOrThrow({ where: { id } });
      await this.core.customer(tx, initial.customerId);
      const p = await tx.commercePayment.findUniqueOrThrow({
        where: { id },
        include: { r_methodId: true },
      });
      if (p.state !== 'PENDING') fail('PAYMENT_ALREADY_REVIEWED');
      if (!b.approve) {
        const row = await tx.commercePayment.update({
          where: { id },
          data: { state: 'REJECTED' },
        });
        await this.core.event(
          tx,
          p.customerId,
          'PAYMENT_REJECTED',
          b.reason,
          p.subscriptionId,
          command,
          undefined,
          { paymentId: p.id },
        );
        return row;
      }
      if (!p.r_methodId.active || p.r_methodId.kind === 'FUTURE_PROVIDER')
        fail('PAYMENT_METHOD_UNAVAILABLE');
      const overpayment = b.overpayment ?? p.overpayment;
      const amount = minor(p.amount);
      let allocated = amount;
      if (p.invoiceId) {
        const invoice = await tx.commerceInvoice.findUniqueOrThrow({
          where: { id: p.invoiceId },
        });
        if (!['ISSUED', 'PAID'].includes(invoice.state))
          fail('INVOICE_UNAVAILABLE');
        const due = await this.balance(tx, invoice.id),
          available = await this.credit(tx, p.customerId, p.currency);
        if (amount < due) {
          if (amount + available < due) fail('PARTIAL_PAYMENT_NOT_SUPPORTED');
          await this.consumeCredit(
            tx,
            p.customerId,
            p.currency,
            due - amount,
            invoice.id,
            'payment-credit:' + p.id,
          );
        }
        allocated = amount < due ? amount : due;
        if (amount > due && overpayment === 'REJECT')
          fail('OVERPAYMENT_REVIEW_REQUIRED');
      }
      await this.entry(tx, {
        customerId: p.customerId,
        invoiceId: p.invoiceId,
        subscriptionId: p.subscriptionId,
        paymentId: p.id,
        currency: p.currency,
        amount: -allocated,
        kind: 'PAYMENT',
        sourceKey: 'payment:' + p.id,
      });
      let termId = p.termId;
      if (p.invoiceId) {
        await this.settleState(tx, p.invoiceId);
        const renewal = await tx.commerceRenewal.findUnique({
          where: { invoiceId: p.invoiceId },
        });
        if (
          renewal?.state === 'OPEN' &&
          (await this.balance(tx, p.invoiceId)) === 0n
        ) {
          const sub = await tx.commerceSubscription.findUniqueOrThrow({
            where: { id: renewal.subscriptionId },
          });
          let applied = false;
          if (
            sub.revision === renewal.expectedRevision &&
            sub.state !== 'PAUSED'
          ) {
            await tx.$executeRawUnsafe('SAVEPOINT commerce_renewal');
            try {
              await this.subscriptions.renew(
                tx,
                sub,
                renewal.priceId,
                'EXTERNAL',
                'Verified customer renewal',
                command,
              );
              termId = (
                await tx.commerceTerm.findFirstOrThrow({
                  where: { subscriptionId: sub.id },
                  orderBy: { createdAt: 'desc' },
                })
              ).id;
              applied = true;
              await tx.$executeRawUnsafe('RELEASE SAVEPOINT commerce_renewal');
            } catch (error) {
              if (!(error instanceof HttpException)) throw error;
              await tx.$executeRawUnsafe(
                'ROLLBACK TO SAVEPOINT commerce_renewal',
              );
              await tx.$executeRawUnsafe('RELEASE SAVEPOINT commerce_renewal');
            }
          }
          await tx.commerceRenewal.update({
            where: { id: renewal.id },
            data: { state: applied ? 'APPLIED' : 'REVIEW' },
          });
          if (!applied)
            await tx.commerceNotice.create({
              data: {
                customerId: p.customerId,
                subscriptionId: sub.id,
                key: 'renewal-review:' + renewal.id,
                kind: 'RENEWAL_REVIEW_REQUIRED',
                dueAt: new Date(),
                publishedAt: new Date(),
              },
            });
        }
      }
      let row = await tx.commercePayment.update({
        where: { id },
        data: {
          state: 'VERIFIED',
          verifiedAt: new Date(),
          termId,
          overpayment,
        },
      });
      if (amount > allocated) {
        if (overpayment === 'CREDIT')
          await this.grantCredit(
            tx,
            p.customerId,
            p.currency,
            amount - allocated,
            'overpayment:' + p.id,
            { id: p.id },
            p.invoiceId,
            p.subscriptionId,
          );
        else
          await this.entry(tx, {
            customerId: p.customerId,
            paymentId: p.id,
            currency: p.currency,
            amount: amount - allocated,
            kind: 'REFUND_LIABILITY',
            sourceKey: 'refund-liability:' + p.id,
          });
      }
      await this.core.event(
        tx,
        p.customerId,
        'PAYMENT_VERIFIED',
        b.reason,
        p.subscriptionId,
        command,
        undefined,
        { paymentId: p.id },
      );
      row = await tx.commercePayment.findUniqueOrThrow({ where: { id } });
      return row;
    }
    if (route === 'POST commerce/payments/:id/refund') {
      const b = parse(route, input),
        p = await tx.commercePayment.findUniqueOrThrow({
          where: { id },
          include: { r_CommerceRefund_paymentId: true },
        });
      await this.core.customer(tx, p.customerId);
      const current = await tx.commercePayment.findUniqueOrThrow({
        where: { id },
        include: { r_CommerceRefund_paymentId: true },
      });
      if (current.state !== 'VERIFIED') fail('VERIFIED_PAYMENT_REQUIRED');
      const amount = minor(b.amount);
      if (amount <= 0n) fail('POSITIVE_REFUND_REQUIRED');
      const issued = await this.sum(tx, {
          paymentId: p.id,
          kind: { in: ['CREDIT_GRANT', 'CREDIT_REFUND'] },
        }),
        available = await this.sum(tx, {
          paymentId: p.id,
          kind: { in: creditKinds },
        }),
        refunded = current.r_CommerceRefund_paymentId.reduce(
          (n, r) => n + minor(r.amount),
          0n,
        );
      if (amount > minor(p.amount) - refunded - issued + available)
        fail('REFUND_EXCEEDS_UNCONSUMED_PAYMENT');
      const row = await tx.commerceRefund.create({
        data: {
          customerId: p.customerId,
          paymentId: p.id,
          currency: p.currency,
          amount: b.amount,
          reference: b.reference.normalize('NFKC').trim().toUpperCase(),
          reason: b.reason,
        },
      });
      const withdraw = amount < available ? amount : available;
      if (withdraw > 0n)
        await this.entry(tx, {
          customerId: p.customerId,
          paymentId: p.id,
          refundId: row.id,
          currency: p.currency,
          amount: -withdraw,
          kind: 'CREDIT_REFUND',
          sourceKey: 'refund-credit:' + row.id,
        });
      await this.entry(tx, {
        customerId: p.customerId,
        paymentId: p.id,
        refundId: row.id,
        currency: p.currency,
        amount,
        kind: 'REFUND',
        sourceKey: 'refund:' + row.id,
      });
      await this.core.event(
        tx,
        p.customerId,
        'REFUND_RECORDED',
        b.reason,
        p.subscriptionId,
        command,
        undefined,
        { refundId: row.id },
      );
      return row;
    }
    if (route === 'GET commerce/customers/:id/credit') {
      const b = parse(route, input);
      await this.core.customer(tx, id!);
      currency(b.currency);
      return {
        currency: b.currency,
        available: (await this.credit(tx, id!, b.currency)).toString(),
      };
    }
    if (route === 'GET commerce/customers/:id/ledger') {
      const b = parse(route, input);
      await this.core.customer(tx, id!);
      return page(
        await tx.commerceLedger.findMany({
          where: { customerId: id, currency: b.currency, ...pageWhere(b) },
          orderBy: { id: 'asc' },
          take: b.limit + 1,
        }),
        b.limit,
      );
    }
    if (route === 'GET commerce/promotions') {
      const b = parse(route, input);
      return page(
        await tx.commercePromotion.findMany({
          where: pageWhere(b),
          orderBy: { id: 'asc' },
          take: b.limit + 1,
        }),
        b.limit,
      );
    }
    if (route === 'POST commerce/promotions') {
      const b = parse(route, input);
      if (
        (b.kind === 'FIXED') !== (b.currency !== null) ||
        (b.kind === 'PERCENT' && minor(b.amount) > 10000n) ||
        minor(b.amount) <= 0n ||
        new Date(b.endsAt) <= new Date(b.startsAt) ||
        b.perCustomer > b.maxUses
      )
        fail('INVALID_PROMOTION');
      if (b.currency) currency(b.currency);
      const { reason: _, ...data } = b;
      return tx.commercePromotion.create({
        data: { ...data, code: b.code.toUpperCase() },
      });
    }
    if (route === 'POST commerce/promotions/:id') {
      const b = parse(route, input),
        p = await tx.commercePromotion.findUniqueOrThrow({ where: { id } });
      match(p.revision, b.revision);
      return tx.commercePromotion.update({
        where: { id, revision: b.revision },
        data: { active: b.active, revision: { increment: 1 } },
      });
    }
    if (route === 'GET commerce/reports') {
      const b = parse(route, input),
        from = new Date(b.from),
        to = new Date(b.to);
      if (to <= from || to.getTime() - from.getTime() > 366 * dayMs)
        fail('REPORT_WINDOW_LIMIT');
      const payments = await tx.commercePayment.groupBy({
          by: ['currency'],
          where: { state: 'VERIFIED', verifiedAt: { gte: from, lt: to } },
          _sum: { amount: true },
        }),
        refunds = await tx.commerceRefund.groupBy({
          by: ['currency'],
          where: { createdAt: { gte: from, lt: to } },
          _sum: { amount: true },
        }),
        charges = await tx.commerceLedger.groupBy({
          by: ['currency'],
          where: {
            kind: { in: ['CHARGE', 'ADJUSTMENT', 'WRITE_OFF'] },
            createdAt: { gte: from, lt: to },
          },
          _sum: { amount: true },
        });
      const outstanding = await tx.commerceLedger.groupBy({
        by: ['currency'],
        where: { kind: { in: balanceKinds }, invoiceId: { not: null } },
        _sum: { amount: true },
      });
      const snapshotAt = new Date();
      const recurring = await tx.commerceSubscription.findMany({
        where: {
          origin: 'EXTERNAL',
          state: { in: ['SCHEDULED', 'ACTIVE', 'GRACE'] },
          startsAt: { lte: snapshotAt },
          r_customerId: { closedAt: null },
        },
        include: {
          r_priceId: true,
          r_CommerceTerm_subscriptionId: {
            where: { closure: null },
            include: {
              shifts: true,
              closure: true,
              r_CommercePayment_termId: {
                where: { state: 'VERIFIED', verifiedAt: { lt: snapshotAt } },
                include: {
                  r_CommerceRefund_paymentId: {
                    where: { createdAt: { lt: snapshotAt } },
                  },
                },
              },
            },
          },
        },
        take: 10001,
      });
      if (recurring.length > 10000) fail('REPORT_ROW_LIMIT');
      const codes = new Set(
        [...payments, ...refunds, ...charges, ...outstanding].map(
          (v) => v.currency,
        ),
      );
      for (const s of recurring) codes.add(s.r_priceId.currency);
      const currencies = [];
      for (const code of [...codes].sort()) {
        const collected = minor(
            payments.find((p) => p.currency === code)?._sum.amount ?? '0',
          ),
          refunded = minor(
            refunds.find((p) => p.currency === code)?._sum.amount ?? '0',
          ),
          receivable = minor(
            outstanding.find((p) => p.currency === code)?._sum.amount ?? '0',
          );
        const eligible = recurring.filter(
          (s) =>
            s.r_priceId.currency === code &&
            s.r_priceId.recurring &&
            s.r_priceId.termDays &&
            s.endsAt &&
            s.endsAt > snapshotAt &&
            effectiveSubscription(s, snapshotAt) === 'ACTIVE' &&
            s.renewal === 'MANUAL' &&
            !s.cancelAtEnd,
        );
        let mrr = 0n;
        for (const sub of eligible) {
          const term = sub.r_CommerceTerm_subscriptionId.find((t) => {
            const w = termWindow(t);
            return (
              w.startsAt <= snapshotAt && (!w.endsAt || w.endsAt > snapshotAt)
            );
          });
          if (!term || term.origin !== 'EXTERNAL') continue;
          const paid = term.r_CommercePayment_termId.reduce(
            (n, p) =>
              n +
              minor(p.amount) -
              p.r_CommerceRefund_paymentId.reduce(
                (a, r) => a + minor(r.amount),
                0n,
              ),
            0n,
          );
          if (paid > 0n)
            mrr += (minor(term.amount) * 30n) / BigInt(sub.r_priceId.termDays!);
        }
        const breakdown = await tx.commercePayment.findMany({
          where: {
            currency: code,
            state: 'VERIFIED',
            verifiedAt: { gte: from, lt: to },
            termId: { not: null },
          },
          include: {
            r_termId: {
              include: { r_versionId: { include: { r_productId: true } } },
            },
          },
          take: 10001,
        });
        if (breakdown.length > 10000) fail('REPORT_ROW_LIMIT');
        const totals = new Map<
          string,
          { productId: string; kind: 'PLAN' | 'ADDON'; collected: bigint }
        >();
        for (const p of breakdown) {
          const sub = p.r_termId!.r_versionId.r_productId;
          const key = sub.id,
            old = totals.get(key);
          totals.set(key, {
            productId: key,
            kind: sub.kind as 'PLAN' | 'ADDON',
            collected: (old?.collected ?? 0n) + minor(p.amount),
          });
        }
        const converted = await tx.commercePayment.groupBy({
          by: ['customerId'],
          where: { currency: code, state: 'VERIFIED', verifiedAt: { lt: to } },
          _sum: { amount: true },
          orderBy: { customerId: 'asc' },
          take: 10001,
        });
        const reversed = await tx.commerceRefund.groupBy({
          by: ['customerId'],
          where: { currency: code, createdAt: { lt: to } },
          _sum: { amount: true },
          orderBy: { customerId: 'asc' },
          take: 10001,
        });
        if (converted.length > 10000 || reversed.length > 10000)
          fail('REPORT_ROW_LIMIT');
        const conversions = converted.filter(
          (p) =>
            minor(p._sum.amount ?? '0') >
            minor(
              reversed.find((r) => r.customerId === p.customerId)?._sum
                .amount ?? '0',
            ),
        ).length;
        currencies.push({
          currency: code,
          payments: collected.toString(),
          refunds: refunded.toString(),
          netCash: (collected - refunded).toString(),
          receivables: (receivable > 0n ? receivable : 0n).toString(),
          invoiceCharges: minor(
            charges.find((p) => p.currency === code)?._sum.amount ?? '0',
          ).toString(),
          mrr: mrr.toString(),
          arr: (mrr * 12n).toString(),
          conversionNumerator: conversions,
          conversionDenominator: await tx.commerceCustomer.count({
            where: { createdAt: { lt: to } },
          }),
          byProduct: [...totals.values()].map((v) => ({
            ...v,
            collected: v.collected.toString(),
          })),
        });
      }
      return { currencies, snapshotAt: snapshotAt.toISOString() };
    }
    throw new NotFoundException();
  }
}
