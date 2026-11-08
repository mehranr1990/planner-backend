# 0042: Preserve source identifiers in Team portfolio responses

Execution amendment (2026-11-08): [ADR 0043](0043-company-transfer-deferral-and-stabilization.md)
retains this approved compatibility expansion and its tests. Company-custodial
sources remain unavailable until separately authorized transfer acceptance.

Status: **APPROVED by the owner as written for local implementation**, 2026-11-08.
ADRs 0039, 0040 and 0041 are approved for local implementation. This amendment
does not reopen their decisions or change any permission, request or transfer unit.

## Concrete remaining response conflict

`TeamPortfolioSourceSchema` contains only `kind`, `spaceId` and aggregate `summary`.
Before transfer a Project's root ID and Space ID are equal. After the approved
Company-child transfer two Projects can have distinct stable source IDs but the
same physical Company Space ID. Returning their real Space IDs would remove the
only source identifier from each portfolio entry. Returning the old independent
Space ID would misstate current custody. Merging the entries would change the
approved per-source summaries and denominator.

This affects exactly the successful responses of:

```text
GET /api/v1/teams/{id}/portfolio
GET /api/v1/teams/{id}/dashboard
```

ADR 0041 authorizes only the association field of nine Project/Team metadata
responses. The owner separately approved this bounded amendment for these two
aggregate response schemas. Implementation and acceptance evidence remain required.

## Approved bounded amendment

Retain the old independent-source object exactly. Add a response variant only for
a Company-custodial source:

```text
{ kind: TEAM | PROJECT, spaceId: Company UUID, scopeId: stable source UUID, summary }
```

`scopeId` is the existing Team or Project ID, not a new resource ID. Existing
`spaceId` retains its literal physical custody meaning. Keep the old kind,
summary, paths, query inputs, statuses, security and all surrounding fields.
Do not combine distinct sources or grant access through a Company root proof.

Preserve all frozen baseline files. Normalize only this exact approved variant
back to the unchanged independent branch, at the two explicitly enumerated
response locations. Negative checks must reject changes to either branch,
summary fields, surrounding response fields, unrelated operations or permissions.
Clients must understand the new variant before using transferred-source portfolios.

Other affected work/projection contracts were checked for this ambiguity:
Project/Team metadata already has scope IDs under ADR 0041; shared Tasks/Goals
carry scope IDs; work overlays identify their Project; work targets, private block
links and notifications carry globally unique typed resource/assignment IDs from
which owner facades can resolve the scope server-side. Their requests need no new
scope field. Team-specific DTO `teamId` fields retain their stable Team IDs.

## Alternative and execution boundary

Keep the two old aggregate schemas and define separately authorized routes for
Company-custodial sources, including owner-approved old-route inclusion semantics.
Do not silently omit transferred sources, relabel their custody or reinterpret
`spaceId` as a scope identifier. AGENTS.md sections 1 and 5 require resolving the
external-contract conflict before implementing that affected response behavior.

Scope-safe owner ports, graph migration and other approved P4-06 work may continue.
No commit, push, Shared activation, deployment, production database operation or
Phase 5 execution is authorized by this document.
