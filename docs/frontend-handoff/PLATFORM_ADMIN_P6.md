# Platform Admin P6 frontend handoff

Backend contracts only. No frontend source or deployment changes. Acceptance:
[P6 work record](../platform-admin-p6-work-record.md), [ADR 0078](../adr/0078-platform-admin-p6.md).
The authoritative strict input/output schemas are api-contracts/admin-configuration.ts;
both OpenAPI artifacts are synchronized. 17 Admin, one authenticated and
one public operation are added. Existing Client API signatures remain unchanged.

| Method | Route                                                            | Capability / authority               |
| ------ | ---------------------------------------------------------------- | ------------------------------------ |
| GET    | /api/v1/admin/configuration/catalog                              | admin.configuration.read             |
| GET    | /api/v1/admin/configuration/definitions                          | admin.configuration.read             |
| POST   | /api/v1/admin/configuration/definitions                          | admin.configuration.draft            |
| POST   | /api/v1/admin/configuration/definitions/:id/drafts               | admin.configuration.draft            |
| GET    | /api/v1/admin/configuration/drafts/:id                           | admin.configuration.read             |
| POST   | /api/v1/admin/configuration/drafts/:id/preview                   | admin.configuration.preview          |
| POST   | /api/v1/admin/configuration/drafts/:id/publish                   | admin.configuration.publish          |
| GET    | /api/v1/admin/configuration/definitions/:id/history              | admin.configuration.read             |
| GET    | /api/v1/admin/configuration/definitions/:id/effective            | admin.configuration.inspect          |
| POST   | /api/v1/admin/configuration/definitions/:id/rollback             | admin.configuration.draft            |
| POST   | /api/v1/admin/configuration/definitions/:id/kill                 | admin.configuration.kill             |
| POST   | /api/v1/admin/configuration/versions/:id/reopen                  | admin.maintenance.reopen             |
| GET    | /api/v1/admin/configuration/versions/:id/readiness               | admin.maintenance.reopen             |
| GET    | /api/v1/admin/configuration/definitions/:id/kill-release-preview | admin.configuration.kill             |
| POST   | /api/v1/admin/configuration/versions/:id/schedule-reopen         | admin.maintenance.reopen             |
| GET    | /api/v1/admin/configuration/versions/:id/reopen-schedule         | admin.maintenance.reopen             |
| GET    | /api/v1/admin/configuration/definitions/:id/events               | admin.configuration.read             |
| GET    | /api/v1/platform/configuration                                   | Current ordinary Workspace authority |
| GET    | /api/v1/platform/maintenance                                     | Public status only                   |

Only SUPER_ADMIN has the listed P6 capabilities. SUPPORT, BILLING_MANAGER and
SECURITY_REVIEWER receive no P6 access. Sensitive publication additionally requires
admin.configuration.sensitive.publish. All Admin requests recheck the separate Admin
session, persisted MFA within five minutes, account eligibility and exact capability.
Writes require trusted Origin, Idempotency-Key and reason. Reusing a key with a different
body conflicts. Revision-bearing writes reject stale state. Every attempt/outcome is audited.
Pages use after UUID and limit 1–100 (default 25), returning nextCursor.

Create a definition (dynamic Boolean FLAG, or exact PRODUCT/SETTING catalog key),
then create a draft with current revision and payload. Preview validates references,
types, windows and monotonic rollout steps; returns a diff, impact and fingerprint.
Impact population and oversize-file counts are conservative upper bounds, not exact
claims of changed recipients. Preview lasts fifteen minutes and binds the payload,
revision and target/admission fingerprint. Publish revalidates all of them. Publication
returns an immutable version. Rollback creates a new draft from a source version;
it goes through the same preview/publication/approval flow and creates a new version.

Payload has value, rules (up to 100), startsAt/ expiresAt (UTC or null), and
minClientVersion=1. Rules carry a strict GLOBAL, SCOPE_TYPE (PERSONAL/TEAM/COMPANY),
WORKSPACE, USER or GROUP target, typed value, priority 0–1000, basisPoints 0–10000,
and up to thirty ascending UTC steps with nondecreasing percentages. GROUP refers
to an existing Social Group scope; only current active members match. No cohort
creates membership or resource authority. Company child Teams use logical scope IDs.

Precedence: emergency kill > user > Workspace > group > scope type > global >
catalog default. Group ties use descending priority, then ascending rule position.
Workspace/type rollout rules bucket by Workspace; others bucket by user, falling
back to Workspace. SHA256(definition ID + NUL + subject ID), first unsigned 32 bits
modulo 10000, is stable across versions/steps. No stable subject means no partial
rollout match. Effective inspection returns source, rule position, version, bucket,
generation, evaluatedAt and nextChangeAt. Values are read from PostgreSQL with
Cache-Control: no-store. Honor time transitions; a generation alone is not a time cache.
Expired ordinary versions uncover the prior eligible version. Scheduled activation
rechecks initiating/approving authority. Workers reconcile durable activation/expiry
evidence; runtime time checks remain authoritative during worker downtime.

| Allowlisted key                | Type        | Sensitive |
| ------------------------------ | ----------- | --------- |
| uploads.maxBytes               | integer     | No        |
| tasks.defaultPriority          | priority    | No        |
| modules.tasks.enabled          | boolean     | No        |
| modules.files.enabled          | boolean     | No        |
| platform.locale                | locale      | No        |
| platform.notifications.enabled | boolean     | Yes       |
| platform.maintenance           | maintenance | Yes       |

uploads.maxBytes is an integer 1–104857600 and can never exceed the existing operator
FILE_MAX_BYTES admission ceiling. Lower limits affect new admissions and unfinished
uploads, with rechecks at finalization; existing READY files remain readable.
tasks.defaultPriority accepts NONE/LOW/MEDIUM/HIGH/URGENT for omitted priorities;
explicit priorities, templates and historical tasks retain their values.
Module switches restrict existing tasks/files. Platform locale is an inspectable
default for clients, not a change to saved user locale. Notification pause retains
pending durable deliveries; security/recovery notices retain their separate control path.
No secret, SMTP credential, database URL, encryption key, path, retention hold,
permission or infrastructure mutation can be entered through this catalog.

For sensitive publication, request an existing P2 security approval with action
CONFIG_PUBLICATION, targetId=draft.id, fingerprint=preview.impact.fingerprint, reason.
A different currently authorized Super Admin approves with recent MFA. Publish
consumes that exact approval. The P2 execute endpoint cannot execute a configuration
approval. Expired, self, mismatched and revoked-reviewer approvals fail.

Kill sets a flag false immediately, above all targeting, using admin.configuration.kill.
Removing it needs a distinct P2 CONFIG_KILL_RELEASE approval using the fingerprint
from kill-release-preview. This cannot grant RBAC, custody, retention or paid entitlements.

Maintenance value has SCHEDULED_NOTICE, READ_ONLY or FULL mode; an empty bindings
array means platform-wide, otherwise allowlisted module/operation pairs apply.
write includes upload/delete; read/export are separate operations. Notice permits
work. Read-only rejects mutations with 503 and preserves reads/exports. Full rejects
matching reads and writes with 503. Admin control, liveness and maintenance status
remain accessible. Resource-specific maintenance never changes data ownership.

Provide localized messages (1–20 locale keys, defaultLocale must exist),
estimatedEndAt (UTC/null), progress 0–100 and safe status text. Public status exposes
active, startsAt, countdownToStartSeconds, estimated-end countdownSeconds,
overrunning, progress and lastUpdatedAt. Future maintenance appears before it starts.
Countdown zero and progress=100 are presentation only: neither releases a fence.
Every unreleased active maintenance version remains authoritative; publishing a
weaker notice/rollback cannot cancel an older fence. At most 99 outstanding versions
are allowed. Releasing old versions requires the controlled reopen workflow.

For manual reopen, read versions/:id/readiness and request distinct P2
MAINTENANCE_REOPEN approval for its fingerprint. POST reopen consumes it only after
actual DB, queue, worker, storage, delivery and erasure/restore readiness pass.
For an approved scheduled end, pass notBefore (UTC) to readiness, bind the approval
to that exact fingerprint, then POST schedule-reopen with the same timestamp.
This is separate from estimatedEndAt and may be at most thirty days ahead.
Durable sweeps keep WAITING on failed health checks and retry no earlier than one
minute later; revoked operators or changed configuration revisions enter REVIEW.
Only current authority plus successful readiness permits RELEASED. Manual release
cancels a still-pending schedule. GET reopen-schedule exposes actual durable state.

Generic maintenance definition inspection selects the latest eligible unreleased
version; public status is the authoritative aggregate of all remaining fences.
Public maintenance status remains useful during database failure via the P3 signed
operator control. UNAVAILABLE is a fail-closed 503; INDEPENDENT identifies fallback
evidence and available=false. Never interpret a stale READY fallback as database
readiness. There is no unauthenticated emergency mutation API.

Protected local operator commands (built backend required):

- pnpm.cmd ops:admin status
- pnpm.cmd ops:admin emergency-pause <run-uuid> [local-maintenance-json-file]
- pnpm.cmd ops:admin emergency-reopen <same-run-uuid> "Reviewed recovery reason"

Offline pause/status do not bootstrap the app or contact PostgreSQL. Existing or
unknown restrictions may only escalate to global Full Maintenance offline; restore
states cannot be replaced. Reopening requires recovered dependencies and writes
audit evidence before atomically releasing the signed independent fence. Database
maintenance stays authoritative. Writer lock files fail closed after interruption;
an operator must verify the writer is stopped before removing an abandoned lock.
Unknown/corrupt prior status remains a FAILED global fence requiring the P3 recovery
path. Status exceeding its encoded 32 KiB budget cannot replace valid evidence.
Never restore old control archives over current controls. P3 restore verification
remains mandatory for RESTORING/VERIFYING/FAILED states. No traffic switch/deployment
is performed by these commands.
