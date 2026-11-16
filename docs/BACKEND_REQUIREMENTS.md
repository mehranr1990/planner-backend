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
