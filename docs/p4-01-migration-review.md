# P4-01 Company foundation migration review

M028: `202611060028_company_foundation/migration.sql` — SHA-256
`5356ececd9ab3e2d3b2c374b65149af6dbc55b5f5ac51eb58a3654d9b3d1c8b4`.

Five new tables: Company, CompanyDepartment, CompanyUnit, CompanyScopePolicy
(Companies owner) and CompanyContextAdmission (Spaces owner). Typed FKs bind
Company root, scope, author, Department parent, child/root admission and immutable
interval generations. All new FKs are NO ACTION. Domain identities and Unit parent
are immutable, metadata updates require revision increments, policy versions and
root-generation bindings are immutable. Deferred binding checks prevent effective
child memberships without a corresponding root-generation record.

Existing changes: six reviewed CHECK/allowlist expansions; corporate role columns
widen from 10 to 12 characters without changing old values; nullable Company offer
bindings; Company-only child scope kinds. Role and policy guards preserve exact
Project/Team catalogs and restrict corporate ordinary capabilities to metadata read.
Existing ROOT identity remains unchanged. No Task, Goal, Calendar, Personal, auth,
independent Project/Team custody or source ownership rewrite.

M029: `202611060029_company_invitation_snapshots/migration.sql` — SHA-256
`4841b4a44f0e236f7d7bb418683dce433a85da460f739fe0af62eb5adaa6f2c7`.

Four nullable fields bind a Company offer to the recipient's target admission ID,
generation, revision and snapshot version, with real admission/interval FKs and
immutable scoped bindings. No existing row, proof, recipient or state is changed.
Legacy prototype Company offers without snapshot version remain preserved and are
unacceptable/unpreviewable through current validation; ordinary expiry or explicit
authorized revocation may terminate them. Existing Project/Team offers are unchanged.
This forward companion preserves the M028 bytes already used in local rehearsal.

Both artifacts are atomic with five-second lock and 30-second statement budgets,
reviewed hashes and architecture checks. Exact cleanup FK digest:
`d1ac2453d5ebdd6b82f3ba6021d549a8e77f31f75055492a3bc2b33bdab3ad5b`.
The historical M026 and M028 rehearsals retain their historical catalog digests.
The Project/Team purge predicate is unchanged and never admits Company custody.

Rehearsals preserve all 146 populated predecessor datasets, 51 committed migration
checksums and prior constraints except six reviewed branch/allowlist expansions;
then populate Company hierarchy, policies, child admission and a legacy pending
offer before M029, preserving all 151 table datasets, 52 preceding checksums and
the offer's exact pending state/recipient/proof bytes. Interrupted rollback,
resumed/repeated deploy, original columns, legacy invitation nulls and final FK
catalog are checked. Empty replay retains 151 domain tables plus migration ledger.

DDL is restricted to guarded isolated local PostgreSQL targets in this batch.
Configured databases are never reset. No production schema or runtime activation
is authorized. Company operational restore, disposal and attachment need their
later reviewed owner controls; use compatible code or a reviewed forward correction
after Company writes exist. Production/Docker release gates remain deferred.
