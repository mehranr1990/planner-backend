# Platform Admin P5 frontend handoff

Backend contracts only; no frontend changes or deployment. Acceptance evidence:
[P5 work record](../platform-admin-p5-work-record.md). Exact request/response types
come from api-contracts/admin-commerce.ts and the synchronized OpenAPI snapshot.

There are 51 Admin, 14 ordinary authenticated and
1 anonymous public operations. New operations return HTTP 200 and no-store.
Existing Client API contracts remain unchanged.

Admin uses the separate Admin cookie realm and persisted MFA within five minutes
on every P5 request. Writes require trusted Origin, Idempotency-Key and reason;
revision-bearing actions reject stale state. Schema objects reject unknown keys.
Money is an integer minor-unit decimal string; never calculate it with binary
floating point. Financial documents have exactly one ISO currency. No FX netting.
Pagination uses after (UUID), limit 1–100, default 25, and nextCursor.

| Role                        | P5 authority                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| SUPER_ADMIN                 | All enumerated P5 capabilities, including catalog, overrides, financial grants, commercial configuration and bounded write-off |
| BILLING_MANAGER             | Plans read; subscriptions read/manage; billing read/manage/verify/correct/refund                                               |
| SUPPORT / SECURITY_REVIEWER | No P5 authority                                                                                                                |

Ordinary members may read their current Workspace entitlement and subscription
status. Owner or an explicitly granted current financial operator is required for
amounts, invoices, payments, refunds, terms, negotiated offers, coupons and credit.
Customer renewal/cancellation commands require the current scope Owner; financial
visibility grants do not grant subscription mutation authority. Membership and current authority are rechecked;
Admin is never an ordinary member. Personal/Team/Company subscriptions are isolated.
Company child Teams use their own logical scope, not the physical Company root.
Commercial records pin their scope; the existing custody eligibility fence rejects
moving a scope containing them, preserving the no-subscription-transfer rule.

The anonymous pricing catalog exposes published PUBLIC products marked pricingPage,
their current feature/quota descriptors and active general prices, never negotiated
prices or private/targeted offers. It states FREE/COMMERCIAL mode. Customer catalog
adds eligible targeted offers and customer-bound price options. Private active
subscriptions remain inspectable through their financial-authorized offer route.

Commercial enforcement defaults off; all existing features remain free. Enabling
requires the dedicated Super Admin configuration, explicit acknowledgement, recent
MFA and audit, plus individually activated runtime bindings. RBAC, safety limits
and feature flags remain separate. personal.write and workspace.write are Boolean
mutation gates; shared feature bindings enforce allocation quotas and the existing
Task/Goal mutation boundary. seats is a quota, including the Owner, checked at real
membership acceptance. Over-limit content is retained and readable. No quota-driven
deletion occurs. Only explicitly bound operations become commercial.

Versions propagate features/quotas NEW_ONLY or ALL without changing pinned prices.
Renewal increases require a separately scheduled price and durable notice (at least
24 hours before its configured effective instant). Early renewal at the pinned
price extends access without a gap; different prices take effect at term end.
Base/add-on and purchased-term histories persist. Capacity add-ons remain additive;
fully redundant Boolean add-ons cannot create duplicate future renewal charges.
Final Admin caps win over the base and additive grants. Override duration is
LIFETIME, DATE or one exact TERM, with revocation.

Subscriptions may be scheduled, fixed-term or manually non-expiring. Complimentary
grants share features but create no successful payment. EXTERNAL is an activation
origin, independent of payment verification. Customer cancellation stops renewal
and retains the paid term; Admin may cancel immediately. Pause is Admin-only:
FREEZE appends exact clock shifts, including prepaid periods; CONTINUE keeps the
clock moving while access remains paused. Resume, cancellation and plan change
append history rather than rewriting purchased terms. No implicit refund or add-on
cancellation. Grace defaults to seven days, read-only, with configurable access.
Expiry is checked in requests even when workers are delayed. PostgreSQL due-state
and uniquely keyed private pre/post-expiry notices recover through pg-boss sweeps.

Customer renewal creates an invoice awaiting manual payment; it never charges.
Privileged verification applies it only while the renewal intent is still eligible;
otherwise the actual receipt remains recorded and the request enters REVIEW with
a notice. Configured retry policy is retained for future adapters. Online methods
remain inactive at the database boundary and there is no live charging integration.

Issued and paid invoice correction creates a new immutable version and paired
adjustment. Original payments and prior versions remain immutable. Credits must
be backed by unrefunded verified receipts, are currency-specific and are not a
withdrawable wallet. Credit plus cash may settle a whole invoice atomically; no
installment or intentional partial-payment offering. References are normalized
and unique per configured method namespace. Overpayment requires CREDIT or
REFUND_PENDING review, optionally selected during verification. Refunds are manual,
bounded by unconsumed receipts, and consume their associated available credit;
they do not implicitly reopen invoices or cancel subscriptions. Write-off requires
Super Admin acknowledgement and a configured maximum (default zero).

Promotions support public/private codes, percent/fixed deductions, currency/date,
product/customer eligibility, global/customer use limits and combination policy.
Usage reserves one immutable redemption per invoice, including drafts; voiding
does not silently free that historical redemption. Tax and fee basis points apply
to discounted subtotal and round half up per document; rules and calculations
are captured in each immutable version. This is not a jurisdictional tax engine.

Reports partition currencies. Cash receipts, refunds and billed charges/adjustments
use [from,to), max 366 days. Receivables and MRR/ARR are current snapshots at
snapshotAt, not historical accounting reconstructions. MRR is the current paid,
unpaused, uncanceled, manually renewable recurring term normalized to 30 days,
excluding complimentary/unpaid/fully refunded terms; ARR is 12 times that figure.
Conversion at to means a customer has positive net verified receipts in that
currency, divided by customers created before to. Product attribution uses the
immutable purchased term. Gross collected amounts include associated overpayment;
they are not recognized accounting revenue. Detail calculations are bounded to
10,000 rows and never silently truncated. No automatic tax, FX or revenue claim.

Personal export includes owned commercial records and term clock history, excluding
operator notes and evidence storage keys. Erasure detaches live scope/identity links
and ends entitlement access while retaining pseudonymous financial history. Evidence
uses existing scanned private-file metadata; bytes retain their separate storage
authorization. No public file URL or new storage provider is introduced.

| Method | Admin path                                             | Capability                 | Body/query fields                                                                                                                                            |
| ------ | ------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | /api/v1/admin/commerce/customers                       | admin.subscriptions.read   | after, limit                                                                                                                                                 |
| POST   | /api/v1/admin/commerce/customers                       | admin.subscriptions.manage | reason, selector                                                                                                                                             |
| GET    | /api/v1/admin/commerce/features                        | admin.plans.read           | after, limit                                                                                                                                                 |
| POST   | /api/v1/admin/commerce/features                        | admin.plans.manage         | reason, key, name, kind, binding                                                                                                                             |
| POST   | /api/v1/admin/commerce/features/:id                    | admin.plans.manage         | reason, revision, name, enforced, archived                                                                                                                   |
| GET    | /api/v1/admin/commerce/products                        | admin.plans.read           | after, limit                                                                                                                                                 |
| POST   | /api/v1/admin/commerce/products                        | admin.plans.manage         | reason, name, visibility, pricingPage, eligibility, targetCustomerIds, kind                                                                                  |
| POST   | /api/v1/admin/commerce/products/:id                    | admin.plans.manage         | reason, revision, name, visibility, pricingPage, eligibility, targetCustomerIds, archived                                                                    |
| GET    | /api/v1/admin/commerce/products/:id/versions           | admin.plans.read           | after, limit                                                                                                                                                 |
| POST   | /api/v1/admin/commerce/products/:id/publish            | admin.plans.manage         | reason, revision, propagation, allowances                                                                                                                    |
| GET    | /api/v1/admin/commerce/prices                          | admin.plans.read           | after, limit, versionId                                                                                                                                      |
| POST   | /api/v1/admin/commerce/prices                          | admin.plans.manage         | reason, versionId, customerId, currency, amount, termDays, recurring, complimentary                                                                          |
| POST   | /api/v1/admin/commerce/prices/:id                      | admin.plans.manage         | reason, active                                                                                                                                               |
| GET    | /api/v1/admin/commerce/customers/:id/entitlements      | admin.subscriptions.read   | Empty                                                                                                                                                        |
| GET    | /api/v1/admin/commerce/customers/:id/overrides         | admin.subscriptions.read   | after, limit                                                                                                                                                 |
| POST   | /api/v1/admin/commerce/customers/:id/overrides         | admin.entitlements.manage  | reason, featureId, value, mode, duration, expiresAt, termId                                                                                                  |
| POST   | /api/v1/admin/commerce/overrides/:id/revoke            | admin.entitlements.manage  | reason                                                                                                                                                       |
| POST   | /api/v1/admin/commerce/customers/:id/financial-grants  | admin.billing.grants       | reason, userId, grant                                                                                                                                        |
| GET    | /api/v1/admin/commerce/customers/:id/subscriptions     | admin.subscriptions.read   | after, limit                                                                                                                                                 |
| POST   | /api/v1/admin/commerce/customers/:id/subscriptions     | admin.subscriptions.manage | reason, priceId, origin, startsAt, nonExpiring, renewal                                                                                                      |
| GET    | /api/v1/admin/commerce/subscriptions/:id/terms         | admin.subscriptions.read   | after, limit                                                                                                                                                 |
| POST   | /api/v1/admin/commerce/subscriptions/:id/renew         | admin.subscriptions.manage | reason, revision, priceId, origin                                                                                                                            |
| POST   | /api/v1/admin/commerce/subscriptions/:id/change        | admin.subscriptions.manage | reason, revision, priceId, origin, mode                                                                                                                      |
| POST   | /api/v1/admin/commerce/subscriptions/:id/cancel        | admin.subscriptions.manage | reason, revision, immediate                                                                                                                                  |
| POST   | /api/v1/admin/commerce/subscriptions/:id/pause         | admin.subscriptions.manage | reason, revision, clock                                                                                                                                      |
| POST   | /api/v1/admin/commerce/subscriptions/:id/reactivate    | admin.subscriptions.manage | reason, revision                                                                                                                                             |
| POST   | /api/v1/admin/commerce/subscriptions/:id/renewal-price | admin.subscriptions.manage | reason, revision, priceId, effectiveAt                                                                                                                       |
| GET    | /api/v1/admin/commerce/methods                         | admin.billing.read         | after, limit                                                                                                                                                 |
| POST   | /api/v1/admin/commerce/methods                         | admin.billing.manage       | reason, name, kind, referenceNamespace, active                                                                                                               |
| POST   | /api/v1/admin/commerce/methods/:id                     | admin.billing.manage       | reason, revision, active                                                                                                                                     |
| GET    | /api/v1/admin/commerce/customers/:id/invoices          | admin.billing.read         | after, limit                                                                                                                                                 |
| POST   | /api/v1/admin/commerce/customers/:id/invoices          | admin.billing.manage       | reason, subtotal, description, promotionCodes, currency, subscriptionId                                                                                      |
| POST   | /api/v1/admin/commerce/invoices/:id/issue              | admin.billing.manage       | reason, revision                                                                                                                                             |
| POST   | /api/v1/admin/commerce/invoices/:id/correct            | admin.billing.correct      | reason, revision, subtotal, description, promotionCodes                                                                                                      |
| POST   | /api/v1/admin/commerce/invoices/:id/void               | admin.billing.correct      | reason, revision                                                                                                                                             |
| POST   | /api/v1/admin/commerce/invoices/:id/apply-credit       | admin.billing.manage       | reason, revision                                                                                                                                             |
| POST   | /api/v1/admin/commerce/invoices/:id/write-off          | admin.billing.write_off    | reason, revision, acknowledge                                                                                                                                |
| GET    | /api/v1/admin/commerce/customers/:id/refunds           | admin.billing.read         | after, limit                                                                                                                                                 |
| GET    | /api/v1/admin/commerce/customers/:id/payments          | admin.billing.read         | after, limit                                                                                                                                                 |
| POST   | /api/v1/admin/commerce/customers/:id/payments          | admin.billing.manage       | reason, invoiceId, subscriptionId, methodId, reference, currency, amount, overpayment, evidenceFileId                                                        |
| POST   | /api/v1/admin/commerce/payments/:id/verify             | admin.billing.verify       | reason, approve, overpayment                                                                                                                                 |
| POST   | /api/v1/admin/commerce/payments/:id/refund             | admin.billing.refund       | reason, amount, reference                                                                                                                                    |
| GET    | /api/v1/admin/commerce/customers/:id/ledger            | admin.billing.read         | after, limit, currency                                                                                                                                       |
| GET    | /api/v1/admin/commerce/customers/:id/credit            | admin.billing.read         | currency                                                                                                                                                     |
| GET    | /api/v1/admin/commerce/promotions                      | admin.billing.read         | after, limit                                                                                                                                                 |
| POST   | /api/v1/admin/commerce/promotions                      | admin.billing.manage       | reason, code, visibility, kind, amount, currency, startsAt, endsAt, maxUses, perCustomer, combinable, productId, customerId                                  |
| POST   | /api/v1/admin/commerce/promotions/:id                  | admin.billing.manage       | reason, revision, active                                                                                                                                     |
| GET    | /api/v1/admin/commerce/reports                         | admin.billing.read         | from, to                                                                                                                                                     |
| GET    | /api/v1/admin/commerce/customers/:id/history           | admin.subscriptions.read   | after, limit                                                                                                                                                 |
| GET    | /api/v1/admin/commerce/policy                          | admin.plans.read           | Empty                                                                                                                                                        |
| POST   | /api/v1/admin/commerce/policy                          | admin.commercial.configure | reason, revision, enforcement, acknowledge, graceDays, graceWritable, preExpiryDays, postExpiryDays, retryCount, retryHours, taxBps, feeBps, writeOffMaximum |

| Method | Ordinary path                                | Authority                  | Body/query fields                 |
| ------ | -------------------------------------------- | -------------------------- | --------------------------------- |
| GET    | /api/v1/commerce/subscriptions/:id/offer     | Scope authority; see below | Empty                             |
| GET    | /api/v1/commerce/customers/:id/promotions    | Scope authority; see below | after, limit                      |
| GET    | /api/v1/commerce/customers/:id/refunds       | Scope authority; see below | after, limit                      |
| GET    | /api/v1/commerce/scopes/:id                  | Scope authority; see below | Empty                             |
| GET    | /api/v1/commerce/customers/:id/entitlements  | Scope authority; see below | Empty                             |
| GET    | /api/v1/commerce/customers/:id/catalog       | Scope authority; see below | after, limit                      |
| GET    | /api/v1/commerce/customers/:id/subscriptions | Scope authority; see below | after, limit                      |
| POST   | /api/v1/commerce/subscriptions/:id/cancel    | Scope authority; see below | revision                          |
| POST   | /api/v1/commerce/subscriptions/:id/renew     | Scope authority; see below | revision, priceId, promotionCodes |
| GET    | /api/v1/commerce/customers/:id/invoices      | Scope authority; see below | after, limit                      |
| GET    | /api/v1/commerce/customers/:id/payments      | Scope authority; see below | after, limit                      |
| GET    | /api/v1/commerce/customers/:id/terms         | Scope authority; see below | after, limit                      |
| GET    | /api/v1/commerce/customers/:id/credit        | Scope authority; see below | currency                          |
| GET    | /api/v1/commerce/customers/:id/notices       | Scope authority; see below | after, limit                      |

| Method | Public path              | Access                   | Query fields       |
| ------ | ------------------------ | ------------------------ | ------------------ |
| GET    | /api/v1/commerce/catalog | Anonymous public catalog | after, limit, kind |
