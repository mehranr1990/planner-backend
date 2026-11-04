# Mehran Backend — Decision Freeze, Reconciliation, and Defect Ledger (2026-10-30)

## Audit basis and honesty boundary
This audit uses the decisions in the active conversation, source architecture notes in the provided files, and the successive Markdown handoff packages. It does **not** assert inspection of a live Git checkout, PostgreSQL schema, running API, infrastructure, commercial/legal jurisdiction or independent test runs. Product design acceptance != executable ADR acceptance != runtime verification != commercial launch approval. No backend application source or migrations were edited as part of this review.

## Precedence for conflicting texts
1. Most recent **explicit user decision or correction** in this conversation, then earlier user choices (retaining non-conflicting clauses).
2. Approved in-repository ADR/AGENTS/implementation contracts **for actual present code**, provided they do not silently override the user's new desired product requirements; conflicts must be surfaced as change requests.
3. Current reviewed package product registry; architecture notes are advisory unless ratified by the user.
4. Earlier assistant summaries/proposed prompts and generic industry defaults — never elevate an inference to APPROVED.
No blanket statement that all engineering details are 'closed'. Unchosen retention days, legal regimes, SLO targets, exact schema and real provider dependencies remain OPEN.

## Confirmed, not to be re-asked
| ID | Frozen product/architecture decision | Boundary |
|---|---|---|
| FR-01 | Phase order P2 Project, P3 independent Team, P4 Company, P5 Communication/Meetings, P6 Social, P7 Admin/Commercial | Never build real Company relationship before P4 |
| FR-02 | Preserve Personal phase data; typed Shared Custody Kernel and separate Project/Team/Company/Group domains | Actual Prisma shape pending repo audit |
| FR-03 | Verified identity + per-context membership, fixed roles/capabilities/narrow grants; default deny; transactional revocation fencing | No anonymous writing; invite preview only |
| FR-04 | Administrative succession: add verified member -> assign/propose owner -> accept + reauth -> durable handover/audit -> old owner can leave | No copying owned resources into successor Personal space; shared/data transfer separate |
| FR-05 | Personal erasure and exit separate from shared custody; prevent last-custodian orphan, preserve lawful shared records pseudonymized when required | Do not indefinitely deny privacy rights; actual retention jurisdiction OPEN |
| FR-06 | Unified Task/Goal with authorized My Tasks/Calendar projections; accepted assignment shows in My Calendar; TimeBlock configurable opt-in | No silent personal copy or private Focus leakage |
| FR-07 | Company cost/approval/reimbursement separate from personal ledger; social splitting is another domain with approval-first effective revision | No automatic real-money transfer, payroll or full ledger |
| FR-08 | DM/private group/work channel chat; DM-only block does not automatically hide common-group messages; PostgreSQL durable + REST history + WebSocket; short 2min/10MB voice; no live calls | Exact transport topology/protocol OPEN TECH |
| FR-09 | Edit authored message <=48h; after 48h ordinary deletion affects sender view only; deleted-account pseudonymized thread retained where appropriate | **APPROVED:** within first 48h, author delete-for-everyone is allowed in DM and private groups; in work channels it is governed by the authorized organization/channel policy. After 48h ordinary author deletion is self-only. |
| FR-10 | Private/group history from join by default; workplace history controlled by policy; category-specific retention | Concrete retention periods and legal floors OPEN |
| FR-11 | P6 independent/group Activities; guest must be verified; social expense proposal by participant only effective on authorized approval, revision retains old effective record pending approval | Financial exactness and concurrent states need tests |
| FR-12 | Lost and Found: user can post missing item, another user can report possession; acknowledgement/dispute/return; no penalties automatically | Distinct from lending request |
| FR-13 | Album with private visibility, optimized image/thumbnails; **20MB original image initial cap**, adjustable allowed product quota in admin subject to independent hard security ceiling | No assumption unlimited config or storage allocation |
| FR-14 | All shipped product features free now; no paywall; eventual admin-defined plan/feature/quotas/tier fixed workspace fee + seat cap; safety limits remain active | Two personally owned projects is *future candidate*, not enforced |
| FR-15 | Frontend developed separately via actual validated OpenAPI, backend ahead asynchronously | This package excludes frontend design/coding |
| FR-16 | Staff corrective actions confidential by default, limited reviewed disclosure, evidence and appeal; no automated monetary penalties | Local employment-law review before rollout |
| FR-17 | All Project views, Risk/Issue, custom fields, dependency types, versioned workflow, secure CSV import | Feature must map to API/test per batch |
| FR-18 | Private personal Finance/Journal/Mood/Focus not exposed by workplace aggregates | Restricted metrics only |

## Resolved document defects — changed in this V2 package
| Defect | Previous condition | V2 action | Actual technical verification |
|---|---|---|---|
| DF-01 Company before Company | P3-01 company-attached and P3-05 team transfer | P3 only independent Team; Company association in P4-06 after P4-01 | NOT DONE |
| DF-02 Ambiguous P2 owners | P2 prompt appeared to require working Team/Company Projects | P2 independent; typed future contract only | NOT DONE |
| DF-03 Unsupported 48h inference | One spec called delete-for-everyone within 48h owner-approved | Owner selected A: DM/private-group author delete-for-everyone <=48h; work channels policy-controlled; afterward self-only | CLOSED — product policy; implementation proof pending P5 |
| DF-04 Handoff incomplete reads | Prompt listed only 00–06 despite later audit files | Enforced 00–12 and package precedence | Agent must prove files read |
| DF-05 Product doc presented as executable | High-level prose could be mistaken for full production schema | Executable contract template + acceptance gates in 11/12 | NOT DONE |
| DF-06 Lack of cross-phase dependency proof | Team/Project transfer insufficiently ordered | Hard phase activation table in 12 | NOT DONE |
| DF-07 Premature production confidence | Quality counts are historical agent reports | Runtime evidence inventory and clear NO-GO rubric in 11/12 | NOT DONE |

## Unresolved decisions: ask owner only if truly necessary
- **CLOSED OWNER POLICY — P5**: Author delete-for-everyone is permitted within the first 48h for DM and private groups; workplace channels follow authorized organization/channel policy. After 48h ordinary author deletion is self-only. Retention, moderation, legal holds and exact policy representation remain engineering/compliance work, not a new owner-choice question.
- **OWNER TARGET — before production deployment**: target jurisdiction/service market (for compliant retention/privacy review), initial estimated scale and acceptable availability/recovery objectives; product baseline need not be reopened to create a measured engineering proposal.
- **TECHNICAL — Codex repository audit**: exact schemas/indexes/cascades, proper lock order, transactional invariant, API endpoint names, existing migration hashes, actual Auth MFA support, media formats, retention implementation and infrastructure costs. Agent proposes and validates, owner approves ADR for irreversible changes.
- **COMMERCIAL — later**: concrete paid launch date/prices/seats/taxes/provider; explicitly not approved and not necessary for current free backend.

## Evidence states
APPROVED_POLICY means decision recorded; PROPOSED_DESIGN is a design option; CODE_IMPLEMENTED must link exact repository commit and tests; VERIFIED_PRODUCTION requires actual deployed environment observations. Neither this package nor any planning tool may promote one state to another without evidence.
