# P6-04 report — Social lending and Lost & Found

Date: 2026-11-18. Baseline: `2020f62` on `main` (P6-02/P6-03, pushed).
Status: **P6-04 COMPLETE for the approved scope**. ADR 0064 decisions A–D are implemented
and verified in isolated PostgreSQL. Retention durations remain **POLICY-GATED** (P6-06).
Not deployed. Migrations 0079/0080 have not been applied to `mehran_dev`.

## Phase 6 status

| Batch                                  | Status                                                         |
| -------------------------------------- | -------------------------------------------------------------- |
| P6-01 Connections, Circles, Groups     | COMPLETE                                                       |
| P6-02 Activities                       | PARTIAL (`2020f62`; see [p6-02-03-report](p6-02-03-report.md)) |
| P6-03 Shared expenses                  | PARTIAL (`2020f62`)                                            |
| **P6-04 Lending, Lost & Found**        | **COMPLETE (approved scope); retention POLICY-GATED**          |
| P6-05 Albums, goals, challenges        | NOT STARTED; albums POLICY-GATED (ADR 0063, PG-10)             |
| P6-06 Cross-context security/retention | NOT STARTED; retention POLICY-GATED                            |

## Capability coverage

| Capability                                                                               | Status                  |
| ---------------------------------------------------------------------------------------- | ----------------------- |
| Personally owned assets; `PRIVATE`/`CONNECTIONS`/`GROUP` audience (decision A)           | COMPLETE                |
| Owner-only audience change with immediate revocation (decision D)                        | COMPLETE                |
| Requests, offers, accept/reject, borrower acknowledgement, two-sided handover            | COMPLETE                |
| Return, overdue (derived), disputes, lost/damaged outcomes confirmed by the counterparty | COMPLETE                |
| Due-date change by mutual agreement (decision D)                                         | COMPLETE                |
| Notices in the Social inbox, with `actionRequired` polling fallback (decision B)         | COMPLETE                |
| Lost & Found without a loan; matches; private claims; conflicts; two-party resolution    | COMPLETE                |
| Group moderation; outsider and cross-Group isolation; revocation                         | COMPLETE                |
| Erasure with minimal shared history (decision C); suspension; export                     | COMPLETE                |
| Idempotency, revision fencing, lock ordering, concurrent transition protection           | COMPLETE                |
| Evidence metadata with contextual access                                                 | COMPLETE                |
| Retention durations; final treatment of orphaned custody loans                           | POLICY-GATED (P6-06)    |
| Photo/file evidence                                                                      | BLOCKED (ADR 0057/0063) |
| Web Push for Social notices                                                              | DEFERRED (ADR 0044)     |
| Collectively Group-owned property                                                        | NOT BUILT (decision A)  |

## Schema, contracts and compatibility

- `202611180079_social_lending_lost_found` (additive): 6 tables, 22 FKs, 3 partial unique indexes.
- `202611180080_social_lending_gap_closure` (reviewed, hash-pinned in
  `tooling/testing/reviewed-social-lending-gap-migration.ts`):
  - `SocialLoan` due-proposal columns, a CHECK and a SET NULL FK.
  - `SocialNotice.loanId` / `.lostFoundReportId`, each with a CASCADE FK and an index.
  - Two reviewed CHECK replacements on `SocialNotice`. The context check is still
    "exactly one context", and each new kind is tied to its context column.
  - Every existing row stays valid.
- No historical migration was edited. The domain table count is still 342 (343 with the ledger).
- The cleanup FK catalog grows from 1,109 to 1,134 FKs and was re-pinned with review notes.
- OpenAPI: 1,255 → **1,282** operations (+27). P6-04 signatures (378 hashes) are frozen in
  `tooling/compatibility/p6-04-social-lending-api-signatures.json`.
  - The only change to a previously frozen contract is the `SocialNotice.kind` enum
    widening on `GET /social-notices` and `POST /social-notices/{id}/read`.
  - That widening is recorded in `tooling/compatibility/social-lending-gap-api-extensions.json`
    and is checked by `approvedSocialLendingHash`.
- The shared Social OpenAPI path builder was extracted from the P6-02/P6-03 builder; the
  existing operations it generates are byte-identical.

## Deviations

- Notifications reuse the Social-owned notice inbox (the channel Activities and expenses
  use). The Notifications module's outbox consumer covers Personal reminders only, and its
  push channel is Messaging-specific. Social push is out of scope under ADR 0044.
- Root `typecheck`/`lint` keep the existing 8 GB heap from P6-02/P6-03.

## Verification (isolated PostgreSQL sandboxes; no live tests)

| Check                                                                                                                                         | Result                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `social-lending.spec.ts`: lending, L&F, isolation, revocation, idempotency, concurrency, HTTP, notices, polling, due dates, audience, erasure | PASS 11/11                                                                                                                      |
| Full integration suite (before the gap closure)                                                                                               | PASS 1,150/1,150. After the gap closure, 9 affected suites were rerun (Social, shared-kernel, erasure, lifecycle): PASS 186/186 |
| Domain units (`lending.spec.ts`)                                                                                                              | PASS 9/9                                                                                                                        |
| `pnpm test` (unit/contract/architecture/compatibility)                                                                                        | 866/867. One architecture probe timed out under parallel load; rerun alone 5/5 PASS                                             |
| `pnpm typecheck`, `pnpm lint`, `pnpm architecture`                                                                                            | PASS                                                                                                                            |
| `pnpm openapi:check`                                                                                                                          | PASS                                                                                                                            |
| `pnpm db:migrations:check` (after 0080)                                                                                                       | PASS: 33 rehearsals, historical checksums, reviewed 0080 hash, repeat deploy                                                    |
| Live API/worker smoke, Docker, CI, `mehran_dev` migration                                                                                     | NOT RUN (not authorized)                                                                                                        |
