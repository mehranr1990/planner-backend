# 0007: Local Windows development and Vitest

Status: Approved by owner, 2026-10-27.

The owner approved local Windows development with Node.js 24 LTS through NVM,
local PostgreSQL, pnpm, NestJS directly on Node.js, Prisma, and Vitest + Supertest.
Docker Compose remains the future single-server deployment target. Docker and
WSL are not local prerequisites and must not be installed or invoked for this
P0-01 task. Docker build, startup, and named-volume persistence checks are
DEFERRED and remain mandatory before Docker release.

Vitest is the only unit/integration test runner. The starter lint tooling is
reconciled with ESLint flat config, typescript-eslint and Prettier. The approved
structured Pino logging and health architecture replaces the starter telemetry
integration. AGENTS.md is the canonical agent entry point; all unique rules in
the reviewed legacy agent file were merged before its removal.

Scope remains P0-01. No auth/account/ownership implementation, business tables,
database resets, commits, pushes, or subsequent batches are authorized.

Verification: run applicable local quality gates; use an explicit loopback test
database whose name ends in `_test`. Docker checks must be reported as DEFERRED.

Supersedes only the local environment and test-runner portions of prior policy;
future Docker deployment and other architecture decisions remain binding.
