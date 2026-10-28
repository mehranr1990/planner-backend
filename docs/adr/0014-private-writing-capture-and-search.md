# 0014: Private writing history, moods, capture triage and personal search

Status: APPROVED by owner, 2026-10-28, for P1-08 implementation.

## Context

P1-08 defines Note/NoteFolder/CaptureItem/JournalEntry/MoodEntry, versioned note
content, distinct daily check-ins, explicit capture classification and private
search. Journal correction history, mood/energy scales, parser vocabulary, supported
conversions and search composition need explicit product decisions. The owner has
required a bounded ADR before these ambiguities are implemented; project sections
1.6 and 9 also govern history, time and module contracts.

## Approved decision

- Notes owns Note and NoteFolder; Journal owns JournalEntry/MoodEntry; Capture owns
  CaptureItem and triage orchestration. The CaptureItem entity is physically owned
  by Capture, resolving the registry's earlier shorthand about notes/capture drafts.
  Use only these five new business entities and explicit scoped foreign keys.
- Note, JournalEntry and MoodEntry use stable logical UUIDs with immutable typed
  revision rows inside their own entity, as in approved Habit/Focus history. The
  predecessor current marker closes; prior content/values/date/timezone/timestamps
  stay intact. Updates/deletions are revision-checked append operations; deletion
  retains a DELETED/VOID revision and authorized history. No invented retention
  interval, background purge or extra history table. A deleted Note can be restored
  explicitly; journal/mood corrections/voids preserve the original attributed day.
- Note content is {format:MARKDOWN,version:1,content:string}, max50000 characters
  and100000 UTF-8 bytes, subject also to the existing128KB request envelope. It is
  returned as inert JSON, never rendered HTML. Reject controls, raw HTML tags and
  executable javascript/vbscript/data URI syntax; this restricted Markdown format
  is not a general HTML sanitizer and clients must still sanitize any rendering.
  Journal reflection content uses the same versioned representation. Titles are
  bounded300 characters. Preserve content on folder moves/archive/restore.
- Notes support ACTIVE/ARCHIVED/DELETED status, optional same-space folder and
  optional existing Task/Goal references. These are annotations, never copied
  source entities or writes to their lifecycle. New references require authorized
  readable sources; retain historical references after source status/deletion.
  Folders have revisioned title/position, optional parent and ACTIVE/ARCHIVED status;
  enforce acyclic same-space hierarchy max5 levels and1000 folders. Archive does
  not erase descendants/notes. New assignments require an ACTIVE folder. Lists
  use stable creation/logical-ID cursors and explicit status/folder/source filters;
  folder position is explicit organization metadata with deterministic tie order.
- JournalEntry distinguishes FREEFORM and CHECK_IN. Each attributed local date has
  at most one current nondeleted CHECK_IN per space; multiple FREEFORM entries are
  allowed. Save explicit localDate and IANA timezone, defaulted from the current
  account at creation, plus immutable server timestamps. Date/zone never silently
  change after travel and cannot be patched into another day. Historical dates
  are allowed; reject future attributed dates in the saved timezone.
- MoodEntry records a user-entered mood score1-5 (VERY_LOW through VERY_HIGH), optional
  energy1-5 and private note, with the same immutable date/zone context and typed
  correction/VOID history. These are subjective personal scales, not clinical
  assessments. Multiple mood records per day are allowed. An optional same-space
  JournalEntry reference associates a mood without copying reflection content.
  Check-in creation may explicitly include one mood/energy record atomically.
  PlanningReview content is not duplicated or migrated automatically in P1-08.
- CaptureItem has explicitly selected TASK/NOTE/EXPENSE/HABIT_LOG/JOURNAL/VOICE_MEMO/
  DRAFT type, bounded raw text, optional ready private audio StoredFile FK and
  INBOX/TRIAGED/ARCHIVED state. Brain Dump/Inbox is this capture list, not another
  entity. Source UUID/text/file context remains traceable after conversion; once
  TRIAGED the source/target association is immutable. INBOX edits and explicit
  archive use revisions. Voice memo means a ready audio attachment only; no
  transcription, public file URL or separate attachment table is required.
  Existing generic Note attachments are not added without a current requirement.
- POST capture/{id}/triage explicitly chooses CREATE_TASK, CREATE_NOTE, CREATE_JOURNAL
  or RECORD_HABIT, with validated target inputs and capture revision. Use narrow
  owner commands in the same PostgreSQL transaction, not cross-owner repositories.
  Persist typed targetTaskId/targetNoteId/targetJournalId/targetHabitEntryId FKs, source
  state, audit/outbox and receipt atomically. Reject a different second conversion;
  retries with the original key replay the original result. Failed conversion
  leaves INBOX and creates no target. An explicit conversion may change the user's
  initial classification; neither parsing nor storage decides target type.
  ARCHIVE is explicit dismissal without a fabricated target. EXPENSE can be retained
  or archived as a capture draft; expense posting is unavailable until P1-09.
  A voice source may be converted using an explicit text payload; its private
  audio stays linked to the source capture and is never copied/transcribed.
- Optional POST capture/parse is a read-only deterministic suggestion preview,
  version1: recognize only a trailing English 'today', 'tomorrow' or 'on YYYY-MM-DD',
  using explicit/account timezone and a server clock. Return suggested title and
  scheduledDate plus recognized/unrecognized result; preserve raw input. No capture
  classification, Task due-date mutation or automatic application. The user must
  submit accepted target fields explicitly at triage. Other language/ambiguous
  phrases stay unchanged; there is no AI, external NLP provider or dependency.
- GET search/personal uses literal case-insensitive text, bounded q/range/page
  inputs, scoped stable cursors and a fixed source set: Notes, Tasks, Goals and
  Capture by default. Journal/Mood are excluded unless includeJournal=true and/or
  includeMood=true is explicitly provided for that owner-authorized request.
  Default search never scans private journal/mood content or leaks counts/snippets;
  opt-in applies to each request, not a global permission for analytics. No analytics
  module or private-data mixing is added. Each owner searches its own rows through
  public read contracts, returns bounded safe snippets and enforces query limits;
  deleted/archived/void sources are excluded. No arbitrary SQL/query DSL or new
  index service. Habit/Focus metrics and future Finance are outside this text set.
- Use personal ownership, revisions/ETags, scoped FKs, bounded pages, safe errors,
  existing actor/space/body idempotency receipts and metadata-only audit. Do not
  store note/journal/mood/capture text, scores, query strings or voice metadata in
  logs/audit/outbox. Use the specified version1 capture.triaged outbox event with
  empty payload; existing owner Task/Habit effects stay transactional. No workers,
  new dependencies, P1-09 features or speculative entity relationships.

## Alternatives and verification

Mutable journal overwrite loses history; JSON change logs and separate history/
attachment entities exceed current needs. Explicit conversion payloads avoid unsafe
inference. Atomic owner façades avoid partial triage and duplicate targets. Finance
posting, unbounded NLP, automatic journaling and global private search opt-in need
later product approval and are not introduced here.

Use additive reviewed migrations with unchanged prior migration/provider schemas.
Test private search defaults/opt-in and count leakage, owner ID/filter/file swaps,
folder cycles/order, large/restricted Markdown, attributed dates/DST/travel,
historical corrections/voids, daily-check-in uniqueness, stale/concurrent writes,
duplicate triage/failed-conversion rollback, private audio, parser boundaries,
existing regressions and compiled API restart/idempotent replay.

Owner approval: Explicit approval of this proposal in the P1-08 session.
