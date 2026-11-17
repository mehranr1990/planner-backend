# Projects backend requirements status

Backend-owned reconciliation of the read-only frontend requirements register and
the full owner-approved P2-GAP-CLOSURE request. The full 27-capability request is
the execution scope; PB-1/PB-2 are not the entire batch. Frontend source/register
was not modified. See [integration handoff](frontend-handoff/PROJECTS_GAP_CLOSURE.md)
and [execution record](p2-gap-closure-execution.md).

| Approved capability                                | Implementation classification                                |
| -------------------------------------------------- | ------------------------------------------------------------ |
| 1 Task deletion/history                            | IMPLEMENTED                                                  |
| 2 Scoped manual order                              | IMPLEMENTED                                                  |
| 3 Real subtasks                                    | IMPLEMENTED through existing Task hierarchy                  |
| 4 Assignment withdrawal                            | IMPLEMENTED                                                  |
| 5 Assignment reminders                             | IMPLEMENTED through existing outbox/preferences              |
| 6 Persisted workflow drafts                        | IMPLEMENTED through existing workflow publisher              |
| 7 Pending invitation metadata                      | IMPLEMENTED                                                  |
| 8 Resend and proof secrecy                         | IMPLEMENTED                                                  |
| 9 Private decline notes                            | IMPLEMENTED                                                  |
| 10 Normalized scoped Project keys                  | IMPLEMENTED; owner-approved account/Team namespaces          |
| 11 Phase dates/counts/progress                     | IMPLEMENTED                                                  |
| 12 Milestone status/phase/counts/progress          | IMPLEMENTED; status/date reused                              |
| 13 Explainable advisory health                     | IMPLEMENTED                                                  |
| 14 Evidence-based cycle time                       | IMPLEMENTED                                                  |
| 15 Actual scope history                            | IMPLEMENTED                                                  |
| 16 Stable scoped risk codes                        | IMPLEMENTED                                                  |
| 17 Numeric probability 0–100                       | ALREADY SUPPORTED; retained and boundary-tested              |
| 18 Risk checklist                                  | IMPLEMENTED                                                  |
| 19 Risk comments/history                           | IMPLEMENTED through existing comment versions                |
| 20 Closure/reopen evidence                         | IMPLEMENTED                                                  |
| 21 Risk conversion                                 | IMPLEMENTED; existing issue/task owners                      |
| 22 Private folders                                 | IMPLEMENTED                                                  |
| 23 Binary versions/downloads                       | IMPLEMENTED through existing private byte pipeline           |
| 24 Effective upload configuration                  | IMPLEMENTED                                                  |
| 25 Detailed activity and actual analytics/workload | IMPLEMENTED; existing authorized capacity/allocations reused |
| 26 Atomic setup and Blank/Kanban/Scrum             | IMPLEMENTED                                                  |
| 27 Authorized Team association                     | IMPLEMENTED; independent Project admission preserved         |

Final acceptance: COMPLETE after all applicable local gates and migration
rehearsals passed; see [completion record](p2-gap-closure-report.md) for exact
commands, results and the successful targeted typecheck recheck. Existing
custom templates and guest/resource grants remain supported and are documented
for optional future frontend use. No new guest grants/custom-template features.

# Teams backend requirements status — P3-GAP-CLOSURE

Owner-approved request numbering is used below. The read-only frontend register's
TB numbering differs; see [execution record](p3-gap-closure-execution.md). Frontend
files were not modified. Implementation classifications do not substitute for
the verification gate in the [completion report](p3-gap-closure-report.md).

| Requirement                       | Classification    | Reused / added behavior                                                                                       |
| --------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| TB-1 MAYBE RSVP                   | IMPLEMENTED       | Existing invitations; recipient transitions, occurrence key and scoped DB guard                               |
| TB-2 Weekly capacity              | IMPLEMENTED       | Existing member-generation profile/dated exceptions; seven explicit weekdays, timezone, revision              |
| TB-3 Member transfer              | DEFERRED BY OWNER | Independent destination admission and source removal; no transfer API                                         |
| TB-4 Invitation management        | IMPLEMENTED       | Spaces metadata/resend with TEAM kind; recipient-only proof delivery and current role checks                  |
| T-AV Availability                 | IMPLEMENTED       | Team capacity/approved leave/Shared logs and visible Project allocations; private components UNKNOWN          |
| TB-5 Project association approval | IMPLEMENTED       | Existing typed reference plus request/review/cancel/history; independent dual approval authority              |
| TB-7 Assignment withdrawal        | IMPLEMENTED       | Reuse P2 endpoint for Project work; extend existing Team assignment lifecycle with withdrawal/reoffer         |
| T-VIS Task visibility             | IMPLEMENTED       | Unified Task facade, stable source identity, independent Project read, deduplication and bounded pages        |
| T-CROSS Cross-Team workload       | IMPLEMENTED       | Requester's own visible Team work and distinct Project allocations/recorded effort; explicit unknown capacity |
| TB-6 Sprint burndown              | IMPLEMENTED       | Existing plans/items/estimates plus transactional observations; missing historical evidence stays unknown     |
| T-POINT Point capacity            | IMPLEMENTED       | Nullable revision-controlled TeamPlan capacityPoints; no time conversion                                      |
| T-VELOCITY Velocity               | IMPLEMENTED       | Actual closed Sprint evidence, bounded history and Task deduplication                                         |
| T-SPRINT Sprint history           | IMPLEMENTED       | Existing immutable scoped activity observations and bounded pagination                                        |
| TB-8 Project Calendar             | IMPLEMENTED       | Existing Calendar/meeting privacy facades; independent source authorization and occurrence deduplication      |
| T-LEAVE Time-off editing          | IMPLEMENTED       | Requester-only PENDING edits, overlap/revision checks and EDITED history; approved dates require resubmission |
| T-RECUR Recurring cancellation    | IMPLEMENTED       | Existing occurrence cancellation plus CANCEL_FUTURE in the same Calendar engine                               |
| T-RSVP RSVP summary               | IMPLEMENTED       | Organizer/work-manager counts; occurrence override, deduplication and unavailable filtering                   |
| T-FILES Team files                | ALREADY SUPPORTED | Existing folders/listing/versions/private byte lifecycle; effective upload configuration newly exposed        |
| T-ACTIVITY Activity               | IMPLEMENTED       | Allowlisted actual membership/invitation/settings/work/Sprint/reference/leave/file metadata                   |
| T-ANALYTICS Analytics             | IMPLEMENTED       | Existing factual dashboards/portfolio/analytics plus capacity, availability, velocity and Calendar occupancy  |
| T-FORECAST Forecast               | IMPLEMENTED       | Advisory scheduled estimates and visible Project allocations against explicit net Team capacity               |

No competing Task, Calendar, Sprint, File, Invitation or Notification engine was
added. M071–M072 are applied to local mehran_test and, following the owner's
finalization approval, local mehran_dev (97 successful migrations each). The
owner-authorized verified backup/restore preserved
existing records and the exact approved 95-entry ledger before normal corrected
replay. Finalization preserved existing development/test records and historical
ledger entries. Shared activation and production/staging deployment remain outside
this batch. See [Claude handoff](frontend-handoff/TEAMS_GAP_CLOSURE.md).

# Company backend requirements status ? P4-GAP-CLOSURE

All 32 owner-approved capabilities are reconciled against the existing Company
implementation in [the Company completion record](p4-gap-closure-report.md).
Current implementation and verification classifications in that record supersede
older Company gap assessments. [ADR 0055](adr/0055-company-gap-closure.md) records
the authorized development boundary; the [frontend handoff](frontend-handoff/COMPANY_GAP_CLOSURE.md)
contains exact route/schema mappings and activation restrictions.

Existing hierarchy, membership, finance, resource booking, reimbursement, payment
acknowledgement, goals, reports, handover and retention engines are reused. Added
transfer/organization/analytics reads, physical custody/maintenance, observed KPI
history, participant-private review/one-on-one records, explicit read roles and
temporary grants, access reviews, policy tiers, delegation, policy escalation,
budget alerts and typed budget-change approval sources extend those engines.

Emergency cases/governance drafts remain non-executable. Company retention stays
subject to the existing operator-approved immutable catalog and legal holds; no
periods or approvals are invented. Shared remains disabled. M073/M074 target only
isolated mehran_test; development retains its approved 97-migration baseline.
No frontend, production/staging, deployment, commit or push is authorized.

Authorized development scope is complete. The completion record contains the full
observed quality run, corrected-check reruns and final read-only database status:
development 97 migrations, isolated test 99, no checksum drift or unresolved
entries. Canonical OpenAPI contains 1,185 operations. Operational recovery and
retention activation remain policy-gated; neither database currently contains a
Company-approved retention catalog entry.
