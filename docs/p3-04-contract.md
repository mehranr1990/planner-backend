# P3-04 — Confidential Team records and light meetings

Implements roadmap P3-04 under ADRs 0024–0033. The owner explicitly approved the
confidentiality policy recorded in [ADR 0033](adr/0033-team-confidentiality-and-reviewed-disclosure.md).
Shared activation stays disabled; Company association remains inactive. This batch
does not implement P3-05 lifecycle or Phase 5 meeting workflows.

## Actual operations

All routes below start `/api/v1/teams/{id}` and require a verified current session,
full current Team read, lifecycle checks and the existing Shared fences. Responses
are `no-store`. Mutations enforce Origin, strict Zod input and expected revisions
where specified. POST returns 201; GET/PATCH return 200. Revision-bearing results
include ETag. Lists use existing actor/scope/authorization-bound signed cursors.

| Method | Suffix                                                     | Authority / concurrency                                                                |
| ------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/cases`                                                   | Only cases where caller is a current designated reader; filtered before paging         |
| POST   | `/cases`                                                   | Recognition/feedback: ordinary Team creation; corrective: work.manage; Idempotency-Key |
| GET    | `/cases/{caseId}`                                          | Current author, subject or designated Owner/Admin reviewer only                        |
| GET    | `/cases/{caseId}/entries`                                  | Same confidential readers                                                              |
| POST   | `/cases/{caseId}/entries`                                  | Subject response / corrective appeal; If-Match and Idempotency-Key                     |
| POST   | `/cases/{caseId}/reviews`                                  | Named current Owner/Admin reviewer; If-Match and Idempotency-Key                       |
| GET    | `/cases/{caseId}/disclosures`                              | Same confidential readers; includes confidential proposal/review metadata              |
| POST   | `/cases/{caseId}/disclosures`                              | Author proposes exact source revision, summary, audience and expiry; Idempotency-Key   |
| POST   | `/disclosures/{disclosureId}/review`                       | Named reviewer approves/rejects exact proposal; If-Match                               |
| POST   | `/disclosures/{disclosureId}/consent`                      | Recognition subject grants/withdraws consent; If-Match                                 |
| POST   | `/disclosures/{disclosureId}/revoke`                       | Any of the three current confidential readers; If-Match                                |
| GET    | `/disclosures`                                             | Current publication audience, after all validity filters                               |
| GET    | `/disclosures/{disclosureId}`                              | Same publication visibility; summary only                                              |
| GET    | `/meetings`                                                | Current Team read; deleted Calendar sources excluded before paging                     |
| POST   | `/meetings`                                                | work.manage; Idempotency-Key; atomic Calendar source and meeting creation              |
| GET    | `/meetings/{meetingId}`                                    | Current Team read; live Calendar source returned                                       |
| PATCH  | `/meetings/{meetingId}`                                    | work.manage; agenda only; If-Match                                                     |
| GET    | `/meetings/{meetingId}/invitations`                        | Owner/Admin/Lead sees invitations; other members see only own current generation       |
| POST   | `/meetings/{meetingId}/invitations`                        | work.manage; current Team recipient; If-Match meeting revision and Idempotency-Key     |
| POST   | `/meetings/{meetingId}/invitations/{invitationId}/respond` | Named current recipient accepts/declines; If-Match invitation revision                 |
| POST   | `/meetings/{meetingId}/invitations/{invitationId}/revoke`  | work.manage; If-Match invitation revision                                              |

OpenAPI: `docs/api/openapi.json`, **21 new operations, 522 total** and **4,456
resolved local references**. Published P3-03 signatures are frozen; all predecessor
Personal/Project/Team schemas, status codes, headers and security remain checked.

## Confidential sources, responses and review

Case kinds are RECOGNITION, FEEDBACK and CORRECTIVE. Creation requires distinct
author, subject and named Owner/Admin reviewer, all current verified Team members.
The original reason/evidence and admission generations are immutable. No broad
Owner/Admin/Lead, Project grant or Company relationship substitutes for designation.
Reviewer demotion immediately removes reviewer access; rejoining never restores a
prior-generation designation. Current author/subject access may remain when another
participant leaves, so necessary retained records are not erased or broadly exposed.

Subjects append responses and corrective appeals, including Viewer subjects acting
on their own record. This right grants no ordinary Team editing capability. The
reviewer appends a reasoned OPEN/RESOLVED review. Original content and entries are
immutable; each entry/review advances case revision. Confidential reads/lists are
audited with opaque IDs only. Case text, evidence, appeal and reviewer notes never
enter audit/outbox/control artifacts, generic Team dashboards or Personal APIs.
No scores, XP, automatic punishment, pay deduction or employment enforcement.

## Disclosure

Proposals remain confidential. The author supplies a separate summary of at most
2,000 characters; the named reviewer explicitly approves/rejects that exact summary
and case revision with a confidential reason. Feedback/corrective disclosure has
1–100 explicit named admission generations. Only recognition may have a Team-wide
audience; recognition disclosure additionally requires subject consent. Consent may
be withdrawn. Expiry is mandatory, strictly in the future and at most 30 elapsed
days from creation, using PostgreSQL time; expiry cannot be extended by patching.

Wider output is exactly publication ID, kind, summary and expiry. It omits case ID,
participants, reason, evidence, responses, appeal and review notes. State must be
APPROVED; case revision, current author/subject, current Owner/Admin reviewer,
audience generation, consent, expiry and restore generation all revalidate before
the SQL page limit. Invalid/hidden sources affect neither counts nor cursor position.
Subject response/review changes invalidate earlier reviewed source revisions.
Rejected/revoked proposals cannot be resurrected; new disclosure requires a new
review. No external/public link, private export or confidential-text search exists.

All acting/target account locks precede the custody fence. Wider reads predeclare
author/subject/reviewer account fences too, preventing a winning identity restriction
from permitting a late disclosure. Changed hint sets abort safely instead of taking
earlier-ranked locks late. Signed restrictive intents, audit/outbox and authorization
version changes cover review/consent/revoke and case changes. Spaces owns the new
restore generation; restrictive replay increments it, invalidating restored
disclosures and meeting invitations even if their old rows reappear in a snapshot.

## Light meetings

Meetings reference the existing Team CalendarEvent by typed same-space FK. Creation
uses the original Calendar service/temporal rules; no second event engine or private
TimeBlock is created. Agenda is at most 10,000 characters and Team-readable, as is
the ordinary Team Calendar event. Confidential case content is never automatically
linked or copied into agendas. Existing Calendar APIs retain scheduling/cancellation
authority; meeting reads reflect current event state. Deleted events hide meetings;
canceled/deleted events reject new invitations and acceptance.

Invitations target current verified full Team members only, bind inviter/recipient
admission generations and expire within seven elapsed days. Acceptance rechecks
the inviter's current work-management authority and recipient identity. Expired,
revoked, restored or prior-generation invitations cannot grant participation.
Invitations grant no membership, Project admission or Calendar access. There are
no outbound sends, jobs, external guests, minutes, chat, files, recurrence-specific
meeting workflows or third-party integrations in P3-04.

## Limits, custody and retention

Objective safety bounds: 1,000 cases per Team; 1,000 immutable entries and 100
disclosure proposals per case; 100 named recipients per proposal; 10,000 meetings
per Team and 1,000 invitations per meeting; pages at most 100. Each new aggregate
uses the existing authoritative usage/free-mode policy seam. Child recipient rows
are bounded by their disclosure. No commercial limit is enabled.

All six new tables remain in independent Team custody, with actor/access/interval
FKs and immutable history. No Personal/Project source is copied or moved. Existing
versioned retention and restrictive restore controls remain binding; no new legal
retention days are inferred. Team cleanup is P3-05. Jurisdiction-specific employment
review, release operations and Shared activation remain separate gates.
