# 0023: Private exports, account closure and erasure recovery

Status: APPROVED revised proposal by owner for P1-12, 2026-10-29.

## Decision needed

P1-12 requires complete private exports, reauthentication/staged deletion, a defined
grace/retention policy, revocation and restart-safe cleanup. Section 10.4 explicitly
reserves retention numbers to the owner. No irreversible erasure behavior is
implemented before approval. Existing domain history policies continue until an
explicit confirmed account-erasure workflow authorizes their removal.

## Proposed export contract

- POST /me/export requires a verified active owner, recent provider-backed password
  reauthentication and Idempotency-Key. Store only UserExportJob as the new export
  entity. One queued/running export per owner; bounded processing through the
  existing worker and PostgreSQL-authoritative retry/lease state.
- Export versioned private JSON containing profile/preferences, all owned planner
  aggregates and retained versions/history, finance decimal strings/currencies,
  planning/calendar context, reward history and attachment metadata/checksums.
  Include archived/soft-deleted retained records. Explicitly exclude passwords,
  auth accounts/sessions/verification tokens, Push credentials, server secrets,
  physical object paths and queue internals. Binary files are represented by the
  required attachment manifest, not copied into an invented ZIP/archive format.
- Owners expose scoped portability facades with explicit whitelists. Capture data
  from one repeatable-read snapshot; no cross-owner ORM enumeration. Limit an export
  to 100000 records and 50MiB encoded JSON. Oversized exports fail explicitly without
  silently dropping records. Publish only complete checksum-verified artifacts.
- Use the existing private StoragePort for generated JSON; any internal JSON byte
  validation extension does not expand generic upload MIME contracts or StoredFile
  CHECKs. UserExportJob owns its artifact key/hash/size. GET /me/exports/{id} reports
  status; a nested download route requires both an active authenticated owner and
  a signed, job/owner-bound token carried in a redacted header, valid for 10 minutes.
  Artifact lifetime is 24 hours from completion. Expired/closed-account requests
  cannot download. Verify checksum/length while opening; corruption fails safely.
- Actual attachment bytes remain available separately: each READY manifest entry
  contains its file UUID, recorded size/SHA-256/MIME and an authenticated relative
  attachment-download route under the export job. That route requires an active
  owner session, unexpired READY export, signed export proof and membership in that
  job's manifest. Storage owns the stream and verifies the live immutable blob
  against the manifest. No object keys, public links, ZIP generation, new storage
  service or binary copying are introduced. Existing per-file size limits apply;
  the 50MiB limit remains the encoded JSON limit. A READY blob missing/corrupt during
  export construction fails the job. If the owner subsequently deletes it, the
  export route returns an explicit unavailable result, never different bytes or
  a fabricated successful attachment download. The export does not pin deleted
  source files or override existing file-deletion semantics.
- Retry interrupted export/cleanup in bounded batches, five attempts with backoff.
  Never expose partial files. Retain terminal job metadata for 30 days and remove
  expired artifacts through the storage abstraction. Audit IDs/status/counts only.

## Proposed deletion and retention contract

- Store only AccountDeletionJob as the new deletion entity, with durable typed
  stages, lease/retry/progress and narrowly scoped confirmation/recovery proofs.
  Do not alter Better Auth-owned fields or implement new credentials/crypto.
- Request requires verified session, current account revision, Idempotency-Key and
  fresh password verification using Better Auth. A REQUESTED job expires after
  30 minutes. Its random confirmation proof is valid for 10 minutes and is stored
  hashed. Confirmation is a distinct explicit action under /me/deletion-request.
  Duplicate confirmation safely returns the original job's nonprivate status even
  after session revocation, using only its scoped proof; it grants no data access.
- Confirmation atomically closes Personal Space access under the mutation fence,
  invalidates export downloads, disables pending personal deliveries/rewards and
  revokes all sessions through the identity owner. New sign-in/session creation
  and private APIs are blocked. No planner writes may commit after that closure.
  Already-authorized network responses/external sends cannot be recalled.
- Use a seven-day grace period before destructive work. During grace, allow only
  scoped deletion status/cancellation with the original high-entropy recovery
  proof; cancellation additionally requires fresh provider password verification.
  It restores access but never resurrects revoked sessions. Existing credential
  recovery may remain available without granting planner/session access. After
  destructive processing starts, cancellation is rejected. No private rows or
  attachment bytes are destroyed during grace.
- Exact revoked-session flow: REQUEST returns a separate 256-bit random recovery
  capability, stored only as a hash. After CONFIRM, ordinary session/sign-in and
  planner access stay blocked. A narrowly scoped deletion status/cancel endpoint
  accepts job ID plus that capability in a redacted header; it does not use an
  obsolete session as authentication or issue a replacement session. Status returns
  only job state/deadlines/safe failure code. Cancellation additionally verifies
  the current password through Better Auth's password verifier for the identity
  already identified by the valid capability; no password hashes enter domain
  modules and no custom password crypto is used. Verify proof before identity
  lookup, rate-limit attempts and use safe generic failures. Under the same fence,
  cancellation wins only while WAITING and before the seven-day deadline; it
  atomically marks CANCELED and reopens access. Failure leaves access closed.
  The user must then sign in normally; revoked sessions remain invalid. A worker
  claim for destructive processing and cancellation cannot both succeed.
- After grace, the existing worker clears private export artifacts and owned file
  bytes, then invokes owner-controlled purge commands in an explicit dependency
  order. Domain owners resolve their own links/cycles inside the authorized purge
  transaction. Remove only the closed owner's Space data and finally the identity
  through the identity owner. Never delete by creator alone or touch another Space.
  A foreign-reference integrity failure leaves the job safely failed/visible;
  it does not authorize deletion of someone else's content.
- File cleanup is idempotent and restartable: persist owned object identities and
  progress before deleting, retain metadata until physical removal succeeds, and
  resume after a crash. In-flight workers recheck active access; queued opaque IDs
  cannot recreate erased sources. Reuse existing orphan-cleanup support in bounded
  worker passes. No additional worker process or vendor queue-schema changes.
- Financial-retention assumption: this policy covers privately entered personal
  tracking data, not a regulated custodian, employer ledger or tax-record service.
  It does not assert that financial records are legally exempt from retention in
  any jurisdiction. Destructive processing requires a deployment-owner-approved
  personal-data erasure policy and the requester's explicit no-retention-hold
  acknowledgement, retained in the job's policy version. If policy is unset,
  disabled or a retention obligation is identified before destructive work, the
  job is BLOCKED_POLICY and no bytes/rows are erased. Recheck immediately before
  destructive work. A different required retention rule needs a further owner
  decision; no hidden legal-hold subsystem or invented statutory period is added.
- Remove/anonymize identifying audit references and private receipts during purge.
  Retain only minimal pseudonymous erasure evidence (job/status/times/counts and
  keyed identity/Space digests) for 90 days; no email, names, text, credentials or
  financial values. Erasure evidence has no dangling identity FK. No other normal
  planner history purge is added.
- Backup expiry is a hard 30-day maximum in a signed backup manifest: capturedAt,
  expiresAt, artifact checksums and erasure-checkpoint digest. Restore validation
  rejects expired, unsigned, missing or inconsistent manifests. Physical off-host
  expiry must be configured and verified on the actual backup target before
  deployment is accepted; local backend work cannot claim to have deleted copies
  on an unprovisioned target. Keep the existing rule against automatically deleting
  the last verified backup: a fresh compliant replacement is required before its
  expiry. If that cannot be met, report retention compliance failed and block
  production release rather than silently extending retention or claiming erasure.
- Before live destruction, publish signed minimal erasure intent/receipts through
  the existing private storage adapter into a protected control namespace that is
  preserved independently of the database/planner-file restore target. It uses no
  new service, worker, business entity or dependency. A restore must not overwrite
  that current control namespace with an older backup. On startup, verify the
  signed current checkpoint against restored AccountDeletionJob/access state;
  missing/mismatched control evidence keeps private APIs and ordinary workers
  quarantined. An explicit bounded restore-replay command reapplies later closed/
  erased identities through the same owner purge commands, verifies file absence
  and only then seals a current checkpoint and permits normal access. Invalid
  signatures, incomplete replay or unknown target paths fail closed. Preserve
  versioned verification keys for the evidence lifetime through existing secret
  provisioning. Local tests simulate an older isolated snapshot and prove it cannot
  serve private data before replay; actual encrypted off-host/Docker restore drills
  remain deferred deployment gates. Report live erasure and the backup-expiry
  deadline separately; do not claim all backup copies vanished at live purge time.

## Verification and alternatives

Test export isolation/completeness/history, exact money, snapshot consistency,
limits, expiry/corruption, password/proof denial, duplicate requests, closure/write
races, revoked sessions, canceled grace, no premature destruction, foreign data
preservation, every purge dependency, file/DB interruption and actual API/worker
restart recovery. All earlier migrations/contracts and mandatory quality gates stay.

No immediate deletion on request, silent ledger retention, public download links,
auth schema rewrite, general administrator module, external storage/broker or new
dependency. Typed jobs and the existing worker provide the required lifecycle.

Owner approval: Explicit approval of the revised proposal in the P1-12 session.
