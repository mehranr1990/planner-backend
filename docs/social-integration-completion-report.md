# Social integration — current batch, 2026-11-13

Batch: **SOCIAL-I01**, critical identity/access gaps and safe Group history.
Status: **COMPLETE for this batch**, with the affected integration rerun passing.
Owner subsequently requested finishing this batch and stopping. P6-02–P6-06
feature implementation is **NOT STARTED** by this work.

## Implemented operations

All paths are under `/api/v1`; existing verified-session, Shared prerequisites,
Origin handling, scope fences, role ceilings and no-store responses remain active.

| Operation                                        | Response and authorization                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing `GET /social/connections`               | Adds nullable `requesterDisplayName` and `recipientDisplayName` to currently authorized pending/accepted relationships. Target discovery opt-out does not erase an accepted relationship. Blocked, removed and other terminal relationships receive null names. No contact details or new lookup authority.                                                                                                                                                                       |
| Existing `GET /social-groups/{id}/join-requests` | Adds nullable `requesterDisplayName` for pending applicants. Owner/Admin sees authorized requests; applicants see only their own. Identity/account and subject fences are rechecked; terminal/unavailable identities receive null names.                                                                                                                                                                                                                                          |
| Existing `GET /social-groups/{id}/memberships`   | Adds nullable `displayName` using the existing Spaces identity facade; authorized Group readers only. No global User ID, email or private profile is added.                                                                                                                                                                                                                                                                                                                       |
| **New `GET /social-groups/{id}/access/me`**      | `accessId`, local `actorId`, `role`, active membership `state`, `generation`, `revision`, `groupState`, effective `capabilities`. Existing read/settings/member/admin/leave/handover capabilities only; no future Activity/finance/chat permission is implied. Pending, revoked and unrelated users are denied.                                                                                                                                                                   |
| **New `GET /meetings/{id}/access/me`**           | Resolves X1-M: `meetingId`, caller's `memberId`, local `actorId`, `role`, `state`, `rsvp`, `generation`, `revision`, nullable `displayName`, and current read/leave/propose/draft/manage capability hints. Requires explicit current accepted/tentative meeting admission and current source authority; no organizer bypass. Revocation/rejoin rules remain authoritative.                                                                                                        |
| **New `GET /social-groups/{id}/history`**        | Signed `after`/`limit` pagination of allowlisted Group/membership/handover audit metadata since the caller's current admission: `id`, `action`, local `actorId`, nullable current `actorDisplayName`, opaque `resourceId`, `occurredAt`. No private bodies, historical titles, invitation/applicant events, raw receipts or future feature events. Authority changes invalidate cursors. This is the independently safe metadata portion of the requested Group activity history. |
| Existing `GET/PATCH /social-groups/{id}`         | Reused scoped name/description/public-summary/discoverability settings with existing Owner/Admin checks and revision requirements. No speculative settings or status fields added.                                                                                                                                                                                                                                                                                                |

Names are resolved at read time. They are not persisted in idempotency receipts,
audit, outbox or restore evidence. Display fields remain response-only.
No new domain event, job, worker or private-file operation was needed.

## Retention version investigation

There is **no approved client resolver, environment default or “latest policy”
selection rule**. `SharedKernel.provision` validates the supplied version against
an immutable `SharedRetentionPolicy` row: matching approval reference, full valid
configuration and applicability to the requested custody kind. Missing/invalid
policies fail closed with `SHARED_RETENTION_UNAVAILABLE`.

The operator must provision the owner-approved policy and supply its exact version
to the client through reviewed deployment/bootstrap configuration. Selecting a
default, exposing a new resolver or provisioning new retention values requires an
explicit configuration/owner decision. No policy value was invented, hardcoded,
seeded, selected by timestamp or applied to development. Shared remains disabled.

## Verification and persistence

API: **863 operations**, three additions to the preserved 860-operation local
baseline. Canonical OpenAPI and Backend handoff are updated.
The 560 existing Social signatures are now explicitly guarded; nine exact optional
name-response extensions have approved hashes and mutation tests. Historical
snapshots and the preceding batch's 85 response-extension hashes are unchanged.

Entities/migrations/constraints: **none created or applied by this batch**.
Existing migrations are exercised only by the guarded isolated test harness;
development data, credentials and activation flags are unchanged.

Tests/results:

- `pnpm.cmd typecheck`: PASS.
- Targeted Social/Meetings PostgreSQL checks: PASS, three cases.
- Targeted Social history/name/access PostgreSQL checks: PASS, three cases after
  rebuilding the workspace contracts (the first run used stale contract output).
- Targeted contract/compatibility checks: PASS, 21 tests across five files.
- `pnpm.cmd quality`: all 13 stages ran. Configuration, Prisma generation and
  validation, provider-auth schema, build, typecheck, formatting, lint, architecture,
  OpenAPI and migration gates passed. Unit/contract/architecture/compatibility:
  **724/724 tests**, 149 files; architecture: zero violations, 577 modules.
- Full integration initially passed **1,016/1,018** tests across 46 files. Initial
  aggregate quality exit was **1**: the new discoverable test Groups remained
  discoverable across later tests, breaking two existing exact discovery assertions.
  The new fixtures now become private after their join requests. Assertions and
  production code were not weakened. `pnpm.cmd test:integration apps/api/test/integration/social.spec.ts`:
  **PASS, 46/46**, including the two original failures and all new regressions.
- Affected-test ESLint/format checks and final documentation format,
  `pnpm.cmd openapi:check` and `git diff --check`: PASS. No full gate rerun was
  necessary after the isolated fixture correction.
- Migration gate: PASS, existing history/checksums, additive safety, empty/populated
  predecessor preservation, interrupted rollback/resume and repeat deployment.
  No configured database was reset; disposable fixture teardown succeeded.

Local command evidence: ignored `.tools/social-completion-*.log` files.

Tests not run: live API/worker smoke, Shared activation, Docker, hosted CI and
deployment/release checks, per the owner's restrictions.

## Scope boundary and remaining work

Owner approval of S3–S9, explicit Activity/chat acceptance, current-join chat history
and Activity-only guest access is recorded in
[ADR 0051](./adr/0051-social-completion-decisions.md). These choices remain approved
for future work; the later stop instruction does not revoke them.

Activities/RSVP/waitlists, polls/free-busy, Activity checklists/calendar, shared
expenses/settlements, lending/Lost & Found, albums, challenges and Social Group chat
are **not implemented by this batch**. No feature migrations or new dependencies
were started. Remaining separate decisions include the operator retention setup,
the explicitly open always-on free/busy audience and the approved image-processing
formats/pipeline/dependency before album implementation; no new choices were made.

Changed modules: Social, Meetings and the Spaces-owned history projection;
contracts, compatibility gates, focused tests and the Backend handoff.
Security: current identity/admission checks, no blocked/closed identity disclosure,
pending-user isolation, response-only names, current-generation capability hints,
history floor, metadata allowlist and cross-Group/revoked cursor denial.
Deviations: none within the current batch; broader Social completion remains open.

Git: **71 modified, 20 untracked entries, zero staged**; prior uncommitted changes
preserved. This batch is uncommitted.
No push, deployment, Frontend edits, Live Tests or Shared activation.
Next action: **STOP after this batch**, as explicitly requested by the owner.
