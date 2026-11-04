# 0031 / A08: Exclusive shared-custody fencing and authoritative rechecks

Status: APPROVED by owner for implementation planning, 2026-10-30.
Deterministic verification is mandatory before claiming implementation safety.
Execution still requires explicit batch authorization.

## Guarantee and chosen implementation

No previously authorized mutation may commit after the winning revocation of
the authority required for that mutation. A version check or cache alone is insufficient.

Keep existing exclusive Personal account transaction fences. For every shared
business mutation and access change, lock SharedCustody with SELECT FOR UPDATE
and retain it until commit/rollback. This supersedes the earlier shared custody
reader/writer-lock proposal; conservative per-boundary serialization is intentional.
No shared mode replaces Personal's existing exclusive fence.

## Global lock and transaction order

1. Required Personal account advisory fences; distinct existing keys in consistent order.
2. Required identity/session rows in stable ID order, through the identity owner.
3. SharedCustody rows in ascending Space UUID order, explicitly acquired before owner work.
4. Scoped idempotency/usage locks in stable key order.
5. Required owner-module locks, then resource rows in stable ID order.

Owner order: Tasks, Habits, Notes, Journal, Capture, Finance, Planning, Calendar,
Goals, Focus, Notifications, Rewards, Storage. Inspect the complete call graph at
integration, including implicit row/FK locks; this ordering is not a claim that
all deadlocks have been proven impossible. Never acquire another earlier-ranked
account/custody lock late; abort/restart with the complete required lock set.

Use READ COMMITTED. After locks, reread account/session, custody/scope lifecycle,
ContextAccess generation, current capability policy/grant and resource state.
Validate capability, workflow and expected revision. Write source, receipt, usage,
audit and outbox atomically. Cached authority is only an input hint.

Revoke membership/grant, remove capability, close or hand over under the same
custody lock, then increment applicable authorization versions atomically:

- Revocation wins: waiting mutation rereads state and is denied without effects.
- Mutation wins: revocation waits; mutation commits before revocation.
- Previously issued capabilities/receipts/cursors never bypass the current state.

Five-second lock timeout, 30-second overall transaction budget, at most three
recognized deadlock/serialization attempts within budget. Retry DB-only callbacks;
abort other errors safely. Measure throughput before proposing finer-grained locking.

## Closure, handover and effects

Acting-user shared mutations first acquire the existing Personal account fence.
Closure retains that exclusive fence and immediate global account denial. Handover
prelocks affected accounts and custody, then rereads successor eligibility. Durable
exit work processes contexts in bounded passes; it is never the only access-denial
mechanism. Reconcile effective owner-exit/zero-member state before admitting shared
work; root closure and admission changes serialize. Preserve Personal no-late-write
and sync commit-order guarantees throughout.

SharedMutationReceipt uniqueness: (spaceId,scopeId,actorId,operation,keyHash), with
canonical fingerprint and current authorization before replay. Ordinary retention
is 24 hours; business records provide lasting invite/handover/transfer/assignment
uniqueness. Existing Personal IdempotencyRecord and its owner-composite FK stay intact.

Worker lease claims grant no business authority. Use short claim transactions,
release claim locks, then fenced effect transactions and conditional acknowledgement.
Do not hold an outbox row while waiting on a custody/owner lock that must touch it.
Existing Personal consumers explicitly exclude unsupported shared events. File
finalization/export publication follow current authority; no release-then-commit
using an old decision. Already-authorized network sends/streams cannot be recalled.

## Restore evidence

Extend the independent signed control namespace for restrictive closure/access/grant
events and ownership transitions using opaque IDs/generations/versions. Persist a
restrictive intent before DB commit and outcome afterward; unresolved intent fails
closed during restore. Reconcile aborts against authoritative state. This narrowly
scoped recovery-evidence protocol does not authorize precommit business sends.
DB/filesystem publication is not atomic. Every process verifies current control
evidence; replay must finish before restored data is exposed. Key handling and
legacy compatibility follow the [recovery plan](../g0-implementation-prerequisites.md#recovery-and-operational-gates).

## Mandatory proof

RACE-01–12 use independent PostgreSQL connections, explicit barriers and observable
lock/commit ordering, not timing-only sleeps: old authority after winning revoke;
mutation-first ordering; Task/Goal membership revoke; policy/export revoke; account
closure; competing handovers; successor closure; last departure/invite; recovery/
purge; stale worker/receipt/upload; opposing multi-boundary transfer; connection loss.
Assert atomic source/audit/outbox/receipt effects. Rerun existing Personal closure
and sync-ordering regressions. Tests are implementation acceptance, not performed
or passed by this ADR. See [lock integration plan](../g0-implementation-prerequisites.md#lock-integration-plan).

Owner approval: explicit approval of revised A01–A08, including exclusive
SharedCustody fencing, for implementation planning.
