# Authentication and personal ownership (P0-02)

The API uses Better Auth 1.7.14 and its official Prisma adapter with transactions
enabled. Auth-owned models were generated using the matching official `auth` CLI;
`pnpm auth:schema:check` rejects drift in their scalar fields, indexes and relations.
Only the application's UserSettings and Space relations extend the User model.
IDs use the supported provider UUID mode and PostgreSQL gen_random_uuid (UUIDv4),
also used by application-owned IDs. UUIDv7 is not a consistent built-in generator
across this selected provider/runtime combination, so the approved v4 fallback is
used. No session signing, password hashing or recovery cryptography is homemade.
Application PostgreSQL connections explicitly use UTC, including database defaults
for provider-generated timestamp columns. The pool does not change server-wide
timezone settings. Auth transactions allow 15 seconds for the bounded awaited
mail delivery; SMTP connection/greeting/socket timeouts are each five seconds.

## Local configuration and mail

The configured local databases are mehran_dev and mehran_test on localhost:5432.
Both local env files stay ignored. Never copy credentials into examples or logs.
BETTER_AUTH_URL defaults only in the example to http://localhost:3000; runtime
requires an explicit origin. Generate a unique random BETTER_AUTH_SECRET with at
least 32 characters. Only explicit CORS_ORIGINS are trusted in addition to the API
origin. A trailing slash, wildcard or credential-bearing origin is rejected.

Local development uses MAIL_MODE=sink. Verification, old-address confirmation and
recovery messages are private JSON files under MAIL_SINK_DIR, with restricted file
permissions where Windows supports them. The default is .tools/mail relative to
the process directory: repository root for pnpm start, apps/api for pnpm dev.
Both locations are ignored. An absolute MAIL_SINK_DIR can give them one location.
The sink has no public HTTP endpoint and links/tokens/addresses are never logged.
Tests use a bounded in-memory sink which is unavailable outside test mode.

Production requires MAIL_MODE=smtp, MAIL_FROM, SMTP_HOST, SMTP_PORT, SMTP_USER and
SMTP_PASSWORD. Nodemailer requires TLS (implicit on port 465, STARTTLS otherwise),
certificate validation remains enabled, and transport debug logging is disabled.
Real SMTP delivery, sender verification and monitoring remain deployment gates;
local tests do not claim actual external delivery.

## API protocol

All mutation examples require Content-Type: application/json and Origin equal to
the API origin or an explicitly trusted frontend origin. Cookie authentication is
host-only, HttpOnly and SameSite=Lax. Production adds Secure and the __Secure-
cookie prefix. Cookie caching is disabled; the DB is revalidated on every protected
request and revoked sessions take effect immediately. Existing library defaults
apply: seven-day sessions, daily update threshold, one-day freshness, one-hour
verification/recovery links. Session refresh cookies are forwarded by the guard.

Better Auth's standard JSON response shapes are explicitly schema-checked. The
session token fields are part of that provider protocol (including revoke-session),
not JWT access tokens. Prefer HttpOnly cookies; do not persist tokens in client
storage, URLs or logs. Auth errors use the same safe error envelope as other APIs.

| Route under /api/v1/auth | Method | Purpose                                                           |
| ------------------------ | ------ | ----------------------------------------------------------------- |
| /sign-up/email           | POST   | name/email/password; requires verification, does not auto-sign in |
| /send-verification-email | POST   | email and optional trusted callbackURL                            |
| /verify-email            | GET    | provider token; optional trusted callbackURL                      |
| /sign-in/email           | POST   | verified email/password; optional rememberMe/callbackURL          |
| /get-session             | GET    | current DB-backed session or null                                 |
| /sign-out                | POST   | revoke current session and clear cookie                           |
| /list-sessions           | GET    | list own active sessions; requires a fresh session                |
| /revoke-session          | POST   | token; can revoke only a session owned by the actor               |
| /revoke-other-sessions   | POST   | revoke actor's other sessions                                     |
| /revoke-sessions         | POST   | revoke all actor sessions                                         |
| /request-password-reset  | POST   | email and optional trusted redirectTo; generic response           |
| /reset-password/{token}  | GET    | validates recovery link, redirects to trusted callbackURL         |
| /reset-password          | POST   | token/newPassword; single-use, expiring, revokes sessions         |
| /change-password         | POST   | currentPassword/newPassword/revokeOtherSessions                   |
| /change-email            | POST   | newEmail/callbackURL; verified fresh session required             |

Profile updates deliberately use PATCH /api/v1/me; the provider's broad update-user
route is not exposed. OAuth, account deletion, account linking and unapproved
provider routes are not exposed. No seed identity or development auth HTTP bypass
exists. Unknown auth paths return a safe 404. Health routes remain public.

Email change first confirms through the old verified mailbox, then verifies the
new mailbox. Only then is the email changed. All sessions are revoked through the
provider after verification, so signing in again is required. A stale session must
sign in again before requesting an email change. Password reset consumes the token,
changes the credential and revokes sessions through the transactional provider.

GET/PATCH /api/v1/me accepts only name/image for writes. GET/PATCH
/api/v1/me/settings manages locale, IANA timezone, GREGORIAN/JALALI calendar
preference and firstDayOfWeek (0–6). Defaults are en/UTC/GREGORIAN/Monday.
GET /api/v1/me/spaces returns exactly the caller's personal space. Extra identity,
owner, space, balance and internal fields are rejected rather than mass-assigned.

## Transaction and ownership boundaries

The composition root imports narrow creation data from the account and spaces
public contracts. A Prisma User.create extension adds those relations to the
provider's query, including inside the provider transaction. User, settings, space
and credential sign-up therefore commit or roll back together. An after-create hook
cannot establish this invariant: this provider version defers those hooks until
after commit. The extension does not modify provider scalar schema or crypto.

The owning repositories reconcile legacy/retried settings and personal spaces
using INSERT ON CONFLICT through Prisma createMany(skipDuplicates), followed by an
owned read in the same transaction. This avoids Prisma's empty-update upsert race.
Space(kind, ownerUserId) is unique; personal owner is a non-null UUID FK. The only
supported kind is PERSONAL. UserSettings has a unique user FK and DB checks for
calendar/week-start ranges. There is no membership, role hierarchy or shared space.

The spaces public contract supplies the initial creation data; subsequent repository
writes remain in spaces infrastructure. Other modules call SpacesService through
its public export. Its ownership queries include ownerUserId and its central policy
denies missing/foreign spaces with the same 404. No user-supplied scope selects an
identity. Future resource owners must use this facade and policy; this batch adds
no speculative business resources to demonstrate them.

The auth platform is a shared global Nest technical module, configured once by the
composition root. It imports no business module. Application services use their
own persistence ports, and account HTTP uses only the spaces public facade. No
forwardRef or service locator is used.

## Rate limits and deployment

Better Auth's real in-memory limiter is enabled in every environment. Login is
3/10 seconds; recovery and email-change are 3/minute; reset is 5/minute; session
listing/revocation are 20/minute; other auth paths use the provider's default
special rules or 100/minute. The adapter overwrites caller-supplied IP headers with
the actual socket IP. No Redis, queue, extra rate-limit table or custom crypto is
introduced. Limits are per process and do not persist on restart.

Before release behind a proxy, explicitly configure and test the actual trusted
proxy/IP topology. Current code intentionally trusts no forwarded client IP. A
proxy deployment will otherwise share that proxy's rate-limit bucket. This is part
of the deferred deployment gate, along with HTTPS and actual SMTP delivery.
Docker startup/persistence checks were not run. Do not deploy without those gates.
