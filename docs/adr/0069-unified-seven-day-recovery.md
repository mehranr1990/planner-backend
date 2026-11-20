# 0069: Unified 7-day recovery for recoverable user-initiated deletions

Status: **Owner product decision**, 2026-11-20 ("All recoverable user-initiated
deletions across all modules must have exactly a 7-day recovery window").
Supersedes the 30-day recovery windows in ADR 0029 (Social Group, Conversation,
Meeting departure/closure), ADR 0066 A and ADR 0067 D1, and the 30-day Task
restore window. Technical change only: it does **not** grant production
retention, legal or security approval (see docs/retention-policy-catalog-v2.md).

## Decision

1. Recovery window = exactly **604800 s (7 days)** for every recoverable
   user-initiated deletion that already has a restore path:
   - Shared lifecycle jobs of every kind (`RECOVERY_WINDOW_MS`): Project, Team,
     Company, Social Group, Conversation, Meeting closure and member departure.
   - Social activities and activity items (`RECOVERY_MS`, stored `recoverUntil`).
   - Personal and shared Tasks (`TASK_RESTORE_MS`, stored `Task.restoreUntil`).
   - Personal account deletion grace (already 7 days, unchanged).
2. **No silent shortening.** Deadlines are persisted when the deletion happens:
   `SharedLifecycleJob.recoveryDeadline`, `SocialActivity*.recoverUntil` and the
   new `Task.restoreUntil` (migration `202611200086_task_restore_deadline`
   backfills existing deleted tasks with their original `deletedAt + 30 days`).
   Only deletions made after deployment receive 7 days. The SharedLifecycleJob
   CHECK already accepts exactly 168 h or 720 h (migration 0084).
3. `SharedRetentionSchema.sharedRecoverySeconds` accepts `604800` for new policy
   versions and still parses `2592000` so immutable historical versions remain
   valid. New catalog versions (`mp-rpc-v2.0-*`) declare 604800.
4. Recovery is separate from retention. Class retention (conversation 3 years,
   meeting 5 years, audit 2 years), obligations, legal holds, protected Social
   financial records (ADR 0066 G/H), backup expiry (30 days), evidence/audit
   retention and erasure evidence are **unchanged** and are not recovery windows.
5. Final scope (owner decision 2026-11-20): all other deletion semantics stay
   exactly as they are; the full inventory is docs/retention-policy-catalog-v2.md
   §1. Permanent: goal milestones/metrics/links, planning items/reviews, task
   checklist items/labels/templates/filters, calendar events and time blocks
   (sync tombstones), stored and voice files (purged), message removal, project
   comments/documents. Soft delete without deadline: Notes, Journal entries,
   mood and focus time entries. Archive: Habits, Goals, Finance records, Project.
   Cancellation: task recurrences.

## Consequences

- Frontend must show 7-day recovery text and the server-provided deadline
  (`restoreUntil`, `recoverUntil`, `recoveryDeadline`) instead of fixed "30 days".
- Production use of the v2.0 policy versions requires the approval package in
  docs/retention-policy-catalog-v2.md; seeding refuses placeholder approvals.
