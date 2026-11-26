# 0076: Platform Admin P4 communications, Support and case moderation

Status: owner-authorized implementation, 2026-11-26, under the explicit instruction
that all remaining P4 work is authorized without intermediate approvals. P4 commit,
push, P5 and deployment remain excluded. This records implementation choices within
the approved product rules; it does not assert phase acceptance.

The `admin-engagement` owner module supplies ordinary Support/report/inbox APIs and
Admin communications/Support/moderation APIs. It reuses the independent Admin realm,
persisted recent MFA, explicit capabilities, mutation receipts and durable audit.
Support roles receive ticket-only operations; Security Reviewer receives explicit
case moderation capabilities. P1 account/workspace suspension and P2 escalation
still require those separate permissions. Internal Support notes and moderation
operator details never enter ordinary response or Personal export projections.

M116–M118 add only P4 tables/columns/constraints. Identity/source FKs are explicit;
source deletion detaches a report rather than blocking owner erasure. Logical
Workspace report references are constrained to the same physical Space. Typed
campaign targets are independent from devices, so no-subscription recipients are
reported without claiming delivery. Historical migration bytes remain frozen.

Communications use immutable localized template versions, explicit approval,
15-minute audience previews, operator-only test sends, scheduled dispatch and
cancellation. Global and essential-security broadcasts require a different current
approver. Audience snapshots contain at most 1,000 users; channels and device
expansion are bounded. Existing global/module notification preferences, quiet hours
and separate per-type preferences all restrict optional delivery. Essential
security notices bypass optional preferences, never recipient verification or
server/device availability. Web Push remains a generic private-inbox hint.
External claims commit before network IO. Current authority, state and consent are
rechecked; row locks and attempt identities fence cancellation and concurrent
workers. A crashed/uncertain network attempt becomes AMBIGUOUS and is not blindly
resent. Explicit temporary provider rejection has bounded retries. In-app effects
and their delivery evidence commit together. Existing pg-boss sweep provides
restart recovery; PostgreSQL remains authoritative.

Support is available to registered users, including unverified accounts in-app.
Workspace context is metadata authorized through Spaces; no membership or private
browsing is granted. Assignment is manual. Queue SLA defaults to 24 hours (15 minutes
to 30 days configurable). Late notices go only to current authorized operators.
Default reopen window is 7 days (1–90), archive after 90 days, and retained ticket
content expires after 365 days; retention cannot precede archive/reopen windows.

Inbound email remains required and wired through a provider-independent adapter,
concrete PostgreSQL receipt/rate/ticket transaction and scanning private-storage
adapter. Production adapter and domain are null: no inbound route trusts JSON or
headers and no provider is activated. Sender alignment must be established by the
trusted transport, then current verified ticket-owner email, revocable 256-bit
correlation token and expiry are checked again. Default token lifetime is 30 days.
Deduplication binds trusted provider identity and sender-bound Message-ID to the
content fingerprint. Ticket/sender limits default to 10/10 minutes and 100/day.
All reply/evidence/receipt/audit writes are atomic. Inbound processing never sends
an automatic email acknowledgement. Outbound notifications carry automatic-mail
loop-prevention headers. Live transport configuration and verification remain a
separate deployment gate documented in the inbound runbook.

Case evidence accepts at most five attachments per inbound message, 5 MiB per file
and 10 MiB aggregate, using actual signature/type checks and the existing malware
scanner. In-app uploads are separately bounded to one file. Metadata persists before
private bytes; staging and failed publications have durable cleanup. At most 100
attachments belong to a case/ticket. Downloads recheck the exact case or ticket,
use private StoragePort streams, and never expose storage keys or public URLs.
Existing storage cleanup recognizes P4 references; restore verification scans and
hashes attached P4 evidence before a target may reopen.

Reports support accounts, relevant Workspaces, behavior, readable Tasks, own Notes
and readable Messages through owner facades. Reportability uses ordinary source
permissions; Admin inspection uses a transaction-bound proof for the exact typed
reported item and a dedicated capability, with mandatory audit. It never fabricates
ordinary membership or broadens to another item. Existing tenant conversation
report handling remains compatible; the explicit Platform report API selects the
item submitted for Platform review. Source erasure fails closed for later reads.

Manual investigation precedes penalties. Restrictions are limited to reporting or
Support submission and expire within 30 days; suspension uses P1 controls and
permissions. Default appeal window is 14 days (1–90 configurable). The original
operator cannot handle an appeal, and a chosen independent reviewer remains bound
to that review. Limited restrictions remain effective during appeal and clear on
dismissal; separate account/workspace suspension requires its own P1 recovery
operation. Default case retention is 90 days for dismissal, 365 for action, never
shorter than the appeal window or an active restriction. Personal closure cancels
pending delivery/tokens; erasure removes owned Support data and schedules private
owned evidence disposal. Case history remains subject to its distinct retention.

The Task transfer registry explicitly recognizes only the new global-ID moderation
reference. It neither pins the Task to its original Space nor copies case content
into a transfer manifest; unknown references still block. Case metadata retains
the reported context while current source availability is rechecked. Workspace
suspension is permitted only for a Workspace report, through its own P1 permission.
Security escalation creates durable per-operator work notices in the P2-permissioned
escalation inbox, in addition to case and audit history.

Retention/configuration changes use the existing durable Admin mutation receipt as
an immutable preview store. Every publish needs explicit impact acknowledgement,
the exact actor-bound proposed values/revision and candidate fingerprint, current
sensitive permission/recent MFA and a preview no older than 15 minutes. Preview
counts include archive/purge targets and affected evidence/replies/delivery and
user receipts. Changed/oversized impact rejects safely. Existing moderation
retention deadlines are not shortened by a new policy. Both preview and publish
are audited. This adds no migration or separate approval decision.

Personal export captures the exact P4-owned evidence manifest in its repeatable
snapshot and includes those private bytes in the existing bounded ZIP. Each open
rechecks current ownership, attached/scanned state, size/hash and Personal access;
missing, changed, removed and foreign evidence fail closed. Existing StoredFile
exports and download routes remain compatible.
