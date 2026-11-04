# P2-04 M06 migration review

Owner authorization: continue the approved P2-04 batch after publishing P2-03.
Local implementation and guarded test rehearsals only; no production migration.

Artifact: `202611040009_task_assignment/migration.sql`. SHA-256:
`c0bc4222627cb82f70cdb85a513f70464575494a456a46f0719113c235063e7c`.
All 32 previous artifacts are unchanged. There are now 98 Prisma models, 99 tables
including the Prisma ledger, and 33 migrations. No existing rows are backfilled.

Adds TaskAssignment, SharedAssignmentNotification and TimeBlockSharedTaskLink.
ProjectTask receives a composite source key. Typed source/project/scope, local
actor, admission and immutable generation-interval FKs prevent cross-context or
old-generation substitution. Partial unique indexes allow one current primary and
one current assignment per recipient/source. Ending an assignment retains its
original consent and attribution; a DB history trigger prohibits rewriting it.
Decline requires an explicit nonempty bounded reason and terminal timestamps.
Assignment status is separate from Task status.

Notifications contain only local actor/source IDs, event kind, revisions and
timestamps. They retain no live User FK or copied Task body. Private scheduling
links have exact Personal Space/owner/block and shared Task/scope FKs. Both sides
of block updates enforce mutually exclusive Personal/shared task references,
with the block locked during link validation. Existing TimeBlock timed scheduling,
same-Space Task FK and Personal response shapes remain unchanged. Personal block
deletion cascades only the private link; it never deletes the shared source.

The only replaced historical CHECK is SharedUsageEntry's feature register: retain
all five prior keys and add `task.assignment`. Assignment usage counts retained
records under shared custody; private-link usage is counted from Calendar-owned
rows under the Personal account fence. No commercial denial is enabled.

The SQL has an explicit transaction, five-second lock timeout and thirty-second
statement timeout. Composite-index creation, FK validation and CHECK replacement
take table locks; no zero-lock or production-scale performance claim is made.
Exact filename/hash approval is registered separately; generic procedural-SQL
rejection remains intact. SQL bytes were frozen before integration-test promotion.

The populated M05-to-M06 rehearsal seeds Project structures, shared Task/Goal and
history, source/member associations, all three concrete grants and a pending offer.
It compares all 95 prior table data sets by every pre-upgrade column, all 32 prior
checksums and every previous constraint except the single reviewed feature CHECK
extension. Exact-artifact rollback, resume and repeat deploy are tested in a newly
owned schema. The final report records results and measured local DDL time.

Before any later deployment, review backups, migration preconditions, compatible
binaries and the one-off lock window. On interruption inspect the Prisma ledger
and resume the exact reviewed artifact; never reset a configured database. After
assignment/private-link writes, retain compatible binaries or forward-correct.
Do not drop consent/reference history or restore stale access over current signed
control. Operator retention, signing/checkpoint, security and operational gates
remain prerequisites for real shared activation.
