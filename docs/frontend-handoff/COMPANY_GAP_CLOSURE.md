# Company gap closure — frontend handoff

Use `docs/api/openapi.json` and exports from `@mehran/api-contracts` as the
current contract. Frontend files were not changed. Shared remains disabled;
local test acceptance does not authorize activation or production use.

All paths below include `/api/v1`. `ctx` means
`/companies/{id}/contexts/{scopeId}`; Company root context has `scopeId=id`.
Company, Department and Unit IDs are stable security scopes. Root membership
never grants child, Team or Project content membership.

## Transport and errors

Use the existing verified Better Auth session cookie and permitted Origin for
writes. Responses are `no-store`. UUIDs are opaque. Creates carry a fresh
`Idempotency-Key`; retain it across retries of the same request body. Mutations
of existing records send the returned strong `ETag` as `If-Match` (`"2"`, for
example). A 409 `STALE_REVISION` requires re-reading; never overwrite blindly.
All new POST operations return 200, including creates. The existing invitation
and handover creates retain 201. No proof is accepted in query parameters.

Pages use `{items,nextCursor}`; submit `after=nextCursor` with the same filters.
Limits are at most 100. Date-range queries use explicit UTC `from`/`to`, are
positive and bounded to 366 days. Reports are exact-context results. Child
traversal is bounded; oversized results fail 413 rather than silently truncate.

Unknown/unauthorized objects return 404; known action denial returns 403.
Other relevant errors: 400 invalid body/headers, 409 closed lifecycle or conflict,
413 configured query bound, 429 throttling and 503 unavailable privacy/control
infrastructure. Do not convert these into empty successful datasets.

## Authorization by operation family

| Family                                                  | Required current authority                                                                                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization chart                                      | Root admission and effective structure/directory policy; ordinary members receive admitted branches. Administrators may see structure-only nodes with null counts and `RESTRICTED` evidence. |
| Transfer history, security audit, retention status      | Company Owner/Org Admin.                                                                                                                                                                     |
| Department analytics, assets, KPI observations, cycles  | Current exact-context admission and Owner/Org Admin, or Dept Manager in that child context.                                                                                                  |
| Review assignment                                       | Scope manager; this grants no right to read the assigned body's contents.                                                                                                                    |
| Review body/history                                     | Current generation-bound subject or named current eligible reviewer only. Reviewer submits; subject completes; manager closes the fully completed cycle.                                     |
| One-on-one                                              | Creation by a scope manager. Content/actions/history only by its current bound manager or employee; manager must retain managerial authority.                                                |
| Custom roles, temporary access, access inventory/review | Owner/Org Admin with explicit context admission. Only the existing `structure.read`/`directory.read` keys are configurable; administrative/financial powers retain fixed membership rules.   |
| Effective read permissions                              | Caller’s own current exact-context admission; returns the actual two configurable permissions after grants, expiry and inherited ceilings.                                                   |
| Delegations                                             | Eligible current financial manager; named original workflow authority to delegate. Delegator or Company admin can revoke.                                                                    |
| Financial policy/alerts                                 | Existing scoped financial-management authority.                                                                                                                                              |
| Financial decision/timeline                             | Existing finance audience; only current stage/designated or valid delegated authority decides.                                                                                               |
| Invitations                                             | Existing role-specific invitation management rules; recipient proof endpoint is recipient-only.                                                                                              |
| Handover list                                           | Current Owner or bound current from/to participant; never substitute the recipient.                                                                                                          |
| Recovery cases                                          | Existing root members may request their own case; admin or same current requester sees its safe status. Governance drafts are admin-only and always inactive.                                |

## Wire the Company screens

1. **Organization and lifecycle.** Load `/companies/{id}/organization-chart`.
   `memberCount:null` means restricted, not zero. Continue using the existing
   context membership change/invitation/leave APIs for admission, role changes,
   suspension, departure and reinstatement. Work-profile ACTIVE/INACTIVE is work
   metadata and never legal termination. Revoked admissions return through a new
   invitation/generation. Independent Teams and Projects remain separate.
2. **Transfers.** Existing preview/apply commands remain. Load
   `/companies/{id}/department-transfers/history`. New rows contain the recorded
   Department/Unit placements, employee/initiating actor, CONFIRMED state and
   effective timestamp. Legacy null placement snapshots are unknown; do not infer
   them from today's Unit parent. No historical transfers were fabricated.
3. **Department analytics.** Use `ctx/reports/department-analytics?from=…&to=…`.
   Membership/resource/goal counts are current at `snapshotAt`. Transfer counts
   use event timestamps; approval throughput uses terminal transition timestamps;
   review counts concern records created in the requested window. This response
   contains no private review body, Personal work or Finance amounts. Fetch the
   existing authorized operations/portfolio/finance reports for those panels.
4. **Approval policies and chains.** Configure existing `ctx/finance/approval-workflows`
   and immutable versions/ordered named steps. Workflow kinds now include
   `BUDGET_CHANGE`. Create policy drafts at `ctx/finance/approval-policies`, then
   explicitly publish via `/{policyId}/state`. Every tier supplies its currency,
   exact minimum, exclusive maximum or null, optional category, workflow version
   and optional escalation seconds. Nothing is seeded. Overlaps fail 409.
   `submit-by-policy` fails `APPROVAL_POLICY_REQUIRED` unless exactly one current
   published tier matches. Existing explicit-workflow submissions remain valid.
5. **Decisions, delegation and escalation.** Prefer the new
   `ctx/finance/approvals/{approvalId}/decision-receipts` operation with both
   headers. Read `action-state` for current stage/actions and `timeline` for
   request type/ID, pinned policy/workflow, actor, delegation, decision, reason and
   status transition. A rejection requires a reason. There is no correction-return
   state in the existing lifecycle. Manage `ctx/approval-delegations` with explicit
   validity windows and workflow version. An expired/revoked grant never authorizes
   a decision; there is no redelegation chain or self-approval. Existing manual
   escalation uses the named alternate. Worker escalation requires a pinned
   configured timeout and an active published policy; it never approves or pays.
   Pending policy-bound restarts must match the current selected policy.
6. **Invitations and roles.** Use `ctx/sent-invitations` for recipient email, role,
   created/sent/expiry timestamps and status. Resend rotates the proof and retains
   recipient-only acceptance. Existing HTTP invitation creation returns `proof:null`.
   Use the existing recipient proof endpoint when accepting. Use custom-role and
   assignment routes for the two configurable read capabilities; do not render
   these as a way to grant Owner, financial or Team/Project rights.
7. **Temporary access/reviews.** Use explicit principal, exact context, capabilities,
   valid-from, expiry and reason. Inventory distinguishes membership, role
   assignments, temporary grants and workflow delegation. `REVOKE` in an access
   review atomically removes additional grants/delegations, preserving membership;
   use the existing protected membership endpoint for a separate membership change.
   Never infer an automatic review interval or automatic membership revocation.
8. **Assets.** Set/read the optional asset tag through the resource's `asset-tag`
   operation, using the resource revision. Tags are trimmed/NFC-normalized and
   Company-scoped unique, retaining spelling/case. Existing tagless assets remain
   valid. Custody is separately assigned/returned; it never changes ownership.
   Outstanding custody blocks internal employee transfer and resource retirement.
   Maintenance retains service facts and explicitly changes state. Scheduled or
   in-progress maintenance blocks new custody/bookings until completion/cancel;
   no service interval/end time is inferred. Conflict is 409.
9. **Resources/utilization.** Existing rooms/bookings and `reports/utilization`
   remain reservation-based. New `reports/resource-usage` unions clipped intervals
   per resource and separates `bookedMilliseconds` from `custodyMilliseconds`.
   `occupancyBasisPoints:null`/UNKNOWN means no usage evidence. Bookings prove
   reservations, not human attendance; custody proves possession, not occupancy.
10. **Finance.** Reuse categories, budgets/adjustments/commitments, expenses,
    reimbursement balances/history, two-party payment acknowledgements, payment
    runs and `reports/finance`. Amounts are exact decimal strings in the configured
    Company currency; do not perform FX or sum currencies. Budget-change requests
    optionally bind the same multi-stage engine; direct decisions cannot bypass a
    bound chain. Budget alerts use explicit monetary thresholds, SPENT or COMMITTED
    (spent plus remaining reservations), and deduplicate once per configured rule.
    New notifications are `BUDGET_THRESHOLD` and `APPROVAL_ESCALATED`.
    Approved reimbursement and internally confirmed payment runs are not proof of
    bank settlement; only the existing beneficiary-confirmed acknowledgement is
    settlement evidence. Do not post to Personal wallets or create payroll.
11. **KPI/reviews/one-on-ones.** Persist actual measured observations with metric,
    period, source, unit and value through `reports/kpi-observations`. Historic
    trends use these rows/checkins, never today's snapshot reconstructed backwards.
    Cycles follow DRAFT→OPEN→CLOSED; assign participants in DRAFT. Reviews follow
    DRAFT→SUBMITTED→COMPLETED. Private revisions preserve corrected submissions.
    One-on-one notes and separate follow-up actions are participant-confidential.
    Do not copy them into public tasks/messages or include them in dashboards.
    Existing sealed employee/receipt storage does not grant a one-on-one attachment
    purpose; do not rebind those files. Personal erasure redacts new private payloads.
12. **Company analytics.** Compose authorized organization, department analytics,
    observed KPI/goal history, usage and existing operations/portfolio/finance
    reports. Source-level authorization still applies to every independent source.
    Work without permitted source evidence is UNKNOWN; no Personal sharing or
    availability is inferred. Review dashboards expose counts only.
13. **Ownership and reauthentication.** Use the existing create/detail/accept/
    decline/revoke handover routes and the new bounded GET list. Acceptance requires
    Better Auth password verification within the final fenced transaction; active
    session alone is insufficient. Existing seven-day offer expiry and terminal
    replay rules remain. Acceptance revokes the former owner's sessions and the
    recipient's other sessions; prompt for login when a session is revoked.
14. **Sensitive audit/emergency recovery.** Security audit is an admin-only opaque
    history, separate from ordinary activity. Recovery cases return non-sensitive
    status and `executable:false`. Governance drafts accept explicitly supplied
    approvers/quorum/timing/reference values or null missing values. They remain
    DRAFT even when populated; there is no takeover/finalization endpoint.
15. **Retention.** Read `/companies/{id}/retention/readiness`. A recorded catalog
    approval is not Shared activation; `activationAuthorized` is always false.
    An invalid/unavailable policy does not become approved. Null holds means
    unknown readiness, not zero. Existing operator catalog/configuration and legal
    holds remain authoritative. Provisioning still fails closed without admission.

## Retention and emergency-policy review draft

For legal/operator review, provide an immutable version, approval reference,
accountable operator, market/jurisdiction scope and applicable COMPANY context;
explicit retention/disposal/audience/export rules for work, history, files,
exports and access/audit/lifecycle; named obligations and holds with review/release
evidence; and an approved off-host backup/restore reference. Assign the new private
review/one-on-one payloads to a reviewed sensitive-data disposition and preserve
independent Personal erasure. No duration is proposed or automatically filled.

For emergency administrative recovery, separately approve eligibility, independent
verification evidence/issuer, named eligible approvers, required approvals, waiting
period, action-bound provider/MFA proof lifetime, anti-replay/revocation rules,
appeal/notification/audit and legal/retention handling. Draft persistence does not
approve governance or enable takeover. No operator/global-admin bypass exists.

## Exact new operation inventory

The following table references the exported Zod schemas directly. Apply the
authorization family above; a `rev` mutation requires `If-Match`, `key` requires
`Idempotency-Key`. Revisioned single-record responses return `ETag`. Report/page
responses have no ETag. Full error schemas and required headers are canonical in
OpenAPI. All operations use the session and exact Company/scope boundaries above.

| Operation                                                              | Request/query schema                     | Response schema                         | Headers  |
| ---------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------- | -------- |
| `GET company/organization-chart`                                       | `CollaborationEmptySchema`               | `CompanyOrganizationChartSchema`        | none     |
| `GET company/department-transfers/history`                             | `CompanyGapPageQuerySchema`              | `CompanyTransferHistoryPageSchema`      | none     |
| `GET ctx/reports/department-analytics`                                 | `CompanyObservationRangeSchema`          | `CompanyDepartmentAnalyticsSchema`      | none     |
| `GET company/recovery-cases`                                           | `CompanyGapPageQuerySchema`              | `CompanyRecoveryCasePageSchema`         | none     |
| `POST company/recovery-cases`                                          | `CompanyRecoveryCaseInputSchema`         | `CompanyRecoveryCaseSchema`             | key      |
| `GET company/retention/readiness`                                      | `CollaborationEmptySchema`               | `CompanyRetentionReadinessSchema`       | none     |
| `GET company/ownership-handovers`                                      | `CompanyGapPageQuerySchema`              | `CompanyOwnerHandoverPageSchema`        | none     |
| `GET ctx/sent-invitations`                                             | `CompanyGapPageQuerySchema`              | `CompanySentInvitationPageSchema`       | none     |
| `POST ctx/invitations/{offerId}/resend`                                | `CollaborationEmptySchema`               | `CompanyInvitationSchema`               | rev, key |
| `GET ctx/resources/{resourceId}/asset-tag`                             | `CollaborationEmptySchema`               | `CompanyAssetTagSchema`                 | none     |
| `POST ctx/resources/{resourceId}/asset-tag`                            | `CompanyAssetTagInputSchema`             | `CompanyAssetTagSchema`                 | rev      |
| `GET ctx/resources/{resourceId}/custody`                               | `CompanyGapPageQuerySchema`              | `CompanyCustodyPageSchema`              | none     |
| `POST ctx/resources/{resourceId}/custody`                              | `CompanyCustodyCreateSchema`             | `CompanyCustodySchema`                  | key      |
| `POST ctx/resources/{resourceId}/custody/{custodyId}/return`           | `CollaborationEmptySchema`               | `CompanyCustodySchema`                  | rev      |
| `GET ctx/resources/{resourceId}/maintenance`                           | `CompanyGapPageQuerySchema`              | `CompanyMaintenancePageSchema`          | none     |
| `POST ctx/resources/{resourceId}/maintenance`                          | `CompanyMaintenanceCreateSchema`         | `CompanyMaintenanceSchema`              | key      |
| `POST ctx/resources/{resourceId}/maintenance/{maintenanceId}/state`    | `CompanyMaintenanceChangeSchema`         | `CompanyMaintenanceSchema`              | rev      |
| `GET ctx/reports/kpi-observations`                                     | `CompanyObservationPageQuerySchema`      | `CompanyKpiObservationPageSchema`       | none     |
| `POST ctx/reports/kpi-observations`                                    | `CompanyKpiObservationCreateSchema`      | `CompanyKpiObservationSchema`           | key      |
| `GET ctx/review-cycles`                                                | `CompanyGapPageQuerySchema`              | `CompanyReviewCyclePageSchema`          | none     |
| `POST ctx/review-cycles`                                               | `CompanyReviewCycleCreateSchema`         | `CompanyReviewCycleSchema`              | key      |
| `POST ctx/review-cycles/{cycleId}/state`                               | `CompanyReviewCycleChangeSchema`         | `CompanyReviewCycleSchema`              | rev      |
| `POST ctx/review-cycles/{cycleId}/assignments`                         | `CompanyReviewAssignmentSchema`          | `CompanyPerformanceReviewSchema`        | key      |
| `GET ctx/performance-reviews`                                          | `CompanyGapPageQuerySchema`              | `CompanyPerformanceReviewPageSchema`    | none     |
| `GET ctx/performance-reviews/{reviewId}`                               | `CollaborationEmptySchema`               | `CompanyPerformanceReviewSchema`        | none     |
| `POST ctx/performance-reviews/{reviewId}/submit`                       | `CompanyReviewSubmissionSchema`          | `CompanyPerformanceReviewSchema`        | rev      |
| `POST ctx/performance-reviews/{reviewId}/complete`                     | `CollaborationEmptySchema`               | `CompanyPerformanceReviewSchema`        | rev      |
| `GET ctx/performance-reviews/{reviewId}/history`                       | `CompanyGapPageQuerySchema`              | `CompanyPrivateRevisionPageSchema`      | none     |
| `GET ctx/one-on-ones`                                                  | `CompanyGapPageQuerySchema`              | `CompanyOneOnOnePageSchema`             | none     |
| `POST ctx/one-on-ones`                                                 | `CompanyOneOnOneCreateSchema`            | `CompanyOneOnOneSchema`                 | key      |
| `GET ctx/one-on-ones/{recordId}`                                       | `CollaborationEmptySchema`               | `CompanyOneOnOneSchema`                 | none     |
| `POST ctx/one-on-ones/{recordId}/revisions`                            | `CompanyOneOnOnePatchSchema`             | `CompanyOneOnOneSchema`                 | rev      |
| `GET ctx/one-on-ones/{recordId}/history`                               | `CompanyGapPageQuerySchema`              | `CompanyPrivateRevisionPageSchema`      | none     |
| `GET ctx/one-on-ones/{recordId}/actions`                               | `CompanyGapPageQuerySchema`              | `CompanyOneOnOneActionPageSchema`       | none     |
| `POST ctx/one-on-ones/{recordId}/actions`                              | `CompanyOneOnOneActionCreateSchema`      | `CompanyOneOnOneActionSchema`           | key      |
| `POST ctx/one-on-ones/{recordId}/actions/{actionId}/state`             | `CompanyOneOnOneActionChangeSchema`      | `CompanyOneOnOneActionSchema`           | rev      |
| `GET ctx/custom-roles`                                                 | `CompanyGapPageQuerySchema`              | `CompanyCustomRolePageSchema`           | none     |
| `POST ctx/custom-roles`                                                | `CompanyCustomRoleInputSchema`           | `CompanyCustomRoleSchema`               | key      |
| `POST ctx/custom-roles/{roleId}/revisions`                             | `CompanyCustomRolePatchSchema`           | `CompanyCustomRoleSchema`               | rev      |
| `POST ctx/custom-roles/{roleId}/archive`                               | `CollaborationEmptySchema`               | `CompanyCustomRoleSchema`               | rev      |
| `POST ctx/custom-roles/{roleId}/assignments`                           | `CompanyRoleAssignmentInputSchema`       | `CompanyRoleAssignmentSchema`           | key      |
| `POST ctx/role-assignments/{assignmentId}/revoke`                      | `CollaborationEmptySchema`               | `CompanyRoleAssignmentSchema`           | rev      |
| `POST ctx/temporary-grants`                                            | `CompanyTemporaryGrantInputSchema`       | `CompanyTemporaryGrantSchema`           | key      |
| `POST ctx/temporary-grants/{grantId}/revoke`                           | `CollaborationEmptySchema`               | `CompanyTemporaryGrantSchema`           | rev      |
| `GET ctx/access-inventory`                                             | `CollaborationEmptySchema`               | `CompanyAccessInventorySchema`          | none     |
| `GET ctx/access-reviews`                                               | `CompanyGapPageQuerySchema`              | `CompanyAccessReviewPageSchema`         | none     |
| `POST ctx/access-reviews`                                              | `CompanyAccessReviewInputSchema`         | `CompanyAccessReviewSchema`             | key      |
| `GET ctx/approval-delegations`                                         | `CompanyGapPageQuerySchema`              | `CompanyDelegationPageSchema`           | none     |
| `POST ctx/approval-delegations`                                        | `CompanyDelegationCreateSchema`          | `CompanyDelegationSchema`               | key      |
| `POST ctx/approval-delegations/{delegationId}/revoke`                  | `CollaborationEmptySchema`               | `CompanyDelegationSchema`               | rev      |
| `GET ctx/finance/approval-policies`                                    | `CompanyGapPageQuerySchema`              | `CompanyApprovalPolicyPageSchema`       | none     |
| `POST ctx/finance/approval-policies`                                   | `CompanyApprovalPolicyInputSchema`       | `CompanyApprovalPolicySchema`           | key      |
| `POST ctx/finance/approval-policies/{policyId}/state`                  | `CompanyApprovalPolicyChangeSchema`      | `CompanyApprovalPolicySchema`           | rev      |
| `POST ctx/finance/expenses/{expenseId}/submit-by-policy`               | `CollaborationEmptySchema`               | `CompanyFinancialApprovalSchema`        | rev      |
| `POST ctx/finance/reimbursements/{requestId}/submit-by-policy`         | `CollaborationEmptySchema`               | `CompanyFinancialApprovalSchema`        | rev      |
| `GET ctx/finance/approvals/{approvalId}/timeline`                      | `CompanyGapPageQuerySchema`              | `CompanyApprovalTimelinePageSchema`     | none     |
| `GET ctx/finance/budget-alerts`                                        | `CompanyGapPageQuerySchema`              | `CompanyBudgetAlertPageSchema`          | none     |
| `POST ctx/finance/budget-alerts`                                       | `CompanyBudgetAlertInputSchema`          | `CompanyBudgetAlertSchema`              | key      |
| `POST ctx/finance/budget-alerts/{ruleId}/revoke`                       | `CollaborationEmptySchema`               | `CompanyBudgetAlertSchema`              | rev      |
| `GET company/security-audit`                                           | `CompanyGapPageQuerySchema`              | `CompanySensitiveAuditPageSchema`       | none     |
| `GET company/recovery-policy-drafts`                                   | `CompanyGapPageQuerySchema`              | `CompanyRecoveryPolicyDraftPageSchema`  | none     |
| `POST company/recovery-policy-drafts`                                  | `CompanyRecoveryPolicyDraftInputSchema`  | `CompanyRecoveryPolicyDraftSchema`      | key      |
| `POST ctx/finance/approvals/{approvalId}/decision-receipts`            | `CompanyFinancialApprovalDecisionSchema` | `CompanyFinancialApprovalSchema`        | rev, key |
| `GET ctx/reports/resource-usage`                                       | `CompanyObservationRangeSchema`          | `CompanyResourceUsageSchema`            | none     |
| `POST ctx/finance/budget-change-requests/{requestId}/bind-workflow`    | `CompanyFinancialWorkflowBindSchema`     | `CompanyFinancialApprovalSchema`        | rev      |
| `POST ctx/finance/budget-change-requests/{requestId}/submit-by-policy` | `CollaborationEmptySchema`               | `CompanyFinancialApprovalSchema`        | rev      |
| `GET ctx/finance/approvals/{approvalId}/action-state`                  | `CollaborationEmptySchema`               | `CompanyApprovalActionStateSchema`      | none     |
| `GET ctx/effective-read-permissions`                                   | `CollaborationEmptySchema`               | `CompanyEffectiveReadPermissionsSchema` | none     |

Published matching tier policies also block legacy fixed-reviewer expense submission and direct budget decisions. Explicit workflow submissions must select the matching policy workflow and pin its version; uncovered requests retain approved legacy behavior. Policy-required budget requests expose `can.decide:false` until handled through the controlled engine. No threshold or policy is activated by default.

Archiving an applicable approved tier version keeps new matching submissions fail-closed until a replacement is published or the explicitly recorded effective-until expires; archival never silently re-enables a weaker legacy path.
