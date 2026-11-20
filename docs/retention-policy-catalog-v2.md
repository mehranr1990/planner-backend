# Retention Policy Catalog v2.0 — approval package

Status: **prepared, NOT approved.** Technical readiness only (ADR 0069). Nothing
in this file is a legal, security or operator approval. The accountable owner
fills the approval records below; tooling refuses placeholder values.

## 1. Deletion and recovery inventory

| Area                                                       | Operation                      | Type                                                     | Recovery                                                    |
| ---------------------------------------------------------- | ------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------- |
| Personal account                                           | Request deletion               | Recoverable, then legally required erasure               | 7-day grace (unchanged)                                     |
| Personal data export                                       | Export expiry                  | Not deletion                                             | Expires; backup expiry ≤ 30 days                            |
| Tasks (Personal and shared)                                | `DELETE /tasks/:id` (subtree)  | Recoverable                                              | **7 days** (stored `restoreUntil`; older deletions keep 30) |
| Task checklist items, labels, templates, saved filters     | `DELETE`                       | Permanent (hard delete)                                  | None                                                        |
| Task recurrences                                           | `DELETE /task-recurrences/:id` | Cancellation (series `CANCELED`; generated tasks remain) | None                                                        |
| Notes                                                      | `DELETE` (state `DELETED`)     | Soft delete                                              | Restorable (state `ACTIVE`), no deadline                    |
| Journal entries                                            | `DELETE` (`deleted: true`)     | Soft delete                                              | Restorable (`deleted: false`), no deadline                  |
| Mood entries, focus time entries                           | `DELETE` (state `VOID`)        | Soft delete (void)                                       | Restorable (state `RECORDED`), no deadline                  |
| Habits, Goals                                              | `DELETE` (status `ARCHIVED`)   | Archive                                                  | Reversible archive, no deadline                             |
| Goal milestones, metrics, task/habit links                 | `DELETE`                       | Permanent (hard delete)                                  | None                                                        |
| Planning day items, planning reviews                       | `DELETE`                       | Permanent (hard delete)                                  | None                                                        |
| Focus sessions                                             | —                              | No delete operation                                      | —                                                           |
| Calendar events, time blocks, team calendar events         | `DELETE`                       | Permanent (sync tombstone)                               | None                                                        |
| Finance accounts, categories, budgets, savings goals       | `DELETE`                       | Archive                                                  | Reversible archive, no deadline                             |
| Stored files, voice files                                  | `DELETE`                       | Permanent (purged after scan/audit rules)                | None                                                        |
| Project                                                    | Archive / restore              | Archive                                                  | Reversible, no deadline                                     |
| Project, Team, Company                                     | Close (lifecycle job)          | Recoverable                                              | **7 days**                                                  |
| Social Group                                               | Delete (lifecycle job)         | Recoverable; protected financial records retained        | **7 days** (was 30)                                         |
| Conversation, Meeting                                      | Close (lifecycle job)          | Recoverable                                              | **7 days** (was 30)                                         |
| Shared member departure                                    | Leave / removal                | Membership removal with recovery job                     | **7 days** (was 30 for Social/Conversation/Meeting)         |
| Social activities and items                                | `DELETE`                       | Recoverable                                              | **7 days** (was 30; stored `recoverUntil`)                  |
| Messages                                                   | Author / moderator removal     | Permanent tombstone                                      | None                                                        |
| Project comments, documents, file folders, team work items | `DELETE` / archive             | Permanent / archive                                      | None / reversible archive                                   |
| Grants, roles, delegations, push subscriptions, free-busy  | Revoke                         | Access revocation                                        | None (re-grant)                                             |
| Social circles                                             | Delete / unlabel               | Permanent / membership removal                           | None                                                        |

**Owner decision (2026-11-20): this inventory is final.** Operations listed as
permanent, archive, soft delete without deadline, cancellation or revocation keep
their current semantics; 7-day recovery applies only to the rows marked
**7 days**. Restore never revives erased-account data or files purged under the
malware/erasure rules.

## 2. Policy versions (immutable; v1.x rows are never edited)

| Version                    | Contexts      | Recovery | Work/comments retention                      | Files/exports | Audit   | Disposal |
| -------------------------- | ------------- | -------- | -------------------------------------------- | ------------- | ------- | -------- |
| `mp-rpc-v2.0-work`         | PROJECT, TEAM | 7 days   | 0 after closure                              | 0             | 2 years | PURGE    |
| `mp-rpc-v2.0-conversation` | CONVERSATION  | 7 days   | 3 years                                      | 0             | 2 years | PURGE    |
| `mp-rpc-v2.0-meeting`      | MEETING       | 7 days   | 5 years                                      | 0             | 2 years | PURGE    |
| `mp-rpc-v2.0-social-group` | SOCIAL_GROUP  | 7 days   | 0 (protected financial records stay guarded) | 0             | 0       | PURGE    |
| Company                    | COMPANY       | —        | **Not prepared: pending legal review**       | —             | —       | —        |

Retention classes are not recovery windows. These are unchanged and separate:

- legal holds and obligations (block disposal until released with evidence);
- the Social financial guard (ADR 0066 G/H);
- audit and evidence retention;
- backup expiry (30 days);
- erasure evidence.

**Company (blocked).** Seeding a Company policy needs:

- the jurisdiction(s);
- the legal basis and minimum retention for financial records, payroll and
  settlements, and sealed employee files;
- the accountable operator;
- a legal approval reference;
- a schema decision, because the model has no per-category finance or employee
  class and a Company policy authorizes whole-Space PURGE.

**Personal erasure policy (proposed identifier `personal-erasure-v1.0`, not configured).**
Content:

- 7-day grace period;
- a retention-hold acknowledgement is required;
- signed backup manifests expire after at most 30 days;
- erasure evidence is retained as minimal evidence;
- Personal finance records are personal tracking only. They are not a claim of
  exemption from any jurisdiction's financial retention law.

The owner approves the exact identifier. It is then set as
`PERSONAL_ERASURE_POLICY_VERSION`, and `web` is rebuilt.

## 3. Approval records the owner must supply (never invented)

| Record                     | Fields                                                                                                                                            | Used as                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Shared security acceptance | Document ID, date, approver name/role, scope (this deployment), reviewed controls (ADRs 0024–0031, 0057 boundary, 0058, 0068), expiry/review date | `SHARED_SECURITY_ACCEPTANCE_REFERENCE` (1–200 chars, e.g. the document ID) |
| Catalog v2.0 approval      | Approval reference, accountable operator (name/role), approved versions, market scope, effective date                                             | `--approval-reference`, `--accountable-operator`                           |
| Personal erasure policy    | Exact version ID and approved text                                                                                                                | `PERSONAL_ERASURE_POLICY_VERSION`                                          |
| Company retention (legal)  | See Company above                                                                                                                                 | New Company policy version (future)                                        |

Technical readiness is a separate thing from authorization. Tests passing
authorizes nothing.

## 4. Activation runbook (after approvals; Docker wrapper `$P`)

1. **Backup:** run `deploy/backup.sh`, or the Windows equivalent in the runbook.
2. **Migrate:** `$P run --rm migrate`. It is idempotent.
3. **Shared checkpoint:**
   `$P run --rm --no-deps ops node tooling/scripts/shared-lifecycle-admin.ts init-control`.
   - It is idempotent and does not activate features.
   - It refuses if shared custody already exists without a checkpoint.
4. **Retention catalog, dry run then apply:**
   `$P run --rm ops node tooling/scripts/retention-catalog-seed.ts --catalog=v2 --target=production --approval-reference="<ref>" --accountable-operator="<name/role>"`
   Add `--apply` once the dry run looks right.
5. **Env file:** set `SHARED_SECURITY_ACCEPTANCE_REFERENCE=<ref>`, and
   `PERSONAL_ERASURE_POLICY_VERSION=<id>` if Personal erasure is approved.
6. **Recreate services:** `$P up -d api worker`. If the erasure version changed,
   also run `$P build web && $P up -d web`.

## 5. Frontend handoff (no frontend code changed here)

- **Labels:** replace every fixed "30 days" recovery or restore text with
  "7 days". This covers Task trash, Social activity delete, Social Group
  delete, Conversation and Meeting close, and Project, Team and Company close.
- **Deadlines:** always display the server deadline instead of computing one:
  - `Task.restoreUntil`;
  - `SocialActivity.recoverUntil` and item `recoverUntil`;
  - lifecycle `recoveryDeadline`.

  Legacy rows can legitimately show up to 30 days.

- **Restore actions:** hide or disable them once the deadline has passed, and
  handle `RESTORE_EXPIRED`, `RECOVERY_EXPIRED` and `RECOVERY_UNAVAILABLE`.
- **Confirmation dialogs:**
  - Recoverable deletions: "Recoverable for 7 days, then permanently deleted."
  - Permanent deletes (list in section 1): "Cannot be undone."
- **Errors:** show `SHARED_ACTIVATION_GATED` and `SHARED_RETENTION_UNAVAILABLE`
  as "not yet enabled by the operator", not as user errors.
- **Retention policy picker:** list only versions from the catalog endpoint,
  which will include `mp-rpc-v2.0-*` once seeded.
