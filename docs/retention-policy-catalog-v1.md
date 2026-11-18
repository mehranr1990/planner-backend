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

| Category                                                                                   | Reason                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **COMPANY production policy** (financial records, proposed 7 years; sealed employee files) | Waiting for legal review. No class exists for finance or employee files. The general catalog seeds no Company policy. The separate local synthetic policy below supplies no legal or production approval. |

## Local Company testing decision (2026-11-17)

The owner explicitly approved copying Project/Team settings into separate version
`mp-local-company-v1-20261117`; see [ADR 0059](adr/0059-local-company-development-retention.md).
Recovery: 2,592,000 seconds. Additional work, comments, files and exports: 0 seconds;
audit: 63,072,000 seconds. All classes use PURGE, OWNER/ADMIN audience and OWNER
export authority, with no holds or obligations. Existing evidence, backup and
disposal gates remain. Whole-Space disposal retains closed Company data through
the longest window plus recovery. These values cover synthetic development data
only and provide no legal or production approval. Seven-year finance remains
unapproved. No existing immutable version was changed.

Data: `tooling/retention/local-company.ts`. Procedure (dry run, apply, repeat):

```powershell
node --env-file=.env tooling/scripts/retention-company-local-seed.ts
node --env-file=.env tooling/scripts/retention-company-local-seed.ts --apply
node --env-file=.env tooling/scripts/retention-company-local-seed.ts --apply
```

Requires explicit Shared local development test mode; its existing parser enforces
development, loopback API/auth/CORS and loopback `mehran_dev` without URL options.
Other environments fail before database access. The separate seed inserts only a
missing version, reports PLANNED/INSERTED/UNCHANGED/CONFLICT and never updates,
deletes or starts cleanup. It is excluded from the general catalog and must never
be copied with development data into production.

Live results: PLANNED → INSERTED → UNCHANGED; Company creation 201, owner list/read
200; second verified account denied before invitation (404), accepted its own
recipient proof (200), then read (200), with Company edit denied (403). File upload
remains denied (403). Existing signed control evidence and six audit events were
verified. Financial approval configuration/decisions were not exercised.

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

Local Company focused checks (2026-11-17):

- `pnpm.cmd exec vitest run --project compatibility tooling/compatibility/retention-company-local.spec.ts tooling/compatibility/retention-catalog-v1.spec.ts`: 7 passed, including unsafe-environment refusals before database access and insert-only/conflict behavior.
- `pnpm.cmd exec eslint tooling/retention/local-company.ts tooling/scripts/retention-company-local-seed.ts tooling/compatibility/retention-company-local.spec.ts --max-warnings 0`: passed.
- `pnpm.cmd exec tsc --noEmit`: passed.
- `node --env-file=.env.test.local node_modules/vitest/vitest.mjs run --project integration apps/api/test/integration/retention-catalog.spec.ts`: 3 passed against isolated PostgreSQL, including catalog authorization, immutable-policy and conflict safeguards. Development data was not used by this suite.
- Prettier checks on the six changed files and `git diff --check`: passed.
- `node --env-file=.env .tools/company-local-live.mjs`: 20 local live assertions passed; evidence is in ignored `.tools/company-local-live-result.json`. Existing synthetic account recovery and second-account invitation acceptance used supported APIs. Both verification sessions were signed out.
- No application code, schema migration, API contract, event/job implementation or production configuration changed. No cleanup or database reset ran. Broad suites, production release gates and financial approval decisions were not run.

- `tooling/compatibility/retention-catalog-v1.spec.ts` checks:
  - schema validity and PURGE-only policies;
  - one default per Space type, with no Company entry;
  - that only longer comparable policies can be selected;
  - refusals for shortening, inapplicable contexts and dropped holds.
- `apps/api/test/integration/retention-catalog.spec.ts` checks, against an isolated database:
  - dry run, then apply, then an idempotent re-apply;
  - that Space, custody and job state is untouched;
  - the catalog read per context, including that holds and obligations are not disclosed;
  - 401 without a session;
  - the immutability trigger, and that a differing row aborts the seed without being overwritten.

## Social Group policy (owner decision D1, 2026-11-18)

Version `mp-rpc-v1.1-social-group`, seeded by the same tool. Context `SOCIAL_GROUP`;
30-day recovery; every class 0 seconds, PURGE, OWNER/ADMIN audience, OWNER export, no holds
or obligations. It ends recoverability and allows disposal of eligible Social content only.
Protected expense, settlement, loan, dispute, audit and shared-history records stay retained
and access-restricted (ADR 0066 G/H content guard, `BLOCKED_POLICY`); no legal retention
period is inferred. Conversations keep `mp-rpc-v1.0-conversation`. See
[ADR 0067](adr/0067-social-group-chat-ledger-actors-and-group-retention.md).
