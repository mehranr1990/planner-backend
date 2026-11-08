# P5-01 local acceptance

Batch: **P5-01**. Status: **COMPLETE for the approved LOCAL foundation scope**,
2026-11-08. P5-02 and later batches are not started. No Shared activation or
production/release acceptance is claimed.

## Completed scope and architecture

- Durable DM, private-group and exact Project/Team/Company-root work channels.
  Explicit invitation acceptance; no pending-invitee content access. Fixed DM pair;
  private-group administrator delegation/removal/leave; final administrator
  departure leaves retained content read-only. Work-channel management uses the
  approved Owner/Admin or Company Owner/Org Admin matrix; source Viewers cannot send.
- Separate conversation participation and source membership. Grant-only admission,
  Company affiliation/attachment and administrative roles never imply message
  access. Rejoining requires explicit admission and starts a new generation/history
  floor. Current source, account, session and participant authority is rechecked
  inside existing account/identity/custody fences before reads, writes and replay.
- Durable ordered plain text, stable UUIDs, DB-allocated per-conversation sequence,
  lasting send-key uniqueness and request fingerprints. Concurrent retries cannot
  double-send or double-create a conversation. Source/body/evidence changes commit
  atomically; recognized rollback remains retryable; uncertain signed outcomes
  remain closed for existing operator reconciliation.
- Signed bounded initial/incremental REST history. Empty polls retain a usable
  cursor; ordinary sends do not invalidate it. Cursor ownership, conversation,
  admission/source generations, policy and restore epoch are checked. No pre-join
  message retrieval, stale rejoin cursor or old-send replay bypass.
- Metadata-only audit/outbox and the existing free-mode feature/usage seam. Opaque
  retained authorship survives recipient erasure without copying live profile
  fields. Independent conversations use typed CONVERSATION shared custody; work
  channels retain their exact existing source ownership. Custodial owner exit
  retains the existing freeze rules; no automatic succession is invented.
- Existing source disposal pauses before destructive work when a conversation
  requires the later messaging-retention implementation. No message purge or new
  retention duration is introduced. Independent creation requires an explicitly
  configured policy applicable to CONVERSATION; fixtures use synthetic policies.

[ADR 0044](adr/0044-phase-5-rest-polling-and-realtime-deferral.md) records approved
REST/polling and P5-04 deferral; [ADR 0045](adr/0045-conversation-admission-and-history-policy.md)
records the owner's three explicit policy approvals. The V3 registry, spec,
roadmap and acceptance requirements are amended accordingly. Push Notifications
remain independent P5-03 scope. No new dependency, provider or infrastructure.

Files/modules changed: new Messaging owner, Spaces-owned MessagingAuthority facade,
application registration, source cleanup integration, contracts/OpenAPI, Prisma/SQL,
focused tests, migration verification and compiled smoke. The
[exact change manifest](p5-01-change-manifest.json) lists every task path and excludes
the original 12 unrelated untracked documents. [Contract/traceability](p5-01-contract.md)
documents limits, revisions, permissions and operation-to-test coverage.

## Schema, APIs and evidence

Entities: Conversation, ConversationMember, ConversationAdmission,
ConversationInvitation and ConversationMessage. One additive migration:
`202611080040_messaging_foundation`; SHA-256
`1547e55d69c31442b7900819a5587036bf304fc0971a4410ac02dda68f9674f5`.
Eighteen new FKs; typed source/author/admission constraints, open-admission/pending-
offer uniqueness, text/state/revision/time bounds and durable send/order uniqueness.
Two existing CHECK catalogs expand while preserving every old literal. No old SQL,
row, column, FK, function or trigger is rewritten. See [migration review](p5-01-migration-review.md).

**14 additive REST operations; 700 total OpenAPI operations / 6,236 references.**
They cover creation/list/get, members, invitation create/revoke/list/accept/decline,
member role/remove/leave and send/history/polling. Strict Zod schemas and actual
controller responses match generated [OpenAPI JSON](api/openapi.json). Frozen
baselines are unchanged. An additional 280-signature P4-06 delta is derived from
accepted commit `8ab53e6c5d6acb973c64f81ad27ccd4e01e25fe8`, avoiding duplication of
earlier frozen signatures. No Swagger HTTP route/UI is registered by bootstrap.

Events: existing SharedAuditEvent/SharedOutboxEvent metadata for conversation
creation, invitation decisions/revocation, participation/role changes and sends.
No message body, User profile or token enters those envelopes. No new queue or
delivery worker; existing registered cleanup consumers use the Messaging guard.

A genuine existing concurrency defect surfaced in the full gate: a signed-control
reader rejected the transient two-link inode between atomic staging publication
and staging-name removal. The focused fix accepts only the exact same-device/inode
staging/final pair. Signature, regular-file, symlink, unrelated-link and extra-link
checks remain enforced. Deterministic positive/negative tests and observed DB
revocation races pass. LocalFileStorage's ordinary private-file policy is unchanged.

## Quality and reproducible commands

Commands below run through the ignored canonical-baseline runner so the legacy
`.env.test.local` target is never selected as an acceptance baseline:

`pnpm.cmd exec node --env-file=.env.test.local .tools/p5-01-baseline.mjs --run <command>`

The runner invokes the same pinned pnpm entry point and captures native exit codes;
it changes only child-process TEST_DATABASE_URL. Protected environment files remain
unchanged. Its retained baseline selection is `.tools/p5-01-approved-baseline.json`.

The full `quality` command ran **all 13 stages once**, raw exit **1**;
`.tools/p5-01-quality.log`. There was **no second full quality run**. Two stages
failed initially; only affected checks were rerun after fixes:

| Stage               | Actual result                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| config:check        | PASS                                                                                                     |
| db:generate         | PASS                                                                                                     |
| auth:schema:check   | PASS                                                                                                     |
| db:validate         | PASS                                                                                                     |
| build               | PASS; final affected build also PASS                                                                     |
| typecheck           | PASS; final affected typecheck also PASS                                                                 |
| format:check        | PASS; final affected source/document checks PASS                                                         |
| lint                | PASS; affected storage/test/smoke checks PASS, zero warnings                                             |
| architecture        | PASS; affected final architecture check PASS                                                             |
| test                | 627 passed / 1 failed; pinned migration list extended with M040; affected foundation/storage checks PASS |
| openapi:check       | PASS, frozen compatibility retained                                                                      |
| test:integration    | 825 passed / 1 failed; signed publication race fixed; affected 58 cases PASS                             |
| db:migrations:check | PASS, including populated M040 preservation/rollback/repeat deployment                                   |

Exact affected commands after the full gate:

- `--run test:unit apps/api/src/platform/storage/shared-control.spec.ts apps/api/src/platform/database/foundation.spec.ts`:
  **11/11 PASS**; `.tools/p5-01-test-unit.log`.
- `--run test:integration apps/api/test/integration/company-staff.spec.ts apps/api/test/integration/messaging.spec.ts`:
  **58/58 PASS**; preserved `.tools/p5-01-affected-58.log`.
- After tightening the publication filename match, the same two integration files
  with `-t 'commits a winning mutation|serializes a winning send|denies a waiting send'`:
  **4/4 selected PASS**, 54 filtered; `.tools/p5-01-test-integration.log`. These
  overlap the 58 cases and are not counted again.
- `--run typecheck`, `--run build`, `--run architecture`: **PASS**; corresponding
  `.tools/p5-01-*.log` files.
- `--run exec eslint apps/api/src/platform/storage/shared-control.ts apps/api/src/platform/storage/shared-control.spec.ts apps/api/src/platform/database/foundation.spec.ts tooling/scripts/p5-01-smoke.ts --max-warnings 0`:
  **PASS**; `.tools/p5-01-exec.log`.
- `--run smoke:p5-01`: **PASS**, native exit 0;
  `.tools/p5-01-smoke-p5-01.log`. Actual compiled API processes restart around a
  committed accepted DM; old cursor and send key remain safe. The actual worker
  moves an expired source closure to BLOCKED_POLICY before destructive work;
  retained channel history and that durable state survive a second worker process.
  An initial extended-smoke fixture used separate interval/access end timestamps;
  the existing integrity trigger rejected it. The fixture now copies the exact
  authoritative timestamp; no constraint, timeout or runtime guard was weakened.

Final distinct coverage is **629 non-integration cases and 826 integration cases
(1,455 total)** across the original run and affected reruns. This includes 31 new
Messaging integration cases, five domain/contract cases and one additional signed-
publication regression case. Overlapping targeted reruns are not added to totals.
No required active-scope assertion was skipped or removed, and no timeout increased.

## Migration and preservation results

- New canonical local database: all **64 migration checksums match**, repeated
  deployment and status PASS; exact **655-FK** catalog. The configured development
  database and previous Phase 4 acceptance database are not migrated or repaired.
- M040 rehearsal preserves **189 populated predecessor datasets and 63 prior
  checksums**, every old FK and all constraints except its two reviewed expansions.
  Forced interruption rolls back all DDL; normal/repeat deploy and exact catalog
  assertions PASS. All earlier migration rehearsals also pass in the full gate.
- `node --env-file=.env.test.local .tools/p5-01-preservation.mjs`: **PASS**.
  Original 190 table datasets including the M031-drift ledger, and column,
  constraint, function, trigger and index catalogs match the prior accepted
  snapshot. All 12 unrelated documents, five environment files and 64 historical
  migration artifacts (63 SQL plus lock) remain byte-identical. Evidence stores
  counts/digests, not private row bodies.
- Final focused Prettier and `git diff --check`: **PASS**. Working-tree manifest,
  baseline/hash checks and empty-index verification are retained for owner review.

## Boundaries and Git

Deviations: only the owner-approved REST/polling amendment and approved ADR 0045
policies. The signed-control publication fix is necessary shared-concurrency
correctness work, not a new product permission. Outstanding P5-01 blockers: **none**.

**NOT RUN / DEFERRED:** P5-02 advanced messages/edit/delete/search/moderation;
P5-03 media/voice/read-delivery/Push delivery; P5-04 sockets/presence/typing;
P5-05 meetings; P5-06 final retention/recovery/privacy/load acceptance. Message purge,
custodial owner-exit recovery and production retention remain in their designated
later scope; source disposal with conversations is intentionally blocked until then.
Docker, production database changes, Shared activation, hosted release/backup and
deployment checks were not performed. No required active P5-01 gate remains unrun.

Git: branch `main`, HEAD `8ab53e6c5d6acb973c64f81ad27ccd4e01e25fe8`;
local origin/main and live remote matched at preflight. **54 task paths: 31 modified
tracked files, 23 new files**, plus the original 12 unrelated untracked documents.
Exact paths/statuses and diff statistics are in the manifest. Index empty;
everything remains **UNSTAGED, UNCOMMITTED and UNPUSHED**. No deployment.

Next eligible batch: **P5-02 — NOT STARTED; requires explicit owner authorization**.
