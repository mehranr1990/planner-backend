# Retention Policy Catalog v1.0

Status: **prepared for development and pre-production testing only.** Production use needs an operator approval of this proposal. No schema field, migration or policy-version model was added.

Source: owner product configuration, 2026-11-14. Data: `tooling/retention/catalog-v1.ts`. Seed: `pnpm retention:catalog:seed --target=development|pre-production [--apply]`.

## How the existing model works

`SharedRetentionPolicy` covers **Shared Spaces only**: `PROJECT`, `TEAM`, `COMPANY`, `CONVERSATION`, `MEETING` and `SOCIAL_GROUP`.

- Each policy has five data classes: `workContent`, `commentsHistory`, `filesDerivatives`, `exports` and `accessAuditLifecycle`.
- Each class keeps its data for `retainAfterClosureSeconds` after the Space closes or its owner departs. This comes on top of the fixed 30-day recovery window.
- A closed Space is purged, as a whole, when its **longest** class window ends.
- Policies are immutable. A database trigger refuses any `UPDATE`.
- After a Space is created, its Manager can only switch to an applicable, comparable policy that is longer. Holds and obligations are kept, and nothing gets shorter.

## Seeded policies

In every seeded policy, all classes use `PURGE`, there are no holds or obligations, the audience is `OWNER`/`ADMIN` and export authority is `OWNER`. Durations use a 365-day year.

| Version                    | Contexts      | Work and comments | Files and exports | Access/audit lifecycle |
| -------------------------- | ------------- | ----------------- | ----------------- | ---------------------- |
| `mp-rpc-v1.0-work`         | PROJECT, TEAM | 0                 | 0                 | 2 years                |
| `mp-rpc-v1.0-conversation` | CONVERSATION  | 3 years           | 0                 | 2 years                |
| `mp-rpc-v1.0-meeting`      | MEETING       | 5 years           | 0                 | 2 years                |

Each supported Space type gets exactly one default, and a Manager can only choose from this catalog. The catalog has no longer alternatives yet, because none were approved. Adding one later means writing a new immutable version.

The seed has these safeguards:

- It is a dry run unless `--apply` is passed.
- It is idempotent. Identical rows are reported as `UNCHANGED`.
- If an existing row differs, it reports `CONFLICT` and aborts before writing anything. It never overwrites.
- It never updates or deletes rows, and never starts cleanup.

## Known side effect of whole-Space disposal

Because a closed Space is purged at its longest class window, the 2-year audit window also holds a closed Project or Team's work content for 2 years. Likewise, conversation and meeting files stay until the 3-year or 5-year window ends. This keeps data longer than configured, never shorter. The operator should review it before production.

## Not seeded: approval required

| Category                                                                 | Reason                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **COMPANY** (financial records, proposed 7 years; sealed employee files) | Waiting for legal review. No class exists for finance or employee files, and a Company policy would allow whole-Space `PURGE`. Automatic deletion stays disabled. No legal period was invented, and unlimited retention was not substituted. Company creation cannot choose a version until the operator approves one. |
| **SOCIAL_GROUP**                                                         | v1.0 defines no rule for it.                                                                                                                                                                                                                                                                                           |

## Rules outside the catalog

These rules are already handled outside the catalog. The catalog has no field for them, and nothing about them was changed.

| Rule                                                      | Current handling                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Personal Tasks, Goals, Habits, Notes, Journal, Brain Dump | Kept while the Personal Space and its records are active. Personal deletion, account erasure and their existing security controls apply unchanged.                 |
| Messages in active conversations (3 years)                | Only retention after closure can be expressed. The model has no per-message age expiry, so messages in active conversations stay while the conversation is active. |
| Meeting minutes in active meetings (5 years)              | Same limitation: retention applies after closure only.                                                                                                             |
| Read notifications (90 days)                              | Notification records have no catalog class, and no new expiry job was added.                                                                                       |
| Expired invitation metadata (30 days)                     | No catalog class. Invitation proofs keep their existing security lifecycle: they expire on their time limit and become invalid once used.                          |
| Abandoned temporary uploads (7 days)                      | No catalog class. The existing upload and cleanup lifecycle is unchanged.                                                                                          |
| Operational activity records (2 years)                    | Expressed as `accessAuditLifecycle` = 2 years. The mandatory evidence floor and backup admissibility guards still apply.                                           |

## Verification

- `tooling/compatibility/retention-catalog-v1.spec.ts` checks:
  - schema validity and PURGE-only policies;
  - one default per Space type, with no Company or Social Group entry;
  - that only longer comparable policies can be selected;
  - refusals for shortening, inapplicable contexts and dropped holds.
- `apps/api/test/integration/retention-catalog.spec.ts` checks, against an isolated database:
  - dry run, then apply, then an idempotent re-apply;
  - that Space, custody and job state is untouched;
  - the catalog read per context, including that holds and obligations are not disclosed;
  - 401 without a session;
  - the immutability trigger, and that a differing row aborts the seed without being overwritten.
