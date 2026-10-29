# P1-11 completion evidence

Batch: P1-11 — Analytics, Insights & Gamification.
Status: COMPLETE for the approved local development scope.

P1-10 was pushed normally as `6c5a6220b8cd08c49bd514e4494d94c794011699`;
local main, origin/main and the actual remote branch matched with zero ahead/behind
before starting P1-11. Its accepted implementation and pinned artifacts were retained.

## Scope and invariants

Implemented all six Insights route families and Rewards achievements, progress,
preferences and bounded recalculation. Analytics use owner-exported read facades,
one consistent snapshot, canonical definitions, exact ratios/money, explicit local
periods, preceding-period comparisons and evidence-only explanations. No source
records are copied or mutated for analytics. Journal/Mood are never queried;
Finance overview inclusion requires explicit consent. No cache or new scoring model.

Optional prospective rewards use append-only positive XP with unique event and
semantic identities, exact totals, private cursor pages and the three approved
participation badges. Account owns revisioned preferences; the existing worker
handles a separate reward outbox cursor, bounded backoff and safe failures. Source
mutations remain committed if rewards fail. New Habit revisions link atomically
to their exact source event; earlier rows and historical values stay unchanged.

Only AchievementDefinition, AchievementUnlock and XpLedger are new entities.
Two additive migrations add their constraints/indexes/catalog and scoped nullable
Habit event provenance, plus account/outbox fields. No dependencies, new worker
process, queue-schema changes, Better Auth changes or P1-12 functionality.

## Decisions and migration review

ADRs 0020 and 0021 are explicitly owner-approved. ADR 0021 permits only the exact
catalog migration hash; the generic ban on INSERT and destructive migration forms
remains active for other files. The first migration was applied before its seed
form was accepted by the generic gate; owner review was then requested and obtained
before further migration-gated tests. No reset, failed migration or destructive
recovery occurred. Initial migration preservation verified all sixty previous
application tables, columns and rows in development/test.

All twenty-two applied migration checksums match development and isolated test,
with no unfinished migrations. Earlier twenty files remain byte-identical. New
migration SHA-256 values:

- `202610290004_p1_11_analytics_rewards`:
  `afd24e0261ca1dafdb6aa71b76c0ed36013e7f11896dfd8ad8d601abcd976b57`.
- `202610290005_p1_11_habit_event_provenance`:
  `2345bd574b0a8caf0683711c87478229156f866b016cfcdfd91870782b85b7e7`.

The reviewed pg-boss version-46 schema and artifact SHA-256 remain unchanged:
`33395ea7aaf8d17f4eceec23c45fcb6672a278f11d3c1a255d8589491278e238`.

## Verification

- Targeted domain/contract/migration-guard tests: 24 passing in three files.
- Targeted P1-11 integration tests: 26 passing, including canonical Goal reads
  and IANA timezone alias attribution at summer midnight.
- Coverage includes empty denominators, moved dates, historic completion dedup,
  preferences/timezones, DST gaps/folds, current versus immutable Goal history,
  exact currencies/fees/reversals, planning distinct counts, Habit corrections,
  opt-in/disable/re-enable, badge thresholds/recalculation, consumer retries,
  cross-user/cross-space denial, ledger constraints and full 10000-Task aggregation.
- Volume fixture setup/cleanup is atomic on an isolated administrative connection;
  PostgreSQL statistics refresh after bulk load. API deadlines, test deadlines,
  coverage and exact density assertions remain unchanged.
- Final `pnpm quality`: PASS, all thirteen stages; 731 passing tests in 72 files
  (377 unit/contract/architecture/compatibility in 54 files; 354 PostgreSQL
  integration tests in 18 files). Empty-schema, P1-10 upgrade/preservation and
  repeated deployment checks pass without resetting configured databases.
- Final `pnpm smoke:p1-11`: PASS. Compiled API/worker restarts, persisted analytics,
  durable XP catch-up with the owned backlog fully settled, semantic duplicate
  prevention, retained badge state, private ownership and idempotent recalculation
  replay after restart all pass. Existing Task completion retains revision-based
  conflict behavior rather than inventing a new replay contract.
- The strengthened compiled-smoke completion check was separately typechecked,
  linted, formatted and executed after the quality gate. Production code remained
  unchanged; no unnecessary full-suite repetition.
- Application migration/queue checksums: PASS in development and test.
- Docker/production deployment checks: DEFERRED to deployment as instructed.

The initial quality run exposed old batch guards that still forbade newly approved
Insights/Rewards routes and expected twenty migrations, plus two historical fixture
expectations. Those checks now positively require the approved new routes while
retaining earlier signature/security and P1-12 exclusions. Habit constraint fixtures
clear copied event provenance so the original ownership/checkbox constraints remain
the asserted failures; Journal tests verify actual private-data exclusion in the
new Insights endpoint. No assertion, coverage or deadline was relaxed.

## Git and remaining boundary

All 91 changed/new files were reviewed: source, contracts, two migrations, tests,
approved ADRs and documentation only; no secrets, environment files, private data,
uploads, database files, build artifacts or unrelated work. Index remains empty.
P1-11 remains uncommitted and unpushed; HEAD remains the pushed P1-10 baseline.
No unapproved deviations or outstanding blockers. ADR 0021 is the sole narrow
migration-form exception; the general gate remains strict.
Next eligible batch: P1-12, NOT STARTED.
