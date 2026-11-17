# Temporary local Shared test mode — 2026-11-17

Work item: LOCAL-SHARED-TEST-MODE. Status: **COMPLETE for the authorized local scope**.
Decision: [owner-approved ADR 0057](adr/0057-temporary-local-shared-test-mode.md),
amending ADR 0049 only for explicitly constrained development business testing.

## Implemented scope

- Default-off `SHARED_LOCAL_DEVELOPMENT_TEST_MODE`; true requires explicit
  development, loopback binding/auth/CORS and local mehran_dev without URL options.
  Test, production, missing NODE_ENV, remote hosts and other databases reject it.
- Shared business APIs waive only the security-acceptance reference. Dedicated
  signing/control evidence, restore quarantine, retention, authenticated sessions,
  RBAC, scope/custody fencing, revisions and tenant isolation remain enforced.
- No fabricated acceptance reference or scan verdict. Private ignored `.env` now
  contains the explicit local flag and a securely generated dedicated Shared key.
  Preflight verified no existing Shared custody/job/effect/evidence before explicitly
  initializing the new independent control namespace. Existing controls were preserved.
- Storage owner denies business-byte writes/reads, upload admission, READY
  publication and existing file references, including Personal, Shared, voice/media,
  export archives and old READY rows. Signed control IO and physical/retention
  cleanup remain operational. File metadata resolution can also return 403.
- Normal production behavior is unchanged. No scanner/library, API shape, entity,
  migration, constraint, event or job was added. No Frontend source was edited.

Changed files/owners: bootstrap environment validation; Spaces activation
precondition; StoragePort business adapter, FilesService, SharedFiles and
FileCatalog; focused tests; `.env.example`, ADRs, local runbook and Project handoff.

## Actual verification

| Command                                                                                                                                                                                                                                                                                                                                                                                                                          | Result                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm.cmd build`                                                                                                                                                                                                                                                                                                                                                                                                                 | PASS                                                                                           |
| `pnpm.cmd typecheck`                                                                                                                                                                                                                                                                                                                                                                                                             | PASS                                                                                           |
| `pnpm.cmd exec tsc --project .tools/local-shared-types.tsconfig.json`                                                                                                                                                                                                                                                                                                                                                            | PASS for final additional file-policy test                                                     |
| `node --max-old-space-size=8192 node_modules/eslint/bin/eslint.js . --max-warnings 0`                                                                                                                                                                                                                                                                                                                                            | PASS, zero warnings                                                                            |
| `pnpm.cmd architecture`                                                                                                                                                                                                                                                                                                                                                                                                          | PASS, 670 modules / 4,599 dependencies                                                         |
| `pnpm.cmd openapi:check`                                                                                                                                                                                                                                                                                                                                                                                                         | PASS, existing reviewed snapshot unchanged                                                     |
| Changed-file `pnpm.cmd exec prettier --check` and `git diff --check`                                                                                                                                                                                                                                                                                                                                                             | PASS                                                                                           |
| `pnpm.cmd exec vitest run --project unit --project contract apps/api/src/bootstrap/environment.spec.ts apps/api/src/modules/spaces/application/local-shared-test-mode.spec.ts apps/api/src/platform/storage/file-content-policy.spec.ts apps/api/src/platform/storage/shared-control.spec.ts apps/api/src/platform/storage/storage.spec.ts apps/api/test/contract/shared-activation.spec.ts apps/api/test/contract/http.spec.ts` | PASS, 36 tests                                                                                 |
| `pnpm.cmd exec vitest run --project unit apps/api/src/platform/storage/file-content-policy.spec.ts`                                                                                                                                                                                                                                                                                                                              | PASS, final five file-policy cases; one additional distinct test, total 37 unit/contract cases |
| `pnpm.cmd test:integration apps/api/test/integration/shared-kernel.spec.ts apps/api/test/integration/project-core.spec.ts apps/api/test/integration/project-collaboration.spec.ts apps/api/test/integration/files.spec.ts`                                                                                                                                                                                                       | PASS, 111 tests, fresh owned local test schemas, no reset                                      |

Total: **148 distinct tests**. Existing pg concurrent-query deprecation warning
remains; it did not fail integration. No test or security control was weakened.

Actual authenticated mehran_dev smoke verified Project/Team list/create/read,
template catalog, Tasks/subtasks, workflow draft/publication, risks, invitation
proof/admission, cross-user 404 and Viewer write 403. Personal and Project upload
admission returned 403. Anonymous Project access returned 401. Existing READY
read/retry/publication blocking and real signed control IO are covered by the
focused policy tests. No unscanned file was uploaded or published.

Smoke harness assumptions about risk/archive statuses and rotated invitation
revisions were corrected to existing contracts. Rate limiting returned 429 and
was preserved/respected. All four synthetic Projects and one Team were archived
through supported APIs; dedicated development identities remain. Their sessions
were signed out; two dedicated fixture accounts used normal password recovery to
complete cleanup after a rate-limited run. No other account/data was modified.

Read-only DB/control verification: 101 successful applied migrations with matching
checksums, two resolved rolled-back attempts and zero unresolved failures; approved
development work policy matches the catalog. Independent control roots/marker and
worker schema verified. No development migration was necessary.

API/worker restarted with documented `pnpm start` / `pnpm worker`. API live/ready
returned 200 with PostgreSQL up; worker reported ready. Final PID, clean Git status,
commit and normal origin/main push confirmation are reported after publication.

NOT RUN: actual malware engine/scanning, production/Docker release and unrelated
full suites. Actual scanning is deliberately deferred by ADR 0057. **Release-blocking
technical debt:** remove the temporary mode/config before production release,
implement real scan verdict/quarantine enforcement and complete ADR 0049 plus all
existing operational gates. No production approval/deployment is implied.
No further implementation batch is started or authorized by this report.
