# P5-03 completion report

Batch: **P5-03 — Attachments, Voice, Delivery/Read States and Notifications**.
Status: **COMPLETE locally; awaiting owner acceptance**, 2026-11-09 (Asia/Tehran).

## Publication prerequisite

P5-02 was committed and pushed at
**5a074703bc402b706916fb44d6360373768033cf**, independently verified against the
actual origin/main SHA. Parent: dd73a901b1ed55d5a44d5fda225b798143003166.
Exactly the 35 approved paths were checked against the accepted manifest and Git
blobs and published. The accepted P5-02 quality gate was not repeated for
publication. P5-03 has no commit or push.

## Scope implemented

- Private FILE/IMAGE/VOICE uploads, content/size/hash checks, safe names,
  cancellation, authorized downloads and bounded durable cleanup. Final upload
  and download checks cover revocation, current admission/history and every live
  forwarding source, including work-channel file.read authority.
- Actual media message entries and typed file links; no placeholder text.
  Caption revisions, replies/threads, live forwards, reactions, pins, mentions,
  literal authorized search and REST incremental history/change polling preserve
  the prior messaging rules.
- Canonical 16-bit PCM WAV voice, actual-byte-derived duration ≤120 seconds,
  maximum 10,000,000 bytes and any lower configured file limit; one recording per
  voice message. Images use PNG/JPEG; general files retain the existing allowlist.
- Explicit durable monotonic/idempotent DELIVERED/READ progress, including Viewer
  personal acknowledgements. Sharing initially off per admission; only the
  authorized author sees mutually opted-in aggregate counts. No reader list,
  timestamps, presence or shared read-activity audit. Rejoining resets progress/
  consent; closure erases private progress/settings/keys.
- Separate initially-off messaging Web Push consent, existing owned subscription
  contracts, personal ALL/MENTIONS_ONLY/MUTED routing and recipient-timezone quiet
  hours. Future message/mention and valid named-invitation notices; no backlog
  replay. Equal timestamp boundaries fail closed.
- Durable metadata-only fanout and per-subscription attempts through existing
  pg-boss maintenance/outbox. Claim and final authorization are distinct; source,
  privacy, unread state, ownership and subscription revision are checked before
  sending outside business locks. Generic payloads, five-send bounded retry,
  404/410 secret clearing, seven-day expiry and AMBIGUOUS recovery without resend.
  In-flight requests cannot be recalled; actual outcomes remain recorded and
  cancellation prevents retry. Notice reads do not acknowledge message reads.
- Personal closure/purge integration cancels pending work, deletes personal
  receipt/preferences and permits subscription erasure without deleting retained
  shared content. Existing disposal blockers continue to protect linked files.

Files/modules changed: **59 task paths: 36 tracked modifications and 23 new files**.
The exact path/status/SHA-256 inventory is in
[the change manifest](p5-03-change-manifest.json). Main owners are Messaging,
Notifications and their Spaces public authority; StoragePort/SharedFiles, account
lifecycle, worker wiring, Prisma, contracts and focused verification are extended.
No dependencies or providers were added.

## Entities, migration, APIs and events

M042 adds nine tables and seventeen typed FKs, private default-off consent columns,
a unique invitation identity and only the reviewed additive MEDIA branch in the
MessageEntry CHECK. No published SQL is rewritten. Catalog: 214 domain tables,
215 with the migration ledger; 66 canonical migrations and 698 FKs.

Migration SHA-256:
`66210c92ed0e06fb7e60afb5041952b868d88553f52c24c647533e16b8f729d9`.
FK catalog:
`d436234ba7935d306ccbb32ee1d78eeb7a980d52b21e1ed332cb3e8ab73014e7`.
See [migration review](p5-03-migration-review.md) and
[API/security contract](p5-03-contract.md).

There are **25 additive operations**, **736 total OpenAPI operations** and
6,597 resolved references. All 711 published operation shapes and prior frozen
baselines remain compatible; 154 published P5-02 delta signatures were frozen.
Future MessageActivity records commit atomically with new messages/invitations;
no historical push activity was backfilled. Existing pg-boss queue schema and
scheduled sweep are reused.

## Verification and exact commands

The mandatory thirteen-stage gate ran **once** using the approved fresh isolated
baseline and a child-only TEST_DATABASE_URL override:

```powershell
node --env-file-if-exists=.env.test.local .tools/p5-03-baseline.mjs --run quality
```

All thirteen stages executed. The raw process exited **1**: twelve stages passed;
integration initially had **887 passed / 2 failed**. The nonintegration stage
passed **652 tests in 137 files**. The two integration failures were corrected
without weakening assertions, changing database constraints or raising timeouts:

- The new media pin test omitted the mandatory current revision after a reaction;
  it now supplies revision 2.
- The existing Team fixture used two separate clock calls for an exactly
  720-hour deadline. It now derives both instants from one captured clock value.

Affected verification then passed:

```powershell
node --env-file-if-exists=.env.test.local .tools/p5-03-baseline.mjs --run test:integration apps/api/test/integration/messaging.spec.ts apps/api/test/integration/team-lifecycle.spec.ts
```

**113/113 passed**, covering both initially failing files. A subsequent
timestamp-boundary regression exposed the messaging fixture's missing UTC
connection option; it now matches production DatabaseService. The affected
messaging/notification run passed 141 cases with that new boundary case initially
failing; after correcting the fixture, final messaging verification was:

```powershell
node --env-file-if-exists=.env.test.local .tools/p5-03-baseline.mjs --run test:integration apps/api/test/integration/messaging.spec.ts
```

**95/95 passed**, including all prior messaging cases and 33 new P5-03 integration
cases. The 47 existing notification/job cases passed against the final application
changes. Final distinct coverage is **1,542 cases: 652 nonintegration + 890
integration**, counting each case once across the full run and affected reruns.

```powershell
node --env-file-if-exists=.env.test.local .tools/p5-03-baseline.mjs --run typecheck
node --env-file-if-exists=.env.test.local .tools/p5-03-baseline.mjs --run smoke:p5-03
```

Final typecheck passed. Build, changed-file ESLint and Prettier also passed after
the notification boundary changes. Earlier focused contract/transport/
compatibility verification passed **45/45**; storage/WAV verification passed
**12/12**. The full gate's architecture check passed with 528 modules and 3,446
dependencies. OpenAPI matches the generated snapshot.

Compiled smoke passed with actual fresh API/worker processes: real voice bytes/
duration, private progress, current media cursor and accepted messaging survive
API restart; durable generic Push is sent by the actual worker across restart.
The longer smoke now paces HTTP requests within unchanged IP/actor rate budgets
after an initial unpaced run correctly received 429. No production limit was
relaxed.

M042 upgrade rehearsal passed: all **205 predecessor datasets**, populated
eleven-table M041 history, **65 old checksums**, existing constraints except the
reviewed additive branch, forced rollback, repeat deploy, future activity trigger,
no historical notice backlog, immutable media revision/progress constraints and
the exact 698-FK catalog. Final baseline checksums all match.

Local ignored evidence includes .tools/p5-03-quality.log,
.tools/p5-03-affected-113.log, .tools/p5-03-affected-142-initial.log,
.tools/p5-03-test-integration.log, .tools/p5-03-typecheck.log,
.tools/p5-03-smoke-p5-03.log and .tools/p5-03-final-preservation.json.
The raw failed gate is retained; the full gate was not repeated.

## Preservation, limitations and stopping point

Final independent read-only data/catalog snapshots match preflight for the legacy
M031-drift database and accepted P4-06, P5-01 and P5-02 databases. All **12 unrelated
documents, five environment files and 66 published migration artifacts** are
byte-identical. Prototype/acceptance evidence is retained. No historical repair,
database reset or protected-database migration occurred.

Tests not run: Docker/Compose/release restore, production migration/deployment,
live SMTP/Push-provider delivery, hosted CI and frontend PWA/Service Worker.
These remain outside this authorized local batch; Web Push was verified through
the actual private sink and mocked provider classifications. No deployment or
Shared activation occurred. WAV validation is not antivirus or transcoding.

Deviations from approved specifications: **none**. Both owner privacy decisions
are approved in [ADR 0047](adr/0047-messaging-receipts-and-notification-privacy.md).
Outstanding owner decisions/blockers: **none for local P5-03 acceptance**.
The narrow test-fixture clock/UTC corrections are recorded above.

Git: branch **main**, HEAD/origin tracking ref remain
**5a074703bc402b706916fb44d6360373768033cf**. Index is empty. All **59 P5-03 paths
remain unstaged, uncommitted and unpushed**; the 12 unrelated files remain
untracked and excluded. `git diff --check` passed.

Next eligible batch: **P5-05 — NOT STARTED**, requires separate owner approval.
P5-04 remains **DEFERRED**. No WebSocket, presence, live typing, native calls,
meetings, P5-06 or later work was started.
