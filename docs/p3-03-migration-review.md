# P3-03 migration review

Artifact: `202611060025_team_capacity/migration.sql`.

SHA-256: `2581bb85256f1c660045c543d18d1a19a411868eedbbef35d1c40284d619029c`.

One new `TeamCapacityDay` table, primary UUID, bounded/null availability, positive
generation/revision, root equality CHECK, unique Team/member/generation/day/zone,
range index. Three NO ACTION foreign keys bind Team, exact scoped ContextAccess
and its admission interval. The trigger preserves identity and enforces revision
increments. No User ownership, source custody transfer, cascade deletion or new
Personal/Project/Team source columns.

The only change to an existing table is replacing the SharedUsageEntry feature
CHECK with its exact prior allowlist plus `team.capacity-day`. This requires the
same pinned explicit migration review as previous free-mode feature additions.
The migration is atomic, with 5-second lock and 30-second statement timeouts.
No prior migration SQL is edited; no backfill or deletion. Shared cleanup's exact
FK catalog becomes `336a7052accb2274b6a30ab56a9aaa192e3f11285ab425d3f1039797b9f55e73`.
The new references target Team/Spaces-owned membership records; existing Project
cleanup cannot remove Team capacity. Team root lifecycle remains P3-05 and gated.

The upgrade rehearsal snapshots all 139 predecessor table datasets, seeds an
accepted P3-02 Team with task, Calendar, plan, work-item and Project reference,
preserves all 48 prior ledger checksums and prior constraints except the reviewed
usage CHECK extension, interrupts/rolls back DDL, resumes and repeats deployment,
and checks the final cleanup catalog. Integration tests exercise foreign-Team,
missing generation, duplicate key, out-of-range minutes and immutable identity.

DDL is applied only in guarded isolated PostgreSQL test targets. No configured
development/production database is reset. Deployment and rollback execution remain
release-only. A compatible forward correction is preferred after shared writes;
an earlier application does not understand these capacity rows or usage features.
