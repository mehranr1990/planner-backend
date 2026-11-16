# 0054: Teams gap closure

Status: Owner-approved P3-GAP-CLOSURE scope, 2026-11-16. Technical details below
implement that authorization within the existing owners. The owner's subsequent
finalization approval on 2026-11-16 authorizes normal migration deployment of
M071–M072 to local mehran_dev, final verification, commit and normal push to
origin/main. Only local mehran_dev and mehran_test are authorized databases.
Production/staging deployment, Shared activation, frontend changes and later
batches remain outside this approval.

TB-3 is DEFERRED BY OWNER. Destination invitation/admission and source removal are
independent existing operations. They do not move work or grant Project access.

Weekly capacity is explicit Team-owned member-generation configuration. Seven
Sunday-through-Saturday minute amounts are independent; null is unknown and zero
is nonworking. Configuration has an IANA timezone, effective local date and its
own revision. Existing dated capacity overrides the template, including null and
zero. A timezone mismatch is unknown; no private Personal schedule is consulted.
Minutes are amounts, not assumed wall-clock work intervals. Shared recorded work
is clipped at actual timezone day boundaries and overlapping logs are unioned.
Story points have no conversion to time.

Membership invitation management reuses Spaces' existing Project implementation
with an explicit context-kind argument. Role administration, current issuer,
receipt and proof rotation checks remain. Team HTTP creation and management never
disclose a recipient proof. The authenticated recipient obtains a fresh proof
through the existing recipient endpoint. sentAt describes an in-app offer,
without claiming SMTP delivery. Existing internal fixture APIs remain compatible.

Team meeting RSVP adds MAYBE and permits recipient revisions between ACCEPTED,
DECLINED and MAYBE until expiry/revocation/lifecycle invalidation. An optional
immutable recurrence key identifies an occurrence invitation. Its response
overrides the series response for that occurrence; the series row is unchanged.
Summaries deduplicate current member generations and omit unavailable/revoked
offers. Managers never impersonate recipients. Recurrence keys are validated by
the existing Calendar occurrence engine. Future cancellation adds CANCEL_FUTURE
to that same engine and truncates generation at a validated future occurrence;
past events and exceptions remain. THIS_OCCURRENCE cancellation remains supported.

Project association requests extend the existing typed TeamProjectReference with
typed request identity, action, state and timestamps, not Project identity or
custody. M072 copies any earlier M071 request metadata into constrained indexed
columns and retains the original metadata unchanged. JSON is not authoritative
workflow state. Requests require Team settings management and an
independent Project read. Approval/rejection requires settings management in both
contexts; cancellation requires the initiating Team context's settings management
and a current Project read. Existing direct association with both authorities and
atomic ownerTeamId creation remain compatible. Review never grants membership,
changes key namespace, transfers custody or changes retention. Request history
uses actual scoped activity evidence; old details are not invented.

Pending leave can be edited only by its current requester, under revision and
overlap checks. Approved leave requires cancellation and resubmission. Reasons and
decision notes retain their existing privacy. EDITED is appended to existing
time-off history. Availability reads current approved dates, so edits cannot leave
stale persisted capacity summaries.

Sprint capacity is nullable explicit points on TeamPlan. Original commitment and
close evidence are recorded only at actual transitions after this change.
Bounded immutable observations extend existing scoped activity metadata, through
the Spaces effect contract, in the same transaction as Team mutations. They carry
Team-owned Task IDs, statuses, estimates and completion evidence; no titles or
private content. The UI receives an allowlisted projection, never raw audit rows
or confidential metadata. Missing legacy evidence and unobserved changes produce
INSUFFICIENT_HISTORY/null; current scope is not presented as an earlier snapshot.
Velocity uses observed completion during actual Sprint activation/closure and
counts a Task once across the bounded closed-Sprint history. No reopen workflow
is introduced into the existing DRAFT → ACTIVE → CLOSED engine.

Source views call the existing Task/Calendar facades after current independent
scope authorization and link revalidation. Team membership cannot reveal a
Project. Source identity remains stable and duplicate entries are removed. Hidden
work stays UNKNOWN, without hidden IDs/counts. Cross-Team workload is the
requester's own visible work, with Project allocations deduplicated by source.
Availability and advisory forecasts use explicit Team capacity, approved leave,
stored scheduled estimates and visible Project allocations. Missing estimates or
capacity yield unknown remaining capacity; Personal/busy/private Project work is
explicitly unknown. Forecasts do not reschedule anything.

The Team file library already supports folders, real versions and private binary
lifecycles. Only effective upload configuration is added, using the same bound and
allowed MIME types as the existing byte pipeline. No new store or download URL.

Migrations 071–072 extend existing tables and widen enumerated checks. The original
95 migrations, all rows, typed FKs and the 970-FK fail-closed cleanup catalog remain
unchanged. New JSON values are versioned configuration or historical observation
metadata, not new cross-scope relationships. Isolated test application and predecessor
upgrade verification precede the owner-authorized local development deployment.
The execution record documents the draft test
constraint defect and the owner's explicit isolated backup/restore authorization.
Actual backup restoration, original 95-entry ledger/data preservation and normal
corrected migration replay were verified; no fake checksum repair was used.
M072 also requires isolated populated predecessor/backfill and interruption checks.
