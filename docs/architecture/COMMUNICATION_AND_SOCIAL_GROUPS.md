# Communication and social groups

Status: FUTURE PROPOSAL, not an approved protocol or entity registry.
There are no Chat, Friend, Circle, Activity or real-time endpoints in Phase 1.

## Social context

Use one identity with independent connection and membership relationships.
Friends/family, sports groups and trip circles need explicit social contexts;
do not encode them as employees or Project assignees. Recommend Social Group
membership for group access and an Activity aggregate for a particular trip,
meeting or sports event. The owner must decide whether Circle is a label/view
over a Group or a separate membership aggregate before either is implemented.

Activities can reference an authorized calendar event, existing Tasks and shared
expense records through typed owner interfaces. Joining an Activity does not
automatically reveal a group's entire archive, personal calendar, finances or
member contact details. Invitations, attendance and access are distinct states.
Professional connections likewise do not grant employer or client access.

## Unified text communication

Recommend one conversation/message engine with explicit conversation types for
direct discussions, social group conversations and work channels. A channel is
bound to its organization/Project/context; a direct conversation has explicit
participants. Reuse message identity, revisions, ordered history and attachments
across types rather than building separate personal and company chat stores.

| Concern                     | Required future policy / invariant                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| Starting a DM               | Approve who may contact whom, requests, blocks and guest restrictions                                     |
| Group/channel participation | Explicit membership or documented context-derived membership; revocation authoritative on every read/send |
| History                     | Decide visibility on join/leave, message edit/delete windows, redaction and retention                     |
| Ordering/replay             | Stable message UUID, conversation-scoped server order and idempotent client operation ID                  |
| Threads                     | Explicit parent/root identity within the same authorized conversation                                     |
| Reactions                   | Unique actor/message/reaction identity and bounded supported values                                       |
| Mentions                    | Resolve only authorized identities; no directory/notification side channel                                |
| Files                       | Existing private StoragePort; authorization tied to the visible message and current participation         |
| Read state                  | Per-user state with a documented meaning; receipt/privacy controls require approval                       |

Resource comments may share formatting/mention utilities with messages, but must
have a typed authorized subject owned by Tasks, Goals, Calendar or another approved
domain. A generic targetType/targetId string must not bypass FK/ownership checks.
Deleting a comment, moderating a message and erasing an identity are distinct
operations with explicit retained-history rules. Notification preferences are
recipient-controlled; mentions cannot silently subscribe someone to private data.

## Real-time transport

Keep committed PostgreSQL messages and authorized REST history authoritative.
Publish opaque event identities after commit via the existing outbox pattern.
A future transport adapter may deliver live updates, but its package/protocol,
authentication, Origin checks, backpressure and deployment topology need an ADR.
Phase 1 has no WebSocket/SSE endpoint. Polling existing notification/history APIs
does not imply an implemented chat transport.

On a future live connection, revalidate account and membership at connect,
subscription and every write. Membership revocation must evict or fence stale
subscriptions; reconnect must not replay unauthorized messages. Use scoped cursors
and bounded catch-up; do not extend the personal P1-12 sync enum implicitly.
External notification jobs carry IDs and generic text, then recheck current
recipient/source access immediately before dispatch. Never broadcast private
message bodies through a shared generic event stream.

## Open decisions and order

Approve relationship/block privacy, Circle/Group semantics, participant/guest
rules, channel membership inheritance, moderation, message history/retention,
attachments, read receipts and transport before implementation. Build access and
persisted conversation invariants before real-time delivery. Then add comments,
mentions/reactions/threads and per-recipient notifications against that policy.

Native audio/video calling and full end-to-end encrypted messaging are outside
this proposal's implementation scope. Do not claim server-readable history,
search and account exports already implement an E2EE design.

Current reusable evidence: [notification owner](../../apps/api/src/modules/notifications/notifications.module.ts),
[outbox](../../apps/api/src/platform/outbox/outbox.ts),
[private storage](../../apps/api/src/platform/storage/storage.port.ts) and
[writing contracts](../../packages/api-contracts/src/writing.ts).
