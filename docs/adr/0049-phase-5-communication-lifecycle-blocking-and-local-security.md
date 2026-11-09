# 0049: Phase 5 communication lifecycle, DM blocking and local security acceptance

Status: **APPROVED by the owner**, 2026-11-09. The owner explicitly selected the
recommended option for all three decisions below.
P5-06 local execution is authorized after P5-05 publication at
`ef27d565b74cc955474af82b2abab5a7d3ca82f1`. All three product choices below are
now binding. ADRs 0044–0048, the approved 48-hour author rules,
Personal erasure and existing shared retention contracts remain binding.

Execution clarification: after automatic approval review initially rejected local
worker wiring and recovery-route registration, the owner explicitly authorized
adding that source and testing it only in fresh isolated schemas. No real worker
activation against existing data, Shared activation or deployment was authorized.

## Decisions already closed

DM block must prevent direct contact without automatically hiding common-group
messages (V3 document 03 and FR-08). Current accepted source/conversation
authority, join floors and restore generations remain mandatory. No Phase 6
connection/discovery/Circle/social graph is authorized. Shared 30-day recovery
and Personal seven-day grace remain distinct; no new lawful retention duration
is inferred. Retention is configured by immutable approved policy versions,
class deadlines, holds and obligations; missing policy fails closed.

P5-04 WebSocket, Presence, Typing and connection/subscription infrastructure remain
deferred. REST recovery, missed-message/change synchronization, multiple-device
consistency, ordering, idempotency, revocation, cursor recovery and bounded polling
are active P5-06 acceptance requirements. No socket or speculative transport code.

## Decision 1: Exact DM block and mention effects

**Approved:** an explicit, private account-pair contact block applies across
existing and recreated DMs between those users. A known DM participant or named
pending invitation recipient may block without accepting unwanted contact.
No new global people lookup is introduced; only an already authorized DM/pending
invitation supplies the counterparty identity.

While either direction is blocked, deny new DM invitations/admission and all new
DM contact/content interactions in either direction, including send, reply,
forward, edit, reaction and pin. Preserve current authorized historical reads,
author tombstone deletion within the existing policy, personal hide/report/leave,
and account erasure. Blocking neither deletes bodies nor revokes group/work
membership. Unblock permits future explicitly authorized contact but revives no
canceled invitation, pending Push or stale admission/receipt.

Common-group/work messages remain visible under normal current permissions.
Explicit mention delivery/annotation between the blocked pair is suppressed,
without suppressing unrelated group content or other recipients. Notification
workers recheck the current block before dispatch; no block list/individual
blocking activity is disclosed to counterparties or other group members.
No Presence/Typing implementation is added to satisfy the future-only effects.

Alternative: blocking also ends both parties' current DM history access and
requires fresh explicit admission after unblocking. This is a broader content
revocation/history policy, not implied by blocking new direct contact.

## Decision 2: Communication closure and retention execution

**Approved:** apply the existing shared lifecycle contract to independent
CONVERSATION and MEETING custody using effective admitted participants, not stale
technical context seats. Last effective departure/account closure initiates one
durable closure generation, immediately invalidating admissions/invitations and
ordinary access/writes. Owner/organizer exit with remaining participants preserves
their authorized reads and the approved no-automatic-promotion rules; it is not
last-member deletion and cannot prevent unrelated Personal erasure.

Reuse the already approved 30-day shared recovery window, provider-backed fresh
reauthentication, single-use recovery proof, generation/revision fencing and
recorded former-custodian recovery. Recovery creates fresh explicit domain
admission; old conversation history floors/cursors/grants do not revive. Meeting
published-document access retains ADR 0048 semantics. No recovery after a
destructive claim; erased identities cannot be recreated.

Disposal is controlled by each captured operator-approved retention policy,
class deadlines, holds/obligations and typed actual custody. No default DM,
workplace or meeting retention days and no production policy are provisioned.
Configured PURGE removes only eligible owner-owned rows/bytes in bounded,
resumable stages. PSEUDONYMIZE preserves its explicitly retained protected record
and records the next accountable disposition; it does not silently mean PURGE.
Active-parent and outside referenced resources remain protected. Signed independent
restrictive control evidence is replayed before a restored target can serve data.
Actual production restoration/activation is not authorized by this local work.

Alternative: keep all communication disposal blocked after last departure until
another product lifecycle decision; P5-06 would remain partial for that scope.

## Decision 3: Malware scanning and local acceptance boundary

The current Storage content policy explicitly performs signature/type checks,
**not antivirus or full document decoding**. V3 engineering contract section 6
requires bounded media processing, unsafe metadata handling and malware checks.
There is no approved/installed antivirus provider in the locked register.

**Approved local boundary:** implement/test bounded structural image checks,
pixel/decompression ceilings and rejection of unsafe image metadata/active file
content while preserving the existing byte/hash contracts. Do not label these
checks antivirus. Full malware-engine integration and actual scanning are an
explicit **NOT RUN / required release blocker before deployment or Shared
activation**, alongside the existing operational gates. Phase 5 acceptance is
local backend acceptance only, not production security clearance. No new scanner,
service or dependency is silently installed and no production data is migrated.

Alternative: approve a separately reviewed self-hosted scanner adapter/provider
now, then install/configure and prove it before final local acceptance. This
changes the locked infrastructure register and requires a concrete provider,
failure/quarantine policy and installation authorization.

## Independent engineering work

Publication verification, protected snapshots, P5-05 API signature freeze,
requirement-by-requirement P5-04 audit, REST recovery/backpressure contract and
tests, current privacy/revocation review, migration planning and targeted checks
can proceed together with the now-approved policy-dependent implementation.
No further routine approval is required for these three closed decisions.
P5-06 remains unstaged, uncommitted and unpushed. No deployment, Shared activation,
P5-04 transport or Phase 6 work.
