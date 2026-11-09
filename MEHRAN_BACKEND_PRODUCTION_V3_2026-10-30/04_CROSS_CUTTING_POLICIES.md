# Cross-cutting Backend Policies

## Permissions and privacy
- Authorization always server-side; UI feature hide is never access permission. Users may have roles in multiple unrelated Companies/Teams/Groups; union/precedence only across explicitly scoped grants, never inferred friendships or shared memberships.
- Public/discoverable group pages only expose approved metadata. Join always requires verified account and owner/admin approval. A non-member may be granted only a narrowly scoped resource role after account verification; this is NOT full Team/Company membership. Invitation preview may be anonymous read-only but RSVP, joining, chat, expense edits, file access and all writes require verified account and appropriate authorization.
- Verified email required for current feature admission; if phone verification is later introduced, never treat an unverified number as a discoverable authoritative identity. Search-by-email/phone must protect against enumeration and mass lookup; invite tokens hashed and bounded.
- List, counts, aggregates, search snippets, attachment URL/proofs, audit metadata, cursors, notification payloads and exports must all enforce current access.
- Personal Journal, Mood/Energy, personal Finance, private Focus metrics and private notes never become visible merely because person joins Company/Team/Group.
- Support/Admin access to metadata and audit is distinct from content access. Any evidence access requires case-bound authorization and audit; no universal impersonation.

## Atomicity and consistency
- All source mutations use owner command boundaries and optimistic version or locking discipline; idempotency for network-replayed actions; transactional outbox for post-commit effects. Validate actor rights within write transaction; revocation fence and lock ordering are mandatory.
- Cross-context references use typed targets with concrete ownership validation; never accept arbitrary `targetType`/`targetId` or body-supplied role/owner as authority.
- Shared tasks/goals/events retain source identities; task accepted into My Tasks/Calendar is a filtered view, optionally a private Time Block, not data transfer.
- Group expense submissions are pending until authorized approval, and only then contribute to exact split amounts; approved corrections go through separate review while prior effective version remains in force. Exact allocation sums; supported currency minor units; settlement is *record of acknowledgement*, not actual transfer. Optional user-approved posting to personal Finance is idempotent and independent.

## Data lifecycle
- Distinguish account closure, exit from membership, deleting personal-owned resources, archival, shared-custody closure, exporting personal data, authorized shared-boundary export, retaining legal/audit evidence, and backup expiry/replay. Use typed durable jobs and audit.
- Never delete shared data simply because its creator or project leader leaves; never indefinitely prevent lawful erasure of unrelated private personal data. Last-custodian reassignment or approved closure may block *transfer of custody*, but must not be implemented as perpetual denial of all personal-data erasure. Work out exception handling in ADR.
- Keep current P1-12 seven-day personal deletion grace and recovery semantics where applicable; do not silently extend personal sync into company data or reuse personal-only export as whole-company export.
- Shared author identity on retained conversation/history may be pseudonymized on account deletion; other participants' meaningful conversation context remains subject to retention, law and abuse policies. No backup data should become newly accessible without erasure replay/fencing.

## Messaging and storage

P5-06/approved ADR 0049: transport deferral does not defer durable REST recovery,
missed-message synchronization, device consistency or polling backpressure.
Private account-pair blocking prevents new DM contact and suppresses pair mentions
and Push, while preserving authorized history, personal safety actions and common
group content. Conversation/meeting lifecycle uses effective domain admissions,
the existing 30-day shared recovery contract and captured retention classes/holds;
Personal erasure remains independent. Structural media inspection is local evidence;
real malware scanning remains NOT RUN and a mandatory operational release blocker.

- Chat messages committed to PostgreSQL; REST readable history authoritative. WebSocket delivery is an optional, authorized post-commit projection; reconnect through bounded sequence/cursor. Revocation evicts subscriptions and prevents replay.
- Block is scoped mainly to direct contact/DM, availability/mentions; group common-membership history not automatically revoked, but content collapse/filter available to blocker and moderator policy independent.
- Ordinary edit <=48h from committed timestamp; beyond 48h delete for self only; within 48h author delete-for-everyone is allowed in DM/private groups; work channels require authorized organization/channel policy; after 48h ordinary author deletion is self-only. Retained edit revisions are separately policy-controlled. Report/moderation/takedown separate from user deletion.
- Private media uses StoragePort with per-message and per-member authorization and real type validation. Voice <=2 min <=10MB; images <=20MB original; thumbnails optimized asynchronously where supported; quotas from central metering, server-validated. All artifacts referenced by owner-bound file grants and removed by lifecycle jobs.

## Commercial boundary
- No monetization wall, no paid account requirement, no billing provider active before owner-approved commercial gate. Define ownership of quota units now, but **do not reject valid actions solely on future paid tier quotas**. Feature enabled/released and commercial entitled are separate flags. Distinguish user-owned project counts from memberships in others' projects; a Company and its users have separate entitlements.
- Platform admin may later create Plan versions, assign grants/discounts/trials, alter quota values (including storage per workspace), manually transition Workspace plans and activate enforcement. Versioned history and audited effective time avoid retroactive silent downgrades. Admin must not be able to circumvent privacy merely by altering plan.
- Future expired plan: safe read-only/export and account/billing management; no automatic data deletion. Non-quota-increasing updates require detailed policy during implementation, not blanket denial of erasure or transfer.

## Locale and time/money contracts
- Server stores stable UTC instants and IANA timezones/local dates where appropriate; preserve Jalali/Gregorian semantics and Saturday-first preference in client-oriented contracts. No timezone-naive recurrence changes. Never use floating point for monetary ledger/allocations; preserve ISO currency minor units and Toman/Rial display distinction.

## Operational and verification gates
- Every new schema/endpoint requires security isolation including guest, outsider, departed, closed, admin and concurrent actors; exact history and stale-URL prevention; idempotent retries; transaction rollback; validation; generated OpenAPI compatibility tests; migration-from-previous-release and recoverability.
- Final release gates: production container/compose start with persistent Postgres and private Storage, backups verified restore including erasure replay, email/push delivery environment, TLS/CORS/Origin/session protection, secrets, logging/alerting, accessibility and frontend integration smoke. Do not claim deployment ready from local unit tests.

## Additional safety and completeness notes
- Data deletion includes user-private data, retained shared authored content, financial evidence, private files, search indexes, message caches, exports, sync receipts and backups. Retention rules require legal applicability review; no universal legally required minimum can be declared without jurisdiction.
- Cross-space collaboration, shared exports and administrative intervention must not bypass the two-step email-change/session safety or Personal Space transactional erasure controls.
- For user-approved quotas/paid plans, do not treat legitimate safety upload limits (2-minute/10MB voice, 20MB/image, request envelopes) as commercially disableable quota values. Technical security caps and revenue tier caps are separate, and both are server-validated. Admin may adjust within engineering-approved hard upper bounds and audited deployment policy.
- Do not use the word `guest` to authorize unauthenticated mutation. A verified user may be a guest collaborator **by role**, with fewer resource rights than full membership.
- For Team/Company announcements, DM Block does not automatically alter shared channel membership; no direct mention/presence notification to blocker. Group visibility and moderation still apply.
