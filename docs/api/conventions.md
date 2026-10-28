# API conventions through P1-01

Endpoints use `/api/v1`; public health remains at `GET /health/live` and
`GET /health/ready`. Authentication uses `/api/v1/auth` and verified account
operations use `/api/v1/me`, `/api/v1/me/settings` and `/api/v1/me/spaces`.
The fixture controller used in HTTP tests is never registered in production.

Transport schemas in `packages/api-contracts` are authoritative Zod strict
objects. HTTP input is parsed through ZodValidationPipe. Schema failures return
400 VALIDATION_ERROR, with safe issue codes and positional field placeholders;
raw input, unknown field names, SQL, stacks, and internal exception messages are
not returned. This avoids leaking private content used as an object key.

All errors use `{ "error": { "code", "message", "details"?, "requestId" } }`.
The checked-in OpenAPI 3.1 snapshot describes health, auth and account operations
and shared errors. `pnpm openapi:check` fails on snapshot drift; regenerate
with `pnpm openapi:generate` only after reviewing compatibility. The initial
P0-01 health/error schemas remain the compatibility baseline. P0-02 adds routes
and schemas without changing those existing contracts.

Every response carries X-Request-Id and X-Correlation-Id. Caller IDs are accepted
only when valid UUIDs; otherwise a new request UUID is generated. Without a
valid correlation UUID it defaults to the request ID. These values are logging
context, not credentials or proof of authorization.

Readiness performs a real Prisma `SELECT 1` with bounded pool connection and
query timeouts. A failure returns 503 SERVICE_UNAVAILABLE; liveness stays 200.
Readiness never runs migrations or writes records. API startup validates config
but does not require the DB to be available, so liveness remains observable.

HTTP JSON bodies are bounded to 128 KiB. Request logs whitelist ID and method,
response logs whitelist status. URLs, query strings, headers and bodies are
omitted, including signed file links and journal/mood/finance content. Error
serializers omit arbitrary exception text/stacks. Application code must likewise
log safe metadata only; configured secret fields are additionally redacted.

Personal ownership is enforced by the central SpacePolicyService and the owning
spaces facade, with scoped database reads, explicit owner checks and 404 for
inaccessible or missing spaces. Me routes derive identity from a freshly validated
database session; client userId/spaceId/owner fields never select an identity.

Every state-changing HTTP request must carry an exact trusted Origin. CORS uses
the explicit configured origins and credentials, never a wildcard. Callback URLs
must resolve to one of the same origins. Auth uses Better Auth's native handler
inside a strict Nest/Express HTTP adapter; provider error bodies are replaced by
the shared error envelope. See the identity runbook for provider route semantics.

P0-03 preserves all existing request/response bodies and session-security contracts.
CI compares canonical hashes of the approved P0-02 operation contracts as well as
the complete current snapshot. Removing an operation, weakening its session
requirement, changing existing parameters/body/response schemas, or changing the
health/error schemas fails the compatibility gate. New optional headers, response
codes and components are additive. Baseline changes require explicit contract review.

GET/PATCH /me/settings additionally return a strong ETag such as `"3"`. PATCH
accepts optional `If-Match: "3"`; a stale revision or racing write returns safe
409 CONFLICT. Malformed/weak/list/wildcard tags return 400. Existing clients may
omit the header; all writes still use a database compare-and-increment operation.
Clients needing protection against edits since their last read must send If-Match.
The settings JSON body is unchanged. Better Auth owns profile/session schemas;
no revision columns were added to its models. CORS permits If-Match and
Idempotency-Key and exposes ETag; allowing a header does not activate a capability.

The reusable authenticated context contains frozen actor/request/correlation IDs,
set only after authoritative session verification. Ownership is separately checked
by the spaces facade, which issues a server-only authorized scope. Neither caller
correlation IDs nor cursor fields confer access.

Cursor helpers implement stable ascending `(createdAt,id)` keysets, limit default
25/max 100 and strict bounded base64url cursors bound to actor, space and canonical
filter identity. Repositories apply the timestamp column explicitly (for example
outbox occurredAt), scope with AND, fetch limit+1 and return a nullable nextCursor.
Cursors are positions, not credentials or snapshot guarantees; edits/new rows can
change subsequent results. P0-03 introduced helpers only; P1-01 uses them for scoped Task/Label lists.

Real Prisma unique/concurrency failures map to 409, missing rows to 404, invalid
foreign references to generic 400, pool/connectivity failures to 503 and unexpected
failures to 500. No ORM message, SQL, metadata, key value or constraint name is
serialized. Public inaccessible resources remain 404 through ownership policy.

Idempotency storage is available for the later explicitly high-risk POSTs; no
current auth route is wrapped. The caller must bind a distinct operation to method,
canonical route and validated request. Receipts bind actor+space+operation+hashed
key, expire after 24 hours and store only a result UUID/status plus a fingerprint.
Replays must resolve current authorized data through the owner facade, never return
unvalidated stale private payload. See the database/event runbook for transaction,
crash, expiry and security semantics. P0-03 introduced this foundation; P1-01 activates it for optional Task creation retries.

P0-04 adds only the four file operations documented in OpenAPI. Initiation is
strict JSON metadata; completion streams bounded application/octet-stream bytes.
JSON `{}` completion retries/renews links only for an already READY owned file.
Downloads require both a current verified session and a short-lived actor/space/
file-bound signature. Missing/foreign resources use 404; rejected completion,
stale claims and expired initiation fail safely. No volume path/object key is a
transport field. Responses force attachment/no-store/nosniff/sandbox behavior.

Upload caps apply independently to chunked and Content-Length requests; global
JSON caps remain unchanged. Native file rate limits use the verified principal,
never spoofable forwarding headers. CORS adds DELETE/Content-Disposition. Audit
adds only nullable resource UUID metadata; filenames/content/URLs/paths/keys and
signature values are redacted or omitted from logs. Existing request/error/body
contracts remain compatible against both P0-02 and P0-03 baselines. See
[private files](../runbooks/private-files.md) for state, failure and recovery rules.

P1-01 adds the Task, Label and nested checklist/subtask/history/attachment routes
described in [task operations](../runbooks/tasks.md). Existing Task and Label
mutations require strong If-Match; child checkbox/association edits use the
Task revision. Trusted CORS includes PUT. New objects return 201; Task deletion
returns recoverable metadata; Label deletion returns 204. All list responses
are bounded keysets. No opaque cursor can authorize another owner's resource.
P0-04 signatures additionally lock the existing file protocol in the compatibility
gate. Existing settings optional If-Match semantics remain unchanged.

P1-02 adds recurrence/occurrence, template, bulk and saved-filter operations;
see [their full contracts](../runbooks/task-recurrence-tools.md). Existing P1-01
request/response/parameter signatures are now also frozen in compatibility tests.
Series and occurrences have independent If-Match preconditions; ordinary Task
mutations continue to use the Task revision. Master Tasks are non-actionable.
Bulk and template application require actor/scope/request-bound Idempotency-Key.
For bulk only, the existing receipt table additionally retains validated private
per-item response JSON so replay can return an exact partial result. No receipt
read endpoint exists; current authenticated scope is revalidated on every request.
The 24-hour retention remains unchanged. Receipts never enter logs or outbox.

P1-03 adds the planning route families documented in
[planning operations](../runbooks/planning.md). Plans and reviews have their own
revisions; Task revisions remain independent. Day ordering/selection/removal
uses the Day If-Match; rollover uses explicit plan/settings/item/Task snapshots
and a required Idempotency-Key with the existing 24-hour result receipt contract.
Account-owned availability configuration shares the UserSettings revision while
retaining every existing /me/settings request/response shape. P1-02 signatures
are also frozen in the compatibility gate. A plan's ETag versions its stored
aggregate; enriched Task dispositions are revalidated on every request. All
records preserve local-date/timezone context; preference changes never move them.

## Calendar (P1-04)

Calendar routes preserve date-only versus timed schedule identity, explicit IANA
zones and DST policies. Event/block creation and series splitting use 24-hour
scoped idempotency receipts; mutations require strong revisions. Views have
half-open bounded date ranges and scoped cursors; conflicts are advisory. See
[calendar semantics and examples](../runbooks/calendar.md) and approved ADR 0010.

## Habits (P1-05)

Habit quantities use normalized exact decimal strings; durations use integer
seconds and water uses canonical ML. Stable logical entry UUIDs are separate from
immutable revision UUIDs; PATCH uses both entry and owning habit revisions.
Date ranges are half-open and bounded, statistics explicitly RANGE-scoped, and
configuration history is never silently rewritten. See the
[habit runbook](../runbooks/habits.md) and approved ADR 0011.

## Goal revisions and historical progress

P1-06 nested Goal mutations use the owning Goal If-Match/ETag and increment that
revision. Link creation also checks the source Task/Habit revision; sources remain
owned by their modules. Goal statuses never change from a computed percentage.
GET progress is read-only; POST progress and reviews explicitly capture immutable
rule-versioned snapshots, using Idempotency-Key and Goal If-Match. Values and weights
are exact decimal strings; visible progress clamps to 0..100 while raw values remain.
See [ADR 0012](../adr/0012-goal-progress-and-history-semantics.md).
