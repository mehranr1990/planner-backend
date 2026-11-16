# Teams gap closure: Claude frontend wiring

Backend batch: P3-GAP-CLOSURE. Frontend has not been modified. Use canonical
`docs/api/openapi.json`, its handoff copy and the exported Zod schemas in
`packages/api-contracts/src/team-gap-closure.ts`. Do not infer authority from a
visible Team/Project selector. Implementation/verification status is recorded in
`docs/p3-gap-closure-report.md`. The explicitly authorized isolated test backup,
restore and corrected M071 replay passed preservation checks. This document does
not authorize live activation.

All paths below have `/api/v1` prefix. All require a verified active Better Auth
session. Mutations send Origin. Strong ETags use `"revision"`, not W/ tags. Send
the last revision in If-Match where listed; 409 requires a fresh read and explicit
retry. Idempotency-Key is 1–128 printable ASCII characters; preserve it for an
identical retry, replace it for a different command. A fresh command uses a fresh
key. Never put proofs in query strings, logs, browser analytics or activity.

Pages use bounded limit ≤100 and returned opaque nextCursor as the next `after`
parameter. Calendar source pages use `cursor`. Preserve the complete filter/date
window when continuing a page. Cursors can become stale after source/permission
changes; discard them and refresh. Source views cap their bounded materialization
at 10,000 records and 100 linked Projects; 413 means narrow the date/filter scope.
Safe errors: 400 invalid DTO/header/range, 401 session, 403 visible-but-forbidden,
404 inaccessible/missing source, 409 revision/state/replay conflict, 413 bound,
429 rate limit, 503 disabled Shared infrastructure. Never use an error to discover
another tenant's source IDs.

1. **Invitations:** list `/teams/{id}/sent-invitations?state=PENDING&limit=25`.
   Rows have authorized recipientEmail, createdAt, sentAt, expiresAt, role, state
   and revision. Filter supports existing invitation states. Resend
   `POST /teams/{id}/invitations/{offerId}/resend`, `{}`, If-Match and Idempotency-Key.
   Reuse existing revoke and recipient accept/decline. Team creation/inviter
   responses return `proof:null`; the recipient calls existing
   `POST /team-invitations/{id}/proof` with If-Match, then uses its new revision
   and proof in the redacted X-Invitation-Proof header. Resend invalidates older
   proofs and preserves invitation identity. sentAt is an in-app offer timestamp.
2. **Member transfers:** DEFERRED BY OWNER. Offer destination invitation/admission
   and optional, separate source removal through existing APIs. Do not display an
   atomic-transfer promise or move assignments, Tasks, Projects, files or events.
3. **Weekly capacity:** GET/PUT
   `/teams/{id}/memberships/{accessId}/weekly-capacity`. Initial revision is 1 and
   template is null. PUT requires work.manage and If-Match; body is
   `{timezone,effectiveFrom,weekdays:[sun,mon,tue,wed,thu,fri,sat]}`. Each value is
   null or integer minutes 0–1440. Show UNKNOWN until explicit configuration;
   preserve zero as nonworking. Dated `/capacity` rows override template values.
   Capacity and member-profile revisions are independent.
4. **Availability:** GET `/teams/{id}/availability?from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=IANA`.
   This range is inclusive, at most 31 dates. Members see the approved Team
   availability boundary; Viewers see their own row. Display configured capacity,
   approved leave, net capacity, Team reservations, Shared actual work and visible
   Project allocations separately. Personal availability, busy intervals and
   hidden Project work are UNKNOWN. Do not describe net capacity as private free
   time or add private Personal working hours.
5. **Project associations:** GET current `/projects/{projectId}/association-request`
   under the Team prefix gives ETag, active link, current request and safe impact
   preview. POST plural `/association-requests` with `{id,action:LINK|UNLINK}`,
   If-Match and Idempotency-Key. Initial absent-link revision is 1. List pending
   `/project-association-requests`; POST singular `/association-request/decision`
   with `{decision:APPROVE|REJECT|CANCEL}` and If-Match. Read
   `/projects/{projectId}/association-history` for recorded paginated review
   actions and recorded request IDs/states. Approval/rejection needs both settings
   authorities; cancellation needs
   Team settings authority and Project read. Requests never grant membership.
   Existing atomic Project create with ownerTeamId and dual-authority direct
   link/unlink remain available.
6. **Task visibility and withdrawal:** GET `/teams/{id}/visible-tasks` with
   source=ALL|TEAM|PROJECT and optional status. Each full authorized Task retains
   source spaceId/scopeId/kind and original Task ID. hiddenWork is UNKNOWN;
   absence does not mean the colleague has no work. Keep pending assignment
   previews separate. For Project Tasks retain the P2 Project assignment revert
   endpoint. Team-owned assignment revert uses
   `POST /teams/{id}/assignments/{assignmentId}/revert`, `{id:newOfferUuid}`,
   If-Match and Idempotency-Key. The previous acceptance timestamp/history remains;
   its lifecycle ends with WITHDRAWN and a new PENDING offer is returned. The
   recipient alone withdraws; current original issuer authority is rechecked.
7. **Sprints:** reuse `/plans`, `/plans/{planId}/summary`, `/points` and Task point
   estimates. GET/PUT `/plans/{planId}/point-capacity` uses nullable capacityPoints,
   plan ETag and work.manage. Null means UNKNOWN; never convert hours to points.
   GET `/plans/{planId}/burndown` reports original/current Team-owned scope,
   additions/removals and nullable daily remaining minutes/points from recorded
   observations. GET `/plans/{planId}/history` is bounded actual activity.
   GET `/sprint-velocity?limit=12` reports evidence-based closed Sprint points;
   insufficient history and unestimated work remain explicit. Legacy summary
   daily remaining values are null outside the calculation date; use burndown for
   history. New Sprint reports explicitly return sourceBasis=TEAM_OWNED_TASKS.
   History observations report actual scope/completion/remaining values; a null
   observation means evidence was not recorded. Project-backed work-item history
   requires the caller's independent current Project read, including removed
   work-item references. Existing Sprint reopening is unsupported. Project read-through items
   retain their source and do not acquire Team point estimates.
8. **Calendar and RSVP:** existing Team meeting invitation respond accepts
   ACCEPTED, DECLINED or MAYBE with the invitation ETag. The recipient may change
   the response while the invitation remains valid. Creating an invitation can
   include `recurrenceKey` (`YYYY-MM-DDTHH:mm`) for an existing occurrence; omit it
   for series-level RSVP. Managers GET `/meetings/{meetingId}/rsvp-summary`,
   optionally with recurrenceKey, for accepted/declined/maybe/pending counts.
   Specific occurrence responses override the series for that date only.
   Reuse existing Calendar series mutation with THIS_OCCURRENCE and
   `patch:{status:CANCELED}` for one future occurrence. For future series use
   `{scope:CANCEL_FUTURE,recurrenceKey}` with master If-Match and Idempotency-Key.
   Preserve history; do not hard-delete. GET `/calendar/sources` with from/to
   (exclusive end), timezone, source and cursor for authorized Project overlays.
   `/calendar/occupancy` reports unioned authorized active event minutes, not
   member free/busy or Personal availability.
9. **Time-off:** PATCH `/time-off/{timeOffId}` with full
   `{id,startDate,endDate,minutesPerDay,reason}` and If-Match. Only the requester
   edits PENDING; dates are inclusive. Approved requests require cancel and a new
   request/reapproval. Refresh availability after a successful transition.
10. **Files:** keep current Team folder, file list, version, byte upload,
    finalization and authenticated download routes. GET `/files/config` for
    effective maxBytes and allowedTypes. Stable Team references stay unchanged;
    use the existing can flags and file revision, not a Project file adapter.
11. **Analytics/activity/forecast:** retain existing Team dashboard, portfolio,
    workload, analytics and capacity-summary. `/recorded-activity` adds bounded
    actual metadata events and optional action/resourceId filters. Empty
    changedFields means detail was not recorded. No confidential cases, proofs
    or private leave notes appear. `/cross-team-workload` returns only the
    requester's own visible work in their readable Teams, with source-deduplicated
    Project allocations and actual Shared effort; colleague/Personal work is not
    implied. Independent Team budgets do not establish global Personal capacity:
    cross-Team capacityMinutes stays null for multiple Teams, even when each Team
    budget is configured. Per-Team rows retain their known values. `/forecast`
    uses the same inclusive window as availability. Show
    advisory and asOf, known workload, remainingMinutes and overallocatedMinutes;
    UNKNOWN capacity/estimates must not become zero or a percentage. Visible
    Project allocations supplement Team reservations; hidden work stays UNKNOWN.
12. **Authorization-aware states:** drive controls from access/me and existing can
    flags, then handle current server denial. Team read does not confer Project
    read; Project read does not confer Team management. A hidden source gets a
    neutral unavailable state with no cached title/ID disclosure. Invalidate
    source caches after departure, revoke, lifecycle restore or membership change.

The operation manifest below is generated from the exported schema registry.

| Method/path                                                        | Request DTO                   | Response DTO                       | Query DTO                      | If-Match / ETag     | Idempotency |
| ------------------------------------------------------------------ | ----------------------------- | ---------------------------------- | ------------------------------ | ------------------- | ----------- |
| GET /teams/{id}/projects/{projectId}/association-history           | -                             | TeamAssociationHistoryPageSchema   | ProjectPageQuerySchema         | - / -               | -           |
| GET /teams/{id}/calendar/occupancy                                 | -                             | TeamCalendarOccupancySchema        | TeamSourceCalendarQuerySchema  | - / -               | -           |
| GET /teams/{id}/files/config                                       | -                             | ProjectFileConfigSchema            | -                              | - / -               | -           |
| POST /teams/{id}/assignments/{assignmentId}/revert                 | TeamAssignmentRevertSchema    | TeamAssignmentReassignResultSchema | -                              | required / -        | required    |
| GET /teams/{id}/project-association-requests                       | -                             | TeamAssociationPageSchema          | ProjectPageQuerySchema         | - / -               | -           |
| GET /teams/{id}/projects/{projectId}/association-request           | -                             | TeamAssociationSchema              | -                              | - / returned        | -           |
| POST /teams/{id}/projects/{projectId}/association-requests         | TeamAssociationInputSchema    | TeamAssociationSchema              | -                              | required / returned | required    |
| POST /teams/{id}/projects/{projectId}/association-request/decision | TeamAssociationDecisionSchema | TeamAssociationSchema              | -                              | required / returned | -           |
| GET /teams/{id}/visible-tasks                                      | -                             | TeamVisibleTasksSchema             | TeamSourceQuerySchema          | - / -               | -           |
| GET /teams/{id}/calendar/sources                                   | -                             | TeamSourceCalendarSchema           | TeamSourceCalendarQuerySchema  | - / -               | -           |
| GET /teams/{id}/cross-team-workload                                | -                             | TeamCrossWorkloadSchema            | TeamCrossWorkloadQuerySchema   | - / -               | -           |
| GET /teams/{id}/plans/{planId}/burndown                            | -                             | TeamBurndownSchema                 | -                              | - / -               | -           |
| GET /teams/{id}/plans/{planId}/history                             | -                             | TeamSprintHistoryPageSchema        | ProjectPageQuerySchema         | - / -               | -           |
| GET /teams/{id}/sprint-velocity                                    | -                             | TeamVelocitySchema                 | TeamVelocityQuerySchema        | - / -               | -           |
| GET /teams/{id}/sent-invitations                                   | -                             | TeamSentInvitationPageSchema       | TeamSentInvitationQuerySchema  | - / -               | -           |
| POST /teams/{id}/invitations/{offerId}/resend                      | CollaborationEmptySchema      | TeamInvitationSchema               | -                              | required / returned | required    |
| GET /teams/{id}/memberships/{accessId}/weekly-capacity             | -                             | TeamWeeklyCapacitySchema           | -                              | - / returned        | -           |
| PUT /teams/{id}/memberships/{accessId}/weekly-capacity             | TeamWeeklyCapacityInputSchema | TeamWeeklyCapacitySchema           | -                              | required / returned | -           |
| GET /teams/{id}/availability                                       | -                             | TeamAvailabilitySchema             | TeamCapacitySummaryQuerySchema | - / -               | -           |
| GET /teams/{id}/forecast                                           | -                             | TeamForecastSchema                 | TeamCapacitySummaryQuerySchema | - / -               | -           |
| GET /teams/{id}/meetings/{meetingId}/rsvp-summary                  | -                             | TeamRsvpSummarySchema              | TeamRsvpQuerySchema            | - / -               | -           |
| PATCH /teams/{id}/time-off/{timeOffId}                             | TeamTimeOffCreateSchema       | TeamTimeOffSchema                  | -                              | required / returned | -           |
| GET /teams/{id}/plans/{planId}/point-capacity                      | -                             | TeamSprintCapacitySchema           | -                              | - / returned        | -           |
| PUT /teams/{id}/plans/{planId}/point-capacity                      | TeamSprintCapacityInputSchema | TeamSprintCapacitySchema           | -                              | required / returned | -           |
| GET /teams/{id}/recorded-activity                                  | -                             | TeamRecordedActivityPageSchema     | TeamHistoryQuerySchema         | - / -               | -           |
