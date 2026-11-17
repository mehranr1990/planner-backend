# Shared API rate limits

Policy and rationale: [ADR 0058](../adr/0058-shared-api-rate-limits.md).

All environments use the same bounded policy. Per module/minute: ordinary reads
600/user and 6,000/IP; writes 120/user and 1,200/IP; sensitive actions 20/user and
60/IP. Anonymous previews allow 30/IP. Expensive routes add 30/user and 300/IP per
method/template. IDs, query changes and claimed forwarded IPs cannot reset budgets.
Budgets aggregate across spaces within a module, preventing space hopping.

Inspect RateLimit-Limit/Remaining/Reset/Policy. Reset and Retry-After are seconds,
not timestamps. On 429 wait Retry-After, then retry only when the operation's normal
idempotency/revision contract permits. Failure/denial still consumes admission.
Do not retry in a tight loop. Rate headers describe admission, not authorization.
The minute windows use PostgreSQL time and remain populated across API restarts.
Existing bounded expiration maintenance removes stale hashed counters.

For local testing use a dedicated verified development account and the real API.
Check readiness, realistic mixed GET and POST traffic, user/module/class isolation,
finite burst rejection, auth limits and response timing. Do not clear limiter rows,
restart to evade limits, disable security, or alter the development database.
Keep SHARED_LOCAL_DEVELOPMENT_TEST_MODE restrictions and file-byte denial intact.

Frontend opportunity: cache/deduplicate the reported eight summary requests and
per-task requests; batch independent read requests where existing contracts permit;
pause polling for inactive views. This change does not modify Frontend behavior.
The backend allowances cover ordinary use, with finite abuse protection retained.

Before reverse-proxy production deployment, explicitly configure/test trusted
client IP topology as required by the authentication runbook. Current socket-IP
accounting makes users behind one proxy share its IP ceiling. Do not trust arbitrary
X-Forwarded-For headers to avoid that deployment requirement.
