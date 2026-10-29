# P1-10 dependency provenance

Owner-approved ADR 0019 pins pg-boss 12.38.0 (MIT), Web Push 3.6.7 (MPL-2.0),
@types/web-push 3.6.4 (MIT), and @opentelemetry/api 1.9.0 (Apache-2.0).
The API package/lockfile retains exact resolution and registry integrity. No
telemetry SDK, exporter, collection service, banking service or paid provider is
introduced. pg-boss's required OpenTelemetry API peer is explicitly disabled in
every queue client. Existing Nodemailer remains the SMTP adapter.

Unmodified vendor notices are adjacent: pg-boss-MIT.txt, web-push-MPL-2.0.txt,
opentelemetry-api-Apache-2.0.txt. The reviewed pg-boss construction SQL remains
under its MIT license. Web Push source is unmodified; retain its MPL notice with
redistribution. Upstream source: https://github.com/timgit/pg-boss,
https://github.com/web-push-libs/web-push,
https://github.com/open-telemetry/opentelemetry-js/tree/main/api,
https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/web-push.

The production dependency audit on 2026-10-29 reported **zero** info/low/moderate/
high/critical advisories across 374 installed production dependencies. This is a
point-in-time dependency check; deployment image advisories remain deferred.
