# Shared resources and lifecycle

Status: PROPOSED future extensions. Current Personal APIs, data and approved ADRs
remain unchanged. Shared-data erasure/transfer policy requires a new owner decision.

## Source identity and sharing

Tasks, Goals, Calendar Events and files retain stable source UUIDs and their
existing owning module. Project/Team/Activity associations and permissions should
be typed relationships to those sources. Assignment or a shared view never creates
a second authoritative Task/Goal. Explicit user-requested copying, if later
approved, is a separate command with a new identity and clear lineage.

| Current invariant                                                               | Consequence for a shared extension                                                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Resource spaceId is immutable; most nested/source links require the same Space  | Sharing needs explicit grants/context relationships, not arbitrary cross-space IDs                                       |
| DailyPlanItem and Goal links currently enforce same-Space Task/Habit references | A personal view of shared work needs a separately approved reference/policy path; do not drop these constraints globally |
| Calendar Event, TimeBlock and Task are distinct                                 | Shared calendar participation must not silently reschedule or duplicate Tasks                                            |
| StoredFile binds Space and personal owner                                       | Separate shared custody from upload actor before shared file access; no anonymous URL workaround                         |
| TaskChange/other history records retain author references                       | Account departure must preserve shared history under approved attribution/anonymization rules                            |
| Journal, Mood and personal financial data are private                           | No automatic organizational/social inheritance or analytics mixing                                                       |

Approve whether sharing grants access in the owning boundary or transfers custody.
Prefer scoped grants for view/collaboration; a true transfer needs source-owner
validation, dependent links/files/history/sync handling, concurrent-access fencing
and auditable consent. Never implement transfer by directly rewriting spaceId.

## Search, feeds and notifications

Future cross-space search must first enumerate scopes/resources authorized for the
actor, then call owner read contracts. Revalidate visibility before returning
snippets, counts, facets, cursors or downloads. Membership changes invalidate
cached results and cursors appropriately. An index/cache is not an authority;
revoked content cannot leak while an index is stale. Begin with bounded PostgreSQL
owner queries; require measured evidence before adding a search service.

An activity feed is a permission-filtered projection of approved events, not a
public copy of every outbox payload. Define source identity, event dedup, recipient
visibility, retention and authorization versioning. Events contain safe metadata;
source content is retrieved under current permission. Cross-space notifications
must distinguish source context, actor and recipient, unlike today's personal
owner-oriented deliveries. Queue and external push/email payloads stay generic.

## Shared expenses versus personal finance

Recommend a separate shared-expense domain for group bills, split allocations and
settlement records. Reuse exact decimal/currency techniques, not personal account
ownership or balances. Participants can include explicit guest contacts without
creating fictitious auth identities. Approve visibility, who can amend a split,
acknowledgement/dispute states and who can record a settlement.

Allocated minor units must sum exactly to the expense under an approved remainder
rule. Keep currencies explicit; cross-currency settlement/FX requires its own
recorded-rate policy. A settlement record does not perform or prove a bank payment.
Corrections/reversals need traceable history and atomic changes.

Posting one's share to a personal ledger must be explicit, owner-authorized and
idempotent through Finance's public command, with typed source identity. A shared
edit cannot silently change a posted personal transaction or reveal private
balances/categories. Do not count both a shared allocation and personal posting
as one combined financial metric without an approved definition.

## Account closure, departure and deletion

[ADR 0023](../adr/0023-private-export-and-account-erasure.md) covers today's
personal-only identity/Space/file purge. Its current
[coordinator](../../apps/api/src/modules/account/infrastructure/lifecycle.repository.ts)
and Space/User cascades are unsafe to generalize to shared custodial data without
a new policy/migration. Do not delete shared records merely because their creator
leaves. Existing foreign-reference failures safely stop erasure rather than
authorize deleting another owner's content.

Before enabling any shared resource, approve a deletion matrix:

| Category                    | Decision required                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Private personal data       | Preserve approved personal erasure, export and backup rules                                   |
| Shared custodial resources  | Retain/transfer/delete by custodian policy, separate from creator identity                    |
| Memberships/invitations     | Revoke immediately on account closure; preserve minimal necessary evidence only               |
| Shared authored content     | Approve retained attribution, pseudonymization, redaction and other participants' rights      |
| Sole custodian/admin        | Require explicit transfer, approved closure or visible blocked deletion; never orphan custody |
| Shared expenses/settlements | Approve retention/disputes and participant redaction without corrupting allocations/history   |
| Shared files                | Remove obsolete grants; delete bytes only when the owning lifecycle permits it                |

Personal export must not become an organization-wide extraction route. Define
what shared contributions a departing user may export and which administrator may
export a shared boundary. Permission and retention decisions apply to attachments,
search copies, receipts, feeds, jobs and backups, not only source tables.

Extend erasure control/replay so restored identities cannot regain revoked shared
membership, grant or conversation access. Keep the current independent control
namespace, signed backup expiry and fail-closed behavior. Test restore and deletion
with multiple owners, last-custodian races, message/file references and independently
owned ledgers before allowing identity removal in a collaborative deployment.
