# Frontend integration guide — finished Phase 0/1

Backend release: `6a9ccdb81e8c3b4842f1d7ea63c3531a6abbd2bb` (P1-12).
This handoff describes implemented behavior only. Suggested screens/state patterns
are frontend guidance, not a UI or a new backend contract.

## Contract and document map

[openapi.json](./openapi.json) is the authoritative machine-readable handoff:
OpenAPI **3.1.0**, **293 operations**, **189 paths**, exported from the canonical
[generated specification](../api/openapi.json) with the reference normalization
described below. Every implemented controller route
and the explicitly allowlisted Better Auth routes were matched to these operations,
including all eleven P1-12 sync/lifecycle operations. `pnpm openapi:check` passes
the existing snapshot and all previous compatibility baselines.

| Document                                                     | Use                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [API module reference](./API_MODULE_REFERENCE.md)            | Every method/path, operation/schema pointer, headers, fields, statuses and suggested screen |
| [Workflows](./FRONTEND_WORKFLOWS.md)                         | Request sequences, lifecycle transitions and conflict behavior                              |
| [Types and state](./FRONTEND_TYPES_AND_STATE.md)             | Type generation, cache boundaries, time/currency and limited sync                           |
| [Security and files](./FRONTEND_SECURITY_AND_FILES.md)       | Cookies/private data, upload/download, Push, export and erasure                             |
| [Integration checklist](./FRONTEND_INTEGRATION_CHECKLIST.md) | Configuration, module readiness and critical integration scenarios                          |

There is **no configured Swagger UI URL and no HTTP OpenAPI JSON URL**. Neither
`/swagger`, `/api-docs` nor `/openapi.json` is a published API. Open the checked-in
JSON in an existing local OpenAPI viewer or generate frontend types from the file;
no runtime documentation dependency or route was added. The JSON has no `servers`
entry: configure the API origin in the consuming frontend.

### OpenAPI packaging normalization

The G0 remediation corrects six recursive references in the canonical generator
and adds local-reference and operation checks alongside snapshot/compatibility
checks. Definitions embedded in sync push request/response schemas now use these
document-level targets in both canonical and handoff JSON:

| Embedded schema      | Exported recursive reference target (three references each)                                         |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Sync push request    | `#/paths/~1api~1v1~1sync~1push/post/requestBody/content/application~1json/schema/$defs/__schema0`   |
| Sync push 201 result | `#/paths/~1api~1v1~1sync~1push/post/responses/201/content/application~1json/schema/$defs/__schema0` |

No operation, property, required field, validation keyword or runtime behavior is
changed. All 2,166 references resolve, and the handoff is semantically identical
to the corrected canonical JSON. The existing handoff JSON bytes were preserved.
The P1-12 compatibility baseline now protects all 293 operations. No frontend
code/type generation was performed by this remediation.

## Backend and local connectivity

NestJS/Express hosts one modular REST API; Better Auth owns credentials/sessions.
PostgreSQL is authoritative; a separate existing worker handles durable jobs.
Private files are streamed through the API. Frontend code never connects to
PostgreSQL, the file directory, pg-boss or SMTP.

The local example API origin is `http://localhost:3000` (`HOST=127.0.0.1`,
`PORT=3000` defaults). Business paths already begin `/api/v1`; health is
`GET /health/live` and `GET /health/ready` without that prefix. Use a consistent
hostname: `localhost` and `127.0.0.1` are not interchangeable cookie/site origins.
An example separate frontend origin is `http://localhost:5173`; it is not a
preconfigured backend default.

Backend operator setup uses ignored `.env` from [.env.example](../../.env.example),
local PostgreSQL and Node 24.22.1/pnpm 10.20.0:

```powershell
pnpm db:generate
pnpm db:migrate:deploy
pnpm build
# Only for a newly provisioned erasure namespace, never over restored evidence:
pnpm personal-data:admin init-control
pnpm jobs:migrate
pnpm start
# Separate terminal, same backend configuration:
pnpm worker
```

Migrations and queue setup are controlled one-off operator operations, not
frontend/startup requests. Existing installations/restore targets must follow the
[lifecycle runbook](../runbooks/personal-data-lifecycle.md); missing independent
erasure evidence deliberately blocks private access/readiness. Configure an
approved erasure policy version before deletion can be requested. The API can
serve normal synchronous operations without the worker; reminder delivery,
rewards, exports and lifecycle cleanup require the worker.

Set backend `BETTER_AUTH_URL` to the API origin, and add the exact frontend origin
to `CORS_ORIGINS` (comma-separated, no wildcard, credentials or trailing slash).
Only a public API origin belongs in a frontend configuration variable such as
your own `API_ORIGIN`; that name is illustrative, not an existing backend setting.
See the [checklist](./FRONTEND_INTEGRATION_CHECKLIST.md) for public/private settings.

## Authenticated browser requests

Use `credentials: 'include'` for sign-in, session probes and all authenticated
fetches. Cookies are HttpOnly, host-only, SameSite=Lax; production adds Secure and
the `__Secure-` prefix. The browser handles `Set-Cookie`; never read/persist a
provider session token or synthesize a bearer/JWT authentication scheme.

The API allows credentialed CORS only for configured origins. The browser supplies
Origin; do not try to set this forbidden browser header manually. Every method
other than GET/HEAD/OPTIONS requires a trusted Origin, even a DELETE with no body.
JSON requests need `Content-Type: application/json`; file completion uses raw bytes.
There is no separate CSRF-token fetch/header protocol. Trusted Origin plus provider
CSRF/session handling is the implemented mechanism. CORS alone does not override
SameSite: unrelated cross-site frontend/API deployments require a reviewed setup;
the current cookie policy is not SameSite=None.

```ts
// Illustrative integration code only; not a generated/installed frontend client.
const response = await fetch(`${API_ORIGIN}/api/v1/tasks`, {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': crypto.randomUUID(),
  },
  body: JSON.stringify({ title: 'Plan the day' }),
});
```

Allowed custom request headers are X-Request-Id, X-Correlation-Id, If-Match,
Idempotency-Key, X-Export-Proof, X-Deletion-Proof and X-Deletion-Recovery.
ETag, request/correlation IDs and Content-Disposition are exposed to the browser.
An SSR/proxy frontend must deliberately forward the user's Cookie and upstream
Set-Cookie values and use a configured trusted Origin for mutations; it must not
forward arbitrary client-supplied authority headers. Do not invent server-only
auth cookies or expose backend secrets to solve a proxy configuration issue.

## Registration, session and recovery

All auth paths below begin `/api/v1/auth`; their exact schemas are in
[auth.ts](../../packages/api-contracts/src/auth.ts).

1. POST `/sign-up/email` with name/email/password and optional trusted callbackURL.
   Password is 8–128 characters; extra identity/role/owner fields are rejected.
   Success provisions identity, settings and Personal Space atomically. It does
   **not** automatically sign in; show verification pending.
2. Follow the private emailed GET `/verify-email?token=...` link. A trusted
   callbackURL can redirect to the frontend. Handle provider callback `error`
   parameters; a redirect alone is not verification success. POST
   `/send-verification-email` resends using the strict email/callback schema.
   Local mail is a private sink read by the backend developer, not a public API.
3. POST `/sign-in/email` with email/password; retain browser cookies. Then GET
   `/get-session` to restore session state and GET `/me`, `/me/settings`,
   `/me/spaces` (these three are under `/api/v1`, not `/auth`) for account context.
4. GET `/get-session` returns a session/user object or null. Protected requests
   revalidate DB sessions and active account admission; revoked cookies do not
   remain authorized through a client cache. Handle 401 and closure/quarantine
   403 safely, cancel private queries and clear sensitive state.
5. POST `/sign-out` with `{}` and cookies. Clear frontend account caches and
   pending sync work. Session/security UI may use GET `/list-sessions` and POST
   `/revoke-session`, `/revoke-other-sessions`, `/revoke-sessions`; see their
   required bodies. Session listing and email change need fresh authentication.
6. POST `/request-password-reset` with email and optional trusted redirectTo;
   always show the generic recovery result. The provider link validates GET
   `/reset-password/{token}?callbackURL=...`; the frontend reset form submits
   POST `/reset-password` with token/newPassword. Reset is expiring/single-use and
   revokes sessions; sign in again. Do not retain the token in logs or storage.
7. POST `/change-password` uses currentPassword/newPassword/revokeOtherSessions.
   POST `/change-email` uses newEmail/callbackURL and a verified fresh session;
   the old mailbox confirms before new mailbox verification and session revocation.
   PATCH `/api/v1/me` changes only name/image, not credentials/email.

Respect 429 and avoid session/recovery retry loops. Login is limited to three
attempts per ten seconds per actual connecting IP; several sensitive auth actions
have tighter per-minute limits. Current proxy topology does not trust arbitrary
forwarded IP headers; production proxy behavior is a deployment gate.

## Responses and state integration

Use the documented success status/media type: a mutation is not always 200 or
201, and a download is not JSON. Preserve ETag exactly, including quotes, for the
correct aggregate's If-Match. A 409 requires refetch/reconciliation; a network
failure on an idempotent operation is retried with the exact same body/key.
Never generate a new key merely because a response was lost.

The shared exception filter deliberately returns stable generic HTTP error codes.
Internal labels such as RESYNC_REQUIRED or a density diagnostic are not guaranteed
top-level error.code values. For sync pull, handle HTTP 409 by refreshing status
and safely bootstrapping the supported subset; per-operation push outcomes provide
their separately typed error data. Display requestId for support without logging
private request/response content.

No frontend integration blocker was found in the published route/schema inventory.
Connectivity still requires correct origins/cookies, initialized private erasure
control, a running worker for asynchronous workflows and configured/consented
external channels. Deployment-only gates remain listed in the checklist.
