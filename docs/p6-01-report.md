# P6-01 completion report

Batch: **P6-01 — Connections, private Circles and Social Group foundation**.
Status: **COMPLETE for the approved local scope; pending owner acceptance**,
2026-11-11 (Asia/Tehran).

Baseline: HEAD, local origin/main and the independently queried published
origin/main matched `834df8d3a1d8e7df18886716f7c432b1c7570f76`.
All three policy recommendations in [ADR 0050](adr/0050-social-discovery-connections-and-group-admission.md)
were explicitly approved by the owner before affected implementation.

Scope implemented: opt-in exact verified-email discovery; private request consent;
mutual friend requests, acceptance, decline, cancellation and removal; existing
pair-block authority with atomic friendship/label termination; owner-private Circles;
private independent Social Groups, minimal opt-in discoverable previews, named
invitations, approved join requests, Owner/Admin/Member management, accepted
administrative succession and inherited departure/closure. Unblocking restores no
friendship, label or stale invitation. Common Group membership/content remains
governed by its current permissions.

Files/modules changed: new Social owner; narrow Identity, Messaging and Spaces
facades; Personal lifecycle registration; existing signed controls, worker and
shared cleanup catalog; Zod/OpenAPI contracts and compatibility freeze; migration,
rehearsal and focused security tests. No dependency/provider changes. The
[manifest](p6-01-change-manifest.json) records exact task paths and SHA-256 bytes;
its self-entry is explicitly exempt from recursive hashing. See the
[contract](p6-01-contract.md) and [traceability](p6-01-traceability.json).

Entities, migrations and constraints: six new tables and eleven FKs in additive
M045 (`202611110045_social_foundation`); final catalog 69 migrations, 245 public
tables including ledger and 777 FKs. Typed Personal/Group custody, normalized live
pair uniqueness, constrained states/roles, accepted-friend Circle labels and
generation/revision-fenced approval are enforced. Historical migrations are
unchanged. [Migration review](p6-01-migration-review.md) records the final hash,
rollback strategy and bounded Group-root disposal safeguards.

API contracts, events and jobs: 40 additive OpenAPI operations, 841 total and
7,649 resolved references. [Generated JSON](api/openapi.json) preserves released
signatures, including the newly frozen P5-06 delta. No Swagger UI/JSON route is
configured: compiled probes of `/api/v1/docs` and `/api/v1/openapi.json` return 404.
Existing actor-scoped receipts, metadata-only audit/outbox and pg-boss maintenance
are reused; the registered Social lifecycle consumer handles bounded Group cleanup.
Usage decisions count the effective custodian rather than the creator. No new
legal retention default or commercial restriction is provisioned.

Security and edge cases addressed: generic unavailable contact results, opt-out,
unverified/closed/revoked identities, private labels and directory fields, opposing
requests, stale revisions and proofs, wrong recipients, revoked inviters, role
ceilings, cross-Group IDs, concurrent block/accept and revoke/write, restore replay
for private settings/labels/Group visibility, safe partial updates, atomic rollback,
Personal portability and erasure, owner succession and last-member disposal.

## Verification

Exact commands, counts and raw-log hashes are in the
[machine-readable test evidence](p6-01-test-evidence.json).
Database commands used:
`node --env-file-if-exists=.env.test.local .tools/p6-01-baseline.mjs --run <command>`.
The final canonical database is
`p601_acceptance_985936cc5acf4b80ab817b1a8dcae73b_test`.
Owned draft databases were retained; corrected unpublished SQL was deployed only
to a new isolated baseline, without repairing/resetting an earlier target.

One full `quality` invocation ran all 13 stages. Its original exit was **1**:
the provider-schema checker needed exact application-inverse normalization,
the migration inventory needed M045, and cleanup correctly refused the old
766-FK catalog. All were resolved with affected passing reruns. The original
nonzero result is not relabeled a pass and the full gate was not repeated.

| Check                                                                                          | Actual result                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| config, client generation, schema validation, build, typecheck, formatting, lint, architecture | PASS; affected final source/tooling rechecked                                                                                                                                                                                                    |
| Provider schema                                                                                | PASS against the pinned official generator; exact reviewed application inverses excluded, provider columns/indexes retained                                                                                                                      |
| Original non-integration run                                                                   | 144 files / 715 cases: 714 passed, 1 static inventory failure; affected rerun passes and adds 2 strict provider-schema cases                                                                                                                     |
| Final contract/compatibility rerun                                                             | 3 files / 16 cases PASS, including exact registered route parity and partial-update privacy regression                                                                                                                                           |
| Original full integration run                                                                  | 45 files / 995 cases: 973 passed, 22 catalog-gated cleanup failures                                                                                                                                                                              |
| Affected integration rerun                                                                     | 7 files / 260 cases PASS, including all final 43 P6-01 cases and every original cleanup failure                                                                                                                                                  |
| Final migration rehearsal                                                                      | PASS: 238 predecessor datasets, 68 immutable checksums, previous constraints/functions except reviewed extensions, interruption/rollback, repeat deploy, exact 777-FK catalog                                                                    |
| Compiled API/worker smoke                                                                      | PASS: actual isolated processes and restart, discovery/consent, friend/block/Circle persistence, approved Group/private content, minimal previews, privacy-preserving rename, original DM ordering/replay/idempotency and held-source protection |
| Preservation / Git                                                                             | PASS: 8 protected database data/catalog snapshots, 5 environment files/examples, 69 historical migration artifacts, 12 unrelated documents; index empty                                                                                          |

Evidence proves **717 distinct non-integration and 997 integration cases
cumulatively**, using the one full gate and affected passing reruns. This is not a
claim that a second full 717/997-case run occurred. The initial added disposal
fixture was aligned with production's UTC database session. Smoke fixtures retain
all original assertions and reuse a separate pair among the existing verified
users, preserving the real authentication/contact rate limits.

Tests not run and why: production Docker/HTTPS/proxy, external SMTP/Web Push,
operational backup/restore, capacity/SLO/RPO/RTO and actual malware-engine integration
remain existing release gates outside this local batch. Deferred P5-04 transport,
Presence and Typing remain NOT RUN. Optional phone discovery remains disabled
because there is no approved verified-phone lifecycle (V3 PG-17).

Deviations from binding specifications: none beyond the explicitly approved
ADR 0050 choices and inherited local/realtime/operational boundaries. All six
Phase 6 batches and the owner's 45 selected capabilities remain planned; the
canonical registry does not enumerate those 45 IDs, so no mapping is invented.
**c09 is explicitly excluded**: no transfer, reassignment or assumption of another
person's debt, receivable or financial obligation. No financial, social-feed,
payment or P6-02+ feature was added.

Outstanding issues / ADRs: no unresolved P6-01 local requirement or policy decision.
Operational release blockers remain. Automatic approval review rejected an
assertion-weakening proposal and a dynamically discovered formatting pass; the
success assertion was retained with a due-job fixture, and formatting used an
explicit task-owned allowlist. Neither requires further approval or leaves work
blocked.

Git: all P6-01 changes remain **unstaged, uncommitted and unpushed**. HEAD remains
the published Phase 5 baseline above. Existing architecture/frontend handoff
documents are preserved. No deployment or Shared activation occurred.

Next eligible batch: **P6-02 — NOT STARTED; requires owner acceptance and explicit
authorization**. P5-04 realtime remains deferred. This batch stops here.
