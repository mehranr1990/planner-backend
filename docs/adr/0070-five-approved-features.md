# 0070: Five approved backend feature extensions

Status: Owner-approved implementation direction, 2026-11-23. The follow-up explicitly
resolves the capacity source and authorizes completion, five feature commits and a
normal origin/main push after verification. Deployment remains unauthorized.

Manual Project status is independent of lifecycle and progress: PLANNED, ACTIVE,
ON_HOLD, COMPLETED, CANCELLED. Backfill is deterministic PLANNED; manager status-only
edits use work.manage, revisions and existing audit/activity. Metadata edits retain
their existing settings.manage authority.

Project capacity inherits only from ownerTeamId (existing keyOwnerTeamId storage).
Extra linked Teams do not alter it. Ownerless Projects use Saturday?Wednesday 480
minutes and Thursday/Friday zero. Project weekday overrides are member-generation
scoped; null weekday entries inherit. Explicit Project dated capacity wins, followed
by Team dated exceptions, Project weekday override, then Team weekday template.
Approved Team leave retains its availability reduction; explicit Project dates remain
authoritative. Incompatible/missing owning-Team evidence stays unknown. Overload is
advisory and never changes assignment authorization or adds manager approval.

Conversation archive/delete-for-me use private persistent member state. Incoming
messages restore hidden inbox visibility without clearing archive or the maximum of
join/deletion history floors. Own sends do not restore the inbox. Shared content and
other participants are preserved; content projections and notices enforce visibility.

Secure invitation SMTP delivery runs after commit with proof hashes in PostgreSQL
and raw proofs only in private delivery links/fragments. Email verification, explicit
acceptance, issuer/source reauthorization and seven-day expiry remain mandatory.
Communication offers are issued without account lookup, so existing/nonexistent
accounts have the same response. A verified exact-email proof claim materializes an
ordinary pending invitation, not membership, with the original expiry. Existing
accept/decline/RSVP APIs remain the admission boundary. Concurrent/replayed claims
cannot materialize duplicate invitations. Email ownership is rechecked at acceptance.
Pending/revoked/expired/claimed states disclose no recipient identity or proof.

Module/channel preferences further restrict existing global settings, channel
availability, quiet hours, authorization and separate messaging push consent. Missing
entries preserve prior defaults. No event-type settings or new transport is added.

Migrations 088?093 are additive. Three typed tables add 11 reviewed FKs; the
fail-closed cleanup catalog now contains 1,159 edges. Project overrides are removed
before Project/member intervals; communication offers before members/actors. Custody
snapshots include Project overrides. No live database, volume, retention policy,
Shared activation or deployment is changed. Operational SMTP/domain verification
and an authorized backup/migration/deployment plan remain release prerequisites.
