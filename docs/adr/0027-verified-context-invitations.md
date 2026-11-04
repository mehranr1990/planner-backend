# 0027 / A04: Verified-account invitations

Status: APPROVED by owner for implementation planning, 2026-10-30.
Execution still requires explicit batch authorization.

## Decision

An invitation is an offer, never authorization. Invitation fields include UUID,
space/scope, typed membership-role or resource-grant offer, inviter access/generation,
target User ID or normalized pending email, SHA-256 proof hash, expiry, revision,
state and accepted actor/access reference. Generate random 256-bit proofs.

States: PENDING to ACCEPTED, DECLINED, REVOKED or EXPIRED. Lifetime is seven days.
Never log proofs or return them after initial delivery. Public preview reveals only
safe context label, offer category and expiry; invalid/revoked/expired proofs share
a generic public failure. No directory or membership discovery.

Acceptance requires an authenticated verified active account. Normalize email using
the existing identity-provider canonical behavior; lock/read current identity through
the identity owner so concurrent email change cannot substitute another recipient.
Use stable User identity after acceptance, never forwarding-token possession alone.

## Transaction and proposed routes

Under [0031](0031-shared-transaction-fencing.md): validate proof, target, state,
revision and database-time expiry; recheck inviter's current capability, delegation
and policy; validate the offered resource; create/update one admission and membership
or typed grant; commit outcome, receipt, audit and outbox together. Reject closing
contexts. Acceptance cannot elevate the offer or revive old admission generations.

Same-identity replay returns the existing safe outcome; another identity gets no
private result. The terminal invitation record prevents duplicate acceptance beyond
ordinary receipt expiry. Inviter demotion/revocation before acceptance denies it.

Proposed P2 routes, not existing OpenAPI operations:

- POST /projects/{projectId}/invitations
- GET /invitations/preview
- POST /invitations/{id}/accept
- POST /invitations/{id}/decline
- POST /projects/{projectId}/invitations/{id}/revoke

Carry proofs in a redacted header. Frontend invitation URLs may carry a fragment
for explicit submission; do not put the backend proof in logged query parameters.
Apply bounded actor/IP/context throttling and generic unknown-account responses;
numeric rate settings must be documented/tested with the implementation contract.

## Alternatives, migration and acceptance

Reject anonymous edit links, forwarded-proof identity replacement and identity checks
outside the acceptance transaction. Add invitation storage and only currently typed
offers; no auth-owned schema mutation. See [migration plan](../g0-implementation-prerequisites.md).

Required INV-01–10: forwarded/wrong-account proof, email-change race, inviter
demotion, expiry boundary, accept/revoke race, repeat acceptance, offered-role
overposting, enumeration and closure/invitation race.

Owner approval: explicit approval of revised A01–A08 for implementation planning.
