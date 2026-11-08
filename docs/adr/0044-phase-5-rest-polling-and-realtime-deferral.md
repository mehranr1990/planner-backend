# 0044: Phase 5 durable REST polling; defer advanced real-time messaging

Status: **APPROVED by the owner, 2026-11-08**, for the scope amendment below.
Authority: the owner's Phase 5 kickoff request explicitly keeps Push Notifications,
requires frontend-driven incremental polling and defers P5-04. This records that
decision; it does not approve unspecified conversation permission policies.

## Decision and scope

Initial Phase 5 messaging uses durable REST APIs and frontend-driven incremental
polling. PostgreSQL remains authoritative for conversation participants, committed
messages and ordering. Preserve stable opaque conversation/message IDs,
per-conversation monotonic order, bounded cursor pagination/incremental retrieval,
client-send idempotency and safe retries. Recheck current authorization on every
request, including receipt replay and cursor use. Existing transaction fences and
durable event/outbox architecture remain mandatory; no external dispatch inside a
business transaction.

**P5-04 remains DEFERRED in the roadmap.** Do not implement WebSocket, Socket.IO,
presence, live typing indicators or real-time connection management. A future
adapter requires separate authorization and must use the same source permissions,
stable identifiers, ordered committed history and bounded catch-up. No dormant
transport implementation, extra broker, Redis or hosted messaging provider.

Push Notifications remain in scope for P5-03. Web Push/Service Worker delivery for
the PWA is independent of WebSocket; reuse the existing Notifications/jobs
abstractions where appropriate. This backend batch does not implement a Service
Worker or notification delivery.

Active sequence: P5-01 foundation; P5-02 advanced messaging; P5-03 authorized media,
delivery/read states and notifications; P5-05 meetings/decisions/announcements;
P5-06 privacy/lifecycle/security and final acceptance. Only **P5-01 execution** is
authorized by this kickoff. Later batches require explicit authorization.

## Specification and acceptance amendment

This decision supersedes the initial Phase 5 WebSocket/presence/typing requirements
in V3 documents 01, 02, 03, 04, 05, 10, 11 and 12. Their historical transport
descriptions remain future design records where not edited. The original package
manifest remains provenance for the supplied package, not a regenerated digest of
owner-approved amendments.

- P5-01 proves durable ordered text, idempotent sends, safe retry/rollback, explicit
  source and conversation authorization, bounded initial history and incremental
  polling with no gaps or duplicates, and cursor/replay denial after revocation or
  re-admission. Conversation participation is separate from context membership.
- Prove isolation for outsiders, pending/closed/departed actors, grant-only users,
  wrong Project/Team/Company contexts and Company association/attachment. Company
  administration does not imply access to unrelated conversations or source data.
- P5-04 socket, presence, typing, connection and fanout acceptance is **DEFERRED**,
  never reported passed or silently removed. Polling/retry/revocation acceptance
  remains mandatory. All other active batch requirements retain their boundaries.
- Preserve generated Zod/OpenAPI parity, frozen API baselines, additive migration
  preservation/rehearsal, targeted tests, the final 13-stage `pnpm.cmd quality`
  run and fresh compiled API/worker smoke as required by acceptance rules.

The existing approved 48-hour edit/delete policy is unchanged and remains P5-02
work. This amendment sets no retention duration, admission/management role matrix,
work-channel history entitlement or legal exception. Those policies must not be
inferred from the choice of transport.

## Migration and operational boundaries

This ADR itself changes no schema or runtime code. P5-01 migrations must be additive
and must preserve published SQL and existing data. The old test database's M031
drift remains untouched; use the approved separate canonical-baseline procedure
for future verification. Preserve protected environment files and the 12 unrelated
untracked documents. No Shared activation, production database change, Docker,
release-only work, deployment, commit or push is authorized.

Alternatives rejected by the owner: implementing sockets now; treating Push
Notifications as dependent on sockets; deleting P5-04 from the roadmap; making
ephemeral transport the sole durable message source.
