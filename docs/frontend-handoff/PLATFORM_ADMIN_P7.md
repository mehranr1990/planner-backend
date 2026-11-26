# Platform Admin P7 frontend handoff

Backend only; local verification COMPLETE in
[the work record](../platform-admin-p7-work-record.md). Use the generated
[OpenAPI](openapi.json) and exported Zod schemas as the contract.

All Admin routes below are relative to `/api/v1/admin`. Use the separate Admin
cookie realm, mandatory MFA and recent persisted MFA. POST requests require a
trusted Origin and Idempotency-Key, including bounded analytical queries.

| Method / path                     | Permission                     | Behavior                                                                                        |
| --------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| GET analytics/catalog             | admin.analytics.product.read   | Versioned event definitions and meaningful-activity classification                              |
| GET analytics/policy              | admin.analytics.sensitive.read | Collection, privacy and retention policy                                                        |
| POST analytics/policy/preview     | admin.analytics.configure      | Fifteen-minute actor-bound retention impact preview                                             |
| POST analytics/policy             | admin.analytics.configure      | Revision checked policy; retention/privacy changes require previewId                            |
| POST analytics/query              | admin.analytics.product.read   | filter: UTC range, Workspace type, feature, registration dates, first feature, plan, flag/value |
| POST analytics/compare            | admin.analytics.product.read   | current and previous filters; each result has its own denominators and coverage                 |
| POST analytics/financial          | admin.analytics.financial.read | P5 report and customer-count economics, separately by currency                                  |
| GET analytics/definitions         | admin.analytics.product.read   | Up to 100 immutable funnel/KPI/cohort definitions                                               |
| POST analytics/definitions        | admin.analytics.configure      | Create definition using catalog events and allowlisted formula                                  |
| POST analytics/reports            | admin.analytics.export         | Create fixed or recurring report; also requires the report type-s current read permission       |
| GET analytics/reports             | admin.analytics.export         | Initiating Admin's report inbox/schedules                                                       |
| GET analytics/reports/:id         | admin.analytics.export         | Authorized, audited private CSV/JSON content; the report type-s read permission also required   |
| POST analytics/reports/:id/cancel | admin.analytics.export         | Stop owned schedule and invalidate artifact                                                     |

Only SUPER_ADMIN has product/configuration/export/sensitive capabilities by
default. BILLING_MANAGER additionally has financial analytics read; SUPPORT and
SECURITY_REVIEWER gain no analytics capabilities. These are explicit Admin
permissions, independent of ordinary membership, flags and subscriptions.

One new ordinary route: `POST /api/v1/analytics/navigation`, verified user session,
trusted Origin, strict enum page, eventId and optional currently authorized
Workspace selector. It returns `{accepted:true}` whether collection is enabled or
disabled; do not use it as a permission or entitlement check. It cannot submit
meaningful events, private text, arbitrary properties, a different user or timestamps.
Existing Client contracts remain unchanged.

Render suppressed/null metrics as unavailable, never zero. Show coverageFrom,
RAW_COVERAGE_PARTIAL and current-plan/current-flag warnings. DAU/WAU/MAU are rolling
distinct meaningful users, with `to` exclusive; daily trends are UTC. Ratios are
fractions with denominators. Platform registration metrics are explicitly global,
separate from segmented activity. Read metric definitions in ADR 0079 before labels.

Show financial currency panels independently. Monetary fields are decimal strings
in minor units; never parse through floating-point or sum currencies. MRR/ARR and
receivables use P5 snapshotAt; period cash/refunds use from/to. Churn and gross
first-paid conversion have separate definitions from P5 net-positive conversion.
Suppression can hide the whole financial report. No historical MRR is invented.

Reports execute asynchronously. Poll the owned inbox; content is null until ready
or after expiry/erasure/permission loss. Fixed artifacts expire after seven days;
recurring schedules refresh their artifacts and expose nextAt/intervalHours.
CSV is escaped metric/trend/feature/definition rows. Export attempts and generated
artifacts are audited. No external delivery or frontend implementation is included.

Handle 400 strict validation, 403 realm/role/MFA/privacy, 404 unavailable/foreign
target, 409 stale policy/idempotency/preview/resource-window limit. Queries cap
raw events at 100,000, registration/commerce cohorts at 10,000 and flag subjects
at 1,000; narrow filters when a bounded-report limit is returned.

Final contract additions: workspaceType accepts OTHER for existing standalone
Project observations. This is an analytics classification, not a new Workspace
permission or custody type. Financial results include currency-separated prices
with priceId/productId/kind/collected/payingCustomers; collected is gross verified
receipts from the same P5 report pass. No sparse price amounts are exposed.
refreshedAt is the query computation time; lastAggregatedAt is the nullable last
periodic refresh. Mature return-day windows exclude incomplete observation.
Registration retention is as of to; global cohorts include inactive registrations,
while segmented cohorts require retained observations in that segment. First-feature
cohorts use retained captured evidence. Respect coverage warnings; do not label it
lifetime usage. Navigation trends may expose events while meaningful activeUsers
stays null.

Reports accept type PRODUCT (default) or FINANCIAL. Financial reports require
financial-read plus export permission at creation, generation and download; product
reports retain product/sensitive-filter permissions. Financial report filters accept
only from/to: unsupported financial attribution filters are rejected rather than
silently ignored. Both types support fixed or recurring CSV/JSON through the same
PostgreSQL worker/inbox. CSV financial output has a dedicated currency column,
exact signed minor-unit strings and formula-safe escaping. M128 backfills existing
reports to PRODUCT without altering their content or schedule. Session-backed
user operations supply meaningful activity; durable system effects never create DAU.
