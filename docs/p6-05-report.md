# P6-05 report — Social Goals and Challenges (Albums deferred)

Date: 2026-11-18. Baseline: `b4ce86d` on `main` (P6-04, pushed), clean tree.
Status: **P6-05 COMPLETE for the approved scope (D1–D5)**. Photo Albums **DEFERRED** by owner
decision (contract only). Retention durations **POLICY-GATED** (P6-06). Verified in isolated
PostgreSQL sandboxes only — not Live. Not deployed; migrations 0081/0082 not applied to
`mehran_dev`. All changes uncommitted.

## Phase 6 status

| Batch                                  | Status                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| P6-01 Connections, Circles, Groups     | COMPLETE                                                                             |
| P6-02 Activities                       | PARTIAL (`2020f62`; see [p6-02-03-report](p6-02-03-report.md))                       |
| P6-03 Shared expenses                  | PARTIAL (`2020f62`)                                                                  |
| P6-04 Lending, Lost & Found            | COMPLETE (approved scope); retention POLICY-GATED                                    |
| **P6-05 Goals and Challenges**         | **COMPLETE (approved scope, uncommitted); retention POLICY-GATED**                   |
| P6-05 Photo Albums                     | DEFERRED (owner); [future contract](architecture/social-albums-deferred-contract.md) |
| P6-06 Cross-context security/retention | NOT STARTED                                                                          |

## Baseline found

No Social goal, challenge or album code, table or route existed. The Personal `Goal` engine is
Space/custody-scoped and cannot own Activity-context collaborative progress, so a Social-specific
extension was built on the existing Social runtime (Group custody fence, `ActivityRuntime`
access, idempotency receipts, Social notice inbox, outbox).

## Requirement → API → test coverage

Tests: **I** = `apps/api/test/integration/social-goals.spec.ts` (isolated PostgreSQL),
**U** = `apps/api/src/modules/social/domain/goals.spec.ts`,
**R** = `apps/api/src/modules/spaces/application/collaboration-limit.spec.ts`.

| Requirement                                          | API                                        | Test                                                                 |
| ---------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| D1 Group context; organizer-only create              | `POST /social-goals` (`groupId`)           | I "Group challenge…"                                                 |
| D1 Independent Activity context; no Group needed     | `POST /social-goals` (`activityId`)        | I "independent Activity…"                                            |
| D1 Invited-not-accepted / outsider denied            | `join`, `GET {id}`                         | I "independent Activity…", "Group challenge…"                        |
| D2 Self-submitted progress only                      | `POST {id}/entries` (no participant field) | I "Group challenge…", "visibility…"                                  |
| D2 Optional review; pending excluded; reject no-op   | `POST …/entries/{entryId}/actions/*`       | I "review…"; U transitions                                           |
| D2 Self-review refused; reviewed entry immutable     | same                                       | I "review…"; U transitions                                           |
| D2 Audited corrections; never negative; fenced       | `POST {id}/corrections`                    | I "organizer corrections…"; U                                        |
| D2 Revision history                                  | `GET {id}/history`                         | I "Group challenge…", "corrections…"                                 |
| D3 Aggregate vs individual visibility                | `GET {id}`, `/participants`, `/entries`    | I "visibility…", "review…"                                           |
| D3 Revocation hides person; no cross-context listing | all                                        | I "visibility…"                                                      |
| D4 No auto-enrollment; voluntary join; no duplicates | `POST {id}/join`                           | I "Group challenge…", "concurrency…"                                 |
| D4 Withdrawal and rejoin                             | `POST {id}/withdraw`, `join`               | I "withdrawal…"                                                      |
| D5 Percent, completion, badge (challenge)            | views                                      | I "Group challenge…"; U percent/settle                               |
| D5 Collective completion, badge revocation           | views                                      | I "independent Activity…", "corrections…"; U settle                  |
| Concurrency, idempotent retries, stale revisions     | all writes                                 | I "concurrency…", "withdrawal…", HTTP                                |
| Timezone and window boundaries                       | `entries`, `join`, create                  | I "dates…"; U localDay/window                                        |
| Close/cancel lifecycle; notices                      | `POST {id}/actions/*`; `/social-notices`   | I "dates…", "review…", "Group challenge…"                            |
| Account erasure and export                           | `SocialData.erase/snapshot`                | I "account erasure…"                                                 |
| No Personal Goal/Habit leakage                       | all                                        | I "Group challenge…" (Personal Goal count unchanged); strict schemas |
| HTTP: auth, Origin, idempotency, overposting, ETag   | HTTP                                       | I "strict HTTP contracts…"                                           |
| Rate classes                                         | `social-goals` routes                      | R                                                                    |
| Migration history and compatibility                  | 0081, 0082                                 | `db:migrations:check`, `foundation.spec.ts`                          |
| OpenAPI backward compatibility                       | 13 new operations; notice enum widening    | `openapi:check`, `openapi.spec.ts`                                   |

## Schema, contracts and compatibility

- `202611180081_social_goals_challenges` (additive, auto-reviewed): 4 tables (`SocialGoal`,
  `SocialGoalParticipant`, `SocialGoalEntry`, `SocialGoalEvent`), 13 FKs, CHECKs for exactly one
  context, kinds, states, entry shape and non-negative revisions; same-goal composite keys.
- `202611180082_social_goal_notices` (reviewed, hash-pinned in
  `tooling/testing/reviewed-social-goal-notices-migration.ts`): one `SocialNotice` kind-CHECK
  replacement adding 5 `GOAL_*` kinds; context CHECK and LOAN_/CLAIM_ ties unchanged.
- No historical migration edited (0077–0080 untouched). Tables 342 → 346 (347 with ledger).
  Cleanup FK catalog 1,134 → 1,147, re-pinned with review notes.
- OpenAPI 1,282 → **1,295** operations (+13). P6-05 signatures (182 hashes) frozen in
  `tooling/compatibility/p6-05-social-goals-api-signatures.json`. The only change to an earlier
  frozen contract is the `SocialNotice.kind` enum widening on `GET /social-notices` and
  `POST /social-notices/{id}/read`, recorded in `social-goals-api-extensions.json`
  (`approvedSocialGoalsHash`).
- Existing code touched: Activity disposal now also disposes Activity-context goals (ADR 0060 B);
  Social erasure/export; rate-policy family and sensitive class; module wiring.

## Deviations

- Notices use the Social inbox (as P6-02–P6-04); no push (ADR 0044).
- Fixed bounds instead of feature-policy keys (as Activities/lending); quota keys are Phase 7.
- Root `typecheck`/`lint` keep the existing 8 GB heap.

## Verification (isolated PostgreSQL sandboxes; no live tests)

| Check                                                     | Result                                                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `social-goals.spec.ts` (targeted)                         | PASS 10/10                                                                                                                  |
| Domain units `goals.spec.ts`                              | PASS 10/10                                                                                                                  |
| `pnpm test` (unit/contract/architecture/compatibility)    | PASS 878/878                                                                                                                |
| `pnpm typecheck`, `pnpm lint`, `pnpm architecture`        | PASS                                                                                                                        |
| `pnpm openapi:check`                                      | PASS                                                                                                                        |
| `pnpm db:migrations:check`                                | PASS                                                                                                                        |
| `pnpm format:check`                                       | 1 pre-existing file only (`docs/p5-database-integrity-checkpoint.md`, unchanged since `b4ce86d`); all P6-05 files formatted |
| Full integration suite (final, after acceptance fixes)    | PASS 1,163/1,163 (773 s)                                                                                                    |
| Live API/worker smoke, Docker, CI, `mehran_dev` migration | NOT RUN (not authorized)                                                                                                    |

## Acceptance check (2026-11-18)

**Self-approval (owner decision).** No participant approves their own progress, including a
sole organizer; their submission stays `PENDING` when review is required and no other eligible
reviewer exists. No auto-approval, temporary privilege or new role. Already enforced by
`SELF_REVIEW_FORBIDDEN` (review and own-record corrections). Added
`SocialGoal.viewer.independentReviewerAvailable` so the client can warn. Covered in the review
integration test; ADR 0065 and the handoff updated.

**First full run (1,158/1,163) — five failures investigated:**

| Failure                                              | Finding                                                                                                                                                                                                                                                                                                                                                                                                     | Resolution                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `social.spec.ts` discovery: expected 429, got 201    | **Test defect, proven.** ADR 0058 budgets are fixed UTC minutes (`date_trunc('minute')`); a boundary burst is an approved tradeoff. The test assumed 23 sequential requests share one window. Reproduced deterministically by starting the original burst 0.18 s before a boundary: identical failure, `RateLimit-Remaining` reset from 18 to 19 at `:00`. Production behavior is correct.                  | Test exhausts the unchanged 20/minute budget (≤ 2 × 20 + 1 requests) and asserts `RateLimit-Limit: 20`, `Remaining: 0` and the last allowed request. Passes across a boundary and normally. No limit, threshold or sleep changed. |
| `communication-lifecycle.spec.ts`: 4 × 15 s timeouts | **Load sensitivity; P6-05 not causal.** Files run sequentially (`fileParallelism: false`), so no cross-file interference or shared rate state. Alone, the tests take 3.9–4.4 s on both P6-05 and baseline `b4ce86d`. The failing run was machine-wide slower: transform 22.3 s vs 4.7–5.6 s, import 176.8 s vs 81.8–82.0 s, tests 1,096 s vs 685–695 s. The source of that external load is not identified. | None needed in code. Final full run passes. The 15 s budget is unchanged; the tests remain sensitive to heavy host load.                                                                                                          |

Baseline `b4ce86d` full run (separate worktree, now removed): 1,152/1,153 — one unrelated
`data-reliability.spec.ts` crash test failed there; it passes on the P6-05 tree (final run).

## Remaining policy-gated / deferred

- Retention durations and final disposal of goal history and anonymous contributions (P6-06).
- Photo Albums: ADR 0057/0063 approvals, scanner/codec dependency, quota keys.
- Personal Habit/Goal progress linking; Web Push for Social notices.
