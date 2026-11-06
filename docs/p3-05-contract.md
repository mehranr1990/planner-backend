# P3-05 independent Team lifecycle contract

Binding scope: V3 roadmap P3-05 and G3, ADRs 0028, 0029, 0031 and 0033.
No Company attachment/transfer, new source engine, provider or dependency.

All routes are under `/api/v1/teams/{id}`, require a verified current session,
Shared prerequisite gate and Team context discriminator. Unsafe requests require
Origin. Outputs are strict schemas and `Cache-Control: no-store`; revision outputs
carry ETags. Other-context IDs return safe denial. No proof or password is logged.

| Method | Suffix                                      | Input / authority                                                | Result                       |
| ------ | ------------------------------------------- | ---------------------------------------------------------------- | ---------------------------- |
| POST   | `/archive`                                  | If-Match Team revision; custody.archive                          | 200 lifecycle change         |
| POST   | `/restore`                                  | If-Match Team revision; custody.archive                          | 200 lifecycle change         |
| POST   | `/delete`                                   | If-Match Team revision, password; sole full custodian            | 200 recoverable closure      |
| GET    | `/status`                                   | Current member or recorded former custodian                      | 200 bounded lifecycle status |
| POST   | `/ownership-handovers`                      | Idempotency-Key, successorAccessId; custody.handover             | 201 handover, ETag           |
| GET    | `/ownership-handovers/{handoverId}`         | Current participant authority                                    | 200 handover, ETag           |
| POST   | `/ownership-handovers/{handoverId}/accept`  | If-Match handover revision, successor password                   | 200 accepted handover        |
| POST   | `/ownership-handovers/{handoverId}/decline` | If-Match handover revision; named successor                      | 200 declined handover        |
| POST   | `/ownership-handovers/{handoverId}/revoke`  | If-Match handover revision; current proposer                     | 200 revoked handover         |
| GET    | `/lifecycle-job`                            | Recorded former primary custodian                                | 200 job, ETag                |
| POST   | `/lifecycle-job/recovery-proof`             | If-Match job revision, password                                  | 200 proof, ETag              |
| POST   | `/lifecycle-job/recover`                    | If-Match job revision, generation, password, X-Deletion-Recovery | 200 canceled job, ETag       |

No ordinary request accepts Company, ownership or source-transfer fields. Empty
query/body schemas reject unknown fields. Conflicts use 409, malformed inputs 400,
unavailable authority/resource/proofs safe 403/404, prerequisite failures 503.

Handover reuses the existing seven-day offer, current full successor admission,
fresh provider password, expected custody revision and signed transaction protocol.
Only one pending handover exists; old owner may leave after acceptance. Sources,
assignees, confidentiality participants and reviewed disclosure audiences do not
move or gain implicit authority through a change of Owner.

Archive preserves eligible current reads of Team work, plans, Calendar, analytics
and confidential interactions under their original access rules; ordinary writes
and admissions stop. Archive/restore increments authorization and disclosure epochs.
Pending membership/grant/handover offers are revoked; old cursors, meeting invitations
and disclosure approvals do not revive. Restoring archive never grants Project
access. Existing Team/Project/Personal response signatures remain compatible.

Delete is a sole-custodian last departure, never immediate destruction. Last-member
leave also enters CLOSING_GRACE. The 30 elapsed UTC-day deadline is derived from
effective departure. Recovery requires current active verified former custodian,
provider password, hashed random 256-bit proof, current revision/generation, database
time before the deadline and no purge claim. It advances admission generation,
invalidates prior grants/proofs/disclosures/invitations and preserves source IDs.
Reusing a pre-departure Task creation key cannot revive an old receipt or overwrite
its existing source; a duplicate ID returns a conflict.

Owner-account closure with surviving members stays OWNER_EXIT_FROZEN: no automatic
promotion, deletion or content access. Personal erasure remains independent;
boundary-local actor attribution survives without a live User link.

The existing worker now polls independent Team jobs separately from Project jobs.
It rechecks custody, generation, zero members, deadline, exact FK catalog, immutable
retention policy, obligations/holds and active lease under the existing fences.
Stages: FILES → ADMISSIONS → NOTIFICATIONS → TEAM_CONTENT → CALENDAR → GOALS →
TASKS → STORAGE → TEAM_ROOT → CORE. Owner facades remove fixed, bounded subsets;
file effects retain existing 25-object acknowledgement protocol, row passes cap at 200. Team meeting/case/disclosure/planning metadata precedes its Calendar/source
dependencies. Calendar recurrence versions and leaf lineage are handled separately.
Unknown references fail closed with bounded retry/operator evidence.

Project references are deleted by **teamId**, not their Project-owned spaceId.
Referenced Projects, their sources and other Teams' references are excluded from
the Team deletion graph. Restrictive restore replay dispatches by actual custody
kind; signed evidence contains opaque IDs and versions, never confidential bodies.
Final evidence disposal and operator release reuse the accepted guarded commands.

Test traceability: `team-lifecycle.spec.ts` covers handover/current authority,
archive/read-only/restore, invalidated grants of visibility, last departure,
proof/deadline/replay, Personal erasure/frozen custody, retention, unknown FKs,
bounded resumable cleanup, source preservation, observed PostgreSQL race orders,
independent progress and local performance. Prior Phase 3 security suites remain
mandatory. Contracts cover all 12 controller routes and strict recovery schemas.
The migration gate checks populated predecessor preservation and atomic rollback.
The compiled restart check uses separate API and lifecycle-consumer processes.

Shared activation remains disabled; Company is inactive. Operational restoration,
off-host backup, Docker and production acceptance remain release gates.

The actual operation IDs for the lifecycle matrix above are frozen in the generated contract:

| Route suffix                                     | actual_openapi_operation_id                                   |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `POST /archive`                                  | `teamLifecyclepostteamsidarchive`                             |
| `POST /restore`                                  | `teamLifecyclepostteamsidrestore`                             |
| `POST /delete`                                   | `teamLifecyclepostteamsiddelete`                              |
| `GET /status`                                    | `teamLifecyclegetteamsidstatus`                               |
| `POST /ownership-handovers`                      | `teamLifecyclepostteamsidownershiphandovers`                  |
| `GET /ownership-handovers/{handoverId}`          | `teamLifecyclegetteamsidownershiphandovershandoverId`         |
| `POST /ownership-handovers/{handoverId}/accept`  | `teamLifecyclepostteamsidownershiphandovershandoverIdaccept`  |
| `POST /ownership-handovers/{handoverId}/decline` | `teamLifecyclepostteamsidownershiphandovershandoverIddecline` |
| `POST /ownership-handovers/{handoverId}/revoke`  | `teamLifecyclepostteamsidownershiphandovershandoverIdrevoke`  |
| `GET /lifecycle-job`                             | `teamLifecyclegetteamsidlifecyclejob`                         |
| `POST /lifecycle-job/recovery-proof`             | `teamLifecyclepostteamsidlifecyclejobrecoveryproof`           |
| `POST /lifecycle-job/recover`                    | `teamLifecyclepostteamsidlifecyclejobrecover`                 |
