# Private files — local operation and future deployment

P0-04 provides platform storage, not task/note attachments or business features.
No worker, queue, S3/R2 provider, public static mount or anonymous download exists.
Only StoragePort touches bytes. PostgreSQL owns status, scope and file evidence.

## Protocol

All operations require the authoritative verified Better Auth session. Mutations
also require an exact trusted Origin. Client owner/space/object-key fields are
rejected. Scope comes from the spaces public facade; foreign and missing IDs use
the same safe 404. The database additionally enforces the space/owner composite FK.

1. `POST /api/v1/files/uploads` with JSON filename, mimeType, expectedSize and
   optional lowercase SHA-256 `sha256`. Returns 201 owned metadata with INITIATED
   state and upload expiry. Filename is display metadata, never a disk path.
   Optional Idempotency-Key uses P0-03's actor/scope/operation/fingerprint receipt;
   matching retries return the same currently authorized resource, changed input
   conflicts. The response contains neither physical paths nor object keys.
2. `POST /api/v1/files/{id}/complete` with Content-Type application/octet-stream
   and the actual streamed bytes. No multipart, external URL, object key or caller
   assertion of actual size/hash is accepted. Content-Length, when present, must
   agree with initiation. Chunked streams are independently counted and capped.
   Invalid size/type/hash rejects the file and cleans staging bytes.
3. READY completion returns a short-lived relative download URL. `GET` that URL
   requires both its signature/expiry and a current verified owner session. A
   copied link never grants another user or an anonymous caller access. Signature
   binds actor, space, file and expiry; auth-secret rotation invalidates links.
   To renew/retry an already READY file, POST `{}` as application/json to its
   complete endpoint. This does not replace bytes, increment revision or emit
   duplicate state transitions. Starting an incomplete upload with `{}` conflicts.
4. `DELETE /api/v1/files/{id}` marks it inaccessible before physical deletion;
   returns 204 when current bytes have been removed. Repeat deletion retries
   cleanup safely. A failed filesystem delete returns 503, keeps DELETED metadata
   and blocks downloads. Active local uploads are cancelled and their closure is
   awaited. Durable attempt markers cover an uploader in another process/crash.

Downloads are full streams with verified size/SHA-256, Content-Length,
application/octet-stream, Content-Disposition attachment, nosniff, no-store and
restrictive sandbox CSP. Unicode names use encoded filename*, with a safe ASCII
fallback. Range/inline rendering and unsigned downloads are not exposed. Once a
stream has started, failures close it instead of appending a JSON error. Already
sent bytes cannot be recalled by a concurrent deletion/session revocation; every
new request rechecks authoritative permissions/session and READY status.

## Supported content and limits

The initial allowlist is UTF-8 text/plain, application/pdf, image/png and image/jpeg.
PNG/JPEG/PDF signatures and endings are checked; text validates incremental UTF-8
and rejects binary controls and leading executable HTML/SVG/XML markup. These are
content-type checks, not full document decoding or an antivirus guarantee. No
uploaded format is rendered as active content by the API. Executable/HTML/SVG
filename suffixes, paths, reserved device names and header-control characters are
rejected. Audio/other formats are not implemented ahead of their assigned batch.

| Setting                 | Default                                             | Allowed range/meaning                                   |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| STORAGE_ROOT            | .tools/private-files, resolved from repository root | Private directory; absolute path required in production |
| FILE_MAX_BYTES          | 10485760                                            | 1–104857600 bytes per file                              |
| FILE_UPLOAD_TIMEOUT_MS  | 120000                                              | 1000–300000 ms                                          |
| FILE_UPLOAD_TTL_SECONDS | 3600                                                | 600–86400 seconds to finalize initiation                |
| FILE_LINK_TTL_SECONDS   | 300                                                 | 30–900 seconds                                          |

Local `pnpm dev` and `pnpm start` resolve the same relative root despite different
working directories. Changing STORAGE_ROOT does not migrate files; restore/copy
must be deliberate and verified. Existing .env credentials are not changed.
JSON retains its 128 KiB body cap. Native @nestjs/throttler limits each verified
actor per route: initiation 20/min, completion 10/min, downloads 60/min, deletion
20/min. Forwarded IP/actor headers cannot obtain a new bucket. The in-memory
limiter is for the approved single API process; scale-out needs an explicit
topology decision, not an unapproved Redis dependency. Better Auth's existing
authentication/recovery limiter remains enabled and unchanged.

## Filesystem, concurrency and failure recovery

The adapter accepts only generated UUID keys/attempt IDs in a flat private root.
It rejects root symlinks/junctions, file symlinks, unexpected hardlinks and inode
swaps. Exclusive staging creation prevents overwrites. Streams use bounded
buffers, size/time bounds and incremental hash/text validation. File data is
fsynced before same-volume atomic hard-link publication; the staging name is then
removed. Linux additionally fsyncs directory entries. Node does not expose a
portable Windows directory fsync; local restart tests do not prove power-loss
durability. Do not configure a filesystem lacking required hard-link semantics.

Use a directory writable/readable only by the API identity and explicitly
authorized backup operators. POSIX creation requests 0700/0600. Windows requires
equivalent NTFS ACLs; Node's POSIX mode bits do not prove Windows ACL protection.
Host ACL review and Linux volume ownership are deployment gates. Neither the API
nor reverse proxy serves this directory directly.

The file lifecycle is INITIATED → READY or REJECTED; any owned state can be
cancelled to DELETED. Conditional DB claim/version prevents two completions;
no database transaction is held during network streaming. A committed READY
transition and its success audit share a transaction. On failure the authoritative
non-READY state is decided before removing bytes. A lost COMMIT acknowledgement
must never lead to deletion of a READY file. If DB state is unavailable, retain
private bytes/markers and reconcile later. A missing/corrupt READY blob returns
503 before any content is sent; it is not silently rewritten or deleted.

Crash cases:

- Before publication: attempt metadata and a possible .part remain; never readable.
- Between link/unlink: the exact two-link staging/final pair is safely recoverable.
- After publication, before DB commit: private orphan has a durable pending marker.
- After DB commit, before response: retry completion with `{}` for existing metadata.
- During deletion: DELETED blocks access; repeated deletion/cleanup is idempotent.

FilesService.reconcileIncomplete is the explicit scoped cleanup contract, with
no HTTP endpoint, scheduler or worker. It processes at most 100 rows per call,
only the authorized space, never READY files, and excludes live upload leases.
Expired initiation is rejected; REJECTED/DELETED leftovers are removed through
StoragePort. purgedAt records confirmed cleanup. Failure retains retry evidence.
An initiating actor cannot clean another actor's rows. Scheduled dispatch begins
only when a later approved worker batch requires it; there is no automatic sweep
in Phase 0. Privileged recovery must use reviewed scope/repository/StoragePort
operations; do not delete a directory by user-supplied filename or guessed key.

Before destructive recovery, inspect rows/markers read-only, stop conflicting
writers, back up metadata/bytes consistently and obtain the required operator
approval. Unregistered physical bytes after a mismatched restore must be
quarantined and compared with the backup manifest; never blindly purge them.
Retention/deletion legal policy is separate from temporary upload expiry.

Audit stores only action/outcome, optional actor/resource UUIDs and request/
correlation IDs. It excludes filename, bytes, hash values, object key, path and
signed URL. File operation and denial actions are recorded; a pre-access audit
failure prevents serving bytes. Request/error logs redact file metadata and omit
all raw URLs/bodies. No public audit reader or content-search feature exists.

## Verification and deployment

Unit tests exercise content/filename/signature rules, traversal, links, corruption,
abort and cleanup on temporary directories. PostgreSQL/HTTP integration covers
full lifecycle, API recreation, actor isolation, provider revocation, concurrent
claims/receipts, chunked limits, timeout/cancel, ambiguous commit, cleanup, audit
privacy/failure and actual rate limits. Fixtures clean only their own UUIDs and
freshly-created directories. No existing database or user file is reset/deleted.

compose.yaml mounts private_files only into the non-root API at
/var/lib/mehran/files, with PostgreSQL in its separate private volume. The image
prepares API-owned 0700 storage. Root filesystem remains read-only. These are
portable deployment definitions, not Docker verification.

Docker build, real mounted-volume startup/recreation persistence, Linux permission
and directory-sync behavior, proxy direct-access denial, HTTPS/SMTP and encrypted
off-host coordinated restore remain **DEFERRED** until deployment. See
[backup/restore](./backup-restore.md) and [Docker release](./docker-release.md).
