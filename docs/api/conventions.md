# API conventions through P0-02

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

Pagination, generic idempotency/audit/outbox storage, concurrency helpers and
business-domain routes remain deferred to their assigned batches.
