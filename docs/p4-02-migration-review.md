# P4-02 staff and resources migration review

M030: `202611070030_company_staff_and_resources/migration.sql` — SHA-256
`97262820b4eac440eeabff5ea76551554fafce06ddaa6b5b299cd0dc661800e1`.

Six additive Company-owned tables: CompanyStaffProfile, CompanyAvailabilityDay,
CompanyResource, CompanyResourceAllocation, CompanyEmployeeCase and
CompanyEmployeeCaseEntry. All new relationships use NO ACTION foreign keys.
Compound Company/context, resource/case and member/admission-interval keys prevent
foreign-context references. Supervisors bind same-Company admission and interval;
the CompanyAccess owner facade additionally verifies current root admission.
Creator attribution references boundary-local actors, never live User ownership.

Identity, creation facts and subject admission generations are immutable. Updates
increment revision. Original case evidence and entries cannot be rewritten except
for irreversible privacy redaction; append corrections and reviews. Availability
natural identity cannot change. Allocation original facts and terminal states are
immutable. Active allocations lock their resource row before checking half-open
interval conflicts. Its partial ALLOCATED overlap index is SQL-owned, rather than
represented as a full Prisma index. Retirement rechecks outstanding allocations under the same row
lock. No PostgreSQL extension or new dependency is required.

The only predecessor constraint change extends the SharedUsageEntry feature CHECK
with six current free-mode Company resource kinds. It changes no existing values.
No predecessor rows, memberships, invitations, auth tables, Personal ownership,
Task/Goal/Calendar or independent Project/Team custody are rewritten. All 53 prior
SQL artifacts remain immutable. No automatic Company purge is enabled.

M030 is atomic, with five-second lock and 30-second statement budgets. Its review
helper pins exact SQL bytes. The current 455-FK cleanup catalog SHA-256 is
`2cb90db886074953fcea33bba180735a03253b2b5f12aea46c9c6f6961773273`.
The historical M029 rehearsal retains its original catalog digest; the new rehearsal
owns the current digest. Company-only new FK targets remain outside Project/Team
purge manifests, and their custody-kind predicate is unchanged.

The required rehearsal compares all 151 populated predecessor table datasets,
53 migration checksums and every predecessor constraint except the reviewed usage
allowlist expansion. It exercises interrupted transaction rollback, repeat deploy,
then populates all six new tables and checks repeat deploy preservation. Empty
replay has 157 domain tables plus the migration ledger. These are acceptance
requirements; observed results are recorded in the batch report after execution.

Migrations run only against guarded isolated local PostgreSQL test targets here.
No configured application database reset or production migration is authorized.
Rollback after Company staff writes requires compatible code or a reviewed forward
correction. Sensitive erasure uses the owning module callback, signed restrictive
evidence and existing fail-closed Company restore quarantine; operational Company
restore reconciliation/disposal remains separately gated at P4-06 and release.
