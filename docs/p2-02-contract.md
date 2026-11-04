# P2-02 implementation contract

Owner authorization: P2-01 accepted and P2-02 expressly authorized, 2026-11-04.
Sources: V3 P2-02, ADRs 0024–0031 and the approved M04/M05 prerequisite split.

Spaces owns invitations, admission changes and administrative OwnerHandover.
Project domain records and concrete resource-grant targets arrive in P2-03; actual
resource custody transfer remains its separately approved source/file slice.
Accordingly, routes below identify existing Space UUIDs. They do not pretend a
Project record already exists. Invitation proof is returned once in the initial
authenticated create response for explicit delivery by the inviter; it is never
stored plaintext, logged, resent, or included in an outbox payload. Create replay
returns the safe invitation record with `proof: null`.

## Implemented operations

All routes are under `/api/v1`. Inputs/outputs use strict Zod schemas. All unsafe
operations require trusted Origin; all responses use Cache-Control: no-store.
UUIDs, Idempotency-Key (1–128 printable ASCII) and quoted positive If-Match follow
existing conventions. No proof may be placed in a query parameter.

| Operation                                               | Request / capability                                                                           | Result / concurrency                                                                                                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /spaces/{spaceId}/invitations                      | Typed membership offer to User UUID or canonical email; current role-administration capability | 201 safe invitation plus initial proof; idempotency required; seven-day DB-time lifetime                                                                                      |
| GET /spaces/{spaceId}/invitations/{id}                  | Current authority for the offered role; no directory lookup                                    | 200 safe invitation and ETag; no recipient email/profile or proof                                                                                                             |
| GET /invitations/preview                                | X-Invitation-Proof; anonymous, empty query                                                     | 200 generic Project label, offer category and expiry only; invalid/revoked/expired share generic 404                                                                          |
| POST /invitations/{id}/accept                           | Verified active exact session, matching current recipient, proof, If-Match                     | 201 invitation plus own membership; current inviter capability/generation/policy and recipient admission snapshot rechecked; terminal same-identity replay remains authorized |
| POST /invitations/{id}/decline                          | Same recipient/session/proof requirements, If-Match                                            | 201 safe terminal invitation; no admission                                                                                                                                    |
| POST /spaces/{spaceId}/invitations/{id}/revoke          | Current delegation authority for offered role, If-Match                                        | 201 terminal invitation; restrictive intent/outcome, atomic version/audit/outbox                                                                                              |
| PATCH /spaces/{spaceId}/memberships/{id}                | Current old/new-role administration; strict role/state; If-Match                               | 200 membership; existing kernel constraints and fencing                                                                                                                       |
| POST /spaces/{spaceId}/leave                            | Narrow self-departure, If-Match                                                                | 201 safe departure; primary custodian with remaining full members requires accepted succession                                                                                |
| POST /spaces/{spaceId}/ownership-handovers              | Owner; named existing eligible full member                                                     | 201 seven-day offer; one pending per custody; expected custody revision captured; idempotency required                                                                        |
| GET /spaces/{spaceId}/ownership-handovers/{id}          | Current Owner or named successor with full admission                                           | 200 safe offer and ETag                                                                                                                                                       |
| POST /spaces/{spaceId}/ownership-handovers/{id}/accept  | Named eligible successor, provider password verification now (within five minutes), If-Match   | 201 terminal handover; exact custody/admission generations and revision; ownership seat changes without moving source records                                                 |
| POST /spaces/{spaceId}/ownership-handovers/{id}/decline | Named successor, If-Match                                                                      | 201 terminal offer                                                                                                                                                            |
| POST /spaces/{spaceId}/ownership-handovers/{id}/revoke  | Current initiating Owner, If-Match                                                             | 201 terminal offer                                                                                                                                                            |

400 invalid envelope (the existing Zod validation convention); 401 missing/unverified session as existing guard defines;
403 capability/activation denial; 404 non-enumerating absence or invalid proof;
409 stale revision/generation/state/fingerprint; 429 bounded abuse. No source
search/count/file/export permission is inferred from an offer or admission record.

Known identities are bound to stable User UUIDs; pending email targets use Better
Auth's lowercase canonical behavior and identity-owner reads under the fence.
Offers capture existing recipient admission revision/generation: a departure or
new generation cannot be revived by an older offer. Accepted full membership is
independent of inviter participation; receipt/offer replay checks current recipient
authority. Suspended admission is a hard denial, not an invitation bypass.

## Security and execution plan

Extend the existing account → identity/session → sorted custody lock factory for
verified recipients who have no admission yet, without manufacturing Personal or
shared resource authority. Predeclare recipient, inviter, current custodian and
successor accounts; reread all hint relationships after locks. Use existing
exclusive Personal fences, READ COMMITTED, five-second lock timeout, 30-second
budget and bounded recognized rollback retries. Provider-backed password checking
uses the identity owner and locked credential rows, never an external precheck.

Persist business records, safe receipts, usage, audit and shared outbox atomically.
Restrictive revocation/ownership transitions use the existing signed intent/outcome
protocol; ambiguous outcomes remain quarantined. An unresolved committed intent
can acquire its COMMITTED witness only when its exact space/version/action/resource
matches existing atomic audit and outbox evidence. Missing evidence never causes
automatic ABORT. Creation receipt keys include the admission generation, preventing
an explicit readmission from colliding with the prior generation's receipt.
No business sends occur inside
transactions. The only new worker work is bounded offer expiry/PII cleanup, with
current custody fencing and idempotent effects. Account exit/last departure
invalidates pending invitations/handovers; erasure removes live recipient links
and pending recipient email before identity deletion.

Abuse ceilings per fixed one-minute DB-time window: 30 requests/IP for preview;
30 requests/IP for protected collaboration routes; 20 requests/actor; 20 invitation
creates/context; five handover proposals/context. Failed proof attempts count in a
separate short limiter transaction. Persist only keyed digests, never raw IPs.
Each maintenance pass expires at most 25 invitations and 25 handovers and removes
at most 100 expired limiter buckets; no new infrastructure.

Narrow self-departure also works for ARCHIVED and OWNER_EXIT_FROZEN custody with
an active/suspended full admission. Ordinary access remains denied. When the last
member leaves a frozen context, its superseded frozen job is cancelled and the new
closing generation receives the existing thirty-day shared grace; no old recovery
lease survives. Personal closure and erasure retain their existing timing and flow.

Shared activation prerequisites stay mandatory; no operator retention policy,
signing keys, checkpoint or acceptance reference is installed. Resource-grant
offers remain rejected until concrete targets exist. Shared recovery, destructive
cleanup, Project creation/domain, actual source transfer, Team/Company and UI are
not activated by this batch.

Tests: strict schema/HTTP/OpenAPI parity, forwarded/wrong-account proofs, current
email and session changes, inviter demotion/revocation, expiry boundaries, accept
versus revoke/closure, duplicate accept and durable replay, explicit readmission,
role ceilings, identity erasure, competing handovers, successor closure, accepted
succession then departure, atomic rollback/receipt/audit/outbox, worker restart and
all existing Personal compatibility/closure/sync gates. Run targeted checks during
implementation and all 13 mandatory stages plus compiled restart at completion.

## Access matrix

These fixed administration ceilings supplement the current scope policy and live
admission/account/custody checks; a grant-only actor cannot administer membership or
hold the primary custodian seat. Offers confer no source visibility.

| Action                                    | Owner                            | Admin             | Manager           | Member / Viewer   | Named recipient / successor                                     |
| ----------------------------------------- | -------------------------------- | ----------------- | ----------------- | ----------------- | --------------------------------------------------------------- |
| Offer/change/revoke Admin role            | Yes                              | No                | No                | No                | No                                                              |
| Offer/change/revoke Manager role          | Yes                              | Yes               | No                | No                | No                                                              |
| Offer/change/revoke Member or Viewer role | Yes                              | Yes               | Yes               | No                | No                                                              |
| Leave own full admission                  | Yes, succession if others remain | Yes               | Yes               | Yes               | Only after full admission                                       |
| Propose/revoke pending handover           | Initiating current Owner         | No                | No                | No                | No                                                              |
| Accept/decline membership offer           | No implicit right                | No implicit right | No implicit right | No implicit right | Exact verified current recipient + proof                        |
| Accept/decline handover                   | No implicit right                | No implicit right | No implicit right | No implicit right | Eligible full member; accept requires current provider password |

Role changes require authority over both the old and new role. Suspended full
members may only use narrow self-departure. Archived/frozen departure never grants
read, invitation, transfer or ordinary write rights. Preview additionally checks
the active scope and fresh custodian account before returning its generic label.

## G2 traceability

All rows belong to P2-02, authorized by the owner's explicit continuation on
2026-11-04. Status is IMPLEMENTED; final proof and acceptance results are recorded
in `p2-02-report.md`. Scope is the existing independent shared Project custody and
its root AccessScope, with no Team/Company linkage. Operation IDs below are the
actual identifiers in the generated `docs/api/openapi.json`.

| Requirement / source             | Actor, command and actual OpenAPI operation IDs                                                                                                                                                                                                                                                                                         | Persistence, revision, effects                                                                                                                                                                                          | Security/integration evidence and observability                                                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-01–10 / A04                  | Delegating role: create/read/revoke membership offer; `sharedpostspacesspaceIdinvitations`, `sharedgetspacesspaceIdinvitationsid`, `sharedpostspacesspaceIdinvitationsidrevoke`                                                                                                                                                         | ContextInvitation typed scope/issuer/interval FKs; seven-day DB expiry; create key+fingerprint; revoke If-Match; safe receipt, audit/outbox/version                                                                     | `shared-collaboration.spec.ts`: hash-only proof, create replay, role overposting, inviter demotion, cross-context, expiry and revoke races. Audit action `invitation.create` / `invitation.revoke`; no recipient PII in safe output/outbox                  |
| INV preview / A04                | Anonymous proof-header preview; `sharedgetinvitationspreview`                                                                                                                                                                                                                                                                           | Custody-fenced current offer/issuer/policy/scope/account reads; no admission/write                                                                                                                                      | Same suite: generic preview, invalid/expired/revoked equivalence, archived/fresh owner closure; HTTP no-store and query rejection; hashed limiter 429                                                                                                       |
| INV acceptance / A01,A02,A04,A08 | Exact verified recipient: `sharedpostinvitationsidaccept`, `sharedpostinvitationsiddecline`                                                                                                                                                                                                                                             | Account→identity/session→custody fences; current issuer/delegation, recipient snapshot and If-Match; PENDING→terminal; access/interval, receipt, audit/outbox/usage atomic                                              | Same suite: forwarded/wrong identity, email-change both orders, generation/rejoin, suspension, session, accept/revoke and closure races, duplicate/receipt-independent replay. `invitation.accept` / `invitation.decline` effects; no implicit source grant |
| Membership / A02,A03,A06         | Current role administrator or departing self: `sharedpatchspacesspaceIdmembershipsid`, `sharedpostspacesspaceIdleave`                                                                                                                                                                                                                   | Kernel admission revisions/generations, intervals, delegation ceilings; custody-fenced audit/outbox/usage; closure job when last member leaves                                                                          | Same suite plus `shared-kernel.spec.ts`: old/new role authority, last leave/accept both orders, frozen/archived narrow leave, obsolete frozen generation cancellation; `membership.change` / kernel departure audit                                         |
| Succession / A06,A08             | Owner proposes, named full member accepts/declines, initiating Owner revokes: `sharedpostspacesspaceIdownershiphandovers`, `sharedgetspacesspaceIdownershiphandoversid`, `sharedpostspacesspaceIdownershiphandoversidaccept`, `sharedpostspacesspaceIdownershiphandoversiddecline`, `sharedpostspacesspaceIdownershiphandoversidrevoke` | OwnerHandover typed participants+generations; one pending; seven days; exact custody revision; provider reauth ≤5m; seat only, atomic usage release/acquire and audit/outbox; terminal replay checks current generation | Same suite: competing proposal, wrong password/actor, stale custody, cross-context/grant-only successor, successor closure both orders, accepted succession/departure and replay; `handover.*` plus `custody.acquire` audit                                 |
| Lifecycle/privacy / A04,A06      | Bounded worker expiry; identity-owner erasure; no public operation                                                                                                                                                                                                                                                                      | 25+25 offer expiry, 100 limiter cleanup; terminal recipient/proof scrubbing; independent signed restrictive intent/outcome; existing Personal content-before-identity purge                                             | Same suite: expiry, recipient erasure, rollback and positive postcommit witness repair; `shared-personal-erasure.spec.ts` preserves private purge with shared hold; compiled `smoke:p2-02` proves repeat restart/replay                                     |
| M04 / A01–A08 prerequisites      | Controlled migration tooling; no HTTP/admin deployment command                                                                                                                                                                                                                                                                          | Three additive tables, typed FKs/CHECKs/unique indexes, immutable old history; exact reviewed hash                                                                                                                      | `collaboration-migration.spec.ts`, `foundation.spec.ts`, `collaboration-upgrade.ts`: all 81 prior tables, constraints and 27 checksums preserved, interrupted rollback/resume/repeat; migration report records elapsed time/hash                            |
| Compatibility/activation / V3 G2 | Existing Personal callers; default disabled shared routes                                                                                                                                                                                                                                                                               | Existing source guards, Personal sync/export/erasure and provider schema preserved; no activation provisioning                                                                                                          | `shared-activation.spec.ts`, full Personal integration, P1-12/P2-01 compiled smokes; frozen P1-12 and P2-02 API signatures, strict schemas/local reference validation; request/correlation IDs and safe errors only                                         |

All unsafe HTTP operations enforce trusted Origin. Error, revision, proof and
idempotency semantics are specified above; no additional client fields are
accepted. Activation and later typed resource targets remain the explicit blocking
items described above, rather than silently enabled functionality.
