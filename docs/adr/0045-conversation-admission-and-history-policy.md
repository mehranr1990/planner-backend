# 0045: P5-01 conversation admission, authority and history

Status: **APPROVED by the owner**, 2026-11-08.
The owner explicitly selected all three recommended choices in the preflight
questions: explicit acceptance, the proposed permission matrix, and history from
current conversation join only. P5-01 implementation remains authorized.

## Why a decision is needed

[ADR 0025](0025-context-membership-and-inheritance.md) explicitly leaves conversation
participation and join-history windows to P5. Existing Task/comment permissions
and Company directory policies do not define messaging permissions. V3 document
03 fixes private-group history from join by default but leaves work-channel history
to authorized policy. No accepted ADR defines conversation admission consent or
who can create/manage work channels. These choices determine who can contact a
user, enroll them, speak and disclose historical content; they are product policy.

[ADR 0044](0044-phase-5-rest-polling-and-realtime-deferral.md) already records the
approved transport decision. It does not resolve these permissions. The approved
48-hour edit/delete policy is closed and is not being reopened. Exact retention
periods, media, read receipts, DM block interactions and final lifecycle acceptance
remain in their later designated batches; no decision on them is requested here.

## Decision 1: Admission consent

**Approved:** the creator is active; every other named, verified active user must
explicitly accept a conversation invitation before becoming a participant. Pending
invitees cannot read/list message history or send. For work channels, acceptance
also rechecks current full membership in the exact source context. Sending in a DM
requires acceptance by its other participant; creation alone sends no text message
to an unwilling recipient. No connection/friendship prerequisite is introduced.

Alternative: an authorized creator/channel administrator activates named eligible
participants immediately, without recipient acceptance. Revocation and source
checks would still be mandatory. This permits unsolicited enrollment and is not
equivalent to the recommended consent rule.

## Decision 2: P5-01 permission matrix

**Approved initial matrix:**

| Conversation    | Create / manage participants                                                                                                                                               | Read history                                                                     | Send text                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| DM              | Either verified active account creates; fixed pair, no third participant                                                                                                   | Current accepted participant                                                     | Current accepted participant, after both accept |
| Private group   | Verified active creator becomes group administrator; only current group administrators invite/remove participants or appoint another accepted participant as administrator | Current accepted participant, from current join                                  | Current accepted participant                    |
| Project channel | Current full source Owner/Admin creates and manages admissions                                                                                                             | Explicit accepted participant plus current full membership in that exact Project | Same, except source Viewers cannot send         |
| Team channel    | Current full source Owner/Admin creates and manages admissions                                                                                                             | Explicit accepted participant plus current full membership in that exact Team    | Same, except source Viewers cannot send         |
| Company channel | Current full root Owner/Org Admin creates and manages admissions                                                                                                           | Explicit accepted participant plus current full Company-root membership          | Same, except source Viewers cannot send         |

For work channels the creator explicitly joins its new channel. Source authority
alone never grants content access to another channel. Managers/Leads/Dept Managers
and Team Leads do not gain channel-management authority in this initial matrix.
No Department/Unit-specific channel or grant-only messaging admission is introduced
by this proposal. Source membership remains necessary but never sufficient for
content access. Company attachment/association grants no Project/Team admission.

Any participant may leave. A private group's last administrator may first appoint
another accepted participant; leaving without a successor makes the group read-only
for remaining participants. This never blocks account closure or erasure. No
automatic promotion, content deletion or shared-custody transfer is implied.
Any separate custody implementation must still satisfy accepted custody and erasure
invariants. DM departure ends that participant's access; re-admission is explicit.

Alternative: permit all non-Viewer full source members to create work channels;
allow Project Managers/Team Leads and admitted Company child managers to manage
their scoped channel participants. The exact delegation and child-context matrix
would then need to be specified before implementation. The recommended matrix
keeps P5-01 administrative powers narrower.

## Decision 3: Work-channel prior history

**Approved:** P5-01 work channels expose history only from the participant's
current explicit conversation join, matching the already approved private-group
default. A context membership interval is never a conversation history grant.
Re-admission starts a new conversation generation/history floor and cannot revive
old cursors, receipts or pre-join visibility. No option to broaden work-channel
history is implemented in P5-01.

Alternative: permit explicitly admitted work-channel participants to read the
channel's earlier history under a versioned source/channel policy. Approval must
also specify its initial default and who may broaden it; context membership alone
would still not grant participation. This exposes prior members' work content to
new participants and cannot be silently selected as a technical default.

## Implementation and proof after a decision

After approval or correction, record the exact owner choice in this ADR before
coding the affected schema and use cases. Use one Messaging owner with public
source facades, exact typed source links, stable IDs, current source authorization
and separate conversation participant generations. Reuse authenticated identity,
account/custody fences, restrictive restore evidence, outbox, free-mode usage seam
and bounded idempotency patterns. Do not reuse Personal sync as a shared chat feed.

Specify routes and Zod/OpenAPI contracts for create/list/get, invitation/admission,
membership changes, send/history and incremental retrieval; only implemented routes
may enter generated OpenAPI. Bound text, request/page sizes and cursors. Test
admission, the chosen matrix, history floors, cross-context IDs, current session
and account denial, pseudonymized attribution, stale receipts/cursors, idempotent
retry, independent-connection revocation races and atomic source/audit/outbox effects.

Review additive SQL with composite FKs and predecessor-data preservation; rehearse
empty/populated deployment, interrupted rollback and repeated deploy. Verify only
against a canonical isolated local baseline, leaving the old M031-drift database
untouched. Run targeted tests during development, then the mandatory 13-stage gate
once near completion and fresh compiled API/worker smoke. P5-01 stays unstaged,
uncommitted and unpushed. P5-02 and later batches remain unauthorized.

The alternatives above are retained as rejected options, not active permissions.
Implementation evidence is recorded separately in the P5-01 completion report.
