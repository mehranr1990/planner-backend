# 0043: Defer executable Company custody transfer; stabilize independent affiliation

## Owner-approved P1 exception, 2026-11-24

The owner explicitly authorizes **only** `INDEPENDENT_TEAM → COMPANY_OWNED_TEAM`
to resolve Platform Admin P1. This paragraph supersedes the execution deferral
below for that direction alone. Independent affiliation remains a separate,
revocable operation and must not be relabeled as custody.

Reuse ordinary Independent Team provisioning. Add the ordinary Team
`company-custody/preview`, `company-custody/{transferId}/consent` and
`company-custody/{transferId}/apply` commands. A 30-minute immutable dependency
manifest, both current owners' explicit consent and the affected participant's
explicit destination admission consent are required. Each acceptance uses current
provider password verification; apply reauthenticates the source Owner and requires
all consent evidence to be at most five minutes old. Company root and designated
Department/Unit admissions must already be explicit, current and generation-bound.
Admin authority never substitutes for these ordinary consents.

The supported mapper admits an ordinary-created Team with its one original active
Owner, compatible captured source/Company retention policy and no additional work,
invitation, resource, membership-history or external dependency graph. Other graphs
are ineligible with typed errors; no records are silently omitted or destroyed.
This is an implementation eligibility boundary under the owner's instruction to
reject graphs that cannot be safely reconciled, not approval to erase them.

Preserve Team/scope ID, metadata, original author IDs, audit bytes, policy and
historical admission intervals. Move the actual scope into Company custody under
`CompanyCustodyTransfer`/`DomainScopeCustody`; historical actors become explicitly
non-authorizing and map to existing canonical Company actors. The consenting Owner
receives a new, explicit child admission bound to their accepted Company root.
Retire only the empty independent physical boundary after its graph has moved,
retaining immutable transfer provenance and signed restrictive retirement evidence.
No fake child physical Space, creator reassignment or automatic Company-owner
content admission is permitted.

Apply is atomic under the existing sorted Personal/account/identity/custody locks.
Revalidate the manifest, permissions, generations, policies, lifecycle and suspension
after locking. Only nine enumerated identity FKs may defer during this relocation;
all constraints must validate before commit. Published migration bytes remain intact.
Audit and durable notifications commit with the result. Same-input retries return
the stored result only after current authorization; old snapshots fail closed and
cannot resurrect the retired independent root.

The resulting Team uses the existing seven-day scoped closure/recovery contract.
Its worker may dispose only its own leased scope after intersecting the captured
source policy, captured Company policy and current Company policy. Holds,
obligations, retention deadlines, live membership and unresolved references block
disposal. Bounded owner-module cleanup preserves the Company, other scopes and
canonical Company actors. Before removing transfer provenance, retain the immutable
custody witness in the terminal lifecycle job and signed lifecycle evidence.
The reviewed P1 disposal path does not authorize a root-wide purge, another domain
kind, or disposal of unresolved/general transfer evidence.

Company-to-Company movement, child detachment, Company-to-independent movement,
Project transfers and all other arbitrary custody transitions remain prohibited.
No general transfer executor, commercial seats or Guest access is authorized.
The current task remains Platform Admin P1 only; no P2–P7, frontend, production
migration, deployment, commit or push is authorized by this exception.

Implementation/verification status is recorded in
[the P1 work record](../platform-admin-p1-work-record.md); approval of this exception
does not establish successful acceptance before its tests and final gates pass.

Status: **APPROVED by the owner for local P4-06 stabilization, 2026-11-08**.
Authority: the owner's scope-deferral instruction and subsequent preservation and
finalization clarification. This supersedes only the requirement to complete
actual Company-child custody transfer in P4-06, not its safety requirements.

## Accepted P4-06 boundary

Finalize Company lifecycle, archive/restore, authorized Owner handover,
sole-custodian closure, recovery and controlled policy-governed disposal.
Finalize bilateral administrative association and separately authorized,
revocable attachment of independent Projects and Teams.

Both approving Owners must retain current Company-root and designated
Department/Unit admissions under the existing association contract. Other source
members do not need Company membership. Source custody, membership, historical
audiences, files and independently owned references remain unchanged. Company
membership never implies Project/Team access. Association and attachment remain
distinct operations and neither is a custody transfer.

## Preserved preparation and deferred execution

Preserve completed functionality, scope-aware authority, isolation, compatibility,
source-owner graph facades, consent/provenance schema, lifecycle safeguards and
reusable preparatory work. Preserve all existing data and historical SQL artifacts.
M034–M038 have already been exercised/applied locally. Retain the existing reviewed
M039 representation expansion and verify it as preparation in isolated local
upgrade/rollback rehearsals; it does not authorize a data transfer or activation.

Except for the narrow P1 Team exception above, no transfer preview/consent/apply
HTTP workflow, coordinator or worker executor is enabled. Independent-root mutation
guards remain outside the reviewed one-way Team relocation. Dormant schema and
owner-facade primitives do not constitute an accepted executable transfer.
Preserve the fail-closed disposal fence for unresolved transfer evidence.

Outside the P1 exception above, actual whole-root migration, participant admission migration, historical actor
remapping, confidential-audience migration, advanced collaborator scenarios and
transferred-child lifecycle/disposal acceptance are deferred to a separately
authorized enhancement, without assigning it to Phase 5. ADR 0040 remains the
approved future design. Its consent, privacy, retention, atomicity, fencing and
recovery gates must all pass before execution can become reachable; complexity
does not permit bypassing them.

ADR 0039's lifecycle and affiliation decisions remain binding. Its actual-transfer
section is deferred. ADRs 0041 and 0042 and their compatibility tests remain;
Company response variants are unavailable through this release's independent
affiliation workflows. Preserve the original independent branches and baselines.

Incomplete transfer-only code or draft SQL must not be destructively changed,
removed or excluded without reporting exact files, reasons and impact and obtaining
owner approval. No reset, deletion of existing source data, historical migration
rewrite or discarded approved documentation is authorized.

## Local acceptance

- Current bilateral Owner/context authorization; distinct association/attachment;
  one active Company association per independent source; no implicit admissions.
- Source membership/custody and historical content remain independent through
  attachment, revocation, Company departure, archive/restore and disposal.
- Existing authorization, resource isolation, stale receipt/revision fencing,
  concurrent operations, recovery, retention, file and audit safeguards pass.
- Preserve all published SQL, protected local artifacts and frozen API baselines;
  verify additive populated upgrade, transactional rollback and repeat deployment.
- Outside the approved P1 exception, verify absence of executable custody-transfer
  routes and preserve independent-root guards. Run targeted tests, the mandatory 13-stage quality gate once, and
  fresh compiled API and worker restart smoke; fix failures with affected reruns.

Local acceptance covers only this amended boundary. Shared activation, production
policies, Docker/release gates and production deployment remain deferred. Leave
P4-06 unstaged, uncommitted and unpushed. Phase 5 is not authorized.

## Local acceptance baseline selection, 2026-11-08

Independent inspection found pre-existing M031 checksum/schema drift in the old
local test database. The owner explicitly approved a separate verified local test
baseline while preserving that database unchanged. The final acceptance uses the
new canonical baseline with all SQL checksums verified; protected environment files,
historical migrations, old data and ledger remain untouched. See the
[final acceptance report](../p4-06-final-report.md#approved-canonical-test-baseline).
This environment decision changes no product scope, permission, retention rule or
production/activation boundary, and authorizes no repair of the legacy database.
