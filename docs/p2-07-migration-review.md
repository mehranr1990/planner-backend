# P2-07 migration review (local)

The owner authorized P2-07 implementation and its migration verification. No
configured development schema or production schema is an application target.
The following exact artifacts were inspected against ADRs 0024, 0026 and 0031.
Historical SQL remains immutable. These are individual, fail-closed exceptions;
the generic migration safety validator must continue rejecting procedural SQL,
unrecognized alterations and any different artifact bytes.

| Artifact                                 | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `202611050015_project_collaboration`     | `f9180b9d9656df4d51080ff29eaaf7712b7de92e88881d7fb92e3cce33af4f1e` |
| `202611050016_shared_files`              | `fcdb605c60a9a3b26d0b23fc514d1fc5d260495b99d39e619fa9a0cdd9c5d3cc` |
| `202611050017_content_grants`            | `970b160133f24b3b73143856af68683a4d6de25467a054af9e201b9571af222f` |
| `202611050018_personal_project_transfer` | `3f8240636353ff2baa088b4cdfb4a265c8ece3b3b156d608e51bcb5a03dc06bb` |
| `202611050019_shared_lifecycle_effects`  | `4245f472d127bbcfc7d58ca0a4f46029b1b82bd4c579abc05435059441f89c23` |

0015 adds five Project-owned tables: Document, DocumentVersion, Comment,
CommentVersion and Activity. Parent references carry the exact Project and scope;
Task/Goal targets reference the existing association, and document targets have
concrete FKs. A new ProjectGoal unique key supports these references. Document
publication requires a matching version created in its publishing transaction;
its current-version pointer is deferred until commit. Published versions and
activity remain immutable. Mutation triggers preserve identities and enforce
revision advancement. There is no content backfill or data rewrite.

0016 extends the existing StoredFile owner. It relaxes only ownerUserId SQL
nullability, while the new branch trigger still rejects a Personal file without
its owner. The original owner-composite Space FK remains intact. Shared files
require null legacy owner, concrete scope and boundary-local actor, with additional
direct Space/scope/actor FKs. ProjectFile has typed parent FKs. No private bytes or
keys are migrated; existing object keys and metadata remain unchanged.

0017 changes exactly ResourceGrantOffer_capabilities_check,
ResourceGrantOffer_check5 and SharedUsageEntry_feature_check. Each preserves all
old values and adds only this batch's approved comment/file permissions or free
usage features. project_grant_target retains exactly one concrete target, mandatory
read, same-scope keys and target-specific ceilings. It allows no ownership,
membership, export or administrative grant. Existing API input schemas are fixed;
the expanded offer has an additive route.

All artifacts use an atomic transaction, five-second lock timeout and 30-second
statement timeout. Nullability relaxation is catalog-only; new validation and
unique/index creation can scan/lock existing tables. Production-sized timing is
NOT RUN and remains an operator release prerequisite. After Shared files exist,
Personal-only code is not a safe rollback. Prefer a compatible forward correction;
never drop Shared rows or fabricate Personal owners to roll back.

Initial independent rehearsal PASS: an unpredictable owned schema replayed all
38 previous artifacts, seeded Personal User/Space/Task/StoredFile, then applied
these three artifacts. All 126 previous table data sets were unchanged after
excluding the two newly added nullable file columns. All 1,996 prior catalog
constraints were compared: only the explicitly approved StoredFile owner SQL
nullability and three additive checks differ. Personal-null-owner mutation is
still rejected with 23514. Empty replay/introspection PASS. Evidence:
`.tools/p207-preservation.json`, `.tools/p207-ddl-review.log`.

Final populated prior-batch fixture, interruption/rollback/resume, repeat deploy,
API compatibility and adversarial integration gates remain pending. This review
does not authorize deployment or Shared activation.

0018 adds ProjectTransfer: an immutable metadata-only manifest, explicit consent,
creator admission/generation, current authorization version, hash, 30-minute expiry,
fresh provider verification evidence and terminal idempotency. Source Space uses
SET NULL on Personal erasure; no live User FK or Personal content is retained.
The existing source trigger retains every Personal/shared shape rule and permits
only a Personal-to-shared transition listed in the applying manifest of the same
transaction, before expiry and within five minutes of reauthentication. It does
not permit arbitrary spaceId patches or shared-to-shared movement. Task history's
temporary cascade branch is allowed only by that applying manifest; a new deferred
commit trigger revalidates the final complete shape, with no manifest exemption.

Exactly three existing FKs become DEFERRABLE INITIALLY IMMEDIATE:
TaskChange_spaceId_taskId_fkey, TaskChange_scope_fk and
Goal_spaceId_id_metricId_fkey. Apply defers only these names. Their referenced
columns, targets, uniqueness and ON UPDATE/DELETE actions stay identical. No owner
composite, financial or general Personal constraint is relaxed. The independent
126-table / 1,996-constraint rehearsal was repeated after 0018: PASS with only
these three timing additions beyond the previously listed exceptions. Runtime
source transfer, failure rollback and privacy tests passed in the final integration gate.

0019 adds minimal system lifecycle evidence, separate from human attribution and
Personal actor-wide audit deletion. Its single composite FK binds the exact job,
custody and generation; a new job unique key supports it. Evidence has no User,
content, filename, object key or recovery proof. UPDATE/DELETE is forbidden.
This supplies atomic confirmation for signed system effects, including a final
source deletion, without inventing a human actor for cleanup.

Three existing immutable functions gain a DELETE-only branch:
project_execution_immutable, task_field_immutable, task_workflow_immutable.
All UPDATE prohibitions remain. Deletion requires the independent PROJECT custody
to be PURGING, its current matching-generation job to be PURGING, a live lease,
the ended recovery window and zero effective full memberships. No configuration
flag, request field or session by itself authorizes retained deletion. The owner
facades verify the transaction-local lease proof before bounded database work.

All five artifacts replay and preserve the same 126 old table data sets and
1,996 old constraints, with only the previously enumerated differences: PASS.
The complete final FK catalog contains 354 references. The 75-table owner cleanup
schedule has no backward reference across its dependency stages. Personal-only
references stay under their existing Personal owner/branch constraints; only
Calendar's typed Shared Task bridge is unlinked, preserving its private block.
The catalog digest is
`2afe5521e255950c95a12fb9121b0410a02d8312181c66d5c286e233ad7e0518`.
Any new or changed FK blocks cleanup before file planning until its source-owner
disposition is reviewed. This is a restrictive runtime check, not a migration
safety exception. Evidence: `.tools/p207-fk-catalog.json` and the independent
`.tools/p207-purge-review.ts` result (354 references, 75 tables, no backward stage
reference). End-to-end lifecycle passed, including recovery, bounded 25-file
passes, hold/release, unknown-reference blocking before byte removal and final
source deletion preserving Personal data.

The mandatory populated upgrade chain passed from P1-12 through M09. Its final
M08 fixture includes risk history, published template/version, change plan/source,
capacity/allocation, report snapshot/source and shared work log, in addition to
prior workflow/approval/field/DAG/assignment/Personal data. All 126 old table data
sets and 38 migration checksums match after upgrade. All 2,002 prior constraints
(1,996 domain plus six migration-ledger constraints)
match except the exact owner-nullability branch, three additive CHECK extensions
and three FK timing changes listed above. Every new artifact was first executed
with its final COMMIT replaced by ROLLBACK, comparing catalog/data afterward,
then deployed and repeated successfully. The historical P1-to-current rehearsal
also compares its 139 original FKs, accepting only the named reviewed timing
suffixes while retaining exact columns, targets and actions.

Commands: `pnpm db:migrations:check` PASS after updating that historical timing
expectation; `pnpm quality` executed once with affected test reruns documented in
[the implementation report](p2-07-report.md). No historical SQL bytes changed.
No production database was accessed or modified. Production-sized DDL timings,
Docker release and actual off-host restore remain NOT RUN release gates.
