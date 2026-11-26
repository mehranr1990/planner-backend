# Support inbound email activation

Status: disabled. No live inbound provider or mailbox integration is implemented
or verified. No public route treats email headers or JSON as trusted input.

P4 retains inbound email replies in scope through `SupportInboundAdapter` and
`SupportInboundProcessor`. Transport-independent validation is implemented;
the concrete PostgreSQL ticket/receipt/rate adapter and private scanning-storage
adapter are connected to the application runtime. Transport activation remains a
separate deployment gate. The production adapter and recipient-domain providers
are null in EngagementModule; SupportInboundRuntime returns INBOUND_DISABLED.

## Required configuration before activation

Configure a dedicated inbound recipient domain and authenticated TLS provider or
mailbox transport. Register one stable transport identifier. Bind SUPPORT_INBOUND_ADAPTER and
SUPPORT_INBOUND_DOMAIN to the provisioned trusted adapter/domain at the Nest
composition boundary. The default production bindings stay null. The transport
entry point calls SupportInboundRuntime.receive with raw transport input; it must
not deserialize public JSON into a VerifiedInboundReply. No provider credentials
or public inbound handler are added by the disabled default. Provision credentials
and signature keys through protected runtime configuration; never commit them or
put reply correlation tokens in access logs. Keep activation off until the adapter
successfully verifies configuration and the deployment operator records evidence.

Webhook adapters must authenticate the complete original request bytes before
parsing, validate the provider's signature and timestamp, reject stale/replayed
provider events, and enforce request-size and ingress rate limits. Do not rely on
source IP alone. Mailbox adapters must use authenticated TLS, bounded fetches and
a persistent UID/UIDVALIDITY cursor, and reject untrusted authentication headers.
Both must establish authenticated sender alignment with the actual sender address
through trusted transport evidence; a From header or SPF alone is insufficient.
Unsigned or unverifiable messages must fail closed.

Use `support+<32-byte-base64url-token>@<configured-domain>` as the envelope
recipient. Generate tokens with a cryptographic RNG. Store only their hashes,
bound to a ticket, current verified owner email, expiry and revocable generation.
Never correlate solely by subject, display address, sequential ticket number,
Message-ID or quoted text. Recheck current owner/email/ticket state on every reply.
Do not acknowledge to arbitrary From or Reply-To addresses. Return the same safe
ingress response for an invalid ticket, sender, expired token or rejected reply.

The ticket store must atomically deduplicate both provider identity and Message-ID,
compare the normalized content fingerprint on replay, consume sender/ticket rate
limits, append the public reply, attach typed private evidence, and record audit
and receipt. Defaults: 10 messages per sender and per ticket per 10 minutes, and
100 per day. A duplicate with unchanged content creates no second reply. Retry
transient transport failures using durable delivery state; never bypass rate or
identity checks during replay.

Validate attachment count (5), individual size (5 MiB), aggregate size (10 MiB),
safe names and media allowlist, then inspect actual bytes and run the existing
malware scanner through private storage. Keep staging cleanup safe after rollback
or crash; no URL fetching, public URLs, arbitrary existing-file references or
inline HTML rendering. Scan failure must not attach untrusted evidence.

Reject automatic responses, bulk/list mail and null return paths. Outbound support
messages must use Auto-Submitted and loop-prevention headers; an inbound reply
must never generate an automatic email acknowledgement. Local policy tests do not
establish provider connectivity, real sender authentication or live delivery.

## Deployment verification (NOT RUN)

Record signed valid/invalid sender cases, bad signature, replay, duplicate webhook
and mailbox fetch, changed replay content, wrong/expired/revoked token, changed
account email, closed/erased ticket, rate exhaustion, scanner outage/infected file,
oversized attachments and automatic-response loops. Verify restart recovery and
private evidence access. Activate only after these pass with the selected trusted
transport. This runbook does not authorize deployment or provider provisioning.
