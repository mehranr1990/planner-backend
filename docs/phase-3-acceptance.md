# Phase 3 consolidated local acceptance

Scope: the five independent Team batches in the approved Backend V3 roadmap.
P3-01 through P3-04 were accepted by the owner; P3-05 is submitted for local
acceptance. No Phase 4 authorization, Company attachment or production activation
is implied. Canonical contracts and individual reports remain authoritative.

| Batch | Delivered scope                                                                                                                                       | Durable model / additive API                                                                         | Acceptance evidence                                                                                                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-01 | Independent Teams, Owner/Admin/Lead/Member/Viewer, invitations and current-authority Project visibility; multiple Teams may reference one Project     | Team, TeamProjectReference; migrations 021–022; 16 operations                                        | [Report](p3-01-report.md), `teams.spec.ts`; admission/generation/isolation, observed revoke/update races and source preservation                                                                                 |
| P3-02 | Existing Team Task/Goal/Calendar engines; typed references, backlog, weekly plans/review and optional sprints                                         | TeamPlan, TeamWorkItem; migrations 023–024; 27 operations                                            | [Report](p3-02-report.md), `team-work.spec.ts`; same-space/independent source checks, recurrence, rejoin/replay and Personal compatibility                                                                       |
| P3-03 | Explicit member-day capacity and authorized portfolio/workload/dashboard                                                                              | TeamCapacityDay; migration 025; 6 operations                                                         | [Report](p3-03-report.md), `team-analytics.spec.ts`; private-data exclusion, accepted Project allocations and current Team/Project intersection                                                                  |
| P3-04 | Confidential recognition/feedback/corrective records, appeal, reviewed bounded disclosure, consent and light Calendar meetings/invitations            | Six interaction tables and restore epoch; migration 026; 21 operations                               | [Report](p3-04-report.md), `team-interactions.spec.ts`; author/subject/named reviewer only, immutable evidence, explicit audience generations, expiry/revocation and observed confidentiality races              |
| P3-05 | Consent/password handover; read-only archive/restore; 30-day closure/recovery; retained attribution; bounded cleanup, isolation and local performance | Existing Shared state machine/worker; migration 027 changes only purge kind predicate; 12 operations | [Report](p3-05-report.md), [contract](p3-05-contract.md), `team-lifecycle.spec.ts`; observed race orders, unknown FK/hold denial, Personal and multiply referenced Project preservation, compiled restart/resume |

Phase 3 adds **82 operations**, reaching **534 total / 4,576 resolved schema
references**, with the P3-04 baseline and every earlier published Personal/Project/
Team signature frozen and checked. There are seven Phase 3 migrations and eleven
Team-related tables; the Projects module owns TeamProjectReference, and Calendar
continues using its existing source/recurrence tables.
P3-05 adds no table or dependency. The complete schema contains 146 domain tables
and the migration ledger; the exact existing cleanup FK catalog is preserved.

G3 boundaries: no Company schema/admission/attachment or transfer is activated.
Team membership and project references confer no Project access. Team deletion
owns only its graph, never referenced independent Project or Personal sources.
Portfolio/capacity uses authorized work and explicit availability, never journal,
mood, Personal finance, Focus or inferred employee monitoring. Recognition sharing
requires subject consent; feedback/corrective records use only author, subject and
a distinct named current Owner/Admin reviewer. Wider access exposes only reviewed
bounded summaries to explicit current generations, expires within 30 days and is
revocable. Handover grants no implicit case access; archive/recovery revives no old
disclosure, invitations, receipts or grants. No automatic employment enforcement.

Final verification uses one P3-05 mandatory local quality run and affected reruns,
preserving all prior tests and adding focused lifecycle/migration/contract coverage:
**555 non-integration and all 659 integration scenarios pass across this evidence**.
The initial gate's two failures (new snapshot regeneration and the race fixture's
exact staging-denial assertion) and successful affected checks are recorded in the
P3-05 report. Architecture has zero violations; local source-page p95 is 27.57 ms
over ten samples / 1,000 Team tasks, without claiming a production SLO.
Existing lower-level Shared/Personal security suites remain part of this gate.
Migration rehearsals retain all 50 predecessor SQL artifacts and datasets through
interrupted rollback/resume/repeated deploy; no configured database is reset.

Fresh compiled API and Team lifecycle-consumer processes exercise persisted
archive/recovery and interrupted cleanup with independent Project preservation.
This is local synthetic evidence, not a production latency SLO or a hosted worker
deployment. Shared activation remains disabled in preserved configuration.

Still deferred: Docker/WSL, deployment, production database migration, release-only
backup/restore/off-host evidence, operational security/retention approval, Shared
activation and Company association. These are **NOT RUN / NOT ACTIVATED**, not
waived or passed by local acceptance. Phase 4 is **NOT STARTED** and requires
separate authorization. P3-05 remains uncommitted and unpushed.
