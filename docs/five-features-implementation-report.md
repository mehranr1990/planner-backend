# Five approved features ? implementation report

Work item: FIVE-APPROVED-FEATURES. Status: COMPLETE (backend implementation and applicable checks).
Branch: main. Frontend and running Docker deployment untouched.

| Feature                    | Delivered behavior                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual Project status      | Independent PLANNED/ACTIVE/ON_HOLD/COMPLETED/CANCELLED, deterministic backfill, manager edits, filters, revisions and activity/audit. Existing lifecycle/progress remain separate.                                              |
| Project member capacity    | Owning-Team-only inheritance, ownerless Saturday?Wednesday 480-minute defaults, per-member weekday overrides, effective capacity API, dated exceptions/leave, timezone semantics, advisory overload.                            |
| Archive / Delete for Me    | Persistent private archive/visibility floor, sticky archive, incoming inbox revival, hidden old history and authorized detail/media/search/notice projections.                                                                  |
| Email invitations          | Existing Project/Team/Company flows plus secure Messaging/Meetings email offers, post-commit SMTP, seven-day expiry, verified exact-email claim, explicit ordinary acceptance/RSVP, issuer/source checks and single-use proofs. |
| Module/channel preferences | Six independent modules ? three channels, inherited global defaults, current delivery/creation pipeline enforcement, existing quiet hours/consent/channel availability preserved.                                               |

The previous three features were retained; continuation completes the two missing items.
No new library/provider, frontend, browser E2E, product module or deployment was introduced.

## Schema, API and safety

Prepared additive migrations 202611230088?202611230093:
manual status; private conversation visibility; invitation delivery metadata;
module notification preferences; Project member weekday templates; typed communication
email offers and acceptance email binding. Three new tables and 11 typed FKs extend
existing owners. Cleanup order and the fail-closed 1,159-edge catalog were reviewed;
Project custody snapshots include member templates. Prior rows/migrations are retained.

New APIs: three Project capacity-template/effective operations and eight communication
email-offer/claim operations. Existing invitation acceptance and RSVP contracts remain.
Claims never grant membership; verified recipients explicitly accept/RSVP afterward.
Missing/new accounts follow the same issue path without account lookup. Claim replay,
concurrent claims, expiry, revocation, changed email, source denial and issuer departure
are tested. Email proofs are hashed in PostgreSQL and sent only through private delivery
links; consumed/revoked offers clear their email/proof. Delivery failure keeps pending.

Generated OpenAPI and its existing frontend snapshot match. Historical signature
baselines are unchanged; exact approved extensions preserve contract/security checks.
[Frontend handoff](frontend-handoff-five-features.md) is ready for integration and gives
all payloads, permissions, enums, errors, filters, invitation steps and compatibility notes.
[ADR 0070](adr/0070-five-approved-features.md) records the owner-approved final direction.

## Verification evidence

- pnpm.cmd typecheck, lint, architecture, db:validate, build ? passed.
- pnpm.cmd openapi:generate and openapi:check ? passed; snapshot synchronized.
- Focused unit/API-contract/architecture/compatibility run: 354 existing/changed tests
  checked across 128 files. Four stale enumeration/snapshot expectations were corrected
  for the approved additions, and the affected four files (16 tests) passed. Required
  checks/assertions remain intact. Two additional focused contract tests also passed.
- Six-file isolated integration gate: project-core (49), project-execution (30),
  messaging (105), meetings (43), notifications (42), five-features-migrations (2):
  271 tests checked. One old expectation assumed unknown capacity without an owning
  Team; it was updated to the approved 480-minute default and its affected test passed.
  Other 270 tests passed in the gate. Later focused capacity/source/exception and
  messaging replay/claim runs also passed after the final changes.
- Relevant fixture tests use guarded isolated PostgreSQL databases or disposable
  schemas. Empty deployment, populated predecessor preservation, FK/CHECK rejection,
  and reviewed additive SQL are verified. All 118 migration folders pass the existing
  migration safety review. No database reset/schema push was performed.
- Final changed-file formatting/lint and git diff --check passed.

Commands for the integration gate:

```text
node --env-file-if-exists=.env.test.local node_modules/vitest/vitest.mjs run --project integration apps/api/test/integration/project-core.spec.ts apps/api/test/integration/project-execution.spec.ts apps/api/test/integration/messaging.spec.ts apps/api/test/integration/meetings.spec.ts apps/api/test/integration/notifications.spec.ts apps/api/test/integration/five-features-migrations.spec.ts
```

The non-integration gate used Vitest projects unit, contract, architecture and
compatibility with packages/api-contracts/src, the changed capacity/mail/preference
unit tests, apps/api/test/contract, tooling/architecture-tests and tooling/compatibility.
Only affected checks were repeated after failures or final edits.

## Publication and operations

Five logical feature commits and a normal origin/main push are authorized only after
verification. Exact SHAs and actual push result are recorded in the final execution
response. No force-push, reset, clean or stash is used.

NOT RUN: live SMTP/Resend sender-domain delivery, Docker rebuild/start, live migration
application, production deployment and full historical upgrade rehearsals. These were
not needed for the focused local code gate and remain controlled release operations.
SMTP acceptance never claims inbox receipt. Configure SMTP and an HTTPS
INVITATION_ACCEPT_URL; failures preserve a safe pending offer. No verification check
is weakened. There are no remaining implementation decisions or code blockers.

Deployment, when separately authorized: verify the backup and safe migration plan,
apply all six additive migrations, rebuild the shared application image and restart
API/worker. No PostgreSQL image or persistent-volume recreation is required. Current
Shared Security activation, retention catalog, seven-day recovery and signed controls
remain unchanged. No later roadmap batch has started.
