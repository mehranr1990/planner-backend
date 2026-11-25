# Owner approval records: Shared activation (2026-11-20)

Status: **CONFIRMED by the owner on 2026-11-20T12:12:58Z** (explicit confirmation in the
engineering session). These are internal, jurisdiction-neutral product
approvals; they are not external legal approvals.

Scope (all records): the current private Docker deployment of Mehran Planner and
production-readiness preparation.

## MP-SSA-2026-11-20-001: Shared Security Acceptance

- Accepts, for the scope above, the Shared-space security controls as
  implemented: kernel authorization and custody (ADRs 0024–0031), Shared API
  rate limits (0058), ClamAV scan-once (0068), signed Shared control checkpoint
  and restore-replay protection, trusted-proxy client-IP handling, and the
  unified 7-day recovery (0069).
- Does not enable ADR 0057 local test mode and does not bypass any gate.
- Configured as `SHARED_SECURITY_ACCEPTANCE_REFERENCE=MP-SSA-2026-11-20-001`.
- Accountable: Mehran Planner Product Owner.

## MP-RET-V2-2026-11-20-001: Retention Catalog v2.0

- Approves `mp-rpc-v2.0-work`, `-conversation`, `-meeting` and `-social-group`
  as defined in docs/retention-policy-catalog-v2.md §2 (7-day recovery; class
  retention unchanged), plus the final Company policy and durations confirmed
  in the Company section below.
- Seed values: `--approval-reference=MP-RET-V2-2026-11-20-001`
  `--accountable-operator="Mehran Planner Product Owner"`.

## personal-erasure-v1.0: Personal Erasure Policy

- 7-day deletion grace; explicit retention-hold acknowledgement; signed backup
  manifests expire within 30 days; minimal erasure evidence retained; Personal
  finance is personal tracking, not a claim of exemption from any law.
- Configured as `PERSONAL_ERASURE_POLICY_VERSION=personal-erasure-v1.0`
  (also baked into the web build).

## Company policy `mp-rpc-v2.0-company` (part of MP-RET-V2-2026-11-20-001)

- Recovery: 7 days after Company closure.
- Owner decision (2026-11-20T12:12:58Z): Company data, finance records, projects, teams and
  ordinary operational audit history are purged after the 7-day recovery, with
  no additional multi-year retention (all class windows 0, PURGE).
- Kept only: minimal security/erasure evidence, and records under an active
  hold or other non-overridable retention requirement (holds/obligations block
  disposal until released with evidence).
- Only data exclusively owned by the deleted Company is purged; independently
  owned or shared records are detached, never deleted.
- Unchanged protections: sealed employee files (OD-8/C9), finance immutability
  and audit trails while the Company is active, legal holds/obligations block
  disposal until released with evidence, Company restore needs its reviewed
  domain reconciliation gate.

## Confirmation

| Record                                | Confirmed by                 | Timestamp (UTC)      |
| ------------------------------------- | ---------------------------- | -------------------- |
| MP-SSA-2026-11-20-001                 | Mehran Planner Product Owner | 2026-11-20T12:12:58Z |
| MP-RET-V2-2026-11-20-001              | Mehran Planner Product Owner | 2026-11-20T12:12:58Z |
| personal-erasure-v1.0                 | Mehran Planner Product Owner | 2026-11-20T12:12:58Z |
| mp-rpc-v2.0-company durations (all 0) | Mehran Planner Product Owner | 2026-11-20T12:12:58Z |
