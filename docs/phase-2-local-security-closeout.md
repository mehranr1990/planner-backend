# Phase 2 local security and retention closeout

Work item: **Phase 2 local security closeout (L1–L4)**, authorized after acceptance
of the [local readiness review](phase-2-local-readiness-review.md), 2026-11-05.
Status: **COMPLETE for the authorized local implementation and verification**.

## Implementation and invariants

| Item | Implemented behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Evidence                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1   | One unique ID namespace across every hold and obligation. Malformed legacy policies fail admission, release and disposal validation; an existing malformed cleanup policy blocks disposal. Releasing one distinct ID does not release another.                                                                                                                                                                                                                                        | Retention unit cases; distinct held cleanup and malformed-policy integration cases.                                                                                                                         |
| L2   | Optional versioned Personal keyring with separate control, identity-digest, backup and capability material. New envelopes identify version/key; v1 evidence and issued capabilities remain verifiable through retained keys. New deletion jobs retain their digest key ID. Unknown/missing required keys, tampering and purpose substitution fail closed.                                                                                                                             | Legacy control/backup verification, rotation, capability continuity, digest lookup and tamper tests; populated migration preserves old hashes and nullable legacy key IDs.                                  |
| L3   | Signed replay state is captured under the custody fence before DB commit, bound to the existing intent/effect ID, action and authorization version. Explicit replay accepts only committed, matching evidence. It replays membership/policy/custody restrictions, erases live Shared attribution links, invalidates old grants/offers/proofs and removes deleted private bytes. Work bodies, filenames, live User IDs and passwords are excluded from the independent replay payload. | Actual local pg_dump plus matching files restored into a fresh owned PostgreSQL schema while keeping current independent controls; revoke/policy/file, closure/recovery, identity and terminal purge cases. |
| L4   | Explicit bounded operator disposal checks the captured immutable policy, class deadline, holds/releases, terminal detached jobs and backup expiry evidence. A signed global restore cutoff precedes control/DB evidence removal. Older DB checkpoints and backup manifests fail closed. Minimal lifecycle effects retain UPDATE immutability and permit DELETE only through guarded terminal disposal.                                                                                | Retention/hold denial, direct-delete rejection, older-checkpoint denial, idempotency and interrupted-storage resume tests.                                                                                  |

Existing REST/OpenAPI contracts are unchanged. Personal seven-day recovery,
90-day erasure evidence and 30-day maximum signed backup lifetime remain those
approved in ADR 0023. Shared recovery remains exactly 30 elapsed UTC days.
No Shared retention duration, statutory obligation or production key was chosen.
Shared activation settings and local environment files were not changed.

Source work remains owned by Tasks/Goals/Projects and Storage. Replay changes
Spaces-owned authorization/lifecycle metadata through the kernel and invokes the
Storage public facade for deleted files. Private IO runs outside the replay DB
transaction; DELETED metadata already denies downloads, and retry resumes removal.
No new queue, infrastructure, dependency, HTTP route or deployment was added.

Checkpoint comparison uses UTC epoch values, independent of connection timezone.
Immutable signature verification uses a bounded cache with fresh directory/file
metadata checks and tamper rejection. A control view is reused only within one
already-fenced DB transaction; every new transaction reloads current evidence.
Current DB authorization and custody/account locks remain mandatory.

## Personal key migration

`PERSONAL_EVIDENCE_KEYS` is a JSON object keyed by a stable `[A-Za-z0-9_-]` key ID,
maximum 40 characters. Each value has exactly `control`, `identity`, `backup` and
`capability` secret strings of at least 32 characters. Every material value must
be distinct across purposes/versions and different from the live auth secret and
explicit legacy verification key. Select the writer using
`PERSONAL_EVIDENCE_ACTIVE_KEY_ID`.

When migrating existing v1 evidence, explicitly retain its old signing input in
`PERSONAL_EVIDENCE_LEGACY_KEY`. Once a keyring is configured, unknown IDs or absent
legacy material never fall back to BETTER_AUTH_SECRET. Installations without a
keyring retain their existing v1 behavior until an operator performs the migration.
No local secret was rotated or provisioned by this work.

Keep every referenced purpose/version key while active jobs, proofs, retained
records or admissible backups require it. A v2 control record preserves the
deletion job's digest key ID even if its signing key has since rotated. Legacy
hash columns and issued proof strings are not rewritten. Replay lookup considers
retained digest versions. Active recovery proof validation remains hash-bound;
idempotent challenge reproduction selects the candidate matching the stored hash.
Backup manifests keep their original payload contract, inside a versioned signed
envelope; the verifier still accepts old envelopes.

## Local restore and terminal disposal

Use only an explicitly approved isolated target and matching private file snapshot.
Keep current erasure and Shared controls independently protected; never restore
older controls over them. First verify the signed backup and run Personal replay
using the existing operator tooling. Then, after build and with the isolated
target's configured environment, run:

```text
node tooling/scripts/shared-lifecycle-admin.ts restore-replay <spaceId>
node tooling/scripts/shared-lifecycle-admin.ts dispose-evidence <retiredCustodyId> <expired-through-UTC> <approval-reference>
```

These are explicit operator commands, not startup actions. The existing `release`
command and its revision checks remain. No command was run against production.
Repeat pending commands: replay commits at most 25 effects and removes at most
25 files per pass; evidence cleanup removes at most 25 control objects and 200
effect rows per job per pass. Policy preflight and terminal job cleanup each process at most 200 generations
per pass, with persisted authorization fields supporting continuation.

Unresolved intents, missing/conflicting legacy replay state, erased identities,
missing successor admissions, changed admission generations and incompatible
immutable policy rows keep the affected restore quarantined. Do not replace
missing evidence with a version bump or mark uncertain restored effects aborted.
Select a compatible snapshot or establish the actual outcome through reviewed
operator recovery. Signed recovery effects never replay an old proof or revive a
membership: reopening a restored closure requires a new one-use proof and fresh
provider password verification within the original deadline. Terminal deletion
replay restarts the existing owner-controlled purge; it does not reopen content.

Disposal requires an explicit expiry approval reference and a watermark covering
all retained custody control records, terminal job scheduling evidence and effects.
The watermark must also be at least the existing maximum admissible backup
lifetime behind the present time. This protects still-admissible backups; it is
not a new content retention period or a claim that off-host files were deleted.
All recorded class retention/hold conditions must independently pass.

The independently signed global cutoff contains a timestamp only, with no custody,
actor, job or approval identifier. It blocks pre-cutoff restore even after all
custody-specific records are disposed. Later checkpoints compact older cutoff
files in bounded passes. A crash after writing the cutoff but before committing
the DB checkpoint keeps Shared restricted; rerun the vetted disposal command.
Immutable retention configuration remains a policy catalog, not a copied user
content archive; this work adds no speculative policy-catalog deletion rule.

## Migration review

Artifact: `202611050020_local_security_closeout/migration.sql`.
SHA-256: `7c4d216ab6896f7621f04d3d305c725ae06e20ec94ce8f833b5bfea87d46f101`.

The exact reviewed exception is registered independently from prior artifact
hashes. It adds SharedEvidenceFloor with its epoch checkpoint, nullable
AccountDeletionJob.evidenceKeyId and two nullable disposal-authorization fields
on SharedLifecycleJob, plus their checks. It replaces only the lifecycle-effect
guard function's DELETE branch and adds a terminal-job DELETE guard. UPDATE of
lifecycle effects remains forbidden. It changes no existing row, key, FK,
historical migration, owner branch or work schema. The cleanup FK digest remains
unchanged because no FK was added or changed.

The migration is atomic with five-second lock and 30-second statement timeouts.
The nullable additions are catalog expansion; new CHECK validation and function/
trigger DDL require normal release lock review. No configured development or
production schema was migrated. Existing test data was not reset. Isolated tests
apply the artifact and check interruption rollback, populated prior-schema upgrade,
repeat deploy, all 43 old checksums and all prior constraints. A compatible forward
correction is the rollback strategy; do not drop evidence or compatibility columns.

## Verification and release boundary

All applicable local gates passed across the single full run and affected reruns:
**1,089 distinct tests** (533 non-integration, 556 integration). This includes all
nine added closeout integration cases and the 17 existing P2-07 cases. No test,
timeout or required assertion was weakened or bypassed.

| Command / evidence                                                                                                                                                                                                                                                                                                                                                                                                                                     | Actual result                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd quality`, `.tools/p2-closeout-quality.log`                                                                                                                                                                                                                                                                                                                                                                                                   | All 13 stages executed once. Config, generation, auth schema, validation, build, typecheck, format, lint, architecture, 532 non-integration tests, OpenAPI and migration gates passed. The original overall exit was **1** because integration found timezone-dependent bootstrap checks and repeated control-store IO causing timeout/lock cascades. This log was preserved. |
| `pnpm.cmd test:integration apps/api/test/integration/project-tools.spec.ts apps/api/test/integration/shared-collaboration.spec.ts apps/api/test/integration/project-work.spec.ts apps/api/test/integration/project-execution.spec.ts apps/api/test/integration/project-core.spec.ts apps/api/test/integration/project-collaboration.spec.ts apps/api/test/integration/shared-personal-erasure.spec.ts apps/api/test/integration/shared-kernel.spec.ts` | **179 passed**, eight affected suites, 103.08 seconds after the UTC and bounded evidence-read fixes. No complete suite was repeated.                                                                                                                                                                                                                                          |
| `pnpm.cmd test:integration apps/api/test/integration/project-collaboration.spec.ts -t 'CLOSEOUT: (persists the Personal\|disposes\|disposal respects)'`, `.tools/p2-closeout-key-checkpoint-final.log`                                                                                                                                                                                                                                                 | **3 passed**: final Personal writer-key rotation/challenge continuity, cutoff checks and disposal restart. The added key-rotation case brings integration coverage to 556 distinct tests.                                                                                                                                                                                     |
| `pnpm.cmd exec vitest run --project unit --project architecture apps/api/src/modules/spaces/application/shared-retention.spec.ts apps/api/src/platform/lifecycle/personal-evidence-keys.spec.ts apps/api/src/platform/storage/shared-control.spec.ts apps/api/src/platform/observability/logging.spec.ts tooling/architecture-tests/local-security-migration.spec.ts`                                                                                  | **7 passed**; includes the added immutable-signature-cache tamper regression, bringing non-integration coverage to 533. Duplicate UUIDs are rejected irrespective of letter case.                                                                                                                                                                                             |
| `node --env-file-if-exists=.env.test.local .tools/p2-closeout-migration-rehearsal.ts`; final `db:migrations:check` stage                                                                                                                                                                                                                                                                                                                               | **PASS**: interruption rollback, resume/repeat deployment, 134 prior table data sets, all old constraints, all 43 previous checksums and legacy Personal proof hashes. The final full migration chain also passed.                                                                                                                                                            |
| `pnpm.cmd --filter @mehran/api build`; `pnpm.cmd exec tsc --noEmit`; affected ESLint; `pnpm.cmd architecture`                                                                                                                                                                                                                                                                                                                                          | **PASS** after affected fixes. One new test helper needed an explicit string type for uppercase UUID input; runtime assertions were unchanged. Architecture: 422 modules / 2,552 dependencies, no violations.                                                                                                                                                                 |
| `pnpm.cmd smoke:p2-07`; `pnpm.cmd smoke:p1-12`                                                                                                                                                                                                                                                                                                                                                                                                         | **PASS**: compiled API and fresh worker restart, P2-04–07 contracts/private files, Personal sync/export/attachment, closure persistence and recovery cancellation.                                                                                                                                                                                                            |
| `node .tools/phase2-readiness-readonly.mjs`                                                                                                                                                                                                                                                                                                                                                                                                            | **PASS** using read-only transactions: development remains 24/24 matching migration checksums; isolated test is 44/44, with zero Shared custodies or retention policies. Shared security-acceptance reference, active key ID and keyring remain absent in local configuration.                                                                                                |
| Scoped formatting, secret scan, migration-history check and `git diff --check`                                                                                                                                                                                                                                                                                                                                                                         | **PASS**; no configured local secret value or credential pattern found, no historical migration edited.                                                                                                                                                                                                                                                                       |

The new migration is the 44th artifact; the schema now has 135 domain tables.
API contracts, existing domain events and queue/job contracts are unchanged.
Cleanup preserves each generation's own hold-release evidence until its permitted
disposal. Scope deviations: **none**. Outstanding local engineering blockers or
new ADR decisions for L1–L4: **none**.

Git publication: the owner subsequently authorized commit and push of this
closeout and the accepted readiness review, on top of P2-07 commit
`ee90abd053c9f310f1a0b4e8e6b465aa5a2e2861`. The publication commit contains this
report; its resulting SHA and remote verification are reported in the publication
handoff. Unrelated architecture/frontend handoff files and ignored local secrets
and runtime artifacts are excluded. No existing database was reset, and no
deployment occurred.

Release-only blockers remain **DEFERRED / NOT RUN**: Docker/Compose topology and
persistence; actual encrypted off-host backup/restore and physical expiry;
production HTTPS/proxy/cookie/CORS/Origin topology; production load/soak and DDL
timings; production secrets, SLO/RPO/RTO, monitoring/incident/channel delivery and
controlled deployment gates. The new local dump/restore tests use the existing
matching PostgreSQL client (`pg_dump` on PATH, or the installed Windows 18 client);
hosted CI client availability/execution remains unverified locally.

Owner/operator retention configuration, legitimate obligations, jurisdiction,
accountable operators, actual security acceptance and key provisioning remain
activation inputs. PSEUDONYMIZE is still unsupported and blocked. Shared activation
remains disabled. The subsequent commit/push authorization does not authorize
deployment or activation. **P3-01 is NOT STARTED and requires separate explicit authorization.**
