# Mehran Planner — Cross-Conversation Package Audit (2026-10-30)

## Audit methodology and verdict
Compared the seven Markdown files in `MEHRAN_BACKEND_PACKAGE_2026-10-30.zip`, the consolidated master handoff, five previously supplied future-architecture documents, and **decisions available in this conversation** (initial product choices; 40 high-level questions; D1–D9; P2-01..12; T3-01..15; C4-01..20; M5-01..20; S6-01..24; A8-01..20; F-01..08; A01..A08; B01..B15; C01..C10; D01..D05). This is a **document/content** audit, **not** a current repository, Git remote, OpenAPI or test execution audit. No evidence supports a guarantee that *every historic wording detail* outside these records has been recovered.

**Outcome:** The first package substantially captures the decisions and has no obvious fundamental roadmap inversion, but it required clarifications to prevent several costly implementation mistakes. Updated documents and this audit replace the first package as the preferred **planning** handoff. No code or repo changed.

## Key findings and corrections
| ID | Severity | Finding | Correction made / remaining gate |
|---|---|---|---|
| AUD-01 | HIGH | "Guest" could be misread as anonymous collaboration, contrary to choice D5 / T3-05 / S6-05. | Explicitly require verified registered account for every write; limited guest **role** does not imply full Team/Company membership. Anonymous preview only safe metadata. |
| AUD-02 | HIGH | P2 Project ownership could be implemented as real Team/Company attached entity before those domains exist in P3/P4. | P2 implements independent projects and typed extension points; actual attachment only when parent domain exists, with migration/contract approval. |
| AUD-03 | HIGH | Merely future-proofing Plan/Quota as a placeholder risks major rewrite, contrary to B15 user clarification. | Add real domain-agnostic feature/usage decision interfaces at owner write boundaries and exact count/ownership semantics in each earlier phase; actual configurable plan UI/engine P7; no paid denies before launch. |
| AUD-04 | HIGH | Account erasure may be inadvertently blocked forever by "last-custodian" restrictions. | Formal succession/shared closure and lawful private-data erasure separated; require ADR resolving deadlocks and restore behavior. |
| AUD-05 | MEDIUM | Expense proposal text referred only to Group members despite S6-07 independent Activities. | Verified authorized Activity participant can submit expense without permanent Group membership. |
| AUD-06 | MEDIUM | Chat 48h edit/delete rule could be implemented with inconsistent delete-for-everyone semantics. | Owner confirmed option A: edit <=48h; author delete-for-everyone <=48h in DM and private groups; work channels governed by authorized organization/channel policy; after 48h delete-for-self only. Moderation and lawful retention are distinct; self-hidden exports/rejoin semantics remain technical design. |
| AUD-07 | MEDIUM | User's Lost & Found request goes beyond loan handover. | Explicit missing/found notices, reciprocal claims, verified confirmation and disputes without prior asset loan. |
| AUD-08 | MEDIUM | Technical file caps vs future Admin-configured commercial quotas might be conflated. | Separate non-bypassable engineering hard caps (security/abuse) from adjustable plan quotas; Admin parameters stay inside bounded policy. |
| AUD-09 | MEDIUM | Auth and locale specifics from earlier project discussion were compressed in original feature registry. | Add mandatory source verification for two-step email change, phone verification not currently implemented, Jalali/Saturday/RTL/digit/Toman-Rial contracts, and early Personal Planner wishes that may be UI/deferred rather than implemented. |
| AUD-10 | MEDIUM | Frontend handoff and Swagger delivery in package was a task, not a verified artifact. | Require exact validated OpenAPI 3 JSON artifact/real endpoints and clear absence/presence of Swagger UI; no invented API and no frontend changes. |
| AUD-11 | LOW | Project takeover wording could imply moving data to a new Personal Space. | Confirm verified successor membership -> acceptance/reauth -> administrative powers -> previous owner exit; project records stay under custodial boundary. |
| AUD-12 | LOW | Phase labels, "approved product" and suggested batch counts might be mistaken for schema/API approval. | Source-of-truth hierarchy, approval gates, provisional batch counts and no implemented future endpoint emphasized. |

## Decision coverage (major groups)
- **D1–D9:** fixed Social phase P6 (after completed P5), typed custody, assignment acceptance, calendar projection, verified invitation, Phase-4 expense, candidate two-owned-project Free tier, all-free now, Backend ahead of independently developed Frontend.
- **P2 (12):** independent/attached project, no nested subprojects, five roles, one primary owner of assignment plus contributors, Pending/Accepted/Declined, versioned workflow, FS/SS/FF/SF, views, eight field types, workload, archive/restore; extra Risks/Issues, CSV, templates and bulk.
- **P3 (15):** independent/company Teams, memberships, limited project exposure, Team Tasks/Goals/Calendar, Sprint optional, portfolio, transparent performance, Recognition/Corrective Actions, managerial visibility and lifecycle.
- **P4 (20):** multi-Company, department structure, six organizational roles, one custody boundary with scoped access, personnel files, visibility-policy tiers, equipment, basic availability, corporate expenses/budgets/approvals/reimbursement, knowledge base and exports. Actual company-Workspace administrative transfer != legal company sale.
- **P5 (20):** independent DM/private group/work channels; voice **recorded** 2min/10MB, not live voice/video; rich text/files; reply/thread/reaction/forward/pin/mention, 48h edit and universal ordinary delete, thereafter hide for self; privacy presence/receipts; meetings and announcements; DM Block doesn't ban common group reading.
- **P6 (24):** verified contact discovery email/optional verified phone; social circles as private labels; approval-only public discoverable groups; independent activities/trips/RSVP/free-busy; social expense propose/approve/split/settle/optional private ledger posting; lending + Lost & Found; album approved **F-01**, 20MB/thumbnail/quota; challenges and exit policies.
- **P7 (20):** separate high-privilege Admin, four admin roles, scoped metadata, plan/feature/entitlement/quota, commercial workspace fixed fee + member cap, grants/trial/promo, safe downgrade, flags/rollout, support and abuse, post-phase-7 separately approved real billing.
- **F-01..08 and A/B/C/D final:** captured by feature registry and policies; specifics with unresolved technical details in architecture ADR register.

## Remaining implementation choices — not product omissions, not permission to guess
1. Exact shared Space subtype schema vs separate boundary; complete FK/cascade and custody migration; full role/capability/action matrix; revocation locking and worker races. **Before P2 code.**
2. Verified identity matching and phone onboarding details; invite expiry, reauthentication window, role grants, guest resource revocation; cross-tenant count/file/search protection. **Before first affected API.**
3. Personal/share lifecycle lawfulness, last-custodian succession deadlock, financial/statutory retention by deployment jurisdiction, shared anonymization, backup replay. **Before shared data.**
4. Exact message retention durations and admin policy limits, WebSocket package/topology, media codecs/processing/scanning, read/delivery semantics. **Before P5 affected batches.**
5. Concrete storage workspace quota and engineering maximums, image optimization, retention for abandoned media; definite production deployment parameters. **Before media launch.**
6. Real pricing, quotas, trial durations, payment provider, billing/tax/refunds; no monetization enabled without owner approval. **Before commercial launch.**
7. Local and remote Git/commit baseline, backend OpenAPI JSON/Swagger paths, actual front API compatibility, integration/production test results. **Verify in repository; cannot be inferred from planning files.**

## What not to silently upgrade to "done"
Phase 0/1 *reported local Backend done* is not production tested or proof frontend integration. AI and Automation remain deferred with permissions/extension boundaries only. External platforms handle live calls. Chat and all shared/team/company/group/admin functions are not implemented merely because they are in a plan. Batches P2–P7 are proposed estimates, not final owner-approved engineering slices. No generic collaborative offline sync is included.

## Handoff instruction
First run CODEX `PROMPT 0` as **documentation-only repository reconciliation** using this reviewed pack; have Codex produce owner-approvable ADRs A01–A08 and verify OpenAPI/Git. Start P2 implementation only after explicit owner acceptance of actual schema/permissions/migration proposals. Documentation can be refined without changing historical production contracts.
