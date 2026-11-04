# P2-03 implementation contract

Authorization: owner accepted P2-02 and explicitly authorized P2-03 local
implementation. Sources: approved V3 P2-03/M05, ADRs 0024–0031 and the G0
prerequisite register. Shared activation, deployment and production migration are
not authorized by this batch.

Projects owns independent Project identity, structural components, primary source
associations and structural member responsibilities. Spaces owns custody,
membership, policy, grants and restrictive fencing. Tasks and Goals retain their
existing tables, domain behavior and public owner facades. Existing Personal and
P2-02 request/response signatures remain compatible. Typed Team/Company association
intents are non-executable; no Team/Company entities or attachment routes exist.

## G2 operation and authorization matrix

Every route below is under `/api/v1`. Operation IDs are taken from the canonical
[OpenAPI](api/openapi.json). The route-contract test compares all 38 operations
against actual Nest handlers. The frozen P2-03 signature baseline also contains
all prior operations. Matrix test labels refer to the coverage registry below.

| Operation                                                    | Actual operationId                                         | Current authority / command                                                        | Tests      |
| ------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------- |
| POST /projects                                               | `projectpostprojects`                                      | verified personal account; retention-approved custody provision                    | C, M, H    |
| GET /projects                                                | `projectgetprojects`                                       | current full admission + task.read                                                 | H, F       |
| GET /projects/{id}                                           | `projectgetprojectsid`                                     | task.read on full scope or exact PROJECT grant                                     | C, R, F    |
| PATCH /projects/{id}                                         | `projectpatchprojectsid`                                   | settings.manage + task.read                                                        | S, F, H    |
| POST /projects/{id}/archive                                  | `projectpostprojectsidarchive`                             | current custody.archive authority; matching lifecycle state                        | L, F       |
| POST /projects/{id}/restore                                  | `projectpostprojectsidrestore`                             | current custody.archive authority; matching lifecycle state                        | L, F       |
| POST /projects/{id}/deletion-request                         | `projectpostprojectsiddeletionrequest`                     | custody.dissolve; sole full custodian; current provider password                   | L, H       |
| GET /projects/{id}/lifecycle                                 | `projectgetprojectsidlifecycle`                            | current primary/former primary or current full admission; minimal metadata only    | L          |
| GET /projects/{id}/access-policy                             | `projectgetprojectsidaccesspolicy`                         | settings.manage; current policy version on PUT                                     | S, F       |
| PUT /projects/{id}/access-policy                             | `projectputprojectsidaccesspolicy`                         | settings.manage; current policy version on PUT                                     | S, F       |
| GET /projects/{id}/components/{kind}                         | `projectgetprojectsidcomponentskind`                       | full-scope task.read                                                               | S, M, H    |
| POST /projects/{id}/components/{kind}                        | `projectpostprojectsidcomponentskind`                      | work.manage (plus task.read for create/patch)                                      | S, M, H    |
| PATCH /projects/{id}/components/{kind}/{componentId}         | `projectpatchprojectsidcomponentskindcomponentId`          | work.manage (plus task.read for create/patch)                                      | S, M, H    |
| DELETE /projects/{id}/components/{kind}/{componentId}        | `projectdeleteprojectsidcomponentskindcomponentId`         | work.manage (plus task.read for create/patch)                                      | S, M, H    |
| GET /projects/{id}/tasks                                     | `projectgetprojectsidtasks`                                | full-scope task.read                                                               | S, R, F, H |
| POST /projects/{id}/tasks                                    | `projectpostprojectsidtasks`                               | task.create + task.read                                                            | S, R, F, H |
| GET /projects/{id}/tasks/{taskId}                            | `projectgetprojectsidtaskstaskId`                          | task.read on scope or exact TASK grant                                             | S, R, F, H |
| PATCH /projects/{id}/tasks/{taskId}                          | `projectpatchprojectsidtaskstaskId`                        | exact task.read + task.update and/or task.complete according to fields/status      | S, R, F, H |
| GET /projects/{id}/tasks/{taskId}/association                | `projectgetprojectsidtaskstaskIdassociation`               | full-scope task.read                                                               | S, M, R    |
| PUT /projects/{id}/tasks/{taskId}/association                | `projectputprojectsidtaskstaskIdassociation`               | work.manage + full-scope task.read                                                 | S, M, R    |
| GET /projects/{id}/goals                                     | `projectgetprojectsidgoals`                                | full-scope task.read                                                               | S, R, F, H |
| POST /projects/{id}/goals                                    | `projectpostprojectsidgoals`                               | goal.manage + task.read                                                            | S, R, F, H |
| GET /projects/{id}/goals/{goalId}                            | `projectgetprojectsidgoalsgoalId`                          | task.read on scope or exact GOAL grant                                             | S, R, F, H |
| PATCH /projects/{id}/goals/{goalId}                          | `projectpatchprojectsidgoalsgoalId`                        | exact task.read + goal.manage (typed grant update)                                 | S, R, F, H |
| GET /projects/{id}/goals/{goalId}/association                | `projectgetprojectsidgoalsgoalIdassociation`               | full-scope task.read                                                               | S, M, R    |
| PUT /projects/{id}/goals/{goalId}/association                | `projectputprojectsidgoalsgoalIdassociation`               | work.manage + full-scope task.read                                                 | S, M, R    |
| PUT /projects/{id}/goals/{goalId}/tasks/{taskId}             | `projectputprojectsidgoalsgoalIdtaskstaskId`               | full-scope goal.manage + task.read; both source-owner facades                      | S, M       |
| GET /projects/{id}/member-assignments                        | `projectgetprojectsidmemberassignments`                    | work.manage; eligible current full-member generation for create                    | S, M       |
| POST /projects/{id}/member-assignments                       | `projectpostprojectsidmemberassignments`                   | work.manage; eligible current full-member generation for create                    | S, M       |
| POST /projects/{id}/member-assignments/{assignmentId}/revoke | `projectpostprojectsidmemberassignmentsassignmentIdrevoke` | work.manage; eligible current full-member generation for create                    | S, M       |
| POST /projects/{id}/leave-collaboration                      | `projectpostprojectsidleavecollaboration`                  | own current guest admission; narrow self-departure                                 | L, R       |
| POST /projects/{id}/resource-invitations                     | `projectpostprojectsidresourceinvitations`                 | membership.member + current delegation of every offered capability on exact target | R, F, M, H |
| GET /projects/{id}/resource-invitations/{offerId}            | `projectgetprojectsidresourceinvitationsofferId`           | membership.member + current delegation of every offered capability on exact target | R, F, M, H |
| POST /projects/{id}/resource-invitations/{offerId}/revoke    | `projectpostprojectsidresourceinvitationsofferIdrevoke`    | membership.member + current delegation of every offered capability on exact target | R, F, M, H |
| POST /projects/{id}/grants/{grantId}/revoke                  | `projectpostprojectsidgrantsgrantIdrevoke`                 | membership.member + current delegation of every offered capability on exact target | R, F, M, H |
| GET /resource-invitations/preview                            | `projectgetresourceinvitationspreview`                     | proof + current valid issuer/target; anonymous generic preview                     | R, F, H    |
| POST /resource-invitations/{id}/accept                       | `projectpostresourceinvitationsidaccept`                   | verified exact recipient + proof + current issuer/target/admission snapshot        | R, F, H    |
| POST /resource-invitations/{id}/decline                      | `projectpostresourceinvitationsiddecline`                  | verified exact recipient + proof + current issuer/target/admission snapshot        | R, F, H    |

All protected operations require a current verified account/session, enabled
shared configuration and current custody/policy/admission authority. Roles remain
the approved fixed Owner/Admin/Manager/Member/Viewer roles with current policy and
immutable ceilings. Grants cannot bypass a suspended admission, Viewer write
ceiling, inactive issuer, revoked generation, expiry or missing delegation power.
Project grants allow named Project read only; Task grants allow read/update/complete;
Goal grants allow read/update. A grant requires read and exactly one typed target.
Narrow grants permit no source list, directory, structure, count or unrelated read.
Issuer demotion or policy removal permanently revokes dependent grants: subsequent
promotion or policy repair cannot revive them. Full membership remains independent.

## Input, revision, retry and pagination contract

Strict Zod bodies reject unknown fields; UUIDs and target-specific capabilities are
validated. Unsafe operations require trusted Origin. All responses are no-store.
Proofs use only redacted `X-Invitation-Proof`, never a query parameter. The initial
offer response returns the random proof once; persistence stores only its hash,
and create replay returns `proof: null`. Offers bind an existing verified recipient
to a local actor and current admission snapshot; forwarded proof is insufficient.

POST returns 201; GET/PATCH/PUT/DELETE returns 200. Quoted positive If-Match is
required on updates, lifecycle, association and terminal offer/grant commands.
Creates and Task/Goal PATCH require Idempotency-Key (1–128 printable ASCII).
Receipts bind operation, fingerprint and admission generation; current authority
is checked before replay. Source PATCH receipts persist HTTP 200. Project creation
replay checks its stable ID, key, fingerprint and current creator identity/authority.
Other structural changes use revision conflicts rather than implicit retries.

400 means invalid envelope/cursor; 401 missing or invalid session; 403 current
capability/activation denial; 404 safe absence or invalid proof; 409 stale revision,
generation, changed cursor authority, state or idempotency fingerprint; 429 abuse
ceiling. Unavailable independent control fails closed. Existing error envelopes
and Personal pagination remain unchanged.

Lists default to 25 and cap at 100. Opaque signed cursors bind actor, collection,
scope and current authorization versions/generations; current access is rechecked
before pagination. Structure orders by position then ID, other lists by ID.
Neither cursors nor stored receipts confer authority.

## Persistence, lifecycle and effects

Project creation atomically provisions an independent custody/root scope and
Project row. Eleven new tables, typed scope/actor/generation FKs, target XOR and
exactly-one-target triggers, immutable source custody and Personal/shared
attribution branches are detailed in the [M05 review](p2-03-migration-review.md).
ProjectTask/ProjectGoal use existing source IDs and same-Project FKs. GoalTask
associations capture the authorized current Task revision. Personal private
Habit/LifeArea references are not accepted in shared source commands.

Member assignments bind a current full-member generation to a phase, section or
milestone; they are structural responsibilities. Task assignee consent and
Personal projections remain P2-04. Archive retains readable content for current
authorized actors and denies ordinary writes; restore uses current authority.
Controlled deletion requires the sole full custodian and current provider password
verification, creates the existing 30-day shared closing generation/job and retains
sources. Lifecycle status exposes minimal state/job metadata only. Guest departure
ends only that admission and its grants, including archived/frozen contexts.
Recovery, purge and actual source/file custody transfer remain their approved
later slices; this batch does not activate them.

Account/identity/session locks precede sorted custody fences. Current DB-time
authority and versions are reread inside the same transaction as source changes,
history, safe receipts, audit, shared outbox and authoritative usage. Restrictive
actions retain signed intent/outcome and committed-witness repair; ambiguous
control remains quarantined. Source modules access other owners through public
facades. No outbound business send occurs inside a transaction.

Free-mode feature decisions execute under the locked transaction. Owned custody
usage belongs to the primary personal account; shared Task/Goal/grant usage belongs
to its custody. Joining others' Projects does not count as owned custody. Retained
source/grant units remain counted after grant revocation/expiry; these counters
measure retained records, not active permission. No commercial restriction is
enabled. Separate abuse ceilings are 30/IP/minute, 20/actor/minute and 20 offer
creates/context/minute, plus 100 pending offers and 100 live grants per named
recipient/target generation. Maintenance expires at most 25 resource offers per
pass, scrubs proof hashes and is idempotent; existing worker infrastructure remains.

## Coverage registry and activation boundary

All integration labels below identify distinct named tests in
`apps/api/test/integration/project-core.spec.ts`; the final report records results.

| Label | Acceptance evidence                                                                                                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C     | Atomic independent creation/replay, no Team/Company, rollback of source/history/receipt/usage/outbox, free-mode denial/replay                                                                                                    |
| S     | Role ceilings, structural revisions/typed phase relationships/member responsibilities, same-Project source associations and actual selected Task revision                                                                        |
| R     | Exact Task/Goal/Project grant targets; no directory/count/list/unrelated source; expired/revoked/forwarded proof; unverified recipient; own admission; Viewer ceiling; permanent issuer/policy revocation; pending/live caps     |
| F     | Observed-lock revoke-first and mutation-first Task races, Task/Goal membership removal, policy removal, receipt replay denial, fresh session/suspension/DB-time expiry, signed cursor tamper/actor/scope/kind/generation/version |
| L     | Archive/restore/controlled deletion, narrow guest leave/readmission, former-owner erasure retaining Project/Task/Goal attribution                                                                                                |
| H     | Actual HTTP routes, strict envelopes, Origin, revisions, redacted proof headers; projects schema and handler-parity tests                                                                                                        |
| M     | DB adversarial attribution/foreign association/missing-or-multiple target/accepted-offer checks; immutable migration hashes; empty and populated upgrade/rollback/resume/repeat; existing Personal regressions                   |

Compiled API/worker restart smoke exercises acceptance, source mutation and receipt
status, expiry once, archive/restore/deletion, retained sources and durable policy.
Kernel/P2-02/Personal compiled smokes retain earlier acceptance coverage. OpenAPI
validation checks compiled contracts, all local references and frozen signatures.

No local test installs a real retention policy, signing key or checkpoint. Synthetic
fixtures are confined to owned isolated schemas/processes. Operator-approved
immutable retention, independent current control/checkpoint, security acceptance
and operational prerequisites in `docs/g0-implementation-prerequisites.md` continue
to block real shared activation. Local implementation completion does not satisfy
production launch, restore, load, legal or deployment gates.
