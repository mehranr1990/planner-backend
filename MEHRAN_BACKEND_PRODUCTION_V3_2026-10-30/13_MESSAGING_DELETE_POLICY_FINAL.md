# P5 Messaging — Approved Delete/Edit Policy (Owner Decision A)

Status: **APPROVED PRODUCT POLICY**, 2026-10-30. This document supersedes any older V2 statement that the first-48-hour delete-for-everyone choice is open.

## Ordinary author operations

- **Timestamp:** measure 48 hours from the server-committed `createdAt` timestamp; evaluate on the server on each command, never using client clock alone. Exact boundary is `now <= createdAt + 48h` for allowed within-window operations (subject to permission); `now > ...` means outside.
- **Edit:** only the author may ordinarily edit their message within 48 hours, subject to active membership, message state and channel policy. Preserve controlled revision history under applicable retention/audit policy; do not expose revisions to unauthorized participants.
- **DM (1:1):** author may delete-for-everyone within 48 hours. After 48 hours ordinary author deletion is delete-for-self only.
- **Private multi-person conversation:** same as DM. A Social Group conversation that is a private group conversation inherits this rule unless defined as a workplace channel by its own authorized context.
- **Project/Team/Company work channel:** delete-for-everyone within 48 hours only if the authorized organization/channel policy permits that author action. Otherwise author may delete-for-self. After 48 hours ordinary author deletion is delete-for-self only.
- **Delete-for-self:** hides the message for the acting user only; no effect on other participants' authorized view. The user's earlier approval permits this even after 48h. Define durable per-user visibility and read/search/export behavior consistently in P5 implementation contract.
- **Delete-for-everyone:** removes ordinary display of message content for all participants, including realtime deliveries, authorized history/search and projections, and issues a controlled tombstone event. It is not equivalent to guaranteed immediate destruction of backups, retained revisions, compliant audit evidence or legally preserved records.
- **Moderation/legal operations:** separate, strictly authorized and audited; not restricted by the ordinary author 48h window when legitimate policy/law provides the power.
- **Account deletion:** retain conversation coherence where lawfully needed, pseudonymize erased author identity, and apply retention/erasure policy; do not silently delete other people's context.

## Must-prove acceptance tests (P5)

1. DM: author delete-for-everyone at 47h59m succeeds; at 48h+ epsilon refused (or self-only via distinct command); recipient views converge via replay.
2. Private group: same; users who joined after the message cannot gain access to historical message by guessing ID.
3. Work channel: enabled policy permits within-window author delete-for-everyone; disabled policy denies; policy change/race cannot bypass server enforcement; after window always denied for ordinary author.
4. Non-author cannot invoke author delete/edit; revoked member cannot delete, edit, or read through stale websocket/cursor.
5. Delete-for-self leaves other participant views unchanged, and does not reappear via ordinary search, pagination or reconnect for the deleting user.
6. Tombstones, retries, idempotency, ordering, outbox and race with edits/deletion do not resurrect deleted content.
7. Moderation and lawful retention remain separately guarded; backup restore must replay deletion/permission controls before exposure.

## Still to engineer, not to ask again as a product question

Exact retention durations by type/jurisdiction, legal hold processing, edit revision access, self-hide effects on authorized exports, delivery topology/codec, permission schema, and detailed work-channel policy representation. Do not silently make legal or compliance commitments without jurisdiction/operational review.
