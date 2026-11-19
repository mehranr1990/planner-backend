# 0057: Temporary local Shared business test mode

Status: **Owner-approved**, 2026-11-17, by explicit execution request.
File-content gating amended by [ADR 0068](0068-clamav-malware-scanning.md).

For local application integration testing only, defer actual malware-engine
integration to final infrastructure/security hardening. This narrows ADR 0049's
local activation restriction; its production/release requirements remain binding.
No scanner/provider is selected or installed and no clean verdict is fabricated.

`SHARED_LOCAL_DEVELOPMENT_TEST_MODE` defaults to false. True requires explicit
`NODE_ENV=development`, loopback API binding/auth/CORS origins, and loopback
PostgreSQL database exactly `mehran_dev` without URL options. Other environments,
omitted NODE_ENV, remote hosts and test databases fail startup. Never use this
setting in production or test configuration.

The mode replaces only the security-acceptance-reference precondition. Dedicated
Shared signing keys/current independent controls, restore quarantine, immutable
retention policies, sessions, RBAC, membership generations, custody fences,
tenant isolation, revisions and idempotency remain mandatory. No fake security
acceptance reference is provisioned. The existing approved development retention
catalog is reused; production policy acceptance is not inferred.

All business file bytes are unscanned. Deny upload admission, finalization/READY
publication, linking existing files and byte reads, including existing READY rows,
voice/media, Shared and Personal files and export archives. Existing download
proofs cannot bypass the content storage guard. Metadata operations may also be
unavailable where they resolve file references. Physical removal and retention
cleanup remain available. Signed Shared/Personal control evidence uses independent
storage and remains operational. No stored scan field, data rewrite or migration.

Temporary technical debt / **production release blocker**: remove this mode and
its local configuration before production release, implement the approved scanner
with real failure/quarantine policy and verdict enforcement, complete ADR 0049
and all existing operational security gates. Setting this flag false alone is
not scanner clearance. Normal production activation behavior is unchanged.

Verification: bootstrap rejection matrix; activation/control/quarantine tests;
file admission/publication/read/reference denial; existing Shared authorization
integration regressions; real authenticated local Project/Team operations with
cross-user denial and blocked files. Normal commit/push and local API/worker
restart are authorized; production deployment and destructive DB operations are not.
