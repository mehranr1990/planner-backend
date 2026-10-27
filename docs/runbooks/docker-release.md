# Mandatory future Docker deployment gate — DEFERRED

Docker files are portable deployment preparation, not a requirement to develop
or complete local P0-01. No Docker commands were run for this implementation.
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
  SMTP setup at their applicable release gates. File-volume verification belongs
  to P0-04; the current image has no file storage API or mount.

Compose provides `api` and `postgres` only. No worker, queue service, reverse
proxy package, auth initialization, or business schema is prebuilt. This is not
a production-ready release until the applicable deployment gates pass.
