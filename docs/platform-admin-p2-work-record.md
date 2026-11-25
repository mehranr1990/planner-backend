# Platform Admin P2 work record

Updated 2026-11-25. Status COMPLETE for local development. Accepted by the owner based on the final documented evidence. P2 commit/push is authorized; P3 starts only after the successful push. Earlier unstaged/publication status below records the verification checkpoint.

## Git and scope

P1 is on `main` and `origin/main` at `b9746e17f0087d5019ce39eb86e8beac438a8538`. The approved M100 attribute preserves the exact reviewed migration bytes. All six P1 migration hashes matched the staged files before push. The owner's `compose.yaml` SHA-256 was `C42657021CD05DA9AD7412DD67E675470B8029FFDABCCB4B55035A363623CF20`. P2 is local and uncommitted.

P1 verification included its 13 recorded local gates, 936 repository tests and 1,231 PostgreSQL tests. The conditional live ClamAV smoke was skipped. A fresh serial repository rerun passed all 936 after a parallel architecture timeout. An additional PostgreSQL invocation accidentally selected the full P1 suite and was interrupted. Its exit 1 supplied no acceptance counts.

## Security and audit

Admin and ordinary identities keep their separate provider/session stores. Session listing returns bounded metadata. Session revocation accepts selected IDs or the entire target account. Temporary/permanent ordinary restrictions reuse the P1 account fence. Recovery uses verified-recipient provider mail. Admin blocking and MFA recovery revoke target sessions. MFA recovery requires a recorded identity review and opaque reference, fresh MFA, a distinct current approver and unchanged target enrollment. The recovered operator enrolls a new factor and signs in again.

Two-operator Security requests expire after 30 minutes. Login ceilings are 5 per 60 seconds for Admin and 3 per 10 seconds for ordinary sign-in. Configurable alerts group denied authentication by policy revision and time window. In-app evidence and email deliveries use PostgreSQL, with expiring leases, eight bounded delivery attempts and recipient rechecks. Trusted proxy resolution remains in the existing provider path.

Terminal Admin and selected ordinary security/privacy events produce detached, immutable minimal evidence. The upgrade includes historical terminal events. Category permissions control search and CSV. An additional permission reveals reasons. Typed revision summaries and opaque target identifiers support review without private work or internal notes. Each audit page has at most 100 items with actor/filter-bound cursor pagination. CSV neutralizes spreadsheet formulas. Local DB integrity controls assume a trusted database administrator.

## Privacy, retention and restore

`GET /api/v1/me/exports/{id}/archive` requires the verified owner and current export proof. The streaming ZIP contains Personal JSON, READY attachment bytes and independently owned Projects with export/file rights. An optional `projectId` explicitly selects another authorized Project. Each Project entry opens under current rights. Shared activation gates, per-Project limits, 100 Projects, 1,000 entries and 512 MiB bound the archive. Failed file reads abort the download. User membership alone never selects Team or Company datasets.

Admin account requests explicitly acknowledge the configured erasure policy. The impact summary records its version. Admin requests persist typed target references, actual actors, impact counts and fingerprint, current revision, an immutable review history and the chosen recovery period. A different Admin confirms the exact target, fingerprint and period. Execution revalidates authorization and impact inside the domain transaction. An account closure uses a transaction-local capability, closes Personal access, revokes sessions, suspends owner side effects and cancels exports. Only the verified recipient can receive a recovery proof. The delivery worker derives it from the current recoverable job. Recovery reopens Personal access before erasure. Revoked sessions require fresh sign-in.

Ordinary recoveries retain the seven-day deadline. Future reviewed Admin account closures accept 7 to 30 days. Team/Company jobs accept 7 or 30 days, matching the existing DB constraint. A user or Admin cannot delete an account with unresolved Team/Company custody. Accepted successor transfer and explicit domain disposition remain available. Workspace closure ends reviewed seats, keeps only custodian recovery eligibility and schedules the existing retention-controlled worker. Reviews exceeding 1,000 active/suspended seats or with unresolved Company child custody are ineligible. Resolve dependencies before retrying. Close/restore controls carry signed restrictive evidence; existing release approval, obligations and holds continue to govern purge.

Changing retention requires fresh MFA, sensitive permission, a 15-minute preview, confirmation of the impact by a different authorized reviewer and revalidation at publication. Audit categories allow 730 to 3,650 days. Explicit expiry processes at most 100 eligible records and preserves delivery references. Backup retention is independent, 1 to 30 days for future signed manifests, default 30. Previously signed deadlines and existing tombstones retain their validity rules. Physical expiry and off-host restore drills are deployment responsibilities.

## Persistence

| Migration | Responsibility                                                            |
| --------- | ------------------------------------------------------------------------- |
| M101      | Admin sign-in restrictions, security policy, critical approval identities |
| M102      | Detached terminal audit evidence and capture/immutability triggers        |
| M103      | Security alert buckets and durable recipient deliveries                   |
| M104      | Immutable review transitions and target enrollment fencing                |
| M105      | Audit retention policies, reviews and bounded expiry                      |
| M106      | Typed deletion requests, history and account-job provenance               |
| M107      | Immutable deletion impact, transitions and history                        |
| M108      | Minimal historical audit backfill with duplicate protection               |
| M109      | Separate backup policy limits and immutable retention reviews             |
| M110      | Typed target Admin and before/after revision evidence                     |
| M111      | Null-safe bounded audit expiry                                            |

The disposable-schema FK catalog has 1,186 edges and SHA-256 `28a90de1612104a147578f8a3599e6d468f3a95693d86f5e692a54a1398cc2f3`. Historical SQL/ledgers are preserved. There is no production migration application.

## Route and permission inventory

Admin paths below are relative to `/api/v1/admin/`. Mutations require a trusted origin, recent persisted MFA and an idempotency key. Super Admin has the explicit catalog. Support may read CONTROL audit. Security Reviewer can read and export SECURITY audit, see security policy/alerts, manage sessions and ordinary sign-in restrictions/recovery. Sensitive reasons, critical approval, privacy deletion and retention publication require the explicit higher permissions. Billing Manager has its existing own-session capabilities.

| Method and path                              | Permission                              |
| -------------------------------------------- | --------------------------------------- |
| `GET security/alerts`                        | `admin.security.read`                   |
| `GET security/policy`                        | `admin.security.read`                   |
| `POST security/approvals`                    | `admin.security.critical.request`       |
| `GET security/approvals/:id`                 | `admin.security.critical.request`       |
| `POST security/approvals/:id/approve`        | `admin.security.critical.approve`       |
| `POST security/approvals/:id/reject`         | `admin.security.critical.approve`       |
| `POST security/approvals/:id/execute`        | `admin.security.critical.request`       |
| `GET security/admins/:id/sessions`           | `admin.security.sessions.read`          |
| `POST security/admins/:id/revoke-sessions`   | `admin.security.sessions.revoke`        |
| `POST security/admins/:id/block-login`       | `admin.security.login.restrict`         |
| `GET security/users/:id/sessions`            | `admin.security.user_sessions.read`     |
| `POST security/users/:id/revoke-sessions`    | `admin.security.user_sessions.revoke`   |
| `POST security/users/:id/block-login`        | `admin.security.user_login.restrict`    |
| `POST security/users/:id/unblock-login`      | `admin.security.user_login.restrict`    |
| `POST security/users/:id/recovery`           | `admin.security.user_recovery.initiate` |
| `GET audit`                                  | `admin.audit.read`                      |
| `GET audit/export`                           | `admin.audit.export`                    |
| `POST privacy/deletion-requests`             | `admin.privacy.deletions.request`       |
| `GET privacy/deletion-requests/:id`          | `admin.privacy.deletions.read`          |
| `POST privacy/deletion-requests/:id/approve` | `admin.privacy.deletions.approve`       |
| `POST privacy/deletion-requests/:id/execute` | `admin.privacy.deletions.execute`       |
| `POST privacy/deletion-requests/:id/recover` | `admin.privacy.accounts.recover`        |
| `GET privacy/deletion-requests/:id/history`  | `admin.privacy.deletions.read`          |
| `GET privacy/retention`                      | `admin.privacy.retention.read`          |
| `POST privacy/retention/preview`             | `admin.privacy.retention.preview`       |
| `GET privacy/retention/changes/:id`          | `admin.privacy.retention.read`          |
| `POST privacy/retention/changes/:id/approve` | `admin.privacy.retention.approve`       |
| `POST privacy/retention/changes/:id/apply`   | `admin.privacy.retention.publish`       |
| `POST privacy/retention/expire`              | `admin.privacy.retention.expire`        |

## Verification checkpoint

The complete final checkpoint ran all 13 commands. Configuration, Prisma generation/validation, provider schema compatibility, build, typecheck, architecture and OpenAPI passed. Format/lint findings were fixed and their follow-up checks passed. The complete repository run recorded 943 passed and one failure in the explicit migration inventory. Updating that inventory and the exact M111 guard was verified by 10/10 targeted unit/architecture tests, exit 0.

The complete PostgreSQL run recorded 1,250 passed, one failed and one conditional live-ClamAV skip across 63 files. Its single failure searched only the first audit page after the test gained more fixtures. Filtering by the specific request preserves the isolation assertion. The affected Security/Audit/Privacy and Personal lifecycle suites then passed 30/30, exit 0, including policy acknowledgement, restore deadline replay, purge and retained review evidence. The existing pg client concurrent-query deprecation notice remains in integration output.

The migration gate initially rejected M111 before database work because its explicit review hash was missing. The exact-byte guard was added. The follow-up migration gate passed, exit 0, including owned-schema deploy/upgrade/repeat, historical audit backfill and the required prior-batch migration rehearsals. Final build, typecheck, format and lint also passed, exit 0.

The owner efficiency policy is persisted in AGENTS.md section 16. Completed unaffected suites are reused. Docker, physical off-host expiry, production restore drills and production deployment remain deferred release checks. The live ClamAV smoke requires CLAMAV_SMOKE_HOST.

The final acceptance evidence combines the complete checkpoint with successful affected reruns. The index is empty and HEAD/origin/main still match P1. Next eligible phase is Platform Admin P3, NOT STARTED and requiring separate authorization.

## Final command results

| Exact command                                                                                                                                                                           | Final result                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm.cmd config:check`                                                                                                                                                                 | exit 0                                                                            |
| `pnpm.cmd db:generate`                                                                                                                                                                  | exit 0                                                                            |
| `pnpm.cmd auth:schema:check`                                                                                                                                                            | exit 0                                                                            |
| `pnpm.cmd db:validate`                                                                                                                                                                  | exit 0                                                                            |
| `pnpm.cmd build`                                                                                                                                                                        | exit 0 after final edits                                                          |
| `pnpm.cmd typecheck`                                                                                                                                                                    | exit 0 after final edits                                                          |
| `pnpm.cmd format:check`                                                                                                                                                                 | exit 0 after fixes                                                                |
| `pnpm.cmd lint`                                                                                                                                                                         | exit 0 after fixes                                                                |
| `pnpm.cmd architecture`                                                                                                                                                                 | exit 0, 763 modules                                                               |
| `pnpm.cmd test --maxWorkers=1`                                                                                                                                                          | exit 1, 943 passed and one migration-inventory failure                            |
| `pnpm.cmd exec vitest run --project unit --project architecture apps/api/src/platform/database/foundation.spec.ts tooling/architecture-tests/admin-p2-migration.spec.ts --maxWorkers=1` | exit 0, 10 passed, includes the corrected failure                                 |
| `pnpm.cmd openapi:check`                                                                                                                                                                | exit 0, 1,384 operations and 12,809 resolved references                           |
| `pnpm.cmd test:integration`                                                                                                                                                             | exit 1, 1,250 passed, one audit-page fixture failure, one conditional ClamAV skip |
| `pnpm.cmd test:integration platform-admin-security-audit.spec.ts personal-lifecycle.spec.ts`                                                                                            | exit 0, 30 passed, includes the corrected failure                                 |
| `pnpm.cmd db:migrations:check`                                                                                                                                                          | exit 0 after M111 exact-byte guard                                                |
| `git diff --check`                                                                                                                                                                      | exit 0                                                                            |

There are 944 repository tests and 1,251 runnable PostgreSQL tests in the full checkpoint inventory. Complete runs initially failed as recorded above. Their failures were corrected and verified in the affected suites. The complete suites were each run once during P2 acceptance.

## End-of-batch report

Publication review, 2026-11-25: all 126 historical SQL artifacts match HEAD byte for byte; all eleven P2 staged artifacts match their working-tree bytes and applied isolated-test ledger checksums. The focused reviewed-P2 migration test passed (1/1). A wider read-only comparison found a pre-existing isolated-test M084 ledger checksum discrepancy: ledger `abd9d671301dbbef317d6305c00a47819ed84f190b14bd73e94fbce1c46ef28b`, unchanged reviewed SQL `dd4df22e79549abf777d95f9755f06ba090f24a7d6a9d170682a91a8043ae37e`. Neither historical SQL nor ledger was changed. This is an existing local database history issue, outside the P2 publication diff; do not infer that all historical applied checksums match. P3 must preserve it and use fresh owned-schema migration evidence. The staged inventory is limited to P2 backend, contracts, tests and supporting documentation; compose.yaml, secrets and local configuration are excluded.

Batch Platform Admin P2. Status COMPLETE for local development.

Scope implemented includes Security, Audit, Privacy and Retention. Main changes are in platform/admin, admin-management, Account lifecycle, Spaces/Team/Company domain facades, Project export, Storage and API contracts. Existing owner suspension and worker facades support actual Admin attribution. The API and generated handoff agree. The endpoint table above lists all 29 Admin operations. The supplemental ordinary endpoint is GET /api/v1/me/exports/{id}/archive with optional projectId.

Entities comprise nine P2 tables, Admin sign-in restriction and typed account-job provenance. M101 through M111 form the new reviewed SQL. Audit rows, history and typed impact are protected by DB guards. Outbox work, signed Personal erasure and Shared replay reuse the existing durable workers. Recovery mail derives the current capability through the Account public contract.

Security tests cover fresh MFA, permissions, approval separation/expiry, changed enrollment/impact, identity and tenant isolation, session scoping, default-deny roles, immutable evidence, CSV safety, bounded expiry, archive ownership, recovery deadlines, restore replay and final purge. Full P0/P1 regression is included in the checkpoint.

Deviations from the binding scope: none identified. Technical bounds chosen within the approved configurable-default scope are documented in ADR 0073 and this record. Large membership sets and unresolved Company child custody require disposition before reviewed closure. Deployment acceptance still requires live scanner/off-host expiry/restore evidence. No remaining local implementation blockers or owner ADR questions.

Git main and origin/main remain at P1 b9746e17f0087d5019ce39eb86e8beac438a8538. P2 changes remain unstaged and uncommitted. The owner's compose.yaml checksum matches the initial value. Next eligible batch is Platform Admin P3, NOT STARTED, pending explicit approval.
