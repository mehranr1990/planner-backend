# P3-02 migration review

Authorized local scope: Team-owned sources/Calendar and group planning, following
accepted P3-01 at `ec5053ea5a6e6de850e5effe23fb62d3e1d14149`.

| Artifact                                   | SHA-256                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `202611050023_team_work_planning`          | `39417c30b7c510296b46eb133aa02ebacf170af566e3f79a61eba6e73d124970` |
| `202611050024_team_calendar_cascade_order` | `fcdacd686a41aa15b4ab4732d914a28346e66d5ee0105df747e8c6543de5e9c5` |

Both SQL artifacts are atomic with five-second lock and 30-second statement
timeouts. All 46 predecessor migrations remain immutable. No data rewrite, reset,
backfill, provider, extension, Company link or deployment is introduced.

The existing Task/Goal source guard additionally admits exact Team root custody,
retaining the existing Personal branch, immutable shared attribution and accepted
Personal-to-Project transfer-manifest checks. No new Task/Goal table or cloned work.

CalendarEvent and EventRecurrence each add nullable scope/actor columns and relax
only createdByUserId nullability. Branch triggers keep Personal User attribution
mandatory with null Shared fields; Team requires null User, exact Team root scope
and same-custody actor. Custody/attribution remain immutable. Existing Personal
composite owner FKs and all schedule/history/recurrence constraints are unchanged.
New direct Space FKs prevent NULL composite components bypassing boundary checks;
scope, actor and recurrence-parent scope FKs enforce Shared consistency.

The second artifact defers **only the two newly added direct Calendar boundary
FKs**, initially deferred, retaining NO ACTION. This preserves the old Personal
composite-FK cascade before checking the added direct boundary. It corrects an
observed isolated fixture cleanup failure after all 24 Calendar behavior tests had
passed. Shared Space deletion still requires existing custody/lifecycle guards;
there is no global constraint deferral or new Shared cascade. The first artifact
is not rewritten after isolated application.

TeamPlan is rooted in Team custody with immutable local period/timezone/kind and
creator actor, positive revision and explicit DRAFT→ACTIVE→CLOSED transitions.
WEEK requires seven dates; optional SPRINT permits 1–93. Reviews are WEEK-only,
with complete summary/reviewer/time attribution. TeamWorkItem has one typed Task
or Goal, source custody FK, selected revision, optional same-Team plan, immutable
source/creator and unique source per Team. The source must belong to this Team or
an explicitly referenced Project; application reads additionally require current
independent source authority and Project source association. Personal references
are rejected. Scope FKs/strict application checks prevent nested foreign IDs.

The source Task/Goal FK cascades remove **reference metadata only** on physical
source purge; Team plans and independently owned work are preserved. Removing a
Team reference never deletes a Project/source. The full cleanup FK digest becomes
`b2d668e8d8b30b376884bb397039d09cfdd758083b8a335aab48fb89c5d924f5`.
Unknown references still block cleanup. Team dissolution remains P3-05. Personal
data export explicitly omits the new null Calendar columns to retain its previous
shape. Shared events never enter Personal outbox/sync/export.

Task/Goal transfer inventories recognize only the two exact TeamWorkItem FK names
and count those incoming references with disposition REJECT. This preserves the
existing unknown-FK denial and blocks transfer of referenced sources rather than
moving or exposing Team planning records. New FK definitions remain part of the
existing source manifest digest. Personal sources cannot acquire Team work links
through the current branch guard; legitimate unreferenced Personal transfers keep
their prior behavior.

Usage adds `team.plan`, `team.work-item`, `calendar.shared-event` to the exact
existing allowlist, preserving every previous feature. Current free policy and
authoritative fenced growth/usage apply; no commercial enforcement is enabled.

DDL lock impact: new FK validation/unique index scans Calendar and small Shared
catalogs; nullability relaxation is catalog expansion. No source rewrite. Review
real target sizes/locks before any later promotion; do not run production DDL here.
After Team writes, rollback requires a compatible release or forward correction;
never remove custody, evidence, source data or compatibility columns automatically.

Rehearsal extends the previous chain: snapshot all 137 predecessor table data sets
by their pre-expansion columns; explicitly seed populated Personal Calendar and
recurrence; preserve all 46 historical checksums and old constraints except the two
branch-guarded NOT NULL relaxations and additive usage CHECK. Interrupt both new
artifacts, resume and repeat deploy, compare final FK digest and verify unchanged
Personal attribution with null new fields. Rehearsal/schema removal is limited to
fresh owned isolated test namespaces; existing configured databases are never reset.
