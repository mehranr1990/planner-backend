# P4-06 acceptance blocker: pre-existing local test M031 drift

**Resolution for P4-06 LOCAL acceptance, owner-approved 2026-11-08:** preserve the
legacy database unchanged and select a separate newly created canonical test
baseline. This is verified in [the final report](p4-06-final-report.md#approved-canonical-test-baseline).
All 63 new-baseline SQL checksums, the 637-FK catalog, seven enabled financial
triggers and 40 affected integration tests pass. Read-only before/after snapshots
confirm all 190 legacy table datasets, its ledger and catalog are unchanged.
No historical SQL, ledger row, existing data or protected environment file changed.
The legacy drift is not repaired; the legacy default target is excluded from this
acceptance. The original diagnostic and blocked-checkpoint text below is preserved
as history, superseded only as to the required acceptance-baseline decision.

Detected 2026-11-08 during independent checksum verification. This is a diagnostic
record, not authorization to repair a database, modify migration history or relax
checksum acceptance. P4-05's published Git baseline remains unchanged and verified.

## Exact evidence

Artifact: `prisma/migrations/202611070031_company_finance/migration.sql`.
Published/reviewed SHA-256:
`2ee6190668e6f964fbcf933aad9039141f2226f67c4b08b4fccab8f2f287ad72`.
The configured local test database's successful M031 ledger row instead records:
`7caa92c24fa749279e4191e6afc7110bc148077c4dc3c9ebb82f764dc30863af`.
Its recorded completion is 2026-11-07T07:43:33.567Z. Neither LF nor CRLF conversion
of the published artifact explains the difference. No other successful test SQL
checksum differs from its current artifact.

Read-only catalog comparison against a newly migrated, owned disposable namespace
also confirms semantic drift. The configured test `public` namespace lacks
`company_finance_allocation_shape` and `company_finance_identity`; the balance,
budget-identity, evidence and immutable functions differ. Some differences are
search-path bindings; the balance function also has the older polymorphic
conditionals instead of the published nested table-specific guards. Therefore a
ledger-only checksum replacement would conceal real schema differences.

Evidence: `.tools/p4-06-ledgers.jsonl`, `.tools/p4-06-finance-drift.log`,
`.tools/p406-finance-live.json`, `.tools/p406-finance-fresh.json`.
These files contain catalog definitions/checksums, not financial row contents or
credentials. The disposable comparison namespace was removed by its owning helper.

The configured development database has only its original 24 migrations; all 24
checksums match and no failed migration is unresolved. Its 39 later migrations
are not applied. It was inspected read-only and not upgraded. The configured test
database has the current 63 migrations after the authorized integration setup;
the M031 discrepancy predates P4-06. New P4-06 SQL artifacts were not rewritten.

## Acceptance and next decision

P4-06 Company lifecycle and independent affiliation can be validated against
pristine isolated schemas. This does not establish that the existing configured
test database is a verified baseline. Do not mark final database acceptance or
consolidated Phase 4 local acceptance complete while this discrepancy remains.
Prisma `migrate deploy/status` alone did not detect this successful-row mismatch.

No repair was performed. Preserve the published SQL and existing ledger/data.
Under AGENTS.md sections 1, 7 and 9 and the owner's preservation instruction,
the affected database acceptance stops for an explicit reconciliation decision.
A separate reconciliation must inventory all affected M031 constraints/triggers,
review a forward correction against the published schema, rehearse preservation
and record the original checksum as evidence. It must also specify how the old
ledger provenance is represented and verified without silently replacing history.
This report does not authorize that procedure, a reset, history rewrite, source
deletion or a broad checksum allowlist.

No incomplete transfer preparation was removed or excluded to address this issue.
Executable Company custody transfer remains unreachable; Shared remains disabled.
