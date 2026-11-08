# 0041: Company custody in existing Project and Team metadata responses

Execution amendment (2026-11-08): [ADR 0043](0043-company-transfer-deferral-and-stabilization.md)
retains this approved compatibility expansion and its tests. Actual transfer is
deferred; independent association/attachment continues to return INDEPENDENT.

Status: **APPROVED by the owner as written for local implementation**, 2026-11-07.
ADRs 0039 and 0040 are approved. This decision addresses a separate frozen API
contract conflict discovered while implementing their scope-aware source ports.
The owner explicitly approved the bounded response amendment and compatibility
verification below. Existing commit, deployment and activation restrictions remain.

## Conflict

`ProjectSchema.association` and `TeamSchema.association` currently require the
literal `{ kind: 'INDEPENDENT' }`. The published P4-05 signatures freeze those
response schemas. Returning that value after a real custody transfer would
misrepresent ownership. Returning COMPANY would currently fail the published
schema and compatibility gate. ADR 0040 approves the Company-child representation
and requires preserving HTTP signatures, but does not authorize an exception to
the frozen response literal or specify relocation of existing endpoints.

Affected implemented operations:

```text
POST  /api/v1/projects
GET   /api/v1/projects
GET   /api/v1/projects/{id}
PATCH /api/v1/projects/{id}
POST  /api/v1/teams
GET   /api/v1/teams
GET   /api/v1/teams/{id}
PATCH /api/v1/teams/{id}
GET   /api/v1/teams/{id}/projects
```

Creation remains independent-only. The schemas are shared with reads, lists,
patch results and existing cross-Team Project references. Merely keeping the old
list would either emit a false custody value or omit authorized transferred
Projects from preserved references.

## Recommended bounded decision

Authorize an additive v1 response union for the association field only:

```text
{ kind: 'INDEPENDENT' }
or
{ kind: 'COMPANY', companyId: UUID, parentScopeId: UUID }
```

INDEPENDENT continues to describe independent custody, including administrative
Company associations/attachments that did not transfer custody. COMPANY appears
only after an actual approved whole-root transfer commits. The outer stable IDs,
fields, methods, paths, requests, statuses and security contracts remain intact.
Creation inputs still reject custody/Company/role mass assignment. Source-owned
authorization remains mandatory; the new branch grants no permission or history.

Document the narrow response compatibility amendment explicitly. Preserve every
existing baseline file. Verify the original INDEPENDENT branch and all surrounding
response structure against its frozen signature by normalizing only the approved
new association branch back to the unchanged old branch for comparison. Keep all
other historical schema/security/request/response checks exact. Test that any
change to an existing field, old branch or unrelated operation still fails.
Never skip the nine operations or replace their old signatures with new hashes.

Clients must handle the new Company variant before using the new custody-transfer
feature. This is a documented expansion of a previously independent-only output;
it is not a claim that old strict generated clients already understand Company
custody. Shared/production activation remains disabled.

## Alternative

Keep the old literal schemas and introduce separate Company-custodial metadata
and reference-list routes. The owner would need to specify the behavior of old
GET/PATCH/list/reference routes after transfer and whether authorized transferred
sources may disappear from the old lists. Do not silently select a moved-resource
error, hide a preserved reference, invent a new API version or reinterpret
INDEPENDENT as something other than current custody.

AGENTS.md sections 1 and 5 require resolving this contract conflict before the
affected custody-transfer behavior. Lifecycle, custody-preserving association/
attachment and preparatory scope-isolation work remain independently authorized.
