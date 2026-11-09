# P5-06 audit of every original P5-04 requirement

Authority: owner P5-06 execution request and approved ADRs 0044–0049.
The original roadmap is preserved in Git at `8ab53e6`, before the P5-01 transport
amendment: V3 document 05 originally required “WebSocket adapter for live
events/presence/typing, membership fence, reconnect/history catch-up/backpressure.”
Supporting original requirements are in V3 documents 02 (B12), 03 (Phase 5),
04 (Messaging/storage), 10 (FR-08), 11 (§§2/4/5/6), and 12 (G5).
The current P5-04 roadmap entry remains present and DEFERRED.

Exactly three classifications apply: **ALREADY IMPLEMENTED**, **REQUIRED WITHOUT
WEBSOCKET IN P5-06**, and **REALTIME-DEPENDENT / DEFERRED**. Deferred transport
never changes the classification of a durable-state, HTTP or privacy obligation.
Existing implementation is evidence, not a substitute for final P5-06 verification.

| ID  | Original requirement / supporting clause                                 | Classification                      | Existing owner and required P5-06 evidence                                                                                                                    |
| --- | ------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | PostgreSQL authoritative committed messages; durable REST history        | ALREADY IMPLEMENTED                 | MessagingService, AdvancedMessagingService, MessageMediaService; accepted P5-01–03 migration tests and passing final compiled application restart             |
| A02 | Stable conversation/message IDs across delivery and retries              | ALREADY IMPLEMENTED                 | UUID IDs and typed relations; retries/restart preserve IDs for text/media/forward                                                                             |
| A03 | Per-conversation monotonic order                                         | ALREADY IMPLEMENTED                 | Locked DB sequence allocation, unique sequence constraints; concurrent writers and committed order                                                            |
| A04 | Client operation idempotency, rollback and outbox                        | ALREADY IMPLEMENTED                 | Actor/admission/request-bound receipts; exactly one committed row/audit effect; no external side effect before commit                                         |
| A05 | Bounded authorized history and pagination                                | ALREADY IMPLEMENTED                 | Signed per-user/source/admission cursors, limit ≤100, current join floor; cross-user/scope/tampered cursor rejection                                          |
| A06 | Membership fence on read/send/list/search/file operations                | ALREADY IMPLEMENTED                 | Current verified account/session, source and conversation generation; final upload/download rechecks; revoke/write winner                                     |
| A07 | REST authentication, cookie/Origin/CORS and strict payloads              | ALREADY IMPLEMENTED                 | Existing verified-session/Origin guards and Zod; multiple-device session revocation tests                                                                     |
| A08 | Push independent from live transport                                     | ALREADY IMPLEMENTED                 | ADR 0047 opt-in, private generic payload and durable worker; no Push receipt treated as message read                                                          |
| R01 | Reconnect after losing a connection                                      | REQUIRED WITHOUT WEBSOCKET IN P5-06 | New finite authorized REST recovery snapshot; restart/network-loss recovery uses PostgreSQL, never a connection buffer                                        |
| R02 | Catch up missed messages                                                 | REQUIRED WITHOUT WEBSOCKET IN P5-06 | Capture stable snapshot ceiling and initial mutation cursor atomically; interleaved append/edit during multi-page recovery cannot disappear                   |
| R03 | Recover missed edits/deletions/hides/reactions/pins/media                | REQUIRED WITHOUT WEBSOCKET IN P5-06 | Existing rich mutation feed plus recovery protocol; current projections/tombstones and stable IDs converge without resurrection                               |
| R04 | Multiple-device consistency and duplicate retries                        | REQUIRED WITHOUT WEBSOCKET IN P5-06 | Independent authenticated sessions/cursors; shared account/admission progress; replay same send once, explicit hide on both devices                           |
| R05 | Recover invalid, lost or expired-authority cursor                        | REQUIRED WITHOUT WEBSOCKET IN P5-06 | Current authorization first; fresh snapshot on recoverable cursor failure, evict old projection; stop on 401/403/404 rather than silently adopting a new tail |
| R06 | Revocation, departure/rejoin, restore and queued operations              | REQUIRED WITHOUT WEBSOCKET IN P5-06 | Reject stale requests/receipts/cursors/downloads/jobs; signed restrictive replay before restored data can serve; old history floor never revives              |
| R07 | Ordering across history, changes and concurrent writers                  | REQUIRED WITHOUT WEBSOCKET IN P5-06 | BigInt-safe serialized order; fixed recovery ceiling and mutation cursor; deduplicate/upsert by ID and revision, not timestamp                                |
| R08 | REST delivery/read state recovery                                        | REQUIRED WITHOUT WEBSOCKET IN P5-06 | Monotonic/idempotent private progress; new admission resets consent; GET/reconnect/download never infers read                                                 |
| R09 | Backpressure and retry behavior                                          | REQUIRED WITHOUT WEBSOCKET IN P5-06 | Existing actor/IP limits retained; bounded pages/body/forward graph; explicit 429 Retry-After and consumer bounded retry guidance                             |
| R10 | Polling load, downtime and slow consumers                                | REQUIRED WITHOUT WEBSOCKET IN P5-06 | Synthetic concurrent/idle/catch-up profiles, bounded query/page work, measured latency/error counts; no production capacity/SLO claim                         |
| R11 | Hidden count/search/source-forward privacy during recovery               | REQUIRED WITHOUT WEBSOCKET IN P5-06 | No pre-join/hidden/deleted source body; current dual forward authority; authority change forces cache eviction/recovery                                       |
| D01 | WebSocket/Socket.IO adapter, package and wire protocol                   | REALTIME-DEPENDENT / DEFERRED       | No dependency, gateway, fake endpoint or dormant adapter; NOT RUN, never PASS                                                                                 |
| D02 | Live post-commit event delivery and socket fanout                        | REALTIME-DEPENDENT / DEFERRED       | Durable committed outbox remains; socket dispatch/fanout itself is NOT IMPLEMENTED                                                                            |
| D03 | Presence, availability signals, expiry and presence privacy              | REALTIME-DEPENDENT / DEFERRED       | No online/last-seen/presence state is invented; future block effects must be enforced by a separately authorized adapter                                      |
| D04 | Typing signals, throttling and expiration                                | REALTIME-DEPENDENT / DEFERRED       | No typing publisher/subscription or placeholder state                                                                                                         |
| D05 | Socket handshake authentication, Origin and subscribe/unsubscribe policy | REALTIME-DEPENDENT / DEFERRED       | Socket handshake/subscription tests NOT RUN; HTTP authentication/Origin are A07 and remain active                                                             |
| D06 | Evict live subscriptions on logout/revocation                            | REALTIME-DEPENDENT / DEFERRED       | No subscriptions exist to evict; REST and worker revocation remain A06/R06                                                                                    |
| D07 | Multi-node fanout/presence/connection ownership topology                 | REALTIME-DEPENDENT / DEFERRED       | No broker/Redis/cluster readiness claim; multiple-device durable consistency remains R04                                                                      |
| D08 | Socket queue limits, buffering and connection backpressure               | REALTIME-DEPENDENT / DEFERRED       | Socket-specific queue/connection tests NOT RUN; HTTP/polling limits remain R09/R10                                                                            |

Final local status: **A01–A08 and R01–R11 VERIFIED/PASS**. D01–D08 remain
**DEFERRED / NOT IMPLEMENTED / NOT RUN**. Evidence maps to the rows as follows:

- A01–A04, R01–R04, R07: passing Messaging integration suite plus the final
  [37-case communication lifecycle/recovery suite](../apps/api/test/integration/communication-lifecycle.spec.ts)
  and compiled `smoke:p5-06` process restarts; fixed initial message ceiling and
  mutation cursor, interleaved pages/edits/appends and idempotent concurrent sends.
- A05–A07, R05–R06, R11: the same suite exercises foreign/tampered/canonical
  cursors, actual session/Origin guards, leave/rejoin/source-generation revocation,
  restrictive signed restore, fresh admission, hidden/deleted bodies and dual
  forwarding authority. Existing Messaging/Meetings security regressions passed.
- A08, R08: media/progress/notice tests and compiled smoke preserve private
  monotonic explicit receipts; account/device recovery never infers read, blocked
  pair Push is canceled and stale receipt consent does not resume on unblock.
- R09–R10: unchanged actor/IP budgets, bounded snapshots/pages and idle polls,
  HTTP Retry-After; 48 requests/three devices/limit seven, 30 HTTP 200 and 18 HTTP
  429, zero unexpected errors. Exact measured latencies are in
  [the completion report](p5-06-report.md). Clients use bounded retry/backoff and
  incremental changes after bootstrap, as documented in
  [the recovery contract](p5-06-contract.md).

The [Phase 5 local acceptance summary](phase-5-local-acceptance.md) records the
remaining operational gates. Synthetic local measurements establish no production
capacity, availability, RPO/RTO or operational approval. No deployment, Shared
activation, realtime transport or Phase 6 implementation is authorized.
