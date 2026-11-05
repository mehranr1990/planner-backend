# P2-06 M08 migration review

Two reviewed atomic migrations add eleven typed tables without rewriting prior
Personal/Shared data, attribution, API enums or ownership keys. All 36 historical
migration bytes remain frozen. The only changed prior constraint is the additive
SharedUsageEntry feature allowlist; its existing ten keys remain. Its one-unit
delta and one-audit-per-entry constraints remain unchanged, including bulk writes.

- `202611040013_project_execution`: risk/issue register/history, immutable Project
  template registry/versions, immutable change plans/typed Task sources, explicit
  capacity/allocation and report snapshot/source tables. Exact scoped Project,
  Task, actor, admission-interval and assignment FKs; named version pointers,
  immutable identities/publication/history, range/page indexes, one-slot unique
  constraints and explicit signed-manifest lifecycle checks.
  SHA-256: `1fc290e40f5dba4d0fe5524bbf2ac84d9a1a0ae3c6b9cc953981c8d998cb6937`.
- `202611040014_shared_task_work_log`: a Task-owned explicit shared-effort source,
  separate from Personal Focus/TimeEntry, with scoped source/actor/admission FKs,
  exact author identity, durable creation uniqueness, bounded UTC intervals and
  immutable content except author-authorized voiding through the owner facade.
  SHA-256: `93a738fd9b49b9cebca2fe056af8268cfdedc0bf0479af7c3c4cbeafb3900001`.

Both use explicit transactions, a five-second lock timeout and a 30-second statement
timeout. No destructive backfill, schema push, configured database reset or
production operation is authorized. JSON definitions/manifests are bounded strict
versioned scalar command/definition snapshots; external live references use typed
scope-bearing FKs. Template definition keys are local closure keys, never arbitrary
live User/Task/file references.

The mandatory owned-schema M07 to M08 rehearsal snapshots all 115 prior domain
tables and all prior constraints, seeds concrete workflow/version/binding/approval,
field/default/value, dependency, metadata and reschedule data, and compares 36
historical checksums. It exercises interruption/rollback of each new artifact,
resume and repeat deployment. Only the allowlist extension may differ. Production
data volume/timing, off-host restore and operator retention/security acceptance
remain independent release gates.
