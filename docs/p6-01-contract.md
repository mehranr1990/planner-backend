# P6-01 executable contract

Authorization: owner request dated 2026-11-11 and approved ADR 0050 (all A).
Baseline: `834df8d3a1d8e7df18886716f7c432b1c7570f76`, independently verified
against `origin/main`. Only this batch is authorized.

Phase 6 retains its six batches and the owner's 45 selected capabilities, with
c09 explicitly excluded: no transfer/reassignment/assumption of another person's
debt, receivable or financial obligation. The canonical V3 registry contains prose,
not an enumerated 45-ID list; no new capability mapping is invented here.

## Owner boundaries and operations

Social owns discovery preferences, pair connections, private Circles, Social Group
metadata and join requests. Spaces owns custody, identity admission, memberships,
invitations, succession, restrictive restore and lifecycle. Messaging owns the
existing private account-pair blocks. Personal export/erasure uses the established
PersonalData contract. No new external provider, storage, broker or dependency.

The following route families are implementation targets, not claims of currently
exported endpoints. Actual operations enter generated OpenAPI only when registered.

| Family under `/api/v1`              | Commands and queries                                    | Authority/invariants                                                             |
| ----------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `/social/privacy`                   | Read/update own discovery and friend-request consent    | Verified current account; discovery off by default                               |
| `/social/discovery`                 | Exact verified-email lookup                             | Opt-in target; generic empty unavailable result; no contact details              |
| `/social/connections`               | Request/list; accept/decline/cancel/remove              | Pair accounts fenced; only recipient accepts; no automatic reciprocal acceptance |
| `/social/blocks`                    | Block/unblock/list own records                          | Existing Messaging owner; pair-wide restriction; no counterpart disclosure       |
| `/social/circles`                   | Create/read/list/update/delete; add/remove friend label | Owner-only; accepted current friends only; never grants authority                |
| `/social-groups`                    | Create/list own/read/update                             | Typed independent custody; current exact membership                              |
| `/social-groups/discover`           | List minimal opted-in previews                          | No private fields, member identities or counts                                   |
| `/social-groups/{id}/join-requests` | Request/cancel/list/approve/reject                      | Verified applicant consent; Owner/Admin decides; no pending access               |
| `/social-groups/{id}/memberships`   | List/change/remove                                      | Approved fixed role ceilings; current generation                                 |
| `/social-groups/{id}/invitations`   | Invite/read/revoke                                      | Owner/Admin invites Member; existing hashed proof and seven-day expiry           |
| `/social-group-invitations`         | Preview/accept/decline                                  | Existing named-recipient contract; block/current issuer rechecked                |
| Group succession and departure      | Existing owner handover/acceptance and leave            | Provider reauth; last-custodian/closure rules; no data transfer                  |

All writes validate strict Zod bodies; unknown fields cannot assign ownership,
internal state, generation or audit metadata. Creation uses client-stable opaque
UUIDs and bounded Idempotency-Key; transitions use If-Match/current revisions.
Receipts are actor/operation scoped and authorize before replay. Lists use bounded,
signed actor/context-bound cursors, without unauthorized counts. Reads are no-store.
Existing Origin/session/CSRF handling remains active. Directory lookup uses POST
to keep contact identifiers out of request paths/query logs, with bounded actor/IP
throttling. Email normalization comes from the identity owner. Phone lookup stays
disabled until a separately approved verified-phone lifecycle exists.

Pair requests move PENDING to ACCEPTED, DECLINED or CANCELED; friendship removal
ends ACCEPTED. Duplicate and opposing requests cannot create two live friendships.
Blocking ends friendship, cancels pending requests and removes Circle labels in
the same database transaction, including blocks invoked through existing DM APIs.
Unblock never restores a prior friendship/label/admission. Existing DM histories,
group membership/content and receipt privacy keep ADR 0049 semantics.

Discoverable means previewable, never open access. Group creation is private by
default. Owner is derived from primary custody; Admin/Member use their fixed roles.
No implicit Task/Goal/Calendar/Conversation or file grant is added by membership.
Group chat integration and Activity owners remain P6-02. Private group description
and expressly public summary are separate fields. No legal retention duration is
invented; creation requires an existing applicable approved retention policy.

## Migration and acceptance plan

Use one additive migration; preserve prior SQL/checksums and all existing data.
Composite FKs bind Circles to Personal ownership and Group records to root scope
and boundary-local actors. State/role/uniqueness constraints protect direct SQL and
concurrent paths. Extend only the currently needed shared kind/usage catalogs.
Personal erasure must remove private social state without Shared activation and
must not erase another user's Group. Existing shared closure governs Group seats.

Targeted tests: consent/unknown/unverified/blocked discovery parity; body and output
privacy; self/opposing/replayed requests; recipient-only transitions; pair block
races; Circle owner/foreign-ID isolation; Group preview vs content; pending denial;
Admin ceilings and forged roles; expired/wrong-recipient/revoked-issuer invitations;
approval and revoke races; generation/cursor invalidation; session/account closure;
Personal portability/erasure; free-mode usage; SQL constraints and atomic rollback.
Use independent database connections and observed lock barriers for races.

One fresh canonical isolated database receives reviewed migrations. Rehearse
populated predecessor upgrade, interrupted rollback and repeated deploy; verify
frozen Phase 5 signatures and all older compatibility baselines. Run targeted
checks during development, one full 13-stage quality gate near completion and
compiled API/worker restart smoke. Rerun affected failures only. Report actual
commands/counts and produce exact SHA-256 task-path manifest. No deployment,
Shared activation, P5-04 transport, P6-02+ work, staging, commit or push.
