# Fable frontend integration handoff — through P6-01

Date: 2026-11-11 (Asia/Tehran).
Published backend code: **`7bcc10e2b133bc67976e5684f2aba82760890ea8`** on `origin/main`.
This is the integration baseline for completed Phases 0–5 and **Phase 6, batch 01 only**.
Phase 5 excludes its explicitly deferred P5-04 realtime transport. Phase 6 is not
complete as a whole. The owner authorized publication of P6-01 after local acceptance.

Recommended handoff boundary: **P6-01**, so frontend and published backend use the
same current contract. Existing Phase 5 consumers retain their API compatibility.
This document describes backend integration; it does not prescribe a replacement UI.

## 1. Instructions to Fable

Connect the existing frontend to this Mehran Planner backend. First inspect the
frontend's current framework, router, API layer and state management, and preserve
them. Read this guide and the accompanying canonical OpenAPI JSON before editing.
Replace mocks feature by feature with real authenticated requests. Keep missing or
gated features visibly unavailable; report the precise missing configuration or
operation rather than inventing an endpoint or successful response.

Use the backend's existing identity, memberships, permission checks, jobs and private
file protocol. Do not add another auth provider, browser database, payment service,
WebSocket server or parallel business rules. Do not change backend APIs, migrate or
reset databases, deploy, activate Shared features or start P6-02+ as part of frontend
integration. Report any backend contract gap with method/path and requestId.

## 2. Authoritative files and version pin

| File                                                                                                                           | Purpose                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [`api/openapi.json`](api/openapi.json)                                                                                         | Complete implemented contract: OpenAPI 3.1.0, **841 operations**, **7,649 resolved references** |
| [`p6-01-contract.md`](p6-01-contract.md)                                                                                       | Social scope, ownership, transitions and constraints                                            |
| [`adr/0050-social-discovery-connections-and-group-admission.md`](adr/0050-social-discovery-connections-and-group-admission.md) | Approved discovery, blocking and Group admission policy                                         |
| [`p5-06-contract.md`](p5-06-contract.md)                                                                                       | REST recovery, multi-device consistency, blocks and lifecycle                                   |
| [`p5-03-contract.md`](p5-03-contract.md)                                                                                       | Private media, read/delivery consent and notification semantics                                 |
| [`p5-05-contract.md`](p5-05-contract.md)                                                                                       | Meetings, reviewed minutes, Task release and announcements                                      |
| [`p6-01-report.md`](p6-01-report.md) and [`p6-01-test-evidence.json`](p6-01-test-evidence.json)                                | Local acceptance and its operational limits                                                     |
| [`runbooks/`](runbooks/)                                                                                                       | Domain-specific implementation details when a screen needs them                                 |

The downloadable bundle provides this guide as `README.md` and preserves the
`api/openapi.json` relative path, with key policy references and runbooks. Deeper
source-code links require the repository at the pinned backend SHA.
The canonical OpenAPI has **no `servers` entry**. All business paths already contain
`/api/v1`; do not add this prefix twice. Health paths are outside that prefix.
Schemas, enum values, required headers, pagination and successful status/media types
must come from each actual operation. Schema `$ref` targets are document-local,
including nested `$defs`; the chosen reader/generator must resolve all of them.

Earlier batch reports/manifests are pre-publication evidence snapshots. Their
pending/unstaged flags describe capture time; the published backend SHA above and
the bundle's release metadata identify this handoff's current version.

The untracked legacy `docs/frontend-handoff/` materials describe Phase 1 and an old
293-operation snapshot. They were preserved and were not published with P6-01.
Do not use their bundled JSON or operation counts as this release's contract.
Do not use a future roadmap as an implemented endpoint inventory.

There is no configured Swagger UI or HTTP OpenAPI JSON service. Compiled probes of
`GET /api/v1/docs` and `GET /api/v1/openapi.json` return 404. Supply the checked-in
JSON to Fable/type tooling directly; do not add or guess a documentation URL.

## 3. Connection prerequisites — obtain these from the backend operator

| Value                                                                        | Frontend use / ownership                                                                 |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| API origin, such as `http://localhost:3000` for approved local development   | Public frontend configuration; origin only, without `/api/v1`                            |
| Exact frontend origin                                                        | Operator must approve it in backend `CORS_ORIGINS` and trusted callback configuration    |
| A verified test account and password-reset/verification delivery arrangement | Use the actual auth flow; verification mail in a local sink is operator-only             |
| Integration-environment readiness and worker status                          | Operator provides health/status; frontend never starts workers or edits the database     |
| Applicable approved retention policy version for Shared creation             | Operator supplies the exact existing version; never copy a synthetic test value          |
| Shared feature readiness                                                     | Backend-only acceptance/control configuration; unavailable Shared APIs must remain gated |

No hosted backend URL or Fable preview origin was supplied for this handoff.
`localhost` inside a remote preview/runtime refers to that runtime, not the owner's
Windows backend. A reachable integration environment must be supplied separately.
This publication is not deployment or Shared activation authorization.

Publication also does not apply migrations to an existing environment. Protected
databases were preserved. The operator must provide an approved integration database
matching this release's 69 reviewed migrations, including
`202611110045_social_foundation` (M045), before relying on its new Social tables.
Fable must not run migrations or reset a database to resolve a schema error.

Use a consistent hostname: `localhost` and `127.0.0.1` have different cookie/site
origins. The current cookies use SameSite=Lax, HttpOnly and host-only scope;
production adds Secure. Credentialed CORS alone does not make unrelated cross-site
cookie deployment work. Prefer an operator-approved same-site topology or an
already-established trusted proxy; do not change cookie/security policy as a UI fix.

Backend secrets (`DATABASE_URL`, auth secrets, SMTP credentials, private storage,
signing/control keys) never belong in Fable's browser configuration. Do not invent
`SHARED_SECURITY_ACCEPTANCE_REFERENCE` or signing values to bypass a denied request.

## 4. Browser transport, revisions and errors

- Use `credentials: 'include'` for sign-in, session lookup and all private requests.
  The browser owns HttpOnly cookies and Set-Cookie. Do not create bearer/JWT auth
  or persist session tokens from an auth response in localStorage.
- The browser supplies `Origin`. Every mutation, including bodyless DELETE,
  requires a trusted Origin. Do not manually set the browser's forbidden Origin
  header. There is no separate custom CSRF-token endpoint/header protocol.
- JSON requests use `Content-Type: application/json`. Binary upload completion
  uses the operation's raw media type. Do not send multipart/FormData unless the
  exact operation declares it; current file completion streams raw bytes.
- Allowed custom request headers: `X-Request-Id`, `X-Correlation-Id`, `If-Match`,
  `Idempotency-Key`, `X-Export-Proof`, `X-Deletion-Proof`, `X-Deletion-Recovery`,
  `X-Invitation-Proof`. Exposed response headers: `ETag`, `X-Request-Id`,
  `X-Correlation-Id`, `Content-Disposition`.
- Preserve quoted ETag exactly in `If-Match`, for example `"2"`. When an operation
  returns a JSON revision instead, use the contract's corresponding aggregate
  revision. Nested edits may version the parent rather than the child.
- A logical idempotent command keeps one key and the exact same body across a
  lost-response retry. A new user action gets a new key. Retain required client UUIDs
  for that command. Never replay a stale command after account/scope revocation.
- Treat every documented 2xx status as success as appropriate. Some query-like
  Social POST operations return 201. Handle 204 without JSON parsing; handle
  downloads as bytes. There is no universal `{data: ...}` response envelope.
- Pagination varies: Personal/messaging APIs may use `cursor`; Project/Team/Social
  APIs commonly use `after`. Use each operation's exact query/result. Cursors are
  opaque and bound to actor/scope/authority; never decode, forge or share them.

Error shape for the application exception filter:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Resource conflict",
    "requestId": "request-uuid"
  }
}
```

| HTTP      | Frontend behavior                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| 400 / 422 | Correct the body; show documented field details when present                                                                |
| 401       | Stop private requests, clear private view state and restore/sign in again                                                   |
| 403       | Current identity/permission/account/feature gate denies access; do not assume a particular hidden reason or retry endlessly |
| 404       | Safe absence/unavailable resource or proof; never infer the existence of another person's data                              |
| 409       | Refetch the correct aggregate/state and reconcile; do not blindly overwrite with a new revision                             |
| 413 / 415 | Correct payload size or actual supported media type                                                                         |
| 429       | Stop the loop, wait and back off; no overlapping retry storm                                                                |
| 500 / 503 | Show temporary failure and bounded retry/support with requestId                                                             |

Internal labels such as `SHARED_ACTIVATION_GATED` or restore diagnostics are not
guaranteed top-level error codes: the filter emits stable generic status codes.
Sync/bulk per-item outcomes have separate typed schemas. `Retry-After` is sent for
application 429 responses, but it is not currently a CORS-exposed header. When it
cannot be read cross-origin, use the current 60-second application fallback.
Auth has its own tighter rules (sign-in: 3 attempts/10 seconds per actual IP).

Illustrative browser JSON helper; adapt it to the existing frontend client:

```ts
const API_ORIGIN = /* public, operator-supplied API origin */ '';

async function apiJson<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(new URL(path, API_ORIGIN), {
    ...init,
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw Object.assign(new Error(body?.error?.message ?? 'Request failed'), {
      status: response.status,
      requestId: body?.error?.requestId,
      details: body?.error?.details,
    });
  }
  return {
    data: response.status === 204 ? undefined : ((await response.json()) as T),
    etag: response.headers.get('ETag'),
  };
}
```

Use this helper only for JSON operations. An SSR/server-side fetch does not gain
the browser's cookie jar from `credentials` alone: use the existing trusted
Cookie/Set-Cookie forwarding arrangement, if one is already configured.

## 5. Authentication and account bootstrap

1. Check `GET /health/live` and `GET /health/ready` against the API origin.
2. `GET /api/v1/auth/get-session` restores the actual session (or returns null).
3. Sign-up uses `POST /api/v1/auth/sign-up/email` with `name`, `email`, `password`
   and optional approved `callbackURL`. It does not automatically sign the user in.
4. Complete real email verification through the provider's verification link.
   Frontend never marks an account verified or reads an operator mail directory.
5. Sign in through `POST /api/v1/auth/sign-in/email` with email/password and cookies.
6. Fetch `/api/v1/me`, `/api/v1/me/settings`, `/api/v1/me/spaces` for the current
   account, preferences and authorized Personal Space. Scope changes must clear or
   partition cached data; creation attribution is not ownership authority.
7. Implement sign-out, current sessions/revocation, password reset/change and the
   provider's two-step email-change flow using the exact auth schemas. Sensitive
   operations may require fresh authentication. Callback redirects alone do not
   prove verification or login success.

Never log credentials, recovery/invitation proofs or full private bodies. Logout,
account closure, permission removal and identity switching must cancel polling,
in-flight private views and cached results from the prior account/scope.

## 6. Implemented feature boundary by phase

| Boundary | Implemented integration scope                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0  | Account/auth, Personal ownership, revisions/idempotency/audit, private files, health/config foundations                                                                                                                                                                                                             |
| Phase 1  | Tasks/checklists/labels/recurrences/templates; day/week planning; calendar/time blocks; habits/routines/water; Goals/milestones; Focus/time entries; Notes/Journal/Mood/Capture/search; exact-decimal personal Finance; notifications/reminders; insights/rewards; bounded Personal sync, export and staged erasure |
| Phase 2  | Independent Projects and shared custody; verified invitations/narrow grants; unified Task/Goal assignments and accepted-work projections; workflow/custom fields/dependencies; risks/templates/import/reporting; authorized documents/comments/files and lifecycle                                                  |
| Phase 3  | Independent Teams, explicit Project references, shared work/planning/capacity, confidentiality-reviewed recognition/corrective records and Team lifecycle                                                                                                                                                           |
| Phase 4  | Companies, scoped hierarchy/admission, confidential staff records, allocations, expense/budget/approval/reimbursement records, private knowledge/reporting, lifecycle and approved independent association                                                                                                          |
| Phase 5  | DMs/private conversations/work channels, ordered persisted messaging with REST polling/recovery, advanced message actions, private files/images/recorded voice, consent-based receipts and Push preferences, meetings/minutes/actions and announcements; privacy/lifecycle/security closeout                        |
| P6-01    | Exact opt-in user discovery, mutual friends, pair blocking/privacy, private Circle labels, private/discoverable Social Groups, invitation/approval, roles/member management and inherited succession/departure                                                                                                      |

Actual operations in OpenAPI are authoritative even when a topic label is broad.
In particular, executable Company-child custody transfer is deferred by ADR 0043.
Company association is not a transfer and grants no automatic source access.
Personal Journal/Mood/Finance/Focus never become visible through a work/social role.

**Not available:** P5-04 WebSocket/Socket.IO/Presence/Typing; Social Activities/trips/
RSVP/polls, Social Group Chat integration, social expense splitting/settlement,
lending/Lost & Found, social albums/challenges and P6-02–P6-06; Phase 7 Admin/billing;
native live calls, real payments, new social feeds or speculative integrations.
**c09 is excluded permanently from the approved Phase 6 scope:** transferring,
reassigning or assuming somebody else's debt, receivable or financial obligation.

## 7. P6-01 workflows and identity types

| ID                     | Meaning / correct use                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------- |
| User ID                | Stable verified identity, e.g. discovery result `id` and invitation `recipient.userId` |
| Space / scope ID       | Ownership and authorization boundary; not a UI tab, Circle or universal workspace      |
| Shared actor ID        | Boundary-local attribution; do not substitute it for a User ID                         |
| Context access ID      | Current membership seat; used by membership management and `successorAccessId`         |
| Social connection ID   | A particular request/friendship record; Circle labels use this ID, not the User ID     |
| Conversation member ID | Conversation admission identity; separate from work membership and User ID             |
| Block ID               | Opaque owner-private block record used for unblock; not a counterparty User ID         |

### Discovery and friendship

Discovery is off by default. Read `GET /api/v1/social/privacy`, then let the user
explicitly choose `PATCH /api/v1/social/privacy` with revision/idempotency headers.
`allowFriendRequests` is separate from discovery. Do not publish friends, Circles,
contact details or a mutual-friend graph.

`POST /api/v1/social/discovery` accepts only `{ "email": "person@example.test" }`.
It matches an exact normalized verified email and returns `{items:[{id,name}]}` or
`{items:[]}`. Empty covers unknown, opted-out, unverified, closed, self and blocked
targets; show a generic result rather than an account-existence diagnostic.
There is no name/prefix/phone search or current phone-verification workflow.

Create a request with `POST /api/v1/social/connections`:

```json
{ "id": "client-command-uuid", "recipientUserId": "discovered-user-uuid" }
```

Only the recipient accepts or declines. The requester may cancel; either friend
may remove an accepted friendship. Use
`POST /api/v1/social/connections/{id}/{action}` with action
`accept | decline | cancel | remove`, current If-Match and Idempotency-Key.
Requests start PENDING; acceptance is explicit. An opposing request is a conflict,
not automatic consent. List state from `GET /api/v1/social/connections`.

### Blocking and Circles

Use `POST /api/v1/social/blocks` with `{targetUserId}`, current block revision
(initial own absent state uses revision 1), and an idempotency key. Keep the returned
block ID/revision for `POST /api/v1/social/blocks/{id}/unblock`.
`GET /api/v1/social/blocks` exposes only owner-private records; its rows deliberately
omit target identity/display name, and conversationId can be null. Do not fabricate
a person label from a block ID or infer who blocked the current user.

Blocking cancels pending requests, ends accepted friendship and removes both users'
Circle labels. Unblock restores none of these and revives no stale invitation.
Common Group membership/content and authorized old DM history remain separately
governed; blocked direct contact is not a generic Group membership revocation.

Circles are private labels over current accepted friends, never shared tenants.
Use `/api/v1/social/circles` for create/list and `/{id}` for read/edit/delete.
Label/unlabel with `PUT`/`DELETE /{id}/members/{connectionId}` and the Circle's current
revision. Refetch Circle metadata and members after changes/block/removal; label
commands return identifiers rather than a complete refreshed Circle revision.
`/social/restore-replay` and `/messaging/blocks/replay` are explicit restrictive
restore procedures, not generic retries for every 403. Follow operator guidance.

### Social Groups, invitation and approved joining

Create a Group using `/api/v1/social-groups`, a stable client UUID, name and the
operator-supplied `retentionPolicyVersion`. Private is the default. `description`
is private; `publicSummary` is the separately approved preview text. A name-only
PATCH preserves the other fields. Listing discovery never grants private access.

- `GET /api/v1/social-groups` lists the actor's authorized Groups.
- `GET /api/v1/social-groups/discover` requires a verified session and exposes only
  `{id,name,publicSummary}` for opted-in Groups. No owner identity, member count,
  private description, chat or file access is inferred.
- An applicant sends `POST /social-groups/{id}/join-requests` with `{id}` and a
  stable idempotency key. Pending state cannot read private Group data.
- Owner/Admin reviews current requests and uses
  `POST /social-groups/{id}/join-requests/{requestId}/{action}` with
  `approve | reject | cancel` as authorized and the request revision. An applicant
  may cancel only their own request. Approval creates membership from that consent.
- Owner/Admin may issue `/social-groups/{id}/invitations` with
  `{kind:"MEMBERSHIP",memberRole:"MEMBER",recipient:{userId}}` (or the documented
  email form). The recipient explicitly accepts/declines through
  `/social-group-invitations/{id}/accept` or `/decline` with `X-Invitation-Proof`
  and invitation If-Match. Issuing an invitation supplies approval but not consent.
- Proofs are private, bounded and expire after seven days. Preview uses the proof
  header and safe metadata; do not place proofs in logged query URLs/localStorage.
  An idempotent invitation retry can return `proof:null`; do not treat that as a
  usable proof or invent a proof-retrieval API.

Group roles are fixed: Owner/Admin/Member. Owner is derived custody. Owner/Admin
manage metadata, Member admissions and ordinary Member removal; only Owner appoints
or demotes Admins and initiates succession. Members read and leave. No self-promotion
or implicit Task/Goal/Conversation access exists. Friendship is not a Group right.
Use the exact membership seat ID and revision from the memberships endpoint.
Owner handover requires a verified current member's explicit acceptance and fresh
provider password reauthentication. Last-member departure uses existing 30-day
shared closure; do not pretend leaving deletes everyone's data immediately.

## 8. Phase 5 messaging and meetings integration

Create DMs/private groups/work channels using the discriminator-specific request.
For example a DM has `kind:"DM"`, `participants:[oneUserId]`, client `id` and an
approved retention version. Other named users must accept the invitation before
participating. Work membership alone never grants channel history. Rejoining has
a new generation/history floor; old cursors cannot recover pre-join content.

Use durable REST polling, with one bounded loop per conversation/device:

1. Bootstrap `/api/v1/conversations/{id}/recovery`, preserving its finite snapshot
   ceiling and initial `changeCursor` across pages.
2. After the final snapshot page, consume the documented incremental rich-message
   changes from that original cursor; do not replace it with a fresh tail cursor.
3. Upsert stable message IDs using authoritative revision/order, and apply deletion,
   self-hide and unavailable tombstones. Sequence/cursor values remain strings.
4. Keep device cursors separate. On 409, discard the invalid local projection and
   bootstrap safely; on 401/403/404, stop and evict unauthorized cached content.
5. Avoid overlapping polls. Current shared request ceilings are actor 20/IP 30
   per minute; share the budget across screens, back off on 429 and pause hidden
   or inactive views as appropriate. Do not poll each chat every second.

Use the exact rich-media, changes and receipt operations in OpenAPI. Delivered/read
acknowledgement is explicit and monotonic. Receipt sharing starts off and requires
current consent; Push routing has its own opt-in. Do not fabricate presence, typing,
online status or a WebSocket connection. A Push preference is not proof of working
browser/external Push delivery in the integration environment.

Ordinary author edit is limited to 48 hours. Within that window author
delete-for-everyone is allowed in DMs/private conversations and policy-controlled
in work channels. After it, ordinary deletion is self-only. Moderation and retained
history are different actions. Forwarding remains live-authorized at source/target;
never permanently copy a forwarded private payload to evade later revocation.

Meetings/minutes follow the actual draft/review/approval/final state machine.
Meeting acceptance, RSVP, delegation and published-document visibility differ from
work membership. Task conversion/release is explicit; do not create duplicate Tasks
optimistically. Announcements have audience generation and private acknowledgements.
No native calling or live video integration is implied by an external meeting URL.

## 9. Private files, data types and offline limits

Follow the owning operation's upload protocol: initiate metadata, stream original
bytes to its completion route, then attach/finalize in the owning authorized domain.
File IDs do not authorize access. No public storage URL, direct volume mount or
S3-presigned protocol is available. Preserve relative download paths against the API
origin and retain cookies/proofs as specified; downloads are bytes, not JSON.

Text/PDF/PNG/JPEG and contextual WAV support are explicit allowlists. Current
message voice is **WAV only, at most 120,000 ms and 10,000,000 bytes**; another
container emitted by browser recording is not accepted merely because MIME is
renamed. Use a compatible existing frontend recording/encoding path, or report the
format gap. Do not change the backend codec/provider. Generic file and attachment
limits differ by endpoint/configuration; read the actual schema and server result.
Structural media checks are implemented; full malware-engine release clearance is
still outside local acceptance. No Phase 6 social album/thumbnail API exists yet.

Preserve decimal money/quantity strings, currency codes, opaque IDs and large
sequence strings. Do not perform money math with JavaScript floating point.
Store/transmit Gregorian ISO date-only values, UTC instants and explicit IANA zones
as the contract requires; Jalali/locale display must not rewrite source dates.

The existing Personal offline subset is exactly TASK, CHECKLIST, LABEL, DAILY_PLAN,
HABIT_ENTRY, NOTE and CAPTURE, using the allowed command union. Do not queue auth,
file bytes, Finance, shared work, invitations, roles, messages or Social mutations
through Personal sync. Implement typed APPLIED/DUPLICATE/CONFLICT/REJECTED outcomes,
tombstones and safe cursor-expiry recovery; no blind last-write-wins.

Exports and staged account erasure use authenticated, expiring proof-based jobs.
Do not put private artifacts/tokens into public URLs, logs or long-lived caches.
Personal seven-day erasure grace and shared 30-day recovery are different policies.

## 10. Fable completion criteria

1. Record the backend SHA and OpenAPI file hash used. Confirm approved API/frontend
   origins, a real verified test account, cookie behavior and shared-feature readiness.
2. Integrate auth/account first, then existing Personal modules, then authorized
   Project/Team/Company contexts, communication/meetings and P6-01 Social features.
3. Use existing frontend client/types; generate or map only from this OpenAPI.
   Remove mocks from connected paths and make unimplemented/gated features explicit.
4. Prove each connected screen's happy path plus validation, 401/403/404/409/429,
   stale revision, response-loss retry and empty/paginated states. Use distinct
   verified users for outsider, friendship, pending and approved Group scenarios.
5. Check account/context switching, revocation, logout and block/unblock across
   reload and two sessions. Clear private state and stop unauthorized polling.
6. Report actual method/path failures with sanitized requestId, not secrets or full
   private bodies. List unresolved connectivity/contract gaps and remaining mocks.
7. Do not call the whole Phase 6 complete; do not add P6-02+, realtime or c09 features.

Backend local evidence includes one full 13-stage gate with findings resolved by
affected reruns, 717 distinct non-integration and 997 integration cases cumulatively,
final migration rehearsal and actual compiled API/worker restart smoke. This is not
evidence of a deployed public endpoint, completed Fable integration or operational
production acceptance. Backend deployment/activation remains a separate owner step.

## 11. Actual API topic index

The following topic counts are extracted from this release's canonical JSON.
Use them to navigate all 841 operations, then read each operation schema.

| Actual primary tag    | Operations | Example implemented paths                                                                                                                                                             |
| --------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| account               |          5 | `/api/v1/me`, `/api/v1/me/settings`, `/api/v1/me/spaces`                                                                                                                              |
| auth                  |         15 | `/api/v1/auth/sign-up/email`, `/api/v1/auth/sign-in/email`, `/api/v1/auth/sign-out`                                                                                                   |
| calendar              |         13 | `/api/v1/calendar/events`, `/api/v1/calendar/events/{id}`, `/api/v1/calendar/time-blocks`                                                                                             |
| companies             |        140 | `/api/v1/companies`, `/api/v1/companies/{id}`, `/api/v1/companies/{id}/departments`                                                                                                   |
| company-lifecycle     |         12 | `/api/v1/companies/{id}/archive`, `/api/v1/companies/{id}/restore`, `/api/v1/companies/{id}/delete`                                                                                   |
| files                 |          4 | `/api/v1/files/uploads`, `/api/v1/files/{id}/complete`, `/api/v1/files/{id}/download`                                                                                                 |
| finance               |         41 | `/api/v1/finance/accounts`, `/api/v1/finance/accounts/{id}`, `/api/v1/finance/categories`                                                                                             |
| focus                 |         19 | `/api/v1/focus/sessions`, `/api/v1/focus/sessions/{id}`, `/api/v1/focus/sessions/{id}/history`                                                                                        |
| goals                 |         29 | `/api/v1/life-areas`, `/api/v1/life-areas/{id}`, `/api/v1/goals`                                                                                                                      |
| habits                |         18 | `/api/v1/habits`, `/api/v1/habits/{id}`, `/api/v1/habits/{id}/schedules`                                                                                                              |
| health                |          2 | `/health/live`, `/health/ready`                                                                                                                                                       |
| insights              |          6 | `/api/v1/insights/overview`, `/api/v1/insights/tasks`, `/api/v1/insights/habits`                                                                                                      |
| labels                |          5 | `/api/v1/labels`, `/api/v1/labels/{id}`                                                                                                                                               |
| meetings              |         52 | `/api/v1/meetings`, `/api/v1/meetings/invitations`, `/api/v1/meetings/invitations/{invitationId}/respond`                                                                             |
| messaging             |         63 | `/api/v1/conversations`, `/api/v1/conversations/{id}`, `/api/v1/conversations/{id}/members`                                                                                           |
| notifications         |         20 | `/api/v1/reminders`, `/api/v1/reminders/{id}`, `/api/v1/reminders/{id}/pause`                                                                                                         |
| personal-lifecycle    |          8 | `/api/v1/me/export`, `/api/v1/me/exports/{id}`, `/api/v1/me/exports/{id}/download`                                                                                                    |
| planning              |         18 | `/api/v1/planning/days/{date}`, `/api/v1/planning/days/{date}/items/{taskId}`, `/api/v1/planning/days/{date}/items/{taskId}/move`                                                     |
| project-collaboration |         30 | `/api/v1/projects/{projectId}/exports`, `/api/v1/projects/{projectId}/files/reconcile`, `/api/v1/projects/{projectId}/content/{targetKind}/{targetId}/comments/{commentId}/history`   |
| project-execution     |         33 | `/api/v1/projects/{projectId}/register-items`, `/api/v1/projects/{projectId}/register-items/{itemId}`, `/api/v1/projects/{projectId}/register-items/{itemId}/history`                 |
| project-tools         |         26 | `/api/v1/projects/{projectId}/workflows`, `/api/v1/projects/{projectId}/workflows/{workflowId}/versions`, `/api/v1/projects/{projectId}/tasks/{taskId}/workflow`                      |
| projects              |         38 | `/api/v1/projects`, `/api/v1/projects/{id}`, `/api/v1/projects/{id}/archive`                                                                                                          |
| rewards               |          5 | `/api/v1/rewards/preferences`, `/api/v1/rewards/progress`, `/api/v1/rewards/achievements`                                                                                             |
| shared-collaboration  |         13 | `/api/v1/spaces/{spaceId}/invitations`, `/api/v1/spaces/{spaceId}/invitations/{id}`, `/api/v1/invitations/preview`                                                                    |
| shared-work           |         19 | `/api/v1/projects/{projectId}/assignment-policy`, `/api/v1/projects/{projectId}/tasks/{taskId}/assignments`, `/api/v1/projects/{projectId}/tasks/{taskId}/assignments/{assignmentId}` |
| social                |         40 | `/api/v1/social/privacy`, `/api/v1/social/discovery`, `/api/v1/social/connections`                                                                                                    |
| sync                  |          3 | `/api/v1/sync/status`, `/api/v1/sync/pull`, `/api/v1/sync/push`                                                                                                                       |
| tasks                 |         45 | `/api/v1/tasks`, `/api/v1/tasks/{id}`, `/api/v1/tasks/{id}/complete`                                                                                                                  |
| team-analytics        |          6 | `/api/v1/teams/{id}/capacity`, `/api/v1/teams/{id}/capacity/{capacityId}`, `/api/v1/teams/{id}/workload`                                                                              |
| team-interactions     |         21 | `/api/v1/teams/{id}/cases`, `/api/v1/teams/{id}/cases/{caseId}`, `/api/v1/teams/{id}/cases/{caseId}/entries`                                                                          |
| team-lifecycle        |         12 | `/api/v1/teams/{id}/archive`, `/api/v1/teams/{id}/restore`, `/api/v1/teams/{id}/delete`                                                                                               |
| teams                 |         43 | `/api/v1/teams`, `/api/v1/teams/{id}`, `/api/v1/teams/{id}/memberships`                                                                                                               |
| writing               |         37 | `/api/v1/notes`, `/api/v1/notes/{id}`, `/api/v1/notes/{id}/history`                                                                                                                   |

## 12. Actual P6-01 operation index

`K` = required Idempotency-Key; `R` = required If-Match;
`P` = required X-Invitation-Proof. Mutations also require trusted browser Origin.
Success codes come from the generated contract; do not assume query-like POST is 200.

| Method | Actual path                                                     | operationId                                           | Required K/R/P | Success |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------- | -------------- | ------- |
| GET    | `/api/v1/social/privacy`                                        | `socialgetsocialprivacy`                              | —              | 200     |
| PATCH  | `/api/v1/social/privacy`                                        | `socialpatchsocialprivacy`                            | K, R           | 200     |
| POST   | `/api/v1/social/discovery`                                      | `socialpostsocialdiscovery`                           | —              | 201     |
| GET    | `/api/v1/social/connections`                                    | `socialgetsocialconnections`                          | —              | 200     |
| POST   | `/api/v1/social/connections`                                    | `socialpostsocialconnections`                         | K              | 201     |
| POST   | `/api/v1/social/connections/{id}/{action}`                      | `socialpostsocialconnectionsidaction`                 | K, R           | 201     |
| GET    | `/api/v1/social/blocks`                                         | `socialgetsocialblocks`                               | —              | 200     |
| POST   | `/api/v1/social/blocks`                                         | `socialpostsocialblocks`                              | K, R           | 201     |
| POST   | `/api/v1/social/blocks/{id}/unblock`                            | `socialpostsocialblocksidunblock`                     | K, R           | 201     |
| POST   | `/api/v1/social/restore-replay`                                 | `socialpostsocialrestorereplay`                       | —              | 201     |
| GET    | `/api/v1/social/circles`                                        | `socialgetsocialcircles`                              | —              | 200     |
| POST   | `/api/v1/social/circles`                                        | `socialpostsocialcircles`                             | K              | 201     |
| GET    | `/api/v1/social/circles/{id}`                                   | `socialgetsocialcirclesid`                            | —              | 200     |
| PATCH  | `/api/v1/social/circles/{id}`                                   | `socialpatchsocialcirclesid`                          | K, R           | 200     |
| DELETE | `/api/v1/social/circles/{id}`                                   | `socialdeletesocialcirclesid`                         | K, R           | 200     |
| GET    | `/api/v1/social/circles/{id}/members`                           | `socialgetsocialcirclesidmembers`                     | —              | 200     |
| PUT    | `/api/v1/social/circles/{id}/members/{connectionId}`            | `socialputsocialcirclesidmembersconnectionId`         | K, R           | 200     |
| DELETE | `/api/v1/social/circles/{id}/members/{connectionId}`            | `socialdeletesocialcirclesidmembersconnectionId`      | K, R           | 200     |
| POST   | `/api/v1/social-groups`                                         | `socialpostsocialgroups`                              | K              | 201     |
| GET    | `/api/v1/social-groups`                                         | `socialgetsocialgroups`                               | —              | 200     |
| GET    | `/api/v1/social-groups/discover`                                | `socialgetsocialgroupsdiscover`                       | —              | 200     |
| GET    | `/api/v1/social-groups/{id}`                                    | `socialgetsocialgroupsid`                             | —              | 200     |
| PATCH  | `/api/v1/social-groups/{id}`                                    | `socialpatchsocialgroupsid`                           | R              | 200     |
| GET    | `/api/v1/social-groups/{id}/memberships`                        | `socialgetsocialgroupsidmemberships`                  | —              | 200     |
| PATCH  | `/api/v1/social-groups/{id}/memberships/{accessId}`             | `socialpatchsocialgroupsidmembershipsaccessId`        | R              | 200     |
| POST   | `/api/v1/social-groups/{id}/invitations`                        | `socialpostsocialgroupsidinvitations`                 | K              | 201     |
| GET    | `/api/v1/social-groups/{id}/invitations/{offerId}`              | `socialgetsocialgroupsidinvitationsofferId`           | —              | 200     |
| POST   | `/api/v1/social-groups/{id}/invitations/{offerId}/revoke`       | `socialpostsocialgroupsidinvitationsofferIdrevoke`    | R              | 201     |
| POST   | `/api/v1/social-groups/{id}/join-requests`                      | `socialpostsocialgroupsidjoinrequests`                | K              | 201     |
| GET    | `/api/v1/social-groups/{id}/join-requests`                      | `socialgetsocialgroupsidjoinrequests`                 | —              | 200     |
| POST   | `/api/v1/social-groups/{id}/join-requests/{requestId}/{action}` | `socialpostsocialgroupsidjoinrequestsrequestIdaction` | R              | 201     |
| POST   | `/api/v1/social-groups/{id}/leave`                              | `socialpostsocialgroupsidleave`                       | R              | 201     |
| POST   | `/api/v1/social-groups/{id}/handovers`                          | `socialpostsocialgroupsidhandovers`                   | K              | 201     |
| GET    | `/api/v1/social-groups/{id}/handovers/{handoverId}`             | `socialgetsocialgroupsidhandovershandoverId`          | —              | 200     |
| POST   | `/api/v1/social-groups/{id}/handovers/{handoverId}/decline`     | `socialpostsocialgroupsidhandovershandoverIddecline`  | R              | 201     |
| POST   | `/api/v1/social-groups/{id}/handovers/{handoverId}/revoke`      | `socialpostsocialgroupsidhandovershandoverIdrevoke`   | R              | 201     |
| POST   | `/api/v1/social-groups/{id}/handovers/{handoverId}/accept`      | `socialpostsocialgroupsidhandovershandoverIdaccept`   | R              | 201     |
| GET    | `/api/v1/social-group-invitations/preview`                      | `socialgetsocialgroupinvitationspreview`              | P              | 200     |
| POST   | `/api/v1/social-group-invitations/{id}/accept`                  | `socialpostsocialgroupinvitationsidaccept`            | R, P           | 201     |
| POST   | `/api/v1/social-group-invitations/{id}/decline`                 | `socialpostsocialgroupinvitationsiddecline`           | R, P           | 201     |

Canonical OpenAPI SHA-256: `c9bf9ec01cbfdeed4183c7e963c4ab4fc6d09e0f3bddab4c3b12f1582d8d200e`.
