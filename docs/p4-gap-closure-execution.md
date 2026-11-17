# P4-GAP-CLOSURE execution

Owner authorization: Company complete gap closure request, 2026-11-16. All
32 capabilities are authorized for development; policy activation is separate.

Verified baseline: clean `main`, HEAD
`3273b054fc64796366bf814f87bdd83dcae0d96d`; 1,117 canonical operations;
`mehran_dev` and `mehran_test` each have 97 successful migrations, matching
local checksums, with no unresolved migration. Development database is read-only.

Reuse: hierarchy, admissions, profiles, invitations, fixed roles, allocations,
expense/category/budget accounting, sequential financial and resource workflows,
reimbursements, beneficiary payment acknowledgements, payment runs, reports,
goals/checkins, custody handovers, lifecycle recovery, retention and legal holds.

Extend: transfer timeline, organization chart, invitation details/resend,
department analytics, approval history/authority, resource metadata, historical
metrics, lifecycle obligations, handover discovery, sensitive audit/readiness.

Implement: asset custody and maintenance, persisted KPI observations, private
performance cycles/reviews and one-on-ones, explicit approval policy selection,
temporary access/custom read roles/access review and approval delegation.

Policy-gated: configured thresholds, automated escalation, action-bound proof
validity where not already approved, emergency recovery execution and production
retention approval. No invented durations, thresholds, approvers or legal values.

Protect independent Personal/Project/Team ownership and admission generations;
all Company writes retain custody fences, revision controls, audit/outbox and
privacy erasure. New relationships enter cleanup before parent disposal.

Validation: targeted Vitest, isolated PostgreSQL integration and migration
rehearsals, full unit/contract suite, Prisma validation, typecheck, lint,
formatting, architecture, OpenAPI compatibility and production build. No browser,
E2E, deployment, Shared activation, development migrations, commit or push.
