# Platform Admin integration readiness matrix

2026-11-27. Backend local readiness review against the Master Spec, approved
ADRs 0071-0081 and `planner-admin-front` read-only evidence. P0-P7 publication:
`9b2d7768265fe6444be17cd4d2695fbaa798237c`. Readiness was accepted and published
as `3b1e19bc59b58e4f60c5cce14749d0091b4c7f6e`. Final Diagnostics is accepted
and publication is owner-approved. This revision contains the synchronized final
212-operation Admin reference and all 22 module mappings.
This matrix is not live frontend verification or production acceptance.

The frontend's COVERAGE.md and progress log use backend `b9746e1`, 37 Admin
operations. Its 112 UI routes are implemented in Mock; no route is Live-verified.
`src/api/live.ts` wires that snapshot and rejects all provisional operations.
`src/api/transport.ts`, permission names and maintenance adapter need integration
with the current backend. Existing untracked frontend source is preserved.

All exact method/path/operation ID/capability/role mappings are generated in
[the API reference](frontend-handoff/PLATFORM_ADMIN_API_REFERENCE.md).
Shared P3 policy operations serve modules 09-12; shared P4 policy operations serve
13-15; typed P6 definition operations serve 19-21. These are shared implementations,
not missing module-specific CRUD services. Every current Admin operation is mapped.

## All 22 modules

"Ready" means implemented and locally verified backend contracts. All modules
still require the frontend to verify real session, authorization and error flows
against an appropriately provisioned backend before marking Live-verified.

| Module                    | Backend / exact mapping                          | Frontend integration action                                                                                                         | Boundaries and retained evidence                                                                                                                       |
| ------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01 Authentication / RBAC  | Ready; API reference 01                          | Preserve separate Admin cookie realm; refresh exact capability presentation; wire P2 controlled MFA recovery                        | Four roles, no MODERATOR; CLI provisioning; mandatory MFA and recent sign-in; P0/P2 records                                                            |
| 02 Dashboard              | Ready; reference 02                              | Existing typed adapter; consume current permission-filtered snapshot/window metrics and CSV                                         | Missing metrics remain unavailable, UTC `[from,until)`; P1 record                                                                                      |
| 03 Users                  | Ready; reference 03                              | Wire registration verification/login history filters and evidence fields; revision-aware resend plus existing session/bulk controls | Unknown historical first login/verification dates remain null; active sessions are not login history; P1/P2 and diagnostics records                    |
| 04 Workspaces             | Ready; reference 04; new Admin retention catalog | Wire creator-only retention catalog; distinguish logical child Team IDs and physical Space IDs                                      | Owner attribution, suspension and approved custody directions; no direct ownership reassignment; P1/ADR 0043                                           |
| 05 Memberships            | Ready; reference 05                              | Scoped user/workspace lists; use membership `id` as eligible successor access ID; ordinary successor accepts                        | No forced admission, last-owner removal or cross-Workspace private directory; P1 record                                                                |
| 06 Security               | Ready; reference 06                              | Replace provisional calls with alerts, user/Admin session controls and exact approval workflow                                      | Independent identity review and non-self approval; no public MFA-loss reset; P2 record                                                                 |
| 07 Audit                  | Ready; reference 07                              | Wire category-filtered search/detail/CSV and separate retention workflow                                                            | Immutable evidence, sensitive-field permission and expiry tombstones; P2 record                                                                        |
| 08 Privacy / retention    | Ready; reference 08                              | Wire exact deletion request/impact/approve/execute/recover/history operations; reuse ordinary account ZIP workflow where owned      | No generic invented request queue; retention catalog differs from audit/backup retention; lifecycle fences remain; P2/P7 records                       |
| 09 Health                 | Ready; reference 09                              | Replace reachability indicator with authorized health/check/repair/incidents; use P3 policy section HEALTH                          | Actual dependencies and per-process counters, no fabricated historical telemetry; P3 record                                                            |
| 10 Jobs                   | Ready; reference 10 plus shared P3 policies      | Wire allowlisted jobs/control/run/retry/cancel; use JOBS policy for schedules/history                                               | No arbitrary job names/arguments; durable pg-boss remains authoritative; P3 record                                                                     |
| 11 Storage                | Ready; reference 11 plus shared P3 policies      | Wire usage, quotas, cleanup preview/apply and exact audited private-file stream                                                     | No general content browser; distinct Super private-file capability and recent MFA; P3 record                                                           |
| 12 Backup / restore       | Ready; reference 12 plus shared P3 policies      | Wire inventory/request/detail and request/second approval; distinguish operator execution from HTTP request                         | Physical adapters, key custody and real restore drills are deployment checks; P3 record                                                                |
| 13 Communications         | Ready; reference 13 plus shared P4 policies      | Wire templates/campaigns plus system-emails metadata list/detail and allowed retry actions                                          | SMTP acceptance is not inbox delivery; sinks/unknown evidence are explicit; preferences, source authority and retention apply                          |
| 14 Support                | Ready; reference 14 plus shared P4 policies      | Wire queues/tickets/replies/assignment/state/evidence/notices and section-specific policy                                           | Public/internal note separation, user-submitted content only; trusted inbound activation is deployment work; P4 record                                 |
| 15 Moderation             | Ready; reference 15 plus shared P4 policies      | Wire reports/cases/state, explicit case-bound content/evidence, penalty, appeals and escalation inbox                               | SECURITY_REVIEWER has real moderation rights; different reviewer for appeal; P4 record                                                                 |
| 16 Plans / add-ons        | Ready; reference 16                              | Wire features/products/versions/prices and commercial policy                                                                        | Dynamic names, immutable versions, exact prices, no activation of monetization; P5 record                                                              |
| 17 Subscriptions          | Ready; reference 17                              | Use customer-scoped subscriptions/terms/entitlements/overrides/history and change/renew/pause/cancel                                | Workspace financial authority and consent; pause clock explicit; P5 record                                                                             |
| 18 Billing                | Ready; reference 18                              | Wire invoices, verification, corrections, manual refunds, credit, promotions and currency panels                                    | Integer-string amounts, authoritative ledger, no gateway charging or FX; P5 record                                                                     |
| 19 Feature flags          | Ready; shared reference 19                       | Use configuration definitions with kind FLAG, draft/preview/publish/history/rollback/kill and evaluator                             | Deterministic rollout only; no A/B engine, RBAC or entitlement grants; P6 record                                                                       |
| 20 Product configuration  | Ready; shared reference 20                       | Use definitions with kind PRODUCT and allowlisted catalog keys                                                                      | Actual runtime enforcement; limits never delete data; P6 record                                                                                        |
| 21 Settings / maintenance | Ready; reference 21                              | Use kind SETTING; wire public maintenance and Admin readiness/reopen schedules                                                      | Backend modes are NORMAL/READ_ONLY/FULL, no fourth authoritative "notice" mode; reopening requires readiness; independent operator recovery; P6 record |
| 22 Product analytics      | Ready; reference 22                              | Wire product queries/comparisons/definitions, financial query, report inbox/schedules and policy preview                            | Suppressed/null cohorts, current flag/plan cohorts, event coverage, independent currencies; no replay/private-content analytics; P7 record             |

## Frontend gap register reconciliation

These classifications apply to the concrete gap claims in the frontend's progress
document and COVERAGE, not to hypothetical new endpoints. A frontend-only gap
means a current approved contract or documented display behavior can be integrated
without backend security changes. Optional prototype features do not create new
product authorization.

| Gap                                   | Classification                                                                                                                                               | Evidence / disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-01 MODERATOR                        | Outside approved product scope; frontend integration only                                                                                                    | Exactly SUPER_ADMIN, SUPPORT, SECURITY_REVIEWER, BILLING_MANAGER. Use SECURITY_REVIEWER for its granted moderation operations; never invent a fifth role.                                                                                                                                                                                                                                                                                                               |
| G-02 capabilities                     | Frontend integration work only                                                                                                                               | Session returns `{id,role,expiresAt}`. Generated reference supplies exact current role capability sets. Static presentation may use that artifact; server remains authoritative. No dynamic roles/capability endpoint was required by approved P0.                                                                                                                                                                                                                      |
| G-03 operator name/email              | Outside approved product scope                                                                                                                               | Compact Admin session contract intentionally omits profile/directory data. Use ID/role or an unavailable label; a dedicated operator-profile product was not approved. Ordinary user profile APIs cannot be called with Admin identity.                                                                                                                                                                                                                                 |
| G-04 Admin self-profile editing       | Outside approved product scope                                                                                                                               | P1 name editing is ordinary User administration, not Admin credential/profile editing. Local language/calendar/timezone display preferences remain frontend work.                                                                                                                                                                                                                                                                                                       |
| G-05 auth schema/enrollment expiry    | Frontend integration work only                                                                                                                               | Allowlisted Better Auth response parsing in Live adapter remains necessary; TOTP URI/backup codes are returned only by enrollment. No server enrollment countdown exists in the public contract. Interruptions require checking current session/enrollment and restarting sign-in; do not invent a TTL.                                                                                                                                                                 |
| G-06 current own session              | Frontend integration work only for session controls; optional row marker outside approved scope                                                              | Better Auth list-sessions exposes own session metadata. The compact `/admin/session` does not expose provider session ID/token. Revoke-other-sessions provides authoritative exclusion of current session without guessing. Do not claim a row is current without authoritative comparison data; a new row-marker contract was not required by approved P0.                                                                                                             |
| G-07 MFA recovery request             | Already implemented in backend                                                                                                                               | P2 `POST security/approvals` with MFA_RECOVERY, independent identity review, distinct approver and execution. A locked-out operator contacts an authorized operator; do not add an unauthenticated recovery request/reset shortcut.                                                                                                                                                                                                                                     |
| G-08 MFA metadata/code regeneration   | Outside approved product scope                                                                                                                               | Current session/MFA admission is enforced and enrollment returns backup codes once. No enrolled-at/remaining-code directory or regeneration route is allowlisted. Keep unsupported fields unavailable and regeneration disabled.                                                                                                                                                                                                                                        |
| G-09 operator directory/provisioning  | Deployment-only requirement; optional directory outside approved scope                                                                                       | Provision through the existing restricted CLI; initial identity/key custody is operator work. Security operations use known exact Admin IDs and separate capabilities; no new public directory is required.                                                                                                                                                                                                                                                             |
| G-10 step-up/403                      | Frontend integration work only                                                                                                                               | Persisted recent MFA is five minutes. Re-sign-in plus actual TOTP/backup challenge refreshes it. The public exception filter intentionally returns sanitized 403 and need not disclose which authorization fence failed; no local PIN dialog or bypass.                                                                                                                                                                                                                 |
| G-11 Admin notification bell          | Already implemented in backend at owning modules; frontend integration work only                                                                             | `security/alerts`, `support/notices` plus read, and `moderation/escalations` plus read are separate authorized sources. No universal Admin inbox/exact unread-total API was approved; do not derive a global total from a loaded page.                                                                                                                                                                                                                                  |
| G-12 health indicator                 | Already implemented in backend                                                                                                                               | `GET operations/health`, authorized by `admin.health.read`; refresh and represent DEGRADED/UNAVAILABLE honestly. SUPPORT/BILLING_MANAGER lack that permission; use reachability/unavailable for them.                                                                                                                                                                                                                                                                   |
| G-13 modules 06-22 missing contracts  | Already implemented in backend; frontend integration work only                                                                                               | All P2-P7 operations are published. Regenerate frontend snapshot/types from current backend and replace provisional adapters. Current registry has 212 Admin operations including readiness and final diagnostics. No frontend source was changed here.                                                                                                                                                                                                                 |
| G-14 user totals/filters/usage        | Already implemented in backend for approved discovery/aggregate usage; frontend integration work only for supported fields; unsupported extras outside scope | P1 bounded directory has actual search/status/date/creation sort and active-session count; P2 exact-user sessions; dashboard aggregate usage and P7 privacy-safe cohort metrics. Final diagnostics adds verificationStatus, loginStatus and loginHistory filters, actual registration history and secure resend. Arbitrary sort, page total and per-user private usage remain unsupported. Preserve explicit unavailable results and do not infer activity from ACTIVE. |
| G-15 retention picker                 | Genuine missing backend contract - CLOSED in readiness                                                                                                       | Ordinary `GET /retention-policies` cannot be used by Admin cookies. Add `GET /admin/workspaces/retention-policies?context=TEAM\|COMPANY`, require `admin.workspaces.create`, delegate to the existing immutable owner catalog, disclose no holds/obligations/operator references. Actual policy provisioning remains deployment-only.                                                                                                                                   |
| G-16 successor access/status/cancel   | Already implemented in backend for approved initiation; frontend integration work only                                                                       | Membership row `id` is the access ID, with current role/state/generation. Initiation response includes authoritative workflow result. Successor acceptance/reauthentication stays in ordinary APIs. A separate Admin forced-accept/status/cancel workflow was not approved; unsupported controls remain disabled.                                                                                                                                                       |
| G-17 display/email/delivery           | Frontend integration work only; restricted fields outside approved scope                                                                                     | Authorized per-ID User/Workspace metadata and scoped membership IDs support display. Unknown invitation email and secrets remain hidden. Current invitation states/resend/cancel exist; do not invent historical delivery success. Final diagnostics adds an explicit privileged unified metadata view, including all six kinds, with truthful current source/SMTP evidence; no historical success is inferred.                                                         |
| G-18 cross-Workspace directories      | Frontend integration work only                                                                                                                               | Use approved scoped User/Workspace membership and Workspace invitation operations. Dashboard exposes aggregate totals. A new global searchable relationship directory is not required by approved contracts.                                                                                                                                                                                                                                                            |
| G-19 extra dashboard metrics          | Already implemented in backend where supported; frontend integration work only                                                                               | P1 gives current workspace totals and interval growth; P7 offers workspace-type cohort/feature trends; P4 supplies its own delivery observations. Do not invent invitation delivery rates, Company-child historical splits or unsupported time series. Unavailable remains a real supported state.                                                                                                                                                                      |
| G-20 audit/storage/subscription joins | Already implemented in backend; frontend integration work only                                                                                               | Use separate category-authorized audit filters, P3 storage usage and P5 customer-scoped subscription/history/entitlements. Bind logical scope IDs correctly; do not add private-resource fields to P1 directory responses or assume every user is a paying customer.                                                                                                                                                                                                    |

No remaining approved backend contract gap was identified by this review after
CB-INV-1 and G-15. Optional prototype fields listed above remain explicit contract
limits; this is not a claim that every prototype control has an HTTP operation.

## Frontend integration sequence

1. Consume the final backend OpenAPI and generated reference, update the frontend's
   37-operation snapshot and transport coverage, and replace provisional calls only
   where current operations exist. Preserve exact field names and schema bounds.
2. Replace provisional permission aliases (`admin.ops.health`, `admin.ops.jobs`,
   `admin.comms.read`, `admin.flags.read`, `admin.config.read`, `admin.settings.read`,
   `admin.analytics.read`, `admin.privacy.read`, `admin.operators.read`) with
   actual operation capabilities. Some aliases have no one-to-one capability:
   privacy actions are separate, and financial analytics differs from product.
3. Adapt each UI workflow to actual preview/approval/execute, typed policy sections,
   current revisions, reasons and durable request/report polling. A page is not a
   contract: multiple prototype screens may share one typed backend operation.
4. Map financial integer strings and currency separately, cohort suppression and
   unavailable freshness, actual maintenance modes and no automatic reopening.
   Keep unsupported actions disabled with an honest explanation.
5. Verify Live behavior under every actual role, session/MFA expiry, denial,
   conflict, retry and empty/partial state during separately authorized frontend
   integration. No E2E or browser verification was performed in this backend batch.

## Prototype workflow differences requiring explicit integration

The blanket G-13 status in frontend COVERAGE is stale, but it does not mean every
Mock-only control should receive a new backend operation. The following concrete
differences were checked in the provisional views and final contracts:

- Privacy's synthetic combined export/delete queue is not the P2 API model.
  Admin deletion uses exact audited request IDs and its approved state machine;
  personal ZIP exports use their existing ordinary owner workflow. Admin identity
  must not call an ordinary export as another user. An Admin-on-behalf export
  queue/automatic impersonation and arbitrary stage transitions are outside the
  approved Admin registry. Keep those prototype controls unavailable.
- Support has real ticket/queue/SLA/feedback/notices contracts. The prototype's
  independent aggregate performance report/export endpoint is not required by
  Master Spec module 14 and does not exist. Do not manufacture global SLA or
  satisfaction totals by counting the current ticket page. Show unavailable for
  that optional report until separately approved; ticket authority is unchanged.
- Subscription/invoice/history views are customer-scoped. Select an authorized
  customer and use the exact scope ID; a global subscription/invoice directory
  cannot be assumed from a Mock table. Public pricing excludes negotiated offers.
- Analytics Mock hardcodes "under 20" and "refreshed hourly". P7's actual minimum
  cohort size is policy-configured, default 5, constrained to 5-100. Use returned
  suppression/null/coverage and actual freshness. Never replace suppressed values
  with zero, infer sessions from navigation or render unavailable historical MRR.
- Analytics export uses `admin.analytics.export` plus current report-type read
  permission, not the provisional `admin.analytics.reports` alias. Report state,
  cancellation, private artifact lifetime and schedule are server authoritative.
- Maintenance's Mock `off/notice/readonly/full` states require explicit translation
  from NORMAL/READ_ONLY/FULL and message data. Typed FLAG/PRODUCT/SETTING definitions
  share the P6 workflow; prototype version editors are not separate backends.
- Prototype financial warning periods and money previews must use current P5
  policy, consent, exact amounts and immutable terms. UI defaults or stricter
  example limits do not modify the server's approved policy bounds.

These are frontend integration work or explicitly optional product differences,
not authority to bypass the final backend contracts. The backend readiness claim
does not label optional Mock-only pages/actions as fully Live-connectable.

## Final diagnostics amendment (2026-11-27)

Modules 03 and 13 additionally map the four new operations in the regenerated
212-operation reference. User adapters must consume independent verification,
suspension and login-history filters and nullable evidence timestamps. Never
label an unknown-history account "never signed in" from session count or missing
recorded events. SUPPORT can resend verification using its explicit permission;
manual verification retains its stricter pre-existing permission.

System email list/detail/retry is SUPER_ADMIN only, with recent MFA, audit,
strict bounded search/cursors and action-specific concurrency/idempotency. The
frontend must distinguish SMTP_ACCEPTED, SINK_ACCEPTED, UNKNOWN and FAILED, show
recorded history labels and never label SMTP acceptance "delivered to inbox".
Use only returned retryActions; verification/recovery responses acknowledge queued
fresh proofs. Existing owner invitation resend routes remain authoritative.
No secret/body display, generic credential replay or broad mail-content browser
is part of the contract. Other matrix classifications remain unchanged except
these explicitly approved registration/email extensions; no frontend was modified.
