# 0079: Platform Admin P7 internal product analytics

Status: engineering decisions within the owner's explicit P7 authorization,
2026-11-26. Local verification is COMPLETE; final evidence is in the P7 work record. P7
publication, deployment and frontend work are not authorized.

`admin-analytics` owns metadata events, metric definitions, daily aggregates and
authenticated report artifacts. Capture occurs in the existing transactional
outbox path and shared-kernel effects after ordinary domain authorization. The
fixed version-1 catalog excludes private bodies, journal/mood, messages, arbitrary
properties and client-declared meaningful activity. Navigation accepts an enum
page name and server-authenticated identity/current Workspace authority; category
disabled by default, never meaningful. No replay, recording or A/B engine.

Meaningful events are task creation/completion, habit entry, goal progress, capture
triage, calendar time-block changes and finance posting. Shared task effects map
explicit existing create/complete actions to the same catalog. Only newly captured
events support analytics: no invented pre-P7 events or inferred login activity.
DAU/WAU/MAU are distinct meaningful users in rolling 1/7/30 UTC days ending at `to`.
Daily trends use UTC dates. Engagement reports events and active days per active
user; stickiness is DAU/MAU. Return-day 1/7/30 uses the first meaningful event in
the selected period; registration filters instead anchor returns to registration,
including registered cohort members who never became active. Funnel steps are
ordered per user within a configurable window from their first entrance in range.
KPI formulas are COUNT, UNIQUE_USERS, RATIO and PER_ACTIVE_USER over allowlisted
events, with explicit denominators. No expression evaluation or SQL from clients.

Personal/Team/Company type is captured at the authorized event. Registration and
first-feature cohorts use metadata-only owner facades. Plan and P6 flag filters
describe **current** membership/resolution, labelled in response warnings; they
do not claim historical exposure or randomized causal attribution. Flag evaluation
uses P6 targeting, rollout and kill semantics. No experiment creation is added.

P5 remains the sole financial calculation owner. Its existing report is reused,
preserving integer minor-unit strings, separate currencies, paid-term attribution,
snapshot MRR/ARR and exact ledger corrections/refunds. P7 adds only customer-count
economics in that owner facade: paid-term coverage lost between range endpoints
is churn; first verified positive receipt in range is gross free-to-paid conversion.
P5 net-positive conversion remains separately available in the financial report.
Churn coverage honors immutable term shifts/closures and verified payments/refunds.
No historical MRR reconstruction or FX aggregation is claimed. Complimentary
grants never become revenue. Sparse financial contributor groups suppress the
financial report, rather than expose amounts attributable to a tiny group.

Default minimum cohort is 5 (configurable 5–100), raw retention 90 days (30–365),
aggregate retention 730 days (30–3650). Counts/ratios and denominators for small
groups are null. Daily aggregates persist no identifiers or user sketches. Raw
identities have typed cascade FKs to User, Space and logical AccessScope. Source
erasure invalidates all cached aggregates/reports conservatively; P2 personal
portability includes the user's event metadata and erasure removes it through the
existing platform lifecycle. Restore quarantine and tombstone replay remain binding.
Retention changes require current revision, actor-bound fifteen-minute impact
preview and exact impact revalidation, reusing existing Admin mutation receipts.
Analytics retention never changes audit evidence, customer work or financial history.

Hourly aggregation/retention and scheduled report work run in the existing durable
pg-boss worker sweep. PostgreSQL next-at timestamps survive restart; serialized
consumers cannot duplicate a report occurrence. Reports are delivered to the
initiating Admin's authenticated inbox, bounded to 2 MB, with CSV/JSON and seven-day
artifact expiry. Recurring schedules survive artifact expiry until canceled or
authority loss; permissions are rechecked on execution/download. No report goes
to arbitrary email recipients or a public URL. Audit records every attempt and
ready artifact without storing report contents. Analytics failures retain pending
work and do not prevent other existing worker services from running.

M124 adds five tables and four FKs. M125/M126 order privacy invalidation and source
deletion before aggregate/report refresh; collection takes source and policy fences.
No predecessor migration, provider-owned auth field, ordinary contract, dependency,
commercial enforcement setting or owner compose byte is changed.

Historical daily trends may outlive raw events. Distinct rolling/cohort/funnel/KPI
results cannot be reconstructed by adding daily distinct totals: unavailable ranges
return null and RAW_COVERAGE_PARTIAL. Segmented historical trends requiring deleted
raw identities are unavailable. This is retention enforcement, not fabricated data.

Final review additions: standalone Project source activity is explicitly OTHER,
including global meaningful metrics without assigning false Personal/Team/Company
custody. M127 extends only that P7 check; all earlier SQL bytes remain frozen.
Per-price comparisons are projected in the existing P5 report pass, partitioned
by currency and suppressed for sparse price contributors. They report gross
verified receipts, consistent with P5 product attribution; they are not a second
financial ledger or revenue engine. Return periods require their full observation
window. Per-active-user formulas count selected events from meaningful active
contributors, and both ratio components enforce the cohort threshold. Grouped
per-user timestamps bound cohort/funnel scans. Global registration retention
includes inactive registrations; segmented registration retention uses users with
retained observations in that segment and states its denominator. Registration
return windows are evaluated as of to, with unavailable older evidence suppressed.
First-feature cohorts mean first retained captured use, not invented lifetime
history. Meaningful and navigation daily aggregates remain separate; navigation
never becomes DAU/WAU/MAU. Read fences order source erasure against query/download;
policy changes preserve valid historical aggregates and audit exact before/after.
Responses distinguish query refreshedAt from lastAggregatedAt.

M128 adds the PRODUCT/FINANCIAL discriminator to the existing report table,
backfilling old reports as PRODUCT. Both report kinds use the same durable sweep,
private inbox, retention/expiry and audit. Financial generation and download require
financial-read and export, with currency-aware CSV/JSON from the P5 facade. Financial
report selection is explicitly a date range; unsupported attribution filters fail
instead of being ignored. Ordinary P5 API output is unchanged. Meaningful capture
requires a session-backed user actor; background/system outbox effects remain
available to existing consumers without manufacturing user activity.

Final worker acceptance: aggregation and report snapshots use separate transactions;
report reads hold the shared privacy fence, preserving ordinary writes. Concurrent
serialization conflicts have bounded retries. All twenty P7 PostgreSQL cases pass.
