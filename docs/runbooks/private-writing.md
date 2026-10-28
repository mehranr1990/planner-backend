# Private writing, capture and search

P1-08 follows approved [ADR 0014](../adr/0014-private-writing-capture-and-search.md)
and [ADR 0015](../adr/0015-private-voice-file-compatibility.md). All routes use
`/api/v1`, verified authentication and the caller's authorized Personal Space.
The generated [OpenAPI contract](../api/openapi.json) defines exact bodies.

## Writing and organization

Create with an Idempotency-Key; mutate with the current ETag in If-Match.
Notes support folders, position ordering, archive, soft deletion and explicit
restoration. Folder moves validate the entire same-space graph, including moved
descendants; maximum depth is five and maximum folder count is 1000. Archiving a
folder retains children and Notes. New assignments require an active folder.
Optional Task/Goal annotations are references; writing never changes those entities.

Note content uses `{format:"MARKDOWN",version:1,content:"..."}`. Maximum content
length is 50000 characters and 100000 UTF-8 bytes within the existing HTTP body
bound. Raw HTML, executable URI syntax, invalid Unicode and control characters
are rejected. Content is inert data; consumers must escape/render safely.

Notes, JournalEntry and MoodEntry retain stable logical IDs and immutable typed
revision rows. `/notes/{id}/history`, `/journal/entries/{id}/history` and
`/moods/{id}/history` return bounded history in revision order. Deletion/voiding
adds a revision; it does not erase historical text. Do not log content or scores.

## Journal, daily check-ins and mood

`/journal/entries` permits multiple FREEFORM entries on one local date.
`/journal/daily-checkins` creates a unique current nondeleted CHECK_IN per
Space/local date, optionally with an atomic linked mood. Read one using
`/journal/daily-checkins/{yyyy-mm-dd}`. Journal and mood retain their original
IANA timezone and local date across corrections and account timezone changes.
Dates default using the current account timezone, cannot be future dates, and
cannot be patched. Existing planning reflections are not copied here.

Mood and nullable energy are subjective integers 1-5; no clinical interpretation
or aggregate analytics is inferred. Multiple independent moods per date are
allowed. A linked Journal mood must share its attribution; at most one current
recorded mood links to one Journal entry. VOID retains correction history.

## Capture and explicit conversion

`/capture` retains user-selected TASK, NOTE, EXPENSE, HABIT_LOG, JOURNAL,
VOICE_MEMO or DRAFT sources. It defaults to INBOX. PATCH requires If-Match;
archived sources require explicit restoration before editing. TRIAGED sources
and their typed target references are immutable.

POST `/capture/{id}/triage` requires If-Match and Idempotency-Key. Explicit
CREATE_TASK, CREATE_NOTE, CREATE_JOURNAL or RECORD_HABIT invokes the owning
module's public contract inside the source transaction. Source, target, audit,
empty version-1 `capture.triaged` outbox event and receipt commit together.
Failures roll back every effect; concurrent/new-key second conversions cannot
create duplicate targets. Same-key replay returns the original result, including
after API restart. ARCHIVE preserves the draft without a conversion event.
Expense drafts have no finance posting behavior.

POST `/capture/parse` is a read-only deterministic preview: version 1 recognizes
only trailing English `today`, `tomorrow` or `on YYYY-MM-DD`, case-insensitively,
in the requested/account timezone. Unknown text remains unchanged. It never
classifies a capture or applies a Task date. No AI or external NLP is used.

## Private WAV files

Initiate at POST `/files/voice/uploads` with an Idempotency-Key and audio/wav;
upload bytes to POST `/files/voice/{id}/complete` as application/octet-stream.
Only canonical 16-bit PCM WAV, mono/stereo, 8-96kHz, exact RIFF/fmt/data lengths,
alignment and byte rate is accepted. Limit is 10MiB or the lower configured bound.
Use the returned authenticated expiring download URL and DELETE the voice route
for cleanup. A capture accepts only an owned READY voice file. Conversion keeps
the source file reference; later file deletion does not erase the capture.
Old file contracts/routes retain their original four MIME types and reject
voice IDs; voice routes reject nonvoice IDs. No transcription or codec service.

The approved StoredFile MIME CHECK expansion is atomic and data-preserving.
Migration safety recognizes only the exact reviewed SQL hash/name; unreviewed
constraint drops continue to fail. Earlier migration files are immutable.

## Search privacy and operations

GET `/search/personal?q=...` searches current Notes, nondeleted actionable Tasks,
Goals and INBOX captures. Literal case-insensitive matching escapes SQL wildcard
characters. Journal/Mood providers are not queried by default. Opt in on each
request with `includeJournal=true` and/or `includeMood=true`; requesting a private
type without its flag fails. Cursors bind actor, Space, query and selected sources.
There is no hidden private count or persisted opt-in. Pages and snippets are
bounded; search input and results are excluded from logs/audits/events.

After building, run `pnpm smoke:p1-08` against the explicitly isolated local test
database. It starts/stops the compiled API, verifies restart persistence and
idempotent replay, and removes only owned fixture rows/files. Use `pnpm quality`
for all 13 mandatory local gates. Docker deployment checks remain deferred.
