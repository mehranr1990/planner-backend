# P2-04 execution record

Status: **COMPLETE — local implementation scope; owner acceptance pending**.

Owner instruction: push the completed work through P2-03 and start the next batch.
G0–P2-03 was published as `d0945368169baf9f97669ba420847d949533715d` on
`origin/main`. Pre-existing `docs/architecture/` and `docs/frontend-handoff/`
files remain untracked and untouched. New P2-04 work remains uncommitted.

## Approved scope and execution plan

V3 P2-04 and ADRs 0024–0031 govern Task assignment/acceptance, primary assignee and
contributors, Personal work projections, selectable calendar overlays, assignment
policies and notifications. Preserve existing Personal APIs/DTOs, unified Task/Goal
sources, source custody, P2-02 invitations/membership and P2-03 Project contracts.
No Team/Company attachment or automatic organizational consent becomes executable
before the corresponding domain/policy exists. Shared activation remains gated by
operator retention, independent control, security acceptance and operational gates.

Implementation order:

1. Project assignment consent rules: Pending/Accepted/Declined independent of Task
   status, named current admission generation, reasoned decline, optimistic
   revision and retained reassignment history.
2. Reviewed M06 SQL/Prisma persistence for primary/contributor assignments and
   typed optional Personal scheduling references. Preserve all 32 existing
   migration bytes, old data and same-Space constraints.
3. Fenced assignment commands through Projects and existing Tasks/Spaces public
   facades; current policy and verified recipient checks; atomic receipts,
   audit/outbox, authoritative free-mode usage and owner-module notifications.
4. Separate authorized `/me/work/tasks`, `/me/work/goals` and
   `/me/calendar/overlays` contracts. Pending assignments expose only an authorized
   acceptance preview. Source filters, counts, deduplication and signed cursors
   share current visibility. Optional private scheduling requires explicit user
   action and retains user-controlled content after source revocation.
5. Strict Zod/OpenAPI and handler parity; targeted security, source-owner,
   timezone, revocation/concurrency, restart and populated migration tests. Run
   the full 13-stage gate once at batch completion, then affected reruns only.

No P2-05 workflow/dependency/custom-field work, source custody transfer, new
infrastructure, deployment or production database change is authorized here.

## Started implementation

`projects/domain/task-assignment.ts` implements pure consent and termination
transitions. Primary and contributor consent use the same recipient-generation
rule. Decline requires a bounded nonempty reason. Ending an assignment preserves
the original decision and response timestamp; a replacement requires new consent.
These functions do not grant authority: application integration must first fence
current account/session, custody, admission, policy and source visibility.

The accompanying unit tests cover both roles, foreign context/recipient,
readmission, stale/terminal decisions, reason validation, immutable history,
revoked pending work, clock validation and revision exhaustion. They are domain
proof only; no HTTP, DB, concurrency or whole-batch completion claim is made.

Initial targeted checks:

- `node node_modules/vitest/vitest.mjs run --project unit apps/api/src/modules/projects/domain/task-assignment.spec.ts`: **PASS, 15 tests**.
- `node node_modules/eslint/bin/eslint.js apps/api/src/modules/projects/domain/task-assignment.ts apps/api/src/modules/projects/domain/task-assignment.spec.ts --max-warnings 0`: **PASS**.
- `node node_modules/prettier/bin/prettier.cjs --check apps/api/src/modules/projects/domain/task-assignment.ts apps/api/src/modules/projects/domain/task-assignment.spec.ts docs/p2-04-execution.md`: **PASS**.

Continuation: M06, fenced application commands, 19 HTTP operations, authorized
Task/Goal projections, selected calendar overlays, optional typed private scheduling,
source-safe durable in-app notifications and OpenAPI compatibility are implemented.
All 17 targeted integration tests and 20 targeted domain/schema/route/migration
tests passed. The populated M05-to-M06 rehearsal preserved all 95 prior table data
sets and 32 historical checksums; exact rollback/resume/repeat passed. Compiled API
restart/fresh worker smoke passed. The final 13-stage quality gate passed once: 447 non-integration and 477 integration
tests. All five compiled restart smokes passed. See [final report](p2-04-report.md)
for commands, migration evidence and activation/release gates not run. P2-04 is
complete locally and remains uncommitted; P2-05 requires explicit owner approval.
