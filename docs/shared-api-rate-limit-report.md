# Shared API rate-limit fix — 2026-11-17

Work item: SHARED-API-RATE-LIMITS. Status: COMPLETE.
Decision and rationale: [ADR 0058](adr/0058-shared-api-rate-limits.md).
Operations: [runbook](runbooks/shared-api-rate-limits.md).

## Result

The old cross-module Shared HTTP budgets were 20/user/minute and 30/IP/minute,
combining reads and writes. Normal page loading exhausted them; localhost users
competed for the same IP budget. There was no evidence of routine duplicate
charging to the same bucket: one actor plus one IP constraint was intentional.
The filter also replaced actual retry delays with 60 seconds, and Better Auth's
X-Retry-After was not mapped to the standard header.

New independent module budgets: reads 600/user and 6,000/IP per minute; writes
120/user and 1,200/IP; sensitive actions 20/user and 60/IP. Anonymous previews
retain 30/IP. Expensive method/templates add 30/user and 300/IP, independent of
resource IDs and query values, while still consuming their class budget. Lists
use the read class; permission/member changes, invitations/proofs, financial
approval/payment, ownership, recovery and lifecycle actions use the sensitive class.
Actor exhaustion cannot continue consuming the shared NAT budget. Guard admission
is deduplicated per request, including concurrent duplicate invocations.

Retry-After uses actual database-window or provider/named-throttler block timing.
RateLimit-Limit/Remaining/Reset/Policy expose the relevant constraint, including on
429; CORS exposes these headers. Header selection can truthfully describe the IP
budget when it is closer to exhaustion than a new user's budget.

Exact protections retained: sign-in 3/10 seconds; recovery/verification/email-change
3/minute; reset 5/minute; session listing/revocation 20/minute; remaining provider
rules or 100/minute. Context invitation/grant limits remain 20/minute, ownership
handover 5/minute. File and Personal lifecycle limits, session/RBAC/tenant fencing,
proofs/revisions/idempotency, local Shared restrictions and file-byte denial remain.

Changed owners/files: Spaces limiter/pure route policy/public HTTP admission helper;
eight Shared HTTP guards; Messaging request facade; auth response adapter;
bootstrap error/CORS handling; focused tests; communication lifecycle OpenAPI
headers and generated snapshot; ADR/runbooks/report. No dependency, schema, entity,
migration, constraint, event, worker logic or job change. Historical compatibility
baselines are unchanged. No Frontend edits or production deployment.

## Verification

| Command                                                                                                                                                                                                                                                                                                                          | Observed result                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm.cmd build`                                                                                                                                                                                                                                                                                                                 | PASS                                                                                         |
| `pnpm.cmd typecheck`                                                                                                                                                                                                                                                                                                             | PASS                                                                                         |
| `node --max-old-space-size=8192 node_modules/eslint/bin/eslint.js . --max-warnings 0`                                                                                                                                                                                                                                            | PASS; affected-file lint also passed after final hardening                                   |
| `pnpm.cmd architecture`                                                                                                                                                                                                                                                                                                          | PASS; 673 modules, 4,617 dependencies; no boundary/cycle violations                          |
| `pnpm.cmd openapi:generate` then `pnpm.cmd openapi:check`                                                                                                                                                                                                                                                                        | PASS; reviewed snapshot and all historical compatibility checks                              |
| Changed-file `pnpm.cmd exec prettier --check` and `git diff --check`                                                                                                                                                                                                                                                             | PASS                                                                                         |
| `pnpm.cmd exec vitest run --project unit --project contract apps/api/src/modules/spaces/application/collaboration-limit.spec.ts apps/api/src/bootstrap/api-exception.filter.spec.ts apps/api/test/contract/http.spec.ts apps/api/test/contract/shared-activation.spec.ts apps/api/test/contract/communication-lifecycle.spec.ts` | PASS; 35 tests                                                                               |
| `pnpm.cmd test:integration apps/api/test/integration/shared-rate-limit.spec.ts apps/api/test/integration/auth-rate-limit.spec.ts apps/api/test/integration/auth.spec.ts`                                                                                                                                                         | PASS; 8 tests against isolated PostgreSQL; no reset                                          |
| `node --env-file=.env .tools/shared-rate-live.mjs`                                                                                                                                                                                                                                                                               | PASS; 286 initial and 319 final real API checks against mehran_dev after final build/restart |

The 43 focused automated tests cover realistic/excessive reads, mutations,
sensitive/expensive routes, user/IP/module/class independence, duplicate guard
admission, real concurrent atomic counting, DB-time reset/rollover, provider auth
enforcement, retry headers and existing HTTP/activation contracts. The SQL fixture
owns only a fresh isolated schema with the current limiter table definition.

Real local verification used dedicated newly verified development accounts and
normal sessions: 120 mixed Project/Team/Company/Conversation/Meeting/task reads,
Project/task creation, cross-user 404, independent users sharing localhost,
ordinary reads after write exhaustion, finite mutation/sensitive 429 bursts,
exact reset/retry equality, expensive dashboard endpoint rejection at 31 reads,
sign-in throttling within its 10-second window,
preflight exclusion, one-count HEAD/GET and blocked Personal/Project uploads.
Synthetic Projects were archived through supported APIs; sessions signed out.
Dedicated fixture identities remain; no existing user's business data was changed.

NOT RUN: unrelated full integration suites, Docker/production release, malware
engine and proxy deployment. These are outside this fix; ADR 0057's local-mode and
scanning release blockers remain binding. Shared fixed windows intentionally allow
a boundary burst; current socket-IP accounting still requires the documented
trusted-proxy release gate. No new blocker or unapproved deviation.

Git: initially clean main; only this fix's 28 reviewed paths are included.
The owner directly approved the exact commit on main and normal push to origin/main.
The commit hash and remote confirmation are recorded in the execution reply.
Final local API PID 49468 and worker PID 46328 are running; readiness is 200 with
database up and the worker reports ready. No duplicate instance remains.
No next implementation batch is started.

Frontend request fan-out remains unchanged. Caching/deduplication and pausing
inactive polling remain useful opportunities; no Frontend audit/change is claimed.
