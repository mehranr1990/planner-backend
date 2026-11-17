# 0059: Local Company development retention

Status: **Owner-approved**, 2026-11-17, by explicit approval to copy the documented
Project/Team settings into a separate COMPANY policy for local integration tests.

Use immutable version `mp-local-company-v1-20261117`, for synthetic local
`mehran_dev` data only. Recovery is 2,592,000 seconds (30 days). Additional
post-closure retention is zero seconds for work content, comments/history,
files/derivatives and exports; access/audit lifecycle is 63,072,000 seconds
(2 × 365 days). All classes use PURGE, audience OWNER/ADMIN and export authority
OWNER. No holds or obligations are asserted. Existing safeguards remain binding;
whole-Space disposal waits through the longest class window and recovery.

This is development configuration approval, not legal review, regulatory approval,
production policy activation or approval of the proposed seven-year finance rule.
Existing production Company policy review remains outstanding.

Provision separately from the general catalog, using insert-only dry-run,
idempotency and conflict checks. Require the existing explicit Shared local test
mode, which validates development, loopback binding/auth/CORS and PostgreSQL
`mehran_dev` without URL options. Never copy this development database or policy
into production. No migration, cleanup execution or application authorization
change is required. Preserve signed controls, audits, authentication, tenant
isolation and local test-mode file restrictions under ADR 0057.
