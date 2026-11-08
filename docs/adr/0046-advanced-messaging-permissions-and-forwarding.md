# 0046: P5-02 advanced messaging authority and forwarding

Status: **APPROVED by the owner**, 2026-11-08.
The owner explicitly approved Decision 1's recommended permission matrix and
Decision 2's live-reference model in the two preflight questions. The DM report
triage limitation and personal Viewer hide/report exceptions are included.
P5-02 local implementation is authorized after P5-01 publication, verified at
`dd73a901b1ed55d5a44d5fda225b798143003166`. Both product decisions below are
approved; the existing 48-hour author policy remains binding.

## Existing binding policy

ADRs 0044/0045 require REST polling, explicit accepted participation, current exact
source membership and current-join-only history. Viewers cannot mutate shared
content. Administrative source authority alone grants no conversation content.
The V3 approved delete policy fixes author edit <=48h, DM/private-group author
delete-for-everyone <=48h, work-channel author deletion only under an authorized
channel policy, and ordinary delete-for-self afterward. Exact boundary is inclusive
at server createdAt +48h. No report, pin, forward or revision API may bypass a
history floor, rejoin generation, source revocation, account closure or erasure.

The approved documents name pinning, reporting, moderation and safe forwarding,
but do not assign their administrative powers or authorize copying source content
to recipients who lack source access. A conversation-membership administrator is
not automatically a content moderator. These are disclosure/authority decisions,
not library or schema choices.

## Decision 1: Advanced-operation permission matrix

**Approved:**

| Operation                                                                    | Proposed authority                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read visible message details, threads, reactions, pins and search            | Current accepted participant plus current exact source authority and own join/history window                                                                                                                                                                             |
| Reply, react, mention and forward                                            | Current ordinary sending authority; no Viewer or read-only-conversation bypass                                                                                                                                                                                           |
| Ordinary author edit/delete                                                  | Existing approved 48-hour/scoped policy, current author and current shared-write authority                                                                                                                                                                               |
| Delete-for-self / submit a report                                            | Current accepted participant, including source Viewer; these are personal visibility/safety actions, not shared-content mutation                                                                                                                                         |
| Pin/unpin in a DM                                                            | Either current accepted sender; no special creator privilege                                                                                                                                                                                                             |
| Pin/unpin in a private group                                                 | Current accepted private-group administrator                                                                                                                                                                                                                             |
| Pin/unpin in a work channel                                                  | Current accepted participant who is also exact-source Owner/Admin, or Company Owner/Org Admin                                                                                                                                                                            |
| Read/resolve reports and administratively remove a message in private groups | Current accepted group administrator, limited to messages within that administrator's own current history window; mandatory reason and audit                                                                                                                             |
| Read/resolve reports and administratively remove a work-channel message      | Current accepted participant with the same exact-source administrative roles as pinning; mandatory reason and audit                                                                                                                                                      |
| DM moderation                                                                | Neither peer may administratively remove the other's content. DM reports are private submissions/receipts, without peer access or a new external reviewer. Actual external DM triage requires separately authorized case-bound moderation; no Phase 7 role is built here |
| Publish work-channel ordinary-author deletion policy                         | Current accepted participant with existing exact-source policy administration authority (Owner/Admin or Company Owner/Org Admin); immutable versions and optimistic revision                                                                                             |

Work-channel delete-for-everyone starts denied until an authorized policy expressly
permits it; enabling it cannot extend the ordinary author's 48-hour ceiling. Private
group/DM author deletion within that ceiling remains allowed subject to current
membership/state. This preserves the already approved rule.

Administrative removal is a separate audited logical redaction/tombstone and may
operate outside the ordinary author window. It grants no global content access,
pre-join access, hard erase or legal-hold override. Reports carry a message reference
and the reporter's reason, without automatically copying message content. Reviewers
may read content only through their current authorized history; they receive no
automatic access to retained revisions or previously deleted bodies. Ordinary
revision history remains restricted to the current authorized author.

Alternative: let all accepted senders pin and nominate separate channel moderators.
That needs an explicit delegation/revocation matrix. Giving either DM peer content-
moderation power or introducing an external DM reviewer would require a separate
explicit decision; neither follows from membership administration.

## Decision 2: Forwarding disclosure model

**Approved: live references with current dual authorization.** The sender must
currently be allowed to read the exact source message and write to the target
conversation. Every recipient/read/search/polling projection must independently
retain current accepted source and target participation and both history windows.
A target-only member does not receive the source body or source-author identity.
Source edit is reflected by the current authorized reference; source deletion,
self-hide or revocation cannot reveal an old copied body through the forward.
No source membership, historical grant or custody is transferred by forwarding.

Alternative: an explicitly authorized snapshot/disclosure copy that target-only
participants can read. That requires additional owner rules for who may disclose,
which audience/consent is required, and what source deletion, source revocation and
retention mean for the independent target copy. Do not silently select this model.

## Implementation constraints after the decisions

Preserve all 14 published P5-01 request/response shapes and old frozen signatures.
Use additive detailed-message/change-feed APIs for revisions, reactions, links and
tombstones. Legacy fresh history/send replay must never return hidden/deleted
content; new polling clients consume the durable change feed for edits/redactions.
No fake placeholder text, copied stale receipt body or silent compatibility waiver.
Any genuine unavoidable exception is separately proposed before implementation.

Keep the Messaging owner, typed FKs, existing account/identity/custody lock order,
idempotency and metadata-only audit/outbox. Cross-conversation forwarding must
prelock all required authorities in the existing global order. SQL changes are
additive; published M040 and predecessor bytes remain immutable. Exact legal
retention periods, media, notification delivery, real-time transport, meetings,
advanced lifecycle and platform administration remain outside this batch.

Both owner decisions are closed. Endpoint names, safe Unicode handling, bounded
pagination, schema/index representation and the compatible change-feed
implementation are ordinary engineering work.
