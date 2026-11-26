# 0077: Platform Admin P5 commercial records and enforcement

Status: owner-authorized implementation, 2026-11-26, under the explicit P5 task.
This records engineering choices within the master specification. It does not
authorize commercial activation, online charging, deployment or P5 publication.

The admin-commerce module owns the dynamic catalog, versioned allowances/prices,
scope-bound customers, subscriptions/terms, overrides, promotions and billing.
Personal, Team and Company scopes are separate; Company child Teams use their
own scope. Current Spaces admission and financial authority remain authoritative.
Admin financial grants do not create ordinary membership. Owner counts as a seat.
Financial visibility grants do not authorize ordinary subscription mutations;
customer renewal/cancellation requires the current scope Owner. Platform Admin
subscription management retains its separate explicit capability.

Amounts are signed integer minor units stored as PostgreSQL numeric(24,0), exposed
as decimal strings and calculated with bigint. Currency is ISO-4217 and each
document, allocation, credit and refund stays in one currency. Percent calculations
round half up once per document. Terms use exact UTC milliseconds; unused-term
credit rounds down. No FX, installments, real automatic charges or provider SDKs.

Published versions, terms, financial versions, payments once verified, adjustments,
refunds and ledger entries are append-only at the database boundary. Correction
creates both an invoice version and financial adjustment in one transaction.
Customer/currency locks serialize credits, references, invoice settlement, coupon
usage and refunds. Manual reference identities are reserved uniquely within a
configured method, including pending/rejected review history.
Overpayment requires an explicit operator decision. Customer credit is not a wallet.

Catalog publication can propagate features/quotas to current subscriptions without
altering their pinned price or original term. Renewal price changes require an
explicit future effective date and durable customer notice. Add-on terms survive
plan changes; fully duplicated Boolean renewals are suppressed, preserving history.
Capacity add-ons remain additive even when a base plan has the same quota key.
Grace defaults to seven days with read-only access; policy may permit
mutations during grace. Pause is Admin-only, freezing or continuing the clock as
selected per action. Continuing-clock pause does not itself resume access during
grace. Clock shifts and term closures are separate immutable records; purchased
dates remain unchanged. No implicit refund or add-on cancellation follows pause.

Commercial enforcement defaults off. Enabling requires the dedicated Super Admin
configuration capability, recent persisted MFA, reason and acknowledgement. Only
explicitly activated runtime bindings are commercially enforced; custom catalog
features have inspectable effective entitlements. Security, quotas for safety,
ordinary authorization and deletion/retention remain separate. Expiry is computed
on each request, independent of worker timing; it never deletes customer content.

Durable PostgreSQL sweeps run through the existing pg-boss consumer. They recover
scheduled activation, term changes, expiry/grace and uniquely keyed pre/post expiry
notices after restart. Notifications are private scope-authorized inbox records;
no live delivery or provider acceptance is invented. Automatic monetary retries
remain disabled, while retry policy is recorded for future verified adapters.

Financial reports partition currencies and expose collected payments, refunds,
net cash, outstanding receivables, invoice charges and period-normalized recurring
contract value. Reporting uses repeatable-read snapshots. Cash, refunds and billed
documents use the requested window; current receivables/MRR/ARR explicitly state
snapshotAt. MRR uses the current paid, unpaused, uncanceled, manually renewable
recurring term at a 30-day normalization; ARR is twelve times that value. Conversion
requires positive net receipts in the same currency. Product attribution uses the
immutable purchased term; no historical MRR reconstruction is claimed.
Complimentary grants are excluded from revenue. This is operational
reporting, not an invented jurisdictional accounting or tax engine. Retained financial
records reference pseudonymous customer IDs; erasure detaches live scope locators
and ends subscriptions without deleting monetary history. Existing custody
eligibility rejects moving a scope containing commercial records. There is no
implicit subscription/financial transfer. Only the three exact application User
inverse navigations are added to the reviewed Better Auth normalizer; provider
fields, indexes, sessions and identity schema are unchanged.
