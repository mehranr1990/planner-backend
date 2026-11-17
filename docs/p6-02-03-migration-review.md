# P6-02/P6-03 migration review

Migration: `prisma/migrations/202611170077_social_activities_expenses/migration.sql`
SHA-256: `67ee637060542f1af5d65d9a3f66daf3d638ba9a2d7f47154e0897e77b563a46`

- Purely additive: 14 `CREATE TABLE`, `CREATE [UNIQUE] INDEX` and
  `ALTER TABLE … ADD CONSTRAINT` statements in one transaction. It passes the
  generic `assertAdditiveMigration` review (no DROP/UPDATE/DELETE/procedural SQL).
- No existing table, column, row or historical migration is changed. Historical
  migration bytes are unchanged (`git diff -- prisma/migrations` is empty).
- Tables: `SocialActivity`, `SocialActivityParticipant`, `SocialActivityItem`,
  `SocialActivityTaskLink`, `SocialActivityPoll`, `SocialActivityPollOption`,
  `SocialActivityPollVote`, `SocialActivityBusy`, `SocialNotice`, `SocialExpense`,
  `SocialExpenseRevision`, `SocialExpenseShare`, `SocialSettlement`, `SocialAuditEvent`.
- Integrity: composite same-Activity FKs for items, assignees, creators, votes,
  busy snapshots and Task links; same-poll chosen option and same-expense effective
  revision (deferrable composite FKs); exactly-one-context CHECKs for expenses,
  settlements, notices and audit; seat/RSVP shape CHECK; positive bigint money,
  ISO currency shape and scale bounds; one pending revision per expense (partial
  unique index); settlement payer ≠ payee; disputes must carry a note.
- User links are `ON DELETE SET NULL` (notices `CASCADE`), so raw identity removal
  cannot delete shared financial history; the Social PersonalData owner detaches
  them explicitly during erasure.
- Group deletion cascades to Group Activities and ledgers, matching existing
  Social Group purge semantics governed by its retention policy.
- Migration gate table count updated from 322 to 336.
- Rollback: application rollback only before new writes; afterwards retain the
  additive schema and roll forward. No configured database was migrated or reset.

## 202611180078_social_gap_closure (ADR 0060–0062)

SHA-256: `50a8af79a25c2713581938e328d14785630967267a93faaeb43b5c70ab0fcccd`, pinned in
`tooling/testing/reviewed-social-gap-migration.ts`. Migration 0077 is unchanged
(it had already been applied to the configured isolated test database, so its
bytes are frozen; SHA-256 above still matches).

- Additive: nullable/defaulted columns on `SocialActivity` (managed chat flag,
  nominee, orphan/deletion/recovery/disposal timestamps) and `SocialActivityItem`
  (deletion/recovery), Messaging-owned `Conversation.sourceKind/sourceId` with a
  unique pair and a shape CHECK, and the Finance-owned `FinanceExternalPosting`
  table (FK to `Transaction(spaceId,id)`, CASCADE inside the Personal space).
- Reviewed replacements: `SocialActivity_state_check` (adds `DELETED` with its
  recovery shape) and `SocialNotice_kind_check` (adds two kinds). Both only widen
  the accepted set for existing rows.
- FK catalog: 1,107 → 1,109 reviewed edges; table count 336 → 337.
- Gate: `pnpm.cmd db:migrations:check` PASS (33 rehearsals, historical checksums).
