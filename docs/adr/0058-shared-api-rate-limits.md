# 0058: Endpoint-aware Shared API rate limits

Status: Authorized change, 2026-11-17, by the owner's explicit rate-limit fix
request. Numerical settings below are engineering choices delegated by that request.

Replace the single Shared 20/user/minute and 30/IP/minute HTTP buckets with
PostgreSQL-backed fixed UTC minute budgets, independent by module family and
request class. Projects, Teams, Companies, Messages, Meetings, Social and Spaces
have independent families. Related invitation routes use their owning family;
generic Space invitations remain in Spaces.

| Class                              | User/minute | IP/minute |
| ---------------------------------- | ----------: | --------: |
| Authenticated reads (GET/HEAD)     |         600 |     6,000 |
| Standard business mutations        |         120 |     1,200 |
| Sensitive operations               |          20 |        60 |
| Anonymous invitation preview       |           — |        30 |
| Expensive endpoint, additional cap |          30 |       300 |

An eight-request dashboard plus 50 per-task detail reads can load several times
per minute inside 600 reads. Two writes/second supports ordinary editing while
bounding mutation pressure. Tenfold business IP headroom supports a shared NAT
without removing its aggregate ceiling. Sensitive actions retain 20/user/minute;
60/IP accommodates multiple users while anonymous proof previews retain 30/IP.
Preview counters are independent of authenticated sensitive operations. Expensive
reports/search/analytics/summary/portfolio/dashboard/capacity/workload/export/bulk
routes additionally share a cap by matched method and route template, across IDs
and query variations. They also consume their ordinary class allowance.

Sensitive classification includes invitation/proof actions, membership/permission/
grant changes, ownership handovers, lifecycle/recovery, discovery, contact blocks,
connection actions, retention changes and financial approval/payment actions.
Authenticated metadata lists remain reads. Existing context limits remain
20/minute for invitation/grant offers and 5/minute for ownership handovers.
No authorization, session, same-space, file, scanning or local test-mode rule changes.

Reuse SharedRateLimit, opaque keyed hashes and atomic UPSERT; no migration,
dependency, development bypass or new infrastructure. HTTP counters commit before
business validation, so invalid requests count. Actor exhaustion is checked before
the shared IP bucket. A request-local promise prevents duplicate guard admission.
Different intended constraints (actor/IP/endpoint/file/context) are separate caps,
not duplicate charging to the same bucket. Internal/background work does not invoke
HTTP admission; CORS preflight terminates before controllers. HEAD consumes the read
budget when Express dispatches to GET. Health/auth/Personal routes do not enter the
Shared HTTP limiter; their existing protections remain independent.

Return RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset (delta seconds), and
RateLimit-Policy for the constraint closest to exhaustion. On rejection describe
the actual rejecting constraint with zero remaining and Retry-After computed from
database time to the next minute. Fixed windows permit a boundary burst up to twice
the minute cap; this is an intentional compatibility tradeoff, not a sliding limit.
The filter preserves provider/throttler retry values. Better Auth's X-Retry-After
is also mapped to Retry-After. CORS exposes the headers. No identity/key is exposed.

Better Auth remains 3 sign-ins/10 seconds, recovery/verification/email-change
3/minute, password reset 5/minute, session listing/revocation 20/minute, other
provider rules or 100/minute. Existing file and account lifecycle throttles remain
unchanged. Shared counters survive restart; auth/file/lifecycle in-memory counters
do not. Before production, retain the existing trusted-proxy/topology release gate:
the current application deliberately uses the socket IP, ignoring forwarded headers.
No production deployment or relaxed release gate is authorized.
