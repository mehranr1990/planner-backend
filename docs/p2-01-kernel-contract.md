# P2-01 shared kernel contract

Authority: owner-authorized P2-01, V3 roadmap and ADRs 0024–0031. This batch adds
the internal Spaces kernel. Project business APIs begin in P2-03; invitations and
accepted succession begin in P2-02. No new HTTP operation is registered here.
The canonical frontend contract remains `docs/api/openapi.json` (189 paths,
293 operations). Personal resource DTOs, sync, exports and ownership stay Personal.

## Internal commands and authority

| Port                          | Current authority and validation                                                                                                                              | Concurrency/result                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provision`                   | Verified active exact provider session; complete approved retention; explicit security acceptance and independent signed checkpoint                           | Caller supplies opaque UUID; duplicate conflicts; atomic custody/root/actor/admission/policy/audit/outbox/usage                                                   |
| `run`                         | Predeclared account/custody sets; action-specific requests; fresh actor/session, custodian, admission generation, policy, retention and signed-control checks | READ COMMITTED, exclusive custody fence through commit; transaction-local `SharedAuthority` expires on callback exit                                              |
| `publishPolicy`               | Current Owner/Admin; exact role catalog and fixed ceilings; export bounds 1–10,000 records and 1–10,485,760 encoded bytes                                     | Expected current policy version (future HTTP If-Match); immutable new version, version bumps, audit/outbox and restrictive intent/outcome                         |
| `changeAccess`                | Current role-administration authority for both old and new roles; no self-promotion; same scope                                                               | Expected access revision; suspend/resume current generation or end interval; cannot end primary custodian or silently readmit a departed generation               |
| `depart`                      | Narrow self-departure authority, including suspended full members                                                                                             | Expected revision; Owner with remaining full members needs accepted succession; last full member creates one 30-day lifecycle job, preserves all rows             |
| `receipt`                     | Must run inside current action-specific authority, including on replay                                                                                        | Actor/scope/operation/key hash; caller supplies canonical SHA-256 fingerprint; conflicting reuse fails; safe result UUID/status only; 24-hour retention           |
| `issueGrant`                  | No resource targets are implemented yet                                                                                                                       | Always rejects; SQL independently rejects targetless grants. Concrete Project/Task/Goal targets arrive with owning domains                                        |
| `enqueueExit` / `consumeExit` | Spaces closure coordinator / internal worker, never an HTTP admission path                                                                                    | Atomic durable exit record at Personal closure; keyset passes of 25; custody-fenced current state and generation; five bounded retries with redacted failure code |
| `prepareIdentityErasure`      | Current closed Personal account under its existing fence; invoked before Personal owner-module locks                                                          | At most 25 actors per pass; materialize freeze/closing job and end intervals before pseudonymization; shared obligations never postpone this pass                 |
| `reconcileControl`            | Explicit trusted operational port; no public route                                                                                                            | Under custody lock, resolve lost-connection intents against atomic audit/outbox evidence; never bless a committed version missing from the restored DB            |

Kernel failures use non-enumerating absence/denial, conflict for stale revisions,
and invalid input for out-of-ceiling configuration. They do not publish a new
transport contract. HTTP parsing, pagination and rate settings for future Project
routes must be specified in their own batches. Callback work is DB-only through
owner facades; the only precommit filesystem effect is restrictive control evidence.

## Lock graph and account lifecycle

Account advisory keys use the existing `personal-access:<Personal Space UUID>`
namespace, sorted by Personal Space UUID. Then lock identity rows by User UUID,
the acting provider session, and SharedCustody rows by Space UUID. Only afterward
may owner-module/resource, receipt and usage work run. Source owners retain the
approved Tasks → Habits → Notes → Journal → Capture → Finance → Planning → Calendar
→ Goals → Focus → Notifications → Rewards → Storage order.

The current primary custodian's account fence is predeclared too. Its identity is
an untrusted discovery hint until the custody lock is held; a changed custodian
requires a whole-command restart with the complete lock set. This closes the
owner-account-closure versus another member's commit window without acquiring an
earlier-ranked lock late. Personal closure/sync fences are otherwise unchanged.

Transactions use a five-second lock timeout and 30-second total budget, with at
most three recognized PostgreSQL deadlock/serialization attempts. Recognized
rollback retries reauthorize; arbitrary failures are not retried. Control intents
from rolled-back attempts receive aborted outcomes; ambiguous outcomes quarantine
the affected boundary until fenced reconciliation.

Personal closure remains the immediate global denial point and atomically records
shared-exit work. A fresh closed-custodian read or a recorded closure affecting the
current admission denies work even before fanout converges or after Personal
recovery. Recovery restores no old shared admission. Fanout excludes grant-only
actors from full-member counts, counts suspended full members until actual exit,
and uses the latest effective departure/closure time of current generations.
New explicit admissions after an old closure are not erased by that old fanout.

Owner exit with remaining members freezes custody. Zero full members enters
CLOSING_GRACE, with an immutable captured policy and 30 elapsed days from effective
departure. P2-01 does not execute shared recovery or destructive cleanup. Before
identity removal, live User links are detached and the temporary exit-work mapping
is removed. Shared attribution/audit remains boundary-local and contains no copied
email, name, profile or private Personal content.

## Activation and operational gates

No shared policy, signing keys, acceptance reference or checkpoint is installed by
this batch. `SHARED_SECURITY_ACCEPTANCE_REFERENCE`, purpose-specific
`SHARED_CONTROL_KEYS`/`SHARED_CONTROL_ACTIVE_KEY_ID`, an independently provisioned
checkpoint and a complete immutable `SharedRetentionPolicy` are all required by
the creation port. `SYNTHETIC_REHEARSAL` alone cannot pass retention validation.
Synthetic test policies exist only in owned disposable schemas.

Retention requires every class, explicit durations/disposal/audience/export rules,
applicability, market scope, accountable operator, obligations/holds with review and
release evidence, and backup policy reference. No Personal retention value is
used as a shared default. Commercial limits remain disabled; immutable usage entries
identify custody/member creation/departure and the responsible actor. Hard safety
ceilings remain enforced.

Shared control uses a separate sibling directory and HMAC purpose namespace/key
IDs. Every shared operation verifies the current signed namespace; unknown keys,
invalid signatures, unresolved intents or a control version ahead of the DB deny
access. New processes reopen existing storage without initializing a checkpoint.
Keep all referenced verification keys during rotation. Personal v1 proof/digest/
backup signing inputs are unchanged; do not rotate the auth secret as a side effect.

Operator inspection: query `SharedExitWork` for `completedAt IS NULL`, its
`attempts`, `nextAt`, `revision` and redacted `failureCode`. Five failed passes leave
the row for review, with access still denied. Repair control/storage/configuration
before explicitly rescheduling a failed row; never silently delete it or change
captured retention. Preserve current control independently of planner backups.

Actual shared recovery, selective restore replay, mixed Personal/shared backup
drills and off-host expiry remain gates before their corresponding features or
release. P2-01's fail-closed control tests are not a claim that those operational
drills ran. Docker, hosted CI, workload/SLO/RPO/RTO and production provisioning are
not authorized by batch implementation.

## Acceptance traceability

The following requirements are implemented in P2-01. The batch report records
their final gate evidence. All use root Project custody only; actual HTTP operation
IDs are blank because no new routes are registered. Tests named below are in
`shared-kernel.spec.ts`, `shared-personal-erasure.spec.ts` or `shared-policy.spec.ts`.

| Requirement    | Approved source                              | Port / effect                                                                  | Focused proof                                                                                                |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| P201-CUST      | A01 / 0024                                   | `provision`, exclusive subtype/root/primary constraints                        | Personal shape, foreign-key isolation, immutable ownership; populated upgrade gate                           |
| P201-MEM       | A02 / 0025                                   | `changeAccess`, `depart`; immutable generation intervals; version/audit/outbox | Context roles, suspended/revoked denial, explicit generation readmission, last-member job                    |
| P201-POLICY    | A03 / 0026                                   | `publishPolicy`, fixed role ceilings, optimistic version, restrictive evidence | All role defaults; higher-role administration; current-policy removal race                                   |
| P201-GRANT     | A03 / 0026 and M05 prerequisite              | `issueGrant` and target-required SQL guard                                     | Every unchecked grant target rejected; grant-only admission gives no rights                                  |
| P201-FENCE     | A08 / 0031                                   | `run`, sorted locks and transaction-local authority                            | Both revoke/write orders; exclusive row lock; competing primary seats; opposing boundary order               |
| P201-RECEIPT   | A08 / 0031                                   | `receipt`; atomic audit/outbox/result; 24-hour identity                        | Authorized replay, fingerprint conflict, rollback, stale generation and revoked replay                       |
| P201-EXIT      | A06 / 0029 and A08                           | `enqueueExit`, `consumeExit`, lifecycle job                                    | Both owner-closure orders, concurrent departures, suspended/guest counts, five-attempt failure               |
| P201-PRIVACY   | A01/A06 and unchanged 0023 Personal contract | Personal content purge, resumable identity stage, `prepareIdentityErasure`     | HTTP-confirmed erasure resumes after shared metadata failure with retained shared hold/custody               |
| P201-CONTROL   | A08 and prerequisite recovery contract       | Signed intent/outcome, key IDs, fenced reconciliation                          | Unknown-key/rotation, unresolved intent, stale control version, DB connection loss; compiled process restart |
| P201-ADMISSION | Retention prerequisite / G2                  | Explicit security reference and complete immutable operator policy             | Missing security reference, missing/incomplete policy and unsafe control root rejected                       |
| P201-USAGE     | V3 production contract section 8             | Custody/member usage ledger, stable boundary actor; free mode                  | Atomic creation/departure ledger and compiled kernel smoke; no commercial deny                               |

- CUST: exclusive subtype, immutable Personal owner, mandatory root/policy/eligible
  custodian, foreign keys, actor/User deletion and closing-job constraints; promoted
  populated upgrade preserves all 67 P1 tables, 139 FKs and 24 historical checksums.
- MEM: fixed roles, grant-only denial, duplicate actors/access, suspended/revoked
  denial, explicit generation readmission, immutable interval history and unrelated
  context roles. Invitation acceptance/readmission workflows remain P2-02.
- AUTHZ: defaults/ceilings, higher-role administration, Viewer mutations, current
  policy/version, export bounds, targetless-grant rejection, receipt replay and
  cross-context IDs. Actual source/file/search/export integrations belong to their
  source batches; the kernel does not expose them early.
- RACE: independent connections, explicit barriers, `pg_locks` observation and both
  revoke/write orders; policy removal, exclusive custody, account/owner closure,
  sorted multi-boundary locks, recognized retries and connection loss. These are
  kernel effects, not claims about unimplemented shared Task/Goal/invitation/upload
  or recovery/purge commands.
- Existing Personal lifecycle and sync integration suites remain mandatory, together
  with the 13 quality stages, populated migration gate and compiled restart smokes.
