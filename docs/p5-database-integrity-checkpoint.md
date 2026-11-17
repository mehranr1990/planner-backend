# P5 database integrity and publication checkpoint

Date: 2026-11-17 (Asia/Tehran). Authority: the owner's FINALIZE P5 request,
approving the implementation and conditional development migration, commit and
normal push to origin/main. No new tests or quality gates are authorized.

## Read-only findings

The two previously reported checksum discrepancies were reporting errors. The
earlier ad hoc comparison included rolled-back attempts instead of restricting
applied migrations to `finished_at IS NOT NULL AND rolled_back_at IS NULL`.
Both historical attempts have successful successor records with canonical hashes.
No successfully applied migration checksum was mismatched.

Connections were confirmed from configuration and PostgreSQL itself: .env selects
mehran_dev; .env.test.local selects mehran_test; both connect to localhost:5432,
resolved server address ::1, PostgreSQL 18.6, public schema/search path. Effective
environment values match the configuration files. Credentials were not disclosed.
Investigation connections enforced default_transaction_read_only=on and explicit
read-only transactions where multiple queries were needed.

| Migration | Retained rolled-back attempt SHA-256 | Successful/current SQL SHA-256 |
| --- | --- | --- |
| 202610280013_p1_09_finance | `cb4186278e3f90f5cc265b989791b7a05afb52b43819bd69e19b035944cc7a4d` | `e31dcb994b477ec6f737ba48d176f23af84ced52bf9cbc7ae7a07d3783fca6c5` |
| 202610290001_p1_10_notifications | `df5e3a309d2a459432ddf52a3fddb24471171746f6231ab4245abd7e7782f355` | `9ef22bc64e6bbc1df3382bc732b72bae3c3fcad1184d6ff6093342d3d0683524` |

Finance's failed attempt started at 2026-10-28T20:30:13.345Z and was marked rolled
back at 20:39:57.540Z. Its canonical successor finished at 20:39:58.612Z.
Notifications' failed attempt started at 2026-10-28T22:03:00.005Z and was marked
rolled back at 22:03:46.628Z. Its canonical successor finished at 22:03:46.632Z.
The notifications successor has zero applied steps because the earlier approved
recovery completed additive DDL and resolved the migration as applied; the
[P1-10 report](p1-10-report.md) records this explicitly.

The canonical hashes match all of:

- Current migration files and HEAD, byte for byte; LF/CRLF/BOM alternatives do not
  explain the historical attempt hashes and are not needed to establish validity.
- Original published Git versions: finance commit
  `dbe3de6573473321db73a29f5faf9906ce3ee76a` and notifications commit
  `6c5a6220b8cd08c49bd514e4494d94c794011699`.
- The [P1-09](p1-09-report.md) and [P1-10](p1-10-report.md) completion reports and
  the current isolated test database's successful ledger entries.
- The existing verified `.tools/p2-finalize-dev-baseline.json`. Its two historical
  rollback rows, including IDs, hashes and timestamps, are identical to development
  both before and after this checkpoint. Its canonical file hashes also match.

[ADR 0017](adr/0017-iso-currency-minor-unit-authority.md) and the P1-09 report
document the original finance recovery. [ADR 0019](adr/0019-durable-queue-schema-and-channel-adapters.md)
and the P1-10 report document the notifications recovery. These are old completed
recoveries; no repair, resolve command or history modification was performed now.

Before deployment, all 99 successful development entries matched checked-in SQL,
with no duplicate successful migration names or unresolved attempts. Only M075
and M076 were pending. Test had 101 successful matching entries and nothing pending.
The safe-deployment condition in the owner's request was therefore satisfied.

## Authorized normal deployment

Executed `pnpm.cmd db:migrate:deploy`, the existing package workflow invoking
Prisma migrate deploy with .env and prisma.config.ts. It applied only:

- `202611170075_messages_meetings_gap`, SHA-256
  `eee0b1608396ca39305649a60fa572799d5e8e33c45e409779d0f8b51627a5a6`;
  finished at 2026-11-17T10:20:51.003Z.
- `202611170076_announcement_pin_metadata`, SHA-256
  `c8b5756280926d2cce2dfad2795310b062dd03dd03d199612b99a2ac4e957ce6`;
  finished at 2026-11-17T10:20:51.006Z.

The command succeeded. Subsequently,
`node --env-file=.env node_modules/prisma/build/index.js migrate status --config prisma.config.ts`
reported 101 migrations and "Database schema is up to date!".

Final read-only ledger reconciliation:

| Database | Successful migrations | Matching successful checksums | Unresolved | Pending | Historical rolled-back attempts |
| --- | --- | --- | --- | --- | --- |
| mehran_dev | 101 | 101 | 0 | 0 | 2, preserved unchanged |
| mehran_test | 101 | 101 | 0 | 0 | 0 |

No migration SQL, historical checksum or historical ledger row was edited. No
checksum repair, migrate resolve, bypass, reset, rebuild or application-data
command was used. Test was inspected read-only; no migration was applied to it
during finalization. Only mehran_dev received the two authorized schema migrations.

## Git and execution boundary

The successful checkpoint permits the approved P5 implementation and corrected
documentation to be committed with:

`feat(messages-meetings): complete P5 backend gap closure`

Normal publication is to origin/main; the finalization response records the
actual commit and push outcome. No force push or history rewrite is authorized.
No subagents, frontend changes, tests, builds, lint, formatting, quality gates,
migration rehearsals, Shared activation, realtime features, Phase 6 implementation,
production/staging access or production deployment occurred in this finalization.
Existing implementation verification remains recorded in the
[P5 completion report](p5-gap-closure-report.md). No integrity blocker remains.
