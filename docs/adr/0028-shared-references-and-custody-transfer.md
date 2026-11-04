# 0028 / A05: References, sharing and actual custody transfer

Status: APPROVED by owner for implementation planning, 2026-10-30.
Execution still requires explicit batch authorization.

## Decision

Task/Goal owner modules remain authoritative. Grant access to shared sources in
their existing custody; do not copy Tasks/Goals or expose a whole Personal Space.
Each shared aggregate has one authoritative source scope; secondary associations
do not grant authority. Administrative succession changes no resource spaceId.

Controlled Personal-to-Project conversion is an explicit, consented transfer of
selected resources. Parent association alone is not custody transfer. Use concrete,
scope-bearing relations and preserve existing Personal same-Space constraints.

## Transfer manifest and protocol

Persist source/destination custody and scopes, authorities/consents, selected IDs
and revisions, expanded graph, incoming private-reference dispositions, file/history
privacy choices, authorization versions, manifest hash, expiry and state.

States: PREVIEWED to ACCEPTED to APPLYING to APPLIED, or EXPIRED/CANCELED/FAILED.
Preview is read-only and expires after 30 minutes. Apply requires manifest hash,
expected revisions, idempotency and provider-backed reauthentication within five
minutes. Rebuild/compare the graph under [0031](0031-shared-transaction-fencing.md)
locks; stale graph/authority fails with a safe conflict before mutation.

| Relationship                                                   | Required disposition                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Task subtree/recurrence                                        | Move complete required closure or reject                                                         |
| Checklist/history                                              | Preserve IDs/history; shared views redact inaccessible references                                |
| Goal hierarchy/metrics/milestones                              | Preserve required closure and selected-metric integrity                                          |
| Private Habit/LifeArea links                                   | Explicit unlink or reject; never implicit disclosure                                             |
| Goal reviews/reflections                                       | Private by default; explicit inclusion consent or reject that Goal                               |
| Personal plan/note/timer/time/reminder/Capture/Goal references | Owner-controlled typed bridge or explicitly consented unlink; never silent private-data deletion |
| Files used by unmoved private records                          | Keep private; consented exclusion/unbind or reject transfer                                      |
| Labels                                                         | Eligible closure only; reject target-name collision rather than silently rename                  |
| Personal sync                                                  | Source departure/tombstone effects; never shared bodies in Personal feed                         |

Implement required bridges before enabling a transfer case. Unknown dependencies
block the command. Moving one reference does not authorize erasing another owner's
content. References to active parent-owned resources stay outside independent
cleanup manifests under [0029](0029-shared-departure-erasure-and-closure.md).

## Migration and rollback

Only transfer-required source/child FKs become DEFERRABLE INITIALLY IMMEDIATE,
with exact names reviewed in the migration artifact. Apply defers only that enumerated
set, then validates all constraints at commit. Do not globally relax financial,
Personal revision or same-Space integrity. Keep historical migrations immutable.

No arbitrary spaceId patch, engine fork or clone is an alternative implementation.
After successful transfer an old Personal-only release cannot safely service the
new state; use a compatible rollback or forward correction. See
[migration prerequisites](../g0-implementation-prerequisites.md#migration-design).

Required XFER-01–12: privacy preview, dependency closure, incoming bridges, stale
graph, labels, reused files, attribution, failure rollback, source sync departure,
idempotent success and opposite-direction transfer lock ordering.

Owner approval: explicit approval of revised A01–A08 for implementation planning.
