# Coordinated PostgreSQL and private-file backup / restore

P1-12 amendment: stop both API and worker during a coordinated backup. The approved
30-day maximum, signed manifest and independent erasure replay requirements are
defined in [personal data lifecycle](./personal-data-lifecycle.md); they supersede
the older unconfigured retention references below. Actual off-host expiry and
Docker restore verification remain deferred deployment gates.

Status: operational definition for P0-04. Actual host, encrypted off-host
destination, retention, recovery objectives and production credentials are owner
configuration. No production or Docker backup/restore drill has run locally.
The deployment drill remains mandatory before release.

## Consistency and prerequisites

PostgreSQL and file bytes form one recoverable unit. A database-only dump, a blob
copy without matching metadata, or another volume on the same host is not a
complete disaster-recovery backup. READY rows identify immutable blobs with size
and SHA-256; attempt markers identify incomplete work. DELETED/REJECTED rows can
have pending cleanup. Include the database migration ledger, auth/session data,
file root, manifest and separately protected required secrets/configuration.

Approve the environment/target, encrypted destination outside the server's failure
domain, access policy, retention, RPO/RTO, disk budget and restore location. Never
invent retention or use development credentials for production. Review the release
image/migration revision and verify the PostgreSQL client version. Restrict dump,
manifest and encryption-key access; they contain sensitive account/private data.
Do not print connection strings, passwords, user filenames or tokens in logs.

Use an explicitly quiesced backup for the single-host baseline:

1. Enter the approved maintenance window. Stop accepting mutations and drain/stop
   the API, including upload/download streams. No current worker exists; include
   all future writers when introduced. A live database snapshot alone does not
   freeze filesystem publication/cleanup, so copying both while writers continue
   is not the baseline consistency method.
2. Verify no application writer remains. Create a PostgreSQL custom-format dump
   with the matched pg_dump client and controlled secret provisioning. Capture
   migration checksums/version and backup ID; do not pass credentials in command
   arguments or expose PostgreSQL to a public port to simplify backup.
3. Copy/snapshot the complete private file root while writers remain stopped.
   Preserve ownership/permissions and symlink protections. Do not move/delete
   source volumes. Record a manifest binding backup ID, app revision, migration
   history, file IDs/object keys/statuses and READY sizes/checksums. Treat the
   manifest as private; it is not an application event/log payload.
4. Verify every READY row has its expected bytes/hash and classify pending attempts
   and DELETED/REJECTED leftovers. A mismatch fails the backup; do not automatically
   change production rows or delete unknown files. Investigate using recovery
   evidence and take another coordinated backup if necessary.
5. Encrypt the dump/files/manifest using the approved operational encryption
   mechanism; keep recovery keys separately protected. Transfer to the approved
   off-host destination and verify transfer checksums/decryptability. A local
   staging copy alone does not count as backup completion.
6. Resume the unchanged API/configuration, verify health and owner-only download
   smoke, then record sanitized backup ID/result/times/size and alert on failure.
   Apply owner-approved retention only after successful verified copies. Never
   automatically delete the last known good backup.

Deployment may use approved infrastructure snapshots with equivalent cross-store
consistency, but changing this baseline requires evidence and review. No new
storage provider, paid service, database engine or background infrastructure is
introduced by this runbook.

## Restore drill — isolated target only

1. Explicitly identify and approve a fresh isolated restore database and private
   directory/volume. Verify resolved targets are not production, development or
   another user's files. No reset/drop/overwrite of an existing database/volume
   is authorized by this document. Provision the target separately.
2. Decrypt/authenticate the coordinated backup and verify its manifest/checksums
   before restoration. Restore the database into the empty target and restore
   the matching file bytes to its dedicated private root with API ownership.
   Use the matching app/migration revision first; do not run schema push/reset.
3. Compare migration history/checksums and every READY size/hash. Confirm no
   public/static path can expose the mounted bytes. Quarantine unregistered bytes;
   do not silently discard them. Incomplete/rejected/deleted markers must remain
   inaccessible and be handled through reviewed scoped reconciliation.
4. Boot the matching app against only that isolated database/root. Revalidate
   health, sign-in/verification/revocation where applicable, owner download,
   foreign-user denial, signed-link expiry/renewal, completion/delete retry and
   file survival across API recreation. If secrets rotate, existing signed links
   expire intentionally; renewal still requires a valid owner session. Decide
   separately whether sessions must be revoked for an incident restore.
5. In Docker, verify named-volume ownership, non-root access, directory fsync,
   read-only root filesystem and reverse-proxy denial. Review host firewall,
   HTTPS, secrets and database private network. A local temporary-directory test
   cannot substitute for this deployment topology drill.
6. Measure actual data loss/restore time against the approved RPO/RTO. Record
   sanitized evidence, mismatches and corrective actions. Owner approval is
   required before switching traffic or retiring prior data. Clean only the
   explicitly disposable restore fixtures after their review/approval.

## Capacity and operational alerts

Monitor free bytes/inodes on PostgreSQL and private-file volumes, growth trend,
upload failure/503 rate, stale attempt count, failed cleanup markers, backup age,
backup integrity/transfer failures and restore-drill age. Establish host-specific
warning/critical thresholds and notification ownership before deployment. Stop new
uploads deliberately when capacity is unsafe; never fix pressure by guessing which
private files to delete. Configured per-file bounds and per-actor rate limits do
not replace a deployment capacity budget or host disk alerts.

Collect only redacted Pino/health/status evidence. Investigate ENOSPC/permission
errors through protected operator tooling, not raw HTTP error bodies. Windows
development needs private NTFS ACLs; production needs API-owned private Linux
volumes. Protect temporary dumps and restore scratch space under the same policy.

## Acceptance status

Local P0-04 tests prove file content survives API recreation, state/ownership
constraints, deterministic cleanup, migration replay/upgrades and actual streaming.
They do not claim a PostgreSQL backup restore, Docker volume recreation, off-host
encrypted durability or disaster recovery. Those checks are **DEFERRED / NOT RUN**
until the chosen deployment environment is provisioned and the drill is completed.
