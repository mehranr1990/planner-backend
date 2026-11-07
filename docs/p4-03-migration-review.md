# P4-03 migration review

M031, `202611070031_company_finance`, is an atomic additive local migration.
The exact SQL digest is pinned by
`tooling/testing/reviewed-company-finance-migration.ts`.

Twelve tables add Company categories, Project anchors, budgets, limit adjustments,
commitments, expenses/revisions, allocation plans, budget effects, review events,
receipt bindings and the Projects-owned source bridge. All fifty-four predecessor
SQL artifacts remain unchanged. No predecessor rows are rewritten. Only the
existing SharedUsageEntry feature CHECK is extended for six current finance kinds.
All new foreign keys use NO ACTION; there is no cascade disposal or User FK.

Compound Company/context and expense/version/file constraints preserve custody.
Requester, reviewer and payer reference explicit admission intervals. Money uses
Decimal(28,4), frozen ISO scale checks and exact application arithmetic. SQL checks
also enforce periods, state shapes, positive amounts, immutable revision identity,
independent reviewer bindings and effective revision ownership. Partial indexes
permit one pending revision per expense and one inverse per original budget effect.

Immutable submitted facts, terminal decisions, budget definition, original
commitment and append-only adjustments/effects/history are guarded in PostgreSQL.
Receipt and allocation mutations require a mutable draft. Budget effect and
adjustment inserts lock their owning budget and enforce nonnegative spent,
reserved and available amounts. Application custody locks serialize complete
operations; SQL is a second integrity boundary. No schema push or destructive
application-database reset is used.

The current cleanup catalog contains 510 foreign keys, digest
`5dc1448ca46c096964314477122c727a85c970da730410b3afea1492ca6b7700`.
Projects owns and removes its source bridge before Project content disposal;
Company anchors and financial evidence remain. Existing Company restore quarantine
is retained. Company disposal/reconciliation remains in P4-06 and release gates.

The M031 upgrade rehearsal follows the populated M030 rehearsal. It compares all
157 predecessor table datasets, 54 migration checksums and all predecessor
constraints except the reviewed usage allowlist expansion. It tests interrupted
rollback, repeat deploy, populates every new table, repeats deploy and validates
the cleanup catalog. Empty replay has 169 domain tables plus the migration ledger.
Observed outcomes are recorded in the implementation report.

Apply only to guarded isolated local PostgreSQL targets during this batch.
Deployment and production migration are unauthorized. After financial writes,
rollback requires compatible application code or a separately reviewed forward
correction; historical decisions and ledger evidence must remain intact.
