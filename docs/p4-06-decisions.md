# P4-06 owner decision record

Status: **Original decisions RESOLVED**, 2026-11-07. The owner approved the rules
in [ADR 0039](adr/0039-company-lifecycle-association-and-transfer.md), selected the
Company-child-scope architecture, and approved
[ADR 0040](adr/0040-company-child-scope-transfer-design.md) as written for local
implementation. The original request below is retained as decision history;
its pending wording does not describe current approval status.

The owner also approved the metadata-response compatibility amendment in
[ADR 0041](adr/0041-company-custody-api-response-compatibility.md) as written.
The owner separately approved the two-response portfolio identifier amendment in
[ADR 0042](adr/0042-company-custody-portfolio-source-identifiers.md) as written on
2026-11-08. All currently recorded owner decisions are resolved; implementation
and acceptance remain required.
P4-05 is published at
`a33aa9c8e1d705521923fbe1653ecbca1f0af076`.

## Established requirements

The [V3 roadmap](../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/05_BATCH_ROADMAP_AND_QUALITY.md)
requires controlled attachment/transfer, separate preview/consent/migration,
handover, departure, archive, retention and cross-company recovery/security.
The [Phase 4 specification](../MEHRAN_BACKEND_PRODUCTION_V3_2026-10-30/03_PHASE_2_TO_7_BACKEND_SPEC.md)
requires accepted administrative succession without legal ownership transfer.

The owner's current instruction separates administrative association, attachment
and actual custody transfer. None may silently grant membership or disclose history.
Independent custody persists until an explicitly authorized transfer completes.
These requirements are settled and need no further approval.

[ADR 0034](adr/0034-company-foundation-roles-and-inheritance.md) defines Company
metadata administration and explicit root/child admissions, but reserves lifecycle
commands and attachment/transfer for P4-06. Its operation matrix does not assign
these new powers. [ADR 0026](adr/0026-capabilities-and-resource-grants.md) supplies
a Project matrix, expressly requiring other contexts' own role catalogs.

[ADR 0028](adr/0028-shared-references-and-custody-transfer.md) defines the
Personal-to-Project conversion protocol and dependency dispositions. It does not
define how an existing independent Team/Project and its admissions become
Company-custodial. The source [Project association contract](../apps/api/src/modules/projects/public/association.ts)
is non-executable for Company. The [Team lifecycle contract](p3-05-contract.md)
expressly excludes Company attachment/transfer.

## Original request (resolved by ADRs 0039 and 0040)

1. **Company lifecycle authority.** Recommended matrix: Owner/Org Admin may
   archive/restore; only the Owner may propose handover or request sole-custodian
   closure; the named eligible full root member accepts with provider-backed
   reauthentication. Child managerial roles obtain none of these root powers.
   Reuse existing seven-day handover expiry, 30-day shared recovery, revision and
   generation fences, proof requirements and last-custodian safeguards. Confirm
   this matrix or specify a different one. Retention stays under the existing
   immutable operator-approved policy; no new legal period or hold is proposed.

2. **Association versus attachment.** Specify who proposes, accepts, reads,
   detaches and cancels each operation; whether a source can be associated or
   attached to more than one Company; whether targets include Department/Unit;
   and the additional effect that distinguishes attachment from administrative
   association. The smallest recommended authority is bilateral source Owner and
   Company Owner approval, with explicit destination child admission when used.
   Recommend custody-preserving affiliation, independently authorized source
   reads and no automatic policy inheritance. Any stronger attachment effect
   requires an explicit rule, including effects of Company archive/closure on
   the independent source. Existing Project financial anchors and Team/Project
   references remain separate relationships.

3. **Actual shared-to-Company custody transfer.** Specify supported transfer units
   (whole Team/Project or selected resources), destination ownership/context,
   required participant consents, and admission/role/grant/history dispositions.
   In particular, decide how existing source participants retain authorized
   access under Company's explicit root/child admission rule, without silently
   granting Company membership or promoting Project/Team roles into Company
   administration. Define confidential Team case/disclosure and file audiences,
   outstanding assignments/approvals/financial references, incoming dependencies,
   retention-policy obligations and detach/reversal behavior. Recommend preserving
   stable source IDs and existing confidential audiences, rejecting unknown or
   unresolved dependencies, and requiring a separately reviewed transfer manifest
   and additive migration before enabling any case. The approved preview expiry,
   fresh reauthentication, graph comparison, sorted fences and atomic rollback
   protocol can be reused; they do not supply the missing consent/audience rules.

The alternative is an explicit owner-approved scope amendment deferring the
unsupported transfer/attachment cases. No such deferral is assumed. The requested
complete P4-06 scope remains outstanding.

After the owner resolves these points, record the exact accepted rules in an ADR,
write the operation/authorization contract, implement through existing owner
facades, and run targeted checks followed by one complete local acceptance gate
and affected compiled API/worker restart. Production policy values and release
activation remain separate gates; they are not prerequisites for synthetic local
tests and are not being requested here.

# Current execution decision, 2026-11-08

The owner approved scope deferral and stabilization, preserving all completed
features and reusable transfer infrastructure. [ADR 0043](adr/0043-company-transfer-deferral-and-stabilization.md)
records the superseding P4-06 boundary: Company lifecycle and independent
association/separate attachment, with both approving Owners currently admitted
to Company/context. Actual custody transfer is disabled and deferred. Original
questions and subsequent approved designs elsewhere in this record remain historical evidence;
they are not outstanding requests to change this accepted scope.

The owner subsequently approved a separate verified local test baseline, preserving
the existing database after its pre-existing M031 drift was identified. The new
canonical baseline, unchanged legacy data/catalog and 40 affected integration tests
are verified in the [final report](p4-06-final-report.md#approved-canonical-test-baseline).
Protected environment files and historical SQL/ledger rows remain untouched.
All P4-06 local acceptance decisions are resolved. Actual transfer, production,
Shared activation, commit/push and Phase 5 remain outside this authorization.
