# 0078: Platform Admin P6 versioned configuration and maintenance

Local implementation verification: **COMPLETE — LOCAL DEVELOPMENT**, 2026-11-26;
final complete runs passed 1,018 repository and 1,362 PostgreSQL cases. Full evidence
and release-only exclusions are in [the P6 work record](../platform-admin-p6-work-record.md).
No P6 publication, deployment or P7 authorization is implied.

Status: owner-authorized engineering decisions, 2026-11-26. P6 implementation and
local verification are authorized; publication, deployment and P7 are excluded.

The platform configuration owner maintains flags, allowlisted typed product
configuration and platform settings. Runtime evaluation only restricts existing
authority. It cannot create membership, change RBAC, enable commercial access,
raise infrastructure safety ceilings, release holds or alter custody/retention.
Secrets, credentials, paths and arbitrary scripts are outside its catalog.

Precedence is emergency kill, user, Workspace, group, scope type, global, catalog
default. Equal-specificity group matches use explicit priority then stable rule
position. Percentage rollout uses SHA256 of definition ID and stable subject ID;
versions and step changes preserve buckets. Workspace/scope-type rules use the
Workspace identity when present; other rules use the user identity, falling back
to Workspace identity. Anonymous partial rollout has no invented identity.
Basis points are integers 0–10000.
Rules and published versions are immutable. Expired versions uncover the most
recent eligible prior version; rollback creates a new version. Maintenance end
times are estimates and never remove an enforcement fence.

Draft preview is valid for fifteen minutes and binds the expected definition
revision, normalized payload and target-impact fingerprint. Publication rechecks
references and impact. Sensitive notification-policy changes, maintenance
publication/reopening and emergency-kill removal require a distinct P2 approval
with recent MFA at approval and current reviewer eligibility at execution.
Emergency restriction needs its dedicated capability but no second operator.
Scheduled publication rechecks initiating authority, uses PostgreSQL as the
source of truth and is reconciled by the existing pg-boss sweep. Evaluation checks
time on every read, so worker delay cannot extend ordinary flag/config windows.

Effective reads query current PostgreSQL state without an in-process value cache;
an incrementing generation and next transition time support client invalidation.
Control messages have localized text, progress, estimate and last-update time.
Scoped maintenance uses an explicit module/operation allowlist. Control/status
and recovery remain available outside ordinary traffic fences. A protected signed
filesystem control provides status and restrictive emergency control while DB/API
is unavailable; only the separately provisioned local operator can use it offline.
Missing/corrupt configured independent control fails closed. Reopening requires
healthy database, queue, storage, delivery, worker, erasure and restore controls;
an estimate reaching zero cannot authorize reopening or bypass P3 restore gates.

M122 owns seven configuration/history/control tables and thirteen typed FKs.
M123 adds one release-schedule table with two configuration/approval FKs. The
original P2 non-self-approval and MFA-recovery target checks remain intact; only
the action allowlist and matching action/target check expand for P6 approvals.
Explicit scheduled reopening is separate from estimated end time: readiness
preview binds a notBefore timestamp, exact version/revision and distinct P2
approval. PostgreSQL persists attempts and WAITING retries, while changed authority
or revision requires REVIEW. Both operators must remain eligible. A valid approved
schedule may release only after actual dependency and restore checks succeed.
Manual authorized reopening cancels a pending schedule. Terminal requests and
published values remain immutable. No customer work is deleted by configuration.

Safety/lifecycle/entitlement-expiry reconciliation and security/recovery notices
retain their existing control path during maintenance; ordinary business effects,
reminder/communication delivery and invitation delivery use the runtime fences.
The protected operator can impose restrictive maintenance offline and can recover
its exact run only after DB/queue/storage/worker/delivery/privacy checks return.
RESTORING/VERIFYING/FAILED remain exclusively in the existing P3 restore workflow.
Signed status writes use an exclusive file lock and atomic durable rename;
abandoned locks fail closed and require verified operator recovery.

Generation 1 is the initial state, before any definition exists. Definition creation
and every published control change advance the same database generation. Requests
read it directly; there is no cached value or per-request global reconciliation lock.
Domain mutations hold its row FOR SHARE until commit, so a publishing/kill/release
transaction commits after already-admitted writes. Time evaluation remains live
when the worker is unavailable. UUID subjects and case-insensitive HTTP route
classification are canonicalized before targeting/bucketing. Department/Unit and
Project contexts inherit their current Team/Company Workspace; logical child Teams
retain their own identifiers. Configuration grants no authority in those scopes.

An unreadable/missing independent status may only become a signed FAILED global
fence; it cannot become resumable ordinary maintenance. P3 verification remains the
recovery path. Encoded status over 32 KiB is rejected before replacing prior evidence.
