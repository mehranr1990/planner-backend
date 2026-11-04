# Backend Architecture & ADR Decision Register

## Approved direction — does not substitute for approved executable ADRs
- One identity; personal, professional and social memberships/connections are different relationships. Verified actor authorization = actor/account state -> explicit scope membership/narrow grant -> resource action/state. Default deny.
- Typed custody/shared-boundary kernel with separate Project/Team/Organization/Social Group domains. Not every Department, Activity, Conversation or UI view is a Space. Independent projects/teams own durable boundaries; company-associated resources use company custody and narrower typed permissions unless an approved exception. **Actual Prisma relational shape is OPEN TECH**. Preserve existing Personal Space identity, mandatory personal owner and composite FKs; no casual nulling of `ownerUserId` and no fake permanent user owner.
- Shared resource source IDs are stable. Task/Goal engine stays unified; cross-context projections/grants are not silent cloning or `spaceId` mutation. Authored-by != assignee != custodian != membership.
- Owner modules perform writes; owner facades/ports mediate other modules. Revocation races require transactional fencing and tested lock order. Existing personal sync receipts/feed/cursors are not automatically portable to collaborative space.
- Shared workspace administrative ownership transfer: add verified new member -> proposed grant -> new owner's explicit acceptance (and reauth where appropriate) -> audit and custody check -> old owner may exit. Protect last-custodian invariant. Resources stay in the same shared boundary; **moving the actual boundary/data** is separate and requires preview and approved migration.
- Personal account erasure and shared membership departure are distinct. Preserve others' data; pseudonymize retained shared authorship where lawful; revoke access and erase private files. Prevent resurrection through backup restore replay.
- Runtime modular monolith + PostgreSQL, existing pg-boss, outbox, StoragePort and OpenAPI; no premature new datastore/broker.

## Priority A — must be ADR-approved before P2 migration/code
| ID | Decision fixed at product level | Required engineering ADR/evidence |
|---|---|---|
| A01 | Typed personal/shared custody and domain-specific contexts | Compare subtype/discriminator model vs separate shared-boundary model; inventory every existing `Space` FK, `ownerUserId`, ON DELETE CASCADE, file and auth coupling; choose compatibility plan |
| A02 | Per-context membership; only explicit inheritance | Define effective membership, relationship to Teams and Companies, deny/override precedence, one active effective state, historic departure |
| A03 | Fixed roles + capability matrix + narrow resource grants | Endpoint/action matrix including viewer, manager, invite, edit, export, transfer, archive, erasure and nested file/search/count |
| A04 | Scoped verified-account invitations | High-entropy hashed token, deadline, target identity match, idempotent acceptance, revocation, re-check inviter; preview leaks no membership |
| A05 | Reference/grant vs real transfer | Typed links, same-Space FK constraints, what can be shared, transfer preview and dependent files/history/sync consistency |
| A06 | Account leaving/erasure in shared world | Custodian transfer vs lawful personal erasure, orphan prevention, deletion matrix, retained history, job recovery and restore fencing |
| A07 | My Tasks/Calendar projections | No copy, authorized per-context read, stale membership invalidation, accepted assignment to calendar display, configurable private Time Block |
| A08 | Revocation vs write race | Shared authorization version/fence, lock order, revoked cache protection, membership and DB transaction tests |

## Priority B — owner-approved ADR before corresponding implementation slice
| ID | Domain | Concrete requirement and remaining implementation choice |
|---|---|---|
| B01 | Project/Company ownership | Verified new member accepts ownership; original manager may then leave; distinguish administrative succession from custody/data transfer; plan role cap and pending transfer races |
| B02 | Task assignment | Acceptance state independent of task status; mandatory policy only for authorized organization context; decline/reassign history and notifications |
| B03 | Workflows | Immutable published versions, explicit migration of in-flight tasks, validation and audit |
| B04 | Dependencies | FS/SS/FF/SF, signed lag/lead, cycle detection, no automatic reschedule without explicit confirm |
| B05 | Custom fields | Typed schemas, unique IDs, scope, indexed bounded filters, compatible versioning, soft removal |
| B06 | Portfolio & workload | Authorized project-only time, capacity, fairness, no Journal/Mood/Focus private data leakage |
| B07 | Employee records | Sensitivity tiers, attachment access and retention, access audit, removal from organizational context |
| B08 | Recognition/discipline | Private default, strictly limited public disclosure if authorized, evidence, response/appeal, no automatic financial sanctions |
| B09 | Corporate expenses | Claim/approval/expenditure/settlement distinct; exact amount; budget effect and reversal, no double-entry pretense |
| B10 | Policy inheritance | Mandatory security non-overridable by ordinary admin; Default with authorized exception; Optional local choice |
| B11 | Chat retention/history | DM and work conversation policy, join-time history, edit/delete 48h, server enforcement, snapshots/backups and legal requirements; **specific retention days remain OPEN** |
| B12 | Chat transport | PostgreSQL source + REST history + authenticated WebSocket push; reconnect cursors, authorization, backpressure, topology/Origin; package/version OPEN |
| B13 | Voice | Duration <=2m, bytes <=10MB, whitelist MIME/real content validation, malware/safe processing, private retrieval and cleanup; permitted codecs OPEN |
| B14 | Split expense edits | Approved revision remains effective until proposed correction is re-approved; exact sum, disputes and settlement reconciliation |
| B15 | Entitlement seams | Per-owner usage meter, authoritative enforcement point, feature owner, count semantics and failure policy; all commercial denies switched OFF until activation, paid plan engine Phase 7 |

## Remaining product policy detail, to make implementation plans precise
- Project transfer: present selectable manifest of tasks, goals, files, dependencies, history and private exceptions; only authorized migration; no unrelated personal data.
- Lending/Lost & Found: borrower must confirm claimed handover; durable requested/accepted/handed-over/returned/closed + overdue/disputed/lost/damaged states. Missing/found notices can match but cannot prove ownership without claimant verification.
- Messaging ordinary author-edit <=48h. After that, delete-for-self only; others retain existing copy subject to retention/moderation/legal obligations. Delete-for-everyone within the first 48h is approved in DM and private groups, while work channels require authorized organization/channel policy permission; moderation redaction remains separate. Deleted-user authored messages may persist with anonymized/pseudonymized identity to preserve thread continuity, without leaking deleted personal profile.
- Albums: max single image 20MB as initial default (NOT unlimited); derived variants; quota meters and limit values editable via Phase 7 Admin after enablement. Voice: <=2 minutes and <=10MB.
- User-facing commercial policy currently free: 2 personally owned active projects is a future configurable **candidate** quota, **not enforced** now. Workspace-level paid tier with member cap is an approved potential model; exact prices/tiers/caps/checkout not approved.

## Unresolved implementation questions: DO NOT invent as approved facts
Exact Space schema choice and migration steps; comprehensive capability matrix per endpoint; any legal/jurisdiction-specific record retention floor; invitation and authenticated-phone lifecycle; backup deployment implementation; exact WebSocket library and infrastructure; true image/audio codecs and media scanning; numerical default storage caps beyond approved per-image size; precise project workflow/field schema; detailed billing tax/provider; exact plan prices, paid start date and number of seats; production rate limits. For each, default to current safe behavior, document alternatives and request one narrow owner decision before irreversible or security-sensitive implementation. Do not block unrelated planning docs over decisions that are only needed for later phases.

## ADR discipline
Create *proposed* ADR documents with context, current invariants, alternatives, consequences, chosen recommendation, migration/rollback and test plan. Keep all prior accepted ADRs (0001..0023 as present in repo) unchanged unless newly approved addendum explicitly authorized. Changes to Phase 1 erasure/identity must be treated as high risk and validated against actual schema and tests.

## Additional consistency gates from conversation audit
- **A06 privacy vs last custodian:** never implement last-owner restrictions as indefinite denial of lawful personal erasure. Formal succession, administrator-approved safe closure, retained shared attribution without identity, or account closure with held shared custody must be distinguished in an approved ADR.
- **A04 verified non-member vs full membership:** invitation is never authorization by itself. Define `verified_user`, `context_member`, `limited_resource_grantee`, `pending_invitee` as distinct states and clarify that all data-changing actions require authenticated verified user plus action permission.
- **B01 succession:** user preference is add member -> confer full administrative custody with new owner's acceptance and reauth -> previous owner explicitly leaves; moving records to the new user's Personal Space is NOT intended. Exactly one eligible continuing custodian and concurrent handover protection required.
- **B15 dynamic monetization:** do not postpone basic enforcement integration until Phase 7. Every create/invite/upload/resource growth endpoint in earlier phases must call a coherent, testable feature/quota decision seam; in current free-mode, deny only for objective safety/abuse/capacity limits, not candidate commercial tiers. Use versioned count ownership and atomic capacity reservations for future hard caps. Phase 7 supplies Admin plan configuration and commercial policy, not retrofitted scattered special cases.
- **Message `delete-for-self`:** hide from that user's ordinary conversation view, not from other participants, but define how search, exports, read receipts, backups and rejoin apply. `Delete-for-everyone` within 48h is an approved ordinary author action for DM/private groups, policy-gated for work channels, and must not mean untracked physical erasure. Apply controlled tombstones across normal history/search/realtime views while retaining only lawful audit/moderation records.
- **Phone lookup:** require verified registered phone before matching; do not advertise that Phase 1 currently verifies phone. Directory discovery needs anti-enumeration and opt-out mechanisms.
- **Company record vs Personal data:** personnel case files and discipline are company-custodial sensitive records, with restricted access and lawful retention, not general HR data exposed to Team Leads.
