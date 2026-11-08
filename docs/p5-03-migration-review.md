# M042 media, receipts and notices review

Migration: `202611080042_messaging_media_receipts_notifications`.
SHA-256: `66210c92ed0e06fb7e60afb5041952b868d88553f52c24c647533e16b8f729d9`.

One explicit transaction adds nine tables, seventeen FKs, two private consent
columns/default-off constraints and a conversation/invitation unique identity.
Tables: MessageAttachment, MessageMedia, MessageMediaRevision, MessageProgress,
MessageNoticePreference, MessagePersonalMutation, MessageActivity, MessageNotice,
MessageNoticeAttempt. The final domain catalog has 214 tables (215 including
Prisma's ledger), 698 FKs and 66 canonical SQL migrations.

The sole replacement of a published CHECK is MessageEntry_shape: it preserves
the TEXT/FORWARD, ordering, admission, removal and thread predicates exactly and
adds only a MEDIA branch whose text/source references must be null. No existing
SQL is rewritten. Existing rows, columns, bodies and earlier checksums are
preserved. This is the additive branch expansion authorized by ADR 0047, pinned
by complete migration hash in the static safety reviewer.

Typed links enforce same-conversation admission/message/activity identity and
same-space/scope StoredFile references. File ID equals attachment ID. Receipt
counters are nonnegative and read≤delivered. Quiet intervals and operational
notice/attempt states are checked. Media revisions are immutable. Subscription
deletion only nulls the optional attempt reference, allowing personal erasure
while preserving retained operational evidence.

Two narrowly named INSERT triggers create metadata-only future MessageActivity
rows for new MessageEntry and ConversationInvitation rows. No historical activity
or push backlog is backfilled; triggers never send external effects.

The upgrade rehearsal chains after M041, populates every M041 relation and
snapshots all 205 predecessor datasets and 65 ledger checksums. It checks forced
failure before COMMIT and full rollback, ordinary deploy/repeat deploy, all old
constraints except the exact additive CHECK expansion, opt-in-off defaults,
absence of historical activities, legacy text/header/activity atomicity,
immutable media revisions and read≤delivery constraints. Exact FK catalog digest:
`d436234ba7935d306ccbb32ee1d78eeb7a980d52b21e1ed332cb3e8ab73014e7`.
Execution results are recorded in the batch report.

Acceptance uses a fresh unpredictable local test database; an earlier unpublished
prototype baseline is retained untouched. The original M031-drift database and
accepted P4-06/P5-01/P5-02 databases are preserved. Environment files are unchanged.
No reset, historical repair or production schema application is authorized.
Deployment requires a reviewed lock window for the new indexes and constraints;
the migration has explicit lock/statement timeouts. Existing cleanup catalog
guards and messaging retention blockers continue to prevent premature disposal.
