# 0029 / A06: Shared departure, Personal erasure and last-member closure

Status: APPROVED by owner for implementation planning, 2026-10-30, including the
30-day shared recovery window and preservation of active-parent-owned resources.
Execution still requires explicit batch authorization.

## Scope and succession

Independent Project, Team and Social Group boundaries use this lifecycle as each
domain arrives; do not create later-phase domains in P2. Actual typed custody,
not creator identity or UI association, determines which resources may be cleaned.

- Owner departure with remaining members requires accepted succession.
- Add verified full member, propose successor, require successor acceptance and
  provider-backed reauthentication within five minutes, then atomically update
  custody/audit/usage under [0031](0031-shared-transaction-fencing.md). Old owner
  may explicitly leave afterward. Handover moves no source data.
- OwnerHandover stores participants, expected custody revision, acceptance evidence,
  expiry and terminal outcome. Seven-day expiry; one pending handover per boundary.
- Last full-member departure initiates controlled closure; never synchronous destruction.
- Full memberships count; suspended memberships remain until departure/removal.
  Guests and pending invitees do not count. Confirmed account closure ends effective
  participation. Count authoritatively under the custody lock, not a cached counter.

## Closure and recovery

The shared recovery window is 30 elapsed UTC days from the effective last-member
departure, not processing time. It is distinct from Personal's seven-day grace.

```text
ACTIVE / ARCHIVED -> CLOSING_GRACE -> ACTIVE through authorized recovery
CLOSING_GRACE -> CLEANUP_PENDING at deadline
CLEANUP_PENDING -> WAITING_OBLIGATIONS / BLOCKED_POLICY
CLEANUP_PENDING or released waiting state -> PURGING -> DELETED
PURGING -> FAILED on exhausted operational retries
```

During CLOSING_GRACE deny ordinary writes/admissions, invalidate pending invitations
and residual guest access, stop new uploads and reject stale finalization. Preserve
rows/bytes; only narrow lifecycle/status/recovery commands are allowed. Recovery
and cleanup claim lock the same custody row; no recovery once PURGING is claimed.

Recovery requires the recorded former custodian's authenticated verified active
identity, fresh provider password verification within five minutes, a hashed random
256-bit recovery proof, current closure generation/revision, database time strictly
before deadline and no destructive claim. Proof grants recovery only, not data reads.
Atomically cancel that closure generation, reestablish eligible custody/membership,
advance admission generation, invalidate proof and record audit/outbox. Do not
revive old grants, invitations or sessions. An erased identity cannot be recreated
by recovery, and no arbitrary member is automatically promoted.

Owner account closure without a successor uses OWNER_EXIT_FROZEN while resolving
custody. If members remain, preserve shared records under an explicit succession/
closure disposition, never last-member deletion. Account closure is not proof that
the remaining group has departed. The former owner's Personal erasure is independent.

## Durable cleanup and parent preservation

SharedLifecycleJob stores closure generation/effective departure time, recovery
deadline, immutable policy reference, obligations/next review, stage, lease,
revision/retries/progress, scoped resource/file manifest and recovery evidence.
Waiting obligations are scheduled states, not failed retries or extended recovery.
Bound physical file passes to 25 objects; lease attempts and effects are idempotent.

Before purging: recheck custody/generation/zero membership; end recovery; validate
retention/holds/obligations; revoke derivatives/proofs and cancel work; persist
restrictive control evidence and cleanup manifest. Owner facades remove owned
bytes/derivatives and rows in dependency order, verify completion, then retain only
policy-authorized minimal evidence. Keep file metadata until removal is confirmed.
Unexpected/foreign references block affected cleanup, never authorize broader deletion.

Active-parent-owned Team/Company resources remain under parent custody/retention
after member departure. Empty child contexts may be archived by parent policy;
parent status does not itself grant content access. Independent associated boundaries
are outside the parent's deletion graph unless a real custody transfer established
otherwise. Recheck file references and parent ownership before removing bytes.

Retention obligations may postpone disposal, not silently reopen access. Every job
has an accountable operator and next action; missing policy fails closed. See the
[retention configuration contract](../g0-implementation-prerequisites.md#retention-configuration-contract).
Live deletion is distinct from backup expiry. Retain independent signed control
evidence and replay it before a restored target can serve data.

## Personal lifecycle preservation

[0023](0023-private-export-and-account-erasure.md) remains binding: staged
confirmation, immediate restriction/session revocation, seven-day grace, proof/
password recovery, policy checks, purge and backup safeguards are unchanged.
The shared 30-day window never extends Personal grace or requires keeping a login
identity alive. Shared jobs/attribution survive via boundary-local actors/minimal
evidence. Detach live User links and pseudonymize structured derivatives before
identity removal; retained shared obligations cannot hold unrelated Personal data
hostage. Shared audit must be outside actor-wide Personal audit deletion.

Canceling Personal deletion restores no old sessions or shared grants. Explicitly
resume an eligible frozen boundary only after current custody/reauthentication checks;
never reverse accepted succession or terminal cleanup through Personal recovery.

Required LIFE-01–12: one last-member closure, concurrent departures, guest/invite
counts, parent preservation, deadline/recovery, recovery/purge winner, downtime,
holds, resumable files/DB work, retained attribution and unchanged Personal erasure.

Owner approval: explicit approval of revised A01–A08 for implementation planning.
