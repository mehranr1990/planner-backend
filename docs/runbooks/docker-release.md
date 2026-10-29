# Mandatory future Docker deployment gate — DEFERRED

Docker files are portable deployment preparation, not a requirement to develop
or complete the approved local Phase 0 scope. No Docker commands were run for this implementation.
Do not interpret static source review or passing local tests as Docker evidence.

Before Docker release, an operator must verify the following on the chosen host:

- Resolve the pinned Node/PostgreSQL image tags and review image vulnerabilities;
  pin digests for the actual release artifacts.
- Build the multi-stage API image and verify non-root execution, shutdown,
  read-only root filesystem, health checks, resource limits and bounded logs.
- Provision a separate secure deployment environment from `.env.compose.example`.
  DOCKER_DATABASE_URL must target the `postgres` service and agree with its
  provisioned role/database/password. Use URL-safe credentials or percent-encode
  the connection string. Changing initialization environment does not change
  credentials in an existing PostgreSQL data volume.
- Start the Compose stack and confirm `/health/live` and `/health/ready`.
- Confirm PostgreSQL has no published host port, uses the internal network and
  persists through container recreation. Verify persistence using a dedicated
  disposable verification database; never use destructive volume commands.
- Test API unhealthy/readiness behavior during DB downtime and graceful recovery.
- Apply reviewed migrations through a controlled one-off deployment step once
  migrations exist. API startup must never mutate schemas.
- Configure external HTTPS reverse proxy, host firewall, securely provisioned
  secrets, disk-capacity alerts and restart policies. API port binds loopback.
- Complete encrypted off-host backup/restore drills, monitoring and operational
  SMTP setup at their applicable release gates. Follow the coordinated
  [database/file backup and restore drill](./backup-restore.md).
- Verify private_files is mounted only into the API, owned by the non-root API
  user and never mapped through the reverse proxy or a static web server.
- With disposable verification users/files, complete upload/download/delete,
  signature expiry/renewal, foreign-owner denial and corrupted-content rejection.
  Recreate only the API container and confirm identical size/hash/readability.
  Confirm the dedicated file volume is retained. Never remove existing volumes.
- Confirm Linux permissions, hard-link publication, directory fsync, request
  timeout/body limits, actual proxy session/CSRF/rate behavior and disk alerts.
  See [private file operations](./private-files.md). These checks remain DEFERRED
  until run on the real deployment topology.

P1-10 Compose adds a separate `worker` using the API image and PostgreSQL-backed
pg-boss; no extra broker/container is required. Apply reviewed Prisma migrations
and the exact one-off queue setup before worker start. The runtime cannot install
or upgrade either schema. Verify real worker shutdown/restart, missed-work sweep,
quiet-hour delays, channel consent and privacy, live SMTP/browser Push delivery,
no resend after uncertain acceptance, queue retention, registry/readiness and
database downtime recovery before release. See [notification operations](notifications.md).
All Docker and live external-channel checks remain DEFERRED. This is not a
production-ready release until the applicable deployment gates pass.
