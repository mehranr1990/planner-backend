# P0-03 database, API and events

Historical foundation contract below; P1-10 activates the notification-only
outbox consumer and durable jobs as documented in [notification operations](notifications.md).
Consumer progress is independent of immutable event envelopes and future consumers.
The additive migration reviewer accepts a single outer BEGIN/COMMIT pair and
still inspects every enclosed statement; destructive/procedural forms stay denied.

This batch supplies platform storage and tested contracts. There are no workers,
dispatchers, consumers, pg-boss activation, file APIs, sync feeds, or business CRUD.
Use the account/spaces public facades; do not import another owner's repositories.

## Authenticated scope and persistence

VerifiedSessionGuard revalidates the provider database session, verifies email and
sets frozen RequestActor IDs. CurrentActor is presentation-only extraction;
application services accept the explicit context/capability, not HTTP headers.
The spaces facade reads the authoritative personal row, checks central policy and
returns an AuthorizedSpace. The capability is server-created, immutable and tied
to the actor/request. Never reconstruct one from an untrusted JSON scope.

`scopedWhere(scope, where)` returns an AND of the owner's explicit query and the
authorized space ID; a supplied OR or spaceId cannot replace that condition.
It intentionally does not select models, add hidden soft-delete predicates,
expose a cross-owner repository, or conceal Prisma query/order/index semantics.
Account settings remain identity-owned; resource space ownership is independent
of creation attribution. The receipt table uses a composite FK to Space's
`(id,ownerUserId)` to prevent foreign-actor scopes even on direct DB inserts.

## Transactions and concurrency

The owning infrastructure repository starts the transaction. Only explicitly
documented narrow orchestration through owner ports may span owners. Pass the
transaction client explicitly to platform audit/outbox writers. Never start a
nested independent transaction for a dependent write. Controllers do not use ORM.

Settings currently demonstrate the pattern: compare revision and increment it,
write metadata-only audit, and append account.timezone_changed v1 only when the
timezone actually changes. All writes commit or roll back together. Locale and
other values remain on authoritative settings, not in audit or event payloads.
The existing API JSON is unchanged; strong ETag/optional If-Match are additive.
Later editable business aggregates require explicit expected revisions at their
specified boundary. Auth-owned provider tables remain under provider control.

`serializable` provides at most three attempts for Prisma P2034 serialization
conflicts; other errors are never retried automatically. The callback must contain
only transactional database work. SMTP, HTTP, physical file writes, queue dispatch
and other external effects cannot be made atomic by calling them inside a retrying
transaction. Emit durable consequences via an outbox and process after commit.

## Outbox envelope and crash semantics

OutboxEvent has UUID id/aggregateId/spaceId/correlationId, type, version,
occurredAt UTC and bounded JSON payload. The current registry allows only
`account.timezone_changed`, version 1, with `{}` payload. Consumers will retrieve
privileged current detail from the authorized owner facade; there is no global
private-data broadcast. The aggregate ID is an event envelope identifier, not a
polymorphic foreign relation. Space itself has a real foreign key.

appendOutbox takes the same transaction client as the state write. A crash before
commit rolls both back. A crash after commit leaves the row in PostgreSQL even if
the API never replies. A separate-process test exits abruptly at both points and
reads results through a new connection. Nothing consumes or deletes events now.
At the first durable processing batch, add bounded retries/failure visibility,
idempotent consumers, post-commit dispatch, recovery scans, retention and restart
tests. At-least-once delivery is the contract; event ID is the deduplication key.

## Idempotency receipts

There are no new high-risk POSTs in P0-03, so this helper has no public route yet.
An owning use case supplies a verified scope, explicit stable operation identifier,
1–128 printable-ASCII key and validated bounded JSON request. The operation must
distinguish method, canonical route and semantic command; include relevant path
IDs, conditional revision and other semantic inputs in the normalized fingerprint.
Object keys are sorted; array order is significant. Invalid/nonfinite values,
cycles/excess nesting and payloads over 128 KiB are rejected. Do not pass auth
secrets, tokens or credentials to this helper.

The unique key is `(actorUserId,spaceId,operation,keyHash)`. SHA-256 hashes protect
the stored key and canonical fingerprint from raw-content disclosure; hashes are
not encryption or a guarantee against guessing low-entropy values. No body or
private response is persisted. A receipt contains only a result UUID and 2xx
status. Before using a replayed result, its owning facade must recheck current
access/state and build an approved response. Revoked sessions never reach it.

A transaction-scoped PostgreSQL advisory lock serializes the scoped key across
processes; a hash collision only delays unrelated work. READ COMMITTED ensures the
waiter reads the latest committed receipt after acquiring the lock. The work,
outbox and receipt share the transaction. A matching retry returns the receipt;
changed fingerprint returns 409 without executing work. Another actor or operation
cannot retrieve that receipt. Errors/invalid receipts roll back all callback work,
allowing a safe retry. Callbacks must be DB-only, with no external side effects.

Receipts expire 24 hours after creation using PostgreSQL's clock. Inside the same
key lock an expired receipt is replaced atomically by a new operation; reusing a
key after that window may execute work again. Clients must not rely on deduplication
beyond the window. There is no sweep/worker yet; expired rows are reclaimed on
same-key reuse. Configure retention cleanup at the first processing batch. Pool,
statement and transaction bounds prevent indefinitely held request locks.

## Audit privacy and delivery

SecurityAuditEvent has UUID identity, action/outcome, optional actor FK, request and
correlation IDs, occurredAt and a constrained list of changed field names. There
is no arbitrary metadata JSON, email, IP, user-agent, URL, session token, password,
profile value, timezone value, note/journal/finance content or request body.
Both runtime validation and DB field constraints reject unknown sensitive fields.

Auth registration, sign-in/out, verification, recovery, password/email changes,
session listing/revocation, profile/settings changes and protected-route denials
are audited. Anonymous and unauthenticated attempts retain a null actor; the
submitted email is never an identity selector in audit. Successful sign-in may
attribute the authenticated provider-returned user. Request IDs are correlations,
not proof of identity. Missing/revoked/unverified sessions still fail closed.

Provider-owned auth/profile mutations use a persisted ATTEMPTED record before the
native handler and SUCCEEDED/DENIED/FAILED outcome after it. A sink failure before
the provider call prevents mutation. Native verification redirects containing an
error parameter are conservatively recorded as DENIED, not successful verification.
SUCCEEDED means the provider accepted the request, not that a generic recovery or
idempotent revocation necessarily changed a record. A crash after provider commit may leave
ATTEMPTED: it means outcome unknown and must never be interpreted as success or
automatically replayed. These records do not pretend to share the provider's
private transaction. App-owned settings audit/outbox are atomic with settings.

No audit HTTP endpoint exists. Read evidence only with authorized operational DB
access; application code must never expose it through a generic list/export.
Actor FK becomes null on eventual user deletion, preserving metadata evidence.
No automatic audit deletion or guessed legal retention is configured. The owner
must approve retention/deletion policy before production lifecycle/cleanup gates.

## Migration operations and verification

Apply reviewed SQL with `pnpm db:migrate:deploy` against the configured environment;
startup never migrates. P0-03 adds three platform tables, settings revision and
constraints/indexes. It does not modify provider-owned auth scalar schemas.
No destructive down migration is supplied: fix forward with another additive,
reviewed migration, preserve evidence/receipts, and use the prior application only
if its provider contracts remain compatible. Backup before production deployment.

`pnpm db:migrations:check` reviews a conservative additive SQL subset, validates
the existing guarded test history, replays all migrations from empty, upgrades
P0-02 with preserved preference data, checks revision backfill and repeats deploy.
Procedural SQL, destructive statements and unknown forms require explicit review;
the scanner is a conservative gate, not a complete SQL parser or authorization.

The harness generates its own random schema in the loopback `*_test` database.
Its reset/cleanup can target only that freshly owned namespace; there is no option
to reset public or another schema. All fixture tables/data are removed on exit.
The configured dev/test databases and existing user data are never reset. Extra
schema privileges are required only for this isolated migration gate. Temporary
configs contain no credentials and remain under ignored .tools. No Docker command
is run; actual deployment topology/build/persistence checks remain DEFERRED.
