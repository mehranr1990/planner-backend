# P3-05 Team lifecycle migration review

Artifact: `202611060027_team_lifecycle/migration.sql`.
SHA-256: `eed884d163e8b52a6ca030c06afc20a319852351ddbc7d6082141572bafca4a0`.

The only DDL is CREATE OR REPLACE of `shared_purge_allowed(uuid)`: the accepted
custody-kind predicate expands from PROJECT to PROJECT or TEAM. The same custody
and job generation/state, expired recovery deadline, live lease/lease identity,
zero effective full memberships, active account and closure-exit checks remain
byte-identical. Application admission still checks retention/obligations, signed
fences and exact FK catalog. No guard is weakened for existing Projects.

No new entity, column, constraint or data rewrite. No prior SQL changes. Atomic
transaction with 5-second lock and 30-second statement timeout. Reviewed hash and
architecture tests pin the complete artifact and compare its function body with
the original migration. The cleanup FK digest remains
`0f5a23925dc2b9623565c973eb70c7ad6d68f538ca012e546bd166f644b18916`.

The populated upgrade rehearsal snapshots all 146 predecessor table datasets,
50 historical checksums, every constraint and the original function. Interrupted
application rolls back; resumed and repeated deployment preserves everything
except the exact approved function predicate. Empty-database replay and schema
drift checks remain mandatory. Runtime integration exercises actual Team purging,
unknown-FK denial, retention, recovery and independent source preservation.

Apply only to guarded isolated local PostgreSQL targets in this batch. No existing
configured development or production database is reset or migrated. Operational
deployment remains separately authorized; use a compatible lifecycle consumer and
a reviewed forward correction if rollback is needed after Team cleanup begins.
