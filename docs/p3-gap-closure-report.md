# P3-GAP-CLOSURE completion report

Batch: **P3-GAP-CLOSURE**

Status: **COMPLETE within the owner's amended scope**

Date: 2026-11-16

All 20 non-deferred capabilities are implemented or supported by existing
engines. TB-3 is **DEFERRED BY OWNER**, not blocked. No next batch was started.

| Requirement                           | Final classification                                    |
| ------------------------------------- | ------------------------------------------------------- |
| TB-1 MAYBE RSVP                       | IMPLEMENTED                                             |
| TB-2 Weekly Team capacity             | IMPLEMENTED                                             |
| TB-3 Dedicated member transfer        | DEFERRED BY OWNER                                       |
| TB-4 Invitation management            | IMPLEMENTED                                             |
| T-AV Member availability              | IMPLEMENTED                                             |
| TB-5 Project association approval     | IMPLEMENTED                                             |
| TB-7 Assignment withdrawal            | IMPLEMENTED                                             |
| T-VIS Team Task visibility            | IMPLEMENTED                                             |
| T-CROSS Cross-Team workload           | IMPLEMENTED                                             |
| TB-6 Sprint burndown                  | IMPLEMENTED                                             |
| T-POINT Story-point capacity          | IMPLEMENTED                                             |
| T-VELOCITY Sprint velocity            | IMPLEMENTED                                             |
| T-SPRINT Sprint history               | IMPLEMENTED                                             |
| TB-8 Linked Project Calendar          | IMPLEMENTED                                             |
| T-LEAVE Pending time-off editing      | IMPLEMENTED                                             |
| T-RECUR Recurring cancellation        | IMPLEMENTED                                             |
| T-RSVP Organizer RSVP summary         | IMPLEMENTED                                             |
| T-FILES Team File Library             | ALREADY SUPPORTED; effective upload configuration added |
| T-ACTIVITY Team activity              | IMPLEMENTED                                             |
| T-ANALYTICS Team analytics            | IMPLEMENTED                                             |
| T-FORECAST Advisory workload forecast | IMPLEMENTED                                             |

The frontend's older TB numbering differs from the request. The reconciliation
is recorded in [execution record](p3-gap-closure-execution.md), with capability
details in [requirements](BACKEND_REQUIREMENTS.md).

## Reuse and architecture

The existing Task, Calendar, invitation, file, notification, scoped authorization,
transactional outbox and audit owners remain authoritative. No competing engine,
new dependency, hosted provider, membership transfer API or automatic Project
admission was introduced. Existing Project creation with ownerTeamId, namespaces,
hierarchy, assignment revert, files, retention and independent permissions remain.

Important changes:

- `teams/application/team-gap.service.ts`, `team-source-views.service.ts` and
  `team-associations.service.ts`: explicit capacity, authorized source views,
  approval orchestration, availability, activity and forecast.
- `team-sprint-evidence.ts` and `team-sprint-reports.service.ts`: transactional
  observations, original/closed commitment evidence, history and velocity.
- Existing Team planning, meetings, operations, analytics and files services:
  RSVP transitions, pending leave editing, withdrawal/reoffer, weekly fallback
  and effective upload configuration.
- Projects' public Team facade: typed association request/review/history and
  narrow reference hints. Spaces: reuse invitation management for TEAM, optional
  safe activity evidence. Calendar: CANCEL_FUTURE in the existing recurrence engine.
- `packages/api-contracts/src/team-gap-closure*.ts`, exported schemas, canonical
  OpenAPI, exact compatibility extensions, focused tests and ADR 0054.

## Contracts, events and jobs

Canonical OpenAPI: **1,092 → 1,117 operations**, including **25 new operations**.
The handoff OpenAPI matches it semantically. All historical signature baselines
remain intact; 18 exact existing request/response hash transitions are registered
in `tooling/compatibility/team-gap-api-extensions.json`. Authentication and required
parameter contracts were not relaxed.

The complete method/path, DTO, pagination, If-Match/ETag and Idempotency-Key
manifest is in [Claude handoff](frontend-handoff/TEAMS_GAP_CLOSURE.md). It includes
invitation management, weekly capacity, availability/forecast, association
request/review/history, Task/Calendar sources, cross-Team workload, point capacity,
burndown/history/velocity, RSVP summary, leave editing, file configuration and
recorded activity. Existing RSVP accepts MAYBE; recurrence accepts CANCEL_FUTURE.
Existing recipient proof retrieval, membership APIs and P2 Project revert remain.

Mutations reuse existing transactional effects, receipts, notifications and
immutable history. New actions cover weekly capacity, association transitions,
point capacity, withdrawal and leave editing. No new job engine or job schedule.

## Entities, migrations and preservation

New additive migrations, applied to **local mehran_test and mehran_dev** after
the owner's explicit finalization approval:

- **M071 — `202611160071_team_gap_configuration`:** explicit weekly capacity and
  revision on member profiles; nullable point capacity and Sprint evidence on
  plans; occurrence keys on meeting invitations; safe scoped activity metadata;
  widened RSVP, withdrawal and time-off history checks.
- **M072 — `202611160072_typed_team_association_requests`:** typed request ID,
  action, state and timestamps on the existing TeamProjectReference; unique request
  identity, pending lookup index and state-shape constraint. Earlier request
  metadata is copied without removal and remains non-authoritative historical
  metadata. Workflow state is not maintained in JSON.

No new tables or FKs. The exact **970-FK** fail-closed cleanup catalog is unchanged.
Migration rehearsals preserved populated predecessor datasets, verified typed
request backfill, interrupted rollback and repeat deployment. M071–M072 and all
95 original migration SQL files match their applied checksums.

M071's draft nullable point CHECK initially rejected WEEK plans. The owner's
explicit exception authorized backup/restore of mehran_test only. A full dump was
actually restored and compared across all 301 tables and 96 ledger rows. The
verified predecessor restore preserved all seven existing public business records,
the exact original 95 migration ledger entries/checksums and all other test
schemas; corrected M071 was then applied through normal Prisma deployment.
No checksum was edited to claim an unapplied SQL change had occurred.

Verified backup and manifest remain Git-ignored at
`.tools/p3-test-recovery/77aff773-71d7-4d78-b0ec-31b2d468c4a9/`.
See [execution record](p3-gap-closure-execution.md).

Final database verification after normal `pnpm.cmd db:migrate:deploy` applied only
M071–M072 to local mehran_dev:

| Database    | Applied migrations | Checksum mismatches | This batch's writes                                        |
| ----------- | ------------------ | ------------------- | ---------------------------------------------------------- |
| mehran_dev  | 97                 | 0                   | Owner-authorized normal deployment of M071–M072            |
| mehran_test | 97                 | 0                   | Authorized test migrations, fixtures and verified recovery |

Both databases have zero pending migrations and zero unresolved failed
migrations. Before/after comparisons preserved all 1,536 existing development
business records, all seven test business records and every original ledger row.
Development's two historical resolved rollback entries remain unchanged; its 97
successful migrations coexist with those records. No reset or checksum repair
was used for development deployment. Production/staging and other databases
were not touched. Private comparison snapshots remain Git-ignored under
`.tools/p3-finalization/`.

## Verification

Final successful quality commands:

| Exact command                       | Result                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd db:generate`              | PASS                                                                                                                                               |
| `pnpm.cmd db:validate`              | PASS                                                                                                                                               |
| `pnpm.cmd typecheck`                | PASS                                                                                                                                               |
| `pnpm.cmd lint`                     | PASS, zero warnings                                                                                                                                |
| `pnpm.cmd format:check`             | PASS                                                                                                                                               |
| `pnpm.cmd architecture`             | PASS, 652 modules and 4,452 dependencies, zero violations                                                                                          |
| `pnpm.cmd openapi:check`            | PASS, 1,117 operations and 10,392 resolved references                                                                                              |
| `pnpm.cmd build`                    | PASS, contracts and production API build                                                                                                           |
| `pnpm.cmd test --testTimeout=60000` | PASS, 175 files / 780 tests                                                                                                                        |
| `pnpm.cmd db:migrations:check`      | PASS, populated upgrades, typed request backfill, 13 interruption rollbacks in the gap upgrade chain, repeated deployment and exact 970-FK catalog |
| `git diff --check`                  | PASS                                                                                                                                               |

The 60-second test timeout accommodates the existing dependency-cruiser negative
probe on this Windows host; its assertions and required coverage are unchanged.
Initial failures were fixed and affected checks rerun; no tests were weakened,
removed or bypassed.

Finalization reran the unit/contract/architecture/compatibility suite successfully:
**175 files / 780 tests**. The relevant integration suites then passed together:
**eight files / 170 tests** (182.23 seconds), including existing Project work and
Personal Calendar compatibility:

```powershell
pnpm.cmd test:integration apps/api/test/integration/team-completion.spec.ts apps/api/test/integration/teams.spec.ts apps/api/test/integration/team-interactions.spec.ts apps/api/test/integration/team-analytics.spec.ts apps/api/test/integration/team-work.spec.ts apps/api/test/integration/team-lifecycle.spec.ts apps/api/test/integration/project-work.spec.ts apps/api/test/integration/calendar.spec.ts
```

Earlier implementation runs exposed the corrected CHECK, sparse-row,
proof-status, DTO, cursor and typed-review wiring defects. Required assertions and
coverage were preserved. Finalization also corrected report-table formatting;
the formatting gate then passed.

Coverage includes authorization, cross-scope denial, private-field redaction,
revisions/replay, proof rotation, RSVP transitions/occurrences, cancellation,
unknown capacity, dated overrides, DST, pending leave edits, original/closed Sprint
evidence, independent association authority, actual next-page traversal and hidden
Project work-item history, plus existing file and lifecycle invariants.

NOT RUN: browser/E2E tests, production/live verification, Docker release checks,
Shared activation and the entire repository integration suite. The requested
relevant integration suites were run; no deployment or container change occurred.

## Security, limits and handoff

Capacity stays UNKNOWN without explicit configuration. Dated null/zero values
override weekly configuration. Minutes and points remain separate; private
Personal schedules, Focus data and event contents are never imported. Reports use
current independent source authority before aggregation. Removed Project-backed
work references retain their authorization boundary in history; query-bound opaque
cursors do not reveal source details. Proofs, confidential cases, private feedback
and private leave notes are absent from activity projections. Private file bytes
remain behind existing authenticated StoragePort flows.

Sprint reports explicitly use **TEAM_OWNED_TASKS**; Project read-through work keeps
its independent source and estimate model. Missing legacy evidence remains
INSUFFICIENT_HISTORY/null. Forecasts are advisory and explain their basis and
calculation time: stored Team schedules/estimates, approved leave and visible
explicit Project allocations. Hidden or private work remains UNKNOWN. Independent
Team budgets do not establish global Personal capacity; cross-Team aggregate
capacity stays unknown for multiple Teams. No automatic rescheduling occurs.

Claude must wire the twelve areas and exact operation manifest in
[TEAMS_GAP_CLOSURE.md](frontend-handoff/TEAMS_GAP_CLOSURE.md), including recipient
proof retrieval, Team/Project permission separation, response revisions, unknown
states and the TB-3 deferral. No frontend code was modified.

Deviations from approved scope: none; the verified isolated restore was explicitly
authorized after the draft CHECK defect. Outstanding blockers/ADRs: none for this
batch. Operational activation and later work require separate authorization.

Git: branch main; implementation baseline
`1e2a36fd4ff4bf8e5ce875fbd973740b42450ddb`. The owner subsequently approved
local development migration, final verification, commit and normal push to
origin/main. This report accompanies that approved finalization commit; its exact
hash and remote verification are reported to the owner after push. No reset,
checkout, stash, revert, clean, force push or history rewrite is authorized.
Next batch: **NOT STARTED; not authorized by this completion report**.
