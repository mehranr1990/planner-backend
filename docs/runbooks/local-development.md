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
integration success. Integration tests are read-only: SELECT 1 and HTTP health
checks, including a connection failure against loopback port 1. They never stop
the local PostgreSQL service or reset a database.

P0-01 has no models or migrations. Prisma Client is generated without creating
a dummy model; no schema push or migration reset is used. Migration-from-empty
and upgrade verification begins with actual P0-02 schemas and P0-03 safety work.
Production schema changes must be reviewed and deployed as a one-off operation,
not on API startup.

Missing/invalid config yields a clear safe startup error naming keys only.
Readiness 503 means PostgreSQL is unavailable or credentials/database are wrong;
verify the local service and ignored configuration without posting credentials
in logs/chat. Pino logs are newline JSON on stdout; collect them with the process
supervisor chosen for future deployment.
