# Mehran Planner — Backend Master Handoff (decision baseline, 2026-10-30)

## Purpose and authority
This is a **planning and agent-instruction package**, NOT a claim that the repository has been modified, that future ADRs have been ratified, or that any future APIs exist. It consolidates the product choices explicitly made by the owner in the conversation for Phases 0–7. The implementation agent must inspect the actual repository and binding `AGENTS.md`, `PROJECT_INSTRUCTIONS.md`, `PHASE_0_1_IMPLEMENTATION.md`, migration history, existing ADRs, OpenAPI and source code before modifying anything. If the package conflicts with binding existing code/ADR invariants, STOP, document the conflict and propose an additive, owner-reviewed ADR. No silent reinterpretation.

## Current evidence (reported by Codex, not independently re-verified here)
- Phase 0 P0-01..04 locally complete: foundation, Better Auth/Personal Space, audit/outbox/idempotency, private storage.
- Phase 1 P1-01..12 locally complete: 765 passing tests in 76 files; 13/13 quality gates; `pnpm smoke:p1-12` passed including restart/replay/erasure. 24/24 application migration checksums matched; existing pg-boss schema hash preserved.
- P1-11 was pushed at `e906bea18105bdb9882c25d6c2b1380df3ef0967`. A subsequently reviewed future-architecture document cites P1 baseline `6a9ccdb81e8c3b4842f1d7ea63c3531a6abbd2bb`; verify live `git log`, branch, remote status and what that hash represents. Do not assert unverified push status.
- Phase 0/1 does NOT demonstrate production readiness. Docker/Compose startup, backup/restore and replay protection in real infrastructure, SMTP/Push delivery, host CI/secrets, security and deployment gates remain.
- Phase 2–7 are **approved at product-feature level only**, not implemented or given finalized schema/endpoint ADRs. All future ADRs are proposals pending review.
- Frontend is owned by another agent. Do not change frontend, create UI, or assume frontend integration is finished. Preserve/generate validated OpenAPI contracts as a backend deliverable.

## Approved roadmap
Phase 2: Projects & required Shared Access kernel
Phase 3: Teams & collaboration
Phase 4: Companies & organizational management
Phase 5: Text Messaging, recorded voice messages & Meetings (no live voice/video calls, no v1 E2EE)
Phase 6: Social Connections, Groups, Activities and split expenses
Phase 7: Platform Admin, Entitlements, Quotas, Feature Flags and Commercial Control Plane
Real paid checkout/billing activation: a separately approved *post-Phase-7 commercial launch gate*. Every shipped capability remains free/no paywall until explicit owner activation. Social Phase 6 is not interleaved with Phases 3–5.

## Technology baseline to verify
Node 24.22.1 pinned; NestJS 12 modular monolith; Prisma 7.10.x; PostgreSQL 18.6; Better Auth 1.7.x; Zod 4.6.x; Vitest; pg-boss worker; private StoragePort; SMTP adapter; OpenAPI; TypeScript. Self-hosted Docker Compose later. Avoid introducing microservices/Redis/new message brokers/search clusters without demonstrated need and owner ADR. Database names in past local environment: `mehran_dev` / `mehran_test`.

## Package contents
- `01_MASTER_FEATURE_REGISTRY.md`: approved features, phase allocation, status and boundaries.
- `02_ARCHITECTURE_AND_ADR_REGISTER.md`: required design decisions, invariants, alternatives and critical gates.
- `03_PHASE_2_TO_7_BACKEND_SPEC.md`: backend domain/API behavior, data boundaries and acceptance criteria by phase.
- `04_CROSS_CUTTING_POLICIES.md`: identity, retention, finance, files, chat, lifecycle, quotas, regionalization and security.
- `05_BATCH_ROADMAP_AND_QUALITY.md`: proposed implementation slices, release/quality gates and dependencies.
- `06_CODEX_PROMPTS.md`: copy-paste agent prompts: repository preflight and ADR, then individual phase planning/implementation instructions, then closure.

## Source of truth and change control
1. User-confirmed decisions in this package are binding **product requirements**; proposed relational schemas, endpoint shapes, stage names, defaults not expressly approved are **design proposals**.
2. Never modify historical application migration bytes or pinned pg-boss schema; additive migration and migration-from-previous-release tests.
3. Implement in small approved batches, targeted tests during work, one full 13-stage `pnpm quality` at the end of each batch and compiled restart smoke. No extra full-suite loops without a reason.
4. Never automatically start the next batch, commit/push, or activate paid limits without owner authorization. Prior instructions may explicitly authorize finalize-then-next; confirm scope for each turn.
5. No backend code changes were performed when producing this package.

## Cross-chat audit clarification (2026-10-30)
This reviewed edition is reconciled against the owner's choices recorded in the conversation, not independently against a live Git checkout. References to "locally complete", migration counts, hashes and test totals are **reported evidence**, not independently re-executed verification. This is a **backend planning handoff**, not an implementation-complete, repository-ratified or deployment-ready spec. See `07_CHAT_DECISION_AUDIT.md` for traceability, ambiguities and blockers.
