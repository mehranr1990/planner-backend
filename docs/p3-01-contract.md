# P3-01 — Independent Teams and authorized Project references

Authorized by the owner's 2026-11-05 instruction to implement P3-01 locally.
Sources: approved Backend V3 roadmap P3-01/G3 and ADRs 0024–0031. This extends
the existing Spaces kernel; Company, Shared activation and deployment stay gated.

Teams owns independent Team identity/settings. Spaces owns custody, context
admission, fixed roles, verified invitations, intervals, restrictive evidence and
account departure. Team roles are Owner (derived seat), Admin, Lead, Member and
Viewer. Lead has the existing work-manager delegation ceiling inside a Team;
only Owner/Admin may appoint Lead, and only Owner may appoint Admin. Lead may
invite/change Member/Viewer, never itself or a higher role. Project Manager and
Team Lead remain distinct persisted roles, validated against custody kind.

Teams reference existing Projects through typed links; both remain independent
custodies. Linking requires settings authority in both contexts, under sorted
account/custody fences. A reference grants no admission, role, source visibility,
directory, file or export access. Team Project lists intersect explicit references
with current Project full-member read authority before pagination. Grant-only
guests use existing named Project routes and gain no Team directory access.
No Project bodies enter Team receipts, audit, outbox or Personal feeds.
The owner explicitly confirmed multiple Team references per Project in this session.

New `/api/v1/teams` routes provide create/list/read/update, current memberships,
invitations, role/state changes and explicitly authorized Project references.
Separate `/team-invitations` preview/accept/decline contracts preserve all existing
Project schemas. Creation uses stable client UUID and Idempotency-Key; edits and
terminal commands use quoted positive If-Match. Strict Zod envelopes, current
verified sessions, Origin, no-store, safe 404/403, 409 conflicts and bounded
signed pagination follow existing conventions. Invitation proofs remain header-only.
Membership creation/replay, demotion, revoke and account erasure use the existing
atomic audit/outbox/usage and independently signed replay mechanisms.

Retention admission requires an immutable operator-approved policy explicitly
applicable to TEAM. A Project-only policy cannot create a Team. No actual policy,
key or activation setting is provisioned. The 30-day recovery rule is unchanged.
Team handover/archive/restore endpoints remain P3-05; current account-closure
denial and durable exit metadata already apply to every Shared custody.

Validation: targeted Team schema/domain/HTTP/PostgreSQL authorization, role,
invitation, generation/cursor, Project visibility, rollback and observed-lock race
tests; populated previous-release migration with checksum/data preservation,
interruption/repeat checks; mandatory 13-stage quality gate and compiled restart
smoke. Personal and Project regression contracts remain frozen. No P3-02 work.

## Implemented operation/authority matrix

Paths are under `/api/v1`; operation IDs are emitted by `teams-openapi.ts`.
Each protected call checks current account/session and custody/admission state
under the existing kernel fence. Tests live in `teams.spec.ts`; handler parity
is checked by `team-routes.spec.ts` against all 16 operations.

| Operation                                     | Operation ID                            | Authority / transition                                                                 | Integration evidence                                          |
| --------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| POST /teams                                   | teampostteams                           | verified active account; immutable TEAM retention; atomic independent create/replay    | creation, rollback, retention, HTTP                           |
| GET /teams                                    | teamgetteams                            | current full Team admission + read; signed page                                        | outsider/session denial, generation                           |
| GET /teams/{id}                               | teamgetteamsid                          | current full Team admission + read                                                     | roles, closure, outsiders                                     |
| PATCH /teams/{id}                             | teampatchteamsid                        | Owner/Admin settings; If-Match                                                         | Lead ceiling, HTTP, both update/revoke race orders            |
| GET /teams/{id}/memberships                   | teamgetteamsidmemberships               | full Team read; current pseudonymous membership data                                   | directory privacy, current roles, cursors                     |
| PATCH /teams/{id}/memberships/{accessId}      | teampatchteamsidmembershipsaccessId     | old AND new role administration; no self/Owner change; If-Match                        | Lead ceiling, suspension, generation, signed replay           |
| POST /teams/{id}/invitations                  | teampostteamsidinvitations              | Owner appoints Admin; Owner/Admin appoint Lead; Owner/Admin/Lead invite Member/Viewer  | distinct catalogs, delegation, exact recipient                |
| GET /teams/{id}/invitations/{offerId}         | teamgetteamsidinvitationsofferId        | current offer-role administration in exact Team                                        | shared invitation regression and HTTP contracts               |
| POST /teams/{id}/invitations/{offerId}/revoke | teampostteamsidinvitationsofferIdrevoke | current offer-role administration; If-Match; terminal revoke                           | shared invitation regression, current issuer                  |
| POST /teams/{id}/leave                        | teampostteamsidleave                    | own admission; If-Match; succession/last-member safeguards                             | self-departure, Owner protection                              |
| GET /teams/{id}/projects                      | teamgetteamsidprojects                  | Team read AND each Project's explicit full read; filter before pagination              | multiple references, grant-only denial, hidden Project/cursor |
| PUT /teams/{id}/projects/{projectId}          | teamputteamsidprojectsprojectId         | Owner/Admin settings in both custodies; stable pair; current revision for changes      | both authorities, free usage, cross-custody revoke race       |
| DELETE /teams/{id}/projects/{projectId}       | teamdeleteteamsidprojectsprojectId      | same dual authority; If-Match; deactivate reference only                               | multiple references, stale revision, parent preservation      |
| GET /team-invitations/preview                 | teamgetteaminvitationspreview           | header proof + current issuer/expiry; generic label only                               | exact recipient, Project-route denial                         |
| POST /team-invitations/{id}/accept            | teampostteaminvitationsidaccept         | verified exact recipient; current issuer, proof, expiry, revision; explicit generation | acceptance replay, rejoin, forwarded proof, HTTP              |
| POST /team-invitations/{id}/decline           | teampostteaminvitationsiddecline        | same current recipient checks; terminal decline                                        | shared invitation regression and contract parity              |

POST success is 201; other methods return 200. DTOs reject unknown fields.
Creates require 1–128 printable ASCII Idempotency-Key; initial reference PUT is
idempotent by its typed pair and requires no key. Existing-reference updates and
unlink require current If-Match; already-active initial PUT replay reauthorizes
without effects. Lists default 25/cap 100, order by opaque ID, and return only
items/nextCursor. Team/Project membership versions, admission generations and
reference revisions bind cursors. Proofs are 256-bit/header-only, lifetime seven
days, returned once, stored hashed. Existing per-IP/actor/context invitation limits
apply unchanged (30/IP/minute, 20/actor/minute, 20 offers/context/minute).

400 invalid envelope/header/cursor; 401 invalid session; 403 denied capability,
activation, Origin or retention; 404 safe absent/wrong context/proof; 409 stale
revision/generation/cursor/idempotency/state; 429 abuse limit. Audit/outbox record
opaque IDs/actions only; no new event consumer or queue is introduced. Existing
bounded invitation maintenance handles Team expiry. Existing generic Project
collaboration routes reject Team custody rather than emitting Project-shaped Lead
responses. Team handover/archive/restore and Team work remain their later batches.
