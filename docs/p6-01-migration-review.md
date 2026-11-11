# P6-01 migration review

Migration: `202611110045_social_foundation` (M045), additive application expansion.
SHA-256: `30d00bf27efcda10291f0596b05dc9bee48452c2f0ed5aa431bd90a81278a25e`.
Authority: approved ADR 0050 and owner-authorized P6-01 execution, 2026-11-11.

Six new tables: SocialPrivacy, SocialConnection, SocialCircle, SocialCircleMember,
SocialGroup and SocialJoinRequest. Eleven new FKs; resulting catalog has 777 FKs,
245 public tables including migration ledger, and 69 migrations. Historical SQL,
the migration lock file and the pinned pg-boss schema remain unchanged.

Two existing CHECK catalogs expand: SharedCustody kinds and SharedUsageEntry
feature keys. Two existing owner functions expand for Social roles and the existing
zero-member purge witness. No prior row is backfilled or rewritten. Existing
identity, Personal ownership and resource attribution remain intact.

Private preferences and Circles retain owner-composite Personal FKs. Typed Group
root, scope and creator FKs, immutable identity and deferred exclusive Group/custody
binding prevent cross-context substitution and orphan boundaries. Group root
deletion requires the existing live policy-claimed purge witness. Deferred binding
recognizes the captured ROOT/CORE disposal job between bounded passes after its
lease is released, with the same deadline, custody, policy and zero-member checks.
Pair self-links are rejected; a normalized partial unique index prevents opposing
live requests/friendships. Circle labels require a current accepted owner friendship.
The Social-owned block consequence trigger terminates pair relationships and labels
atomically for both existing DM commands and restrictive block restore replay.
It does not change common Group membership or retained message content.

Join requests have one pending record per applicant/Group, typed parent/identity
FKs and paired positive generation/revision snapshots. Approval must match the
current prior admission, uses Spaces-owned admission and creates a fresh interval.
Social role guards accept Admin/Member only; Owner remains derived custody.

DDL runs in one transaction with a five-second lock timeout. The reviewed hash is
enforced by migration-safety tooling. Failure rolls back DDL/functions/data together;
no migration repair/reset is authorized against protected or prior test databases.
The failed initial owned draft and the superseded successful draft are preserved.
Corrected unpublished SQL was deployed only to a newly created isolated baseline.

Final canonical database:
`p601_acceptance_985936cc5acf4b80ab817b1a8dcae73b_test`.
Deployment twice and status/checksum verification passed before final acceptance.
The populated rehearsal checks every one of the 238 predecessor table datasets,
all 68 predecessor migration checksums, prior constraints/functions except the four
reviewed extensions, interruption/rollback and repeat deployment. Final results are
recorded in the completion report; this plan alone is not test evidence.

Before new Social writes, application rollback may retain the expanded schema.
After such writes, preserve the schema/data and roll forward; an old application
cannot enforce new Group/graph privacy. No destructive downgrade SQL is provided.
No production migration, environment mutation, Shared activation or deployment.
