# 0050: P6-01 discovery, connections and Social Group admission

Status: **APPROVED by the owner**, 2026-11-11 (Asia/Tehran).
The owner explicitly selected recommendation A for all three decisions.

P6-01 implementation is authorized against published Phase 5 baseline
`834df8d3a1d8e7df18886716f7c432b1c7570f76`. This proposal does not approve its
own product choices. The explicit owner replies approve the decisions below;
implementation and isolated verification may proceed within P6-01.

## Closed scope and inherited decisions

Retain all six Phase 6 batches and the owner's 45 selected capabilities. Explicitly
exclude c09: transfer, reassignment or assumption of another person's debt,
receivable or financial obligation. The checked-in V3 registry describes Phase 6
in prose and does not enumerate those 45 identifiers; do not invent their mapping.
Only P6-01 is authorized now. Activities, expenses, settlements, lending, albums,
challenges and P6-06 remain in their designated batches. No social feed, payments,
deployment, Shared activation or P5-04 realtime implementation is authorized.

Binding sources: V3 documents 01–05, 10–13; approved ADRs 0024–0027, 0029,
0031 and 0045–0049. Connections require mutual acceptance and grant no other
authority. Circles are private labels, not security boundaries. Social Groups
are distinct from Teams, use Owner/Admin/Member, default to private, and require
approval to join even when discoverable. Existing DM pair blocks preserve
authorized history and common-group membership/content. No verified-phone
identity lifecycle exists: phone discovery remains disabled under V3 audit PG-17;
P6-01 uses verified email, without adding a phone verification provider.

## Decision 1: Directory consent and contact privacy

**Recommendation A:** exact normalized verified-email lookup only; discovery
disabled until the target explicitly opts in. A verified active caller receives
only an eligible target's opaque identity and display name. Unknown, unverified,
closed, opted-out, self and blocked targets yield the same empty response. No
prefix/name search, account counts, contact email, phone, friend list, Circle,
mutual-contact count or group membership is exposed. Bound and throttle lookup;
never log its email body. A separate recipient setting can disable new friend
requests. Existing friendships remain after discovery/request consent is disabled.

**Alternative B:** identical protections, but exact verified-email discovery is
enabled by default with an opt-out. This makes existing accounts discoverable
without a new affirmative choice and cannot be inferred from general scope approval.

## Decision 2: Blocking and private Circle membership

**Recommendation A:** use the existing private account-pair block infrastructure
as the single authority, extended to eligible discovered/social counterparties.
Either direction prevents discovery and new friend requests/acceptance. Blocking
terminates the friendship, cancels pending pair requests, and removes pair labels
from both users' Circles. Removal of friendship also removes its Circle labels.
Unblocking restores none of those relationships; a fresh mutually accepted
request is required. Circle labels apply only to current accepted friends and
remain visible solely to their owner. Block records and the reason for contact
unavailability are never disclosed to the counterparty.

**Alternative B:** blocking suspends new pair contact but retains the accepted
friendship and private Circle labels. Unblock permits the existing friendship to
resume. Explicit friend removal still ends it. This changes relationship revival
and data retention, so it must be chosen explicitly.

Neither choice changes authorized existing DM history, common-group content,
membership, moderation, or Personal erasure under ADR 0049. Blocks suppress
direct invitations to Social Groups; they do not automatically remove users from
a shared Group or deny the ordinary approved join process.

## Decision 3: Group administration, admission and discoverable preview

**Recommendation A:** fixed initial matrix, without arbitrary custom roles:

| Action                                                   | Owner                                  | Admin | Member | Verified outsider |
| -------------------------------------------------------- | -------------------------------------- | ----- | ------ | ----------------- |
| Create an independent Group                              | Yes                                    | Yes   | Yes    | Yes               |
| Read private Group details and member directory          | Yes                                    | Yes   | Yes    | No                |
| Edit name/description/discoverability                    | Yes                                    | Yes   | No     | No                |
| Invite Member; approve/reject join request               | Yes                                    | Yes   | No     | No                |
| Revoke pending Member invitation; remove ordinary Member | Yes                                    | Yes   | No     | No                |
| Appoint/demote/remove Admin                              | Yes                                    | No    | No     | No                |
| Propose administrative Owner succession                  | Yes                                    | No    | No     | No                |
| Leave                                                    | Inherited succession/last-member rules | Yes   | Yes    | N/A               |
| Read discoverable preview; request admission             | Yes                                    | Yes   | Yes    | Yes               |

Creation requires a verified active account independently of roles elsewhere.
The creator becomes the primary custodian; Owner is derived from that seat.
No member can promote themselves, remove the Owner or grant authority above their
ceiling. Owner handover reuses accepted succession and fresh reauthentication;
account erasure remains independent, and last-member closure follows ADR 0029.

An Owner/Admin-issued invitation is prior admission approval: the named verified
recipient must still explicitly accept, with current inviter authority rechecked.
A discoverable join request separately requires Owner/Admin approval. Neither
pending state reveals private data or membership. Friendship is not a prerequisite
for approved Group membership and grants no Group rights by itself.

Discoverable preview exposes only Group ID, name and an explicitly public summary,
never owner identity, membership/counts, private description, chat, files or activity.
Private Groups are absent from discovery. Invitations use the existing hashed
256-bit proof, seven-day expiry, named-recipient and anti-enumeration contract.
Rejoining starts a new admission generation and revives no prior authority.

**Alternative B:** all recommendations except ordinary Members may propose named
invitations, which require a separate Owner/Admin approval before recipient
acceptance. Admin appointment/removal remains Owner-only. This adds an admission
workflow and must not be silently selected as an implementation convenience.

## Engineering plan after the decisions

Add a Social owner module, strict Zod/OpenAPI contracts and additive tables with
typed FK integrity. Reuse identity-owner verification, Personal account fences,
shared custody/membership, authorization versions, signed restrictive controls,
idempotency receipts, usage decisions, audit/outbox and existing lifecycle owners.
Do not create a parallel block store, auth engine, file store or messaging engine.
Keep discovery results and invitations distinct from authorization.

Protect all existing environments, databases, historical migrations and unrelated
documents with byte/data/catalog snapshots. Use a fresh isolated canonical test
database. Freeze released API signatures. Targeted tests cover directory privacy,
pair races, replays, Circle isolation, Group roles/admission, revoked inviter,
stale generation/cursors, lifecycle and concurrent revoke/write ordering. Rehearse
populated upgrade, interrupted rollback and repeat deploy. Run one full 13-stage
quality gate near completion, affected failure reruns only, and compiled API/worker
restart smoke. Produce a SHA-256 change manifest and factual completion evidence.
Leave changes unstaged, uncommitted and unpushed for owner acceptance.

Rollback is application rollback only before new writes; after shared/social data
exists, retain additive schema and roll forward. Never reset protected databases
or edit historical SQL. No new default legal retention duration is proposed.
