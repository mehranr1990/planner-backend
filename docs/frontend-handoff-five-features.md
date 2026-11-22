# Five-feature frontend handoff

Backend contracts are ready for Frontend implementation. All five features are implemented.
See [OpenAPI](api/openapi.json) for the authoritative schemas. Frontend files and the
running Docker deployment remain unchanged. Apply the six reviewed migrations before
running the new backend image. Real SMTP/domain delivery is an operational configuration
check, not an authentication bypass.

## Shared HTTP rules

Paths below start with `/api/v1`. Use authenticated sessions, trusted Origin for
mutations, and existing Shared activation/security controls. Existing generic
error envelopes and rate limits apply. Project mutations use quoted positive
revision `If-Match`; creation uses `Idempotency-Key`. Never cache private responses.
403/404 enforce existing permission and non-enumeration behavior; invalid payloads
are 400; stale revisions/conflicting idempotency are 409; rate limits return 429.

## 1. Manual Project status

`GET /projects`, `GET /projects/{id}`, `POST /projects` and
`PATCH /projects/{id}` return `manualStatus` in the existing Project object.
`GET /teams/{id}/projects` includes it in nested Project objects.

Values: `PLANNED | ACTIVE | ON_HOLD | COMPLETED | CANCELLED`.
Creation/backfill defaults to PLANNED. Creation does not accept a status override.

```json
{ "manualStatus": "ON_HOLD" }
```

Send this body to `PATCH /projects/{id}` with the current Project ETag as If-Match.
A successful response is the existing Project response plus manualStatus and an
advanced revision/ETag. Status-only edits require existing `work.manage` authority;
combined title/description edits still require `settings.manage`. Changes are
recorded in Project activity/audit. Unauthorized or stale edits never apply.

`GET /projects?manualStatus=ON_HOLD&limit=25` filters before pagination. The enum
filter is optional; limit is 1–100, default 25; `after` is the existing opaque
cursor. Cursors bind the filter, so restart pagination when it changes.
The response remains `{items: Project[], nextCursor: string|null}`.

Build a status selector, list filter and status history display. Display lifecycle
`state`, manualStatus and calculated progress independently. Team objects have no
manual Project status.

## 2. Project member capacity

Only the Project's owning Team (the existing ownerTeamId creation selection, stored
as keyOwnerTeamId) supplies inherited capacity. Other Team references never change
that source. Without an owning Team, Saturday?Wednesday defaults to 480 minutes/day;
Thursday and Friday default to zero. A member absent from the owning Team or a Team
template with incompatible timezone/effective date retains UNKNOWN capacity.

Precedence: explicit Project date exception, then owning Team date exception,
then Project member weekday override, then owning Team member weekday template.
Approved Team time off reduces the inherited/weekday amounts; a Project date exception
remains authoritative, including zero and explicit null (unknown). No Personal schedule
is read. Capacity amounts preserve the requested business timezone/calendar semantics.

New endpoints:

- GET /projects/{projectId}/capacity-templates/{accessId}?generation=1
- PUT /projects/{projectId}/capacity-templates/{accessId}
- GET /projects/{projectId}/capacity-templates/{accessId}/effective?generation=1&fromDate=2030-01-01&toDate=2030-01-08&timezone=Asia/Tehran

GET/PUT responses are {projectId, member:{accessId,generation}, template, revision}.
A missing override has template:null and revision:1. PUT requires If-Match with that
revision and existing work.manage authority. Readers require current authorized Project
and member-generation visibility. Cross-Project/revoked/stale generations are denied.

PUT example:

```json
{
  "member": { "accessId": "uuid", "generation": 1 },
  "template": {
    "timezone": "Asia/Tehran",
    "effectiveFrom": "2030-01-01",
    "weekdays": [null, 360, null, null, null, null, null]
  }
}
```

Seven entries use Sunday=0 through Saturday=6. Null inherits that weekday; zero explicitly
makes it nonworking; other values are integer minutes 0?1440. A whole template:null
removes the override. Unrelated member generations never inherit an old override.

The effective endpoint returns the existing ProjectWorkload response, restricted to
the requested member, with every date in the requested range. fromDate is inclusive;
toDate is exclusive. Existing bounded-range validation applies. Ordinary GET /workload
keeps its sparse allocated/dated rows and now resolves inherited/default capacity.
Positive overbookedMinutes is a WARNING only. Assignments and Project creation never
wait for overload approval or fail because of capacity. Existing dated-capacity APIs
remain unchanged. Build member weekday editors, inherited/default indicators and
advisory workload warnings; refresh after Team capacity/leave changes.

## 3. Archive and Delete for Me

Use existing `GET /conversations/{id}/settings` and
`PATCH /conversations/{id}/preferences`, which return ConversationSettings:

```json
{
  "conversationId": "uuid",
  "linkPreviews": null,
  "newcomerHistory": null,
  "membersCanPin": null,
  "revision": 1,
  "canManage": false,
  "me": {
    "linkPreviews": null,
    "collapseBlocked": false,
    "archived": false,
    "hidden": false,
    "revision": 1
  }
}
```

Use **me.revision**, not the conversation/settings revision, in If-Match for private
preferences. Request fields are optional and at least one is required:
`linkPreviews: boolean|null`, `collapseBlocked: boolean`, `archived: boolean`,
`deleteForMe: true`. `false` is invalid for deleteForMe. Existing preference
responses advance me.revision. There is no public deletion cutoff or other-member
visibility state in this response.

Archive: send `{"archived":true}`; unarchive: `{"archived":false}`.
Delete for Me: send `{"deleteForMe":true}`. No other participant's data changes.
`GET /conversations` excludes archived and hidden conversations by default.
`?archived=true` lists only archived, non-hidden conversations. Existing `limit`
(1–100, default 50) and opaque `cursor` remain. Restart pagination on filter change.

Incoming messages revive hidden conversations, while prior history stays hidden.
Archive remains set after incoming messages; notification preferences still apply.
Own sends do not revive the inbox entry. History/detail/search/unread/media use the
same effective history floor. Old cursors may fail validation after visibility
changes; discard cached history and cursors when deleting for yourself.

Build an archived inbox, archive/unarchive actions and Delete for Me confirmation.
Clear cached message previews, history and attachments for the deleting user.
Do not describe this as deleting messages for everyone.

## 4. Invitations

Existing Project/Team/Company invitation create/accept/decline/revoke/resend
endpoints and their exact request/response schemas remain in OpenAPI. Their create
requests support the existing recipient union: `{"userId":"uuid"}` or
`{"email":"exact@example.com"}` plus the scope-specific role and existing fields.
Reuse those contracts; there is no new account directory/search API.

The invitation remains PENDING until the recipient explicitly accepts. It expires
after seven days and can become ACCEPTED, DECLINED, EXPIRED or REVOKED. Acceptance
requires a signed-in, verified, active account matching the invited identity/email;
it rechecks current issuer permissions and the offered scope/role. A forwarded
proof never grants another account admission. Existing same-identity retry behavior
remains; replay cannot create a second membership.

Configure backend `INVITATION_ACCEPT_URL` to the frontend invitation landing page.
Production requires HTTPS. The email link fragment contains `id` and `proof`, for
example `#id=uuid&proof=opaque-token`. Read the fragment, remove it from visible
navigation/history, and submit the proof through the existing `X-Invitation-Proof`
header to the appropriate preview/decision route. Never put proofs into API query
parameters, analytics, logs or persistent frontend storage. Sign-in/registration
must preserve explicit acceptance; never automatically enroll the user.

The existing SMTP/sink adapter sends after database commit. Missing landing-page
configuration yields internal UNAVAILABLE delivery state; provider rejection yields
FAILED; SMTP acceptance yields SENT. All preserve existing invitation admission
state. These internal delivery states are not additional HTTP response fields.
Explicit resend rotates the proof and retries delivery; automatic durable email
retry is not implemented. Pending/retry UI must not claim verified inbox delivery.
Resend may return INVITATION_RESEND_UNAVAILABLE or STALE_REVISION conflicts.

No live SMTP/Resend sender-domain delivery has been verified. An unverified sender
domain must be configured operationally; do not weaken account verification.

Messaging and Meetings email invitations use these additional endpoints:

- POST /conversations/{id}/email-invitations
- GET /conversations/{id}/email-invitations/{invitationId}
- POST /conversations/{id}/email-invitations/{invitationId}/revoke
- POST /conversation-invitations/{invitationId}/claim-email
- POST /meetings/{id}/email-invitations
- GET /meetings/{id}/email-invitations/{invitationId}
- POST /meetings/{id}/email-invitations/{invitationId}/revoke
- POST /meetings/invitations/{invitationId}/claim-email

Creation requires {id:"uuid",email:"exact@example.com"}, an Idempotency-Key and the
current conversation/meeting If-Match revision. It returns only
{id,state,revision,expiresAt}; state is PENDING, CLAIMED, EXPIRED or REVOKED. Known
and unknown account addresses follow the same path and response shape. No username
or account lookup endpoint is introduced. Only existing conversation administrators
or meeting organizers may issue/manage these offers. Existing DM fixed-pair rules
and source membership rules remain mandatory.

Communication links add kind=CONVERSATION or kind=MEETING to the URL fragment.
After sign-in/registration and email verification, submit an empty JSON object to
the matching claim-email endpoint with X-Invitation-Proof and the offer's If-Match
revision (initially 1). The proof is single-use; malformed/wrong-account/expired/
revoked/consumed proofs return a generic 404. Issuer departure, changed admission
or insufficient source membership cannot be bypassed. No anonymous content preview
or automatic enrollment is available.

A successful claim returns the existing ConversationInvitation or MeetingInvitation
in PENDING state with the same ID and original expiry. Claiming grants NO membership.
Present an explicit Accept/Decline or RSVP screen and call the existing
/conversation-invitations/{id}/accept or /decline, or
/meetings/invitations/{id}/respond with the returned revision and existing headers.
Acceptance rechecks current permissions and verified ownership of the invited email.
The proof cannot be replayed; concurrent claims cannot materialize two invitations.
After claim, use the existing invitation revoke/decision APIs. Before claim, use the
new email-offer revoke endpoint. Creation/revocation conflicts retain existing 400/409
semantics; guarded requests retain existing session, Origin and rate limits.

SMTP failure leaves a safe pending email offer. Communication delivery retries use
explicit revocation/new creation with a fresh ID/key; no automatic durable SMTP retry
is claimed. Never expose proof hashes or internal SMTP state in application logs/UI.

## 5. Module/channel notification settings

Existing authenticated `GET /notifications/preferences` and
`PATCH /notifications/preferences` gain `moduleChannels`.
Keep existing revision, idempotency and Origin headers for this endpoint as
specified in OpenAPI. All existing global settings/quiet-hour fields remain.

Modules: `PERSONAL`, `PROJECTS`, `TEAMS`, `COMPANY`, `MESSAGING_MEETINGS`, `SOCIAL`.
Channels: `IN_APP`, `WEB_PUSH`, `EMAIL`.

```json
{
  "moduleChannels": {
    "PROJECTS": { "IN_APP": true, "WEB_PUSH": false, "EMAIL": false }
  }
}
```

A PATCH may supply any subset of modules. For each supplied module, all three
boolean channels are required. Omitted modules preserve their values. Unknown
module/channel keys and per-event-type settings are rejected. Responses include
all six modules with all three booleans. Existing users inherit enabled module
switches, leaving their existing global/availability/consent restrictions intact.

Effective delivery requires BOTH the module switch and existing global channel
policy, transport availability, authorization, quiet-hour rules and any separate
consent. Enabling a module never opts a user into Browser Push or enables SMTP.
Messaging push retains its separate consent. Modules without an existing email or
push transport do not acquire one from these settings. Disabling affects delivery;
it does not erase historical notifications. Build a six-row, three-column settings
matrix alongside the existing global settings and channel-availability indicators.

## Migration and deployment notes

Prepared additive migrations:

- `202611230088_project_manual_status`: Project column, enum CHECK and index.
- `202611230089_conversation_member_visibility`: private member flags/history floor.
- `202611230090_invitation_email_delivery`: safe delivery-state metadata.
- `202611230091_module_notification_channels`: backward-compatible JSON preferences.
- `202611230092_project_member_weekday_capacity`: typed Project/member-generation overrides.
- `202611230093_communication_email_invitations`: typed secure communication offers and acceptance email binding.

Three new typed tables; no destructive migrations, live Docker migrations, volume changes,
production deployment or Shared activation are part of this checkpoint. Apply
migrations before running the new image, only after a verified backup and reviewed
safe migration plan. Rebuild the shared application image and restart API/worker
services when deployment is separately authorized; PostgreSQL needs no image or
volume recreation. Configure SMTP and INVITATION_ACCEPT_URL in deployment secrets/
configuration. The current deployment has not been interrupted.

The five-feature backend contract is ready for Frontend integration. Live database
migration and deployment remain separately controlled. Publication SHAs and the
normal push result are reported in the final execution response.
