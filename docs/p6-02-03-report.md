# P6-02 / P6-03 report — Social Activities and shared expenses

Date: 2026-11-17. Baseline: `7a027da` on `main` (clean tree before this work).
Status: **P6-02 PARTIAL, P6-03 PARTIAL** — core behavior implemented and verified;
specific approved capabilities are dependency-gated and listed below.
All changes were later committed and pushed as `2020f62` (on `origin/main`); nothing was deployed.

## Phase 6 reconciliation (before implementation)

| Batch                                  | Status                                                         | Evidence                                                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P6-01 Connections, Circles, Groups     | COMPLETE (local + published `7bcc10e`, extended by SOCIAL-I01) | `modules/social` connections/groups services, migration `202611110045_social_foundation`, 560 guarded signatures, `social.spec.ts` (46 tests), ADR 0050 |
| P6-02 Activities                       | NOT STARTED → now PARTIAL                                      | no Activity code/tables existed; SOCIAL-I01 report states "NOT STARTED"                                                                                 |
| P6-03 Shared expenses                  | NOT STARTED → now PARTIAL                                      | no expense code/tables existed                                                                                                                          |
| P6-04 Lending, Lost & Found            | NOT STARTED                                                    | no code, tables or operations                                                                                                                           |
| P6-05 Albums, goals, challenges        | NOT STARTED; albums POLICY-GATED                               | image pipeline/codec approval required (ADR 0051, V3 03, PG-10)                                                                                         |
| P6-06 Cross-context security/retention | NOT STARTED; retention POLICY-GATED                            | no approved Social retention rule (catalog v1)                                                                                                          |

## Implemented

P6-02: independent and Group Activities (ADR 0060 participation model); templates
`GENERAL/TRAVEL/SPORT/FAMILY/GATHERING`; multi-day schedules (≤ 90 days, IANA time
zone); edit/cancel/close lifecycle; organizer/participant roles with last-organizer
protection; verified-contact invitations, Group self-join, Activity-only guests;
RSVP `PENDING/GOING/MAYBE/DECLINED`; capacity with row-locked admission; FIFO
waitlist with 12-hour released-place offers (ADR 0051); itinerary/agenda/checklist
items with Activity-time-zone `localDate`/`dayIndex`; explicit Personal Task creation
from checklist items (Tasks `CaptureTasks` owner); scheduling/general polls with
aggregate-only results and schedule adoption; consent-based busy-only Free/Busy
snapshots from the participant's own Calendar owner; authorized calendar overlay
feed; organizer link to an existing Phase 5 private conversation; per-participant
reminders and a polled Social notice inbox; Personal export/suspension/erasure hooks.

P6-03: Group-level and Activity-level ledgers; proposals by any verified current
Group member or accepted Activity participant (no Group needed for independent
Activities); `PENDING` until approved by authorized approvers (Group Owner/Admin;
Activity organizers plus parent Group Owner/Admin); `EQUAL/PERCENT/FIXED/WEIGHTED`
splits over selected participants with bigint minor units and ADR 0051 remainder
order; immutable revision history with pending corrections that leave the approved
revision effective; per-currency own balances for members, aggregate balances for
approvers; payer-recorded settlements requiring payee confirmation, payee disputes
with a note, payer cancellation; idempotent receipts and row locks against double
application.

## Not implemented / gated (explicit)

- **Personal Finance opt-in posting** — BLOCKED on a missing approved cross-domain
  posting contract (ADR 0060 lists the exact Finance-owned port required).
- **Activity/Group chat context** — only a link to an existing Phase 5 private
  conversation; a Social conversation kind in Messaging is not implemented.
- **Activity file metadata** — DEFERRED (no approved Social file pipeline; ADR 0057).
- **Push/realtime delivery** of notices — not added (polling inbox only, ADR 0044).
- **Retention/closure timers, departure settlement obligations** — P6-06 / owner.
- **Quota/entitlement keys** for Activities/expenses — none approved; bounded limits used.
- Group Activity creation by any active, verified current member — **confirmed by the owner 2026-11-18** (ADR 0060 records it; the rest of ADR 0060 is not ratified).

## Files, schema and contracts

- New: `modules/social/{social-activities.module.ts, application/activity-runtime.ts,
activities.service.ts, activity-planning.service.ts, expenses.service.ts,
domain/split.ts, domain/seats.ts, http/activities.controller.ts}` (+ unit specs);
  `packages/api-contracts/src/social-activities{,-openapi,.spec}.ts`;
  `apps/api/test/integration/social-activities.spec.ts`; migration
  `202611170077_social_activities_expenses` ([review](./p6-02-03-migration-review.md));
  ADR 0060; [frontend handoff](./frontend-handoff/SOCIAL_ACTIVITIES_EXPENSES.md);
  `tooling/compatibility/p6-02-03-social-activities-api-signatures.json`.
- Changed: `social.module.ts` (exports `SocialContext`), Social public index,
  `social-data.ts` (suspend/erase/export), `app.module.ts`, `prisma/schema.prisma`,
  contracts index/openapi, `docs/api/openapi.json`, `tooling/scripts/openapi.ts`
  (new guarded batch), `tooling/scripts/migrations-check.ts` (table count 322 → 336),
  root `package.json` `typecheck` heap (see deviations), Fable handoff pointer.
- OpenAPI: 1,193 → **1,244** operations (+51, all additive); all prior batch
  signature files still pass; 714 new signature hashes frozen.

## Deviations

- Root `typecheck` and `lint` now run with an 8 GB heap; `typecheck` runs `tsc` with `--max-old-space-size=8192`: the root program
  (app + tests + tooling) needs ~4.7 GB after the 14 new Prisma models and exceeded
  Node's ~4 GB default heap. Application build alone uses ~2.6 GB. No type checks
  were relaxed.
- Independent Activities are not `SharedCustody` contexts (ADR 0060 rationale);
  pending owner ratification before Shared activation.

## Stabilization (2026-11-18)

Rate limits (ADR 0058). The four remaining integration failures were obsolete
expectations from before `e217686`, not enforcement regressions:

| Test                                                         | Obsolete expectation                     | Approved behavior now asserted                                                                                                                                                    | Result |
| ------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `communication-lifecycle` › bounds empty recovery polling    | 429 after 20 reads; `Retry-After: 60`    | recovery is a Messages-family read (600/user/min, `RateLimit-Limit: 600`); an exhausted counter returns 429, `RateLimit-Remaining: 0`, `Retry-After` 1–60 s to the next DB minute | PASS   |
| `communication-lifecycle` › multi-device polling burst       | ≤ 30 of 48 reads succeed                 | 48 reads fit the read budget; the device whose budget is exhausted gets 429 (exactly 32 OK / 16 limited); messages and read progress unchanged                                    | PASS   |
| `companies` › invitation decisions / failed-proof throttling | counter key `collaboration.actor:<user>` | key `http:v2:companies:sensitive:actor:<user>` counts the authenticated decision once; the 21st failed proof is still 429                                                         | PASS   |
| `shared-collaboration` › bounded hashed abuse counters       | `request()` resolves `undefined`         | `request()` returns the header state (`limit 30, remaining 29` after window reset); preview 30/IP and sensitive 20/actor limits still reject                                      | PASS   |

No enforcement was weakened and no test was skipped. A genuine gap introduced by
this batch was found and fixed: `/social-activities` and `/social-notices` fell
into the generic Spaces family, and expense/settlement decisions were not
sensitive. They are now in the independent Social family, and
`…/expenses|settlements/{id}/decisions/{action}` are sensitive (20/user/min),
with unit coverage in `collaboration-limit.spec.ts`.

## Verification (final)

| Check                                                           | Classification      | Evidence                                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P6-02/P6-03 integration (`social-activities.spec.ts`)           | PASS                | 13/13, rerun after rate change                                                                                                                                                             |
| Four rate-limit tests (above)                                   | PASS                | 4/4 by name                                                                                                                                                                                |
| `shared-rate-limit`, `auth-rate-limit` suites                   | PASS                | with Activities suite: 19/19                                                                                                                                                               |
| Previously failing integration files (purge/cleanup FK catalog) | PASS                | 10 files + Activities: 351/355 before rate fixes; the 4 remaining are now PASS                                                                                                             |
| Full integration suite in one run                               | NOT VERIFIED        | not rerun in full after fixes (affected files only, per instructions)                                                                                                                      |
| Domain units, contract spec, `collaboration-limit` unit         | PASS                | 10/10, 3/3, 23/23                                                                                                                                                                          |
| Unit/contract/architecture/compatibility (`pnpm test`)          | PASS                | 845/848 in one run; the 3 failures were 5 s/15 s timeouts in whole-OpenAPI contract tests under parallel load; rerun alone 7/7 PASS (1.1 s, 1.1 s, 2.8 s)                                  |
| typecheck, lint                                                 | PASS                | same `tsc --noEmit` / `eslint . --max-warnings 0` invocations; only the Node heap is 8 GB; `start`, `worker`, Dockerfile, compose unchanged                                                |
| OpenAPI compatibility (`openapi:check`)                         | PASS                | 1,244 operations; all prior batch signatures plus 714 new                                                                                                                                  |
| Migration gate (`db:migrations:check`)                          | PASS                | 33 rehearsals, historical checksums, additive review, repeat deploy; cleanup FK catalog 1,107 FKs re-pinned after review; the Messages/Meetings rehearsal is pinned to its 0076-era digest |
| `format:check`                                                  | FAIL (pre-existing) | only `docs/p5-database-integrity-checkpoint.md`, committed in `a17c2e3`, untouched; not reformatted (unrelated)                                                                            |
| Personal Finance posting, Activity files, Social chat context   | BLOCKED             | owner decisions in ADR 0060                                                                                                                                                                |
| Live/compiled API and worker smoke, Docker, CI                  | NOT VERIFIED        | migration 0077 not applied to `mehran_dev` by instruction; no configured database changed; shared API/worker not restarted                                                                 |

Status: **P6-02 PARTIAL, P6-03 PARTIAL** — all implemented behavior verified; the
BLOCKED items above remain.

## Gap closure (2026-11-18, ADR 0060 approved; companions 0061–0063)

Implemented and verified (isolated PostgreSQL, `social-activities.spec.ts` 18/18):

- **Decision A** — nominee-consent organizer succession (`POST …/succession`,
  `…/succession/{accept|decline|cancel}`); last organizer cannot leave a `PLANNED`
  Activity; erasure of the last organizer closes an independent Activity and sets
  `orphanedAt` without promoting anyone; ledgers stay usable.
- **Decision B** — 30-day recovery: Activity `DELETE`/`restore`, item soft delete
  and `restore`; disposal of eligible content in its own transaction after the
  deadline (controlled-time test); financial, settlement and audit records never
  disposed (their retention durations remain POLICY-GATED).
- **Decision C** — Finance-owned `ExternalExpensePosting` port and
  `FinanceExternalPosting` link; preview + confirmed posting of the caller's own
  effective share as an `EXPENSE`; no duplicates, no auto-posting, no rewrite after
  revision; another user's Finance untouched. Settlement posting: NEEDS APPROVAL.
- **Decision D** — Messaging-owned sourced `PRIVATE_GROUP` conversation; Social
  guard rechecked on every Messaging user operation with a participant-row lock;
  explicit join; join-time history; removal denies reads, sends, history and lists.
- **Decision E** — contract only (ADR 0063); no file operation enabled.

Migrations: 0077 unchanged (SHA-256 verified); new reviewed `202611180078_social_gap_closure`.
OpenAPI: 1,244 → **1,255** operations (+11); prior batch signatures unchanged;
this batch's unreleased signature baseline regenerated (868 hashes).
Rate limits (ADR 0058): succession and Activity deletion are sensitive; other
new writes use the Social write budget.

| Check                                                                                                                              | Result                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `social-activities.spec.ts`                                                                                                        | PASS 18/18                                                                                                    |
| Messaging, communication-lifecycle, finance, social, personal-lifecycle, team/company lifecycle, shared-personal-erasure, meetings | PASS (after one fix: see below)                                                                               |
| `pnpm test` (unit/contract/architecture/compatibility)                                                                             | PASS 852/852 in one run; a second run had 3 whole-OpenAPI test timeouts under load, 4/4 PASS when rerun alone |
| `db:migrations:check`                                                                                                              | PASS, 33 rehearsals                                                                                           |
| Cleanup FK catalog                                                                                                                 | re-pinned after review, 1,109 edges                                                                           |

Defect found and fixed during closure: amending unreleased migration 0077 broke
the configured isolated test database (already migrated with 0077); 0077 was
restored byte-for-byte and the changes moved to 0078. `personal-lifecycle`
then passed.

NOT VERIFIED: full integration suite in one run, live/compiled API and worker,
Docker. `mehran_dev` untouched; API/worker not restarted.
