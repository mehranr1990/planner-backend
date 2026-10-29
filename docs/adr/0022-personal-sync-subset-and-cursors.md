# 0022: Personal sync subset, replay and cursor semantics

Status: APPROVED by owner for P1-12, 2026-10-29.

## Decision needed

PHASE_0_1_IMPLEMENTATION.md P1-12 explicitly requires server push/pull/status,
durable change tracking, tombstones and conflicts. Section 10.6 requires an owner
decision on exact fields/entities. Client caches and a general synchronization
engine remain outside scope. This proposal uses existing owner commands and no
new dependency, queue schema, worker process or conflict-merging algorithm.

## Proposed bounded contract

- Sync only ordinary personal Tasks, their Checklists/Labels and label links,
  Daily Plans/selections, Habit Entries, lightweight Notes and text Quick Capture.
  Task create/edit uses existing title, description, priority, parent, planned/
  due/scheduled fields; completion/reopen/delete/restore are explicit commands.
  Checklist and Label CRUD/link operations keep existing parent/resource revisions.
  Daily Plan create/select/remove/reorder keeps Task revisions and saved dates.
  Habit logging/correction/void keeps habit and entry revisions and historical
  schedule rules. Notes allow existing title/content, archive/delete/restore and
  references to existing authorized folders/Tasks/Goals; folders are managed online.
  Capture allows text intake/edit/archive in INBOX, including EXPENSE drafts.
- Recurrence definitions/generation, bulk operations, capture fan-out/triage,
  calendar, Goals, Habit definitions, timers, private Journal/Mood records, binary
  files, auth/session mutations and financial postings remain online. Finance
  drafts are existing EXPENSE CaptureItems; no new draft entity. Actual ledger
  posting is excluded as the specification's explicit default requires.
- POST /sync/push accepts at most 50 independent operations within the existing
  128KB request envelope. Each has a UUID clientMutationId, operation enum,
  resource/parent identifiers when required, base revision (0 only for absent
  creation), and a strict operation-specific payload. Created server IDs are
  returned per mutation; later requests use them. No temporary-ID dependency graph
  or atomic whole-batch behavior. Existing owner commands determine validation,
  ownership, dates, revisions, history, audit and outbox effects.
- Each operation is independently atomic with its SyncMutationReceipt and change
  feed effects. Return APPLIED, DUPLICATE, CONFLICT or REJECTED. A repeated ID with
  identical normalized input never executes again; return DUPLICATE plus original
  disposition/result. Different input for that ID is rejected. Scope includes
  authenticated actor and Personal Space. A Habit append may also supply a stable
  clientEntryId; a unique scoped receipt mapping prevents logging it twice under
  a different mutation ID. Checkbox corrections still require entry revision.
- A stale text edit returns CONFLICT with bounded server/client content and source
  revisions, never an overwrite. Resolution is an explicit new mutation ID with
  the current base revision and chosen content. Source version history stays intact.
  Receipt response/conflict bodies expire after 30 days; retain minimal mutation
  ID/fingerprint/disposition/resource mapping for the account lifetime. Expired
  receipts return an explicit resultExpired response and never execute again.
- Add only SyncMutationReceipt and SyncChange, plus required Space counters/context
  and scoped constraints. A controlled owner/type registry validates feed identities
  within source transactions. SyncChange stores metadata and tombstones, not copied
  planner bodies. Emit changes for supported normal REST writes as well as sync.
  No generic private-content broadcast or direct cross-owner ORM writes.
- Serialize scoped mutations before owner locks through one reentrant transaction
  fence. Check current ownership/account access there, then commit source state,
  feed sequence and receipt together. Space's monotonic integer sequence is internal
  ordering, serialized as a decimal string; resource IDs stay UUIDs. This prevents
  an uncommitted earlier sequence from appearing after a client advances its cursor.
  Closure uses the same fence so an already-authorized write cannot commit after
  account closure. Preserve existing owner lock order inside that fence.
- Pull pages contain at most 100 changes. Cursors are versioned, signed, bound to
  actor/Space/epoch and expire after 30 days. Invalid foreign/tampered cursors fail
  safely; expired or trimmed cursors return RESYNC_REQUIRED. Retain feed metadata/
  tombstones for 30 days, with bounded cleanup. Minimal replay receipts survive
  this trimming so old creates cannot resurrect data.
- First pull/full resync uses bounded keyset bootstrap pages across the fixed
  supported types, capturing the initial committed watermark. Subsequent incremental
  pull starts at that initial watermark, covering changes during bootstrap. Clients
  clear this subset on RESYNC_REQUIRED and apply only newer source revisions.
  Pull returns authorized current source state from one consistent read snapshot;
  a state may be newer than its feed row and may repeat on a later page. Explicitly
  label this CURRENT_STATE semantics, not immutable historical snapshots. Resolve
  old tombstones against newer restores so they cannot remove a newer revision.
- /sync/status supplies supported operations, epoch, current/retained sequence and
  limits. Push must present the current Space epoch; an old account/Space epoch is
  rejected even after registration of a new account. Revoked sessions and closed
  accounts cannot push, pull or bootstrap. No auth tokens or binary data in sync.

## Verification and alternatives

Test two-client races, exact replay, clientEntryId collisions, stale text preservation,
normal REST feed coverage, commit ordering/rollback, bootstrap interleaving, expiry,
tombstones/restores, foreign IDs/cursors, closure races and restart persistence.
Use additive migrations and retain every previous migration/API baseline.

Last-write-wins, actual offline finance posting, a client database, indefinite body
duplication and a new broker/worker are excluded. Retaining minimal replay receipts
instead of expiring all deduplication evidence prevents delayed duplicate creates.

Owner approval: Explicit approval of this proposal in the P1-12 session.
