# P1-10 requirements traceability

Baseline P1-09: `dbe3de6573473321db73a29f5faf9906ce3ee76a`, normally pushed;
clean working tree/index and independently verified remote hash before P1-10.
Status: **COMPLETE** under owner-approved ADR 0018 and ADR 0019. Final quality:
13/13 stages, **678 tests across 67 files**. Compiled API/worker restart smoke and
all 20 application checksums plus vendor schema/version/hash verification passed.
Full evidence is recorded in [the completion report](p1-10-report.md).

| Binding requirement                        | Approved owner/boundary                                            | Required verification                                                                |
| ------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Personal reminder scheduling and lifecycle | Notifications / Reminder; Task public facade                       | absolute/local/relative dates, source permission, stale revisions and lifecycle      |
| Source date/state changes                  | existing Task and account outbox; source remains authoritative     | due/planned changes, terminal/canceled/deleted/master states, future reopen          |
| Timezone and DST correctness               | saved reminder/local context and explicit account-following policy | gaps/folds, midnight, quiet hours and travel                                         |
| Notification inbox/history and read state  | Notification, scoped and revisioned                                | read/unread, acknowledgement, dismissal, cross-user ID/filter denial                 |
| Snooze                                     | new scheduled NotificationDelivery referencing original            | atomic retry, collision, original history, no source mutation                        |
| User preferences/configured channels       | NotificationPreference; gated adapters                             | default in-app, unavailable/disabled channels and quiet-hour defer                   |
| Opt-in Web Push                            | PushSubscription and typed endpoint delivery state                 | valid keys/hosts, SSRF denial, stale endpoint cleanup, session/logout distinction    |
| Safe durable delivery                      | NotificationDelivery, leases and stable fingerprints               | duplicate processing, claims, retry/backoff, failures and ambiguous network outcomes |
| At-most-once local publication             | unique Notification occurrence plus atomic delivery state          | concurrent workers, retries and restart after commit                                 |
| Durable jobs and missed work               | pg-boss dispatch plus authoritative sweeps                         | real queue scheduling, worker restart, backfill and bounded catch-up                 |
| Transactional outbox handling              | platform-owned notification consumer progress                      | atomic effects/progress, duplicate and out-of-order current-state reconciliation     |
| Privacy                                    | owned metadata and generic external content                        | no private text/keys/endpoints in jobs, logs, audit, email or push                   |
| Safe application/vendor schema lifecycle   | additive Prisma migration plus reviewed one-off vendor plan        | empty/previous/repeated setup, exact plan drift, ownership and preservation          |
| Contracts and regression compatibility     | strict Zod/OpenAPI; frozen P1-09 signatures                        | every earlier baseline, architecture and complete regression gates                   |
| Compiled API and worker recovery           | same build/image, separate worker entrypoint                       | real process restarts, durable receipts/jobs, idempotent replay and isolation        |

Implementation: Notifications application service/port, scoped repository and
NotificationStore; pure timing domain; private email/Push adapter; strict
notifications.ts / notifications-openapi.ts. Tasks exports read-only ReminderTasks;
Account exports verified NotificationIdentity. No cross-module Task/Goal writes.
Platform NotificationOutbox owns only its independent consumer fields. Lazy
JobsService and the separate compiled worker use the pinned reviewed queue schema.

Executable coverage: domain/timing.spec.ts, infrastructure/transport.spec.ts,
contract/notifications-openapi.spec.ts,
integration/notifications.spec.ts and notification-jobs.spec.ts; environment and
foundation migration safety probes; compiled tooling/scripts/p1-10-smoke.ts.
The mandatory migration harness preserves fixtures from all previous batches,
including exact postings, FX, budgets, bills, savings and converted Capture identity.
Every earlier approved migration remains byte-identical. The first new migration
uses an outer transaction; a second additive guard handles SQL CHECK null semantics.
The runbook documents the narrow, data-preserving development recovery of the
initial migration attempt. No database reset or previous migration rewrite occurred.

Application migrations total 20; vendor schema version 46 and the exact plan hash
are verified independently in development and test. Owner approval covers the
four pinned dependencies; production audit reports zero advisories. All temporal,
privacy, retention, retry and external-ambiguity decisions follow ADRs 0018/0019.
Docker and live SMTP/browser delivery remain deferred. See
[notification operations](runbooks/notifications.md) for setup and recovery.
P1-11 is NOT STARTED.

Final regression review preserves all existing assertions, API deadlines and
test-case timeouts. Finance fixture seeding uses the same 10001 constraint-checked
records with less ORM overhead. Exact-identity teardown uses a guarded isolated
administrative connection with bounded deadlines instead of the API health clock;
it commits atomically or retains a private ignored recovery manifest. Outbox tests
settle their recorded event IDs through bounded worker passes, including when the
isolated database contains older fixture events. Direct
adapter tests cover generic provider payloads, safe failure classification and
public/private DNS ranges. Additive current-query indexes support active counts,
typed notification history and the notification-only pending outbox consumer.
