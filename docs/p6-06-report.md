# P6-06 report — Social cross-context hardening, exit, retention and recovery

Date: 2026-11-18. Baseline: `2e1ab3f` on `main` (P6-05, pushed, synchronized with `origin/main`),
clean tree. Status: **P6-06 COMPLETE for the approved scope**; permanent disposal of protected
records **POLICY-GATED**. Verified in isolated PostgreSQL sandboxes only — not Live. Not deployed;
no migration; nothing applied to `mehran_dev`. All changes uncommitted.
Decisions: [ADR 0066](adr/0066-social-exit-retention-and-recovery.md). Frontend:
[SOCIAL_GROUP_EXIT_RECOVERY](frontend-handoff/SOCIAL_GROUP_EXIT_RECOVERY.md).

## Phase 6 status

| Batch                                 | Status                                                         |
| ------------------------------------- | -------------------------------------------------------------- |
| P6-01 Connections, Circles, Groups    | COMPLETE                                                       |
| P6-02 Activities                      | PARTIAL (`2020f62`; see [p6-02-03-report](p6-02-03-report.md)) |
| P6-03 Shared expenses                 | PARTIAL (`2020f62`)                                            |
| P6-04 Lending, Lost & Found           | COMPLETE (approved scope)                                      |
| P6-05 Goals and Challenges            | COMPLETE (`2e1ab3f`)                                           |
| P6-05 Photo Albums                    | DEFERRED (owner)                                               |
| **P6-06 Cross-context security/exit** | **COMPLETE (approved scope, uncommitted)**                     |
| Disposal of protected Social records  | POLICY-GATED (ADR 0066 G)                                      |

## Findings fixed

| Finding                                                                                                                           | Fix                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Group purge after 30 days cascaded expenses, settlements, Social audit, goals and Lost & Found evidence.                          | Execution-time content guard → `BLOCKED_POLICY` `SOCIAL_PROTECTED_RECORDS_RETAINED`.                                                                             |
| No Social Group delete/recovery API (only sole-member leave reached the lifecycle).                                               | Owner delete (revokes all seats), lifecycle status, recovery proof, recover.                                                                                     |
| Departed members kept Group notice metadata in `/social-notices`.                                                                 | Read-time filter by current membership; own settlement notices kept.                                                                                             |
| Departed members lost all access to their own open obligations; remaining members could not settle with them.                     | Restricted former-party ledger access and settlement counterparties while balance ≠ 0.                                                                           |
| Deleted Groups left former parties without access to their own retained obligations; blocked cleanup jobs were re-checked hourly. | Owner decision (ADR 0066 H): own balances/settlements via existing ledger endpoints under the account fence, also past the deadline; blocked Social jobs parked. |
| Last-organizer erasure skipped Group-linked Activities; pending invitations/approvals stayed open with no organizer.              | Orphan and close both kinds; end pending invitations; withdraw unapprovable proposals.                                                                           |
| Export lacked the person's own expense shares and settlements.                                                                    | Two minimized sections in the existing export owner contract.                                                                                                    |
| `social_group.*` audit action names would violate the action pattern.                                                             | Kernel maps `SOCIAL_GROUP` to `social.group.*`.                                                                                                                  |

Verified unchanged (no fix needed): Group-derived Activity, goal, Lost & Found and ledger access
already end with membership; guests keep only their Activity; P5 Messaging authority follows
current participation; erasure never blocks on loans (P6-04); ADR 0058 rate limits apply.

## API, schema and compatibility

- New: `GET /social-groups/{id}/exit-check`, `POST .../delete`, `GET .../lifecycle-job`,
  `POST .../lifecycle-job/recovery-proof`, `POST .../lifecycle-job/recover` (+5; 1,295 → 1,300).
- Changed (backward compatible): `POST /social-groups/{id}/leave` accepts optional
  `outstandingBalanceConfirmation`; empty/absent body still valid. Recorded in
  `tooling/compatibility/social-lifecycle-api-extensions.json`; new signatures frozen in
  `p6-06-social-lifecycle-api-signatures.json` (84 hashes). Route moved to
  `SocialGroupExitController` (same path).
- 409 reason `OUTSTANDING_BALANCE_CONFIRMATION_REQUIRED` is exposed in `error.details`.
- Rate classes: `delete`, `leave`, recovery routes sensitive (20/min); `exit-check` read.
- **No migration**; no FK change; cleanup FK catalog unchanged (1,147).

## Files

Kernel (`spaces`): `shared-kernel.service.ts` (Social delete branch, depart guard, action names),
`collaboration.service.ts` (leave guard), `http-rate-policy.ts`. Social: new
`group-exit.service.ts`, `http/group-exit.controller.ts`; `expenses.service.ts`,
`social-lifecycle.ts`, `social-data.ts`, `activity-planning.service.ts`, `groups.controller.ts`,
`social-activities.module.ts`. Bootstrap: `api-exception.filter.ts`. Contracts:
`social-lifecycle.ts`, `social-lifecycle-openapi.ts`, `social-openapi.ts`, `openapi.ts`, `index.ts`.
Tooling: compatibility files, `openapi.ts`, `openapi.spec.ts`. Tests:
`test/integration/social-hardening.spec.ts`, `test/contract/social-openapi.spec.ts`,
`collaboration-limit.spec.ts`. Docs: this report, ADR 0066, handoff, `docs/api/openapi.json`,
`docs/frontend-handoff/openapi.json`.

## Requirement → test

I = `social-hardening.spec.ts` (isolated PostgreSQL).

| Requirement                                                                                                         | Test                                            |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Deletion, 30-day window, restore by Owner; unauthorized restore denied                                              | I "Owner deletion revokes…"                     |
| No privilege resurrection; replayed proof refused                                                                   | I "Owner deletion revokes…"                     |
| Restore refused after deadline                                                                                      | I "refuses recovery after the deadline…"        |
| Idempotent pg-boss cleanup; no early disposal; protected records kept                                               | I "refuses recovery after the deadline…"        |
| Departure with/without balances; second confirmation; stale token                                                   | I "departure with open balances…"               |
| Immediate revocation; independent Activity kept; notices; export                                                    | I "departure with open balances…"               |
| Owner deletion with open balances                                                                                   | I "Owner deletion with open balances…"          |
| Own ledger after deletion and past the deadline; 404 for others; idempotent settle/confirm; parked cleanup; erasure | I "after Group deletion and past the deadline…" |
| Last organizer erasure (independent + Group-linked)                                                                 | I "last organizer erasure…"                     |
| HTTP wiring, auth, strict bodies, moved route                                                                       | I "serves the moved leave route…"               |
| Route/OpenAPI parity incl. new routes                                                                               | `social-openapi.spec.ts`                        |
| Rate classes                                                                                                        | `collaboration-limit.spec.ts`                   |
| Orphaned loans, nonblocking erasure                                                                                 | existing P6-04 lending tests                    |
| No Albums/media activation                                                                                          | parity test (no undocumented routes)            |

## Verification

| Check                                                       | Result                                  |
| ----------------------------------------------------------- | --------------------------------------- |
| `social-hardening.spec.ts` (targeted, final)                | PASS 7/7                                |
| Existing Social suites (social, activities, goals, lending) | PASS 85/85                              |
| `pnpm test` (unit/contract/architecture/compatibility)      | PASS 879/879 (after parity-test update) |
| `pnpm typecheck`, `pnpm lint`, `pnpm architecture`          | PASS                                    |
| `pnpm openapi:check`                                        | PASS                                    |
| `pnpm db:migrations:check`                                  | PASS (no new migration)                 |
| `pnpm format:check`                                         | 1 pre-existing file only                |
| Full integration suite (once, final)                        | PASS 1,169/1,169 (785 s)                |
| Live API/worker smoke, Docker, CI, `mehran_dev`             | NOT RUN (not authorized)                |

Final fix (ADR 0066 H): re-ran the P6-06 spec (7/7), the Social suites (85/85), `pnpm test` (879/879), typecheck, lint, architecture and `openapi:check` (no API change). The full integration suite was not rerun: the 1,169/1,169 baseline was accepted by the owner, and the fix only touches Social ledger admission and the Social branch of lifecycle scheduling, both covered by the targeted runs.

The cleanup test drives `SocialLifecycle.consume()` directly (the same function the pg-boss
worker loop calls); a real worker process was not started.

## Remaining policy-gated / open

- Permanent disposal (or retention duration) for Social expenses, settlements, audit, goal
  history, Lost & Found evidence, orphaned loans and the ledgers of deleted Groups — owner/legal
  decision required (ADR 0066 G).
- Deleted-Group obligations: resolved by the owner decision (ADR 0066 H); only their parties reach them.
- Open-loan pre-erasure suggestion is client-side via `GET /social-loans` (no Account contract
  change).
