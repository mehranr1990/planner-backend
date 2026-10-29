# Personal data lifecycle and limited synchronization

ADRs [0022](../adr/0022-personal-sync-subset-and-cursors.md) and
[0023](../adr/0023-private-export-and-account-erasure.md) are owner-approved.
Use the existing API, PostgreSQL, private StoragePort and worker. No client cache,
general offline engine, new queue schema, dependency or worker is introduced.

## Provisioning and access

Build and deploy the reviewed application migrations once. Before the first start
of a **new installation**, run `pnpm personal-data:admin init-control` with the
deployment environment. Never initialize over restored or missing historical
evidence. `ERASURE_CONTROL_ROOT` is a private independent directory outside
`STORAGE_ROOT`; preserve it separately from every database/planner-file restore.
Use restrictive NTFS ACLs locally and a separately mounted protected volume at
deployment. Preserve the verification secret used by the version-1 HMAC domains
through the evidence lifetime; losing/changing it fails closed. Secret recovery
material must not be stored inside the planner backup it authenticates.

Readiness returns 503 and private requests/ordinary workers remain closed if the
current control checkpoint, restored ownership state or private-file inventory
cannot be verified. Liveness remains independent. Inspect safe job IDs, states,
attempt counts and failure codes; never print proofs, private paths or contents.

`PERSONAL_ERASURE_POLICY_VERSION` must name the deployment owner's approved
personal-data retention policy. Leave it unset until that review. Requests also
require explicit no-retention-hold acknowledgement. This is personal tracking,
not an assertion of exemption from any jurisdiction's financial retention laws.
Changing/disabling policy blocks destructive processing with `BLOCKED_POLICY`.

## Sync clients

Fetch `/sync/status` for epoch and supported types. Push at most 50 independent
strict operations, each with stable UUID mutation identity and base revision.
Replay returns the original disposition without repeating source effects. Use a
stable clientEntryId for append-only Habit logs. Receipts retain minimal dedup
evidence for the account lifetime; private response bodies expire after 30 days.
Stale text returns both versions; merge explicitly using a fresh mutation UUID
and current revision. Never blindly retry with an overwritten base revision.

Pull at most 100 items per page and persist its signed cursor. Bootstrap pages
retain their initial committed watermark; continue incremental reads from it.
Payloads are current authorized state, not historical snapshots: apply newer
resource revisions, including tombstones/restores. On `RESYNC_REQUIRED`, clear
only this supported cache and bootstrap again. Thirty-day feed trimming cannot
make an old mutation execute again. Revoked/closed access cannot sync.

Task recurrence, Calendar, Goal/Habit definitions, timers, Journal/Mood, binary
files and financial posting stay online. EXPENSE Capture drafts may sync; posting
uses the existing online atomic conversion. No temporary-ID dependency graph.

## Private exports

POST `/me/export` with fresh password and Idempotency-Key; poll `/me/exports/{id}`.
Only one queued/running job is allowed. Worker processing captures a repeatable-read
snapshot through owner facades and bounded keyset queries. Limits are 100,000
records and 50MiB encoded JSON; exceeding either fails explicitly. Retained source
history and exact monetary strings are included; credentials, push secrets,
physical keys and queue internals are excluded.

Download within 24 hours using both active session and the response's 10-minute
`X-Export-Proof`. READY attachment manifest entries contain authorized relative
routes; use the same proof/session to stream actual checksum-verified file bytes.
There is no ZIP, public URL or copied/pinned attachment. Missing/corrupt READY
files fail construction; subsequent deletion returns attachment unavailable.
Retries use separate immutable attempt identities; the durable `artifactKeys`
array stores alternating retired object/attempt UUID pairs for restart cleanup.
Five failed attempts stop processing. Expired bytes are removed; terminal export
metadata expires after 30 days. Operator retries require review of the safe job
failure and current access state; never manufacture a READY result.

## Closure, cancellation and erasure

Request deletion with current settings revision, fresh password, approved policy
version, acknowledgement and Idempotency-Key. Keep the returned confirmation and
recovery capabilities private. The request expires after 30 minutes; confirmation
proof expires after 10 minutes. Explicit confirmation closes the Space under the
same mutation fence, revokes sessions, cancels export access and suspends pending
deliveries/rewards. It does not erase sources or bytes during seven-day grace.

After revocation use only job ID plus `X-Deletion-Recovery` for safe status and
cancellation. Cancellation also requires the current Better Auth password. It wins
only before the deadline while WAITING; no normal session/access is restored before
successful cancellation. Revoked sessions remain invalid; sign in normally after
success. Destructive processing cannot be canceled.

After grace the worker records signed erasure intent, removes owned files in
batches of 25 with durable UUID progress, then invokes owning purge facades in
dependency order. Relational purge, Space/settings removal and identity removal
commit together. File failures retry without advancing past missing work; unknown
foreign references fail safely. Erasure evidence retains only keyed identity/Space
digests, job state/times and progress counts for 90 days. Live purge completion and
the backup-expiry deadline are separate facts. The deadline is null until live
erasure finishes, then equals completion plus the maximum 30-day backup lifetime;
grace-period confirmation is not a claim that later backups already expired.

## Backup expiry and restore replay

Follow [coordinated backup](./backup-restore.md), including quiescing **API and
worker**, encrypting DB/files and verifying an off-host destination. Before release
configure and prove physical expiry within 30 days. Never extend retention or
automatically delete the last verified backup: obtain a compliant replacement
before expiry, otherwise block production release and report compliance failure.

With the compiled application and deployment environment:

1. `pnpm personal-data:admin sign-backup <artifact-directory> <manifest-file> <database.dump.age> <private-files.tar.age>`
2. Preserve the signed manifest and protected recovery keys. Restore validation
   rejects unsigned/expired manifests and mismatched encrypted artifact hashes.
3. `pnpm personal-data:admin verify-backup <manifest-file> <artifact-directory>`
4. Restore only to an isolated target using the reviewed backup procedure; keep
   the **current independent erasure namespace**, never the older planner copy.
5. `pnpm personal-data:admin restore-replay <manifest-file> <artifact-directory>`
   reapplies subsequent closure/erasure through the same scoped owners. It does
   not restore/reset databases itself. An incomplete bounded pass exits safely;
   rerun to resume. Unknown files or invalid evidence keep the target quarantined.
6. Expose normal private access only after replay verifies current identity state
   and file absence. Verify health, authorization and owner-only download again.

Local integration tests restore a real earlier fixture identity/Task/file snapshot
while retaining current erasure control, prove access denial and replay complete
purge. Docker, actual encrypted off-host restore and physical expiry drills remain
mandatory deployment gates, not claimed local results.
