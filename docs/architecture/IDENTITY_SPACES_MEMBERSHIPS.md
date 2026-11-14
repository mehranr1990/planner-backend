# Identity, Spaces and memberships

Status: PROPOSAL requiring owner-approved ADRs before implementation. All models
below described as future concepts are absent from the finished Phase 1 API.

## Current constraints

[User/AuthAccount/AuthSession](../../prisma/schema.prisma) are Better Auth-owned.
One UserSettings and one PERSONAL Space are provisioned with identity creation.
Space.kind has only PERSONAL, ownerUserId is non-null and references User with
ON DELETE CASCADE. `(kind,ownerUserId)` and `(id,ownerUserId)` are unique.
StoredFile and several other relationships bind both Space and its personal owner.

[SpacePolicyService](../../apps/api/src/platform/authorization/space-policy.service.ts)
and [personalScope](../../apps/api/src/modules/spaces/public/personal-scope.ts)
require the actor to equal that owner. The transaction fence rechecks personal
access closure before source locks, and serializes the personal sync counter.
[Auth admission](../../apps/api/src/platform/auth/create-auth.ts) currently also
depends on the active personal account boundary. These are deliberate guarantees,
not a generic membership engine.

## Distinct future relationships

| Concept                              | Meaning                                                                  | Must not imply                                                         |
| ------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| User identity                        | A single authenticated person                                            | Organization employment, friendship or ownership                       |
| Friend/professional connection       | Accepted interpersonal relationship, with its own visibility/block state | Access to either person's private Space or employer data               |
| Organization membership              | Participation in an organization with explicit role/status               | Membership in every Project, social group or conversation              |
| Team membership                      | Grouping within an organization or another approved context              | Custodial ownership of every resource                                  |
| Space membership                     | Authorized participation in one shared data boundary                     | Global identity permissions or personal-data access                    |
| Resource grant / guest participation | Limited actions on an explicitly named resource/context                  | Broad Space membership, user-directory search or permission delegation |
| Invitation                           | Expiring offer to establish a specified relationship                     | Access before authenticated acceptance                                 |

Reuse the same User UUID for personal and collaborative actions. Do not create
ProjectUser, SocialUser or a second authentication store. An invited external
email/contact may be a pending invitation or expense participant; it is not an
authenticated User until the normal identity flow completes.

## Shared custody migration decision

Recommend an explicit Space kernel with exclusive typed personal/shared custody
and separate membership records. The owner must approve the exact relational
design: the current mandatory User owner and unconditional cascade cannot safely
represent organization/group custody. Compare a reviewed subtype/custody migration
against separate shared-boundary tables before choosing; the latter would require
an explicit strategy for every existing resource Space FK. Neither option is a
zero-cost column addition.

Preserve existing personal Space IDs, their non-null ownership meaning and their
composite constraints. New shared Spaces get new IDs. Multiple administrators
may manage a shared context without making each one the personal owner. Enforce
exclusive custody, exactly one effective membership per user/context, membership
state and last-custodian safety in both transactions and database constraints.
Never preserve a departing member as a fictitious mandatory owner to avoid a
migration, or set personal ownerUserId to null without a reviewed replacement.

## Authorization contract

Future access should resolve authenticated actor → active account → context
membership or narrow grant → resource state/action. Start with owner-approved,
fixed capabilities rather than an arbitrary policy language. Distinguish read,
create, edit, assign, invite, manage members, export, transfer and delete. A role's
name alone does not imply export or retention authority. Deny by default.

Owner modules remain responsible for source writes and same-boundary integrity.
The future access capability must carry the permitted boundary/actions, not infer
ownership from createdByUserId. Revocation and a concurrent write need a common
transaction fence/version so a stale membership cache cannot commit afterward.
Define a lock order before combining identity, membership and resource locks.
Shared fencing should not serialize unrelated Spaces through one personal owner.

Invitations need hashed high-entropy proofs, bounded expiry, target context and
maximum offered capabilities, inviter authorization, idempotent acceptance, and
revocation/expiry checks in the acceptance transaction. Match a verified identity
to an invited email through a documented policy; never let a forwarded link grant
an unrelated account access. Decide account discovery, accepted-email changes,
guest lifecycle, invitation forwarding and who may elevate a guest before coding.

## Required approval and verification

Approve custody/subtypes, initial capabilities and inheritance rules; Team versus
Space membership; guest and external identity matching; invitation expiry; blocks;
last-owner transfer; and global account closure versus leaving one membership.
The present account-deletion flow closes the whole identity; a future “leave
Project/Group” flow must be a distinct operation.

Verify personal API compatibility, foreign nested IDs/counts/files, guest grants,
revocation/write races, concurrent invitation acceptance, duplicate memberships,
last-custodian departure and auth/session continuity. No policy may expose Journal,
Mood or personal ledgers merely because someone shares an organization or friendship.
