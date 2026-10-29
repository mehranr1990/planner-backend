# 0021: Exact achievement catalog seed migration

Status: APPROVED by owner for P1-11, 2026-10-29.

## Context and proposed exception

ADR 0020 approves three persisted immutable AchievementDefinition rules. The
P1-11 additive migration creates those rows with one literal INSERT. The generic
migration safety gate deliberately rejects all INSERT statements, including this
reference-data seed. Its rule is: "Unrecognized migration forms need owner review."

Approve only `202610290004_p1_11_analytics_rewards/migration.sql`, SHA-256
`afd24e0261ca1dafdb6aa71b76c0ed36013e7f11896dfd8ad8d601abcd976b57`.
An exact name/hash guard will review this migration; all other migrations continue
through the unchanged additive/destructive safety checks. The only data statement
is this approved catalog seed into a newly created table:

```sql
INSERT INTO "AchievementDefinition" (id,code,"ruleVersion",kind,required) VALUES
('11000000-0000-4000-8000-000000000001','FIRST_TASK',1,'TASK',1),
('11000000-0000-4000-8000-000000000002','TEN_TASKS',1,'TASK',10),
('11000000-0000-4000-8000-000000000003','SEVEN_HABIT_DAYS',1,'HABIT_DAY',7);
```

The rest is additive tables, columns, constraints and indexes, enclosed in one
transaction. No UPDATE, DELETE, DROP, procedural SQL, prior-data rewrite or prior
migration modification. All twenty previous migration files and the pg-boss
artifact remain byte-identical. Do not introduce a general INSERT allowlist.

## Current evidence and verification

The migration applied successfully in development and isolated test. Before/after
checks verified all sixty previous application tables, every previous column and
row, unchanged. The generic integration gate correctly stopped before tests on
this unrecognized SQL form. Further migration-gated tests remain pending approval;
the gate will not be bypassed. No reset or failed migration recovery is needed.

After approval test exact hash drift rejection, empty/previous-schema migration,
repeat deployment, catalog constraints, preserved rows and all mandatory gates.

Owner approval: Explicit approval of this exact migration exception in the P1-11 session.
