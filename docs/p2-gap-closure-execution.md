# P2-GAP-CLOSURE execution

Authority: owner's complete Projects Backend implementation request, 2026-11-15.
Baseline: `892b79aa2b5d3cada942e985bd1405de00a1ed34`, clean working tree,
84 canonical migrations. Backend writes only; Frontend is a read-only reference.

Implement all missing approved capabilities through existing owners:

1. Task soft deletion and retained linked-record integrity.
2. Persistent scoped Task ordering.
3. Real Task hierarchy using the existing depth-five Task engine.
4. Assignment acceptance withdrawal and history.
5. Assignment reminders through existing notifications/outbox.
6. Persisted workflow drafts and controlled publication.
7. Authorized pending invitation metadata.
8. Recipient-only proof lifecycle and repeat-safe resend.
9. Private bounded invitation decline notes.
10. Database-backed normalized scoped Project keys.
11. Phase dates, counts and actual progress.
12. Milestone status, phase association, counts and progress.
13. Factual advisory health with reason codes and unknown states.
14. Evidence-based cycle time.
15. Actual scope-change history.
16. Stable scoped risk codes.
17. Numeric risk probability 0–100 (reuse; no bands).
18. Risk checklist.
19. Risk comments/history.
20. Risk close/reopen evidence.
21. Atomic traceable Risk conversion preserving the source.
22. Private file folders.
23. Actual binary file versions and authorized downloads.
24. Effective upload configuration.
25. Authorized detailed activity and bounded analytics/workload; capacity remains
    unknown without explicit authorized availability, never private colleague data.
26. Atomic Project setup and versioned Blank/Kanban/Scrum initial templates.
27. Authorized Team association at creation with independent Project admission.

Reuse existing custom templates and grants without expanding their capabilities.
No new engines, Guest Grants, custom-template features, Frontend writes, Shared
activation, development/production migrations, deployment, commits or pushes.
Only isolated test migrations and owned synthetic test-schema cleanup are allowed.

Tests: focused domain/HTTP/integration coverage per capability, then all applicable
quality gates once. Retain historical OpenAPI baselines; record exact approved
extensions. Review new FKs and cleanup order before changing the fail-closed hash.

## Prerequisite defect

The Company-finance Project-disposal failure is a shared lifecycle regression.
Personal migrations 056/059 add exactly two Routine FKs to the 951-FK reviewed
catalog. Removing those two entries from the actual 953-FK catalog reproduces the
old pinned SHA-256 exactly. Routine's owner-composite FK makes both edges Personal;
they cascade with Routine and introduce no shared disposal dependency.
The existing guard correctly refused the changed catalog before disposal.

Reviewed both edges, updated the exact catalog hash, retained fail-closed handling
for unknown references and strengthened the disposal regression to await terminal
job completion (Project row removal precedes final CORE cleanup).

`pnpm.cmd test:integration apps/api/test/integration/company-finance.spec.ts`:
20/20 PASS. Project/Team/Company unknown-reference targeted regressions: 3/3 PASS.
No historical SQL or database repair was needed.

## Approved key namespace decision (2026-11-16)

The owner approved account uniqueness for independent Projects and selected-Team
uniqueness for Team-associated creation. Read-only preflight on both local
databases found zero non-null keys, zero duplicate groups and zero ambiguous key
namespaces. Migration 069 preserves spelling and IDs, adds normalized database
uniqueness and typed owner references. Custody handover and Team disposal rehome
namespaces atomically; collisions block the transaction rather than rename data.

## Final acceptance

COMPLETE. All 27 capabilities are covered. The final broad run passed 773
unit/contract/architecture/compatibility tests and 1,091 integration tests. All
95 migrations rehearse cleanly, preserving 296 predecessor datasets and 84 old
checksums across eleven interruption rollbacks and repeated deployment. Final
typecheck recheck passed. At that checkpoint development remained at 84 migrations
and test had 95. The owner then authorized finalization on 2026-11-16: local
development is now migrated to 95, with every old dataset preserved and applied
checksums verified in both databases. Normal commit/push of the approved batch is
authorized; production, Shared activation and the next batch remain excluded.
See [completion record](p2-gap-closure-report.md) and the dedicated
[frontend handoff](frontend-handoff/PROJECTS_GAP_CLOSURE.md).
