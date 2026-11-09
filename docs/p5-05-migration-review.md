# P5-05 M043 migration review

Migration: `202611090043_meetings_decisions_announcements`.
SHA-256: `91372e3e8a2db9b3fde0afbff55c89565505fd42260c6b7c1dacac29a5fe5806`.
Only this unpublished migration and the matching Prisma schema change.
All 66 published SQL files and the migration lock are preserved byte for byte.

M043 adds 21 tables and 62 typed foreign keys for meetings, admission intervals,
invitations, agenda, versioned minutes/decisions/actions, review, release, Task
links, private attachments, announcement versions/targets/acknowledgements and
idempotency receipts. There are 235 domain tables, 236 including the migration
ledger, 67 migrations and 760 foreign keys. The FK catalog SHA-256 is
`b7a5fdbbc7844bf3f4559191da855ed0a41a31441197af26ba22a5ca3df7f26f`.

The only predecessor CHECK changes add MEETING custody and seven implemented
usage keys, preserving every old branch. `team_calendar_shape()` retains Personal
and Team predicates and immutable custody/attribution, adding typed Project,
Company-root and independent meeting branches. The independent Calendar FK is
initially deferred so creation can atomically bind the Calendar owner's actual
generated event ID to the new MEETING custody; no duplicate Calendar engine or
unvalidated reference is introduced. The selected agenda is an immutable JSON
value snapshot, bounded to 1,000 entries; its authoritative source remains typed
MeetingAgendaEntry rows.

Same-space/scope/source FKs and CHECKs prevent foreign custody/source references.
Admissions, generation-bound invitations/targets, unique pending offers, immutable
review/content receipts, immutable final/submitted body snapshots and a unique
work Task link protect identity and retry boundaries. Task pointers use SET NULL
to permit Personal erasure without deleting retained decisions. Private
acknowledgements are deletable personal state. Retained content references opaque
SharedActor identities rather than blocking User erasure with new User FKs.

There is no existing data rewrite, seed, implicit admission, audience backfill,
Push event backfill or automatic deployment. Existing source cleanup stops at a
retention blocker before deleting predecessors referenced by the new tables.

The isolated populated-upgrade rehearsal preserves all 214 predecessor datasets,
all nine populated M042 relations, 66 ledger checksums and predecessor constraints
except the two reviewed additive CHECKs. It injects a SQL failure before COMMIT,
checks complete rollback, then checks deploy/repeat deploy and the exact final FK
catalog. Integration tests exercise actual new typed Calendar branches, Team
legacy extension, immutable snapshots and private Task erasure pointers.

Development used fresh owned canonical baselines. The first schema prototype was
preserved when the immutable agenda snapshot was added; no existing database was
reset or repaired. The five protected prior databases, environment files and
historical migrations remain outside migration execution. Production migration,
Docker release checks, deployment and Shared activation are not part of this
authorized local batch.
