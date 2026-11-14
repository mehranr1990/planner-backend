# Frontend security, private files and account lifecycle

Implemented baseline: finished P1-12. Follow the [guide](./FRONTEND_INTEGRATION_GUIDE.md)
and exact [OpenAPI schemas](./openapi.json); no public file URL, bearer auth scheme,
ZIP exporter, shared Space or cross-user permission API exists.

## Session and private state

Use HttpOnly cookies with credentialed requests and the configured trusted Origin.
Do not store provider session tokens, passwords, reset/verification tokens or export/
deletion proofs in localStorage, URLs, analytics events or application logs. Treat
provider tokens exposed in session-management responses as sensitive in-memory
protocol values. Never let XSS-safe rendering depend only on server validation;
escape titles and sanitize rendered Markdown/links using the frontend's reviewed
renderer. Do not use raw HTML insertion for Note/Task/Journal content.

On logout, revocation or account closure: stop requests/retries/sync, cancel timers
used only for presentation, clear private memory and persisted account caches,
revoke object URLs and remove sensitive previews. A running server Focus session
does not automatically stop when a browser closes or logs out. A backend Push
subscription also persists until explicitly revoked or provider expiry.

Journal, Mood and Finance are owner-private. Generic personal search excludes
Journal/Mood unless opted in per request; Finance is not a personal text-search
provider. Insights overview needs includeFinance=true to include Finance;
Journal/Mood analytics are unsupported. Opting into search does not consent to
analytics, external Push payloads, telemetry or browser persistence.

## Private upload and download

Generic file routes support text/plain, application/pdf, image/png and image/jpeg:

1. POST `/api/v1/files/uploads` with filename, mimeType, expectedSize and optional
   lowercase SHA-256. Optional Idempotency-Key supports exact initiation replay.
   Do not send owner, Space, physical key/path, external URL or multipart metadata.
2. POST raw file bytes to `/api/v1/files/{id}/complete` with
   `Content-Type: application/octet-stream` and cookies. Browser fetch determines
   Content-Length where applicable; bytes are still counted/validated server-side.
   JSON's 128KiB limit is not the binary upload limit. Default file size is 10MiB,
   constrained by server FILE_MAX_BYTES (contract upper bound 100MiB), default upload
   deadline 120 seconds and initiation expiry one hour.
3. READY returns metadata and a relative download.url containing expires/signature.
   Fetch that exact URL with credentials; it is signed for the current owner, Space,
   file and expiry and still requires a live verified session. Do not recompute the
   signature, strip query parameters, expose it publicly or substitute an S3 URL.
4. To renew an owned READY URL, POST `{}` as application/json to the same complete
   endpoint. This does not upload/replace bytes. An unfinished file cannot be
   finalized by asserting success with `{}`.
5. Bind a READY ID through the relevant supported owner route, such as PUT
   `/api/v1/tasks/{taskId}/attachments/{fileId}` with Task If-Match. File access and
   attachment association are distinct; unbinding does not implicitly erase bytes.
6. DELETE `/api/v1/files/{id}` explicitly removes access/bytes and returns 204.
   A storage cleanup failure may return 503 while access remains closed; retry the
   same deletion safely. Never interpret a failed download as authorization to
   fall back to another user's ID or a physical file path.

Downloads use attachment Content-Disposition and no-store/nosniff protections;
range requests and inline rendering are not exposed. Default signed URL lifetime
is 300 seconds (server configurable 30–900). A copied link cannot authorize an
anonymous or foreign user. Stream/hash failures can terminate a response after
headers; do not treat a partial Blob as a successful download. Use credentials in
a fetch-to-Blob flow when opening links from a cross-origin frontend, and revoke
the temporary object URL afterward.

Dedicated voice routes are `/api/v1/files/voice/uploads`,
`/api/v1/files/voice/{id}/complete`, `/download` and DELETE that voice ID. Initiation
requires Idempotency-Key. Only canonical **16-bit PCM WAV**, mono/stereo, 8–96kHz,
correct RIFF structure/length/alignment and at most 10MiB (or a lower configured
limit) is accepted. Generic file routes do not accept voice IDs. Browser-default
WebM/Opus is not accepted: a voice frontend must already produce the supported WAV
format. No server transcoding, transcription or audio streaming service exists.

Sources: [file schemas](../../packages/api-contracts/src/files.ts),
[voice schemas](../../packages/api-contracts/src/voice-files.ts),
[file controller](../../apps/api/src/platform/storage/files.controller.ts),
[ADRs 0014/0015](../adr/0015-private-voice-file-compatibility.md).

## Complete private export

POST `/api/v1/me/export` with fresh password and Idempotency-Key. Poll GET
`/api/v1/me/exports/{id}` with the verified session, using restrained backoff;
lifecycle routes are rate-limited to ten requests/minute per route/tracker.
QUEUED/RUNNING are not downloadable; FAILED exposes only a safe failure code.
The worker must run. One active export per owner is allowed.

READY supplies downloadProof, expiresAt, size and sha256. GET
`/api/v1/me/exports/{id}/download` with cookies and `X-Export-Proof`, not a query
token. Proof lasts at most ten minutes, artifact twenty-four hours. Get fresh
status for a fresh proof while the artifact remains available. Expired, closed,
foreign, corrupt and incomplete artifacts must not be represented as successful.

The JSON contains all owned aggregates/retained history and exact money, plus an
attachment manifest; it is not a ZIP and excludes credentials/push secrets/private
storage paths. Limits are 100,000 records and 50MiB encoded JSON; oversize fails
explicitly rather than silently omitting data. READY manifest entries provide
authenticated relative routes under `/me/exports/{id}/attachments/{fileId}`.
Use the same session/proof to fetch actual checksum-verified attachment bytes.
A subsequently deleted attachment returns unavailable; export does not pin it.
Treat downloaded JSON and files as highly sensitive user-managed data.

The published lifecycle OpenAPI responses use a generic binary
`application/octet-stream` schema. Runtime serves the account JSON artifact as
`application/json` and manifest attachments using their recorded MIME. Consume
these download operations as a stream/Blob, then parse only the known JSON
artifact. The handoff does not invent an undocumented generated DTO for export
contents; aligning these media declarations is a source-generator follow-up.

Finance's separate GET `/api/v1/finance/export?format=json|csv` is a filtered report
stream, not an account-wide export job. Use its authorized date/currency/account
filters and media type; do not add its results to different currencies as one sum.

## Staged deletion and recovery after session revocation

1. GET `/api/v1/me/settings` and retain its ETag. Its JSON does **not** contain a
   revision field; parse the valid quoted positive ETag into accountRevision for
   the deletion request. The backend operator must have configured the approved
   PERSONAL_ERASURE_POLICY_VERSION; this is not a user-selected arbitrary policy.
2. POST `/api/v1/me/deletion-request` with password, accountRevision,
   retentionAcknowledged:true and the configured policyVersion, plus Idempotency-Key.
   The acknowledgement concerns personal-record retention obligations; do not hide
   or pre-consent it. A pending request alone does not erase anything.
3. Securely present the returned job UUID, confirmationProof, recoveryCapability
   and confirmationExpiresAt. Before confirmation, let the user retain a private
   recovery copy for later use. There is no endpoint that retrieves a lost recovery
   capability after sessions have been revoked. Avoid ordinary browser token storage.
4. On a distinct explicit confirmation, POST `/api/v1/me/deletion-request/confirm`
   with `{jobId,revision}` and `X-Deletion-Proof`; initial confirmation also needs
   the verified session. Confirmation proof lasts ten minutes; the pending request
   expires after thirty minutes. Keep the same job/proof for a lost-response retry.
5. Confirmation closes access, invalidates exports and revokes every session.
   Clear all normal private UI/cache and do not create a replacement session.
   WAITING lasts seven days until the server's eraseAfter; no personal source/file
   destruction occurs during grace. Normal sign-in remains blocked.
6. Without an active session, GET `/api/v1/me/deletion-request?jobId=...` with
   `X-Deletion-Recovery` for safe status. To cancel before the deadline, POST
   `/api/v1/me/deletion-request/cancel` with `{jobId,password}` and that recovery
   header. The current Better Auth password and original capability are both
   required. Credential recovery can change a forgotten password without reopening
   normal planner access; then use that current password for cancellation.
7. Only successful WAITING cancellation reopens access. Old sessions remain
   revoked: require normal sign-in afterward. Once destructive processing starts,
   cancellation is rejected. Handle BLOCKED_POLICY/FAILED as safe visible states,
   not an instruction to bypass acknowledgement, grace or proofs.

Post-grace cleanup is worker-driven and restartable. Erasure removes identity and
live personal files/data; minimal pseudonymous evidence lasts 90 days and backup
retention is separate. The reported backup-expiry deadline is null until live
erasure completes, then completion plus at most thirty days. Proofs are removed
at erasure; do not promise a permanent public job-tracking link afterward.
Missing restore evidence quarantines private APIs/workers until operator replay.
Actual off-host expiry is a deployment gate, not something a frontend can prove.

Source: [lifecycle schemas](../../packages/api-contracts/src/lifecycle.ts),
[controller](../../apps/api/src/modules/account/http/lifecycle.controller.ts),
[approved ADR 0023](../adr/0023-private-export-and-account-erasure.md).

## Browser Push and notification permissions

GET `/api/v1/notifications/preferences` for availableChannels and webPushPublicKey.
If WEB_PUSH/key is unavailable, show a configuration/unavailable state rather
than invent a VAPID-key endpoint. Production Push is disabled by default and
requires backend provisioning plus user channel consent.

In the frontend's own secure-context service worker flow, ask browser permission
only after user action and obtain a PushManager subscription with the returned
public key. POST `/api/v1/push/subscriptions` with endpoint, keys.auth,
keys.p256dh and optional label, using cookies/Idempotency-Key. Browser JSON keys
must match the documented base64url format. Then explicitly PATCH notification
preferences webPush:true with its revision/key. Browser permission alone is not
backend opt-in, and backend opt-in alone is not browser permission.

GET the subscription list for safe ID/revision/host/state. Responses deliberately
omit endpoint/key secrets. PATCH `/{id}` rotates using the full subscription
schema and If-Match/key; DELETE `/{id}` explicitly revokes with its revision/key.
If the user chooses to stop device notifications on logout, revoke while still
authenticated before signing out, and unsubscribe in the browser. Ordinary logout
by itself does not revoke a separately opted-in subscription.

Permission denied, unavailable service worker, rejected provider host/material,
stale subscription, 404/410 provider expiry and disabled server channels need
separate UI states. External payloads are generic; open an authorized application
view and refetch source data after a click. Do not append private Task/Journal/
Mood/Finance content to Push bodies or notification URLs.

Source: [notification schemas](../../packages/api-contracts/src/notifications.ts),
[notifications controller](../../apps/api/src/modules/notifications/http/notifications.controller.ts),
[ADR 0018](../adr/0018-reminder-timing-delivery-and-privacy.md).
