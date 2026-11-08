# 0040: Whole-root transfer into Company custody with domain child scopes

Execution amendment (2026-11-08): [ADR 0043](0043-company-transfer-deferral-and-stabilization.md)
preserves this approved future design and reusable preparation, but defers actual
execution and transferred-child acceptance beyond P4-06. No transfer is enabled.
The original design and acceptance requirements below remain preserved.

Status: **APPROVED by the owner for local implementation, 2026-11-07**.
The owner approved the Company-child-scope direction, retained Project/Team role
catalogs and explicit participant admissions, and requested this detailed
migration/consent ADR before execution. This approved design records the necessary
contract changes. The owner explicitly approved ADR 0040 as written after reviewing it; implementation and verification remain required.

Authority: [ADR 0039](0039-company-lifecycle-association-and-transfer.md), the
owner's subsequent architecture selection, [ADR 0024](0024-typed-personal-and-shared-custody.md)
and the V3 [source-owner engineering contract](../../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/11_PRODUCTION_ENGINEERING_CONTRACT.md).
The [phase specification](../../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/03_PHASE_2_TO_7_BACKEND_SPEC.md)
requires an owner-reviewed ADR for changes to source owner semantics.

## Why an independent-root transfer cannot simply be enabled

The current `SharedAuthority.require` matches Space/capability without matching
scope. Two Projects inside a Company would therefore share the same authority
lookup key. Existing Project/Team owner facades and cleanup paths often use root
IDs as Space IDs and delete by Space. Enabling child-custodial data before those
contracts change risks cross-Project reads or Company-wide disposal.

`shared_domain_root_guard` makes Project/Team custody IDs immutable and requires
the matching independent custody kind. Team additionally requires ID = scope ID
= Space ID. Company child roles currently use only the Company catalog and bind
to an explicit root admission generation. A root reassignment cannot satisfy
those constraints, retain domain role catalogs or preserve historical audiences.

## Approved target and authorization contracts

1. Preserve Project/Team IDs as their new typed AccessScope IDs. Their Space ID
   becomes the destination Company Space. Each new domain scope records its
   explicitly selected Department/Unit relationship without widening its audience.
   Independent roots retain their existing representation and API behavior.
2. Add a typed scope-custody record for each transferred domain scope. Company is
   the data custodian; the consenting original source Owner retains scoped
   administrative Owner authority. A Company Owner's administrative custody does
   not itself create a Project/Team admission or content permission.
3. Make internal authority lookup require the complete `(spaceId, scopeId,
capability, optional typed resource)` identity. Update every source facade,
   report/portfolio, Calendar/Personal projection, file path, grant and receipt
   consumer before enabling transfers. Company-root authority must never satisfy
   a domain child request. Keep historical HTTP signatures and opaque source IDs.
4. Select fixed roles and policies by the actual scope's domain discriminator.
   Retain Project and Team catalogs rather than translating ADMIN/MANAGER/LEAD
   into Org Admin or other Company roles. Company root eligibility, hard denies
   and explicit admission bindings remain additional restrictions.
5. Source-scope archive/restore/departure/closure and cleanup operate on that scope
   only. Parent archive restricts effective access without overwriting a child's
   own archived state. No child lifecycle command may target the Company root.

## Explicit consent and admission

Use a durable whole-root transfer record and immutable hashed dependency manifest.
Keep separate consent records for source Owner, destination Company Owner and
every affected participant whose data or rights move. Bind each consent to the
manifest hash, current verified identity, original admission generation and exact
proposed destination admission/role. Consent is never an implicit invitation.

Require any needed Company-root membership to be accepted through the existing
Company invitation contract first. Each participant explicitly accepts their
domain child admission and retained domain role. A Company Owner may approve
custody without receiving source-content membership. Do not auto-create Company
roles or infer Project/Team participation from Company membership.

Include active/suspended, departed and historical participants in the impact
manifest. If consent required by ADR 0039 cannot be obtained, block that unit;
do not silently exclude its records, deem an erased person to have consented, or
invent a legal substitute. Any exceptional lawful disposition requires its own
owner decision. Do not enable a transfer with unresolved affected-person entries.

## Attribution and historical audiences

SharedActor is boundary-local and has one live actor per user/Space. Several
independent actors may converge on an existing Company actor. Preserve original
opaque author IDs and original source provenance through a typed historical
actor/admission mapping; historical aliases confer no live authorization.
Introduce an explicitly non-authorizing historical actor representation rather
than falsely marking a living participant ERASED or retaining duplicate live
Company identity links.

Keep immutable historical admission IDs/generations and authored payloads. Map
current, explicitly consenting destination admissions separately. Task assignee,
workflow reviewer, confidential Team case subject/respondent/disclosure audience
and file-reader checks must recognize only their exact consented mapping, after
current root/child authorization. Mappings never broaden an original restricted
audience. Any graph whose attribution or audience cannot be mapped blocks apply.

## Manifest, migration and transaction protocol

- Enumerate all source-owned Task/Goal/Calendar/workflow/assignment/case/document/
  file/history/audit/usage/receipt records and every incoming reference. Include
  row IDs/revisions, immutable payload hashes, actor/admission mappings, original
  retention obligations, file hashes and the complete destination authorization.
- Preserve independently owned referenced Projects/Teams and all existing
  cross-Team references. Project financial anchors stay Company-owned financial
  evidence; only their Projects-owned source bridge may be updated. Existing
  association/attachment history needs a reviewed provenance-preserving disposition
  rather than deletion to bypass its independent-root foreign keys.
- Use the approved 30-minute read-only preview, owner/participant acceptances,
  manifest hash, idempotency and five-minute provider reauthentication. Rebuild and
  compare the complete graph under sorted account, identity, Company and source
  locks before any effect. Unknown dependencies, changed audiences, policy,
  admissions, ownership, revisions or consent fail closed.
- Produce separate additive migration artifacts: first expand scope-aware
  authority/custody/provenance contracts while preserving independent roots;
  then enumerate the exact transfer-required FK deferrals and guarded custody
  update paths. Keep all 57 published SQL artifacts immutable. No blanket trigger
  disable, global FK relaxation, schema reset or source cloning.
- Guard location updates with a current reviewed APPLYING transfer manifest and
  the complete transaction-local authorization. Move the whole enumerated graph
  atomically, retaining IDs, immutable payloads and original obligations. Verify
  every deferred FK and hash before commit. Rollback leaves the original graph
  intact; a committed APPLIED receipt is authoritative for replay. No physical
  file copy or external send inside the transaction.
- Retire the original independent custody only after no owned resources remain,
  retaining minimal immutable provenance and restrictive restore evidence under
  the captured policy. No other independent boundary enters the disposal graph.
  A reverse transfer is a new reviewed workflow; never an automatic rollback to
  an independent-only release.

## Retention, disposal and recovery

Preserve the original policy version and unresolved obligations per transferred
scope. Destination policy cannot silently shorten them. Parent Company disposal
must wait for every affected captured obligation and deadline, including scoped
files and audit evidence. No new retention duration is proposed.

Owner cleanup facades need explicit scope-bearing contracts, including joins for
history tables without a scope column. Default Space-wide cleanup cannot be used
for a single transferred root. Keep the exact FK catalog safeguard and bounded
file/row passes. Recovery advances admissions and invalidates old grants, offers,
receipts and mappings; no restore may revive pre-transfer source authority.
Ambiguous or missing signed provenance quarantines the affected Company/source.

## Required acceptance before any executable transfer

Full whole-root fixtures with multiple Projects/Teams in one Company; Company
Owner without source admission; all affected-person consents and exact mappings;
confidential Team audiences; independently referenced Projects and financial
anchors; historical actor convergence; immutable bytes/history; wrong-scope
Task/Goal/file/search/count/export attempts; owner/revoke/consent/apply races;
opposite-direction lock ordering; interrupted rollback and repeated apply; scoped
child disposal versus parent holds; restart/restrictive restore replay. Preserve
all published API signatures and run the final mandatory local gate once.

## Approval and execution status

The owner approved this ADR as written for local implementation. No further
approval of this architecture is pending. Scope-custody, strict scope-aware
authority, historical actor/admission mapping and scoped lifecycle/retention are
authorized within the existing local-only execution restrictions.

Preparatory scope-authority and owner-facade changes are implemented. The custody
graph migration, consent/apply workflow and scoped retention/recovery machinery
remain unfinished. The separate metadata-response amendment in
[ADR 0041](0041-company-custody-api-response-compatibility.md) was subsequently
approved by the owner and implemented. The derived portfolio identifier conflict
in [ADR 0042](0042-company-custody-portfolio-source-identifiers.md) was separately
approved by the owner as written on 2026-11-08 and implemented with bounded compatibility checks.
P4-06 remains partial until all required
behavior and acceptance evidence exist.
