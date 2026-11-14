# Company Backend completion (C-M1 to C-M4): report

> **Update 2026-11-13 (backend completion):** The FK-catalog re-pin, transfer-catalog entries and most items listed as blocked here were completed. The contract is now 960 operations. The current status, remaining items and operator setup are in [`backend-pre-frontend-integration-report.md`](backend-pre-frontend-integration-report.md).

Date: 2026-11-13. Status: **PARTIAL (release-gated).** All Company functionality that the current owner decisions allow is implemented and tested. Two things still block release:

1. **Shared cleanup FK fingerprint (inherited from the Team batch).** Migration `202611130049_company_completion` adds 19 FKs (812 → 831). The new catalog digest is `dfe92757bbc4195af37ee19a4d76adc5c7a2ee1726675c1a7135d49e36374b29`. Until it is re-pinned in the planned stabilization pass, Company/Project disposal fails closed with `CLEANUP_RETRY_REQUIRED`, exactly as it already did after the Team migration. The pin was not edited.
2. **Open owner decisions.** They are listed in section 8. Each affected feature fails closed.

Scope: Company only. Nothing was changed in Frontend, Team features, Personal, Projects or Social. Shared was not activated, no live tests were run, and nothing was committed or pushed.

## 1. Screen-by-screen coverage

E = EXISTING (reused), I = IMPLEMENTED here, B = BLOCKED (the decision is named), NA = NOT APPLICABLE. Paths are relative to `/api/v1/companies/{id}`. `ctx` means `/contexts/{scopeId}`.

| Screen                       | Requirement and status                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CS-01 shell / access         | E: `GET ctx/access/me` (role, capabilities), departments and units, per-department `access/me`.                                                                                                                                                                                                                                    |
| CO-00 all companies          | E: list, read, archive, restore, delete (password) and status. B (OD-1): create needs an operator `retentionPolicyVersion`.                                                                                                                                                                                                        |
| CO-01 overview               | I: `GET ctx/reports/kpis`. Department narrowing works by passing the department `scopeId`. E: `reports/operations · finance · portfolio`, `finance/approvals` (approvals for me). I: `resource-requests` lists the requests the caller may decide. B (OD-2): goals is `null`. NA: health score (owner answer: no composite score). |
| CO-02 departments + policies | E: create and PATCH department and unit; manager = `DEPT_MANAGER` membership (`PATCH ctx/members/{accessId}`); `GET/PUT ctx/policy` capability-rule chain with versioned publication and audit. B (OD-5): move / reparent. B (C-M2): named policy values with levels (see section 8).                                              |
| CO-03 people                 | E: `staff-profiles`, `availability`, members with `displayName`, sent-invitation list. I: `GET ctx/directory` (public directory projection) and `PUT ctx/staff-profiles/{profileId}/work-details`. B (OD-4): invitation proof delivery. B (OD-3): per-person workload heat.                                                        |
| CO-90 sheets                 | E: invite, department and unit create. B: company-new (OD-1), invite delivery (OD-4).                                                                                                                                                                                                                                              |
| CO-04 work                   | E: associations, `attachments`, attachment-request, accept, revoke and detach. I: `GET ctx/association-summaries` (name, lifecycle, responsible person, member count) and `GET ctx/association-candidates`. NA: project health, progress or workload values (not invented).                                                        |
| CO-05 goals                  | B (OD-2): there is no Company goal model.                                                                                                                                                                                                                                                                                          |
| CO-06 resources              | E: resources, allocations, retire, cancel and return. I: resource types, `PUT resources/{resourceId}/type`, versioned approval workflows, resource requests with decision, withdraw and history. Rooms can be modelled as a manager-defined type and booked through requests. B (OD-3): room day grid and capacity heat.           |
| CO-07 knowledge              | E: folders, documents, file versions (upload, complete, publish, download), search and reconcile. B (OD-6): rich-text body, acknowledgement and reminders.                                                                                                                                                                         |
| CO-08 expenses               | E: create, PATCH draft, submit, cancel, corrections, reversals, receipts, categories and reviewer. I: fixed-currency enforcement (C-M1).                                                                                                                                                                                           |
| CO-09 approvals              | E: `finance/approvals` (decision, escalate, restart, history), versioned `approval-workflows`. Requesters are excluded as reviewers. B: C6 thresholds and escalation days (never invented).                                                                                                                                        |
| CO-10 budgets                | E: budgets, adjustments, commitments, archive. Budget variance is in `reports/finance`. I: budget usage in `reports/kpis`. B: `requestBudgetChange` as a request record (see section 8).                                                                                                                                           |
| CO-11 reimbursements         | E: reimbursements, close, history, balances, payment acknowledgements (decision, corrections). B (OD-7): payment runs. NA: `markRecordedInPersonal` (client-side Personal write).                                                                                                                                                  |
| CO-12 employee file          | E: employee cases (open, entries RESPONSE / APPEAL / REVIEW, erase). B (OD-8): sealed file, access grants and download pack. Sealed data is never exposed through search, export, KPIs or summaries.                                                                                                                               |
| CO-13 reports                | E: operations, finance, portfolio, audit, CSV exports and history. I: KPIs. B: PDF format and goal reports (OD-2).                                                                                                                                                                                                                 |
| CO-14 settings               | I: `GET /settings`, `PUT /settings/currency`. E: chains (approval workflows), policy, ownership handovers, archive and delete. B (OD-9 remainder): `legalName`, `fiscalStartMonth`. B (C9): time-boxed grants.                                                                                                                     |

## 2. New operations: 23 (887 → 910)

Every operation uses the existing session guard, the Company guard (`Cache-Control: no-store`, no query string on writes), Origin checks, strict Zod input, signed cursors, `If-Match` on mutations of existing records, `Idempotency-Key` on creates, `ETag` on single records, and audited effects.

| Method and path                                                                                                                                                         | Who                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /settings`                                                                                                                                                         | Admitted Company member with `structure.read`.                                                                                       |
| `PUT /settings/currency`                                                                                                                                                | Owner or Org Admin, with the Company revision in `If-Match`.                                                                         |
| `GET ctx/directory`                                                                                                                                                     | Admitted context member (ordinary directory policy).                                                                                 |
| `PUT ctx/staff-profiles/{profileId}/work-details`                                                                                                                       | The employee or a scope manager.                                                                                                     |
| `GET ctx/reports/kpis`                                                                                                                                                  | Scope manager (same audience as the source reports); the read is audited.                                                            |
| `GET ctx/association-summaries`                                                                                                                                         | Department-context member. Only rows whose source the caller reads independently.                                                    |
| `GET ctx/association-candidates`                                                                                                                                        | Department-context member. Lists only the caller's own Projects and Teams.                                                           |
| `GET`, `POST ctx/resource-types`; `PATCH ctx/resource-types/{typeId}`                                                                                                   | Read: any context member. Write: manager.                                                                                            |
| `PUT ctx/resources/{resourceId}/type`                                                                                                                                   | Manager.                                                                                                                             |
| `GET`, `POST ctx/resource-workflows`; `GET`, `PATCH ctx/resource-workflows/{versionId}`; `POST …/publish`, `POST …/archive`                                             | Manager.                                                                                                                             |
| `GET ctx/resource-requests`; `POST ctx/resources/{resourceId}/requests`; `GET ctx/resource-requests/{requestId}`, `GET …/history`; `POST …/decision`, `POST …/withdraw` | Requests: any non-Viewer member. Reads: manager, the requester, or the actor eligible for the current step. Withdraw: the requester. |

**Changed (additive):** the five resource responses add a nullable `typeId`. The exact previous → approved hashes are in `tooling/compatibility/company-completion-api-extensions.json`. No other operation changed.

## 3. Financial and access rules

### Currency (OD-9 / F1)

- **Counted records.** Every `CompanyBudget` row and every `CompanyExpenseVersion` row, in any state, counts as a financial record. Commitments, adjustments, allocations, reimbursement buckets and acknowledgements all derive from these two.
- **Setting the currency.**
  - The currency can be set or changed until the first counted record exists. After that it is permanently locked (`COMPANY_CURRENCY_LOCKED`).
  - It can never be cleared.
  - New records in another currency are refused (`COMPANY_CURRENCY_MISMATCH`).
  - Records cannot be created until a currency is set (`COMPANY_CURRENCY_REQUIRED`).
- **Concurrency.** Record creation takes `FOR SHARE` on the Company row and the currency change takes `FOR UPDATE`, so the two are serialized. DB triggers back up both checks, and are tested by bypassing the service.
- **Legacy Companies.** A Company that already has records may only confirm the single currency those records already use; a mismatch gives `COMPANY_CURRENCY_CONFLICT`. Nothing is converted. Legacy rows can't be corrected or reversed until the currency is configured.
- **Scale.** Scale comes from the existing ISO minor-unit table, and all money is handled as exact strings and bigints.

### Resource approvals (C4)

- **Bound version.** A request binds the PUBLISHED version for its resource's type at submission. Later publications never rewrite it.
- **Deciding a step.** Each step lists approver roles (`OWNER`, `ORG_ADMIN`, `DEPT_MANAGER`). The decider's effective roles are their scope seat role plus an inherited root admin role.
- **Refusals:**
  - The requester can never decide their own request (`SELF_APPROVAL_FORBIDDEN`).
  - A decider without a listed role is refused (`APPROVAL_ROLE_REQUIRED`).
  - A rejection requires a reason.
  - A revoked requester admission blocks approval.
  - Final approval creates the allocation under the existing overlap guard (`RESOURCE_UNAVAILABLE`).
  - With no published path, the request is refused (`RESOURCE_APPROVAL_WORKFLOW_REQUIRED`). No stage is invented.
- **Immutability.** Terminal requests, published versions and the request history are immutable at the DB level.
- **Erasure.** Identity erasure clears request reasons.

### Directory and work details (C-M3)

- **Directory fields.** The directory returns name, position, department (scope), work email (only if published by the employee), work phone, location and hours.
- **Excluded from the directory.** Supervisor, redacted profiles and stale admissions are never returned.
- **Erasure.** Profile and identity erasure clear the new fields, and a DB CHECK enforces it.
- **Sealed file.** The sealed file is not implemented (OD-8).

### KPIs

All amounts are in the fixed Company currency. A ratio is `null` when its denominator is 0.

| KPI      | Source                                                                                                  | Calculation                                                        |
| -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Tasks    | Authorized portfolio Project reports                                                                    | DONE ÷ (taskCount − CANCELED), in basis points                     |
| Capacity | Explicit availability days and Project estimates                                                        | Known and unknown days are kept separate. No assumed working week. |
| Expenses | Effective approved expenses in the window; active budgets in the fixed currency that overlap the window | Usage = Σ budget spent ÷ Σ budget limit                            |
| Goals    | None (OD-2)                                                                                             | Always `null`                                                      |

There are no performance scores. Only managers can read KPIs; they can already see the underlying detail.

### Associations (C3)

Summaries reuse the existing attached-list authorization: a row is returned only when the caller has independent `task.read` on the source. Attaching grants no membership.

## 4. Migration and safety

`202611130049_company_completion` is additive. It adds:

- Company `currency` and `scale`, which stay null for existing Companies.
- Three staff-profile columns.
- Four tables: `CompanyResourceType`, `CompanyResourceWorkflowVersion`, `CompanyResourceRequest` and `CompanyResourceRequestEvent`.
- `CompanyResource.typeId`.
- Guard triggers.

No data is rewritten and no existing migration was altered.

Review steps:

- The migration is hash-pinned in `tooling/testing/reviewed-company-completion-migration.ts`.
- Lifecycle cleanup covers the four new tables.
- `db:migrations:check` passes.

Release still requires the FK fingerprint re-pin described at the top of this report.

## 5. Contract and compatibility files

- OpenAPI: `docs/api/openapi.json` (910 operations).
- Contracts: `packages/api-contracts/src/company-completion{,-openapi}.ts`.
- Frozen signatures: `tooling/compatibility/company-completion-api-signatures.json`.
- Extensions: `company-completion-api-extensions.json`.

## 6. Remaining Frontend mappings

| Frontend method                                                  | Backend source                 |
| ---------------------------------------------------------------- | ------------------------------ |
| `overview`                                                       | `reports/kpis`                 |
| `updateGeneral`                                                  | `PUT settings/currency`        |
| `staff`, `updateWorkProfile`                                     | `directory`, `work-details`    |
| `resources`                                                      | `typeId` plus `resource-types` |
| `resourceRequests`, `requestResource`, `withdrawResourceRequest` | the request routes             |
| `chains` for resources                                           | `resource-workflows`           |
| `projects`, `teams`                                              | `association-summaries`        |
| `attachCandidates`                                               | `association-candidates`       |

Show `COMPANY_CURRENCY_*` codes on the expense and budget forms.

## 7. Verification

| Command                                                             | Result                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`                                                    | PASS                                                                                                                     |
| `pnpm architecture`                                                 | PASS (no violations)                                                                                                     |
| `pnpm openapi:check`                                                | PASS                                                                                                                     |
| `pnpm db:migrations:check`                                          | PASS                                                                                                                     |
| `pnpm test` (unit, contract, architecture, compatibility)           | PASS after updating the operation, reference and migration inventory pins                                                |
| ESLint and Prettier on changed files                                | Clean                                                                                                                    |
| Integration: `company-completion.spec.ts`                           | 7/7 PASS (currency lock and DB guard, concurrency, approval workflow, directory privacy, KPIs, candidates, HTTP headers) |
| Integration: companies, staff, knowledge, settlements, associations | PASS                                                                                                                     |
| Integration: company-finance                                        | 19/20                                                                                                                    |
| Integration: company-lifecycle                                      | 16/20                                                                                                                    |

The 5 integration failures are all disposal paths that end in `CLEANUP_RETRY_REQUIRED`. That is the fingerprint blocker.

**Test fixtures changed for OD-9:**

- The finance, settlements and knowledge fixtures set USD.
- One lifecycle test sets USD and uses revision 2.
- The old mixed USD/JPY report test now asserts that JPY is refused.

Not run: the full integration suite, live tests, Docker.

## 8. Unresolved decisions (exact questions)

1. **Cleanup re-pin.** Approve re-pinning `SHARED_CLEANUP_FK_SHA256` to `dfe92757…374b29`, covering 831 FKs (Team and Company), in the stabilization pass?
2. **C-M2 policies.** Should the policy UI use the existing capability rules (key, mode, roles)? Or will you define the named policy values, their allowed levels and inheritance? Unsupported changes are refused.
3. **Expense rejection reason.** Should `REJECT` on expenses require a reason? This changes an existing request contract and needs an explicit compatibility exception.
4. **Budget change requests.** Should budget changes become a request with approval? If so, which workflow and roles? Today an adjustment is a direct manager action.
5. **OD-9 remainder.** Are `legalName` and `fiscalStartMonth` approved fields? If so, what are the semantics of the fiscal month for reports?
6. **Earlier open decisions.** OD-1 (create), OD-2 (goals), OD-3 (rooms and heat), OD-4 (invitation proof), OD-5 (move), OD-6 (KB rich text and acknowledgement), OD-7 (payment runs), OD-8 (sealed file and grants, C9), and C6 (thresholds) are unchanged.

## 9. Git working tree

Everything is uncommitted. Team and earlier changes are preserved.

New files:

- Migration: `prisma/migrations/202611130049_company_completion/`
- Services: `companies/application/company-resource-requests.service.ts`
- Controllers: `companies/http/company-completion.controller.ts`
- Contracts: `company-completion{,-openapi}.ts`
- Compatibility: three files under `tooling/compatibility/company-completion-*`
- Migration review: `tooling/testing/reviewed-company-completion-migration.ts`
- Tests: `apps/api/test/integration/company-completion.spec.ts`
- This report

Modified files:

- Company services: companies, finance, staff, reports, associations, cleanup
- Module and public index
- Contracts: `company-staff.ts`, `index.ts`, `openapi.ts`
- `prisma/schema.prisma`
- `docs/api/openapi.json`
- Compatibility and safety tooling: `openapi-compatibility.ts`, `migration-safety.ts`, `scripts/openapi.ts`, `migrations-check.ts`
- Inventory pins: `openapi.spec.ts`, `foundation.spec.ts`
- Four Company integration specs
- `docs/FABLE_BACKEND_HANDOFF_P6_01.md`
