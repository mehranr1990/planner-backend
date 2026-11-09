# Phase 5 consolidated local acceptance

Status: **APPROVED LOCAL SCOPE IMPLEMENTED AND VERIFIED; P5-06 OWNER ACCEPTANCE PENDING**. This document records local backend
scope only; it is not deployment or Shared activation approval.

| Batch | Local scope                                                                     | Publication/acceptance                                                                 |
| ----- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| P5-01 | Durable authorized conversations, explicit admission, ordered REST messaging    | Accepted/published                                                                     |
| P5-02 | Advanced messaging, privacy-safe live forwarding and moderation                 | Accepted/published                                                                     |
| P5-03 | Private attachments/voice, explicit receipt sharing and independent opt-in Push | Accepted/published                                                                     |
| P5-04 | WebSocket, Presence, Typing and socket-specific behavior                        | DEFERRED, NOT IMPLEMENTED/NOT RUN                                                      |
| P5-05 | Meetings, reviewed/final minutes, explicit Task conversion and announcements    | Accepted/published as `ef27d565b74cc955474af82b2abab5a7d3ca82f1`                       |
| P5-06 | Privacy/lifecycle/security and transport-independent final acceptance           | Complete locally and verified; owner acceptance pending; unstaged/uncommitted/unpushed |

[Every original P5-04 requirement](p5-06-p5-04-requirements-audit.md) is classified:
eight existing durable/security obligations, eleven required without WebSocket and
eight genuinely realtime-dependent deferred obligations. REST recovery, missed
changes, multiple-device consistency, ordering/idempotency, revocation, cursor
recovery and HTTP polling backpressure/load are active acceptance requirements.

Local policy is explicit in approved ADRs 0045–0049: named acceptance/history floors,
role-based administration, live dual-authority forwarding, receipts off by default,
independent chat Push opt-in, accepted meeting access/review/finalization, explicit
action release, audience generations/private acknowledgements, private DM contact
blocking and captured retention/30-day shared recovery. No default retention period,
production policy, automatic role promotion or later social feature is inferred.

Final evidence is recorded in [the P5-06 report](p5-06-report.md) and
[exact change manifest](p5-06-change-manifest.json). One full 13-stage invocation
ran, with its three findings resolved by affected passing reruns: 709 non-integration
cases and 954 distinct integration cases cumulatively, final M044 populated
upgrade/rollback/repeat deployment, compiled API/worker restart smoke and bounded
48-request/3-device HTTP load. Every active P5-04 audit row has passing local
evidence. All 12 unrelated documents, five environments, 68 historical migration
artifacts and six protected database data/catalog snapshots match their preflight
hashes. P5-05 publication was independently verified at the SHA above.

Operational gates remain separate: real malware-engine integration/scanning is
NOT RUN and required before deployment/Shared activation (approved ADR 0049).
Realtime transport tests remain deferred. Production Docker/HTTPS/proxy, actual
external SMTP/Web Push/browser delivery, operational backup/restore and capacity/
SLO/RPO/RTO acceptance are not established by local fixtures. Existing earlier
operational blockers remain in force. No deployment, Shared activation or Phase 6
work is performed.
