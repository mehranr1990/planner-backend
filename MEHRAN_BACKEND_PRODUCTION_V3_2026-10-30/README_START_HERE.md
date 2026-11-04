# MEHRAN — Backend documentation audit V2 (2026-10-30)

This is the newest documentation-level safety review superseding earlier ZIP bundles. It incorporates explicit decisions in the conversation, corrects repeated and contradictory instructions, and adds executable contract and release proof requirements. **No application code, PostgreSQL migrations, frontend or deployed environments were inspected or modified.**

**Read first:** `10_DECISION_FREEZE_AND_DEFECT_LEDGER.md`, `11_PRODUCTION_ENGINEERING_CONTRACT.md`, `12_COVERAGE_AND_GATES.md`. Then read files `00`–`09` with the V2 corrections. Conflicting text: explicit user decision > frozen decisions in `10` > current package engineering proposal > earlier assistant proposal; in-repo actual schema is a factual constraint and requires a proposed migration, not an invented override. Do not run Phase 2 code until a reviewed repository-only preflight approves G0.

**P5 owner question CLOSED:** author delete-for-everyone allowed within 48h in DM/private groups; work channels organization/channel-policy-controlled; after 48h ordinary delete-for-self only. Do not re-ask.
