# 0038: Company knowledge, reports and authorized exports

Status: **APPROVED by the owner for local P4-05 implementation, 2026-11-07**.
Scope: local P4-05 only; no Shared activation, deployment or P4-06 execution.

## Binding scope and missing decision

The [V3 batch roadmap](../../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/05_BATCH_ROADMAP_AND_QUALITY.md)
assigns P4-05 **knowledge base files/versioning, Company reports, permitted
portfolio and authorized export/audit**. The
[Phase 4 specification](../../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/03_PHASE_2_TO_7_BACKEND_SPEC.md)
requires private folders, file versions/search, permitted KPI/capacity/expense/
budget reporting, scoped exports and audit. P4-06 separately owns independent
Team/Project attachment/transfer, handover and full Company lifecycle.

[ADR 0034](0034-company-foundation-roles-and-inheritance.md) authorizes metadata
only, not content or export. [ADR 0035](0035-company-staff-confidentiality-and-allocation.md)
protects staff/case information; [ADR 0036](0036-company-expenses-budgets-and-receipts.md)
and [ADR 0037](0037-company-reimbursement-and-controlled-financial-approval.md)
establish financial readers without general Company reporting/export rights.
[ADR 0026](0026-capabilities-and-resource-grants.md) supplies Project export
bounds, not a Company audience. None supplies a Company knowledge publisher,
report/export or general audit matrix. AGENTS.md sections 1 and 5 therefore
require the following product decision before implementing these new rights.

## Proposed fixed authority

Every operation requires verified current identity, active Company root admission,
explicit current child admission for child content, and the existing generation,
policy, lifecycle, account-erasure and restrictive-restore fences. Parent roles
never substitute for child admission. No new role or configurable policy language.

Here, **scoped manager** means Owner/Org Admin with explicit admission in the
selected context, or Dept Manager in that explicitly admitted child context.

| Operation                                                                                                                 | Proposed authority                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Create/manage knowledge folders and document drafts; upload/finalize a version; publish/archive/restore knowledge content | Scoped manager. A pending upload remains bound to its initiating actor/admission; management does not permit impersonating the uploader.     |
| Read/search/download published knowledge, including published version history                                             | Any current full member explicitly admitted in its context, including Viewer, intersected with effective `directory.read` restrictions.      |
| Discover/read draft or archived knowledge and unpublished versions                                                        | Scoped manager only. Ordinary readers receive no draft/history counts or metadata.                                                           |
| Company operations/capacity report                                                                                        | Scoped manager, intersected with existing directory and subject-privacy rules. No confidential personnel case access is conferred.           |
| Company expense/budget/reimbursement report                                                                               | Existing ADR 0036/0037 scoped financial manager only. Individual expense/claim access does not confer aggregate financial access.            |
| Permitted Project portfolio/work KPI                                                                                      | Scoped manager AND independent current source Project authorization for each included field/metric, through Projects-owned public contracts. |
| Export an explicit permitted dataset                                                                                      | Same scoped managerial and resource-specific authority as its report/content view, rechecked before delivery. No general Company dump.       |
| Read/export general Company audit                                                                                         | Scoped manager, restricted to the selected context and approved event families below; resource-specific authorization remains mandatory.     |

Team Lead/Member/Viewer gain published knowledge reading only, not managerial
reports, general financial directories or audit. Existing API rights stay intact.

## Knowledge ownership, versioning and files

Companies owns typed same-Company/context folders, documents and immutable file
versions. Folder hierarchy is bounded and cycle-free. A document has mutable
revision-controlled draft metadata and an explicitly published version; a new
draft never silently replaces the published version or its immutable file hash.
Previously published versions remain readable to the current published audience.
Unpublished versions stay managerial. Archiving a folder hides its subtree from
ordinary discovery and direct reads; scoped managers may restore it. This is
content archival, not Company lifecycle or custody transfer.

Use the existing SharedFiles/StoragePort private-file pipeline, configured file
size limit within its existing hard cap, supported safe MIME types, ready-state
validation, streaming cancellation and orphan cleanup. No public URL, new storage
provider, malware-free claim, document extraction or AI index. Search covers
authorized title/description/filename metadata only. Finalization requires the
current initiating admission and an immutable verified ready file. Recheck current
document/version visibility before delivery, including after opening a stream.

Uploads are new Company knowledge objects. No rebinding/copying of staff-case,
receipt, Personal, Team or Project files, no employee-file grant expansion, and no
automatic publication of arbitrary confidential material. Personal erasure remains
independent; shared knowledge retains opaque authorship under existing custody
rules, without retaining identity/contact payloads in receipts or audit.

## Report and portfolio contents

Operations reports use existing authorized work-profile planning facts,
availability and equipment allocations only. Availability identifies known versus
unknown capacity, explicit civil dates/timezones and transparent denominators;
it never reads Personal Calendar/Focus, absence reasons or private staff cases.
No case counts, case existence, work-contact disclosure without current consent,
covert scoring, automatic pay/disciplinary consequence or new Company task engine.

Finance reports use effective approved expense facts and existing immutable budget,
commitment, allocation and reimbursement/acknowledgement records. Keep exact
currency/scale buckets, original budget periods/timezones and transparent variance
formulas. Never add currencies, count proposals as spending, count a payment
assertion as beneficiary acknowledgement, prorate a budget implicitly or execute
payments. Filtered reporting windows cannot silently change budget availability.

The permitted portfolio uses existing typed Company financial Project anchors
from P4-03 and their Projects-owned bridges. It creates no new Team/Company or
Project/Company attachment. Projects owns all source reads and metric calculations;
Company role grants no Project permission. Each source must independently permit
its identity and each requested metric. Filter inaccessible sources before counts,
pagination and aggregation; expose no hidden-source identifiers or counts. Source
revocation/disposal removes its projection, preserving Company financial history.
No Team portfolio is invented without an approved Company association.

## Bounded export and audit

Reuse the existing inline JSON/CSV export pattern: explicit dataset and context,
no retained export artifact or new export job. Permitted datasets are published
knowledge metadata (not file bytes), operations/capacity, finance, permitted
portfolio and the allowed audit metadata. Exclude staff cases and confidential
entries entirely, receipt bytes, work-contact payloads, private Personal data and
raw database dumps. Knowledge file downloads remain separately authorized.

Enforce at most 10,000 output records and 10 MiB encoded output, plus any lower
effective existing restriction. Use formula-safe CSV cells, exact money strings
and a versioned schema. Build and publish one consistent view while holding the existing sorted Company
and included-source authorization fences in the same transaction; revoked
authority fails closed instead of returning stale content. Audit
export publication using opaque dataset/context identifiers, never output bodies.

General audit is an allowlist of opaque metadata events for Company structure,
membership/policy administration, knowledge, equipment/availability, financial
records/workflows and these report/export accesses. Apply the same context and
resource-family authority before pagination/counts. Exclude staff-case, profile/
contact and identity-erasure event families entirely from the general view; they
must not leak case existence or subject activity. Financial events remain limited
to financial managers. No case bodies, amounts, filenames, contact details,
payment references or raw outbox/receipt payloads enter this audit projection.
Existing narrowly authorized case audit handling is unchanged.

## Implementation and acceptance after approval

Reuse Companies, Spaces authorization/audit/revisions/receipts, SharedFiles,
StoragePort and source-owned Project contracts. Use additive typed foreign keys,
existing signed pagination and If-Match/Idempotency-Key conventions. Preserve all
646 existing API operations and all 56 historical SQL artifacts; extend cleanup
and restrictive restore coverage without enabling Company lifecycle restoration.
Only actually implemented operations enter generated OpenAPI.

Targeted tests cover the role matrix; cross-context/generation denial; published,
draft, archive, history and search leaks; pinned files and streaming revocation;
capacity/financial privacy and exact sums; Project revoke/disposal; export bounds,
CSV formula safety and publication races; audit redaction; Personal erasure;
populated predecessor migration and compatibility preservation. Run the mandatory
13-stage local quality gate once, affected reruns where sufficient, and compiled
restart smoke for changed components. Docker, hosted CI, production and release
operational gates remain deferred, never claimed passed.

No Company attachment/transfer, ownership handover, full lifecycle, integrations,
external payment execution/provider, payroll, billing or Shared activation.
Leave P4-05 uncommitted/unpushed and stop before P4-06.

Owner decision: **APPROVED** explicitly in the implementation session. Approval
does not authorize commit, push, deployment, Shared activation or P4-06.
