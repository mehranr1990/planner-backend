# Frontend integration checklist

Backend baseline: `6a9ccdb81e8c3b4842f1d7ea63c3531a6abbd2bb`. This is a handoff,
not a claim that a frontend or the following frontend tests have been implemented.
The backend's accepted evidence is 13/13 quality stages, 765 tests/76 files,
compiled restart/replay/live test-data erasure smoke and 24 matching migrations.
That evidence was reused during finalization; no full suite was rerun for docs.

## Configuration and contract

| Setting / prerequisite                           | Owner / exposure                                           | Required check                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Frontend API origin (e.g. http://localhost:3000) | Frontend public configuration; name chosen by that project | Paths already include /api/v1; use consistent hostname and credentials:include            |
| HOST / PORT / BETTER_AUTH_URL                    | Backend; API origin is public                              | BETTER_AUTH_URL is the canonical origin, no path/trailing slash                           |
| CORS_ORIGINS                                     | Backend                                                    | Exact frontend origin, credentialed CORS/preflight and trusted mutation Origin            |
| DATABASE_URL / BETTER_AUTH_SECRET                | Backend secrets only                                       | Never bundle or place in frontend environment/public logs                                 |
| MAIL_MODE / SMTP_* / MAIL_FROM                   | Backend; SMTP credentials secret                           | Private local sink or tested production SMTP; no public sink endpoint                     |
| STORAGE_ROOT / ERASURE_CONTROL_ROOT              | Backend private storage                                    | Independent protected erasure evidence initialized only under the runbook                 |
| PERSONAL_ERASURE_POLICY_VERSION                  | Backend operator-approved value                            | Agreed policy supplied in deletion UI; unset/changed policy blocks erasure                |
| JOBS_SCHEMA / worker                             | Backend operational                                        | Reviewed pg-boss setup, worker running for reminders/rewards/exports/erasure              |
| PUSH_MODE / VAPID settings                       | Backend; only API-returned public key is frontend-safe     | Consent, supported provider, service worker and secure context; private key never exposed |
| FILE_* limits                                    | Backend                                                    | Honor schema and deployment cap; generic and WAV flows separate                           |

- [ ] Consume [openapi.json](./openapi.json), OpenAPI 3.1.0, 293 operations/189 paths.
- [ ] Use [module reference](./API_MODULE_REFERENCE.md) for the exact route-to-screen
      map and request/response JSON Pointers; no guessed CRUD/action endpoints.
- [ ] Generate types in the frontend's own approved tooling; no Prisma models or
      backend dependency/runtime changes.
- [ ] Preserve the handoff JSON byte-for-byte for the agreed release; backend
      `pnpm openapi:check` and previous compatibility signatures remain mandatory.
- [ ] Use the normalized handoff for strict type generation: six recursive refs
      in raw canonical sync schemas need a separately approved generator fix.
      See the [exact packaging note](./FRONTEND_INTEGRATION_GUIDE.md#openapi-packaging-normalization).
- [ ] Confirm Swagger UI and HTTP OpenAPI JSON are **not configured**; use the file.
- [ ] Distinguish 204, streamed content, provider redirects and JSON errors.

## Module-by-module integration

| Suggested screen/feature | Backend surface                                                                                | Frontend acceptance                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Auth/security/profile    | /auth/*, /me, /me/settings, /me/spaces                                                         | Verification, cookie restoration, password/email recovery, fresh-session actions, settings ETag    |
| Task list/detail/trash   | /tasks, nested checklist/subtasks/labels/attachments/history; /labels                          | Correct parent revisions, state transitions, restore window, safe attachment links                 |
| Task tools               | /task-recurrences, /task-occurrences, /task-templates, /saved-task-filters, /tasks/bulk        | Separate identities, explicit catch-up/series scopes, template copies and partial bulk results     |
| My Day/week/review       | /planning/days, /weeks, /reviews, /rollover/_, /capacity_                                      | Explicit plan creation, ordering, saved context, suggestion-first rollover and unknown capacity    |
| Calendar                 | /calendar/events, /time-blocks, /views, /conflicts                                             | Exclusive all-day end, DST, virtual occurrence keys, advisory conflicts and safe Task links        |
| Habits/routines/water    | /habits, nested schedules/entries/stats, /routines, /habits/water-summary                      | Quantity/duration units, skip/pause/archive, correction history and range streaks                  |
| Goals/life areas         | /goals, nested milestones/metrics/links/progress/reviews; /life-areas                          | Goal/source revisions, exact weights, explicit snapshots and lifecycle                             |
| Focus/time               | /focus/sessions, /time-entries, /productivity/summary, /tasks/{id}/productivity                | Server elapsed time, one reserved timer, explicit finish/stop, immutable tracked entries           |
| Notes/folders            | /notes, /notes/folders, /history                                                               | Safe Markdown, state changes, references, position and retained versions                           |
| Private Journal/Mood     | /journal/entries, /daily-checkins, /moods, histories                                           | Date attribution, 1–5 scales, no generic cache/analytics leakage                                   |
| Inbox/capture/search     | /capture, /capture/parse, /triage, /search/personal                                            | Preview then user acceptance, atomic conversion, explicit sensitive search flags                   |
| Finance                  | /finance/accounts/categories/transactions/transfers/budgets/bills/savings-goals/reports/export | Decimal strings, recorded-rate FX, reversal/correction, period context and explicit draft posting  |
| Notifications/Push       | /reminders, /notifications, /push/subscriptions                                                | Consent/availability, read/dismiss/snooze, delivery states and explicit device revocation          |
| Analytics/rewards        | /insights/_, /rewards/_                                                                        | Canonical denominators/periods, Finance opt-in, no Mood/Journal analytics, optional prospective XP |
| Offline status/conflicts | /sync/status, /pull, /push                                                                     | Approved subset only, stable op IDs/epoch, per-item results, tombstones and safe resync            |
| Private files/voice      | /files/_, dedicated /files/voice/_                                                             | Initiate/raw complete, signed authenticated refresh/download and actual supported WAV              |
| Export/account deletion  | /me/export, /me/exports/*, /me/deletion-request family                                         | Password/proofs, real attachments, revoked-session recovery, explicit cancellation and expiry      |

Full methods and concrete path parameters for every row are indexed in
[API_MODULE_REFERENCE.md](./API_MODULE_REFERENCE.md).

## Critical frontend/backend scenarios to execute in the consuming project

- [ ] Registration → verify → login → reload session → logout; rejected origin,
      missing credentials, reset/email-change links and revoked-session recovery.
- [ ] Two tabs edit one Task/Note: 409 preserves the local draft, refetch uses the
      correct ETag, and an explicit merge does not silently overwrite server text.
- [ ] Lost network response: exact body/key replay creates no duplicate Task,
      finance posting, template application, triage or export job.
- [ ] Nested foreign IDs cannot bind files/Tasks/Goals/Habits; search/filter/counts
      and export downloads cannot reveal a second user's data.
- [ ] My Day/TimeBlock select existing Tasks; completion/deletion reflects source
      disposition without duplicating or silently rescheduling Tasks.
- [ ] DST gap/fold, local midnight, date-only fields, Jalali presentation, week-start
      changes and recurring Feb 29/month-end display match saved server context.
- [ ] Habit corrections/skip/pause and Goal weighted progress use exact server
      results; Focus refresh after browser/API restart preserves running/paused state.
- [ ] Finance money remains exact (including large values and IRR/JPY/KWD/four-digit
      scales); reversal/transfer fees and multiple currencies are not double-counted.
- [ ] Journal/Mood/Finance never enter generic telemetry, persisted query caches,
      private-unconsented search/analytics or external notification payloads.
- [ ] Actual binary upload, timeout/cancel/retry, expired/foreign/corrupt downloads,
      private export manifest attachment bytes and WAV rejection are handled.
- [ ] Browser Push permission and backend consent are independent; device revoke
      precedes logout when selected, and unavailable channels show a safe state.
- [ ] Offline two-client race, replay, entry ID dedup, epoch/cursor loss, empty pages
      with cursors, tombstone/restore and account switch clear the correct subset.
- [ ] Deletion preserves a private recovery capability before confirmation; normal
      access stays closed after revocation, cancellation needs fresh password, old
      sessions stay invalid and post-grace erasure is not presented as backup expiry.

## Limitations and readiness

No backend runtime blocker was found for normal same-site browser integration.
A strict SDK consuming raw canonical OpenAPI encounters six unresolved recursive
refs; this handoff fixes their document locations without changing schema meaning.
The source generator correction remains follow-up work requiring authorization.
A fully unrelated cross-site deployment cannot be assumed to work with current
SameSite=Lax cookies; agree hosting/proxy topology before deployment. Voice capture
requires canonical WAV generation in the frontend; default WebM/Opus is unsupported.
Worker/channel/control/policy configuration are required operational prerequisites,
not frontend workarounds or additional endpoints. Internal diagnostic labels are
not reliable top-level HTTP codes; use status plus typed result data.

No Swagger UI/runtime JSON endpoint, native calls, full E2EE, shared Spaces, Chat,
Social Groups or general offline engine exists. Future architecture documents are
unapproved proposals. Docker/volume persistence, production HTTPS/ACL/secrets/proxy
IP behavior, external SMTP/Push, encrypted off-host restore and physical 30-day
backup expiry remain deferred production gates. No frontend tests, new dependency,
schema/runtime change or new document commit/push is part of this handoff.
