# P2-02 migration review

The owner expressly authorized P2-02 local implementation on 2026-11-04. This
review covers M04, not deployment or production database changes.

| Artifact                                                     | SHA-256                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `202611040004_shared_invitations_and_handover/migration.sql` | `9d9929cb63f67223b9982214292d823b15399a0a4ee90de3ffb4952a59604453` |

M04 adds ContextInvitation, OwnerHandover and SharedRateLimit, bringing the schema
to 84 models, 85 tables including the Prisma ledger, and 28 migrations. Existing
Personal/kernel data and all 27 historical migration files are unchanged. Two
additional composite unique constraints on ContextAccess support exact typed
scope/admission/actor foreign keys. No source ownership or attribution is relaxed.

Invitation constraints enforce one pending recipient representation, all-or-none
recipient admission snapshots, supported membership roles/states, seven-day
lifetime, cleared terminal recipient PII, and accepted actor/access/generation
coherence. The stable recipient User FK is RESTRICT; the identity-owner erasure
path removes pending links and email before deleting the identity. Proofs are
SHA-256 digests, with no plaintext delivery stored. Immutable interval FKs prevent
an offer from changing its admission generation history.

Handover constraints bind both named full admissions and their generations, record
expected custody revision and acceptance evidence, and allow only one pending
offer per custody through a partial unique index. Accepted provider reauthentication
must be within five minutes of the terminal timestamp. Rate windows use database
time and keyed digests, with bounded expired-row cleanup. No Team/Company or
untyped resource target is introduced; concrete grants remain M05/P2-03.

## Locking, recovery and compatibility

The SQL is one explicit transaction with five-second lock and thirty-second
statement timeouts. ALTER TABLE and unique-index construction on existing
ContextAccess require locks; no zero-lock or production-volume timing claim is
made. New-table indexes initially cover no rows. Before any later deployment,
review backups, compatible binaries, existing checksums/constraints and a controlled
one-off migration window. Shared activation independently requires immutable
operator retention configuration, independent signing/checkpoint configuration
and security acceptance. This migration provisions none of those settings.

An interrupted transaction rolls back atomically. Inspect Prisma ledger/error
state before a controlled resume or reviewed migrate resolve; never reset a real
database. Repeat deployment is a no-op. Before any offers exist, compatible kernel
code may ignore the additive tables. Once offers exist, use code that understands
their identity-erasure links and pending succession; an old binary may fail
identity deletion on the new RESTRICT FK. Prefer compatible rollback or forward
correction. Do not drop shared records or restore stale authority without current
independent restrictive evidence.

`tooling/testing/reviewed-collaboration-migration.ts` permits only this exact
filename/hash for the transaction/CHECK/index SQL; altered or renamed bytes fail.
Generic migration rejection remains in effect for other artifacts. No dependency,
provider-owned scalar or production startup migration policy changes.

## Evidence

`pnpm db:migrations:check` retains existing baseline/kernel checks and runs
`collaboration-upgrade.ts` in a newly owned isolated test schema. The populated
fixture includes Personal data, active/closing custody, memberships/history,
policies, receipts, lifecycle jobs, retry work, audit/outbox and usage. The check
compares every row of all 81 pre-M04 tables, every existing constraint definition
and all 27 checksums; executes the exact M04 with ROLLBACK; then resumes via Prisma
and repeats deploy. A local report records elapsed time and artifact hash.

Integration tests additionally reject cross-scope/admission/actor mismatches,
malformed snapshot/terminal/reauthentication evidence and competing pending
handovers, while observed-lock race tests verify application fencing. Application
of reviewed migrations is limited to the guarded isolated `_test` database and
owned random test schemas. No development or production database was changed.
Final command results and local evidence paths are in `p2-02-report.md`.
