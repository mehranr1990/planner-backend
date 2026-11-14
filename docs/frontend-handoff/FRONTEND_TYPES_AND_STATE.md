# Frontend types and state

Use [openapi.json](./openapi.json) from the finished P1-12 release. Configure an
API origin separately: paths already contain `/api/v1`, and health paths are root.
Transport types must not come from Prisma or copied database models.

## Type generation without backend changes

Use the consuming frontend's reviewed, pinned OpenAPI 3.1-capable generator. An
option is openapi-typescript; its [official CLI documentation](https://openapi-ts.dev/cli)
supports a local input and `--output`. If that tool is already approved/installed
in the frontend project, run **there**, adjusting paths:

```powershell
pnpm exec openapi-typescript ../planner-backend/docs/frontend-handoff/openapi.json --output src/api/schema.d.ts
```

This is an instruction for the consuming repository, not a tool installed or run
here. Pin/review the frontend tool there; do not add it to the backend or use an
unreviewed floating download. Generated declarations need a fetch layer with
cookies, headers and error handling; they do not enforce runtime business rules.

For an openapi-typescript-shaped output, exact inline operation types can be used:

```ts
import type { paths } from './api/schema';
type CreateTask =
  paths['/api/v1/tasks']['post']['requestBody']['content']['application/json'];
type Task =
  paths['/api/v1/tasks/{id}']['get']['responses'][200]['content']['application/json'];
```

Use operation/path types rather than expecting every inline DTO in
components.schemas. Within this pnpm workspace, existing
[@mehran/api-contracts](../../packages/api-contracts/src/index.ts) also exports Zod
schemas and inferred types. Server Zod normalization/cross-field refinements remain
authoritative; generated static types alone do not check reference ownership,
date ranges, hierarchy, money scale or lifecycle transitions.

Regenerate frontend types when the agreed contract file changes; review the diff.
Backend `pnpm openapi:check` verifies the canonical schema and earlier signatures.
For this release the handoff has six packaging-only recursive-reference fixes;
see the [normalization note](./FRONTEND_INTEGRATION_GUIDE.md#openapi-packaging-normalization).
Preserve that normalized artifact for frontend generation. Do not replace it with
the raw canonical output until the generator correction is separately approved.

## Session and cache boundaries

Session states should distinguish unknown/loading, anonymous, verification pending,
verified active and unavailable/closed. Use GET `/api/v1/auth/get-session`; provider
token fields are not a local bearer-token store. After sign-in load profile,
settings and the owned Space; after logout/revocation/closure cancel private work,
clear memory/persistent caches and detach account-specific listeners.

Cache keys need user/Space identity, resource/logical ID, query/filter, range,
timezone/calendar and opt-in flags as applicable. Do not reuse another user's
cursor or a private search result for a non-opted-in query. Keep Journal/Mood/
Finance separate from generic previews, logs, persisted query caches and analytics.

| Mutation owner                           | Refetch/invalidate dependent views                                                                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tasks / occurrences / checklist / labels | Task lists/details/history, My Day selections/capacity, linked Goal progress, linked TimeBlocks/Focus references, Task analytics; rewards/reminders may update asynchronously |
| Planning                                 | Changed days/weeks, capacity, reviews/rollover preview and planning insights; never optimistically rewrite Task due dates                                                     |
| Calendar                                 | Range/conflict views and changed event/series/block; do not invent a Task mutation                                                                                            |
| Habits / entries / schedule              | Due-day statistics, routines/water, linked Goal progress, habit analytics and eventual rewards                                                                                |
| Goals / source links                     | Goal detail/progress/reviews/hierarchy and relevant insights                                                                                                                  |
| Focus / TimeEntry                        | Session/history, time summaries, Task productivity and time insights                                                                                                          |
| Writing / Capture                        | Current/history/folder or opted-in personal search; converted target plus source after triage                                                                                 |
| Finance                                  | Account balances, transactions/history, periods/budgets/bills/savings and consented reports/insights; trust exact server values                                               |
| Preferences / notifications              | User context and affected future reminders; show persisted historical timezone context                                                                                        |

These are frontend invalidation recommendations, not a server event subscription
API. Phase 1 has no WebSocket/SSE transport. Use bounded polling/refetch only where
needed; do not hammer lifecycle or auth rate limits. Rewards/external notification
success is asynchronous and cannot be inferred from a successful Task mutation.

## Revisions, idempotency and conflicts

Retain aggregate revision with its exact ETag. Use If-Match only from that owner:
Task for checklist, Goal for nested milestones/links, Day for selections, and
entry/resource revision for historical corrections. Source references can require
an additional taskRevision, habitRevision or sourceRevision. Settings ETag is a
header; its normal JSON body contains preferences, not revision. Never substitute
the profile version or omit concurrency just because the form has cached values.

Keep an operation's Idempotency-Key with its exact normalized intent until its
result is reconciled. Keys are printable ASCII 1–128 characters, actor/Space/
operation/body scoped, generally retained 24 hours online. A new intent needs a
new key. Some replays return original snapshots, others the current authorized
created resource; do not assume every replay byte-equals the first response.
On 409 refetch and preserve the user's draft; never silently overwrite long text.

## Dates, timezones and calendars

Date-only strings are Gregorian `YYYY-MM-DD`; do not parse them through a browser's
implicit local midnight. Instants use ISO UTC; local schedules use explicit IANA
timezone plus their wall-clock/date context. Display using the returned saved
context or requested view timezone. Changing account timezone/week-start affects
new/future behavior according to its domain, not historical attribution.

JALALI is a supported presentation and saved Finance budget-period preference;
transport/storage dates remain Gregorian. Convert an entered Jalali date to its
correct Gregorian literal before submission, preserving the chosen IANA zone.
Analytics monthly buckets are Gregorian; do not reinterpret them as Jalali months.

Weekday conventions differ: account/planning and notification schedules use
Sunday=0..Saturday=6; Task/Calendar recurrence and Habit selected weekdays use
ISO Monday=1..Sunday=7. Do not share an unchecked enum between them. All-day Calendar
endDate and most report/range `to` values are exclusive, while recurrence endDate
is inclusive; check the particular schema/runbook. DST gap/fold behavior is domain
specific: explicit timed calendar gaps reject, recurring gaps are explicit skips,
folds select the earlier instant. Never shift dates silently on the client.

## Exact numbers and timer state

Money is a decimal string plus an explicit currency. Do not parse through Number,
round using Intl currency defaults, or sum different currencies. The frozen
[currency map](../../packages/api-contracts/src/finance-currencies.ts) is the
authority (including IRR=2 and supported four-decimal currencies). Render strings
without losing precision; use the consuming frontend's approved exact-arithmetic
approach if calculations are required. Reports/balances/FX rounding remain server
results. Goal progress/weights and Habit quantities also use exact decimal strings.

Focus time uses integer milliseconds from the server's persisted clock history.
A local animation is presentation only: refetch after backgrounding/reconnect,
respect paused state and explicit finish/stop. A completed Pomodoro schedule can
be READY_TO_FINISH while still reserving the timer. Do not synthesize tracked
TimeEntries or automatically complete a Task.

## Limited offline state

P1-12 supplies backend push/pull/status only; client cache/queue design is a
frontend responsibility. Supported entities are ordinary Tasks, Checklists,
Labels/links, Daily Plans, Habit Entries, Notes and text Captures/expense drafts.
Auth, binary files, recurrence definitions/generation, calendar, Goals/Habit
definitions, timers, Journal/Mood, triage/bulk and committed finance remain online.

Use a stable clientMutationId, current epoch, base revision (0 for creation),
operation-specific body and server IDs for later operations. There is no temporary
ID dependency graph. Push at most 50 operations within the existing 128KiB body
limit; pull at most 100 items. A Habit append may use clientEntryId for dedup across
new operation IDs. Inspect APPLIED/DUPLICATE/CONFLICT/REJECTED per item, not only
HTTP success. Preserve server/client conflict versions and submit an explicit
resolution with a new ID and current revision.

Bootstrap uses an initial watermark; CURRENT_STATE results may repeat/newer than
their feed metadata. Apply newer source revisions, including restores/tombstones,
and preserve the returned cursor exactly. Cursors/feed and private receipt bodies
expire after 30 days; minimal receipt identity remains account-lifetime. An expired
duplicate's resultExpired does not permit reapplying the mutation. A pull 409 or
push epoch conflict requires status refresh and safe scoped resync. Invalid/foreign
cursors return 400; do not repeatedly retry them. Logout/closure/revocation stops
push/pull and removes account-local private data and pending replay authority.

Source: [ADR 0022](../adr/0022-personal-sync-subset-and-cursors.md),
[sync schemas](../../packages/api-contracts/src/sync.ts).
