# Platform Admin P4 backend contract

All paths are prefixed with `/api/v1`. This is a backend handoff; no frontend code
is changed. Existing P0–P3 and Client routes and schemas remain compatible.

## Admin route and capability inventory

Admin uses the separate `mehran-admin` realm and explicit permissions below. Every
write needs an Idempotency-Key, trusted Origin and persisted MFA within five
minutes; private content/evidence reads also require recent MFA and reason. All
Admin attempts and outcomes are audited without copying private bodies into audit.

| Method and path                             | Capability                       |
| ------------------------------------------- | -------------------------------- |
| `GET moderation/escalations`                | `admin.security.read`            |
| `POST moderation/escalations/:id/read`      | `admin.security.read`            |
| `GET communications/:id/targets`            | `admin.communications.read`      |
| `GET support/notices`                       | `admin.support.read`             |
| `POST support/notices/:id/read`             | `admin.support.read`             |
| `GET communications/templates`              | `admin.communications.read`      |
| `POST communications/templates`             | `admin.communications.templates` |
| `POST communications/templates/:id/approve` | `admin.communications.approve`   |
| `POST communications/templates/:id/archive` | `admin.communications.templates` |
| `POST communications/preview`               | `admin.communications.send`      |
| `GET communications`                        | `admin.communications.read`      |
| `GET communications/:id`                    | `admin.communications.read`      |
| `POST communications/:id/test`              | `admin.communications.send`      |
| `POST communications/:id/approve`           | `admin.communications.approve`   |
| `POST communications/:id/send`              | `admin.communications.send`      |
| `POST communications/:id/cancel`            | `admin.communications.send`      |
| `GET support/queues`                        | `admin.support.read`             |
| `POST support/queues`                       | `admin.support.configure`        |
| `PATCH support/queues/:id`                  | `admin.support.configure`        |
| `GET support/tickets`                       | `admin.support.read`             |
| `GET support/tickets/:id`                   | `admin.support.read`             |
| `POST support/tickets/:id/replies`          | `admin.support.reply`            |
| `POST support/tickets/:id/assign`           | `admin.support.assign`           |
| `POST support/tickets/:id/state`            | `admin.support.reply`            |
| `POST support/tickets/:id/archive`          | `admin.support.configure`        |
| `GET support/tickets/:id/evidence`          | `admin.support.read`             |
| `GET moderation/cases`                      | `admin.moderation.read`          |
| `GET moderation/cases/:id`                  | `admin.moderation.read`          |
| `POST moderation/reports`                   | `admin.moderation.report`        |
| `POST moderation/cases/:id/state`           | `admin.moderation.manage`        |
| `GET moderation/cases/:id/content`          | `admin.moderation.content.read`  |
| `GET moderation/cases/:id/evidence`         | `admin.moderation.content.read`  |
| `POST moderation/cases/:id/penalty`         | `admin.moderation.penalty`       |
| `GET engagement/policies`                   | `admin.engagement.configure`     |
| `POST engagement/policies/:id/preview`      | `admin.engagement.configure`     |
| `PATCH engagement/policies/:id`             | `admin.engagement.configure`     |

## Ordinary registered-user routes

Every route requires the current ordinary session and account availability.
Support accepts registered unverified users in-app. Inbound email requires the
current verified ticket-owner email. Writes require a trusted Origin and
Idempotency-Key. Bodies contain explicit revision where the generated schema
requires it; these are not If-Match revisions. Read cursors are UUID positions,
with ownership/filter checks reapplied on each page.

| Method and path                        |
| -------------------------------------- |
| `GET communications/preferences`       |
| `PATCH communications/preferences`     |
| `GET support/queues`                   |
| `POST support/tickets`                 |
| `GET support/tickets`                  |
| `GET support/tickets/:id`              |
| `POST support/tickets/:id/replies`     |
| `POST support/tickets/:id/reopen`      |
| `POST support/tickets/:id/feedback`    |
| `POST support/tickets/:id/email-token` |
| `POST support/tickets/:id/evidence`    |
| `GET support/tickets/:id/evidence`     |
| `POST moderation/reports`              |
| `GET moderation/reports`               |
| `GET moderation/reports/:id`           |
| `POST moderation/reports/:id/appeal`   |
| `POST moderation/reports/:id/evidence` |
| `GET moderation/reports/:id/evidence`  |
| `GET communications/inbox`             |
| `POST communications/inbox/:id/read`   |
| `GET support/notices`                  |
| `POST support/notices/:id/read`        |

## Roles and privacy

Super Admin has explicit registered P4 capabilities. Support has ticket read/reply
and manual assignment capabilities, without moderation content or communication
send/configuration. Security Reviewer has report/moderation/case-content and
penalty capabilities; account/workspace suspension still requires the separate P1
permission. Billing Manager receives no P4 capabilities. Unknown permissions deny.

Support details expose only ticket data, user-provided evidence and the documented
account identity projection. Ordinary ticket reads/exports omit internal notes.
Moderators have no general content browser: only the source item selected by the
case and exact linked evidence can be requested. An erased/unavailable source
fails closed. Appeals require a different authorized reviewer, including on every
subsequent appeal action.

## Communications

Create a new immutable template version, then approve it. Only approved templates
can be previewed/dispatched. Variables are recipientName, workspaceName and
publicReason; rendering is plain text, bounded and never recursive. Recipient
locale chooses an exact locale, language, then mandatory fallback.

Preview validates/snapshots at most 1,000 target users for 15 minutes. Direct user,
filtered, Workspace-member and global selectors are available. Test delivery goes
only to the initiating operator. Revisions change after test, approval, send and
cancel; use the returned/current revision for the next operation. Global/security
broadcasts need a different current approver. Scheduling supports up to 90 days.
The target report records NO_VALID_DEVICE without claiming a Push was sent.

Delivery honors existing global/module settings, per-type channel preferences and
quiet hours, except essential security notices. Security still requires verified
email, available server channel and valid device. Push carries only a generic
private-inbox hint. SMTP acceptance is provider acceptance, not proof of recipient
reading. External uncertain attempts are AMBIGUOUS and never automatically
resent. Explicit temporary rejection receives bounded retries; per-recipient
evidence and aggregate status are available. Cancellation prevents new sends; an
already uncertain attempt remains marked uncertain.

## Support, evidence and inbound email

Use queues, ticket states, manual assignment, public replies, internal notes,
feedback and explicit reopen. Default SLA 24 hours, reopen 7 days, archive 90 days
and retention 365 days are documented in ADR 0076 and configurable through P4
policy endpoints. SLA late notices are available only to permitted operators.

Evidence upload accepts base64 with an exact safe filename/type/size contract;
all content is validated and malware-scanned through private storage. One file is
at most 5 MiB; a ticket/case holds at most 100 attachments. JSON expansion applies
only to the two evidence upload routes. Downloads stream an attachment with
no-store/nosniff/sandbox headers and never expose storage keys or public URLs.

Email-token issuance returns a one-time 256-bit token and expiration; only its hash
is stored. Replay of a consumed issuance key cannot reveal the token again; rotate
with a new key/current revision if the response was lost. This does not activate
inbound transport. Production adapter/domain remain disabled. Concrete PostgreSQL
receipt/rate and scanned-storage processing are runtime services. Transport
verification/deployment requirements are in the separate inbound runbook.
Inbound processing never sends automatic acknowledgements, preventing reply loops.

## Moderation and lifecycle

Reports name a typed source selected under the source owner's ordinary access
checks. Account/behavior, relevant physical/logical Workspace, Task, Note and
Message reports are supported. Private-source inspection needs a live exact case,
dedicated capability and audit. No Admin membership or ordinary impersonation is
created. Penalties require manual investigation; warnings and reporting/Support
restrictions are case-bound. Restrictions expire within 30 days. P1 suspension and
P2 escalation require their own permissions and preserve their current behavior.

Default appeal window is 14 days. Limited restrictions remain active while appeal
is pending and clear on dismissal; account/workspace recovery remains a separate
authorized P1 operation. Default dismissal/action retention is 90/365 days, bounded
by appeals and active restrictions. Owner closure invalidates inbound tokens and
pending delivery. Personal export adds public Support/report/inbox and evidence
metadata and the exact owned evidence bytes in the ZIP, never operator notes or correlation credentials. Owned evidence disposal
is durable; backup restore scans/hashes attached evidence before reopen.

M116–M118 are additive. No production migration, inbound activation, live provider
delivery, frontend, deployment or P4 publication is included in local acceptance.

## Policy preview and publication

Use POST engagement/policies/:id/preview before PATCH. The response contains an
actor-bound immutable preview ID, revision, proposed values, expiry and impact
fingerprint/counts. Publishing requires that exact previewId, impactFingerprint
and impactAcknowledged=true, with unchanged values/revision and current sensitive
permission/recent MFA. Previews expire after 15 minutes. Changed candidates,
expired/foreign previews and stale revisions fail closed; repeat publication with
the original idempotency key returns its receipt. Impact includes tickets to
archive/delete, related evidence/replies, delivery rows and old user receipts.
Existing case retention deadlines remain unchanged; moderation policy applies to
subsequent outcomes. Candidate enumeration is bounded; oversized previews reject
without publishing. Audit retains safe before/after settings and impact evidence.
