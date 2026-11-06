# 0033: Team confidential records and bounded disclosure

Status: **APPROVED by owner, 2026-11-06**, during explicitly authorized P3-04.

The owner approved this policy: confidential records are visible only to their
author, subject and a named current Team Owner/Admin reviewer. The reviewer must
differ from author and subject. Wider disclosure contains only a separately
reviewed summary, targets explicit current Team member generations, expires within
30 days and is revocable. Team-visible recognition requires the subject's consent.

## Implementation contract

Recognition, feedback and corrective records default confidential. All readers
need current verified full Team admission and the recorded generation; a broad
Owner/Admin/Lead role alone never grants case access. Reviewer designation is
explicit, immutable and usable only while current Owner/Admin. Author and subject
are distinct. No cross-Team, Company, platform-admin or Project inheritance.

Recognition/feedback creation uses ordinary Team creation authority; corrective
creation requires work management. Subject responses and corrective appeals are
separate subject rights, including a current Viewer subject. Only the named
reviewer records a reasoned review/resolution. Entries and original reason/evidence
are immutable; append corrections/responses rather than silently rewriting history.
No scores, XP, automatic discipline or monetary consequences.

Disclosure proposals and review notes remain confidential to these same readers.
The author proposes a bounded summary. The named reviewer explicitly approves or
rejects the exact summary and source revision. For recognition, Team-wide audience
additionally requires the subject's explicit consent; other disclosures permit at
most 100 named current admission generations. Subject consent is revocable.
Only the approved summary, kind, opaque publication ID and expiry enter the wider
view; reason, evidence, responses, appeal, reviewer notes and source case IDs do not.
New case entries/reviews invalidate previously reviewed source revisions. Expiry
uses database time. Departure/rejoin, reviewer demotion, author/subject closure,
revocation and restore must not revive disclosure. Current eligibility is checked
before reads, pages, receipts and mutations; hidden cases do not affect counts.

Use the existing Shared custody fences and signed restrictive control evidence.
An additive Spaces-owned restore generation invalidates restored disclosures and
meeting invitations without copying confidential content into control evidence.
This is a technical implementation of the approved restrictive restore guarantee.
No new access language, generic grant target, private export or public search.

P3-04 meetings are Team scheduling, agenda and current-member invitations only,
using the existing Calendar engine. Team Calendar events/agendas are Team-readable;
confidential cases are never automatically linked or copied into them. Full meeting
minutes, approval workflows, chat, files, external participants and integrations
remain Phase 5. Company attachment remains Phase 4; Team lifecycle is P3-05.

Existing versioned retention policy, identity pseudonymization and release gates
remain binding. No legal retention period or production employment-policy approval
is inferred. No production activation or migration is authorized by this ADR.

Tests must cover confidential defaults and non-enumeration, reviewer separation,
subject response/appeal, exact reviewed summary, consent/revoke/expiry/generation,
restore invalidation, membership/role/session races, atomic receipts/usage/audit,
meeting event custody and invitations, migration preservation and API compatibility.
