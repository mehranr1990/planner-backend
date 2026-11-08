# 0039: Company lifecycle, administrative association, attachment and transfer

Execution amendment (2026-11-08): [ADR 0043](0043-company-transfer-deferral-and-stabilization.md)
defers actual custody transfer from P4-06 while retaining this approved design,
lifecycle, affiliation and all safeguards. Both approving Owners require current
Company/context admissions. The historical decision text below is preserved.

Status: **APPROVED by the owner for local P4-06 implementation, 2026-11-07**.
Authority: explicit owner response to the P4-06 decision request. No commit, push,
Shared activation, deployment or Phase 5 execution is authorized.

## Company lifecycle

Current Owner and eligible Org Admin may archive/restore. Only the Owner may
propose handover or request sole-custodian closure. Preserve existing verified
succession, recovery, retention, access fencing and controlled disposal. No
automatic reassignment or irreversible deletion outside those controls.
Reuse the accepted seven-day handover expiry, provider reauthentication and
30-day shared recovery protocol; these are not new legal retention periods.
Existing immutable operator-approved policies, obligations and holds govern
disposal, independently of Personal erasure. Missing policy fails closed.

## Independent source association and attachment

Current independent Project/Team Owner and current destination Company Owner
must explicitly authorize the relationship. Each source may have at most one
active Company association; a Company may associate multiple independent sources.
Each association designates exactly one currently valid, explicitly admitted
Department/Unit context.

Association is administrative metadata only: no custody transfer, membership,
source-content rights or historical disclosure. Attachment is separately
authorized and revocable, permitting explicitly allowed organizational listing,
coordination and metadata visibility. Every source operation still checks its
independent current authority. Attachment grants no historical content or custody.
Revocation, departure and closure invalidate stale permissions, receipts and
references. Preserve cross-Team Project references and independent source ownership.

## Actual whole-root custody transfer

Only explicitly approved whole-root Project/Team transfers that the approved
architecture can safely represent are supported. No partial Task, Goal, file,
history or membership transfer. Require current source Owner and destination
Company Owner approval and explicit consent of affected participants whose data
or rights move; absent consent blocks execution.

Require reviewed dependency manifest and dry-run preview, validated destination
admissions/role mappings, revision fencing, deterministic lock order, transactional
safety, idempotency and recoverable execution. Preserve original attribution,
approved history, files, audit and retention obligations. Confidential audiences
remain restricted; never infer Company-wide roles or source access. Reject units
that cannot preserve privacy, immutable history, independent references or lawful
retention. Root-ID reassignment is not a transfer implementation.

The owner explicitly requires an architecture/owner decision for any unit not
safely representable by current contracts; this ADR does not silently relax
independent-root constraints or decide a new role/admission representation.
The implementation inspection found immutable independent Project/Team roots and
distinct Company child role rules. The owner subsequently approved the
Company-child-scope representation and detailed migration/consent design in
[ADR 0040](0040-company-child-scope-transfer-design.md). That architecture decision
is resolved; implementation and acceptance remain required.

## Acceptance and limits

Use existing owner facades, additive reviewed migrations and local PostgreSQL.
Preserve Personal, Project, Team and Company security and published compatibility.
Run targeted tests during development, one full mandatory gate for acceptance,
and affected API/worker compiled restart and migration/recovery checks. Keep
Shared disabled and production/release gates deferred. Leave P4-06 unstaged,
uncommitted and unpushed; do not start Phase 5.
