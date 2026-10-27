# P0-02 requirements and verification

| Requirement                   | Owner / implementation                                                  | Verification                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Official auth-owned schema    | authSchemaOptions, pinned official CLI, Prisma migration                | auth:schema:check; real provider requests with schema validation enabled                                                  |
| Email/password identity       | auth native HTTP handler and strict contract adapter                    | auth.spec: signup, verification required, password hashed, verified sign-in                                               |
| Email verification and expiry | provider mail hooks and native tokens                                   | lifecycle: invalid/expired verification, duplicate signup, generic response                                               |
| Persistent database sessions  | AuthService, VerifiedSessionGuard                                       | lifecycle: API recreation, current/other/all revocation, expiry, unverified principal denial                              |
| Password recovery             | provider reset flow, transaction-enabled Prisma adapter                 | lifecycle: generic recovery, callback, invalid/expired/replayed token, old password rejection, session revocation         |
| Password change               | provider credential verification                                        | lifecycle: invalid current password, credential rotation, new cookie and old-session invalidation                         |
| Email change                  | old mailbox confirmation, new mailbox verification, provider revocation | lifecycle: stale session denied, old/new confirmation, no early mutation, reauthentication                                |
| Me/profile/settings           | account ports/repository/application/controller                         | lifecycle: GET/PATCH, normalization, invalid timezone/calendar/week start, owner overposting                              |
| One personal space            | owner-provided nested User.create relations and spaces repository       | auth: atomic initial rows; lifecycle: rollback, missing/existing reconciliation race, DB unique/FK checks                 |
| Ownership boundary            | SpacePolicyService + spaces public facade                               | policy unit test; lifecycle: foreign/missing IDs both denied, scoped list, no cross-user settings mutation                |
| Cookie/CSRF/CORS              | bootstrap and provider config                                           | production-cookies: prefix/Secure/HttpOnly/SameSite/host-only; lifecycle: missing/hostile Origin, CORS and callback abuse |
| Rate limits and IP trust      | actual library limiter, socket-derived IP                               | lifecycle: spoofed forwarded/client-IP headers do not bypass 429; new window recovers                                     |
| Email adapters/privacy        | private dev sink, bounded test sink, Nodemailer SMTP                    | mail unit tests; Pino private-field tests; no public mailbox/seed bypass                                                  |
| API contracts                 | shared Zod schemas and OpenAPI snapshot                                 | openapi contract coverage, openapi:check, existing health contracts                                                       |
| Architecture                  | owning application ports + exported facades                             | dependency-cruiser, restricted imports, negative import/cycle/layer probes                                                |
| Schema lifecycle              | one additive initial migration, explicit deploy                         | dev and test deploy, migration status/no-op replay, statement review                                                      |

No P0-03 audit/outbox/idempotency tables, generic scoped repository/context helpers,
business-domain records or workers were introduced. Production SMTP delivery,
trusted proxy topology, Docker and real TLS remain deployment verification gates.
