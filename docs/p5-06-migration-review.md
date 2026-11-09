# P5-06 migration review

M044: `202611090044_communication_privacy_lifecycle`.
SHA-256: `a05429dd0f87624bd226d510686a30b55266de7834e8142fda5f8f44889d8f96`.

Three owner-private tables store contact clocks, account-pair block state and
idempotent commands. Six actual FKs enforce Personal ownership, a distinct target,
nullable source conversation reference and command ownership. Conversation disposal
sets only the private reference to null; pair blocking persists independently.
Personal erasure removes the namespace under its existing independent
Personal ErasureControl claim/replay fence; it requires no Shared activation.

`MessageProgress.receiptConsentAt` is nullable with no consent backfill. A pair
restriction epoch prevents old queued contact and shared receipt signals from
resuming automatically on unblock. Original message/media bytes are not rewritten.

The existing SQL purge guard gains only the two approved independent custody kinds.
Message and meeting immutable-history triggers allow bounded deletion only under
actual current generation, lease, expired recovery and zero effective membership.
A caller session flag cannot supply that proof. The sole update exception resets
an eligible meeting approval cycle to DRAFT/null approval/null finalization; it
cannot change content, authorship, identity, revision or ownership. Announcement
history gains no update exception. AnnouncementTarget resolves custody through
its version and announcement, with the identical actual claim guard. Existing
ordinary SQL immutability remains.

No historical migration, business row, retention default, provider or production
policy is changed. Missing policy, holds, retained protected classes, active parent,
outside live references and unreviewed FKs remain restrictive. The final catalog is
68 migrations, 238 domain tables plus ledger, and 766 FKs with digest
`5a1b650b7cca7dec58699c9aff14e8354e58f73b9983f7ad55ce53e0a578792a`.

Populated upgrade rehearsal preserves all 235 predecessor table datasets, 67 old
checksums and every previous constraint, verifies function/data/constraint rollback,
repeated deploy, empty new block tables and null historical consent timestamps.
Integration tests separately prove ordinary immutable history and actual eligible
conversation/finalized-meeting cleanup. Only fresh owned acceptance databases and
schemas are used. Earlier owned prototypes, including a failed draft deployment,
are preserved; no published or protected database is reset or repaired.
