# P3-04 additive migration review

Artifact: `202611060026_team_confidentiality_and_meetings/migration.sql`.

SHA-256: `220f3d88c455db608da677c03c9950da686a5b143fa9e901efb56399cbd66523`.

Six new tables: TeamCase, TeamCaseEntry, TeamDisclosure, TeamDisclosureRecipient,
TeamMeeting and TeamMeetingInvitation. Typed composite FKs enforce Team, actor,
access/scope, admission interval, case/disclosure and Calendar source boundaries.
All new FKs are NO ACTION; no User cascade or source ownership change. CHECKs guard
participant separation, root scope, generations/revisions, kinds/states, bounded
text, 30-day disclosure and seven-day invitation windows. Triggers preserve original
content/identity, entries and recipient generations, enforce revisions and terminal
states, and prohibit non-recognition Team-wide disclosure/consent.

Existing-table changes are additive `AccessScope.restoreGeneration` (non-null zero
default and nonnegative CHECK) and the exact prior usage feature allowlist plus
five Team interaction feature keys. Restore replay increments the Spaces-owned
generation; new authority-bearing rows bind it. No confidential body enters signed
replay evidence. No old migration, Task/Goal source, Personal owner or auth schema
is modified. DDL is atomic with 5-second lock and 30-second statement timeouts.

The reviewed complete cleanup FK digest is
`0f5a23925dc2b9623565c973eb70c7ad6d68f538ca012e546bd166f644b18916`.
P3-03's rehearsal retains its own historical digest before this expansion. Existing
Project cleanup cannot purge independent Team cases/calendar/meeting data. Team
handover/archive/restore/cleanup is still P3-05 and is not activated here.

The upgrade rehearsal snapshots original columns from all 140 prior table datasets,
including populated Team source/Calendar/plan/reference/capacity records, and all
49 predecessor migration checksums/constraints. It verifies an interrupted rollback,
absence of new tables, preserved rows, resumed/repeated deploy, zero default restore
generation, additive-only usage CHECK and exact final FK digest. Integration tests
exercise identity/content immutability, participant separation, expiry, generation,
cross-Team references and restrictive restore invalidation.

Apply only to guarded isolated local PostgreSQL test targets. No configured database
is reset. Deployment, operational restore and rollback execution remain deferred.
After new writes, an earlier application cannot service these records safely;
use a compatible version or reviewed forward correction. This local implementation
does not authorize Shared activation or employment-policy rollout.
