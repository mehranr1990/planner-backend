# P4-05 implementation contract

Authority: approved V3 P4-05 and owner-approved [ADR 0038](adr/0038-company-knowledge-reports-and-authorized-exports.md).
Predecessor: P4-04, published and independently remote-verified at
`ed9dc2f7697d220808867a6eec65f11b4b8385db`.

All routes below are under `/api/v1/companies/{id}/contexts/{scopeId}`.
Current verified sessions, explicit root/child admissions and existing lifecycle,
generation, restore and account fences apply. Mutations require Origin; creates
require Idempotency-Key; updates require If-Match. Responses are private/no-store.
Only implemented operations appear in [OpenAPI](api/openapi.json).

| Routes                                                | Methods / behavior                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `/knowledge/folders`                                  | POST create; GET authorized signed page/search                                          |
| `/knowledge/folders/{target}`                         | PATCH title/archive/restore with expected revision                                      |
| `/knowledge/documents`                                | POST draft; GET signed authorized page/search, optional folder filter                   |
| `/knowledge/documents/{target}`                       | GET visible metadata; PATCH draft metadata/archive/restore                              |
| `/knowledge/documents/{documentId}/versions`          | POST private upload intent with captured metadata; GET authorized version history       |
| `/knowledge/documents/{documentId}/versions/{target}` | GET authorized version and file status                                                  |
| Same version path + `/complete`                       | POST binary upload, If-Match is the file revision                                       |
| Same version path + `/publish`                        | POST immutable publication, file If-Match plus body `documentRevision`                  |
| Same version path + `/remove`                         | POST discard an unpublished file with expected file revision                            |
| Same version path + `/download`                       | GET authorized private byte stream, attachment disposition and nosniff                  |
| `/knowledge/files/reconcile`                          | POST bounded cleanup of eligible failed/expired/deleted knowledge uploads only          |
| `/reports/operations`                                 | GET current admitted planning/capacity/equipment aggregates                             |
| `/reports/finance`                                    | GET exact currency buckets and full-period budget balances/variance                     |
| `/reports/portfolio`                                  | GET current independently authorized Project metrics through existing financial anchors |
| `/audit`                                              | GET signed page of scoped, allowlisted opaque audit metadata                            |
| `/exports`                                            | POST explicit dataset, inline JSON or CSV; no retained export artifact                  |

Total: **20 additive operations**, preserving all **646** P4-04/prior operations.
Company roles grant no independent Project or Team membership. Dept Managers need
explicit child admission; parent metadata administration alone grants no content.
General audit and exports never include confidential staff cases or contacts.

Ordinary knowledge readers see only published versions and their pinned metadata;
draft title/revision/timestamps and unpublished version counts remain hidden.
Folders without visible published descendants remain hidden from ordinary readers.
Archiving a folder hides its subtree; archived content remains managerial.
Folder parent is fixed at creation, with a maximum eight-level hierarchy. New
knowledge uploads never bind an existing receipt or another source's file.
The existing safe types, FILE_MAX_BYTES within the 100 MiB hard ceiling, private
StoragePort, upload timeout/grace and cancellation rules apply. Published versions
and file evidence are immutable. New versions capture metadata at upload initiation.
Search covers visible title/description/current published filename metadata;
content extraction, full text indexing and OCR are outside this implementation.

Reports use an explicit start-inclusive/end-exclusive civil date window and IANA
timezone, at most 93 civil days. Project portfolio additionally preserves the
existing Project maximum of 93 elapsed days, including timezone/DST effects.
Unknown capacity days include absent and explicitly unknown entries in the current
admitted-member × civil-day denominator. No Personal capacity, absence reason,
private performance score or staff case is read. Company reports are live views.

Expense totals count effective approved revisions in the selected stored civil
date/timezone. Currency buckets are never combined. Reimbursement entitlement,
reserved and beneficiary-acknowledged columns are **current balances** for buckets
whose original expense occurs in the selected window, not historical cash flow.
Budgets retain their complete original period/timezone: `variance = limit - spent`
and `available = limit - spent - reserved`. No automatic FX, budget proration,
payment execution or Personal ledger mutation.

Portfolio sources are existing Company financial Project anchors, not Company
attachments. Construction and inline export publication hold sorted Company and
source authorization fences together. Unreadable Projects contribute no IDs,
titles, records or hidden counts. Projects owns all source metric reads.

Export datasets: KNOWLEDGE (published metadata only), OPERATIONS, FINANCE,
PORTFOLIO and AUDIT. A versioned JSON envelope or two-column CSV (`dataset`,
JSON `record`) preserves exact decimal strings; CSV cells are formula-safe.
Enforce 10,000 records / 10 MiB encoded output and lower existing context limits.
No receipt bytes, staff-case information, work contacts, source copies or database
dump. Publication is audited with opaque context/action only.

Reuse existing audit/outbox and free-mode usage for knowledge mutations; reads and
export publication record opaque access audit. No new job or provider. Company
restore/disposal remains quarantined for P4-06; independent Personal erasure and
Project disposal remain intact. Shared activation, attachments/transfer, handover,
Company lifecycle, integrations, Docker, hosted CI and deployment remain deferred.
