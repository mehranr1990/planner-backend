# 0073: Platform Admin P2 security, audit and privacy integration

Status update, 2026-11-25: owner accepted P2 for local development and authorized its commit/push, followed by local P3 implementation. Deployment remains excluded. The authorization history below describes the implementation checkpoint.

Status: implementation decisions within the owner's explicit continuation request,
2026-11-24. P2 verification is in progress; this is not local acceptance or release
authorization. P1 commit/push was explicitly authorized, including the subsequent
M100 byte-preservation correction. P2 commit/push, P3 and deployment are excluded.

Use existing Admin/ordinary Better Auth realms and domain facades. No replacement
identity, fabricated ordinary session, IP allowlist, new provider or dependency.

Security requests expire after 30 minutes and require a distinct authorized Admin.
Both operators must pass recent persisted MFA at their actions; execution rechecks
the approver's current eligibility. MFA recovery requires an independent recorded
identity review, cannot be approved by its target, revokes all target sessions and
removes the old factor. The unchanged provider password permits enrollment only;
new MFA enrollment and a new successful MFA sign-in are required for privilege.
Capture the target enrollment timestamp so an old review cannot reset a newer factor.
This review is a human operator trust boundary, not an automated identity-proof claim.

Configurable login attempt maxima cannot exceed the existing Admin 5/60s and user
3/10s rules. Proxy parsing, provider IP handling and other rate limits remain in force.
User login restrictions reuse the existing P1 account suspension state and fences.
SMTP/sink and durable in-app alert records are the supported security alert channels.

Audit projections are category-scoped and exclude work content and internal notes.
Only a distinct sensitive-audit permission reveals administrative reasons. Minimal
terminal evidence is captured transactionally and kept independently of source rows.
Detached opaque actor/event identifiers intentionally have no live User/content FK:
Personal erasure must neither erase security evidence nor keep work/identity alive.
Database triggers reject rewriting evidence. This protects application-level writes;
it does not claim to withstand a privileged database operator disabling triggers.

Audit retention defaults to 730 days, with a 730–3650-day configurable range per
category. This preserves the approved audit minimum. Changing policy requires a
15-minute impact preview, distinct second approval and revision/impact revalidation.
Expiry is separately authorized and limited to 100 eligible records per action;
records with dependent delivery evidence are retained. No automatic mass purge.
This policy is separate from shared retention classes, obligations and backup expiry.

The owner's P2 dependency requirement prevents confirming account deletion while
active/archived Team or Company ownership remains unresolved. Accepted succession
or an explicit existing lifecycle disposition must occur first. No direct Admin
ownership reassignment is allowed. ADR 0029 acceptance/reauthentication, ADR 0043's
narrow custody exception and all retention/restore fences remain binding.

The supplemental ZIP download preserves the existing JSON export API and proof.
Use generated entry paths, a 512 MiB/1,000-entry limit, authorized Personal files and
independently owned Projects with current export/file rights. Team/Company membership
alone never includes their data. Shared activation gates still apply and are stated
in the archive manifest. Failed/corrupt sources produce an incomplete failed download,
never a valid archive silently omitting required bytes. Original source JSON remains
a captured snapshot; each file open rechecks current authority and immutable bytes.

Ordinary recovery remains seven days with persisted historical deadlines unchanged.
Admin account deletion captures a 7–30 day deadline. Admin Team/Company closure uses the existing 7 or 30 day database constraint. Each request stores an impact fingerprint, target revision and distinct reviewer. The account closure capability binds the target owner, real Admin and transaction. Shared closure ends reviewed admissions with recovery eligibility reserved for the custodian. The synchronous impact review accepts up to 1,000 seats and requires prior disposition of Company child custody. An explicitly selected Project must pass its current export and file policies.

The BACKUP policy changes future signed manifest duration within the existing 30-day maximum. A reviewed change has zero retroactive effect. Old manifests and erasure evidence carry their original deadlines. Deployment owns physical off-host expiry and live restore verification.
