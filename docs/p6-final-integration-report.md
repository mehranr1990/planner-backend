# Phase 6 final Social integration report (2026-11-18)

Scope: owner decisions D1–D7 (ADR 0067). Development only; no production change.

## Backend

- D3 Group ledger actor IDs; D7 Social Group chat over P5 Messaging (migration
  `202611180083_social_group_conversation`); D1 policy `mp-rpc-v1.1-social-group` in the
  catalog; D2 Conversation policy unchanged. OpenAPI 1,300 → 1,303 operations (additive;
  reviewed extension `social-ledger-actor-api-extensions.json`, baseline
  `p6-07-social-group-chat-api-signatures.json`).
- Gate tooling: `auth:schema:check` failed at `33ef598` because P6-04/P6-05 added 16
  relation-only `User` inverse fields without registering them. No column/index drift exists
  (`mehran_dev` "User" matches its only migration). The exact fields are now registered.
- Full gate: config, generate, auth schema, validate, build, typecheck, format, lint,
  architecture, unit/contract/compat (880), OpenAPI, integration 57 files / 1,172 tests
  (two load timeouts in `communication-lifecycle` pass 37/37 in isolation), migration safety.

## Development database (`mehran_dev`)

- Backup `D:\New folder\backups\mehran_dev\mehran_dev_pre-p6-final_20261118.dump`
  (sha256 `ad1b7cb1…e135`), test-restored into a throwaway database with matching counts.
- Pre-checks: 101 applied, 101/101 checksums match, no unresolved failures (two historical
  rolled-back attempts were re-applied in October). Live schema vs datamodel: 288 non-Social
  statements identical to a pristine migration replay; remaining lines were exactly the pending
  migrations.
- Applied `077`–`083` with `pnpm db:migrate:deploy`. After: 108/108, checksums match, schema
  identical to a pristine replay. Catalog seeded with the existing tool (dry run, then apply):
  only `mp-rpc-v1.1-social-group` inserted; others UNCHANGED; Company not seeded.

## Runtime and live verification

- `pnpm start` / `pnpm worker`: live/ready 200 (database up); worker ready; pg-boss schema
  `planner_jobs` v46 with planner queues. Shared Local Development Test Mode enabled.
- Live API smoke (synthetic accounts, real API + `mehran_dev`): 103/103 — catalog, Groups,
  invitations accept/decline, roles, Group chat (concurrent open, join-time history, departure,
  re-admission, removal, deletion, recovery without resurrection), Activities (independent,
  Group-linked, waitlist/offer, checklist → task, poll counts, Activity chat), Group and
  Activity ledgers (actor IDs, exact split, approval, settlement, privacy), lending, Lost &
  Found claim, goals/challenges, notices, exit-check, delete and recovery.

## Residual synthetic fixtures (not removed)

Accounts `p6final-*@example.test` and `p6final-fe-*@example.test` and their synthetic Groups.
Their random passwords were not retained, so supported deletion (password-confirmed) is not
possible; no database-level removal was performed. All are synthetic and Development-only.
