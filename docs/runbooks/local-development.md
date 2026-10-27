# Local Windows development

Use Node 24.22.1 through NVM and pnpm 10.20.0. This repository is native ESM
(`type: module`, TypeScript NodeNext). Build output uses explicit `.js` imports.
Vitest uses Vite 8/Oxc legacy decorators with metadata enabled; a compatibility
test verifies Nest dependency injection from emitted constructor metadata.

If PowerShell blocks a package-manager `.ps1` shim under its execution policy,
use `corepack.cmd` / `pnpm.cmd` for these commands. No execution-policy change is
needed. On this machine the agent used a workspace-local Corepack cache/shims
under ignored `.tools`; they are not repository or deployment dependencies.

Install PostgreSQL locally and provision separate development and test databases
and roles. P0-01 verification provisioned only the missing empty mehran_test
database after the owner configured credentials. It did not install PostgreSQL,
drop/reset any database, change roles, or modify existing data. Bind PostgreSQL to loopback for
local development. No Docker or WSL is needed.

Copy `.env.example` to `.env` and `.env.test.example` to `.env.test.local`, and
replace the placeholder connection strings. These files are ignored. URL-encode
special characters in credentials. Tests never load `.env` and never fall back
to DATABASE_URL. TEST_DATABASE_URL must use localhost/127.0.0.1/::1, no query or
fragment, and a database name ending in `_test`. If DATABASE_URL is also present,
the test database must be different. CI supplies an ephemeral isolated database.

```powershell
nvm install 24.22.1
nvm use 24.22.1
corepack enable
corepack prepare pnpm@10.20.0 --activate
pnpm install --frozen-lockfile
Copy-Item .env.example .env
Copy-Item .env.test.example .env.test.local
# Configure the ignored files with your provisioned local databases first.
pnpm config:check
pnpm db:generate
pnpm db:validate
pnpm build
pnpm db:migrate:deploy
pnpm db:check
pnpm start
```

`pnpm dev` starts Nest watch mode after building transport contracts. Rebuild
the contracts package after changing shared schemas. `pnpm start` runs compiled
code and loads `.env`. Defaults bind the API to 127.0.0.1:3000.

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health/live
Invoke-RestMethod http://127.0.0.1:3000/health/ready
pnpm test:unit
pnpm test:integration
pnpm quality
```

During development run targeted checks; run the full applicable quality gate
once at submission, with focused reruns only after failures or changes. The
quality command records any failure and continues through remaining gates.
Missing TEST_DATABASE_URL is a failing prerequisite, never a silently skipped
integration success. P0-02 integration tests deploy additive migrations and create
isolated fixture identities in the explicitly selected test database. Cleanup
deletes only IDs/emails created by that test run. Health tests also exercise a
connection failure against loopback port 1. Tests never stop PostgreSQL, touch a
production database or reset existing schemas. P0-03's migration gate creates and
resets only its own random disposable namespace inside the guarded test database;
the existing public schema and its data are preserved.

P0-01 had no models. P0-02 adds a single reviewed additive identity/ownership
migration. `pnpm db:migrate:deploy` targets the configured development database;
test setup targets only TEST_DATABASE_URL. P0-03 adds platform audit/outbox/receipt
tables and a revision column on settings, preserving the original auth scalars.
`pnpm db:migrations:check` checks additive SQL, deploy/status, empty-schema replay,
prior-schema upgrade with preserved preferences, and repeat deploy. The harness
requires CREATE SCHEMA permission in the isolated test database. Its reset helper
has no configurable target and accepts only the schema it just created. No schema
push, Prisma migrate reset, existing-schema reset or database reset is used.
Production schema changes must be reviewed and deployed as a one-off operation,
not on API startup.

Missing/invalid config yields a clear safe startup error naming keys only.
Readiness 503 means PostgreSQL is unavailable or credentials/database are wrong;
verify the local service and ignored configuration without posting credentials
in logs/chat. Pino logs are newline JSON on stdout; collect them with the process
supervisor chosen for future deployment.

P0-02 also requires BETTER_AUTH_URL (canonical API origin without a trailing slash)
and a random BETTER_AUTH_SECRET of at least 32 characters in ignored .env. The
implementation ensured local values without replacing any existing settings.
Production additionally requires HTTPS origins and authenticated TLS SMTP.
See [authentication](./authentication.md) for the private development mail sink.

P0-04 stores private blobs through StoragePort, with PostgreSQL metadata. Relative
STORAGE_ROOT (default .tools/private-files) resolves from repository root even
when pnpm dev changes cwd to apps/api. Use private NTFS ACLs; never point a public
web server at this folder. File limits/TTLs are validated and optional in local
.env; production requires an absolute mounted private root. Existing .env values
are preserved. File tests use individual temporary roots with exact fixture
cleanup, never development files. No file volume, DB or existing data is reset.

The third additive migration introduces StoredFile and audit target UUIDs.
The migration gate now verifies prior settings revisions, outbox/audit evidence
and idempotency receipts survive upgrade. Existing applied migrations are unchanged.
See [private files](./private-files.md) for the four-route protocol and explicit
reconciliation contract; no worker/scheduled cleanup is active yet.
