# Phase 2 local security and retention review

Date: 2026-11-05. **Review COMPLETE; activation readiness remains PARTIAL.**
Scope: owner-requested focused review after accepting P2-07's completed local
implementation. This is local development only. Findings below do not revoke
that scoped acceptance or authorize implementation of another batch.

## Publication and preserved work

P2-07 was committed and pushed to `origin/main` as
`ee90abd053c9f310f1a0b4e8e6b465aa5a2e2861`. `git ls-remote --exit-code origin
refs/heads/main` matched local HEAD after the push. The commit contains exactly
90 reviewed files, including the five reviewed migrations and their matching
documented SHA-256 hashes. `git diff --cached --check` passed.

The publication manifest excluded all 12 unrelated files under
`docs/architecture/` and `docs/frontend-handoff/`. Those directories remain
untracked and untouched. Ignored secrets, local environment files, generated
output, private storage and `.tools` evidence were excluded. A scoped scan found
no configured local secret values or private keys in the selected files; the
three credential-pattern matches were existing synthetic loopback CI database
URLs. This is a scoped publication check, not a claim of exhaustive secret-scan
certification or hosted CI success.

This review was subsequently accepted by the owner. The owner later authorized
publishing it together with the four-item
[local security closeout](phase-2-local-security-closeout.md). That separate
publication does not authorize deployment, Shared activation or Phase 3.

## Current local safeguards

Read-only inspection used the existing loopback PostgreSQL connections, explicit
`BEGIN READ ONLY`, a five-second statement timeout and `ROLLBACK`. It performed
no migration, schema reset, policy provisioning or application writes:

| Target                       | Applied migrations | Matching artifact checksums | Shared state                                             |
| ---------------------------- | ------------------ | --------------------------- | -------------------------------------------------------- |
| Development                  | 24                 | 24                          | Shared tables not promoted to this schema                |
| Isolated test, public schema | 43                 | 43                          | Zero SharedCustody rows; zero SharedRetentionPolicy rows |

The loaded local configuration had no Shared security-acceptance reference,
active signing key ID or signing keyring. These settings were not changed.
`SharedKernel.enabled()` still requires privacy readiness, security acceptance
and an active signing key. Creation also checks signed control state, complete
immutable retention configuration, policy approval identity and executable PURGE
dispositions. No control namespace was initialized and no Shared boundary was
activated. Synthetic test fixtures do not constitute policy or release approval.

Existing accepted evidence was reused: [P2-07 report](p2-07-report.md), its full
gate log plus affected reruns, migration preservation and compiled API/worker
restart logs. The report records 1,075 distinct tests covered successfully after
affected fixes, including all 17 P2-07 integration cases. The original complete
gate exited nonzero; the affected reruns resolved its failures. No complete
suite was rerun for this review.

Current checks cover custody/account fencing, scoped grants and projections,
private-file access/publication, bounded export, consented transfer, Personal
identity detachment, recovery deadlines and one-use proof, held cleanup, bounded
25-file passes and unknown-reference blocking. Ordinary closing-state access
remains denied; delayed disposal never reopens access.

## Remaining local engineering and decision items

These items can be developed and verified with the existing local PostgreSQL,
private temporary directories and synthetic fixtures. They are **not** Docker
or off-host-only requirements. No runtime code or SQL was changed in this review.

| ID  | Finding and source                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Required local follow-up before activation                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | **Hold/obligation identity collision.** `shared-retention.ts` accepts duplicate UUIDs within/between holds and obligations. `SharedLifecycleService.advance()` filters both by `progress.releases[id]`, while `release()` identifies an item only by that ID. An in-memory probe accepted two ACTIVE holds with one ID; one ID release left zero pending holds.                                                                                                                | Reject duplicate IDs across the complete hold/obligation set before policy admission or release; add distinct regression coverage for within-list and cross-list collisions, malformed legacy configuration and independent releases. No new retention duration or legal basis is needed.                                                                                                                                                                                   |
| L2  | **Purpose/version/key-ID migration is incomplete.** SharedControl has its own versioned keyring and old-key verification. Personal ErasureControl identity digests/signatures and backup signing still use BETTER_AUTH_SECRET; their v1 formats do not carry a key ID. This falls short of the accepted G0 recovery/key-rotation plan.                                                                                                                                         | Introduce the planned purpose-specific versioned verification path with explicit legacy v1 support. Prove old control records, backup manifests and active Personal recovery proofs survive the transition; unknown IDs fail closed. Use synthetic keys only. Never rotate the current auth secret or invent production material.                                                                                                                                           |
| L3  | **Restrictive Shared restore replay is incomplete.** SharedControl.assertCurrent() rejects a DB version behind committed restrictive evidence. SharedKernel.reconcileControl() resolves uncertain intent outcomes using DB evidence; it does not reapply a committed revoke/closure lost from an older snapshot. The operator restore-replay command invokes only PersonalLifecycle.restoreReplay(). Shared control records carry no complete target state for general replay. | Complete the reviewed bounded Shared replay/evidence protocol and local coordinated snapshot rehearsal: restore older DB/files into a fresh owned target, retain current independent controls, prove quarantine, reapply revoked membership/grant/closure and deleted-media/identity restrictions, then verify safe reopening. Do not treat abort reconciliation as replay or simply bump versions. Any unresolved replay representation needs an approved design decision. |
| L4  | **Terminal Shared evidence disposal is incomplete.** The final lifecycle path retains detached SharedLifecycleJob and immutable SharedLifecycleEffect rows; SharedControl is append-only without policy-bound compaction/expiry. No bounded path disposes these retained artifacts under the captured accessAuditLifecycle rule.                                                                                                                                               | Define and implement policy-bound minimal-evidence disposal and safe control compaction/checkpointing, preserving restrictions for every still-admissible backup. Exact applicable periods and obligations must come from the owner/operator; do not copy Personal's 90-day evidence period or silently retain Shared evidence forever. Review any required migration separately.                                                                                           |

Policy clarification is also required before provisioning a real Shared policy:
`classRules.audience` and `exportAuthority` are validated/captured but not consumed
by ordinary active read/export authorization; active operations use capability
policy and all ordinary access during closure is denied. Confirm their intended
retained-content applicability and test that meaning before claiming class-level
audience/export enforcement. Do not silently alter approved active capabilities
or introduce retained-content access routes. `backupPolicyReference` likewise
records a reference, not proof that the referenced operational policy was executed.

Owner/operator input remains required for all five retention classes, applicable
market, accountable operator, legitimate holds/obligations, audience/export rules
and backup policy. PSEUDONYMIZE stays blocked until a specified reviewed algorithm
exists. PURGE still requires all current gates. No statutory obligation or new
policy value was inferred.

## Release-stage deferrals

**DEFERRED / NOT RUN until actual release:** Docker/Compose build, start, private
network/volume ownership and persistence; real encrypted off-host coordinated
backup/restore, physical backup expiry and independently protected current
controls; HTTPS/proxy/TLS/cookies/CORS/Origin in the deployment topology;
production-sized DDL timing, workload/soak and owner-approved SLO/RPO/RTO;
production secret provisioning, operational monitoring/incident and channel
delivery checks, controlled release migrations and hosted CI evidence.

Local restart/authorization tests do not satisfy these release gates. A future
local replay rehearsal does not establish off-host durability. No Docker/WSL,
infrastructure, deployment credentials or production hosting was installed or
provisioned. These deferrals do not block this local review; they still block
the applicable release/activation decisions.

## Verification and next authorization

- Publication: exact-manifest comparison, five migration hash checks, scoped
  credential scan and `git diff --cached --check` passed; push succeeded and
  remote SHA matched.
- `node .tools/phase2-readiness-readonly.mjs`: PASS, read-only connection and
  checksum observations shown above; no private values printed.
- In-memory SharedRetentionSchema/release-filter probe: reproduced L1; no policy
  or release was stored. This is a defect finding, not a passing regression test.
- Documentation: `pnpm.cmd exec prettier --check
docs/phase-2-local-readiness-review.md docs/phase-2-acceptance-summary.md` and
  `git diff --check`: PASS.
- Application, integration, migration and full quality suites: NOT RERUN; review
  changed documentation only and reuses accepted evidence. Release checks above
  remain NOT RUN. L1–L4 acceptance tests are not yet implemented or passed.

The exact next roadmap batch is **P3-01 — Independent Teams only,
membership/roles and authorized project visibility; Company association is a
future interface only, inactive until P4**, from the approved V3
[batch roadmap](../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/05_BATCH_ROADMAP_AND_QUALITY.md).
P3-01 is **NOT STARTED / NOT AUTHORIZED**. The immediate proposed work is a
separately scoped local security/retention closeout of L1–L4 and policy
clarifications; this review does not authorize a new implementation batch.
Live Shared activation requires separate explicit owner authorization and
completed prerequisites. No deployment or production database change occurred.
