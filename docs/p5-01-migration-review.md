# P5-01 additive migration review

Artifact: `prisma/migrations/202611080040_messaging_foundation/migration.sql`.
SHA-256: `1547e55d69c31442b7900819a5587036bf304fc0971a4410ac02dda68f9674f5`.
Authority: owner-authorized P5-01 and the admission/permission/history decisions in
ADRs 0044/0045. No published migration was edited.

M040 adds five tables: Conversation, ConversationMember, ConversationAdmission,
ConversationInvitation and ConversationMessage. Eighteen new foreign keys enforce
concrete Project/Team/Company sources, source scope, custody-local attribution,
source admission intervals and same-conversation message authorship. Unique
constraints protect creation keys, fixed member identity, admission generations,
one open interval, one pending invitation per recipient, committed sequence and
per-sender send keys. CHECKs bound text, states, revisions, timestamps and typed
source branches. No copied User/profile field or User-delete cascade is added.

Two existing CHECKs are expanded while retaining every old literal:
SharedCustody kind adds CONVERSATION; SharedUsageEntry feature adds three Messaging
growth keys. These are discriminator/catalog expansions. No old row, column, FK,
index, function or trigger is removed or rewritten. The SQL transaction has a
five-second lock timeout and 30-second statement budget. The reviewed hash gate
recognizes exactly this artifact; generic destructive/procedural SQL rejection is
unchanged. Prisma represents all new columns, keys and relational constraints;
partial indexes and additional CHECKs remain explicitly SQL-owned.

Independent creation requires a separately configured retention policy explicitly
applicable to CONVERSATION. The existing shared-recovery invariant is retained;
no retention policy or message-disposal duration is seeded. No message purge or
custody transfer is activated. Source cleanup uses the Messaging owner's guard
and pauses at BLOCKED_POLICY / MESSAGING_RETENTION_PENDING before destructive work
when a conversation exists. Other source cleanup is preserved. The reviewed
cleanup catalog advances from 637 to 655 FKs, digest
`7bebd8a898d2756304e4c828764949aea2d3c8ec73c1078c6b21882fdb684b3a`.

The canonical local baseline procedure creates a new unpredictable
`p501_acceptance_*_test` database, verifies nonexistence before CREATE, deploys all
64 canonical migrations twice, checks status and every ledger checksum. Its
selection is in ignored `.tools/p5-01-approved-baseline.json`; credentials never
appear in evidence. It does not change protected environment files or repair the
old M031 ledger. The old target remains excluded from acceptance. Independent
preservation checks compare all 190 legacy datasets (including its ledger) and
column/constraint/function/trigger/index catalogs to the prior accepted snapshot.

`tooling/testing/messaging-upgrade.ts`, chained after the existing M039 rehearsal,
compares all 189 populated predecessor datasets, 63 prior checksums and every old
constraint. A forced interruption at the final statement must roll back all DDL;
normal deployment and repeat deployment must preserve the same data. The exact
655-FK catalog and 195-table result (194 domain tables plus ledger) are asserted.
The final migration-stage result is reported in the P5-01 acceptance report.

Rollback: an interrupted M040 transaction rolls back completely. After Messaging
writes exist, do not drop the new tables or automatically downgrade application
code; older workers do not understand the new custody kind/catalog. Keep Shared
activation disabled and use a reviewed forward fix, preserving messages and signed
control evidence. Any future destructive contraction requires a separate reviewed
plan and authorization. No production or existing development database is migrated
by this batch's verification.
