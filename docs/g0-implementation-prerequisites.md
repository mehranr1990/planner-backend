# G0 implementation prerequisites

Status: A01–A08 APPROVED by owner for implementation planning, 2026-10-30.
Design recorded; the owner subsequently authorized G0 OpenAPI remediation, exact
SQL review and isolated rehearsal. See [execution evidence](g0-execution-report.md).
P2-01 business implementation, application migration deployment and production
writes remain unauthorized by this register.

## Authority and evidence boundary

Use [AGENTS](../AGENTS.md), the existing Phase 0/1 contracts, approved ADRs and the
V3 [decision freeze](../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/10_DECISION_FREEZE_AND_DEFECT_LEDGER.md)
and [gates](../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/12_COVERAGE_AND_GATES.md).
The requested docs/architecture/mehran-v3 path is absent; the supplied root bundle
is the inspected V3 source. Do not edit that bundle to manufacture approval evidence.

| Decision                | Canonical record                                           |
| ----------------------- | ---------------------------------------------------------- |
| A01 custody             | [0024](adr/0024-typed-personal-and-shared-custody.md)      |
| A02 membership          | [0025](adr/0025-context-membership-and-inheritance.md)     |
| A03 capabilities/grants | [0026](adr/0026-capabilities-and-resource-grants.md)       |
| A04 invitations         | [0027](adr/0027-verified-context-invitations.md)           |
| A05 transfer            | [0028](adr/0028-shared-references-and-custody-transfer.md) |
| A06 lifecycle           | [0029](adr/0029-shared-departure-erasure-and-closure.md)   |
| A07 projections         | [0030](adr/0030-authorized-personal-work-projections.md)   |
| A08 fencing             | [0031](adr/0031-shared-transaction-fencing.md)             |

Approval includes the selected schema, fixed roles/bounded policy, 10,000-record/
10 MiB shared-export ceilings, 30-day shared recovery, parent-custody preservation,
independent Personal erasure and exclusive SharedCustody row fencing. It is not
approval of as-yet-unwritten SQL bytes, a test result or a deployment.

Reuse the prior read-only assessment: baseline HEAD
`6a9ccdb81e8c3b4842f1d7ea63c3531a6abbd2bb`, 24 migrations, 67 models, 139 FKs
(75 CASCADE, 62 NO ACTION, one SET NULL, one RESTRICT). Of 45 Space references,
37 include the Personal owner. Both local migration ledgers matched at that audit;
the original documentation task did not claim a new DB/quality run. Current G0
execution evidence is recorded separately in the execution report, including 769
passing tests and the isolated rehearsal. Actual remote publication was unavailable
to verify. Do not repeat repository-wide investigation without a delta.

## Migration design

Design review result: select additive/data-preserving expansion under the existing
Space namespace. Preserve every existing Personal Space/resource ID and all 24
historical migration bytes. No reset, schema push, fake User or automatic Personal
conversion. Keep all 37 owner-composite FKs. Nullability changes require direct FKs
and enforced branch constraints; they are not a zero-risk CREATE-only migration.

The following are ordered design stages. M01–M03 have exact isolated-rehearsal
artifacts in the [migration review](g0-migration-review.md); none are application
Prisma migrations or deployed to configured schemas:

| Stage | Object/operation manifest                                                                                                                                                      | Delivery boundary                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| M01   | Add SHARED to SpaceKind; commit before using the enum value                                                                                                                    | P2-01 artifact                           |
| M02   | Add SharedCustody, AccessScope, SharedActor, ContextAccess, ContextAccessInterval, ContextCapabilityPolicy/current pointer; composite keys/FKs and deferred invariant triggers | P2-01 kernel                             |
| M03   | Add shared receipts/lifecycle storage required by kernel invariants; grant envelope/administrative audit; conditional Space owner CHECK and reviewed DROP NOT NULL             | P2-01 kernel; no public Project creation |
| M04   | Add invitation/handover persistence and currently valid offer/target constraints                                                                                               | P2-02                                    |
| M05   | Add Project custody/scope FKs and typed grant targets; extend Task/TaskChange/Goal attribution and scope constraints; validate before first shared source writes               | P2-03                                    |
| M06   | Add assignment/contributors and typed Personal projection links                                                                                                                | P2-04                                    |
| M07   | Add workflow/field/dependency and work-tool source extensions only when required                                                                                               | P2-05/06                                 |
| M08   | Extend StoredFile shared attribution; transfer manifest/private reference bridges; exact selected FK deferrability changes                                                     | P2-07 before files/transfer              |

Do not create a target/link before its referenced domain exists. Until typed
resource-target constraints exist, reject grant offers requiring that target; do
not leave grant-only rows with unchecked target strings. A kernel schema is not
permission to expose an incomplete shared Project API.

Deferred checks must cover both sides of subtype/custodian/scope/actor changes,
not only INSERT into SharedCustody. Retained lifecycle/audit evidence must survive
source deletion according to policy. Add indexes for access actor/scope/state,
grant target/grantee/expiry, invitation proof/terminal identity, pending handover,
job state/nextAt/lease and authoritative source pagination.

### Existing FK disposition

| Existing relationships                                                               | Required treatment                                                                                 |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Space User-owner cascade                                                             | Retain; SHARED has no User owner                                                                   |
| Personal sync/export/receipts/planning/writing/habits/finance/Focus owner composites | Retain Personal branch and current APIs                                                            |
| Shared-capable Goal/recurrence/template/file owner composites                        | Retain; add direct boundary/scope FK and strict shared actor shape when that source is enabled     |
| Task creator and TaskChange actor live-User NO ACTION FKs                            | Retain for Personal rows; new shared rows use boundary actor reference and null legacy attribution |
| Child/hierarchy/selected-metric/attachment FKs                                       | Preserve same-boundary integrity; no universal cross-space link                                    |
| Incoming private references during real transfer                                     | Typed owner bridge or explicit consented unlink; unsupported graph fails                           |
| Transfer FK timing                                                                   | Enumerate exact required constraints and change only those to DEFERRABLE INITIALLY IMMEDIATE       |

Existing rows need no invented shared mappings: new shared fields remain null on
Personal rows, subject to their enforced Personal branch. Any necessary backfill
must have stable keyset batches, persisted checkpoints, repeat-safe predicates,
pre/post counts/hashes and interruption recovery. Identity removal first completes
shared attribution detachment without deleting others' sources.

### Artifact review and rehearsal

Before application outside an isolated rehearsal, prepare a manifest containing:
Prisma filename, exact SQL SHA-256, objects/FKs/indexes/triggers touched, defaults,
lock/rewrite estimate, precondition queries, preservation checks, forward recovery
and rollback limits. Review actual catalog definitions, not FK names alone.

The current [migration gate](../tooling/testing/migration-safety.ts) rejects enum
alteration, trigger SQL, backfills and nullability/FK-property changes. Register
only exact reviewed name/hash exceptions; retain generic rejection. No new SQL
artifact or exception is approved merely by this design record.

Use a five-second lock timeout. Measure table validation/index duration on populated
representative P1 fixtures. Test empty replay, previous-release upgrade, interrupted
steps, repeat deployment and full row/reference preservation. The configured dev/
test databases are not disposable reset targets. The authorized isolated rehearsal
is recorded in the migration review; no candidate was applied to configured schemas.

The strict V3 G0 gate requires populated migration dry-run/rollback before first
non-rehearsal P2 DDL. The owner explicitly authorized that isolated rehearsal-only
artifact/test work item; it does not activate P2 business APIs.
This sequencing records the prerequisite, not a waiver of the original gate.

### Compatibility and rollback

- Preserve P0/P1 request/response shapes, ownership, money/time/history and sync
  semantics. Shared DTOs do not make Personal createdByUserId/history actor nullable.
- Preserve the pg-boss version-46 plan hash
  `33395ea7aaf8d17f4eceec23c45fcb6672a278f11d3c1a255d8589491278e238`.
- Before shared activation, rollback can revert code and leave harmless expansion.
  After shared writes, the old Personal-only release is not an automatic rollback
  target; use a tested compatible release or forward correction.
- Do not remove enum values, new shared tables/data or compatibility structures as
  an automatic rollback. Restored backups require current restrictive-control replay.

## Retention configuration contract

Store a versioned, immutable, operator-approved shared policy with each custody's
policy reference and each closure job's captured reference. This is a contract for
future implementation, not a new environment setting or a policy fabricated here.

| Field                                                 | Validation / semantics                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| policyVersion, approvalReference, accountableOperator | Required nonempty stable values                                                                                  |
| applicableContexts and marketScope                    | Explicit applicability; P2 enables PROJECT only                                                                  |
| sharedRecoverySeconds                                 | Exactly 2,592,000 (30 elapsed days), separate from Personal grace                                                |
| classRules                                            | Complete entries for work content, comments/history, files/derivatives, exports, access/audit/lifecycle evidence |
| classRules.retainAfterClosureSeconds                  | Explicit nonnegative integer; no invented default or implicit forever                                            |
| classRules.audience/exportAuthority                   | Explicit current-capability allowlist; retained does not mean publicly readable                                  |
| classRules.disposalAction                             | Purge or specified pseudonymization; referenced bytes/derivatives included                                       |
| obligations                                           | Typed outstanding obligation/release state; basis, responsible operator and nextReviewAt                         |
| holds                                                 | Explicit basis, authority, scope, review time and release evidence; never an unexplained null deadline           |
| backupPolicyReference                                 | Existing signed-manifest/expiry and independent replay-control contract                                          |

Before enabling shared creation, validate policy completeness. Invalid/missing
policy denies activation; never silently select retention days. For an existing
job, missing policy means BLOCKED_POLICY. Unresolved obligations/holds mean waiting,
not automatic destruction or renewed user access. Recheck immediately before purge.
Destruction is eligible only after the recovery deadline, all class deadlines and
obligations/holds permit it, actual custody still matches and no live outside file
reference would be destroyed. A policy change cannot silently shorten a captured
obligation; explicit reviewed disposition and audit are required.

Shared lifecycle deadlines start from effective departure, not worker discovery.
Former-custodian recovery is no longer available after the 30-day deadline even
when obligations delay cleanup. Zero-member closure and owner exit with remaining
members are different cases; the latter does not authorize last-member deletion.

Personal [0023](adr/0023-private-export-and-account-erasure.md) stays unchanged:
seven-day grace, current policy acknowledgement, 90-day minimal erasure evidence
and signed backup maximum 30 days. Those values are not implicit shared-content
retention rules. Shared obligations do not postpone unrelated Personal erasure.
Physical backup expiry and current independent-control preservation must still be
proved on the actual target, including mixed Personal/shared backups.

Remaining external input: the deployment owner's class retention values, applicable
market/hold basis and accountable operator. Do not invent legal duties or reopen
the approved 30-day shared recovery choice.

## Lock integration plan

Implement [0031](adr/0031-shared-transaction-fencing.md) without changing Personal's
existing exclusive `personal-access` fence or sync counter serialization.

| Integration point            | Required adaptation                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared authority factory     | Predeclare account/custody lock set; acquire exclusive account fences, identity/session checks and sorted SharedCustody FOR UPDATE rows; reread permissions                            |
| Source-owner ports           | Action/resource-specific shared authority; no cast of a Personal AuthorizedSpace into broad shared membership                                                                          |
| Scope policy/grant changes   | Same custody lock as writes; atomic authorization-version bump                                                                                                                         |
| Personal closure coordinator | Immediate global account denial under existing fence; durable bounded shared-exit work and independent Personal purge                                                                  |
| Owner exit/fanout            | All shared commands reject closed actors; reconcile effective custodian/last-member closure before ordinary writes; persist required frozen/closing state before live actor detachment |
| Handover/transfer            | Affected account fences first, then all custody rows in stable order; never acquire an earlier lock after owner work                                                                   |
| Outbox/workers               | Short lease claim; fenced effect transaction; conditional acknowledgement/unique effects; no outbox-to-custody lock inversion                                                          |
| Files/export                 | Reauthorize finalize/publication/download; stale preauthorization is insufficient                                                                                                      |
| Lifecycle jobs               | Same custody lock for departure counts, recovery and purge claim; generation/lease checks and idempotent cleanup                                                                       |

Account closure uses the existing Personal closure transaction as the authoritative
global denial point and records durable shared-exit work atomically; it does not
lock an unbounded set of custody rows in that transaction. Every shared mutation,
after acquiring its account/custody locks, checks the acting account's Personal
closure state. It also reads the current primary custodian's account state through
Spaces in that transaction: a closed primary custodian makes the boundary effectively
OWNER_EXIT_FROZEN even before the stored lifecycle state is materialized. This is a
fresh state read, not a late acquisition of the custodian's account fence. A
concurrent root transition is serialized by custody; the closing actor's writes
are serialized by its Personal fence. No cache may substitute for either check.

The durable exit worker processes affected SharedActor records in keyset batches.
Under each custody lock it ends participation at the original confirmation time,
counts remaining full members excluding globally closed accounts, then records
owner-exit freeze or zero-member CLOSING_GRACE and its unique lifecycle job. Effective
last departure is the latest applicable departure/closure timestamp in the current
membership generations; worker discovery cannot reset it. Recovery/purge use the
same row lock and generation. Before detaching a live User link, materialize all
custody/participation transitions needed by A01 constraints. Metadata fanout and
pseudonymization must complete before identity removal, but shared retention/holds
never postpone unrelated Personal content purge. Persist progress and retain safe
operator-visible failure states. Prove both effective denial and stored-state
convergence against A01/A06; this design does not claim those race tests passed.

Keep lock order Tasks -> Habits -> Notes -> Journal -> Capture -> Finance ->
Planning -> Calendar -> Goals -> Focus -> Notifications -> Rewards -> Storage,
after account/identity/custody/idempotency/usage locks. Include implicit row/FK
locks in the reviewed graph. Hold custody locks until business commit/rollback.
Replays and queued work reauthorize. Lock timeout 5s, transaction budget 30s,
maximum three recognized retry attempts inside the budget, DB-only callbacks.

Deterministic RACE tests belong to the implemented slice: independent connections,
explicit barriers, pg_locks/transaction outcome observation and both winning orders.
No timing-only sleeps, cache mocks or pass claim before execution. Regression-test
the old Personal closure and sync commit ordering as part of P2-01 acceptance.

## OpenAPI remediation plan

Original canonical contract: 189 paths/293 operations/2,166 local references, six
unresolved `#/$defs/__schema0` references in sync push request/result. The untracked
frontend handoff rebases those references successfully. Snapshot equality alone
passes despite this defect; baseline signature files stop at P1-11.

The owner authorized the current-contract remediation. Implementation and evidence:

1. Correct [lifecycle exporter](../packages/api-contracts/src/lifecycle-openapi.ts)
   embedding: pass each request/response schema's document JSON pointer and rebase
   its local `$defs` references to that embedding. Escape JSON-pointer segments;
   leave unrelated component/external references intact. Do not hand-edit JSON.
2. Test recursive sync request and result definitions, actual reference resolution
   and HTTP/Zod parity. Preserve every existing P0/P1-11 signature and semantic P1-12
   contract; no invented route or schema broadening.
3. The OpenAPI check resolves every local reference and verifies current OpenAPI
   version, operation IDs and response presence. Existing Zod/HTTP suites check
   transport schemas. This is targeted contract validation, not independent
   third-party metaschema/SDK certification. No dependency was added.
4. Generate the corrected canonical JSON, establish the full P1-12 compatibility
   baseline and derive the handoff deterministically. Respect existing untracked
   handoff work; do not silently overwrite it. Require zero unresolved references.

Exactly six reference values changed in canonical JSON. Existing handoff JSON is
untouched and semantically identical. The P1-12 baseline freezes 293 operations
and component schemas. There is still no configured Swagger UI or HTTP OpenAPI
JSON route to claim as verified.

## Recovery and operational gates

| Work item           | Concrete plan / proof                                                                                                                                                                | Required stage                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Key rotation        | Independent purpose/version/key-ID signing and digest keys; legacy v1 verification; inventory-driven key retirement; active recovery proofs remain usable; no legacy cookie fallback | Before shared recovery acceptance                                      |
| Restrictive control | Signed write-ahead intents/outcomes for closure/revocation; unresolved intent quarantines restore; independent current checkpoint shared by processes                                | P2 kernel/lifecycle acceptance                                         |
| CI                  | Compiled P1-10/11/12 smoke steps added; 13 mandatory gates retained. Hosted execution and existing 15-minute budget remain unverified                                                | Measure on next hosted run; before affected implementation submission  |
| Compose             | Worker private-file mount plus independent protected control mount in API/worker; explicit control root and policy provisioning; non-root ownership setup                            | Before Docker release                                                  |
| Restore             | Populated isolated DB/files restore with current independent control; replay Personal erasure/shared revoke/media deletion before any exposure                                       | Local shared recovery acceptance; actual off-host drill before release |
| Production          | Approved workload/SLO/RPO/RTO, encrypted off-host backup/expiry, TLS/origin/cookies, SMTP/Push, disk/queue alerts, incident owner and load evidence                                  | Production launch                                                      |

Use sibling roots such as `/var/lib/mehran/files` and `/var/lib/mehran/control`, with
separate mount/restore lifecycles and verified runtime UID/GID ownership. Current
control evidence is never replaced by the older planner backup. Off-host recovery
must preserve a separately protected current control checkpoint, not just another
volume in the same failure domain. Do not claim Compose starts or restores from
static review. No Docker command, key rotation or provisioning is authorized here.

Versioned evidence separates control signing, backup signing, identity digests and
proof compatibility from the live auth secret. Retain legacy verification material
while referenced by pending jobs, retained evidence or admissible backups; unknown
key IDs fail closed. Do not invalidate active Personal recovery by silently rotating
its signing input. No new cryptographic implementation/provider is required.

## Gate classification and next authorization

| Gate                                                             | Status / ownership                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A01–A08 and engineering instructions recorded                    | COMPLETE as planning documentation                                                     |
| Migration/retention/lock/remediation contracts                   | COMPLETE as design; application fencing/retention admission remain implementation work |
| Exact SQL artifact/hash review and populated rehearsal           | VERIFIED for isolated candidates; see migration review and execution report            |
| Corrected OpenAPI/P1-12 baseline and current P1 quality evidence | VERIFIED; six reference fixes, all 13 applicable checks pass after targeted reruns     |
| Actual shared retention configuration                            | Outstanding before first shared boundary activation                                    |
| Custody/membership/grant/fence DB and multi-connection tests     | P2-01 implementation acceptance; cannot pass before those mechanisms exist             |
| Invitation/handover races                                        | P2-02 acceptance; foundational custodian/closure invariants still tested in P2-01      |
| Source/projection/transfer/cleanup feature matrices              | Corresponding P2 batch; do not call the kernel proof sufficient for all later commands |
| Docker/off-host restore/load/SLO gates                           | Release requirements; not falsely claimed as completed G0 local tests                  |

G0 execution result: GO for beginning P2-01 on explicit owner instruction. The
strict pre-implementation rehearsal and current contract/quality baseline now have
execution evidence. This is not acceptance of an unbuilt shared authorization
implementation or permission to deploy. Do not require completed future application
race tests before drafting that implementation, and do not waive their acceptance.

The execution report distinguishes completed checks, implementation acceptance
tests and activation/release requirements. No P2-01 business implementation,
application migration promotion or deployment occurred. Leave work uncommitted
unless instructed.
