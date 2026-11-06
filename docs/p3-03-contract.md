# P3-03 — Team capacity and authorized portfolio analytics

Local implementation of roadmap P3-03 and the Phase 3 work-capacity/dashboard
contract, under ADRs 0024–0031. Shared activation remains disabled. Company
association and all P3-04 recognition/feedback/meeting features remain inactive.

## Operations

All routes begin `/api/v1/teams/{id}`. Verified current identity, full Team read
and the existing Shared lifecycle/authorization fences are mandatory. Responses
are `no-store`. No Project access is inherited from Team membership.

| Method | Suffix                   | Contract                                                                                                                  |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/capacity`              | Signed, actor/query/authorization-bound page of current members' daily capacity                                           |
| POST   | `/capacity`              | Owner/Admin/Lead `work.manage`; explicit UUID, generation, date, zone and minutes; required Idempotency-Key; 201 and ETag |
| PATCH  | `/capacity/{capacityId}` | Same capability, required If-Match; update availableMinutes; 200 and ETag                                                 |
| GET    | `/workload`              | Current Team members' explicit accepted allocations in independently visible referenced Projects                          |
| GET    | `/portfolio`             | Per-source and total current authorized work measures with documented denominator/window                                  |
| GET    | `/dashboard`             | Portfolio, workload and currently visible backlog/planned-item counts plus active Team plans                              |

Reads are available to Owner/Admin/Lead/Member/Viewer. Grant-only Project admission
does not authorize Project-wide aggregates. Unknown query/body fields are rejected.
No new export, worker, scheduling, assignment, employee profile or scoring contract.

## Capacity and workload

Capacity is an explicit Team planning value for `(Team, member access, admission
generation, civil date, IANA timezone)`. Minutes are integer 0–1440 or null for
unknown; zero means explicitly unavailable. Identity/date/zone are immutable;
revisions advance by one. Setting minutes to null clears a known value without
deleting its record. Historical generations remain retained and excluded from
current pages/workload. Closed, erased, unverified, suspended, departed and
revoked members are excluded. New admission never revives old availability.

Writes prelock the acting and target accounts and custody, then recheck membership
and generation. Creation uses current free-mode growth authority/usage and a scoped
receipt; source/receipt/usage/audit/outbox commit together. Current authority is
required before replay. Natural-key duplicates and stale/identity-changing updates
conflict safely. New table constraints enforce custody/member/generation and shape.

Workload maps accepted active Project assignments to the same currently eligible
Team member through the Spaces facade; only Team access ID/generation appears in
the response. Only OPEN/IN_PROGRESS tasks contribute allocations. Allocations add
minutes; each source task's estimate is counted once per member/date. Missing
estimates are counted separately. Overbooking is `max(0, allocated-capacity)` or
null if capacity is unknown. Team capacity is counted once, without summing the
Project capacity budgets. Rows sort by date and Team access ID.

Team-owned Tasks/Goals remain their original authoritative sources. Team tasks
contribute portfolio stock measures; allocated minutes come from the existing
explicit Project acceptance/allocation contracts. No invented automatic assignment
or allocation of a task estimate, Calendar event or private TimeBlock is implied.

## Analytics semantics and visibility

Queries require `fromDate`, exclusive `toDate`, and `timezone`; 1–93 civil dates.
The existing Calendar engine resolves boundaries, including DST and missing dates.
`asOf` uses PostgreSQL time. The response includes the resolved instant window.

The denominator is current nondeleted tasks in the Team and independently readable,
actively referenced Projects. Each source appears once, including zero-valued
sources. Multiple Teams referencing a Project never copy or mutate that source.
Status counts sum to taskCount. Known estimates sum minutes; unknownEstimates is a
separate count. completedInWindow uses current source completedAt in `[from,to)`;
overdueTaskCount uses current OPEN/IN_PROGRESS dueAt before asOf. These are live
measures, without historical velocity or attendance claims. Goal count is a current
source count, without mixing Goal progress scales. Explicit shared work logs are
clipped to the reporting window and exclude voided logs; overlapping logs remain
recorded effort, without a distinct attendance claim.

The Project owner facade supplies its links, allocations and current Task metrics;
Task/Goal owners supply source measures. Team analytics never accesses Personal
Focus/TimeEntry, Journal, Mood, Finance, private notes, private Calendar or employee
case records. Live User IDs, emails, source text and hidden-source counts are absent.
Dashboard item counts apply the same current source visibility and deletion filter.

All selected custody fences are acquired in sorted order before work. References
are rechecked under locks. Winning Project revocation rejects an in-flight stale
read; retry sees only current sources. Winning reads finish before waiting revoke.
There are no retained aggregate snapshots/caches to bypass authorization later.
The hard safety bounds are 100 referenced visible Projects and 10,000 contributing
records/rows; over-limit queries fail without returning partial results. Capacity
pages are at most 100. Limits are independent of future commercial flags.

OpenAPI: `docs/api/openapi.json`, **6 new operations, 501 total**, **4,246 resolved
references**. P3-02 signatures were frozen from the published document before this
batch; every predecessor compatibility baseline remains enforced.
