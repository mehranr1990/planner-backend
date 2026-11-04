# P2-03 M05 migration review

Owner authorization: explicit P2-03 local implementation continuation, 2026-11-04.
No deployment or production database change is authorized.

Artifact: `202611040005_project_core/migration.sql`.
SHA-256: `5a29820af8fcc16750225073b188930395be9c2d75e14f53b48e2f34a9592fca`.

Adds eleven tables: Project, ProjectPhase, ProjectSection, ProjectMilestone,
ProjectTask, ProjectGoal, ProjectMemberAssignment, ProjectGrant, TaskGrant,
GoalGrant and ResourceGrantOffer. Result: 95 models, 96 tables including Prisma's
ledger. Existing 28 artifacts remain immutable.
The companion `202611040006_project_usage_features/migration.sql` extends only the
SharedUsageEntry feature CHECK for `task.shared`, `goal.shared` and
`shared.resource-grant`, preserving both prior keys and every row. Its SHA-256 is
`0b59cc2b1bf0a859e9e7cfc85c139b609dad845c5c5a66d437a81be124465639`.
The ordering companion `202611040007_project_structure_order/migration.sql` adds
three `(spaceId, scopeId, projectId, position, id)` indexes for structural lists.
Its SHA-256 is
`c3cac1e0377aef405e245ae797dec250afa7ee331f9a84cf910a768fde31c35b`.
The compatibility companion
`202611040008_project_personal_compatibility/migration.sql` preserves Personal
creator-attribution edits independently of Space ownership while retaining strict
branch validation and immutable shared custody/attribution. Its SHA-256 is
`1243f18cbe17f1a2a9959f21a16b2332150b8395eec0f067dbdf9a1450569965`.
There are 32 migrations. All four artifacts deliver M05; no P2-04 assignment M06
work is included. Artifacts were not edited after their first isolated deploy.

Task/Goal legacy creator and TaskChange actor columns become nullable only with
strict Personal/shared branch triggers. Personal attribution remains nonnull;
shared sources require boundary-local actors, direct custody/scope FKs and a real
Project. The exact old Personal-only Task trigger is replaced; other Personal-only
source guards and all historical owner-composite FKs remain. Existing rows retain
IDs and data, with new shared columns null. Goal receives a mandatory direct Space
FK, preventing nullable legacy attribution from bypassing custody integrity.
Scope/actor/parent and association FKs enforce concrete same-boundary relationships.

The old grant-envelope rejection is replaced with deferred exactly-one-target
checks on both the envelope and each concrete target. Targets are immutable;
target-specific capability checks reject unsupported broad powers. Grant issuer
and grantee scopes and immutable admission generations have real composite FKs.
Accepted resource offers must match their recipient actor, issuer, exact target,
capabilities and expiry. Offers store hash-only delivery proofs and local actor
IDs; they add no retained live User FK or copied profile/email.

DDL runs in one explicit transaction with five-second lock and thirty-second
statement timeouts. FK/CHECK validation, unique-index construction and trigger
replacement require table locks. No zero-lock or production-scale performance
claim is made. Exact filename/hash review is registered without weakening generic
SQL rejection. Schema changes are exercised only in guarded isolated test schemas.

Before any later production application, review backups, all historical checksums,
precondition counts, compatible binaries and a one-off migration window. Interrupted
M05 rolls back atomically; inspect the Prisma ledger before controlled resume.
Repeat deploy must be a no-op; do not reset a configured database. Before shared
writes, compatible Personal code may ignore additive columns. After shared source
writes, use a compatible rollback or forward correction: old binaries do not
understand nullable shared attribution, concrete grants or Project lifecycle.
Never drop shared data or restore stale authority over current independent control.

Mandatory evidence: populated P2-02 upgrade preserving all 84 old table data sets,
all 28 migration checksums and old constraints except the three explicitly reviewed
attribution NOT NULL branches and the single feature CHECK extension; interrupted
rollback/resume/repeat deployment, empty
replay, typed target and branch adversarial tests, fenced source/revocation races,
and Personal compatibility/erasure regressions. Final results belong in the batch
report. Operator retention, signing/checkpoint, security and operational activation
prerequisites remain separate; this artifact installs none of them.
