# P0-01 API conventions

Business endpoints use `/api/v1`. The current application has only public
`GET /health/live` and `GET /health/ready`; it has no auth or business routes.
The fixture controller used in HTTP tests is never registered in production.

Transport schemas in `packages/api-contracts` are authoritative Zod strict
objects. HTTP input is parsed through ZodValidationPipe. Schema failures return
400 VALIDATION_ERROR, with safe issue codes and positional field placeholders;
raw input, unknown field names, SQL, stacks, and internal exception messages are
not returned. This avoids leaking private content used as an object key.

All errors use `{ "error": { "code", "message", "details"?, "requestId" } }`.
The checked-in OpenAPI 3.1 snapshot describes the current health responses and
the shared error schema. `pnpm openapi:check` fails on snapshot drift; regenerate
with `pnpm openapi:generate` only after reviewing compatibility. The initial
snapshot is the baseline; there is no earlier released API to diff in P0-01.

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

Pagination, idempotency storage, ownership policies, concurrency helpers and
domain routes are implemented only in their approved later batches.
