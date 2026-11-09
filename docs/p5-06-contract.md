# P5-06 implementation contract

Approved scope: ADR 0049, privacy/lifecycle/security, and the active requirements in
[the original P5-04 audit](p5-06-p5-04-requirements-audit.md). Existing 788 API
operations and the frozen P5-05 signatures remain compatible. Thirteen additive
operations are included in generated OpenAPI.

## Additive REST surface

All operations use verified current sessions, strict Zod validation, existing
actor/IP limits, private responses and current source/conversation authorization.
No WebSocket, Presence or Typing endpoint is implemented.

| Method/path under `/api/v1`                                                                   | Authority and result                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/conversations/{id}/recovery`                                                            | Current accepted participant; a bounded rich-history snapshot page with fixed message ceiling, a stable initial change cursor and a signed continuation token                         |
| GET `/conversations/{id}/contact-block`                                                       | Known DM party or named pending invitee; own state only, without counterparty identity or block direction                                                                             |
| GET `/messaging/blocks`                                                                       | Current private account owner only; bounded own blocks, without exposing another user's block list                                                                                    |
| POST `/messaging/blocks`                                                                      | Own known DM pair/pending invitation, or unblock by an owned block ID after DM disposal; explicit revision/idempotency, no global person lookup                                       |
| POST `/messaging/blocks/replay`                                                               | Current private account owner; restrictive signed contact-control replay, no content/identity resurrection                                                                            |
| POST `/conversations/{id}/restore-admission`                                                  | Explicit fresh consent after restrictive restore; same current full source seat/generation and previously ACTIVE domain admission, new join-only floor; revision/idempotency required |
| POST `/meetings/{id}/restore-admission`                                                       | Equivalent fresh consent with current Viewer/organizer permissions and ADR 0048 published-document semantics                                                                          |
| GET `/conversations/{projectId}/lifecycle-job`, POST `.../recovery-proof`, POST `.../recover` | Three independent-custody operations for the eligible recorded former custodian; password/proof/revision/generation fences                                                            |
| GET `/meetings/{projectId}/lifecycle-job`, POST `.../recovery-proof`, POST `.../recover`      | Three meeting equivalents; work-source lifecycle remains with its existing Project/Team/Company owner                                                                                 |

The six lifecycle parameter names reuse the established `projectId` convention;
their value identifies the independent conversation/meeting, not a Project.
Restore consent cannot repair LEFT/REVOKED admissions or a changed source generation.
Ordinary rejoining still requires a valid invitation. Reads, safety and recovery
are distinct from new DM
contact. Blocking preserves authorized old history and common-group messages,
while current pair restrictions govern contact, explicit mention routing and Push.

## Recovery protocol

Capture the initial message ceiling and mutation position in one authorized fenced
transaction. A finite recovery token preserves those positions over every page.
After the final snapshot page, continue the existing rich change feed from that
initial mutation cursor; do not replace it with a later history page's tail.
Bodies are current projections, not a long-lived SQL snapshot. Concurrent changes
may repeat projections but cannot fall between feeds. Consumers
upsert stable message IDs using revision/order, apply tombstones/self-hide and
acknowledge delivery/read only through explicit existing commands.

Each device owns its cursor and authenticated session. A stale/tampered/changed-
authority cursor cannot broaden access. On a recoverable cursor error, evict the
old local view and request a fresh authorized snapshot; on authentication or
authorization denial, stop and discard unauthorized cached content. No automatic
fallback to a fresh tail that silently skips missed history. Empty incremental
polling must remain bounded; respect Retry-After, avoid overlapping polls per
conversation/device and use bounded exponential retry with jitter on failures.
After bootstrap consume incremental changes rather than repeating full snapshots.
Unchanged limits remain IP 30/actor 20 per minute. Delivery/read is explicit and
monotonic; fresh receipt sharing by both parties is required after unblock.

## Lifecycle and local security

Reuse current custody/Personal fences, independent restrictive control evidence,
30-day shared recovery, immutable captured retention policy and typed resumable
owner cleanup. No policy/version is auto-provisioned. Missing policy, active holds,
outside references and unknown incoming FKs fail closed without broader deletion.
Preserve parent-owned resources and source authority; retained bodies never grant
former members access. Account erasure removes private block/progress/acknowledgement
state and pseudonymizes attribution independently of shared retention obligations.

Domain departures end independent custody seats. Bounded owner reconciliation
handles already-ended pre-P5-06 admissions using recorded departure dates, without
migration backfill or a fresh recovery window. Last effective departure supersedes
old frozen jobs. Remaining members keep approved delegated administration/organization
and reads, without automatic promotion. Last private-group administrator departure
remains read-only. PSEUDONYMIZE retains protected content, removes custody-local
identity links, records accountable review and carries restrictions through replay.
Personal Tasks outside meeting custody are preserved.

New intent/final witnesses use the same actual resource ID. Mismatched historical
evidence remains restrictive and requires a compatible snapshot/operator review;
replay matching is never weakened. Private erasure uses the existing independent Personal ErasureControl claim/replay
contract, without adding Shared activation or signing-key preconditions and without
profiles or message bodies in control evidence.

Structural media/metadata checks use existing private StoragePort and byte/hash
contracts with bounded processing. No new service is installed. Full antivirus is
NOT RUN and remains an owner-approved release blocker before deployment/Shared
activation; local checks are never labeled malware-engine clearance.

Communication uploads/downloads preserve original size/SHA-256. Inspection is
bounded at 20 MiB input (existing smaller upload caps still apply), 20,000 pixels
per image axis/16 million pixels total and 128 MiB decoded PNG scanlines. Validate
PNG chunks/CRC/filter structure and JPEG markers/tables/frame/scan structure.
Reject unsafe EXIF/XMP/text/comment/unknown metadata, unsupported PNG interlacing,
active/encrypted/embedded-object PDF features and invalid UTF-8/control/active text.
Existing voice duration/size checks remain. These are structural checks, not
complete image/PDF interpreters. Synthetic tests do not claim production SLO,
capacity, actual operational restore or external delivery readiness.
