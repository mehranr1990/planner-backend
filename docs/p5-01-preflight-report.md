# P5-01 preflight checkpoint (historical)

The owner subsequently approved all three recommended policies in ADR 0045.
The blocker below records the preflight checkpoint only. Implementation resumed
under the existing P5-01 authorization; see the final P5-01 report for current status.

Batch: **P5-01**. Status: **BLOCKED on conversation product policies**, 2026-11-08.
Documentation work is complete; Messaging Foundation implementation has not started.

## Verified baseline and completed work

- Branch `main`; local HEAD, local `origin/main` and live remote `refs/heads/main`
  all equal `8ab53e6c5d6acb973c64f81ad27ccd4e01e25fe8`. The initial sandboxed
  remote query could not connect; the read-only escalated query succeeded.
- Initial tracked tree and index were clean. Recorded preservation hashes for all
  12 unrelated untracked documents, 64 migration artifacts (63 SQL files plus the
  migration lock) and five environment files in ignored
  `.tools/p5-01-preflight.json`. These artifacts remain unchanged.
- Read the root engineering/implementation/agent instructions, relevant V3
  messaging/architecture/quality/decision contracts, ADRs 0024–0026, 0031, 0034,
  0043 and the prior final acceptance/canonical-baseline procedure. Inspected
  identity/session authorization, Shared authority/capabilities/Company access,
  owner public exports, outbox, worker/jobs, notification and private-file seams.
- [ADR 0044](adr/0044-phase-5-rest-polling-and-realtime-deferral.md) records the
  owner's approved REST/incremental-polling amendment, independent Push
  Notifications and retained **DEFERRED P5-04**. Updated V3 feature registry,
  specification, batch roadmap and acceptance requirements. Other historical
  transport references are superseded explicitly by that ADR. The original
  package checksum manifest remains provenance and has not been regenerated.
- [ADR 0045](adr/0045-conversation-admission-and-history-policy.md) contains three
  concrete, unapproved policy choices: admission consent; role/delegation matrix;
  work-channel prior-history visibility. Questions were submitted to the owner.
  No proposed policy is treated as approved.

## Blocking decision and next implementation plan

ADR 0025 explicitly separates conversation participation/history from context
membership; existing Task/comment/directory permissions cannot authorize it.
The V3 specification leaves work-channel history to an authorized policy. Selecting
who can enroll/read/speak/manage or disclose pre-join content would invent product
rules, contrary to the kickoff and AGENTS.md sections 1 and 5.

Only those unresolved rules block implementation. Do not ask again about the
approved 48-hour edit/delete rule, ordinary technical choices or Phase 5 transport.
No retention duration is invented or requested for this foundation preflight.

After the owner resolves ADR 0045, continue the already-authorized P5-01:

1. Record the chosen permissions and executable endpoint/acceptance contract.
2. Add the Messaging owner, typed source-context relationships and conversation /
   participant / durable ordered text records. Preserve separate source membership,
   participant generations, attribution and custody; use owner facades only.
3. Add creation/membership/send/list/history/incremental REST contracts through
   Zod/OpenAPI. Reuse identity, fences, idempotency, audit/outbox and usage seams;
   reauthorize receipt/cursor replay and exclude body text from generic evidence.
4. Review additive SQL, constraints and preservation/rehearsal coverage. Follow
   the approved isolated canonical-baseline procedure; never use or repair the old
   M031-drift database as acceptance evidence. No database was accessed or changed
   in this preflight, and the recorded baseline has not been freshly DB-verified.
5. Run targeted security/concurrency/retry tests during development; the full
   13-stage `pnpm.cmd quality` gate once near completion, plus required migration
   preservation/rehearsal and fresh compiled API/worker smoke. Report actual results.

## Files and contracts

Changed tracked files, under `MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/`:

- `01_MASTER_FEATURE_REGISTRY.md`
- `03_PHASE_2_TO_7_BACKEND_SPEC.md`
- `05_BATCH_ROADMAP_AND_QUALITY.md`
- `12_COVERAGE_AND_GATES.md`

New unstaged documents: this report and ADRs 0044 / 0045. Existing archive text is
changed only at the relevant Phase 5 passages; archive-wide formatting is excluded
by the repository's existing `.prettierignore`.

Files/modules changed: documentation only. Entities, migrations and constraints:
**none**. API contracts, domain events and jobs: **none added or modified**; generated
OpenAPI and frozen baselines unchanged. Security: no runtime authorization changed;
undecided permissions remain unimplemented. No dependency or infrastructure added.

## Verification and limits

- `git ls-remote --heads origin refs/heads/main`: **PASS**, accepted SHA above.
- `pnpm.cmd exec prettier --check docs/adr/0044-phase-5-rest-polling-and-realtime-deferral.md docs/adr/0045-conversation-admission-and-history-policy.md docs/p5-01-preflight-report.md`:
  **PASS**.
- `git diff --check`: **PASS**.
- `node .tools/p5-01-verify-docs.mjs`: **PASS** for all preservation hashes, unchanged staged
  index, ADR/report relative links, retained P5-04 DEFERRED marker, polling/Push
  requirements and explicit PROPOSED status for ADR 0045.
  The first inline assertion attempt failed because PowerShell's stdin encoding
  replaced a Unicode separator. Corrected that inserted roadmap separator and ran
  the assertions from a UTF-8 file; no product assertion or runtime code changed.
- **NOT RUN:** implementation tests, the 13-stage quality gate, DB checksum/catalog
  verification, migration rehearsal and compiled API/worker smoke. Runtime/schema
  implementation is blocked and no runtime/schema file changed; documentation-only
  checks apply to this completed work item. P5-01 acceptance remains unfulfilled.
- **DEFERRED / NOT RUN:** P5-02+ features, P5-04, Docker/release-only gates,
  Shared activation and deployment. No production or existing local DB changes.

Deviations from binding specs: only the explicitly approved transport amendment
in ADR 0044. Outstanding issues: owner choices in proposed ADR 0045.

Git status: four modified tracked documents and three new task documents, all
unstaged; the original 12 unrelated untracked documents are preserved. Index empty;
nothing committed or pushed. Ignored preservation evidence is not staged.

Next allowed action: resolve ADR 0045, then resume P5-01 under its existing
authorization. Next eligible batch after accepted P5-01: **P5-02 — NOT STARTED;
requires explicit authorization**. No later batch has been started.
