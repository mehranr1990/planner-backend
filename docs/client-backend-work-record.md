# Client backend completion — 2026-11-25

Status: COMPLETE (local Client acceptance; release/deployment not performed). Owner explicitly authorizes sequential completion of B1–B4,
Company invitation staff fields, Habit metadata/reminders, signup timezone and
retention documentation reconciliation without intermediate batch approvals.

Baseline: `29aed23` (Platform Admin P3). The only initial working-tree change is
the owner's `compose.yaml`; preserve it exactly. No frontend, Platform Admin P4,
subagents, E2E, server configuration, deployment, commit or push is authorized.

## Execution and invariants

1. Reuse verified recipient proofs and admission checks for invitation delivery,
   channel preferences, recipient feed and Social pending invitations. Never expose
   account existence or recipient preferences to the inviter. Answering resolves
   feed entries; expired/revoked/unauthorized offers are never actionable.
2. Add optional Company position/supervisor snapshots; validate the same Company
   and current membership generation on issue and acceptance. Preserve staff authority.
3. Add Habit category, timeOfDay, preferredTime, icon and Unicode unitLabel while
   preserving immutable canonical units. Integrate reminders with durable existing
   notification scheduling, preferences and current habit state.
4. Handle new-account timezone without rewriting existing settings or schedules.
5. Reconcile retention documents with approved records; never apply retention or
   change server activation as part of this work.

Use additive migrations and contracts. Run targeted security/behavior tests while
developing and the mandatory final quality/migration/integration checkpoint once.
Record exact outcomes and genuine missing product decisions here.

## Verification

The full checkpoint ran once. Original failures are retained below; all affected
integration/contract/security checks passed after fixes. The full migration
rehearsal passed, including the populated P3-to-Client upgrade.

| Command / check                                                                                                                                       | Actual result                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm.cmd db:generate`                                                                                                                                | PASS for final Prisma input; reused at checkpoint because schema did not change again.                                                                                                                                                                                                                             |
| `pnpm.cmd config:check`; `pnpm.cmd db:validate`; `pnpm.cmd openapi:check`                                                                             | PASS.                                                                                                                                                                                                                                                                                                              |
| `pnpm.cmd auth:schema:check`                                                                                                                          | Initial FAIL: application-owned inverse User relation not registered. PASS after exact relation allowlist, with negative scalar-mutation test preserved.                                                                                                                                                           |
| `pnpm.cmd build`; `pnpm.cmd typecheck`                                                                                                                | Initial FAIL: narrowed config comparison and typed dynamic test paths. PASS after fixes; final API-only build also PASS after Habit effective-schedule fix.                                                                                                                                                        |
| `pnpm.cmd architecture`                                                                                                                               | Initial FAIL: composition imported an internal entry and a type-only cycle. PASS after public module export and moving the existing Company transaction type to its public contract (798 modules / 5,519 dependencies).                                                                                            |
| `pnpm.cmd test --maxWorkers=1`                                                                                                                        | Initial 956 passed / 3 failed, 223 files. Failures were two legacy direct hash assertions for approved additive contracts and the exact migration-name registry.                                                                                                                                                   |
| `pnpm.cmd compatibility`                                                                                                                              | PASS: 75 tests / 21 files after exact Client extension composition; historic snapshots unchanged.                                                                                                                                                                                                                  |
| `pnpm.cmd test:unit apps/api/src/platform/database/foundation.spec.ts apps/api/src/modules/spaces/application/recipient-invitation-authority.spec.ts` | PASS: 10 tests, including migration registry and unforgeable/transaction-bound metadata authorization.                                                                                                                                                                                                             |
| `pnpm.cmd test:integration <seven affected integration files> -t 'Client:\|consolidated gaps: Company admissions\|personal ownership'`                | PASS: 11 selected tests / 7 files; 260 intentionally unselected. Files: habits, messaging, meetings, social, company-completion, company-knowledge, identity-lifecycle. Covers stale worker fencing, push deduplication, future Habit resume/timezone, staff admission and the two legacy expectation corrections. |
| `pnpm.cmd test:integration`                                                                                                                           | Initial 1,275 passed / 6 failed / 1 skipped across 64 files. All six failing cases subsequently passed in the affected reruns below. The conditional live ClamAV smoke was skipped because no live host is configured.                                                                                             |
| `pnpm.cmd db:migrations:check`                                                                                                                        | PASS, exit 0. Full historical upgrade checks, P3 preservation and populated Client rollback/resume/repeat checks passed; final 381 tables / 1,206 reviewed FKs.                                                                                                                                                    |

Original checkpoint logs: `.tools/client-gate-*.log` and
`.tools/client-final-gates.tsv`. Affected reruns: `.tools/client-rerun-*.log`,
`.tools/client-final-targeted.log`, `.tools/client-final-api-build.log`.

`pnpm.cmd test:integration apps/api/test/integration/habits.spec.ts apps/api/test/integration/files.spec.ts apps/api/test/integration/planning.spec.ts apps/api/test/integration/data-reliability.spec.ts`
passed **77 tests / 4 complete files** (`.tools/client-final-regressions.log`).
Planning now expects the approved signup timezone. The reliability race uses
two actual timezone changes from that default, preserving its concurrency,
single-event and audit assertions. The future-resume case passed in the fresh
runner with the final Habit implementation; the original full runner had started
before that implementation change. The Files test failed during fixture login
(403), not a file authorization assertion; the complete unchanged Files suite
passed in this rerun. Together with the earlier Company/identity rerun, all six
original integration failures have passing final evidence.

Exact final Client integration command:

```powershell
pnpm.cmd test:integration apps/api/test/integration/habits.spec.ts apps/api/test/integration/messaging.spec.ts apps/api/test/integration/meetings.spec.ts apps/api/test/integration/social.spec.ts apps/api/test/integration/company-completion.spec.ts apps/api/test/integration/company-knowledge.spec.ts apps/api/test/integration/identity-lifecycle.spec.ts -t 'Client:|consolidated gaps: Company admissions|personal ownership'
```

Final formatting passed. Final full ESLint found only an unused type import and
an inline type import in the new Company callback signature; both were corrected
and `pnpm.cmd exec eslint apps/api/src/modules/spaces/application/company-access.service.ts --max-warnings 0`
passed. No behavior changed in that correction.

An unrelated existing Files security test failed in the full integration run.
`pnpm.cmd test:integration apps/api/test/integration/files.spec.ts -t 'requires current owner sessions'`
then passed unchanged (1 selected / 12 unselected), followed by the complete
13-test Files suite above. No authentication or Files behavior was weakened.

## Implementation record

Batch: CLIENT-BACKEND (owner-authorized cross-batch Client completion).
Status: COMPLETE for the requested backend work and applicable local gates.

- B1/B2: invitations persist encrypted delivery proofs in their existing offer
  transaction. The existing durable worker dispatches bounded SMTP attempts and
  materializes verified Conversation/Meeting recipients without joining them.
  Existing notification preferences supply global/module channel settings,
  quiet hours and separate Messaging push consent. Typed push attempts recheck
  source authorization, consent and subscriptions; leases fence stale workers.
  The Messaging notification pipeline recognizes the common invitation intent
  and does not send a second push.
- B3/B4: a recipient-only, per-kind invitation notification feed and read action
  reuse owner pending lists and admission checks. Social gains pending/proof
  endpoints, with current contact checks. Feed reads never admit a member;
  resolving an offer removes it. Recipient metadata projections require a
  transaction-bound authorization issued after the owner checks the offer.
- Company: optional position/supervisor fields use existing staff authority and
  a same-Company membership-generation snapshot. The Company owner validates and
  creates the staff profile atomically with invitation acceptance. Stale/foreign
  supervisors cannot partially admit a member. Existing signed batch effects
  cover membership and profile usage together.
- Habits: category, timeOfDay, preferredTime, fixed icon identifiers, Unicode
  unitLabel and explicit reminder settings are additive. Canonical unit and exact
  calculations remain intact. The existing scheduler checks each date's effective
  timezone, due/status/skip/completion state, including future resumes; reminder
  changes cancel unsent prior attempts and preserve delivery history/idempotency.
- Signup: newly provisioned settings use Asia/Tehran. Existing settings, schema
  defaults, signup bodies and saved schedules are preserved.
- Retention: v1 points to the current catalog; v2 reflects the confirmed owner
  records, including Social and Company. No policy is seeded or activated.

Files/modules changed: Habits, Notifications, Spaces, Company, Messaging,
Meetings, Social; narrow Account/Project/Team public projections; application and
worker composition; API contracts/OpenAPI; Client migration/test tooling and
retention documentation. All changes from baseline except the pre-existing
`compose.yaml` edit belong to this Client work. No P3 feature is removed or P4
implementation started.

Entities, migrations and constraints: additive M113
`202611250113_client_backend_completion`, M114
`202611250114_client_invitation_materialization`, M115
`202611250115_client_invitation_push_consent`. New `InvitationPushAttempt` has
exactly one typed offer source, recipient/subscription FKs and unique per-offer
subscription intents. Habit reminders have a same-space FK. Staff supervisor
references include the membership interval. Eight new FK edges bring the reviewed
catalog to 1,206. Migration bytes are frozen by exact SHA256 checks; no historical
migration is edited. The upgrade rehearsal checks populated P3 data, rollback,
resume/repeat deployment, legacy UTC/canonical units and cross-space constraints.

API contracts, events and jobs: four additive operations and 23 exact optional
body extensions, frozen separately from historical compatibility baselines.
See [Client contract](client-backend-contract.md) and [ADR 0075](adr/0075-client-integration-completion.md).
OpenAPI contains 1,412 operations and 13,041 resolved references. Reuse
`reminder.changed`, existing notification/outbox dispatch and periodic worker
recovery; no new external service, library, pg-boss queue or environment flag.

Security and edge cases: verified/current recipient fences; root email creation
does not reveal account existence; child Company admission remains mandatory;
proofs stay encrypted at rest and outside logs/feed payloads; sender-visible email
offers keep their public state/revision/proof across background materialization;
current issuer authority, restore/generation, expiry/revocation, push consent,
quiet hours, stale leases, membership isolation and habit completion are rechecked.

Tests not run and why: the existing conditional live ClamAV smoke requires a
configured live clamd host and was skipped unchanged. Scanner doubles and the
complete Files integration suite passed. E2E, frontend, live SMTP/push, Docker
release/deployment and server configuration checks were not run in this expressly
local backend task. Production activation/release remains a separate step.

Deviations from binding specs: none. The original checkpoint command exited 1;
its actual failures and passing affected reruns are recorded above, per section 16.
No tests, permissions, migration checks or compatibility assertions were disabled
to make the work pass. No missing product decision blocks this Client scope.

Git: no staging, commit, push, deployment or server configuration action. The
owner's pre-existing compose edit is preserved byte-for-byte (SHA256
`c42657021cd05da9ad7412dd67e675470b8029ffdabccb4b55035a363623cf20`).
P3 M112 remains unchanged.

Next eligible work: review/integrate these uncommitted Client changes. Commit,
push, deployment and Platform Admin P4 require separate authorization and have
not started.

## Owner acceptance and publication — 2026-11-25

The owner accepted the completed Client backend for local development and
explicitly authorized its separate commit/push, followed by local Platform Admin
P4. Reviewed the implementation diff, ADR 0075 and original/passing affected gate
logs without repeating completed verification. M113–M115 match their frozen
SHA256 values; no historical migration diff exists. `git diff --check` passed.
P3 `29aed23745ccf4905f2a80298e172d3337e7a738` was verified and normally pushed to
origin/main before Client publication. The owner's compose.yaml hash remains
`c42657021cd05da9ad7412dd67e675470b8029ffdabccb4b55035a363623cf20` and is excluded.
Local configuration, secrets and .tools evidence are excluded. P4 commit/push,
P5 and deployment still require separate approval.
