# M041 advanced messaging review

Migration: `202611080041_advanced_messaging`.
SHA-256: `6de4f5c76e4bea7060a94c7d89771dcb167fb46b2ec549d49f30ee077607a3bb`.

The single transaction adds eleven tables, 26 foreign keys, two Conversation
columns, an additive legacy unique key, checked advanced states, metadata-only
header/change backfills and narrowly named trigger functions. It does not drop,
replace or weaken a published constraint or migration. It does not alter message
bodies, delete records, seed legal retention or activate Shared.

`message_text_header` inserts only identity/time metadata and a CREATE event for
legacy text writers. Its parent counter increment serializes in the same
transaction. Existing message bodies remain under their original checks/FKs.
`message_history_immutable` rejects update/delete on revision, policy, mutation,
moderation and change history. No trigger sends notifications or external effects.

The reviewed static migration allowlist pins the complete SQL hash. Dynamic
rehearsal chains after M040 and populates all five P5-01 tables before snapshotting.
It verifies 194 predecessor datasets, 64 checksums, every old constraint, exact
header/change backfill, forced rollback before COMMIT, repeat deployment and the
681-FK catalog digest
`239451f6a5c4b6d0fedebc41b613c174e39bae9e87047925ff5b2a992f44e267`.
The cleanup guard pins this catalog while existing conversation blockers continue
to stop source disposal before destructive work. Final retention/purge remains
outside P5-02.

Acceptance uses a newly created unpredictable local `_test` database, with all 65
canonical migration checksums validated. An earlier owned development baseline
was retained unchanged when the unpublished source-reference design was refined;
acceptance was recreated in a different fresh database. The legacy M031-drift
database and previously accepted P4/P5-01 databases were never migrated/reset or
repaired. Protected environment files remain byte-identical; child-process
TEST_DATABASE_URL overrides select the current owned baseline.

Applying M041 to a large deployed database needs an ordinary reviewed deployment
window for transactional backfill/index locks. No production migration or Docker
release was performed or authorized here.
