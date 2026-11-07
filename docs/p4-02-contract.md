# P4-02 staff, confidential cases and resource allocation contract

Implements the approved V3 P4-02 slice and ADR 0035, preserving ADRs 0024–0029,
0031 and 0034. Companies owns six new record types: StaffProfile, AvailabilityDay,
Resource, ResourceAllocation, EmployeeCase and EmployeeCaseEntry (Company-prefixed
database models). Spaces continues owning admissions, authorization and lifecycle.

All routes below start `/api/v1/companies/{id}/contexts/{scopeId}`. Current verified
session, active Company root and explicit child admission are mandatory. Ordinary
profile/availability/resource reads intersect directory policy along the complete
ancestor chain. Administration follows ADR 0035; it grants no general case access.
Sensitive case reads/lists are audited and limited to their named participants.

| Method      | Suffix                                     | Authority / result                                               |
| ----------- | ------------------------------------------ | ---------------------------------------------------------------- |
| POST / GET  | `/staff-profiles`                          | Administrative create / policy-filtered directory page           |
| GET / PATCH | `/staff-profiles/{profileId}`              | Directory read / administrative metadata update                  |
| PUT         | `/staff-profiles/{profileId}/work-contact` | Subject opt-in/withdrawal of current provider-verified email     |
| POST        | `/staff-profiles/{profileId}/erase`        | Subject privacy redaction                                        |
| POST / GET  | `/availability`                            | Subject or scoped manager write / visible explicit capacity page |
| PATCH       | `/availability/{availabilityId}`           | Subject or scoped manager update/clear                           |
| POST / GET  | `/resources`                               | Scoped manager create / admitted-context page                    |
| GET / PATCH | `/resources/{resourceId}`                  | Admitted read / scoped manager metadata update                   |
| POST        | `/resources/{resourceId}/retire`           | Scoped manager, no outstanding allocation                        |
| POST / GET  | `/resources/{resourceId}/allocations`      | Scoped manager allocation / admitted-context page                |
| GET         | `/allocations/{allocationId}`              | Admitted-context read                                            |
| POST        | `/allocations/{allocationId}/cancel`       | Scoped manager, current ALLOCATED only                           |
| POST        | `/allocations/{allocationId}/return`       | Scoped manager, current ALLOCATED only                           |
| POST / GET  | `/employee-cases`                          | Scoped manager create / named-participant-only page              |
| GET         | `/employee-cases/{caseId}`                 | Named author/subject/reviewer only                               |
| POST / GET  | `/employee-cases/{caseId}/entries`         | Append correction/response/appeal/review / confidential page     |
| POST        | `/employee-cases/{caseId}/erase`           | Subject privacy redaction of case and all entries                |

25 additive operations. Creates require Idempotency-Key; updates, decisions,
entries and redactions require If-Match. POST entries also requires Idempotency-Key.
Create returns 201; state decisions return 200. Detail/mutation responses carry
ETag. Strict input/output schemas, unsafe-request Origin and no-store apply.
Errors follow existing 400/401/403/404/409/413/429/503 conventions. Hidden nested IDs,
unadmitted contexts and confidential cases do not reveal existence or counts.

Profiles bind immutable context admission/generation; position is bounded text,
supervisor an optional current same-Company root admission, work status ACTIVE or
INACTIVE. Contacts are absent until subject consent and disappear when provider
verification/email no longer matches the consented snapshot. Privacy redaction
clears profile work data/contact and cannot be undone by an administrative patch.
Subject-sensitive Company data is also redacted through the owning module before
identity erasure detaches the SharedActor. Missing erasure owner fails closed.
Company restore remains quarantined pending the later domain reconciliation gate.

Availability is explicit date/timezone/minutes (0–1440 or null), never inferred
from private calendars, Focus, Team or Personal settings. Natural identity is
immutable. Recipient generation changes hide prior planning records.

Each resource is one item. Allocation intervals are half-open UTC instants,
start strictly before end. Effective ALLOCATED intervals for an item cannot overlap;
adjacency is valid. PostgreSQL locks the resource row in its overlap trigger, and
the application additionally uses the existing custody fence. Original allocation
facts are immutable; terminal cancellation/return cannot be reopened. Return records
an administrative fact without recipient acknowledgement or financial effect.
Retirement rejects outstanding allocations and preserves history.

Case author/subject/reviewer are distinct, explicit current context admissions.
Reviewer additionally holds current root Owner/Org Admin authority. Immutable
content receives append-only CORRECTION, RESPONSE, APPEAL or REVIEW entries; REVIEW
records OPEN/RESOLVED state. Only the subject may redact a case. Redaction clears
reason/evidence and every entry body irreversibly, preserving opaque integrity
records. No confidential bodies or contacts enter receipts/audit/outbox/control.
Explicit approved obligations fail closed before sensitive erasure; no legal
retention period is inferred. Independent Personal erasure remains independent.

Safety bounds: at most 1,000 Company live identity hints, 1,000 records per kind
per Company, including case entries across all cases; pages at most 100. Limits are engineering
bounds, separate from free-mode commercial policy. Signed cursors bind actor,
Company/context, operation, root/child generations and authorization versions.

Acceptance requires permission/generation/identity isolation, confidential counts
and audit privacy, contact withdrawal, rejoin and reviewer demotion, observed lock
ordering, overlap races, idempotency/rollback, erasure and restrictive restore,
typed FK/immutable-state constraints, populated migration preservation, all prior
API signatures, fresh compiled restart smoke and the mandatory complete quality gate.
No attachments, integration, Company association/transfer, finance, export,
deployment or Shared activation is introduced.
