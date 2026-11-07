# P4-04 migration review

M032: `202611070032_company_reimbursements_and_approvals`. The reviewed helper
`tooling/testing/reviewed-company-settlements-migration.ts` pins its exact SHA-256.
All 55 predecessor SQL artifacts remain byte-identical.

Ten additive Company-owned tables: financial workflow, version, step, instance,
instance event, reimbursement bucket, request, payment acknowledgement, acknowledgement
correction and reimbursement effect. New FKs use NO ACTION, concrete context/source
and admission-interval references, with no User FK or automatic cascade. Thirteen
lookup indexes support the current source, version, request, payment and bucket
queries. Partial unique indexes enforce one active instance per source, unique
attempts/step decisions and nonduplicated approval/payment/correction effects.

Published definitions, terminal outcomes and evidence are immutable. Draft versions
can replace their own steps; publication validates bounded, distinct reviewer
designations. Source decision guards prevent bypassing controlled approvals while
preserving unbound P4-03 fixed decisions. Reviewer/source kind, same-context links,
revision identity and typed monetary records are constrained in PostgreSQL.

Monetary effects append under a locked bucket; exact scale, nonnegative balances,
pending-versus-reserved amounts and per-request caps are checked. A settled-source
adjustment may legitimately leave acknowledged excess while denying further
reservation. There is no payment execution or balance mutation of Personal Finance.

Only the predecessor SharedUsageEntry feature CHECK is expanded for six current
free-mode record kinds. Existing ExpenseVersion receives an additive controlled
decision trigger, with no predecessor row or constraint rewrite. No destructive
DDL, schema push, extension, provider, reset of an application database or production
migration. The migration is atomic with five-second lock/30-second statement budgets.

The reviewed cleanup catalog has 571 FKs, SHA-256
`abdcc24a65fa82a3d09c241101f07a5346108b4e28aab727c3ffa2d4e6c53fd9`.
New content is Company-owned; no new Project/Team incoming source dependency.
Company disposal/restore reconciliation stays separately gated at P4-06/release.

The M032 rehearsal runs after the populated M031 upgrade. It compares all 169
predecessor datasets, 55 checksums and every predecessor constraint except the
reviewed usage allowlist expansion. It tests interrupted rollback, repeat deploy,
populates all ten new tables with an approved reimbursement and separate payment
history, repeats deploy and verifies the cleanup catalog. Empty replay has 179
domain tables plus migration ledger. Observed outcomes belong in the batch report.

Use guarded isolated local PostgreSQL targets only. After financial writes, rollback
requires compatible code or a reviewed forward correction preserving all evidence.
