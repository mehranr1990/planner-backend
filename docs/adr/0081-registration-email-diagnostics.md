# 0081: Registration evidence and system email diagnostics

Status: engineering decisions within the owner's explicit diagnostics batch
authorization, 2026-11-27. The owner subsequently accepted local development and
authorized Diagnostics publication after final evidence verification. Deployment
remains unauthorized; no product decision changes in publication.

UserSettings retains observed successful sign-in timestamps and whether lifetime
coverage is complete. Existing retained successful AUTH_SIGN_IN audit evidence can
establish recorded timestamps, never completeness or a fabricated first login.
Existing accounts with no evidence remain UNKNOWN. New sign-ups have complete
capture from registration. Active sessions are independent of this evidence.
Verification transition timestamps describe the current email only; old verified
accounts without historical timestamps remain UNKNOWN. No User.updatedAt inference.

System email observations contain only an allowlisted category, recipient, typed
source reference, actual attempt/completion timestamps, safe outcome/code and
provider reference. No credentials, bodies, URLs, proofs or raw SMTP errors.
They observe existing mail transports; source queues and workers remain authoritative.
Owner public facades provide current queued/processing/retry state and resource
metadata. The Admin facade merges independently bounded, identically filtered
pages with the existing cursor machinery. Legacy SENT is UNKNOWN without a real
SMTP observation. Sinks are SINK_ACCEPTED, never SMTP acceptance or inbox delivery.
BOUNCED requires actual bounce evidence; none is invented from a rejection/timeout.

Dedicated email read/retry permissions default to SUPER_ADMIN. User diagnostics
retain existing metadata-read rights. Verification resend has a separate explicit
permission granted to SUPER_ADMIN and SUPPORT, plus recent MFA, current revision,
reason, per-recipient throttling, audit and idempotency. Durable execution checks
current user/email/operator authority and generates fresh provider proofs. Manual
verification and recovery retain their existing controls. Email retry never reads
stored secret links or replays expired/consumed tokens; unsupported source retries
must use their existing owner-authorized workflow.

Observation retention uses the existing P4 COMMUNICATIONS retention policy and
worker sweep. User deletion cascades/scrubs observations, source deletion removes
its observations, portability exposes only the owner's safe metadata. No new mail
provider, delivery system, unrestricted content view, role or paid dependency.

## Persistence, pre-commit identity and retries

Two additive reviewed migrations are required: M129 and M130. M129 was already
applied in the isolated test database when pre-commit signup evidence erasure
needed a stronger subject link, so M130 supplies that correction without editing
any applied SQL. `subjectUserId` has no FK because Better Auth may send before its
User transaction commits. It is only an erasure/evidence hint, never authority;
only an actually existing User may appear as an operational related user. Current
User email and subject deletion both scrub observations, including old addresses.
No proof, credential, body or raw error is stored in this observation table.

Source-owner projections use canonical SharedCustody/DomainScopeCustody kind,
not AccessScope ROOT, to distinguish invitation categories and apply the existing
per-module notification preferences. This corrects an affected classification
and preference-boundary defect; all six invitation kinds retain owner validity.

API retries return stable queued acknowledgements. Verification/recovery always
use fresh provider proofs, current recipient and existing account controls. Only
failed plain account/workspace notices may be retried directly; create a new
AdminDelivery and cancel the old record without resetting its attempt history.
Unknown acceptance is never automatically resent by diagnostics. BOUNCED remains
reserved for actual bounce evidence; the existing SMTP adapter has no authenticated
bounce receiver. No inbox receipt, historical timestamp or historical login is
inferred from queue SENT, User.updatedAt or current session presence.

Closed roles remain unchanged. New capabilities are `admin.email.read`,
`admin.email.retry` (SUPER_ADMIN) and `admin.users.verification.resend`
(SUPER_ADMIN/SUPPORT). Existing account permission, revision, recent-MFA,
anti-enumeration, reason, audit, idempotency and recipient limits remain binding.
Metadata retention and its impact preview reuse COMMUNICATIONS retentionDays,
existing worker sweep, source deletion and Personal portability/erasure.
