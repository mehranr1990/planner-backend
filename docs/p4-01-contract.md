# P4-01 Company foundation contract

Scope: Backend V3 P4-01 and approved [ADR 0034](adr/0034-company-foundation-roles-and-inheritance.md), with ADRs 0024–0029, 0031 and existing confidentiality boundaries.
Company settings, Department/Unit structure, explicit corporate memberships and
bounded policy inheritance only. Employee profiles/cases, resources, finance,
reports/exports and integrations are later batches. Existing Teams and Projects
remain independent; attachment/transfer and full Company lifecycle remain P4-06.

One Company has one Shared Space/root AccessScope. Departments and Units are
typed scopes inside that custody, with real same-Company parent FKs. A Unit has
one immutable Department parent. No separate Space per Department/Unit and no
Company conversion of an independent Project/Team or Personal Space.

All protected routes require current verified session, Shared prerequisite gate,
active Company custody, current root admission and current provider identity.
Ordinary child reads additionally require explicit child admission bound to the
current root generation. Administrative structure/policy/membership metadata uses
the fixed Owner/Org Admin authority in ADR 0034; no content authority follows it.
Directory responses contain opaque admission/actor IDs, roles, states and revisions;
no employee profile, contact, personnel file or independent source data is exposed.

Owner is derived from primary custody. Fixed stored corporate roles are ORG_ADMIN,
DEPT_MANAGER, TEAM_LEAD, MEMBER and VIEWER. Project Admin/Manager and Team Admin/Lead
catalogs retain their existing schemas and policies. Only Owner assigns/revokes
Org Admin. Owner/Org Admin manage structure, manager/lead appointments and policy.
Dept Manager manages only Member/Viewer seats in an explicitly admitted child
context. Team Lead has ordinary admitted-context reads in this batch. No self-
promotion, direct Owner-seat editing, arbitrary role language or automatic hierarchy
membership. Root leave preserves existing last-custodian/30-day closure protection;
child leave never closes Company custody. Only root seats count for Company closure.

Company offers reuse ContextInvitation, verified canonical identity/proofs, seven-day
expiry, Shared rate limiting and existing durable expiry consumer. Proof is returned
once, carried in X-Invitation-Proof and never in a query parameter. Acceptance
rechecks issuer scope/generation/delegation, recipient identity and root generation,
target admission generation/revision, restore epoch, database time and current
custody under the existing account → identity → custody → usage lock order.
Pending offers cannot undo a later removal or another accepted admission. Accepted
replay reauthorizes the current root/target generation and restores no old role.
Root rejoin needs explicit child re-admission; stale child intervals are ended before
the new generation, preserving the existing SQL transition guard. Current child
usage is counted from valid root-bound admissions, not stale membership rows.

CompanyScopePolicy stores immutable versions of only `structure.read` and
`directory.read`, with at most one rule per key. Company → Department → Unit
evaluation intersects mandatory restrictions and optional restrictions; defaults
inherit until an explicit authorized default override. A child default published
before a newly introduced parent default does not silently override that parent.
Only Owner/Org Admin publishes/overrides, with If-Match on the current version.
Fixed administration, verification, root/child admission, tenant, lifecycle and
source/privacy floors are never configurable. Policy/admission changes advance
authorization versions, invalidating cursors and rechecking all later effects.

Create operations use Idempotency-Key and current authority before receipts;
updates/decisions use If-Match and ETags. Pages are bounded with signed, actor- and
authorization-bound cursors. Unknown or unadmitted contexts do not leak through
detail, nested unit lists, invitations, directory entries or counts. Strict schemas
reject unknown Company integration, source-transfer and policy keys. Responses use
no-store; unsafe requests require Origin. Safe errors: 400 malformed request/cursor,
401 absent session, 403 denied fixed capability, 404 unavailable resource/admission/
proof, 409 stale revision or authority, 429 abuse and 503 prerequisite unavailability.
Integrity failures retain the existing fail-closed handling; no guard is bypassed.

Company account exit and independent Personal erasure reuse SharedExitWork and
boundary-local attribution. Owner exit with surviving root members freezes custody;
no automatic promotion or purge. Project/Team cleanup dispatch remains kind-specific
and the purge SQL predicate excludes Company. Restored Company authorization is
quarantined with CLOSED scopes, using opaque signed restrictive evidence; it cannot
serve data before separately reviewed Company domain reconciliation/lifecycle gates.
No Company metadata or private source body is copied into recovery evidence.

P4-01 adds 23 operations; generated OpenAPI and runtime route-parity tests own the
exact request/response and operation IDs listed below. Existing 534 published
operations and all prior schema signatures remain compatible.

| Requirement           | Owner / authority and effects                                                                                                             | Evidence                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| P401-C01 custody      | Companies + Shared provision; verified creator; root identity and immutable creation replay; Company/Shared audit and custody usage       | creation/rollback/retention tests; populated M028 rehearsal                                              |
| P401-C02 structure    | Companies Department/Unit ownership; Owner/Org Admin; same-Company FKs, explicit parent, revision and receipt                             | structure, wrong-child IDs, hidden unit-list and role-catalog tests                                      |
| P401-C03 membership   | Spaces CompanyAccess facade; explicit root/child seats; current issuer/recipient; atomic admission intervals, binding, audit/outbox/usage | proof, rejoin, target snapshots, scope delegation, both observed revoke/invite orders; M029 preservation |
| P401-C04 policy       | Companies immutable policy versions; Owner/Org Admin; mandatory/default/optional precedence and explicit override                         | policy domain and integration tests, observed restriction/read race, signed cursor invalidation          |
| P401-C05 isolation    | Current Company context only; independent Project/Team/Personal source owners unchanged                                                   | multi-Company roles, nested denial, API compatibility and compiled restart                               |
| P401-C06 exit/restore | Shared lifecycle/identity owner; root-only closure count, retained actors, strict Company quarantine                                      | Company owner exit/Personal erasure, last custodian, restore evidence and no Company purge tests         |

No source engine, dependency, employee enforcement, commercial restriction,
Company attachment or Shared/production activation is introduced.

| Method / actual route                                                              | actual_openapi_operation_id                                          |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `POST /api/v1/companies`                                                           | `companypostcompanies`                                               |
| `GET /api/v1/companies`                                                            | `companygetcompanies`                                                |
| `GET /api/v1/companies/{id}`                                                       | `companygetcompaniesid`                                              |
| `PATCH /api/v1/companies/{id}`                                                     | `companypatchcompaniesid`                                            |
| `POST /api/v1/companies/{id}/departments`                                          | `companypostcompaniesiddepartments`                                  |
| `GET /api/v1/companies/{id}/departments`                                           | `companygetcompaniesiddepartments`                                   |
| `GET /api/v1/companies/{id}/departments/{departmentId}`                            | `companygetcompaniesiddepartmentsdepartmentId`                       |
| `PATCH /api/v1/companies/{id}/departments/{departmentId}`                          | `companypatchcompaniesiddepartmentsdepartmentId`                     |
| `POST /api/v1/companies/{id}/departments/{departmentId}/units`                     | `companypostcompaniesiddepartmentsdepartmentIdunits`                 |
| `GET /api/v1/companies/{id}/departments/{departmentId}/units`                      | `companygetcompaniesiddepartmentsdepartmentIdunits`                  |
| `GET /api/v1/companies/{id}/units/{unitId}`                                        | `companygetcompaniesidunitsunitId`                                   |
| `PATCH /api/v1/companies/{id}/units/{unitId}`                                      | `companypatchcompaniesidunitsunitId`                                 |
| `GET /api/v1/companies/{id}/contexts/{scopeId}/members`                            | `companygetcompaniesidcontextsscopeIdmembers`                        |
| `POST /api/v1/companies/{id}/contexts/{scopeId}/invitations`                       | `companypostcompaniesidcontextsscopeIdinvitations`                   |
| `GET /api/v1/companies/{id}/contexts/{scopeId}/invitations/{invitationId}`         | `companygetcompaniesidcontextsscopeIdinvitationsinvitationId`        |
| `POST /api/v1/companies/{id}/contexts/{scopeId}/invitations/{invitationId}/revoke` | `companypostcompaniesidcontextsscopeIdinvitationsinvitationIdrevoke` |
| `PATCH /api/v1/companies/{id}/contexts/{scopeId}/members/{accessId}`               | `companypatchcompaniesidcontextsscopeIdmembersaccessId`              |
| `POST /api/v1/companies/{id}/contexts/{scopeId}/leave`                             | `companypostcompaniesidcontextsscopeIdleave`                         |
| `GET /api/v1/companies/{id}/contexts/{scopeId}/policy`                             | `companygetcompaniesidcontextsscopeIdpolicy`                         |
| `PUT /api/v1/companies/{id}/contexts/{scopeId}/policy`                             | `companyputcompaniesidcontextsscopeIdpolicy`                         |
| `GET /api/v1/company-invitations/preview`                                          | `companygetcompanyinvitationspreview`                                |
| `POST /api/v1/company-invitations/{invitationId}/accept`                           | `companypostcompanyinvitationsinvitationIdaccept`                    |
| `POST /api/v1/company-invitations/{invitationId}/decline`                          | `companypostcompanyinvitationsinvitationIddecline`                   |
