# 0080: Final backend integration readiness adapters

Status: implementation within the owner's explicit readiness authorization,
2026-11-26, continued 2026-11-27. P7 publication is authorized and completed;
readiness commit/push, frontend changes and deployment are not authorized.

CB-INV-1 adds authenticated `GET /api/v1/invitation-notifications/unread-count`.
It accepts no query fields and returns `{total,byKind}` with PROJECT, TEAM,
COMPANY, CONVERSATION, MEETING and SOCIAL_GROUP present even at zero. The total
is the sum of the six exact counts, not an estimate, page total or cumulative
notification-delivery count. Only currently valid pending unread offers for the
verified session recipient contribute, subject to the same IN_APP preferences
as the notification feed. Counts do not grant invitation admission or reveal
recipient addresses, resource IDs or account existence.

Spaces, Company, Social, Messaging and Meetings remain the validity owners.
Counts query all unread candidate IDs without a page cap and revalidate current
recipient, expiry, issuer/source generation, contact and read state through
existing domain checks. Meeting list and count share recipient validation;
Social list and count share the contact check. Concurrent commits can change a
subsequent request, as with existing recipient feeds; no new global snapshot or
locking protocol is promised. Read/proof/accept/revoke and notification preferences
remain authoritative; no new persisted counter or migration is introduced.

Read-only frontend review also identified G-15: the approved Admin Team/Company
creation flow requires an existing retention-policy version, but the catalog was
available only to ordinary sessions. Add a narrow Admin read adapter at
`GET /api/v1/admin/workspaces/retention-policies?context=TEAM|COMPANY` requiring
`admin.workspaces.create`. The Spaces public facade delegates to its existing
RetentionSelectionService. The same bounded immutable applicable summaries are
returned, never holds, obligations, operator identities or approval references.
No policy editing, seeding or Admin-to-ordinary impersonation is added.

All remaining frontend gaps are reconciled against accepted P0-P7 decisions in
the readiness matrix. New profile/directory/auth routes, invented metrics and
unscoped relationship/content access are not inferred from prototype controls.
Generated API/permission mappings cover every Admin operation and all 22 modules;
the server role policy remains authoritative. Existing Client/Admin operations,
role grants, migration bytes, owner compose and both frontend repositories remain
unchanged except for the two additive backend contracts described above.
