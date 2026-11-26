import { z } from 'zod';
const Id = z.uuid();
const Time = z.iso.datetime();
const Minor = z.string().regex(/^(0|[1-9][0-9]{0,23})$/);
const Signed = z.string().regex(/^-?(0|[1-9][0-9]{0,23})$/);
const Currency = z.string().regex(/^[A-Z]{3}$/);
const Rev = z.number().int().positive();
const Reason = z.string().trim().min(3).max(500);
const Name = z.string().trim().min(1).max(160);
const Empty = z.strictObject({});
const Page = z.strictObject({
  after: Id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: Id.nullable() });
const Result = z.object({ id: z.string(), revision: Rev.optional() });
const mutation = { reason: Reason };
const revision = { ...mutation, revision: Rev };
const Kind = z.enum(['PERSONAL', 'TEAM', 'COMPANY']);
const Customer = z.object({
  id: Id,
  spaceId: Id.nullable(),
  scopeId: Id.nullable(),
  kind: Kind,
  revision: Rev,
  closedAt: Time.nullable(),
});
const Feature = z.object({
  id: Id,
  key: z.string(),
  name: z.string(),
  kind: z.enum(['BOOLEAN', 'QUOTA']),
  binding: z.string().nullable(),
  enforced: z.boolean(),
  archived: z.boolean(),
  revision: Rev,
});
const Product = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(['PLAN', 'ADDON']),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'TARGETED']),
  pricingPage: z.boolean(),
  eligibility: z.array(Kind),
  archived: z.boolean(),
  revision: Rev,
});
const Version = z.object({
  id: Id,
  productId: Id,
  version: Rev,
  propagation: z.enum(['NEW_ONLY', 'ALL']),
  allowances: z.array(z.object({ featureId: Id, value: Minor })),
  createdAt: Time,
});
const Price = z.object({
  id: Id,
  versionId: Id,
  customerId: Id.nullable(),
  currency: Currency,
  amount: Minor,
  termDays: z.number().int().nullable(),
  recurring: z.boolean(),
  complimentary: z.boolean(),
  active: z.boolean(),
});
const Offer = Product.extend({
  prices: z.array(Price),
  versionId: Id.nullable(),
  features: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      kind: z.enum(['BOOLEAN', 'QUOTA']),
      value: Minor,
    }),
  ),
});
const Subscription = z.object({
  id: Id,
  customerId: Id,
  productId: Id,
  versionId: Id,
  priceId: Id,
  kind: z.enum(['PLAN', 'ADDON']),
  state: z.enum([
    'SCHEDULED',
    'ACTIVE',
    'PAUSED',
    'GRACE',
    'EXPIRED',
    'CANCELED',
  ]),
  effectiveState: z.enum([
    'SCHEDULED',
    'ACTIVE',
    'PAUSED',
    'GRACE',
    'EXPIRED',
    'CANCELED',
  ]),
  startsAt: Time,
  endsAt: Time.nullable(),
  origin: z.enum(['COMPLIMENTARY', 'EXTERNAL']),
  cancelAtEnd: z.boolean(),
  renewal: z.enum(['MANUAL', 'FIXED']),
  pausedAt: Time.nullable(),
  pauseClock: z.enum(['FREEZE', 'CONTINUE']).nullable(),
  graceDays: z.number().int(),
  graceWritable: z.boolean(),
  revision: Rev,
  scheduledPriceId: Id.nullable(),
  renewalPriceId: Id.nullable(),
  renewalPriceAt: Time.nullable(),
});
const Term = z.object({
  id: Id,
  subscriptionId: Id,
  versionId: Id,
  priceId: Id,
  startsAt: Time,
  endsAt: Time.nullable(),
  currency: Currency,
  amount: Minor,
  origin: z.enum(['COMPLIMENTARY', 'EXTERNAL']),
});
const Override = z.object({
  id: Id,
  customerId: Id,
  featureId: Id,
  value: Minor,
  mode: z.enum(['ADD', 'CAP']),
  duration: z.enum(['LIFETIME', 'DATE', 'TERM']),
  expiresAt: Time.nullable(),
  termId: Id.nullable(),
  revokedAt: Time.nullable(),
});
const Invoice = z.object({
  id: Id,
  customerId: Id,
  subscriptionId: Id.nullable(),
  number: z.string(),
  currency: Currency,
  state: z.enum(['DRAFT', 'ISSUED', 'PAID', 'VOIDED']),
  revision: Rev,
  currentVersion: Rev,
  issuedAt: Time.nullable(),
  outstanding: Minor,
  versions: z.array(
    z.object({
      id: Id,
      version: Rev,
      subtotal: Minor,
      discount: Minor,
      tax: Minor,
      fee: Minor,
      total: Minor,
      description: z.string(),
      createdAt: Time,
    }),
  ),
  adjustments: z.array(
    z.object({
      id: Id,
      versionId: Id,
      currency: Currency,
      amount: Signed,
      kind: z.string(),
      reason: z.string(),
      createdAt: Time,
    }),
  ),
});
const Payment = z.object({
  id: Id,
  customerId: Id,
  invoiceId: Id.nullable(),
  subscriptionId: Id.nullable(),
  methodId: Id,
  reference: z.string(),
  currency: Currency,
  amount: Minor,
  state: z.enum(['PENDING', 'VERIFIED', 'REJECTED']),
  overpayment: z.enum(['REJECT', 'CREDIT', 'REFUND_PENDING']),
  verifiedAt: Time.nullable(),
});
const Method = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(['MANUAL', 'TRANSFER', 'CRYPTO', 'FUTURE_PROVIDER']),
  referenceNamespace: z.string(),
  active: z.boolean(),
  revision: Rev,
});
const Refund = z.object({
  id: Id,
  customerId: Id,
  paymentId: Id,
  currency: Currency,
  amount: Minor,
  reference: z.string(),
  reason: z.string(),
  createdAt: Time,
});
const Ledger = z.object({
  id: Id,
  currency: Currency,
  amount: Signed,
  kind: z.string(),
  invoiceId: Id.nullable(),
  paymentId: Id.nullable(),
  refundId: Id.nullable(),
  adjustmentId: Id.nullable(),
  subscriptionId: Id.nullable(),
  createdAt: Time,
});
const Notice = z.object({
  id: Id,
  kind: z.string(),
  subscriptionId: Id.nullable(),
  dueAt: Time,
  publishedAt: Time,
});
const Policy = z.object({
  id: z.literal('GLOBAL'),
  revision: Rev,
  enforcement: z.boolean(),
  graceDays: z.number().int(),
  graceWritable: z.boolean(),
  preExpiryDays: z.number().int(),
  postExpiryDays: z.number().int(),
  retryCount: z.number().int(),
  retryHours: z.number().int(),
  taxBps: z.number().int(),
  feeBps: z.number().int(),
  writeOffMaximum: Minor,
});
const Promotion = z.object({
  id: Id,
  code: z.string(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']),
  kind: z.enum(['PERCENT', 'FIXED']),
  amount: Minor,
  currency: Currency.nullable(),
  startsAt: Time,
  endsAt: Time,
  maxUses: z.number().int(),
  perCustomer: z.number().int(),
  combinable: z.boolean(),
  productId: Id.nullable(),
  customerId: Id.nullable(),
  active: z.boolean(),
  revision: Rev,
});
const Entitlements = z.object({
  customerId: Id,
  mode: z.enum(['FREE', 'COMMERCIAL']),
  subscriptionState: z.string().nullable(),
  features: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      kind: z.enum(['BOOLEAN', 'QUOTA']),
      value: Minor,
      enforced: z.boolean(),
      binding: z.string().nullable(),
    }),
  ),
});
const PriceInput = z.strictObject({
  ...mutation,
  versionId: Id,
  customerId: Id.nullable().default(null),
  currency: Currency,
  amount: Minor,
  termDays: z.number().int().min(1).max(36500).nullable(),
  recurring: z.boolean(),
  complimentary: z.boolean(),
});
const ProductInput = {
  name: Name,
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'TARGETED']),
  pricingPage: z.boolean(),
  eligibility: z.array(Kind).min(1).max(3),
  targetCustomerIds: z.array(Id).max(100).default([]),
};
const InvoiceInput = {
  subtotal: Minor,
  description: z.string().trim().min(1).max(500),
  promotionCodes: z.array(z.string().min(1).max(80)).max(5).default([]),
};
const ReportMinor = z.string().regex(/^(0|[1-9][0-9]{0,63})$/);
const ReportSigned = z.string().regex(/^-?(0|[1-9][0-9]{0,63})$/);
const report = z.object({
  currency: Currency,
  payments: ReportMinor,
  refunds: ReportMinor,
  netCash: ReportSigned,
  receivables: ReportMinor,
  invoiceCharges: ReportSigned,
  mrr: ReportMinor,
  arr: ReportMinor,
  conversionNumerator: z.number().int(),
  conversionDenominator: z.number().int(),
  byProduct: z.array(
    z.object({
      productId: Id,
      kind: z.enum(['PLAN', 'ADDON']),
      collected: ReportMinor,
    }),
  ),
});
export const adminCommerceRoutes = {
  'GET commerce/customers': {
    permission: 'admin.subscriptions.read',
    schema: Page,
    response: page(Customer),
  },
  'POST commerce/customers': {
    permission: 'admin.subscriptions.manage',
    schema: z.strictObject({ ...mutation, selector: Id }),
    response: Customer,
  },
  'GET commerce/features': {
    permission: 'admin.plans.read',
    schema: Page,
    response: page(Feature),
  },
  'POST commerce/features': {
    permission: 'admin.plans.manage',
    schema: z.strictObject({
      ...mutation,
      key: z.string().regex(/^[a-z][a-z0-9.-]{1,99}$/),
      name: Name,
      kind: z.enum(['BOOLEAN', 'QUOTA']),
      binding: z.string().max(100).nullable().default(null),
    }),
    response: Feature,
  },
  'POST commerce/features/:id': {
    permission: 'admin.plans.manage',
    schema: z.strictObject({
      ...revision,
      name: Name,
      enforced: z.boolean(),
      archived: z.boolean(),
    }),
    response: Feature,
  },
  'GET commerce/products': {
    permission: 'admin.plans.read',
    schema: Page,
    response: page(Product),
  },
  'POST commerce/products': {
    permission: 'admin.plans.manage',
    schema: z.strictObject({
      ...mutation,
      ...ProductInput,
      kind: z.enum(['PLAN', 'ADDON']),
    }),
    response: Product,
  },
  'POST commerce/products/:id': {
    permission: 'admin.plans.manage',
    schema: z.strictObject({
      ...revision,
      ...ProductInput,
      archived: z.boolean(),
    }),
    response: Product,
  },
  'GET commerce/products/:id/versions': {
    permission: 'admin.plans.read',
    schema: Page,
    response: page(Version),
  },
  'POST commerce/products/:id/publish': {
    permission: 'admin.plans.manage',
    schema: z.strictObject({
      ...revision,
      propagation: z.enum(['NEW_ONLY', 'ALL']),
      allowances: z
        .array(z.strictObject({ featureId: Id, value: Minor }))
        .max(200),
    }),
    response: Version,
  },
  'GET commerce/prices': {
    permission: 'admin.plans.read',
    schema: Page.extend({ versionId: Id.optional() }),
    response: page(Price),
  },
  'POST commerce/prices': {
    permission: 'admin.plans.manage',
    schema: PriceInput,
    response: Price,
  },
  'POST commerce/prices/:id': {
    permission: 'admin.plans.manage',
    schema: z.strictObject({ ...mutation, active: z.boolean() }),
    response: Price,
  },
  'GET commerce/customers/:id/entitlements': {
    permission: 'admin.subscriptions.read',
    schema: Empty,
    response: Entitlements,
  },
  'GET commerce/customers/:id/overrides': {
    permission: 'admin.subscriptions.read',
    schema: Page,
    response: page(Override),
  },
  'POST commerce/customers/:id/overrides': {
    permission: 'admin.entitlements.manage',
    schema: z.strictObject({
      ...mutation,
      featureId: Id,
      value: Minor,
      mode: z.enum(['ADD', 'CAP']),
      duration: z.enum(['LIFETIME', 'DATE', 'TERM']),
      expiresAt: Time.nullable().default(null),
      termId: Id.nullable().default(null),
    }),
    response: Override,
  },
  'POST commerce/overrides/:id/revoke': {
    permission: 'admin.entitlements.manage',
    schema: z.strictObject(mutation),
    response: Override,
  },
  'POST commerce/customers/:id/financial-grants': {
    permission: 'admin.billing.grants',
    schema: z.strictObject({ ...mutation, userId: Id, grant: z.boolean() }),
    response: Result,
  },
  'GET commerce/customers/:id/subscriptions': {
    permission: 'admin.subscriptions.read',
    schema: Page,
    response: page(Subscription),
  },
  'POST commerce/customers/:id/subscriptions': {
    permission: 'admin.subscriptions.manage',
    schema: z.strictObject({
      ...mutation,
      priceId: Id,
      origin: z.enum(['COMPLIMENTARY', 'EXTERNAL']),
      startsAt: Time,
      nonExpiring: z.boolean().default(false),
      renewal: z.enum(['MANUAL', 'FIXED']),
    }),
    response: Subscription,
  },
  'GET commerce/subscriptions/:id/terms': {
    permission: 'admin.subscriptions.read',
    schema: Page,
    response: page(Term),
  },
  'POST commerce/subscriptions/:id/renew': {
    permission: 'admin.subscriptions.manage',
    schema: z.strictObject({
      ...revision,
      priceId: Id,
      origin: z.enum(['COMPLIMENTARY', 'EXTERNAL']),
    }),
    response: Subscription,
  },
  'POST commerce/subscriptions/:id/change': {
    permission: 'admin.subscriptions.manage',
    schema: z.strictObject({
      ...revision,
      priceId: Id,
      origin: z.enum(['COMPLIMENTARY', 'EXTERNAL']),
      mode: z.enum(['IMMEDIATE_CREDIT', 'IMMEDIATE', 'TERM_END']),
    }),
    response: Subscription,
  },
  'POST commerce/subscriptions/:id/cancel': {
    permission: 'admin.subscriptions.manage',
    schema: z.strictObject({ ...revision, immediate: z.boolean() }),
    response: Subscription,
  },
  'POST commerce/subscriptions/:id/pause': {
    permission: 'admin.subscriptions.manage',
    schema: z.strictObject({
      ...revision,
      clock: z.enum(['FREEZE', 'CONTINUE']),
    }),
    response: Subscription,
  },
  'POST commerce/subscriptions/:id/reactivate': {
    permission: 'admin.subscriptions.manage',
    schema: z.strictObject(revision),
    response: Subscription,
  },
  'POST commerce/subscriptions/:id/renewal-price': {
    permission: 'admin.subscriptions.manage',
    schema: z.strictObject({ ...revision, priceId: Id, effectiveAt: Time }),
    response: Subscription,
  },
  'GET commerce/methods': {
    permission: 'admin.billing.read',
    schema: Page,
    response: page(Method),
  },
  'POST commerce/methods': {
    permission: 'admin.billing.manage',
    schema: z.strictObject({
      ...mutation,
      name: Name.max(100),
      kind: z.enum(['MANUAL', 'TRANSFER', 'CRYPTO', 'FUTURE_PROVIDER']),
      referenceNamespace: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,99}$/),
      active: z.boolean(),
    }),
    response: Method,
  },
  'POST commerce/methods/:id': {
    permission: 'admin.billing.manage',
    schema: z.strictObject({ ...revision, active: z.boolean() }),
    response: Method,
  },
  'GET commerce/customers/:id/invoices': {
    permission: 'admin.billing.read',
    schema: Page,
    response: page(Invoice),
  },
  'POST commerce/customers/:id/invoices': {
    permission: 'admin.billing.manage',
    schema: z.strictObject({
      ...mutation,
      ...InvoiceInput,
      currency: Currency,
      subscriptionId: Id.nullable().default(null),
    }),
    response: Invoice,
  },
  'POST commerce/invoices/:id/issue': {
    permission: 'admin.billing.manage',
    schema: z.strictObject(revision),
    response: Invoice,
  },
  'POST commerce/invoices/:id/correct': {
    permission: 'admin.billing.correct',
    schema: z.strictObject({ ...revision, ...InvoiceInput }),
    response: Invoice,
  },
  'POST commerce/invoices/:id/void': {
    permission: 'admin.billing.correct',
    schema: z.strictObject(revision),
    response: Invoice,
  },
  'POST commerce/invoices/:id/apply-credit': {
    permission: 'admin.billing.manage',
    schema: z.strictObject(revision),
    response: Invoice,
  },
  'POST commerce/invoices/:id/write-off': {
    permission: 'admin.billing.write_off',
    schema: z.strictObject({ ...revision, acknowledge: z.literal(true) }),
    response: Invoice,
  },
  'GET commerce/customers/:id/refunds': {
    permission: 'admin.billing.read',
    schema: Page,
    response: page(Refund),
  },
  'GET commerce/customers/:id/payments': {
    permission: 'admin.billing.read',
    schema: Page,
    response: page(Payment),
  },
  'POST commerce/customers/:id/payments': {
    permission: 'admin.billing.manage',
    schema: z.strictObject({
      ...mutation,
      invoiceId: Id.nullable().default(null),
      subscriptionId: Id.nullable().default(null),
      methodId: Id,
      reference: z.string().trim().min(1).max(160),
      currency: Currency,
      amount: Minor,
      overpayment: z
        .enum(['REJECT', 'CREDIT', 'REFUND_PENDING'])
        .default('REJECT'),
      evidenceFileId: Id.nullable().default(null),
    }),
    response: Payment,
  },
  'POST commerce/payments/:id/verify': {
    permission: 'admin.billing.verify',
    schema: z.strictObject({
      ...mutation,
      approve: z.boolean(),
      overpayment: z.enum(['CREDIT', 'REFUND_PENDING']).optional(),
    }),
    response: Payment,
  },
  'POST commerce/payments/:id/refund': {
    permission: 'admin.billing.refund',
    schema: z.strictObject({
      ...mutation,
      amount: Minor,
      reference: z.string().trim().min(1).max(160),
    }),
    response: Refund,
  },
  'GET commerce/customers/:id/ledger': {
    permission: 'admin.billing.read',
    schema: Page.extend({ currency: Currency }),
    response: page(Ledger),
  },
  'GET commerce/customers/:id/credit': {
    permission: 'admin.billing.read',
    schema: z.strictObject({ currency: Currency }),
    response: z.object({ currency: Currency, available: Minor }),
  },
  'GET commerce/promotions': {
    permission: 'admin.billing.read',
    schema: Page,
    response: page(Promotion),
  },
  'POST commerce/promotions': {
    permission: 'admin.billing.manage',
    schema: z.strictObject({
      ...mutation,
      code: z.string().trim().min(1).max(80),
      visibility: z.enum(['PUBLIC', 'PRIVATE']),
      kind: z.enum(['PERCENT', 'FIXED']),
      amount: Minor,
      currency: Currency.nullable(),
      startsAt: Time,
      endsAt: Time,
      maxUses: z.number().int().min(1).max(100000000),
      perCustomer: z.number().int().min(1).max(100000000),
      combinable: z.boolean(),
      productId: Id.nullable().default(null),
      customerId: Id.nullable().default(null),
    }),
    response: Promotion,
  },
  'POST commerce/promotions/:id': {
    permission: 'admin.billing.manage',
    schema: z.strictObject({ ...revision, active: z.boolean() }),
    response: Promotion,
  },
  'GET commerce/reports': {
    permission: 'admin.billing.read',
    schema: z.strictObject({ from: Time, to: Time }),
    response: z.object({ currencies: z.array(report), snapshotAt: Time }),
  },
  'GET commerce/customers/:id/history': {
    permission: 'admin.subscriptions.read',
    schema: Page,
    response: page(
      z.object({
        id: Id,
        subscriptionId: Id.nullable(),
        kind: z.string(),
        reason: z.string(),
        actorAdminId: Id.nullable(),
        actorUserId: Id.nullable(),
        createdAt: Time,
        metadata: z.object({
          clock: z.enum(['FREEZE', 'CONTINUE']).nullable().optional(),
          resumedAt: Time.optional(),
          extensionMs: Minor.optional(),
          fromProductId: Id.optional(),
          toProductId: Id.optional(),
          credit: z.boolean().optional(),
          overrideId: Id.optional(),
          userId: Id.optional(),
          grant: z.boolean().optional(),
          invoiceId: Id.optional(),
          paymentId: Id.optional(),
          refundId: Id.optional(),
          priceId: Id.optional(),
          effectiveAt: Time.optional(),
          operation: z.string().optional(),
        }),
      }),
    ),
  },
  'GET commerce/policy': {
    permission: 'admin.plans.read',
    schema: Empty,
    response: Policy,
  },
  'POST commerce/policy': {
    permission: 'admin.commercial.configure',
    schema: z.strictObject({
      ...revision,
      enforcement: z.boolean(),
      acknowledge: z.literal(true),
      graceDays: z.number().int().min(0).max(365),
      graceWritable: z.boolean(),
      preExpiryDays: z.number().int().min(0).max(365),
      postExpiryDays: z.number().int().min(0).max(365),
      retryCount: z.number().int().min(0).max(10),
      retryHours: z.number().int().min(1).max(720),
      taxBps: z.number().int().min(0).max(10000),
      feeBps: z.number().int().min(0).max(10000),
      writeOffMaximum: Minor,
    }),
    response: Policy,
  },
} as const;
export const ordinaryCommerceRoutes = {
  'GET commerce/subscriptions/:id/offer': {
    schema: Empty,
    response: z.object({
      subscription: Subscription,
      product: Product,
      price: Price,
      renewalPrice: Price.nullable(),
    }),
  },
  'GET commerce/customers/:id/promotions': {
    schema: Page,
    response: page(Promotion),
  },
  'GET commerce/customers/:id/refunds': {
    schema: Page,
    response: page(Refund),
  },
  'GET commerce/scopes/:id': { schema: Empty, response: Customer.nullable() },
  'GET commerce/customers/:id/entitlements': {
    schema: Empty,
    response: Entitlements,
  },
  'GET commerce/customers/:id/catalog': {
    schema: Page,
    response: page(Offer),
  },
  'GET commerce/customers/:id/subscriptions': {
    schema: Page,
    response: page(Subscription),
  },
  'POST commerce/subscriptions/:id/cancel': {
    schema: z.strictObject({ revision: Rev }),
    response: Subscription,
  },
  'POST commerce/subscriptions/:id/renew': {
    schema: z.strictObject({
      revision: Rev,
      priceId: Id,
      promotionCodes: z.array(z.string().min(1).max(80)).max(5).default([]),
    }),
    response: z.object({
      id: Id,
      state: z.literal('AWAITING_PAYMENT'),
      invoiceId: Id,
    }),
  },
  'GET commerce/customers/:id/invoices': {
    schema: Page,
    response: page(Invoice),
  },
  'GET commerce/customers/:id/payments': {
    schema: Page,
    response: page(Payment),
  },
  'GET commerce/customers/:id/terms': { schema: Page, response: page(Term) },
  'GET commerce/customers/:id/credit': {
    schema: z.strictObject({ currency: Currency }),
    response: z.object({ currency: Currency, available: Minor }),
  },
  'GET commerce/customers/:id/notices': {
    schema: Page,
    response: page(Notice),
  },
} as const;
export const publicCommerceRoutes = {
  'GET commerce/catalog': {
    schema: Page.extend({ kind: Kind.optional() }),
    response: page(Offer).extend({ mode: z.enum(['FREE', 'COMMERCIAL']) }),
  },
} as const;
export type CommerceAdminRoute = keyof typeof adminCommerceRoutes;
export type CommerceAdminInput<R extends CommerceAdminRoute> = z.infer<
  (typeof adminCommerceRoutes)[R]['schema']
>;
